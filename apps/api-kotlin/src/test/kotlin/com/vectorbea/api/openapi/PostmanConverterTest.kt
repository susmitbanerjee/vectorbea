package com.vectorbea.api.openapi

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.tools.httpspec.HttpAuthSpec
import com.vectorbea.worker.tools.httpspec.HttpToolSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * A Postman collection becomes tools — item 13.
 *
 * ── THE INTERESTING ASSERTIONS ARE ABOUT WHAT IS DROPPED ────────────────────
 * A collection is a set of EXAMPLE REQUESTS, and an exported one habitually
 * carries the author's own live credential in an `Authorization` header. The
 * conversion takes the SHAPE of that auth — bearer, or an API key in a named
 * header — and discards the VALUE, because importing it would move a live
 * credential out of a file somebody exported and into a database column that is
 * read by the list endpoint, rendered in a form and diffed on re-import.
 *
 * The other half is honesty: a collection declares no schema, so types are
 * inferred from example values and optionality is unknowable. Both are stated at
 * import time rather than discovered later by somebody wondering why their
 * Postman-derived tools have no result contracts.
 */
class PostmanConverterTest {

    private val mapper = ObjectMapper()

    private val collection = """
    {
      "info": {
        "name": "Acme API",
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
        "description": "The team's working collection."
      },
      "auth": {
        "type": "bearer",
        "bearer": [{"key": "token", "value": "sk-live-THE-AUTHORS-REAL-TOKEN-0123456789", "type": "string"}]
      },
      "variable": [{"key": "baseUrl", "value": "https://api.acme.test/v2"}],
      "item": [
        {
          "name": "Customers",
          "item": [
            {
              "name": "Get customer",
              "request": {
                "method": "GET",
                "header": [
                  {"key": "Authorization", "value": "Bearer sk-live-THE-AUTHORS-REAL-TOKEN-0123456789"},
                  {"key": "X-Tenant", "value": "acme"}
                ],
                "url": {
                  "raw": "{{baseUrl}}/customers/:customerId?expand=orders",
                  "path": ["customers", ":customerId"],
                  "query": [{"key": "expand", "value": "orders"}],
                  "variable": [{"key": "customerId", "value": "cus_123",
                                "description": "The customer id."}]
                }
              },
              "response": [
                {
                  "name": "OK", "code": 200,
                  "body": "{\"id\":\"cus_123\",\"name\":\"Acme Ltd\",\"status\":\"active\",\"balance\":420}"
                }
              ]
            },
            {
              "name": "Create customer",
              "request": {
                "method": "POST",
                "url": {"raw": "{{baseUrl}}/customers", "path": ["customers"]},
                "body": {
                  "mode": "raw",
                  "options": {"raw": {"language": "json"}},
                  "raw": "{\"name\":\"Acme Ltd\",\"seats\":5,\"active\":true}"
                }
              },
              "response": []
            },
            {
              "name": "Upload logo",
              "request": {
                "method": "POST",
                "url": {"raw": "{{baseUrl}}/customers/:customerId/logo",
                        "path": ["customers", ":customerId", "logo"],
                        "variable": [{"key": "customerId", "value": "cus_123"}]},
                "body": {
                  "mode": "formdata",
                  "formdata": [
                    {"key": "file", "type": "file", "src": "/Users/someone/logo.png"},
                    {"key": "caption", "value": "Our logo", "type": "text"}
                  ]
                }
              }
            }
          ]
        }
      ]
    }
    """.trimIndent()

    private fun convert(): Pair<OpenApiDocument, List<String>> {
        val root = mapper.readTree(collection)
        assertTrue(PostmanConverter.looksLikePostman(root), "the collection was not recognised")
        val converted = PostmanConverter.convert(root)
        return OpenApiDocument.of(converted.document) to converted.notes
    }

    private fun tools(doc: OpenApiDocument) = doc.operations()
        .map { OperationMapper.map(doc, it, HttpAuthSpec.Bearer(), doc.baseUrl()) }

    @Test
    fun `the author's live token is not imported anywhere`() {
        val (doc, _) = convert()
        val everything = tools(doc).joinToString("\n") { it.spec.toJsonString() } +
            mapper.writeValueAsString(doc.securitySchemes)

        assertFalse(
            "sk-live-THE-AUTHORS-REAL-TOKEN-0123456789" in everything,
            "the collection's own credential was imported. A live token in " +
                "`http_spec_json` is a live token in the list endpoint, the tool " +
                "form, every version snapshot and every re-import diff.",
        )
        assertTrue(
            doc.securitySchemes.containsKey("collectionAuth"),
            "the SHAPE of the auth should survive even though the value does not",
        )
        assertEquals("bearer", doc.securitySchemes["collectionAuth"]?.get("scheme")?.asText())
    }

    @Test
    fun `path variables become path parameters in OpenAPI's spelling`() {
        val (doc, _) = convert()
        val get = tools(doc).first { it.spec.request.methodUpper == "GET" }

        assertEquals("/customers/{customerId}", get.spec.request.path,
            "Postman writes `:customerId`; OpenAPI writes `{customerId}`")
        val pathInput = get.spec.request.inputs.first {
            it.location == HttpToolSpec.InputMapping.Location.PATH
        }
        assertEquals("customerId", pathInput.wireName)
        assertTrue(pathInput.required, "a path parameter that is optional produces a broken URL")
        assertEquals("The customer id.", pathInput.description)
    }

    @Test
    fun `the collection variable becomes the base URL, not part of every path`() {
        val (doc, _) = convert()
        assertEquals("https://api.acme.test/v2", doc.baseUrl())
        tools(doc).forEach {
            assertFalse(
                "{{" in it.spec.request.path,
                "an unsubstituted Postman variable survived into the path: ${it.spec.request.path}",
            )
        }
    }

    @Test
    fun `a JSON example body becomes typed body inputs`() {
        val (doc, _) = convert()
        val post = tools(doc).first {
            it.spec.request.methodUpper == "POST" && it.spec.request.path == "/customers"
        }
        assertEquals("application/json", post.spec.request.body.contentType)

        val byName = post.spec.request.inputs.associateBy { it.wireName }
        assertEquals("string", byName["name"]?.type)
        assertEquals(
            "integer", byName["seats"]?.type,
            "a numeric example value is the only evidence a collection offers about type",
        )
        assertEquals("boolean", byName["active"]?.type)
        assertTrue(
            post.spec.request.inputs.none { it.required },
            "one example request proves nothing about which fields the API requires; " +
                "marking them required would make the tool refuse calls the API accepts",
        )
    }

    @Test
    fun `a form-data file part becomes a multipart file input`() {
        val (doc, _) = convert()
        val upload = tools(doc).first { it.spec.request.path.endsWith("/logo") }

        assertTrue(
            upload.spec.request.body is HttpToolSpec.BodySpec.Multipart,
            "formdata is multipart; got ${upload.spec.request.body::class.simpleName}",
        )
        val file = upload.spec.request.inputs.first { it.wireName == "file" }
        assertTrue(file.isFile, "the file part was imported as an ordinary text field")

        val fileSchema = upload.inputSchema.path("properties").path(file.name)
        assertEquals("object", fileSchema.path("type").asText())
        assertTrue(
            fileSchema.path("properties").has("filename"),
            "a model told to send `string, format: binary` has no way to supply a " +
                "filename or a content type, and the multipart part needs both",
        )
    }

    @Test
    fun `a saved response example becomes a result contract`() {
        val (doc, _) = convert()
        val get = tools(doc).first { it.spec.request.methodUpper == "GET" }
        val contract = assertNotNull(
            get.resultContract,
            "a saved 200 example is the only response shape a collection has, and it " +
                "is as good as a declared schema for ranking field names",
        )
        val fields = contract.path("fields").map { it.path("path").asText() }
        assertTrue("body.id" in fields, "the identity field was not ranked in: $fields")
        assertTrue("body.name" in fields)
    }

    @Test
    fun `the notes say what a collection cannot give you`() {
        val (_, notes) = convert()
        assertTrue(
            notes.any { "inferred" in it.lowercase() },
            "a collection declares no schema, and somebody has to be told: $notes",
        )
        assertTrue(
            notes.any { "result contract" in it.lowercase() },
            "two of three requests have no saved response, so two tools start without " +
                "a contract. Said at import time, not discovered later: $notes",
        )
    }

    @Test
    fun `client-owned headers are dropped and real ones are kept`() {
        val (doc, _) = convert()
        val get = tools(doc).first { it.spec.request.methodUpper == "GET" }
        val headers = get.spec.request.inputs
            .filter { it.location == HttpToolSpec.InputMapping.Location.HEADER }
            .map { it.wireName }

        assertFalse("Authorization" in headers, "auth comes from the connection, not a parameter")
        assertTrue("X-Tenant" in headers, "an ordinary header the API needs was dropped")
    }

    @Test
    fun `a collection that is not one is left alone`() {
        val openApi = mapper.readTree("""{"openapi":"3.0.0","info":{"title":"x","version":"1"}}""")
        assertFalse(
            PostmanConverter.looksLikePostman(openApi),
            "an OpenAPI document must not be routed through the Postman converter",
        )
    }
}
