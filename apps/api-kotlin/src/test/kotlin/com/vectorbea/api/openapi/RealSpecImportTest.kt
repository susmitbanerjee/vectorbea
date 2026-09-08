package com.vectorbea.api.openapi

import com.vectorbea.worker.tools.httpspec.HttpAuthSpec
import com.vectorbea.worker.tools.httpspec.HttpToolSpec
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * The acceptance criterion: "importing a real public OpenAPI document produces
 * working tools; test with at least three well-known specs of different shapes."
 *
 * ── WHY THE FIXTURES ARE REAL AND WHY THEY ARE TRIMMED ──────────────────────
 * Every byte in `src/test/resources/openapi` came out of the vendor's own
 * published document. Nothing is hand-written, because a hand-written spec tests
 * the importer against what its author expected — which is the one input it is
 * guaranteed to handle.
 *
 * They are trimmed to a handful of operations and their transitive `$ref`
 * closure because the full documents are 12 MB (GitHub) and 8 MB (Stripe), and a
 * 20 MB test fixture directory is a repository nobody wants to clone. The FULL
 * documents are exercised by [FullSpecImportIntegrationTest], which fetches them
 * over the network and is tagged `integration`.
 *
 * ── FOUR SHAPES, CHOSEN FOR WHAT THEY BREAK ─────────────────────────────────
 *   · PETSTORE  — YAML. Multipart upload, an API key in a header, OAuth2, and a
 *                 path parameter. The only YAML fixture, so it is the one that
 *                 proves the format detection.
 *   · GITHUB    — Deep path nesting, `Link`-header pagination, a required
 *                 `accept` header, enormous descriptions, and `oneOf` responses.
 *   · STRIPE    — Form-encoded request bodies with bracket nesting, cursor
 *                 pagination on `starting_after` with `has_more`, and bearer
 *                 auth. The shape the old resolver could not express at all.
 *   · TWILIO    — Form-encoded bodies with Basic auth, PAGE-based pagination,
 *                 and PascalCase wire names (`PageSize`, `MessagingServiceSid`)
 *                 that have to survive into a legible agent-facing name without
 *                 changing what goes on the wire.
 */
class RealSpecImportTest {

    private fun load(name: String): OpenApiDocument {
        val bytes = javaClass.getResourceAsStream("/openapi/$name")?.readBytes()
            ?: fail("fixture /openapi/$name is missing")
        return OpenApiDocument.of(OpenApiReader.read(bytes).root)
    }

    private fun mapAll(doc: OpenApiDocument): List<OperationMapper.Generated> {
        val auth = SecuritySchemeMapper.candidates(doc).firstOrNull()?.auth ?: HttpAuthSpec.None
        return doc.operations().map { OperationMapper.map(doc, it, auth, doc.baseUrl()) }
    }

    // ── Every fixture: the generic contract ──────────────────────────────────

    @Test
    fun `every operation in every fixture produces a spec that round-trips`() {
        for (fixture in FIXTURES) {
            val doc = load(fixture)
            val generated = mapAll(doc)
            assertTrue(generated.isNotEmpty(), "$fixture produced no operations")

            for (g in generated) {
                /*
                 * The round trip is the real assertion. The API writes this JSON
                 * and the WORKER reads it back; a spec that serialises to something
                 * the reader rejects is a tool that saves cleanly and fails at run
                 * time, which is the failure mode this whole shared-source
                 * arrangement exists to prevent.
                 */
                val json = g.spec.toJsonString()
                val reparsed = HttpToolSpec.parse(json)
                    ?: fail("$fixture / ${g.slug}: the generated spec did not parse back")

                assertEquals(g.spec.request.methodUpper, reparsed.request.methodUpper, g.slug)
                assertEquals(g.spec.request.path, reparsed.request.path, g.slug)
                assertEquals(
                    g.spec.request.inputs.size, reparsed.request.inputs.size,
                    "${g.slug}: inputs were lost in serialisation",
                )
                assertEquals(g.spec.auth.strategy, reparsed.auth.strategy, g.slug)
                assertEquals(
                    g.spec.request.body.contentType, reparsed.request.body.contentType,
                    "${g.slug}: the body content type was lost",
                )

                // Every path placeholder is supplied by a declared path input.
                val placeholders = Regex("""\{([^}]+)}""")
                    .findAll(g.spec.request.path).map { it.groupValues[1] }.toSet()
                val pathInputs = g.spec.request.inputs
                    .filter { it.location == HttpToolSpec.InputMapping.Location.PATH }
                    .map { it.wireName }.toSet()
                assertTrue(
                    placeholders.all { it in pathInputs },
                    "${g.slug}: the path needs ${placeholders - pathInputs} and no input supplies it",
                )

                // Every required input is in the schema's `required` list.
                val required: Set<String> =
                    g.inputSchema.get("required")?.map { it.asText() }?.toSet() ?: emptySet()
                g.spec.request.inputs.filter { it.required && it.constant == null }.forEach {
                    assertTrue(it.name in required, "${g.slug}: '${it.name}' is required and not in the schema")
                }

                /*
                 * A generated result contract must be readable by the SHAPE
                 * `ToolResultContract` parses. That type is worker-only — it is a
                 * runtime projection concern and the API has no business compiling
                 * it — so the check here is structural: the version, that something
                 * is declared, and that every field path is rooted at the whole
                 * result rather than at the response body.
                 */
                g.resultContract?.let { contract ->
                    assertEquals(1, contract.get("version")?.asInt(), "${g.slug}: contract version")
                    assertTrue(
                        contract.has("fields") || contract.has("collection"),
                        "${g.slug}: a contract that declares nothing projects every result to {}",
                    )
                    contract.get("fields")?.forEach { f ->
                        assertTrue(
                            f.path("path").asText().startsWith("body."),
                            "${g.slug}: field paths are rooted at the whole result, so they " +
                                "carry the `body.` prefix",
                        )
                    }
                }
            }
        }
    }

    @Test
    fun `no generated document contains anything resembling a credential`() {
        for (fixture in FIXTURES) {
            val doc = load(fixture)
            for (g in mapAll(doc)) {
                val json = g.spec.toJsonString()
                /*
                 * An auth strategy names FIELDS of the connection's secret. Nothing
                 * it produces may be a value. This is the import-time half of the
                 * acceptance criterion that a secret never appears anywhere.
                 */
                SpecSecretScan.findInlineSecret(g.spec.toJson())?.let {
                    fail("$fixture / ${g.slug}: the generated spec carries $it")
                }
                assertTrue("Bearer sk_" !in json, "${g.slug}: a literal token leaked into the spec")
            }
        }
    }

    // ── Petstore: YAML, multipart, header API key ────────────────────────────

    @Test
    fun `petstore parses as YAML and maps its upload to multipart`() {
        val doc = load("petstore-v3.yaml")
        assertEquals("Swagger Petstore - OpenAPI 3.0", doc.title)
        assertTrue(doc.specVersion.startsWith("3."))

        val upload = mapAll(doc).firstOrNull { it.slug.contains("uploadfile") }
        assertNotNull(upload, "the upload operation was not imported")
        assertTrue(
            upload.spec.request.body is HttpToolSpec.BodySpec.Passthrough ||
                upload.spec.request.body is HttpToolSpec.BodySpec.Multipart,
            "an octet-stream upload should not have become a JSON body",
        )

        val addPet = mapAll(doc).firstOrNull { it.slug == "addpet" }
        assertNotNull(addPet, "addPet was not imported")
        assertEquals("POST", addPet.spec.request.methodUpper)
        assertEquals("application/json", addPet.spec.request.body.contentType)
        assertTrue(
            addPet.spec.request.inputs.any {
                it.location == HttpToolSpec.InputMapping.Location.BODY && it.wireName == "name"
            },
            "the body schema's properties did not become body inputs",
        )

        // The API key scheme names its own header, which is the whole point.
        val apiKey = SecuritySchemeMapper.candidates(doc)
            .firstOrNull { it.auth is HttpAuthSpec.ApiKeyHeader }
        assertNotNull(apiKey, "the api_key scheme was not mapped")
        assertEquals("api_key", (apiKey.auth as HttpAuthSpec.ApiKeyHeader).header)
    }

    // ── GitHub: link-header pagination, nested paths ─────────────────────────

    @Test
    fun `github list issues paginates by link header and keeps its path parameters`() {
        val doc = load("github.json")
        val listIssues = mapAll(doc).firstOrNull {
            it.spec.request.path == "/repos/{owner}/{repo}/issues" &&
                it.spec.request.methodUpper == "GET"
        }
        assertNotNull(listIssues, "list issues was not imported")

        val pathInputs = listIssues.spec.request.inputs
            .filter { it.location == HttpToolSpec.InputMapping.Location.PATH }
            .map { it.wireName }.toSet()
        assertEquals(setOf("owner", "repo"), pathInputs, "path-level parameters were dropped")
        assertTrue(
            listIssues.spec.request.inputs.filter {
                it.location == HttpToolSpec.InputMapping.Location.PATH
            }.all { it.required },
            "a path parameter that is not required produces a URL with a placeholder in it",
        )

        assertTrue(
            listIssues.spec.pagination is HttpToolSpec.PaginationSpec.LinkHeader,
            "GitHub declares a Link header; got ${listIssues.spec.pagination}",
        )
        assertTrue(
            listIssues.spec.pagination.maxPages in 1..10,
            "an uncapped page walk is the failure this strategy exists to prevent",
        )

        val createIssue = mapAll(doc).firstOrNull {
            it.spec.request.path == "/repos/{owner}/{repo}/issues" &&
                it.spec.request.methodUpper == "POST"
        }
        assertNotNull(createIssue)
        assertEquals("application/json", createIssue.spec.request.body.contentType)
        assertEquals(
            "medium", createIssue.riskLevel,
            "a POST that creates something is not a low-risk read",
        )
    }

    // ── Stripe: form encoding and cursor pagination ──────────────────────────

    @Test
    fun `stripe posts a form-encoded body, not JSON`() {
        val doc = load("stripe.json")
        val createCustomer = mapAll(doc).firstOrNull {
            it.spec.request.path == "/v1/customers" && it.spec.request.methodUpper == "POST"
        }
        assertNotNull(createCustomer, "create customer was not imported")

        val body = createCustomer.spec.request.body
        assertTrue(
            body is HttpToolSpec.BodySpec.Form,
            "Stripe takes application/x-www-form-urlencoded; got ${body::class.simpleName}. " +
                "This is precisely the case the previous resolver could not express.",
        )
        assertEquals("application/x-www-form-urlencoded", body.contentType)
        assertTrue(
            (body as HttpToolSpec.BodySpec.Form).bracketNesting,
            "without bracket nesting a nested object cannot be form-encoded at all",
        )
        assertTrue(
            createCustomer.spec.request.inputs.any {
                it.location == HttpToolSpec.InputMapping.Location.BODY
            },
            "the form body produced no body inputs",
        )
    }

    @Test
    fun `stripe list customers is detected as cursor pagination`() {
        val doc = load("stripe.json")
        val listCustomers = mapAll(doc).firstOrNull {
            it.spec.request.path == "/v1/customers" && it.spec.request.methodUpper == "GET"
        }
        assertNotNull(listCustomers)

        val pagination = listCustomers.spec.pagination
        assertTrue(
            pagination is HttpToolSpec.PaginationSpec.Cursor,
            "Stripe paginates on starting_after; got $pagination",
        )
        assertEquals("starting_after", pagination.cursorParam)
        assertEquals(
            "has_more", pagination.hasMorePath,
            "without has_more the walk loops on the final page, because Stripe returns " +
                "the last object's id as the cursor whether or not there is more",
        )
        assertEquals("data", pagination.itemsPath)
    }

    @Test
    fun `stripe refunds import at high risk and require approval`() {
        val doc = load("stripe.json")
        val refund = mapAll(doc).firstOrNull { it.spec.request.path == "/v1/refunds" }
        assertNotNull(refund, "the refund operation was not imported")
        assertEquals(
            "high", refund.riskLevel,
            "an operation that moves money must not import as medium: erring downward " +
                "is the direction that costs real money",
        )
        assertTrue(refund.requiresApproval, "a high-risk tool imports with approval on")
    }

    // ── Twilio: form bodies, basic auth, page pagination, two names ──────────

    @Test
    fun `twilio send message posts a form body under basic auth`() {
        val doc = load("twilio.json")
        val send = mapAll(doc).firstOrNull {
            it.spec.request.methodUpper == "POST" && it.spec.request.path.endsWith("/Messages.json")
        }
        assertNotNull(send, "create message was not imported")

        assertTrue(
            send.spec.request.body is HttpToolSpec.BodySpec.Form,
            "Twilio takes a form-encoded body; got ${send.spec.request.body::class.simpleName}. " +
                "A POST that cannot express its body is the defect being fixed.",
        )
        assertTrue(
            send.spec.request.inputs.any {
                it.location == HttpToolSpec.InputMapping.Location.BODY && it.wireName == "To"
            },
            "the `To` body field did not survive the import",
        )

        val basic = SecuritySchemeMapper.candidates(doc)
            .firstOrNull { it.auth is HttpAuthSpec.Basic }
        assertNotNull(basic, "Twilio's basic auth scheme was not mapped")
    }

    @Test
    fun `twilio wire names are preserved while agent names are made legible`() {
        val doc = load("twilio.json")
        val list = mapAll(doc).firstOrNull {
            it.spec.request.methodUpper == "GET" && it.spec.request.path.endsWith("/Messages.json")
        }
        assertNotNull(list)

        val accountSid = list.spec.request.inputs.first { it.wireName == "AccountSid" }
        assertEquals(
            "AccountSid", accountSid.wireName,
            "the wire name is what the service reads and must never be rewritten",
        )
        assertTrue(accountSid.required, "a path parameter that is optional produces a broken URL")

        /*
         * `DateSent<` is a real Twilio query parameter. It must survive onto the
         * wire verbatim while producing an agent-facing name a model can put in a
         * JSON key — which is exactly what having two names is for.
         */
        list.spec.request.inputs.firstOrNull { it.wireName == "DateSent<" }?.let { input ->
            assertTrue(
                input.name.all { it.isLetterOrDigit() || it == '_' },
                "the agent-facing name `${input.name}` is not a usable JSON key",
            )
        }
    }

    @Test
    fun `twilio list messages is detected as page pagination`() {
        val doc = load("twilio.json")
        val list = mapAll(doc).firstOrNull {
            it.spec.request.methodUpper == "GET" && it.spec.request.path.endsWith("/Messages.json")
        }
        assertNotNull(list)
        val pagination = list.spec.pagination
        assertTrue(
            pagination is HttpToolSpec.PaginationSpec.Offset && pagination.pageMode,
            "Twilio paginates on Page/PageSize; got $pagination",
        )
        assertEquals("Page", pagination.offsetParam)
        assertEquals("PageSize", pagination.limitParam)
    }

    // ── Result contracts are trimmed, which is the point of generating them ──

    @Test
    fun `generated result contracts are narrow enough to be useful`() {
        for (fixture in FIXTURES) {
            val doc = load(fixture)
            for (g in mapAll(doc)) {
                val contract = g.resultContract ?: continue
                val fields = contract.get("fields")?.size() ?: 0
                assertTrue(
                    fields <= 10,
                    "$fixture / ${g.slug}: $fields fields. A contract as wide as the " +
                        "response reproduces the truncation problem it exists to solve.",
                )
                contract.get("collection")?.get("sample")?.let { sample ->
                    assertTrue(sample.asInt() in 1..25, "${g.slug}: unbounded collection sample")
                }
            }
        }
    }

    @Test
    fun `descriptions are bounded, because they are sent every iteration`() {
        for (fixture in FIXTURES) {
            val doc = load(fixture)
            for (g in mapAll(doc)) {
                assertTrue(
                    g.description.length <= 600,
                    "$fixture / ${g.slug}: a ${g.description.length}-character description " +
                        "is paid for on every agent iteration",
                )
                g.spec.request.inputs.forEach { input ->
                    assertTrue(
                        (input.description?.length ?: 0) <= 200,
                        "${g.slug}/${input.name}: parameter description is not bounded",
                    )
                }
            }
        }
    }

    private companion object {
        val FIXTURES = listOf("petstore-v3.yaml", "github.json", "stripe.json", "twilio.json")
    }
}
