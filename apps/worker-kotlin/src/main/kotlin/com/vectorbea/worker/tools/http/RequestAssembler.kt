package com.vectorbea.worker.tools.http

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import com.vectorbea.worker.tools.httpspec.HttpToolSpec
import com.vectorbea.worker.tools.httpspec.HttpToolSpec.InputMapping.Location
import java.net.URLEncoder
import java.security.SecureRandom
import java.util.Base64

/**
 * Turns a [HttpToolSpec] plus the model's arguments into a request that can be
 * sent — items 1 and 2 of the brief, which are one problem.
 *
 * ── ONE PASS OVER THE DECLARED INPUTS, FOUR DESTINATIONS ────────────────────
 * Every input names where it lands, so assembly is a single walk with four
 * accumulators rather than four separate readings of the argument map. That
 * matters for a property that is otherwise hard to hold: an argument the model
 * supplied which is NOT a declared input never reaches the wire at all. The old
 * resolver passed `resolvedInputs` through as the body wholesale, so anything in
 * scope was sent — including, on a workflow that passed credentials as inputs, a
 * credential.
 *
 * ── ENCODING IS PER-DESTINATION AND HAPPENS HERE ────────────────────────────
 * A path segment is percent-encoded with `%20` for space; a query value is form
 * encoded with `+`; a header value is checked for CR/LF rather than encoded,
 * because there is no encoding for a newline in a header — there is only
 * rejecting it, and accepting it is request splitting.
 */
internal object RequestAssembler {

    private val mapper = ObjectMapper()
    private val random = SecureRandom()

    /** A request, fully built, with nothing left to interpret. */
    data class Prepared(
        val url: String,
        /** For logging and events: the URL with query and userinfo removed. */
        val safeUrl: String,
        val method: String,
        val headers: List<Pair<String, String>>,
        val body: ByteArray?,
        val contentType: String?,
        /** SHA-256 of the body, for HMAC canonical strings. Empty body hashes too. */
        val bodySha256: ByteArray,
        val queryString: String,
        val path: String,
    ) {
        override fun equals(other: Any?) = this === other
        override fun hashCode() = System.identityHashCode(this)
    }

    /** The spec asked for something the arguments cannot satisfy. */
    class AssemblyException(message: String) : Exception(message)

    /**
     * Build the request.
     *
     * [args] are the model's arguments, already validated against the input
     * schema by the caller. [extraQuery] carries the paginator's cursor or offset
     * for pages after the first — passed in rather than mutated into [args] so
     * that the argument map the model supplied stays the thing it supplied.
     */
    fun assemble(
        spec: HttpToolSpec,
        baseUrl: String?,
        args: Map<String, Any?>,
        extraQuery: Map<String, String> = emptyMap(),
    ): Prepared {
        val req = spec.request

        // ── Resolve every declared input to a value, once ─────────────────────
        val resolved = LinkedHashMap<HttpToolSpec.InputMapping, Any?>()
        for (input in req.inputs) {
            val value = when {
                /* A bound input wins over anything the model sent, always. That is
                   the whole security value of binding: a tool scoped to one
                   organisation cannot be talked out of it by an argument. */
                input.constant != null -> input.constant
                args.containsKey(input.name) && args[input.name] != null -> args[input.name]
                input.default != null -> input.default
                else -> null
            }
            if (value == null) {
                if (input.required) throw AssemblyException(
                    "'${input.name}' is required and was not supplied. It goes in the " +
                        "${input.location.name.lowercase()} as '${input.wireName}'."
                )
                continue
            }
            resolved[input] = value
        }

        // ── Path ──────────────────────────────────────────────────────────────
        val pathBindings = resolved.entries
            .filter { it.key.location == Location.PATH }
            .associate { it.key.wireName to it.value }

        val renderedPath = try {
            SpecTemplate.render(req.path, pathBindings, encode = ::encodePathSegment)
        } catch (e: SpecTemplate.MissingBinding) {
            throw AssemblyException(
                "The URL needs a value for '${e.name}' and no input supplies one. " +
                    "Add an input mapped to the path with wire name '${e.name}'."
            )
        }

        val url = joinUrl(req.baseUrl ?: baseUrl, renderedPath)

        // ── Query ─────────────────────────────────────────────────────────────
        val query = ArrayList<Pair<String, String>>()
        req.query.forEach { (k, v) ->
            query += k to SpecTemplate.render(v, args, encode = { it }, strict = false)
        }
        resolved.entries.filter { it.key.location == Location.QUERY }
            .forEach { (input, value) -> query += serialiseMulti(input, value) }
        extraQuery.forEach { (k, v) -> query += k to v }

        // ── Headers ───────────────────────────────────────────────────────────
        val headers = ArrayList<Pair<String, String>>()
        req.headers.forEach { (k, v) ->
            headers += k to headerSafe(k, SpecTemplate.render(v, args, strict = false))
        }
        resolved.entries.filter { it.key.location == Location.HEADER }
            .forEach { (input, value) ->
                serialiseMulti(input, value).forEach { (k, v) -> headers += k to headerSafe(k, v) }
            }

        // ── Cookies ───────────────────────────────────────────────────────────
        val cookies = resolved.entries.filter { it.key.location == Location.COOKIE }
            .flatMap { (input, value) -> serialiseMulti(input, value) }
        if (cookies.isNotEmpty()) {
            headers += "Cookie" to cookies.joinToString("; ") { (k, v) ->
                "$k=${encodeQuery(v)}"
            }
        }

        // ── Body ──────────────────────────────────────────────────────────────
        val bodyInputs = resolved.entries.filter { it.key.location == Location.BODY }
            .associate { it.key to it.value }
        val (bytes, contentType) = buildBody(req.body, bodyInputs, args)

        val queryString = query.joinToString("&") { (k, v) -> "${encodeQuery(k)}=${encodeQuery(v)}" }
        val fullUrl = if (queryString.isEmpty()) url else "$url?$queryString"

        return Prepared(
            url = fullUrl,
            safeUrl = url,
            method = req.methodUpper,
            headers = headers,
            body = bytes,
            contentType = contentType,
            bodySha256 = sha256(bytes ?: ByteArray(0)),
            queryString = queryString,
            path = pathOf(url),
        )
    }

    // ── Body encodings ───────────────────────────────────────────────────────

    private fun buildBody(
        body: HttpToolSpec.BodySpec,
        inputs: Map<HttpToolSpec.InputMapping, Any?>,
        args: Map<String, Any?>,
    ): Pair<ByteArray?, String?> = when (body) {
        is HttpToolSpec.BodySpec.None -> null to null

        is HttpToolSpec.BodySpec.Json -> {
            val node: JsonNode = if (body.template != null) {
                try {
                    SpecTemplate.renderJson(body.template, args, strict = false)
                } catch (e: SpecTemplate.MissingBinding) {
                    throw AssemblyException("The body template needs a value for '${e.name}'.")
                }
            } else {
                assembleJsonBody(inputs)
            }
            mapper.writeValueAsBytes(node) to body.contentType
        }

        is HttpToolSpec.BodySpec.Form -> {
            val pairs = ArrayList<Pair<String, String>>()
            inputs.forEach { (input, value) ->
                if (body.bracketNesting) {
                    flattenBrackets(input.effectiveBodyPath, value, pairs)
                } else {
                    pairs += serialiseMulti(input, value)
                }
            }
            pairs.joinToString("&") { (k, v) -> "${encodeQuery(k)}=${encodeQuery(v)}" }
                .toByteArray() to body.contentType
        }

        is HttpToolSpec.BodySpec.Multipart -> {
            val boundary = "----vectorbea" + java.lang.Long.toHexString(random.nextLong())
            multipart(inputs, boundary) to "${body.contentType.substringBefore(';')}; boundary=$boundary"
        }

        is HttpToolSpec.BodySpec.Raw -> {
            val text = try {
                SpecTemplate.render(body.template, args, strict = false)
            } catch (e: SpecTemplate.MissingBinding) {
                throw AssemblyException("The body template needs a value for '${e.name}'.")
            }
            text.toByteArray() to body.contentType
        }

        is HttpToolSpec.BodySpec.Passthrough -> {
            val v = args[body.inputName]
                ?: throw AssemblyException(
                    "'${body.inputName}' is the request body and was not supplied."
                )
            val bytes = when (v) {
                is ByteArray -> v
                is String -> v.toByteArray()
                else -> mapper.writeValueAsBytes(v)
            }
            bytes to body.contentType
        }
    }

    /**
     * Build a JSON body from the declared body inputs and their [bodyPath].
     *
     * `customer.address.line1` creates the nesting. This is what removes the
     * need for a hand-written template in the common case, and it is why an
     * OpenAPI import can produce a working POST without anybody editing JSON:
     * the importer walks the request schema and emits one input per leaf with
     * its dotted path already set.
     */
    private fun assembleJsonBody(inputs: Map<HttpToolSpec.InputMapping, Any?>): ObjectNode {
        val root = mapper.createObjectNode()
        inputs.forEach { (input, value) ->
            val segments = input.effectiveBodyPath.split('.').filter { it.isNotEmpty() }
            if (segments.isEmpty()) return@forEach
            var cur: ObjectNode = root
            for (i in 0 until segments.size - 1) {
                val seg = segments[i]
                cur = (cur.get(seg) as? ObjectNode) ?: cur.putObject(seg)
            }
            cur.set<JsonNode>(segments.last(), SpecTemplate.valueNode(coerce(input.type, value)))
        }
        return root
    }

    /**
     * Stripe's bracket form: `metadata[order_id]=42`, `items[0][price]=p_1`.
     *
     * Not a nicety — it is the only way to express a nested object in a
     * form-encoded body, and form-encoded is what Stripe, and a long tail of APIs
     * that predate JSON bodies, accept. Without it the entire category was
     * limited to flat key/value pairs.
     */
    private fun flattenBrackets(prefix: String, value: Any?, out: MutableList<Pair<String, String>>) {
        when (value) {
            null -> Unit
            is Map<*, *> -> value.forEach { (k, v) -> flattenBrackets("$prefix[$k]", v, out) }
            is Iterable<*> -> value.forEachIndexed { i, v -> flattenBrackets("$prefix[$i]", v, out) }
            is JsonNode -> when {
                value.isObject -> value.fields().forEach { (k, v) -> flattenBrackets("$prefix[$k]", v, out) }
                value.isArray -> value.forEachIndexed { i, v -> flattenBrackets("$prefix[$i]", v, out) }
                value.isNull -> Unit
                else -> out += prefix to value.asText()
            }

            else -> out += prefix to SpecTemplate.stringify(value)
        }
    }

    private fun multipart(
        inputs: Map<HttpToolSpec.InputMapping, Any?>,
        boundary: String,
    ): ByteArray {
        val out = java.io.ByteArrayOutputStream()
        fun write(s: String) = out.write(s.toByteArray())

        inputs.forEach { (input, value) ->
            write("--$boundary\r\n")
            if (input.isFile) {
                /*
                 * A file part is `{filename, contentType, content}` — the shape the
                 * model is shown, and the shape the importer generates for an
                 * OpenAPI `type: string, format: binary` property. `content` is
                 * base64 when it is bytes and plain when it is text; both are
                 * accepted, because a model asked to upload a CSV will send text
                 * and a model asked to upload a PNG cannot.
                 */
                val f = asMap(value)
                val filename = f["filename"]?.toString() ?: input.wireName
                val ct = f["contentType"]?.toString() ?: "application/octet-stream"
                val content = f["content"]
                write(
                    "Content-Disposition: form-data; name=\"${input.wireName}\"; " +
                        "filename=\"${filename.replace("\"", "")}\"\r\n"
                )
                write("Content-Type: $ct\r\n\r\n")
                out.write(decodeContent(content))
            } else {
                write("Content-Disposition: form-data; name=\"${input.wireName}\"\r\n\r\n")
                write(SpecTemplate.stringify(coerce(input.type, value)))
            }
            write("\r\n")
        }
        write("--$boundary--\r\n")
        return out.toByteArray()
    }

    private fun decodeContent(content: Any?): ByteArray = when (content) {
        null -> ByteArray(0)
        is ByteArray -> content
        is String -> runCatching { Base64.getDecoder().decode(content) }
            .getOrElse { content.toByteArray() }

        else -> SpecTemplate.stringify(content).toByteArray()
    }

    @Suppress("UNCHECKED_CAST")
    private fun asMap(v: Any?): Map<String, Any?> = when (v) {
        is Map<*, *> -> v as Map<String, Any?>
        is JsonNode -> if (v.isObject) v.fields().asSequence()
            .associate { (k, n) -> k to (if (n.isTextual) n.asText() else n) } else emptyMap()

        else -> emptyMap()
    }

    // ── Value serialisation ──────────────────────────────────────────────────

    /**
     * One input to zero or more wire pairs, honouring `style` and `explode`.
     *
     * OpenAPI's own rules, because those are what an imported spec declares and
     * what the target service implements. `explode = true` sends `tags=a&tags=b`;
     * `explode = false` sends `tags=a,b`; `spaceDelimited` and `pipeDelimited`
     * change the separator. Getting this wrong produces a request the service
     * accepts and misreads — a filter that silently matches nothing.
     */
    private fun serialiseMulti(
        input: HttpToolSpec.InputMapping,
        value: Any?,
    ): List<Pair<String, String>> {
        val name = input.wireName
        val items = toList(value)
        if (items == null) {
            /* DEEP_OBJECT: `filter[status]=open`, for an object-valued parameter. */
            if (input.style == HttpToolSpec.InputMapping.Style.DEEP_OBJECT) {
                val pairs = ArrayList<Pair<String, String>>()
                flattenBrackets(name, value, pairs)
                if (pairs.isNotEmpty()) return pairs
            }
            return listOf(name to SpecTemplate.stringify(coerce(input.type, value)))
        }
        if (items.isEmpty()) return emptyList()
        if (input.explode && input.style == HttpToolSpec.InputMapping.Style.FORM) {
            return items.map { name to SpecTemplate.stringify(it) }
        }
        val sep = when (input.style) {
            HttpToolSpec.InputMapping.Style.SPACE_DELIMITED -> " "
            HttpToolSpec.InputMapping.Style.PIPE_DELIMITED -> "|"
            else -> ","
        }
        return listOf(name to items.joinToString(sep) { SpecTemplate.stringify(it) })
    }

    private fun toList(v: Any?): List<Any?>? = when (v) {
        is Iterable<*> -> v.toList()
        is Array<*> -> v.toList()
        is JsonNode -> if (v.isArray) v.toList() else null
        else -> null
    }

    /**
     * Coerce to the declared type before it goes on the wire.
     *
     * A model returns `"3"` for an integer parameter about as often as it returns
     * `3`, and an API that validates its schema rejects the first. Coercing where
     * the type is DECLARED is cheap and removes a whole class of "the agent keeps
     * retrying with the same argument" loops. A value that cannot be coerced is
     * passed through unchanged so the service's own error message survives — a
     * local guess about what went wrong is worse than the vendor's.
     */
    private fun coerce(type: String, value: Any?): Any? = when (type.lowercase()) {
        "integer" -> (value as? Number)?.toLong() ?: (value as? String)?.toLongOrNull() ?: value
        "number" -> (value as? Number)?.toDouble() ?: (value as? String)?.toDoubleOrNull() ?: value
        "boolean" -> (value as? Boolean) ?: (value as? String)?.lowercase()?.let {
            when (it) {
                "true" -> true; "false" -> false; else -> null
            }
        } ?: value

        else -> value
    }

    // ── Encoding ─────────────────────────────────────────────────────────────

    /**
     * Percent-encode one path segment.
     *
     * `URLEncoder` is a FORM encoder: it writes a space as `+`, which inside a
     * path is a literal plus. `/` is encoded too — a value containing a slash
     * must not become two path segments, which is how "read issue 1/2" becomes a
     * request to a different endpoint entirely.
     */
    fun encodePathSegment(raw: String): String =
        URLEncoder.encode(raw, Charsets.UTF_8)
            .replace("+", "%20")
            .replace("*", "%2A")
            .replace("%7E", "~")

    fun encodeQuery(raw: String): String = URLEncoder.encode(raw, Charsets.UTF_8)

    /**
     * A header value with no CR or LF in it.
     *
     * There is no encoding that makes a newline safe in a header — the only
     * options are rejecting it and splitting the request. A model-supplied header
     * value is exactly where this arrives.
     */
    private fun headerSafe(name: String, value: String): String {
        if (value.contains('\r') || value.contains('\n')) {
            throw AssemblyException(
                "The value for header '$name' contains a line break, which cannot be sent. " +
                    "Remove the newline from the input."
            )
        }
        return value
    }

    fun joinUrl(base: String?, path: String): String {
        if (path.startsWith("http://") || path.startsWith("https://")) return path
        val b = base?.trimEnd('/')
            ?: throw AssemblyException(
                "This tool has a relative path ('$path') and its connection has no base URL. " +
                    "Set a base URL on the connection, or make the tool's path absolute."
            )
        if (path.isEmpty()) return b
        return "$b/${path.trimStart('/')}"
    }

    private fun pathOf(url: String): String =
        runCatching { java.net.URI(url).path ?: "/" }.getOrDefault("/")

    private fun sha256(bytes: ByteArray): ByteArray =
        java.security.MessageDigest.getInstance("SHA-256").digest(bytes)
}
