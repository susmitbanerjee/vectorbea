package com.vectorbea.api.openapi

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.ObjectNode

/**
 * Converts a Postman collection into an OpenAPI 3 document — item 13.
 *
 * ── WHY CONVERT RATHER THAN IMPORT DIRECTLY ─────────────────────────────────
 * The brief says "if cheap", and converting is what makes it cheap. Everything
 * downstream — the operation walk, the parameter mapping, the body encoding, the
 * result contract generator, the security mapping, the fingerprint, the diff —
 * already works on an OpenAPI document. A second import pipeline would be a
 * second copy of every one of those, and the copies would drift: the Postman
 * path would quietly not get pagination detection, or would get a different
 * risk-tier rule.
 *
 * So this file is a translator and nothing else. It is the only place in the
 * importer that knows what Postman is.
 *
 * ── WHAT IS AND IS NOT RECOVERABLE FROM A COLLECTION ────────────────────────
 * A collection is a set of EXAMPLE REQUESTS, not a schema. That difference is
 * the whole character of this conversion:
 *
 *   · Path and query parameters are recoverable — they are in the URL, and
 *     Postman marks path variables with a `:` prefix.
 *   · Types are NOT declared, so they are inferred from the example values. An
 *     example of `42` becomes `integer`; there is no other evidence available.
 *   · A request body is an example, so the generated schema is the SHAPE of that
 *     example. Optionality is unknowable: everything present is emitted as
 *     optional, because guessing "required" from one example would make a tool
 *     refuse calls the API accepts.
 *   · RESPONSES are usually absent. Where a collection saves an example response
 *     it is used, and where it does not, the tool gets no result contract — which
 *     is honest, and is why an OpenAPI document produces a better tool.
 *
 * The UI says all of this at import time rather than leaving somebody to
 * discover that their Postman-derived tools have no result contracts.
 */
object PostmanConverter {

    private val mapper = ObjectMapper()

    /** True when this document is a Postman collection rather than an OpenAPI one. */
    fun looksLikePostman(root: JsonNode): Boolean {
        val schema = root.get("info")?.get("schema")?.asText() ?: return false
        return schema.contains("getpostman.com/json/collection", ignoreCase = true) ||
            schema.contains("schema.postman.com", ignoreCase = true)
    }

    class UnsupportedCollection(message: String) : Exception(message)

    /** What was lost in translation, for the import screen to state plainly. */
    data class Conversion(val document: ObjectNode, val notes: List<String>)

    fun convert(root: JsonNode): Conversion {
        val info = root.get("info") as? ObjectNode
            ?: throw UnsupportedCollection("This collection has no `info` block.")

        val notes = ArrayList<String>()
        val paths = mapper.createObjectNode()
        val variables = collectionVariables(root)
        /* Resolved BEFORE the walk: every path is relative to it, and the prefix
           has to be removed from each one. See the note in [pathOf]. */
        val baseUrl = baseUrlOf(root, variables)
        val basePath = baseUrl
            ?.let { runCatching { java.net.URI(it).path?.trimEnd('/') }.getOrNull() }
            ?.takeIf { it.isNotBlank() }
        var requestCount = 0
        var responseExamples = 0

        /* Postman folders nest arbitrarily. Flattened, because a folder is an
           organising device for a person and carries no behaviour — the folder
           name becomes a tag, so the grouping survives where it is useful. */
        walk(root.get("item"), emptyList()) { item, folders ->
            val request = item.get("request") ?: return@walk
            requestCount++
            val method = (request.get("method")?.asText() ?: "GET").uppercase()
            val url = request.get("url")

            val rawPath = pathOf(url, variables, basePath) ?: run {
                notes += "Skipped `${item.get("name")?.asText() ?: "an unnamed request"}`: " +
                    "its URL could not be read."
                return@walk
            }

            val operation = mapper.createObjectNode()
            operation.put("operationId", operationIdFor(item, folders, method, rawPath))
            item.get("name")?.asText()?.takeIf { it.isNotBlank() }
                ?.let { operation.put("summary", it) }
            descriptionOf(request)?.let { operation.put("description", it) }
            if (folders.isNotEmpty()) {
                operation.putArray("tags").also { a -> folders.forEach { a.add(it) } }
            }

            val parameters = operation.putArray("parameters")
            pathVariables(rawPath, url).forEach { parameters.add(it) }
            queryParameters(url).forEach { parameters.add(it) }
            headerParameters(request).forEach { parameters.add(it) }

            requestBody(request)?.let { operation.set<JsonNode>("requestBody", it) }

            val responses = operation.putObject("responses")
            val example = savedResponse(item)
            if (example != null) {
                responseExamples++
                responses.set<JsonNode>("200", example)
            } else {
                responses.putObject("200").put("description", "Success")
            }

            val pathItem = (paths.get(rawPath) as? ObjectNode) ?: paths.putObject(rawPath)
            pathItem.set<JsonNode>(method.lowercase(), operation)
        }

        if (requestCount == 0) {
            throw UnsupportedCollection("This collection contains no requests.")
        }
        if (responseExamples == 0) {
            notes += "No saved response examples, so the imported tools start without a " +
                "result contract. Add one per tool, or import the vendor's OpenAPI " +
                "document instead — an agent shown a whole response uses it poorly."
        } else if (responseExamples < requestCount) {
            notes += "$responseExamples of $requestCount requests have a saved response " +
                "example; only those get a starting result contract."
        }
        notes += "Types were inferred from example values. A collection declares no " +
            "schema, so check anything that must be a number or a boolean."

        val document = mapper.createObjectNode()
        document.put("openapi", "3.0.3")
        document.putObject("info").apply {
            put("title", info.get("name")?.asText() ?: "Imported collection")
            put("version", "1.0.0")
            info.get("description")?.let { d ->
                put("description", if (d.isTextual) d.asText() else d.path("content").asText(""))
            }
        }
        baseUrl?.let { base ->
            document.putArray("servers").addObject().put("url", base)
        } ?: run {
            notes += "No collection-level base URL was found, so each tool carries its " +
                "own absolute URL. Set a base URL on the connection to share one."
        }
        document.set<JsonNode>("paths", paths)
        authOf(root)?.let { (scheme, requirement) ->
            document.putObject("components").putObject("securitySchemes")
                .set<JsonNode>("collectionAuth", scheme)
            document.putArray("security").addObject()
                .putArray("collectionAuth").also { a -> requirement.forEach { a.add(it) } }
        }

        return Conversion(document, notes)
    }

    // ── Walking ──────────────────────────────────────────────────────────────

    private fun walk(
        items: JsonNode?,
        folders: List<String>,
        depth: Int = 0,
        visit: (JsonNode, List<String>) -> Unit,
    ) {
        if (items == null || !items.isArray || depth > MAX_FOLDER_DEPTH) return
        for (item in items) {
            val children = item.get("item")
            if (children != null && children.isArray) {
                val name = item.get("name")?.asText()?.takeIf { it.isNotBlank() }
                walk(children, folders + listOfNotNull(name), depth + 1, visit)
            } else if (item.get("request") != null) {
                visit(item, folders)
            }
        }
    }

    // ── URL ──────────────────────────────────────────────────────────────────

    /**
     * The path template, in OpenAPI's spelling.
     *
     * Postman writes a path variable as `:userId`; OpenAPI writes `{userId}`.
     * Postman `{{baseUrl}}` variables are stripped from the front, because they
     * are the base URL and belong on the server rather than in every path.
     */
    private fun pathOf(
        url: JsonNode?,
        variables: Map<String, String>,
        basePath: String?,
    ): String? {
        val raw = when {
            url == null -> return null
            url.isTextual -> url.asText()
            url.get("raw") != null -> url.get("raw").asText()
            url.get("path") != null -> "/" + (url.get("path") as ArrayNode).joinToString("/") { it.asText() }
            else -> return null
        }
        var path = substituteVariables(raw, variables).substringBefore('?').substringBefore('#')
        /* Strip the origin, whatever form it arrived in. */
        Regex("""^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+""").find(path)?.let {
            path = path.removePrefix(it.value)
        }
        /*
         * Then the base URL's own path prefix.
         *
         * ── THE BUG THIS FIXES ──────────────────────────────────────────────
         * `{{baseUrl}}` is usually an origin PLUS a path — `https://api.x/v2` —
         * and stripping only the origin left `/v2` at the front of every path
         * while `/v2` was also the server. Every imported tool would then have
         * called `https://api.x/v2/v2/customers`, and the symptom is a vendor 404
         * that names nothing.
         */
        if (basePath != null && path.startsWith(basePath)) {
            path = path.removePrefix(basePath)
        }
        path = path.replace(Regex("""\{\{[^}]+}}"""), "")
        path = Regex(""":([A-Za-z_][A-Za-z0-9_]*)""").replace(path) { "{${it.groupValues[1]}}" }
        if (!path.startsWith("/")) path = "/$path"
        return path.ifBlank { "/" }
    }

    private fun pathVariables(path: String, url: JsonNode?): List<ObjectNode> {
        val documented = (url?.get("variable") as? ArrayNode)?.associate { v ->
            (v.get("key")?.asText() ?: "") to v
        } ?: emptyMap()

        return Regex("""\{([^}]+)}""").findAll(path).map { it.groupValues[1] }.distinct().map { name ->
            val declared = documented[name]
            mapper.createObjectNode().apply {
                put("name", name)
                put("in", "path")
                put("required", true)
                declared?.get("description")?.let { d ->
                    put("description", if (d.isTextual) d.asText() else d.path("content").asText(""))
                }
                set<JsonNode>("schema", inferSchema(declared?.get("value")))
            }
        }.toList()
    }

    private fun queryParameters(url: JsonNode?): List<ObjectNode> {
        val query = url?.get("query") as? ArrayNode ?: return emptyList()
        return query.mapNotNull { q ->
            val key = q.get("key")?.asText()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            mapper.createObjectNode().apply {
                put("name", key)
                put("in", "query")
                /*
                 * Postman's `disabled` flag means the person unticked it in the UI,
                 * which is the closest thing a collection has to "optional". An
                 * enabled parameter is still not required — an example request
                 * sending a value proves nothing about whether the API needs it,
                 * and marking it required would make the tool refuse calls the API
                 * accepts.
                 */
                put("required", false)
                q.get("description")?.let { d ->
                    put("description", if (d.isTextual) d.asText() else d.path("content").asText(""))
                }
                set<JsonNode>("schema", inferSchema(q.get("value")))
            }
        }
    }

    private fun headerParameters(request: JsonNode): List<ObjectNode> {
        val headers = request.get("header") as? ArrayNode ?: return emptyList()
        return headers.mapNotNull { h ->
            val key = h.get("key")?.asText()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            /*
             * A collection habitually carries the author's own credential in a
             * header. It is dropped rather than imported: turning somebody's
             * exported Authorization header into a tool parameter would put a live
             * credential into `tools.config_json`, which is read by the list
             * endpoint and rendered in the UI. Auth comes from the connection.
             */
            if (key.lowercase() in DROPPED_HEADERS) return@mapNotNull null
            if (h.path("disabled").asBoolean(false)) return@mapNotNull null
            mapper.createObjectNode().apply {
                put("name", key)
                put("in", "header")
                put("required", false)
                set<JsonNode>("schema", inferSchema(h.get("value")))
            }
        }
    }

    // ── Body ─────────────────────────────────────────────────────────────────

    private fun requestBody(request: JsonNode): ObjectNode? {
        val body = request.get("body") as? ObjectNode ?: return null
        val mode = body.get("mode")?.asText() ?: return null

        val (contentType, schema) = when (mode) {
            "raw" -> {
                val raw = body.get("raw")?.asText() ?: return null
                val language = body.get("options")?.get("raw")?.get("language")?.asText()
                if (language == "json" || raw.trimStart().startsWith("{") ||
                    raw.trimStart().startsWith("[")
                ) {
                    "application/json" to inferSchema(runCatching { mapper.readTree(raw) }.getOrNull())
                } else {
                    (if (language == "xml") "application/xml" else "text/plain") to
                        mapper.createObjectNode().put("type", "string")
                }
            }

            "urlencoded" -> "application/x-www-form-urlencoded" to
                schemaFromPairs(body.get("urlencoded") as? ArrayNode)

            "formdata" -> "multipart/form-data" to
                schemaFromFormData(body.get("formdata") as? ArrayNode)

            "graphql" -> "application/json" to mapper.createObjectNode().apply {
                put("type", "object")
                putObject("properties").apply {
                    putObject("query").put("type", "string")
                    putObject("variables").put("type", "object")
                }
            }

            /* `file` mode references a path on the author's machine. There is
               nothing to import, and pretending otherwise produces a tool that
               fails at call time. */
            else -> return null
        }

        return mapper.createObjectNode().apply {
            put("required", true)
            putObject("content").set<JsonNode>(
                contentType,
                mapper.createObjectNode().set<JsonNode>("schema", schema),
            )
        }
    }

    private fun schemaFromPairs(pairs: ArrayNode?): ObjectNode {
        val schema = mapper.createObjectNode().put("type", "object")
        val props = schema.putObject("properties")
        pairs?.forEach { p ->
            if (p.path("disabled").asBoolean(false)) return@forEach
            val key = p.get("key")?.asText()?.takeIf { it.isNotBlank() } ?: return@forEach
            props.set<JsonNode>(key, inferSchema(p.get("value")))
        }
        return schema
    }

    private fun schemaFromFormData(parts: ArrayNode?): ObjectNode {
        val schema = mapper.createObjectNode().put("type", "object")
        val props = schema.putObject("properties")
        parts?.forEach { p ->
            if (p.path("disabled").asBoolean(false)) return@forEach
            val key = p.get("key")?.asText()?.takeIf { it.isNotBlank() } ?: return@forEach
            if (p.get("type")?.asText() == "file") {
                props.putObject(key).put("type", "string").put("format", "binary")
            } else {
                props.set<JsonNode>(key, inferSchema(p.get("value")))
            }
        }
        return schema
    }

    // ── Responses ────────────────────────────────────────────────────────────

    /**
     * The first saved 2xx example, as a response schema.
     *
     * This is the only source of response shape a collection has, and where it
     * exists it is as good as a declared schema for the purpose the contract
     * generator puts it to — the field NAMES are what the ranking reads.
     */
    private fun savedResponse(item: JsonNode): ObjectNode? {
        val responses = item.get("response") as? ArrayNode ?: return null
        val example = responses.firstOrNull { r ->
            (r.get("code")?.asInt() ?: 0) in 200..299
        } ?: return null
        val bodyText = example.get("body")?.asText()?.takeIf { it.isNotBlank() } ?: return null
        val parsed = runCatching { mapper.readTree(bodyText) }.getOrNull() ?: return null

        return mapper.createObjectNode().apply {
            put("description", example.get("name")?.asText() ?: "Success")
            putObject("content").putObject("application/json")
                .set<JsonNode>("schema", inferSchema(parsed))
        }
    }

    // ── Inference ────────────────────────────────────────────────────────────

    /**
     * A JSON Schema from one example value.
     *
     * Bounded in depth and in property count. A saved response can be a
     * multi-megabyte document, and turning all of it into a schema would produce
     * a schema nobody can read and a contract generator ranking four thousand
     * fields.
     */
    private fun inferSchema(value: JsonNode?, depth: Int = 0): ObjectNode {
        val out = mapper.createObjectNode()
        if (value == null || value.isNull || depth > MAX_INFER_DEPTH) {
            return out.put("type", "string")
        }
        return when {
            value.isBoolean -> out.put("type", "boolean")
            value.isIntegralNumber -> out.put("type", "integer")
            value.isNumber -> out.put("type", "number")
            value.isArray -> out.put("type", "array").apply {
                set<JsonNode>("items", inferSchema(value.firstOrNull(), depth + 1))
            }

            value.isObject -> out.put("type", "object").apply {
                val props = putObject("properties")
                value.fields().asSequence().take(MAX_INFERRED_PROPERTIES).forEach { (k, v) ->
                    props.set<JsonNode>(k, inferSchema(v, depth + 1))
                }
            }

            else -> {
                /*
                 * A string that is obviously a number in a URL or a form is still a
                 * string here. Postman stores every query value as text, so
                 * inferring `integer` from `"42"` would declare a type the example
                 * does not prove — and an API that accepts `"42"` for a string
                 * parameter would then be sent an unquoted 42.
                 */
                out.put("type", "string")
            }
        }
    }

    // ── Collection-level bits ────────────────────────────────────────────────

    private fun collectionVariables(root: JsonNode): Map<String, String> =
        (root.get("variable") as? ArrayNode)?.mapNotNull { v ->
            val key = v.get("key")?.asText()?.takeIf { it.isNotBlank() } ?: return@mapNotNull null
            key to (v.get("value")?.asText() ?: "")
        }?.toMap() ?: emptyMap()

    private fun substituteVariables(text: String, variables: Map<String, String>): String {
        var out = text
        variables.forEach { (k, v) -> if (v.isNotBlank()) out = out.replace("{{$k}}", v) }
        return out
    }

    /**
     * The base URL, from a `baseUrl`-shaped collection variable.
     *
     * Nearly every collection has one, under one of a handful of names. Failing
     * to find it is not fatal — each tool then carries an absolute URL — and the
     * import screen says so, because sharing a base URL across tools is what
     * makes an environment switch a one-field change later.
     */
    private fun baseUrlOf(root: JsonNode, variables: Map<String, String>): String? {
        for (name in BASE_URL_VARIABLES) {
            variables[name]?.takeIf { it.startsWith("http") }?.let { return it.trimEnd('/') }
        }
        /* Otherwise, the origin of the first request that has one. */
        var found: String? = null
        walk(root.get("item"), emptyList()) { item, _ ->
            if (found != null) return@walk
            val raw = item.get("request")?.get("url")?.let { u ->
                if (u.isTextual) u.asText() else u.get("raw")?.asText()
            } ?: return@walk
            Regex("""^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]+""")
                .find(substituteVariables(raw, variables))
                ?.let { found = it.value }
        }
        return found
    }

    /**
     * Collection-level auth, as a security scheme.
     *
     * Only the SHAPE is taken — that it is a bearer token, or an API key in a
     * named header. The VALUE is discarded: a collection routinely contains a
     * live token, and importing it would move a credential from a file somebody
     * exported into a database column. The connection is where it goes, and the
     * person is asked for it once.
     */
    private fun authOf(root: JsonNode): Pair<ObjectNode, List<String>>? {
        val auth = root.get("auth") as? ObjectNode ?: return null
        return when (auth.get("type")?.asText()?.lowercase()) {
            "bearer" -> mapper.createObjectNode()
                .put("type", "http").put("scheme", "bearer") to emptyList()

            "basic" -> mapper.createObjectNode()
                .put("type", "http").put("scheme", "basic") to emptyList()

            "apikey" -> {
                val entries = (auth.get("apikey") as? ArrayNode)?.associate {
                    (it.get("key")?.asText() ?: "") to (it.get("value")?.asText() ?: "")
                } ?: emptyMap()
                val headerName = entries["key"]?.takeIf { it.isNotBlank() } ?: "X-API-Key"
                val location = entries["in"]?.takeIf { it.isNotBlank() } ?: "header"
                mapper.createObjectNode()
                    .put("type", "apiKey").put("name", headerName).put("in", location) to emptyList()
            }

            "oauth2" -> mapper.createObjectNode()
                .put("type", "http").put("scheme", "bearer") to emptyList()

            else -> null
        }
    }

    private fun descriptionOf(request: JsonNode): String? {
        val d = request.get("description") ?: return null
        val text = if (d.isTextual) d.asText() else d.path("content").asText("")
        return text.takeIf { it.isNotBlank() }
    }

    private fun operationIdFor(
        item: JsonNode,
        folders: List<String>,
        method: String,
        path: String,
    ): String {
        val name = item.get("name")?.asText()?.takeIf { it.isNotBlank() }
            ?: "$method $path"
        return (folders + name).joinToString("_")
            .lowercase()
            .replace(Regex("""[^a-z0-9]+"""), "_")
            .trim('_')
            .take(100)
    }

    private const val MAX_FOLDER_DEPTH = 12
    private const val MAX_INFER_DEPTH = 6
    private const val MAX_INFERRED_PROPERTIES = 60

    private val DROPPED_HEADERS = setOf(
        "authorization", "x-api-key", "api-key", "apikey", "x-auth-token",
        "cookie", "proxy-authorization", "content-type", "accept", "content-length",
        "user-agent", "host",
    )
    private val BASE_URL_VARIABLES = listOf("baseUrl", "base_url", "url", "host", "server", "apiUrl")
}
