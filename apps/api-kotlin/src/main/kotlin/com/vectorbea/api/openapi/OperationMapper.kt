package com.vectorbea.api.openapi

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.ObjectNode
import com.vectorbea.worker.tools.httpspec.HttpToolSpec

/**
 * One OpenAPI operation becomes one working tool.
 *
 * ── THIS IS THE FEATURE ─────────────────────────────────────────────────────
 * Registering an HTTP tool by hand means getting a method, a URL template, five
 * parameter mappings, a body shape, a content type, an auth strategy, a response
 * extraction and a result contract all correct — and being told about each
 * mistake by a vendor's 400. The document already contains every one of those
 * answers. Reading them out is the single largest reduction in setup effort in
 * the product, and everything in this file exists to make the generated tool
 * good enough to use unedited rather than good enough to start from.
 *
 * ── WHAT "GOOD ENOUGH TO USE UNEDITED" MEANS, CONCRETELY ────────────────────
 *   · Required parameters are required, and optional ones have their defaults.
 *   · Path parameters land in the path, query in the query, headers in headers,
 *     body properties at their nested position — with the vendor's wire name
 *     preserved and a legible agent-facing name where they differ.
 *   · The body encoding matches the operation's declared content type, so a
 *     form-encoded API is form-encoded.
 *   · The response contract is TRIMMED. An untrimmed one is the problem V056
 *     was written for: a 56-field record that does not fit in the observation
 *     budget. The generator picks a bounded, ranked subset and leaves widening
 *     it to the person, because widening is safe and narrowing after the fact
 *     means noticing.
 *   · Pagination is detected from the parameter names the whole industry uses.
 */
object OperationMapper {

    private val mapper = ObjectMapper()

    /** Everything generated for one operation. */
    data class Generated(
        val name: String,
        val slug: String,
        val description: String,
        val spec: HttpToolSpec,
        /** JSON Schema the model is shown. */
        val inputSchema: ObjectNode,
        /** The starting result contract, for the user to trim. */
        val resultContract: ObjectNode?,
        val riskLevel: String,
        val requiresApproval: Boolean,
    )

    /**
     * Map one operation.
     *
     * [auth] is decided once per document, at connection level (item 10), and
     * passed in rather than derived per operation — a document whose operations
     * name different security schemes is real, but prompting for a credential
     * per operation is not a product.
     */
    fun map(
        doc: OpenApiDocument,
        op: OpenApiDocument.Operation,
        auth: com.vectorbea.worker.tools.httpspec.HttpAuthSpec,
        baseUrl: String?,
    ): Generated {
        val inputs = ArrayList<HttpToolSpec.InputMapping>()
        val schemaProps = mapper.createObjectNode()
        val required = ArrayList<String>()
        /* Agent-facing names must be unique across every location: they are keys
           of one arguments object, whatever part of the request they end up in. */
        val takenNames = HashSet<String>()

        // ── Parameters ────────────────────────────────────────────────────────
        for (param in op.parameters) {
            val wireName = param.get("name")?.asText() ?: continue
            val location = when (param.get("in")?.asText()?.lowercase()) {
                "path" -> HttpToolSpec.InputMapping.Location.PATH
                "query" -> HttpToolSpec.InputMapping.Location.QUERY
                "header" -> HttpToolSpec.InputMapping.Location.HEADER
                "cookie" -> HttpToolSpec.InputMapping.Location.COOKIE
                else -> continue
            }
            /*
             * A few headers are the CLIENT's business, not the model's. `Accept`
             * and `Content-Type` are set by the resolver from the operation's own
             * declared content types, and offering them to a model produces
             * exactly one outcome: a model that eventually sets one wrong.
             */
            if (location == HttpToolSpec.InputMapping.Location.HEADER &&
                wireName.lowercase() in CLIENT_OWNED_HEADERS
            ) continue

            val schema = doc.resolveDeep(param.get("schema"), maxDepth = 6)
            val agentName = uniqueName(agentNameFor(wireName), takenNames)
            val isRequired = param.path("required").asBoolean(false) ||
                location == HttpToolSpec.InputMapping.Location.PATH

            inputs += HttpToolSpec.InputMapping(
                name = agentName,
                location = location,
                wireName = wireName,
                required = isRequired,
                type = typeOf(schema),
                description = descriptionOf(param, schema),
                default = defaultOf(schema),
                enumValues = enumOf(schema),
                style = styleOf(param),
                explode = param.path("explode").asBoolean(
                    /* OpenAPI's own default: true for `form`, false otherwise. */
                    (param.get("style")?.asText() ?: "form") == "form"
                ),
            )
            schemaProps.set<JsonNode>(agentName, agentSchemaFor(schema, param))
            if (isRequired) required += agentName
        }

        // ── Request body ──────────────────────────────────────────────────────
        val body = mapBody(doc, op, inputs, schemaProps, required, takenNames)

        // ── The spec ──────────────────────────────────────────────────────────
        val pagination = PaginationDetector.detect(op, inputs, doc)
        val responses = op.responses
        val successCodes = successStatusesOf(responses)

        val spec = HttpToolSpec(
            request = HttpToolSpec.Request(
                method = op.method,
                path = op.path,
                baseUrl = op.serverUrl ?: baseUrl,
                inputs = inputs,
                body = body,
                headers = acceptHeaderFor(responses),
            ),
            auth = auth,
            response = HttpToolSpec.ResponseSpec(
                /* Only declared when the operation's successes are NOT the plain
                   2xx default. Writing `[200]` for an operation that also answers
                   201 is how an import turns a working create into a failure. */
                expectedStatus = if (successCodes.isNotEmpty() && successCodes != DEFAULT_2XX)
                    successCodes else emptyList(),
                extract = ResultContractGenerator.extractionFor(doc, responses),
                errors = ErrorMappingGenerator.forOperation(doc, op),
            ),
            pagination = pagination,
            /* Retry defaults are the platform's. A write is not retried unless the
               author opts in AND an idempotency key is propagated — see
               `HttpToolResolver.sendWithRetry`, which enforces the pairing. */
            retry = HttpToolSpec.RetrySpec(),
            idempotency = HttpToolSpec.IdempotencySpec(),
        )

        val inputSchema = mapper.createObjectNode().apply {
            put("type", "object")
            set<JsonNode>("properties", schemaProps)
            if (required.isNotEmpty()) {
                putArray("required").also { a -> required.forEach { a.add(it) } }
            }
            /* Closed by construction. A model that invents an argument should be
               told, rather than having it silently dropped by the assembler —
               which is what an open schema plus a declared-inputs-only assembler
               would produce, and it looks exactly like the API ignoring it. */
            put("additionalProperties", false)
        }

        val risk = riskOf(op)
        return Generated(
            name = nameFor(op),
            slug = slugFor(op),
            description = descriptionFor(op),
            spec = spec,
            inputSchema = inputSchema,
            resultContract = ResultContractGenerator.forOperation(doc, responses, pagination),
            riskLevel = risk,
            requiresApproval = risk in setOf("high", "critical"),
        )
    }

    // ── Request body ─────────────────────────────────────────────────────────

    /**
     * Choose a content type and generate the body inputs.
     *
     * ── WHY THE CHOICE IS RANKED AND NOT "THE FIRST ONE" ────────────────────
     * An operation offering both `application/json` and `multipart/form-data` is
     * offering two ways to do one thing, and JSON is the one a model can produce.
     * Taking whichever the document happened to list first would make the
     * generated tool depend on the vendor's key order — which is not stable
     * across their own releases.
     */
    private fun mapBody(
        doc: OpenApiDocument,
        op: OpenApiDocument.Operation,
        inputs: MutableList<HttpToolSpec.InputMapping>,
        schemaProps: ObjectNode,
        required: MutableList<String>,
        takenNames: MutableSet<String>,
    ): HttpToolSpec.BodySpec {
        val content = op.requestBody?.get("content") as? ObjectNode
            ?: return HttpToolSpec.BodySpec.None
        val bodyRequired = op.requestBody.path("required").asBoolean(false)

        val chosen = CONTENT_TYPE_PREFERENCE.firstNotNullOfOrNull { preferred ->
            content.fields().asSequence().firstOrNull { (ct, _) ->
                ct.substringBefore(';').trim().equals(preferred, ignoreCase = true)
            }
        } ?: content.fields().asSequence().firstOrNull()
        ?: return HttpToolSpec.BodySpec.None

        val contentType = chosen.key.substringBefore(';').trim()
        val schema = doc.resolveDeep(chosen.value.get("schema"), maxDepth = 8)

        /*
         * A body whose schema is not an object — `type: string`, or a bare array —
         * cannot be decomposed into named inputs. It becomes ONE input carrying
         * the whole payload, which is both honest and the only thing that works
         * for `application/octet-stream` and for the endpoints that take raw XML.
         */
        if (!schema.isObject || schema.get("properties") == null) {
            val name = uniqueName("body", takenNames)
            inputs += HttpToolSpec.InputMapping(
                name = name,
                location = HttpToolSpec.InputMapping.Location.BODY,
                wireName = name,
                required = bodyRequired,
                type = typeOf(schema),
                description = op.requestBody.get("description")?.asText()
                    ?.let { stripMarkup(it).take(MAX_PARAM_DESCRIPTION) }
                    ?: "The request body.",
            )
            schemaProps.set<JsonNode>(name, agentSchemaFor(schema, null))
            if (bodyRequired) required += name
            return HttpToolSpec.BodySpec.Passthrough(contentType, name)
        }

        val properties = schema.get("properties") as ObjectNode
        val requiredFields = (schema.get("required") as? ArrayNode)?.map { it.asText() }?.toSet()
            ?: emptySet()

        /*
         * Only the TOP level becomes inputs, with nested objects passed whole.
         *
         * Flattening every leaf of a deep schema produces forty inputs, most of
         * which a model will never set, and each of which costs schema tokens on
         * every iteration. A nested object as one input keeps the tool small and
         * lets the model send the sub-document when it needs to — and
         * `InputMapping.bodyPath` is there for the case where an author does want
         * to hoist one leaf.
         */
        properties.fields().forEach { (wireName, rawPropSchema) ->
            val propSchema = doc.resolveDeep(rawPropSchema, maxDepth = 6)
            if (propSchema.path("readOnly").asBoolean(false)) return@forEach
            val agentName = uniqueName(agentNameFor(wireName), takenNames)
            val isFile = propSchema.path("format").asText() == "binary"
            val isRequired = wireName in requiredFields

            inputs += HttpToolSpec.InputMapping(
                name = agentName,
                location = HttpToolSpec.InputMapping.Location.BODY,
                wireName = wireName,
                required = isRequired,
                type = typeOf(propSchema),
                /* Capped and stripped exactly as a parameter's is. A body property
                   description is sent on every iteration too, and some vendors put
                   a full Markdown table in one. */
                description = propSchema.get("description")?.asText()?.takeIf { it.isNotBlank() }
                    ?.let { stripMarkup(it).take(MAX_PARAM_DESCRIPTION) },
                default = defaultOf(propSchema),
                enumValues = enumOf(propSchema),
                bodyPath = wireName,
                isFile = isFile,
            )
            schemaProps.set<JsonNode>(
                agentName,
                if (isFile) fileSchema(propSchema) else agentSchemaFor(propSchema, null),
            )
            if (isRequired) required += agentName
        }

        return when {
            contentType.startsWith("application/x-www-form-urlencoded") ->
                HttpToolSpec.BodySpec.Form(contentType)

            contentType.startsWith("multipart/") ->
                HttpToolSpec.BodySpec.Multipart(contentType)

            contentType.startsWith("application/json") || contentType.endsWith("+json") ->
                HttpToolSpec.BodySpec.Json(contentType)

            else -> HttpToolSpec.BodySpec.Json(contentType)
        }
    }

    /**
     * The shape a model is shown for a file part.
     *
     * A binary property in a spec is `type: string, format: binary`, which tells
     * a model to send a string and tells it nothing about the filename or the
     * content type — both of which the multipart part needs. Naming the three
     * fields explicitly is what makes an upload operation callable rather than
     * merely importable.
     */
    private fun fileSchema(schema: JsonNode): ObjectNode = mapper.createObjectNode().apply {
        put("type", "object")
        put(
            "description",
            (schema.get("description")?.asText()?.plus(" ") ?: "") +
                "A file. `content` is the file's text, or base64 for binary."
        )
        putObject("properties").apply {
            putObject("filename").put("type", "string")
            putObject("contentType").put("type", "string")
            putObject("content").put("type", "string")
        }
        putArray("required").add("filename").add("content")
    }

    // ── Naming ───────────────────────────────────────────────────────────────

    /**
     * The agent-facing name for a wire name.
     *
     * ── WHY RENAME AT ALL ───────────────────────────────────────────────────
     * `starting_after` and `X-GitHub-Api-Version` are wire names. A model reads
     * an argument list the way a person skims one, and `startingAfter` is read
     * correctly more often than `starting_after` is. The wire name is preserved
     * exactly — that is what the two-name design is for — so nothing is lost by
     * making the readable half readable.
     *
     * The transformation is conservative: separators to camelCase, and nothing
     * else. Anything cleverer (expanding abbreviations, dropping prefixes) would
     * produce names that differ between two operations of the same API, which is
     * worse than a slightly ugly name.
     */
    fun agentNameFor(wireName: String): String {
        /*
         * COMPARISON SUFFIXES FIRST, because they carry meaning that stripping
         * would destroy. `DateSent<` and `DateSent>` are two real, DIFFERENT
         * Twilio parameters; removing the punctuation collapses them into one
         * name, and whichever lost would silently stop being sendable. `Max` and
         * `Min` are correct for both dates and numbers, which `Before`/`After`
         * would not be.
         */
        var working = wireName
        for ((suffix, word) in COMPARISON_SUFFIXES) {
            if (working.endsWith(suffix)) {
                working = working.dropLast(suffix.length) + word
                break
            }
        }

        /* Everything a JSON key may not usefully contain. A model addresses this
           name as an object key, so anything that would need escaping there is
           a name it will eventually get wrong. */
        working = working.replace(Regex("""[^A-Za-z0-9_.\-\[\]]"""), "")

        if (!working.any { it == '_' || it == '-' || it == '.' || it == '[' }) {
            return working.ifBlank { wireName.filter { it.isLetterOrDigit() }.ifBlank { "value" } }
        }
        val cleaned = working.replace(Regex("""[\[\]]"""), "")
        val parts = cleaned.split('_', '-', '.').filter { it.isNotEmpty() }
        if (parts.isEmpty()) return working
        return parts.first().replaceFirstChar { it.lowercase() } +
            parts.drop(1).joinToString("") { p -> p.replaceFirstChar { it.uppercase() } }
    }

    /**
     * Make [candidate] unique among [taken].
     *
     * Two wire names CAN normalise to one agent name — `page_size` and `pageSize`
     * in the same operation is rare and real. A collision would mean one of them
     * is unreachable, so the later one is suffixed. Ugly and correct beats tidy
     * and missing a parameter.
     */
    private fun uniqueName(candidate: String, taken: MutableSet<String>): String {
        if (taken.add(candidate)) return candidate
        var n = 2
        while (!taken.add("$candidate$n")) n++
        return "$candidate$n"
    }

    /**
     * A human name for the tool.
     *
     * `summary` first, because it is what the vendor's own documentation shows in
     * its sidebar and is therefore what the person importing recognises.
     * `operationId` second. `METHOD path` last, which is ugly and unambiguous.
     */
    fun nameFor(op: OpenApiDocument.Operation): String {
        op.summary?.takeIf { it.isNotBlank() && it.length <= 80 }?.let { return it.trim() }
        op.operationId?.takeIf { it.isNotBlank() }?.let { return humanise(it) }
        return "${op.method} ${op.path}"
    }

    fun slugFor(op: OpenApiDocument.Operation): String {
        val base = op.operationId?.takeIf { it.isNotBlank() }
            ?: "${op.method}_${op.path}"
        return base.lowercase()
            .replace(Regex("""[{}]"""), "")
            .replace(Regex("""[^a-z0-9]+"""), "_")
            .trim('_')
            .take(80)
    }

    /**
     * What the model is told the tool is for.
     *
     * Both halves when both exist: `summary` is the one-liner and `description`
     * is the paragraph, and the paragraph is where a vendor says the thing that
     * stops an agent using the wrong endpoint ("this returns at most 100; use
     * search for more"). Capped, because a description is sent on every
     * iteration and some vendors write essays.
     */
    fun descriptionFor(op: OpenApiDocument.Operation): String {
        val parts = listOfNotNull(
            op.summary?.trim()?.takeIf { it.isNotBlank() },
            op.description?.trim()?.takeIf { it.isNotBlank() && it != op.summary?.trim() },
        )
        val text = if (parts.isEmpty()) "${op.method} ${op.path}" else parts.joinToString(". ")
        val stripped = stripMarkup(text)
        /*
         * The cap covers the PREFIX too.
         *
         * This used to be `"DEPRECATED. " + stripped.take(MAX_DESCRIPTION)`, which
         * is 612 characters for a deprecated operation with a long description —
         * the cap silently not applying to exactly the operations most likely to
         * carry a wall of migration prose. Found by importing GitHub's whole
         * document; no trimmed fixture happened to contain one.
         */
        return if (op.deprecated) "DEPRECATED. $stripped".take(MAX_DESCRIPTION)
        else stripped.take(MAX_DESCRIPTION)
    }

    /**
     * Vendor descriptions are Markdown, and often contain a whole table.
     *
     * Links become their text, headings and code fences lose their punctuation,
     * and runs of whitespace collapse. This is not a Markdown renderer; it is the
     * removal of the parts that cost tokens and carry nothing for a model.
     */
    private fun stripMarkup(text: String): String = text
        .replace(Regex("""```[\s\S]*?```"""), " ")
        .replace(Regex("""\[([^\]]+)]\([^)]*\)"""), "$1")
        .replace(Regex("""[#*_`>|]"""), " ")
        .replace(Regex("""<[^>]{1,80}>"""), " ")
        .replace(Regex("""\s+"""), " ")
        .trim()

    private fun humanise(operationId: String): String =
        operationId
            .replace(Regex("""([a-z])([A-Z])"""), "$1 $2")
            .replace('_', ' ').replace('-', ' ')
            .replaceFirstChar { it.uppercase() }
            .replace(Regex("""\s+"""), " ")

    // ── Risk ─────────────────────────────────────────────────────────────────

    /**
     * The risk tier an imported operation starts at.
     *
     * ── ERRING UPWARDS IS THE ONLY DEFENSIBLE DIRECTION ─────────────────────
     * A tool imported at too high a tier costs somebody one click to lower. A
     * tool imported at too low a tier is granted to an agent and spends money.
     * So: reads are low, writes are medium, DELETE is high, and anything whose
     * path or summary names money, permissions or users is high — because those
     * are the operations where the cost of being wrong is not recoverable by
     * editing a row afterwards.
     */
    fun riskOf(op: OpenApiDocument.Operation): String {
        val haystack = "${op.path} ${op.summary.orEmpty()} ${op.operationId.orEmpty()}".lowercase()
        return when {
            HIGH_RISK_WORDS.any { it in haystack } && op.method != "GET" -> "high"
            op.method == "DELETE" -> "high"
            op.method in setOf("POST", "PUT", "PATCH") -> "medium"
            else -> "low"
        }
    }

    // ── Schema helpers ───────────────────────────────────────────────────────

    fun typeOf(schema: JsonNode?): String {
        if (schema == null || schema.isNull) return "string"
        schema.get("type")?.let { t ->
            if (t.isTextual) return t.asText()
            /* OpenAPI 3.1 allows `type: ["string", "null"]`. The non-null member
               is the useful one; nullability is expressed by absence here. */
            if (t.isArray) return t.firstOrNull { it.asText() != "null" }?.asText() ?: "string"
        }
        /* A schema with no `type` but with `properties` is an object, and one with
           `items` is an array. Both are common and both are unambiguous. */
        if (schema.has("properties")) return "object"
        if (schema.has("items")) return "array"
        for (key in listOf("oneOf", "anyOf", "allOf")) {
            (schema.get(key) as? ArrayNode)?.firstOrNull()?.let { return typeOf(it) }
        }
        return "string"
    }

    private fun defaultOf(schema: JsonNode?): Any? {
        val d = schema?.get("default") ?: return null
        return when {
            d.isNull -> null
            d.isBoolean -> d.asBoolean()
            d.isIntegralNumber -> d.asLong()
            d.isNumber -> d.asDouble()
            d.isTextual -> d.asText()
            else -> null
        }
    }

    private fun enumOf(schema: JsonNode?): List<String> =
        (schema?.get("enum") as? ArrayNode)?.map { it.asText() }?.take(50) ?: emptyList()

    private fun styleOf(param: JsonNode): HttpToolSpec.InputMapping.Style =
        when (param.get("style")?.asText()?.lowercase()) {
            "simple" -> HttpToolSpec.InputMapping.Style.SIMPLE
            "spacedelimited" -> HttpToolSpec.InputMapping.Style.SPACE_DELIMITED
            "pipedelimited" -> HttpToolSpec.InputMapping.Style.PIPE_DELIMITED
            "deepobject" -> HttpToolSpec.InputMapping.Style.DEEP_OBJECT
            else -> HttpToolSpec.InputMapping.Style.FORM
        }

    private fun descriptionOf(param: JsonNode, schema: JsonNode?): String? =
        (param.get("description")?.asText()?.takeIf { it.isNotBlank() }
            ?: schema?.get("description")?.asText()?.takeIf { it.isNotBlank() })
            ?.let { stripMarkup(it).take(MAX_PARAM_DESCRIPTION) }

    /**
     * The JSON Schema fragment the model is shown for one input.
     *
     * A REDUCTION of the vendor's schema, not a copy. A vendor's property schema
     * carries `example`, `x-` extensions, `$comment`, external docs links and
     * frequently a nested `allOf` — none of which a model uses and all of which
     * are paid for on every iteration. What is kept is what changes the argument
     * a model produces: type, description, enum, default, format, and the item
     * type of an array.
     */
    private fun agentSchemaFor(schema: JsonNode?, param: JsonNode?): ObjectNode {
        val out = mapper.createObjectNode()
        val type = typeOf(schema)
        out.put("type", type)
        descriptionOf(param ?: mapper.createObjectNode(), schema)?.let { out.put("description", it) }
        enumOf(schema).takeIf { it.isNotEmpty() }?.let { values ->
            out.putArray("enum").also { a -> values.forEach { a.add(it) } }
        }
        defaultOf(schema)?.let { d ->
            when (d) {
                is Boolean -> out.put("default", d)
                is Long -> out.put("default", d)
                is Double -> out.put("default", d)
                else -> out.put("default", d.toString())
            }
        }
        schema?.get("format")?.asText()?.takeIf { it.isNotBlank() && it != "binary" }
            ?.let { out.put("format", it) }
        if (type == "array") {
            val items = schema?.get("items")
            out.putObject("items").put("type", typeOf(items))
        }
        if (type == "object" && schema?.get("properties") != null) {
            /* One level of nesting is kept so a model knows the field names of an
               object argument. Two levels is where schema size starts to dominate
               the prompt, and the vendor's docs are a better place for the rest. */
            val props = out.putObject("properties")
            (schema.get("properties") as ObjectNode).fields().asSequence().take(20)
                .forEach { (k, v) -> props.putObject(k).put("type", typeOf(v)) }
        }
        return out
    }

    /**
     * The statuses this operation calls success.
     *
     * `2XX` wildcards are real in published documents and expand to the plain
     * default rather than to 100 integers.
     */
    private fun successStatusesOf(responses: JsonNode?): List<Int> {
        if (responses == null || !responses.isObject) return emptyList()
        val codes = responses.fieldNames().asSequence().toList()
        if (codes.any { it.equals("2XX", ignoreCase = true) }) return emptyList()
        return codes.mapNotNull { it.toIntOrNull() }.filter { it in 200..299 }.sorted()
    }

    /**
     * An `Accept` header, when the operation declares one content type.
     *
     * Sent because some APIs default to XML without it (and one large one
     * defaults to a deprecated schema version), and omitted when the operation
     * offers several — picking one for the caller would be guessing.
     */
    private fun acceptHeaderFor(responses: JsonNode?): Map<String, String> {
        if (responses == null || !responses.isObject) return emptyMap()
        val types = responses.fields().asSequence()
            .filter { (code, _) -> code.toIntOrNull()?.let { it in 200..299 } ?: false }
            .mapNotNull { (_, r) -> (r.get("content") as? ObjectNode)?.fieldNames()?.asSequence()?.toList() }
            .flatten().distinct().toList()
        return if (types.size == 1) mapOf("Accept" to types.first()) else emptyMap()
    }

    /**
     * Comparison operators that appear at the end of a query-parameter name.
     * Longest first, so `<=` is not matched as `<`.
     */
    private val COMPARISON_SUFFIXES = listOf(
        "<=" to "Max", ">=" to "Min", "!=" to "Not", "<" to "Max", ">" to "Min",
    )

    private const val MAX_DESCRIPTION = 600
    private const val MAX_PARAM_DESCRIPTION = 200

    /** Plain 2xx. When an operation's successes are exactly these, say nothing. */
    private val DEFAULT_2XX = emptyList<Int>()

    /** Headers the resolver owns. Offering them to a model invites a wrong one. */
    private val CLIENT_OWNED_HEADERS = setOf(
        "accept", "content-type", "content-length", "authorization", "host",
        "user-agent", "connection",
    )

    /**
     * Preference order when an operation offers several body encodings.
     * JSON first because it is what a model can actually produce.
     */
    private val CONTENT_TYPE_PREFERENCE = listOf(
        "application/json",
        "application/x-www-form-urlencoded",
        "multipart/form-data",
        "text/plain",
    )

    private val HIGH_RISK_WORDS = listOf(
        "payment", "charge", "refund", "payout", "transfer", "invoice", "subscription",
        "billing", "card", "bank", "permission", "role", "member", "user", "admin",
        "token", "key", "secret", "credential", "delete", "destroy", "purge",
    )
}
