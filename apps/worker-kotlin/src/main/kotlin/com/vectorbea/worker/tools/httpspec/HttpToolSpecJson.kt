package com.vectorbea.worker.tools.httpspec

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.fasterxml.jackson.databind.node.ObjectNode

/**
 * The wire form of [HttpToolSpec] — hand-written, on purpose.
 *
 * ── WHY NOT DATA-BINDING ────────────────────────────────────────────────────
 * Jackson can round-trip a sealed hierarchy with enough annotations, and the
 * result is a document whose shape is decided by the annotations rather than by
 * anyone who has to read it. This document is read by three audiences that are
 * not Kotlin: the API that generates it from OpenAPI, the React form that edits
 * it, and the person diffing two versions of a tool in a review. A hand-written
 * reader is the cost of the document being designed for them.
 *
 * ── THE READER IS TOTAL ─────────────────────────────────────────────────────
 * [read] returns null for anything it cannot fully understand and never throws.
 * A malformed spec must degrade to "this tool has no spec, use the legacy keys"
 * rather than failing a run: the legacy path still works, and a tool that stops
 * executing because its configuration gained a field it did not recognise is a
 * worse outcome than one that executes the configuration it had.
 *
 * The one thing it will NOT do is partially apply a spec. A document whose
 * `specVersion` is newer than this build is refused whole — dropping the fields
 * a newer writer added is how a tool quietly stops sending its auth header.
 */
internal object HttpToolSpecJson {

    private val mapper = ObjectMapper()

    // ── Read ─────────────────────────────────────────────────────────────────

    fun read(json: String?): HttpToolSpec? {
        if (json.isNullOrBlank() || json == "{}" || json == "null") return null
        return read(runCatching { mapper.readTree(json) }.getOrNull())
    }

    fun read(node: JsonNode?): HttpToolSpec? {
        if (node == null || !node.isObject) return null
        return try {
            val version = node.path("specVersion").asInt(HttpToolSpec.SPEC_VERSION)
            if (version > HttpToolSpec.SPEC_VERSION) return null
            val request = readRequest(node.get("request")) ?: return null
            HttpToolSpec(
                specVersion = version,
                request = request,
                auth = readAuth(node.get("auth")),
                response = readResponse(node.get("response")),
                pagination = readPagination(node.get("pagination")),
                timeoutMs = node.get("timeoutMs")?.takeIf { it.isNumber }?.asLong(),
                retry = readRetry(node.get("retry")),
                idempotency = readIdempotency(node.get("idempotency")),
                transport = readTransport(node.get("transport")),
                async = readAsync(node.get("async")),
            )
        } catch (_: Exception) {
            null
        }
    }

    private fun readRequest(n: JsonNode?): HttpToolSpec.Request? {
        if (n == null || !n.isObject) return null
        val method = n.path("method").asText("GET").uppercase()
        if (method !in HttpToolSpec.ALL_METHODS) return null
        val path = n.path("path").asText("")
        val inputs = (n.get("inputs") as? ArrayNode)?.mapNotNull { readInput(it) } ?: emptyList()
        return HttpToolSpec.Request(
            method = method,
            path = path,
            baseUrl = n.get("baseUrl")?.asText()?.takeIf { it.isNotBlank() },
            inputs = inputs,
            body = readBody(n.get("body")),
            headers = readStringMap(n.get("headers")),
            query = readStringMap(n.get("query")),
        )
    }

    private fun readInput(n: JsonNode): HttpToolSpec.InputMapping? {
        val name = n.path("name").asText().takeIf { it.isNotBlank() } ?: return null
        val location = when (n.path("in").asText().lowercase()) {
            "path" -> HttpToolSpec.InputMapping.Location.PATH
            "query" -> HttpToolSpec.InputMapping.Location.QUERY
            "header" -> HttpToolSpec.InputMapping.Location.HEADER
            "body" -> HttpToolSpec.InputMapping.Location.BODY
            "cookie" -> HttpToolSpec.InputMapping.Location.COOKIE
            else -> return null
        }
        return HttpToolSpec.InputMapping(
            name = name,
            location = location,
            wireName = n.get("wireName")?.asText()?.takeIf { it.isNotBlank() } ?: name,
            required = n.path("required").asBoolean(false),
            type = n.get("type")?.asText()?.takeIf { it.isNotBlank() } ?: "string",
            description = n.get("description")?.asText()?.takeIf { it.isNotBlank() },
            default = n.get("default")?.let { scalar(it) },
            constant = n.get("constant")?.let { scalar(it) },
            enumValues = (n.get("enum") as? ArrayNode)?.map { it.asText() } ?: emptyList(),
            style = when (n.path("style").asText().lowercase()) {
                "simple" -> HttpToolSpec.InputMapping.Style.SIMPLE
                "spacedelimited", "space_delimited" -> HttpToolSpec.InputMapping.Style.SPACE_DELIMITED
                "pipedelimited", "pipe_delimited" -> HttpToolSpec.InputMapping.Style.PIPE_DELIMITED
                "deepobject", "deep_object" -> HttpToolSpec.InputMapping.Style.DEEP_OBJECT
                else -> HttpToolSpec.InputMapping.Style.FORM
            },
            explode = n.path("explode").asBoolean(true),
            bodyPath = n.get("bodyPath")?.asText()?.takeIf { it.isNotBlank() },
            isFile = n.path("isFile").asBoolean(false),
        )
    }

    private fun readBody(n: JsonNode?): HttpToolSpec.BodySpec {
        if (n == null || !n.isObject) return HttpToolSpec.BodySpec.None
        val ct = n.get("contentType")?.asText()?.takeIf { it.isNotBlank() }
        return when (n.path("encoding").asText(inferEncoding(ct)).lowercase()) {
            "json" -> HttpToolSpec.BodySpec.Json(
                contentType = ct ?: "application/json",
                template = n.get("template")?.takeUnless { it.isNull },
            )

            "form" -> HttpToolSpec.BodySpec.Form(
                contentType = ct ?: "application/x-www-form-urlencoded",
                bracketNesting = n.path("bracketNesting").asBoolean(true),
            )

            "multipart" -> HttpToolSpec.BodySpec.Multipart(ct ?: "multipart/form-data")
            "raw" -> HttpToolSpec.BodySpec.Raw(
                contentType = ct ?: "text/plain",
                template = n.path("template").asText(""),
            )

            "passthrough" -> {
                val input = n.get("inputName")?.asText()?.takeIf { it.isNotBlank() }
                    ?: return HttpToolSpec.BodySpec.None
                HttpToolSpec.BodySpec.Passthrough(ct ?: "application/octet-stream", input)
            }

            else -> HttpToolSpec.BodySpec.None
        }
    }

    /** A body declared only by its content type still has to encode somehow. */
    private fun inferEncoding(contentType: String?): String = when {
        contentType == null -> "none"
        contentType.startsWith("application/json") || contentType.endsWith("+json") -> "json"
        contentType.startsWith("application/x-www-form-urlencoded") -> "form"
        contentType.startsWith("multipart/") -> "multipart"
        contentType.startsWith("text/") || contentType.endsWith("+xml") ||
            contentType.startsWith("application/xml") -> "raw"

        else -> "passthrough"
    }

    private fun readAuth(n: JsonNode?): HttpAuthSpec {
        if (n == null || !n.isObject) return HttpAuthSpec.InheritConnection
        return when (n.path("strategy").asText().lowercase()) {
            "none" -> HttpAuthSpec.None
            "api_key_header" -> HttpAuthSpec.ApiKeyHeader(
                header = n.path("header").asText("X-API-Key"),
                prefix = n.path("prefix").asText(""),
                secretField = n.path("secretField").asText(HttpAuthSpec.DEFAULT_SECRET_FIELD),
            )

            "api_key_query" -> HttpAuthSpec.ApiKeyQuery(
                param = n.path("param").asText("api_key"),
                secretField = n.path("secretField").asText(HttpAuthSpec.DEFAULT_SECRET_FIELD),
            )

            "bearer" -> HttpAuthSpec.Bearer(
                header = n.path("header").asText("Authorization"),
                prefix = n.path("prefix").asText("Bearer"),
                secretField = n.path("secretField").asText(HttpAuthSpec.DEFAULT_SECRET_FIELD),
            )

            "basic" -> HttpAuthSpec.Basic(
                username = n.path("username").asText(""),
                passwordSecretField = n.path("passwordSecretField")
                    .asText(HttpAuthSpec.DEFAULT_SECRET_FIELD),
                usernameSecretField = n.get("usernameSecretField")?.asText()?.takeIf { it.isNotBlank() },
                header = n.path("header").asText("Authorization"),
            )

            "oauth2_client_credentials" -> HttpAuthSpec.OAuth2ClientCredentials(
                tokenUrl = n.path("tokenUrl").asText().ifBlank { return HttpAuthSpec.InheritConnection },
                clientId = n.path("clientId").asText(""),
                clientSecretField = n.path("clientSecretField").asText("clientSecret"),
                scopes = (n.get("scopes") as? ArrayNode)?.map { it.asText() } ?: emptyList(),
                audience = n.get("audience")?.asText()?.takeIf { it.isNotBlank() },
                clientAuth = readClientAuth(n.path("clientAuth").asText()),
                header = n.path("header").asText("Authorization"),
                prefix = n.path("prefix").asText("Bearer"),
                expirySkewSeconds = n.path("expirySkewSeconds").asLong(60),
                extraParams = readStringMap(n.get("extraParams")),
            )

            "oauth2_authorization_code" -> HttpAuthSpec.OAuth2AuthorizationCode(
                tokenUrl = n.path("tokenUrl").asText().ifBlank { return HttpAuthSpec.InheritConnection },
                clientId = n.path("clientId").asText(""),
                clientSecretField = n.path("clientSecretField").asText("clientSecret"),
                accessTokenField = n.path("accessTokenField").asText("accessToken"),
                refreshTokenField = n.path("refreshTokenField").asText("refreshToken"),
                expiresAtField = n.path("expiresAtField").asText("expiresAt"),
                scopes = (n.get("scopes") as? ArrayNode)?.map { it.asText() } ?: emptyList(),
                clientAuth = readClientAuth(n.path("clientAuth").asText("body")),
                header = n.path("header").asText("Authorization"),
                prefix = n.path("prefix").asText("Bearer"),
                expirySkewSeconds = n.path("expirySkewSeconds").asLong(60),
            )

            "hmac" -> HttpAuthSpec.Hmac(
                algorithm = n.path("algorithm").asText("HmacSHA256"),
                secretField = n.path("secretField").asText(HttpAuthSpec.DEFAULT_SECRET_FIELD),
                canonicalTemplate = n.path("canonicalTemplate")
                    .asText("{{method}}\n{{path}}\n{{timestamp}}\n{{bodySha256Hex}}"),
                signatureHeader = n.path("signatureHeader").asText("X-Signature"),
                signaturePrefix = n.path("signaturePrefix").asText(""),
                encoding = when (n.path("encoding").asText().lowercase()) {
                    "base64" -> HttpAuthSpec.Hmac.Encoding.BASE64
                    "base64url", "base64_url" -> HttpAuthSpec.Hmac.Encoding.BASE64_URL
                    else -> HttpAuthSpec.Hmac.Encoding.HEX
                },
                timestampHeader = n.get("timestampHeader")?.asText()?.takeIf { it.isNotBlank() },
                timestampUnit = if (n.path("timestampUnit").asText().startsWith("milli"))
                    HttpAuthSpec.Hmac.TimestampUnit.MILLISECONDS
                else HttpAuthSpec.Hmac.TimestampUnit.SECONDS,
                nonceHeader = n.get("nonceHeader")?.asText()?.takeIf { it.isNotBlank() },
                keyId = n.get("keyId")?.asText()?.takeIf { it.isNotBlank() },
                keyIdHeader = n.get("keyIdHeader")?.asText()?.takeIf { it.isNotBlank() },
            )

            "custom" -> HttpAuthSpec.Custom(
                headers = readStringMap(n.get("headers")),
                query = readStringMap(n.get("query")),
            )

            else -> HttpAuthSpec.InheritConnection
        }
    }

    private fun readClientAuth(raw: String): HttpAuthSpec.OAuth2ClientCredentials.ClientAuth =
        if (raw.lowercase() == "body") HttpAuthSpec.OAuth2ClientCredentials.ClientAuth.BODY
        else HttpAuthSpec.OAuth2ClientCredentials.ClientAuth.BASIC_HEADER

    private fun readResponse(n: JsonNode?): HttpToolSpec.ResponseSpec {
        if (n == null || !n.isObject) return HttpToolSpec.ResponseSpec()
        return HttpToolSpec.ResponseSpec(
            expectedStatus = (n.get("expectedStatus") as? ArrayNode)
                ?.filter { it.isNumber }?.map { it.asInt() } ?: emptyList(),
            extract = readExtraction(n.get("extract")),
            errors = (n.get("errors") as? ArrayNode)?.map { e ->
                HttpToolSpec.ErrorMapping(
                    status = e.get("status")?.takeIf { it.isNumber }?.asInt(),
                    bodyContains = e.get("bodyContains")?.asText()?.takeIf { it.isNotBlank() },
                    whenBodyFalse = e.get("whenBodyFalse")?.asText()?.takeIf { it.isNotBlank() },
                    kind = e.path("kind").asText("unknown"),
                    retryable = e.path("retryable").asBoolean(false),
                    fix = e.get("fix")?.asText()?.takeIf { it.isNotBlank() },
                    messagePath = e.get("messagePath")?.asText()?.takeIf { it.isNotBlank() },
                )
            } ?: emptyList(),
            keepHeaders = (n.get("keepHeaders") as? ArrayNode)?.map { it.asText() } ?: emptyList(),
            maxResponseBytes = n.get("maxResponseBytes")?.takeIf { it.isNumber }?.asLong(),
        )
    }

    private fun readExtraction(n: JsonNode?): HttpToolSpec.Extraction {
        if (n == null || !n.isObject) return HttpToolSpec.Extraction.None
        val expr = n.get("expression")?.asText()?.takeIf { it.isNotBlank() }
            ?: return HttpToolSpec.Extraction.None
        return when (n.path("engine").asText().lowercase()) {
            "jsonpath", "json_path" -> HttpToolSpec.Extraction.JsonPath(expr)
            "jmespath", "jmes_path" -> HttpToolSpec.Extraction.JmesPath(expr)
            else -> HttpToolSpec.Extraction.None
        }
    }

    private fun readPagination(n: JsonNode?): HttpToolSpec.PaginationSpec {
        if (n == null || !n.isObject) return HttpToolSpec.PaginationSpec.None
        val items = n.get("itemsPath")?.asText()?.takeIf { it.isNotBlank() }

        /*
         * Both caps are clamped on the way IN rather than trusted.
         *
         * A stored spec is user-editable and an API-generated one is machine
         * written; neither is a reason to let a tool declare 10 000 pages. The
         * ceiling is the platform's, and it is applied where the value enters
         * rather than at the loop, so what the UI renders back is what will
         * actually happen.
         */
        val maxPages = n.path("maxPages").asInt(HttpToolSpec.DEFAULT_MAX_PAGES).coerceIn(1, HARD_MAX_PAGES)
        val maxItems = n.path("maxItems").asInt(HttpToolSpec.DEFAULT_MAX_ITEMS).coerceIn(1, HARD_MAX_ITEMS)

        return when (n.path("strategy").asText().lowercase()) {
            "cursor" -> HttpToolSpec.PaginationSpec.Cursor(
                cursorParam = n.path("cursorParam").asText().ifBlank {
                    return HttpToolSpec.PaginationSpec.None
                },
                nextCursorPath = n.path("nextCursorPath").asText().ifBlank {
                    return HttpToolSpec.PaginationSpec.None
                },
                hasMorePath = n.get("hasMorePath")?.asText()?.takeIf { it.isNotBlank() },
                limitParam = n.get("limitParam")?.asText()?.takeIf { it.isNotBlank() },
                pageSize = n.get("pageSize")?.takeIf { it.isNumber }?.asInt(),
                itemsPath = items, maxPages = maxPages, maxItems = maxItems,
            )

            "offset", "page" -> HttpToolSpec.PaginationSpec.Offset(
                offsetParam = n.path("offsetParam").asText("offset"),
                limitParam = n.get("limitParam")?.asText()?.takeIf { it.isNotBlank() },
                pageSize = n.path("pageSize").asInt(50).coerceIn(1, 1_000),
                pageMode = n.path("strategy").asText().lowercase() == "page" ||
                    n.path("pageMode").asBoolean(false),
                totalPath = n.get("totalPath")?.asText()?.takeIf { it.isNotBlank() },
                itemsPath = items, maxPages = maxPages, maxItems = maxItems,
            )

            "link_header", "link" -> HttpToolSpec.PaginationSpec.LinkHeader(
                relation = n.path("relation").asText("next"),
                itemsPath = items, maxPages = maxPages, maxItems = maxItems,
            )

            else -> HttpToolSpec.PaginationSpec.None
        }
    }

    private fun readRetry(n: JsonNode?): HttpToolSpec.RetrySpec {
        if (n == null || !n.isObject) return HttpToolSpec.RetrySpec()
        return HttpToolSpec.RetrySpec(
            maxAttempts = n.path("maxAttempts").asInt(3).coerceIn(1, 10),
            initialDelayMs = n.path("initialDelayMs").asLong(250).coerceIn(0, 60_000),
            maxDelayMs = n.path("maxDelayMs").asLong(8_000).coerceIn(0, 120_000),
            multiplier = n.path("multiplier").asDouble(2.0).coerceIn(1.0, 10.0),
            jitter = when (n.path("jitter").asText().lowercase()) {
                "none" -> HttpToolSpec.RetrySpec.Jitter.NONE
                "equal" -> HttpToolSpec.RetrySpec.Jitter.EQUAL
                else -> HttpToolSpec.RetrySpec.Jitter.FULL
            },
            retryOnStatus = (n.get("retryOnStatus") as? ArrayNode)
                ?.filter { it.isNumber }?.map { it.asInt() } ?: emptyList(),
            respectRetryAfter = n.path("respectRetryAfter").asBoolean(true),
            retryWrites = n.path("retryWrites").asBoolean(false),
        )
    }

    private fun readIdempotency(n: JsonNode?): HttpToolSpec.IdempotencySpec {
        if (n == null || !n.isObject) return HttpToolSpec.IdempotencySpec()
        return HttpToolSpec.IdempotencySpec(
            mode = if (n.path("mode").asText("auto").lowercase() == "none")
                HttpToolSpec.IdempotencySpec.Mode.NONE
            else HttpToolSpec.IdempotencySpec.Mode.AUTO,
            header = n.path("header").asText("Idempotency-Key").ifBlank { "Idempotency-Key" },
        )
    }

    /**
     * Read the async protocol, or null.
     *
     * ── A SPEC THAT NOTHING COULD RESOLVE IS REFUSED, NOT STORED ────────────
     * An async tool with neither a poll nor a callback would submit a job, park
     * the run, and sit there until the timeout — on every call, for every run.
     * That is a configuration that cannot work, so it is read as "not async" and
     * the tool behaves as an ordinary request/response call: it will report
     * whatever the submit returned, which is wrong but visible, rather than
     * parking runs invisibly.
     */
    private fun readAsync(n: JsonNode?): HttpToolSpec.AsyncSpec? {
        if (n == null || !n.isObject) return null
        val handlePath = n.get("handlePath")?.asText()?.takeIf { it.isNotBlank() } ?: return null

        val poll = (n.get("poll") as? ObjectNode)?.let { p ->
            val url = p.get("url")?.asText()?.takeIf { it.isNotBlank() } ?: return@let null
            HttpToolSpec.PollSpec(
                url = url,
                method = p.path("method").asText("GET").uppercase(),
                /* Floored at five seconds. A tool declaring a 100ms poll would
                   make one wait into six hundred requests a minute against a
                   provider that is, by construction, busy doing the work. */
                intervalMs = p.path("intervalMs").asLong(30_000).coerceIn(5_000, 3_600_000),
                maxAttempts = p.path("maxAttempts").asInt(60).coerceIn(1, 1_000),
                statusPath = p.path("statusPath").asText("status"),
                completedValues = readStrings(p.get("completedValues"))
                    .ifEmpty { listOf("succeeded", "completed", "success", "done", "finished") },
                failedValues = readStrings(p.get("failedValues"))
                    .ifEmpty { listOf("failed", "error", "cancelled", "canceled", "expired") },
                resultPath = p.get("resultPath")?.asText()?.takeIf { it.isNotBlank() },
                errorPath = p.get("errorPath")?.asText()?.takeIf { it.isNotBlank() },
            )
        }

        val callback = (n.get("callback") as? ObjectNode)?.let { c ->
            val input = c.get("urlInput")?.asText()?.takeIf { it.isNotBlank() } ?: return@let null
            HttpToolSpec.CallbackSpec(
                urlInput = input,
                statusPath = c.get("statusPath")?.asText()?.takeIf { it.isNotBlank() },
                completedValues = readStrings(c.get("completedValues"))
                    .ifEmpty { listOf("succeeded", "completed", "success", "done") },
                failedValues = readStrings(c.get("failedValues"))
                    .ifEmpty { listOf("failed", "error", "cancelled") },
                resultPath = c.get("resultPath")?.asText()?.takeIf { it.isNotBlank() },
                errorPath = c.get("errorPath")?.asText()?.takeIf { it.isNotBlank() },
                signatureSecretRef = c.get("signatureSecretRef")?.asText()?.takeIf { it.isNotBlank() },
                signatureHeader = c.get("signatureHeader")?.asText()?.takeIf { it.isNotBlank() },
            )
        }

        if (poll == null && callback == null) return null

        return HttpToolSpec.AsyncSpec(
            handlePath = handlePath,
            timeoutMs = n.get("timeoutMs")?.takeIf { it.isNumber }?.asLong(),
            poll = poll,
            callback = callback,
        )
    }

    private fun readStrings(n: JsonNode?): List<String> =
        (n as? ArrayNode)?.map { it.asText().lowercase() } ?: emptyList()

    private fun readTransport(n: JsonNode?): HttpToolSpec.TransportSpec {
        if (n == null || !n.isObject) return HttpToolSpec.TransportSpec()
        val mtls = n.get("mtls")?.takeIf { it.isObject }?.let { m ->
            val cert = m.get("clientCertSecretRef")?.asText()?.takeIf { it.isNotBlank() }
            val key = m.get("clientKeySecretRef")?.asText()?.takeIf { it.isNotBlank() }
            if (cert == null || key == null) null
            else HttpToolSpec.TransportSpec.Mtls(
                clientCertSecretRef = cert,
                clientKeySecretRef = key,
                keyPassphraseSecretRef = m.get("keyPassphraseSecretRef")
                    ?.asText()?.takeIf { it.isNotBlank() },
            )
        }
        val proxy = n.get("proxy")?.takeIf { it.isObject }?.let { p ->
            val host = p.get("host")?.asText()?.takeIf { it.isNotBlank() } ?: return@let null
            val port = p.get("port")?.takeIf { it.isNumber }?.asInt() ?: return@let null
            HttpToolSpec.TransportSpec.Proxy(
                host = host, port = port,
                scheme = p.path("scheme").asText("http"),
                credentialSecretRef = p.get("credentialSecretRef")?.asText()?.takeIf { it.isNotBlank() },
            )
        }
        return HttpToolSpec.TransportSpec(
            mtls = mtls,
            caBundlePem = n.get("caBundlePem")?.asText()?.takeIf { it.isNotBlank() },
            proxy = proxy,
            sni = n.get("sni")?.asText()?.takeIf { it.isNotBlank() },
            hostHeader = n.get("hostHeader")?.asText()?.takeIf { it.isNotBlank() },
            tlsProtocols = (n.get("tlsProtocols") as? ArrayNode)?.map { it.asText() } ?: emptyList(),
        )
    }

    private fun readStringMap(n: JsonNode?): Map<String, String> {
        if (n == null || !n.isObject) return emptyMap()
        val out = LinkedHashMap<String, String>()
        n.fields().forEach { (k, v) -> if (!v.isNull) out[k] = v.asText() }
        return out
    }

    private fun scalar(n: JsonNode): Any? = when {
        n.isNull -> null
        n.isBoolean -> n.asBoolean()
        n.isIntegralNumber -> n.asLong()
        n.isNumber -> n.asDouble()
        n.isTextual -> n.asText()
        else -> n
    }

    // ── Write ────────────────────────────────────────────────────────────────

    fun write(spec: HttpToolSpec): ObjectNode {
        val root = mapper.createObjectNode()
        root.put("specVersion", spec.specVersion)

        val req = root.putObject("request")
        req.put("method", spec.request.methodUpper)
        req.put("path", spec.request.path)
        spec.request.baseUrl?.let { req.put("baseUrl", it) }
        if (spec.request.inputs.isNotEmpty()) {
            val arr = req.putArray("inputs")
            spec.request.inputs.forEach { arr.add(writeInput(it)) }
        }
        writeBody(spec.request.body)?.let { req.set<JsonNode>("body", it) }
        if (spec.request.headers.isNotEmpty()) req.set<JsonNode>("headers", strings(spec.request.headers))
        if (spec.request.query.isNotEmpty()) req.set<JsonNode>("query", strings(spec.request.query))

        root.set<JsonNode>("auth", writeAuth(spec.auth))
        writeResponse(spec.response)?.let { root.set<JsonNode>("response", it) }
        writePagination(spec.pagination)?.let { root.set<JsonNode>("pagination", it) }
        spec.timeoutMs?.let { root.put("timeoutMs", it) }
        root.set<JsonNode>("retry", writeRetry(spec.retry))
        if (spec.idempotency != HttpToolSpec.IdempotencySpec()) {
            val i = root.putObject("idempotency")
            i.put("mode", spec.idempotency.mode.name.lowercase())
            i.put("header", spec.idempotency.header)
        }
        if (!spec.transport.isDefault || spec.transport.hostHeader != null) {
            root.set<JsonNode>("transport", writeTransport(spec.transport))
        }
        spec.async?.let { root.set<JsonNode>("async", writeAsync(it)) }
        return root
    }

    private fun writeInput(m: HttpToolSpec.InputMapping): ObjectNode {
        val o = mapper.createObjectNode()
        o.put("name", m.name)
        o.put("in", m.location.name.lowercase())
        if (m.wireName != m.name) o.put("wireName", m.wireName)
        if (m.required) o.put("required", true)
        o.put("type", m.type)
        m.description?.let { o.put("description", it) }
        m.default?.let { putScalar(o, "default", it) }
        m.constant?.let { putScalar(o, "constant", it) }
        if (m.enumValues.isNotEmpty()) o.putArray("enum").also { a -> m.enumValues.forEach { a.add(it) } }
        if (m.style != HttpToolSpec.InputMapping.Style.FORM) o.put("style", m.style.name.lowercase())
        if (!m.explode) o.put("explode", false)
        m.bodyPath?.let { o.put("bodyPath", it) }
        if (m.isFile) o.put("isFile", true)
        return o
    }

    private fun writeBody(b: HttpToolSpec.BodySpec): ObjectNode? = when (b) {
        is HttpToolSpec.BodySpec.None -> null
        is HttpToolSpec.BodySpec.Json -> mapper.createObjectNode().apply {
            put("encoding", "json"); put("contentType", b.contentType)
            b.template?.let { set<JsonNode>("template", it) }
        }

        is HttpToolSpec.BodySpec.Form -> mapper.createObjectNode().apply {
            put("encoding", "form"); put("contentType", b.contentType)
            put("bracketNesting", b.bracketNesting)
        }

        is HttpToolSpec.BodySpec.Multipart -> mapper.createObjectNode().apply {
            put("encoding", "multipart"); put("contentType", b.contentType)
        }

        is HttpToolSpec.BodySpec.Raw -> mapper.createObjectNode().apply {
            put("encoding", "raw"); put("contentType", b.contentType); put("template", b.template)
        }

        is HttpToolSpec.BodySpec.Passthrough -> mapper.createObjectNode().apply {
            put("encoding", "passthrough"); put("contentType", b.contentType)
            put("inputName", b.inputName)
        }
    }

    private fun writeAuth(a: HttpAuthSpec): ObjectNode {
        val o = mapper.createObjectNode()
        o.put("strategy", a.strategy)
        when (a) {
            is HttpAuthSpec.InheritConnection, is HttpAuthSpec.None -> Unit
            is HttpAuthSpec.ApiKeyHeader -> {
                o.put("header", a.header); o.put("prefix", a.prefix)
                o.put("secretField", a.secretField)
            }

            is HttpAuthSpec.ApiKeyQuery -> {
                o.put("param", a.param); o.put("secretField", a.secretField)
            }

            is HttpAuthSpec.Bearer -> {
                o.put("header", a.header); o.put("prefix", a.prefix)
                o.put("secretField", a.secretField)
            }

            is HttpAuthSpec.Basic -> {
                o.put("username", a.username)
                o.put("passwordSecretField", a.passwordSecretField)
                a.usernameSecretField?.let { o.put("usernameSecretField", it) }
                o.put("header", a.header)
            }

            is HttpAuthSpec.OAuth2ClientCredentials -> {
                o.put("tokenUrl", a.tokenUrl); o.put("clientId", a.clientId)
                o.put("clientSecretField", a.clientSecretField)
                if (a.scopes.isNotEmpty()) o.putArray("scopes").also { s -> a.scopes.forEach { s.add(it) } }
                a.audience?.let { o.put("audience", it) }
                o.put("clientAuth", if (a.clientAuth == HttpAuthSpec.OAuth2ClientCredentials.ClientAuth.BODY) "body" else "basic_header")
                o.put("header", a.header); o.put("prefix", a.prefix)
                o.put("expirySkewSeconds", a.expirySkewSeconds)
                if (a.extraParams.isNotEmpty()) o.set<JsonNode>("extraParams", strings(a.extraParams))
            }

            is HttpAuthSpec.OAuth2AuthorizationCode -> {
                o.put("tokenUrl", a.tokenUrl); o.put("clientId", a.clientId)
                o.put("clientSecretField", a.clientSecretField)
                o.put("accessTokenField", a.accessTokenField)
                o.put("refreshTokenField", a.refreshTokenField)
                o.put("expiresAtField", a.expiresAtField)
                if (a.scopes.isNotEmpty()) o.putArray("scopes").also { s -> a.scopes.forEach { s.add(it) } }
                o.put("clientAuth", if (a.clientAuth == HttpAuthSpec.OAuth2ClientCredentials.ClientAuth.BODY) "body" else "basic_header")
                o.put("header", a.header); o.put("prefix", a.prefix)
                o.put("expirySkewSeconds", a.expirySkewSeconds)
            }

            is HttpAuthSpec.Hmac -> {
                o.put("algorithm", a.algorithm); o.put("secretField", a.secretField)
                o.put("canonicalTemplate", a.canonicalTemplate)
                o.put("signatureHeader", a.signatureHeader)
                o.put("signaturePrefix", a.signaturePrefix)
                o.put("encoding", a.encoding.name.lowercase())
                a.timestampHeader?.let { o.put("timestampHeader", it) }
                o.put("timestampUnit", a.timestampUnit.name.lowercase())
                a.nonceHeader?.let { o.put("nonceHeader", it) }
                a.keyId?.let { o.put("keyId", it) }
                a.keyIdHeader?.let { o.put("keyIdHeader", it) }
            }

            is HttpAuthSpec.Custom -> {
                if (a.headers.isNotEmpty()) o.set<JsonNode>("headers", strings(a.headers))
                if (a.query.isNotEmpty()) o.set<JsonNode>("query", strings(a.query))
            }
        }
        return o
    }

    private fun writeResponse(r: HttpToolSpec.ResponseSpec): ObjectNode? {
        if (r == HttpToolSpec.ResponseSpec()) return null
        val o = mapper.createObjectNode()
        if (r.expectedStatus.isNotEmpty())
            o.putArray("expectedStatus").also { a -> r.expectedStatus.forEach { a.add(it) } }
        when (val e = r.extract) {
            is HttpToolSpec.Extraction.None -> Unit
            is HttpToolSpec.Extraction.JsonPath ->
                o.putObject("extract").put("engine", "jsonpath").put("expression", e.expression)

            is HttpToolSpec.Extraction.JmesPath ->
                o.putObject("extract").put("engine", "jmespath").put("expression", e.expression)
        }
        if (r.errors.isNotEmpty()) {
            val arr = o.putArray("errors")
            r.errors.forEach { e ->
                val eo = arr.addObject()
                e.status?.let { eo.put("status", it) }
                e.bodyContains?.let { eo.put("bodyContains", it) }
                e.whenBodyFalse?.let { eo.put("whenBodyFalse", it) }
                eo.put("kind", e.kind); eo.put("retryable", e.retryable)
                e.fix?.let { eo.put("fix", it) }
                e.messagePath?.let { eo.put("messagePath", it) }
            }
        }
        if (r.keepHeaders.isNotEmpty())
            o.putArray("keepHeaders").also { a -> r.keepHeaders.forEach { a.add(it) } }
        r.maxResponseBytes?.let { o.put("maxResponseBytes", it) }
        return o
    }

    private fun writePagination(p: HttpToolSpec.PaginationSpec): ObjectNode? {
        val o = mapper.createObjectNode()
        when (p) {
            is HttpToolSpec.PaginationSpec.None -> return null
            is HttpToolSpec.PaginationSpec.Cursor -> {
                o.put("strategy", "cursor")
                o.put("cursorParam", p.cursorParam)
                o.put("nextCursorPath", p.nextCursorPath)
                p.hasMorePath?.let { o.put("hasMorePath", it) }
                p.limitParam?.let { o.put("limitParam", it) }
                p.pageSize?.let { o.put("pageSize", it) }
            }

            is HttpToolSpec.PaginationSpec.Offset -> {
                o.put("strategy", if (p.pageMode) "page" else "offset")
                o.put("offsetParam", p.offsetParam)
                p.limitParam?.let { o.put("limitParam", it) }
                o.put("pageSize", p.pageSize)
                p.totalPath?.let { o.put("totalPath", it) }
            }

            is HttpToolSpec.PaginationSpec.LinkHeader -> {
                o.put("strategy", "link_header")
                o.put("relation", p.relation)
            }
        }
        p.itemsPath?.let { o.put("itemsPath", it) }
        o.put("maxPages", p.maxPages)
        o.put("maxItems", p.maxItems)
        return o
    }

    private fun writeRetry(r: HttpToolSpec.RetrySpec): ObjectNode {
        val o = mapper.createObjectNode()
        o.put("maxAttempts", r.maxAttempts)
        o.put("initialDelayMs", r.initialDelayMs)
        o.put("maxDelayMs", r.maxDelayMs)
        o.put("multiplier", r.multiplier)
        o.put("jitter", r.jitter.name.lowercase())
        if (r.retryOnStatus.isNotEmpty())
            o.putArray("retryOnStatus").also { a -> r.retryOnStatus.forEach { a.add(it) } }
        o.put("respectRetryAfter", r.respectRetryAfter)
        o.put("retryWrites", r.retryWrites)
        return o
    }

    private fun writeTransport(t: HttpToolSpec.TransportSpec): ObjectNode {
        val o = mapper.createObjectNode()
        t.mtls?.let { m ->
            o.putObject("mtls").apply {
                put("clientCertSecretRef", m.clientCertSecretRef)
                put("clientKeySecretRef", m.clientKeySecretRef)
                m.keyPassphraseSecretRef?.let { put("keyPassphraseSecretRef", it) }
            }
        }
        t.caBundlePem?.let { o.put("caBundlePem", it) }
        t.proxy?.let { p ->
            o.putObject("proxy").apply {
                put("host", p.host); put("port", p.port); put("scheme", p.scheme)
                p.credentialSecretRef?.let { put("credentialSecretRef", it) }
            }
        }
        t.sni?.let { o.put("sni", it) }
        t.hostHeader?.let { o.put("hostHeader", it) }
        if (t.tlsProtocols.isNotEmpty())
            o.putArray("tlsProtocols").also { a -> t.tlsProtocols.forEach { a.add(it) } }
        return o
    }

    private fun writeAsync(a: HttpToolSpec.AsyncSpec): ObjectNode {
        val o = mapper.createObjectNode()
        o.put("handlePath", a.handlePath)
        a.timeoutMs?.let { o.put("timeoutMs", it) }
        a.poll?.let { p ->
            o.putObject("poll").apply {
                put("url", p.url); put("method", p.method)
                put("intervalMs", p.intervalMs); put("maxAttempts", p.maxAttempts)
                put("statusPath", p.statusPath)
                putArray("completedValues").also { arr -> p.completedValues.forEach { arr.add(it) } }
                putArray("failedValues").also { arr -> p.failedValues.forEach { arr.add(it) } }
                p.resultPath?.let { put("resultPath", it) }
                p.errorPath?.let { put("errorPath", it) }
            }
        }
        a.callback?.let { c ->
            o.putObject("callback").apply {
                put("urlInput", c.urlInput)
                c.statusPath?.let { put("statusPath", it) }
                putArray("completedValues").also { arr -> c.completedValues.forEach { arr.add(it) } }
                putArray("failedValues").also { arr -> c.failedValues.forEach { arr.add(it) } }
                c.resultPath?.let { put("resultPath", it) }
                c.errorPath?.let { put("errorPath", it) }
                c.signatureSecretRef?.let { put("signatureSecretRef", it) }
                c.signatureHeader?.let { put("signatureHeader", it) }
            }
        }
        return o
    }

    private fun strings(m: Map<String, String>): ObjectNode {
        val o = mapper.createObjectNode()
        m.forEach { (k, v) -> o.put(k, v) }
        return o
    }

    private fun putScalar(o: ObjectNode, field: String, v: Any) {
        when (v) {
            is Boolean -> o.put(field, v)
            is Int -> o.put(field, v)
            is Long -> o.put(field, v)
            is Double -> o.put(field, v)
            is JsonNode -> o.set<JsonNode>(field, v)
            else -> o.put(field, v.toString())
        }
    }

    /** Platform ceilings. A tool may ask for less; it may not ask for more. */
    private const val HARD_MAX_PAGES = 50
    private const val HARD_MAX_ITEMS = 5_000
}
