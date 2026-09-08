package com.vectorbea.worker.tools.http

import com.fasterxml.jackson.databind.ObjectMapper
import java.util.Base64

/**
 * Every secret value in play for one tool call, and the guarantee that none of
 * them leaves it.
 *
 * ── THE THREAT IS NOT MALICE, IT IS CONVENIENCE ─────────────────────────────
 * No one writes `log.info(apiKey)`. What happens is that somebody adds a
 * diagnostic — "log the request that failed" — and the request contains a
 * header, and the header contains the key. The old executor had three such
 * places and one of them was live: `resolvedInputs` were logged wholesale as
 * "resolved body" at INFO on every call. A credential passed as a workflow input
 * was in the log, forever, and nothing in the code looked wrong.
 *
 * The defence cannot be "remember not to". It has to be a thing that is true of
 * the strings themselves. So:
 *
 *   1. Every secret this call resolves is registered here, ONCE, at the moment
 *      it is decrypted.
 *   2. [scrub] replaces any registered value — and its base64, URL-encoded and
 *      basic-auth forms, because those are what actually appear on a wire — with
 *      a fixed marker.
 *   3. Everything the resolver emits to an event, a span, a log line or a node
 *      result goes through [scrub] on the way out. Not the values it believes
 *      are risky; everything.
 *
 * Point 3 is the one that matters. A redactor applied where a leak is expected
 * only ever catches leaks that were expected.
 *
 * ── AND A HEADER ALLOW-LIST, BECAUSE SCRUBBING IS THE SECOND LINE ───────────
 * A short secret ("1234") would make [scrub] destroy unrelated text, so scrubbing
 * alone is not a strategy. The first line is that request headers, query strings
 * and bodies are never put into an observation at all — the resolver reports
 * method, host, path template, status and duration, and those are constructed
 * from the SPEC rather than from the request. [scrub] is what catches the case
 * where somebody later adds a field to that list.
 *
 * ── LIFETIME ────────────────────────────────────────────────────────────────
 * Scoped to one tool call and discarded with it. Values arrive from
 * `SecretValue.useOnce`, which zeroes its own backing array; this holds the
 * String that block produced, for as long as the call needs it, and drops the
 * reference at [close]. There is no way to hold a plaintext credential in the
 * JVM without it being a String at some point — what is controllable is how
 * many places hold one, and this is intended to be the only one.
 */
class SecretScope : AutoCloseable {

    /** What a redacted value is replaced with. Deliberately unmistakable. */
    companion object {
        const val MARKER = "[REDACTED]"

        /**
         * Shorter than this and a value is not registered for scrubbing.
         *
         * A three-character secret scrubbed everywhere would corrupt every
         * message containing those three characters, which is a worse outcome
         * than the one it prevents — and a three-character secret has already
         * lost. Real credentials are far longer; the shortest in common use
         * (a six-digit TOTP) is not something this layer ever holds.
         */
        const val MIN_SCRUBBABLE_LENGTH = 8

        private val MAPPER = ObjectMapper()

        /**
         * Read a connection secret into named fields.
         *
         * A connection's stored secret is EITHER a bare string — which every
         * connection created before this work is — or a JSON object of named
         * credentials. Both are presented the same way so a strategy can name
         * `secret.clientSecret` without every caller branching: the bare form is
         * exposed as the single field `value`.
         *
         * A JSON document that is not an object (a bare number, an array, a
         * quoted string) is treated as bare text. A credential that happens to
         * parse as JSON — some are base64 that decodes to digits — must not be
         * silently reinterpreted.
         */
        fun bundleOf(raw: String): Map<String, String> {
            val trimmed = raw.trim()
            if (!trimmed.startsWith("{")) return mapOf(HttpAuthDefaults.BARE_FIELD to raw)
            return try {
                val node = MAPPER.readTree(trimmed)
                if (!node.isObject) return mapOf(HttpAuthDefaults.BARE_FIELD to raw)
                val out = LinkedHashMap<String, String>()
                node.fields().forEach { (k, v) ->
                    if (!v.isNull && !v.isContainerNode) out[k] = v.asText()
                }
                /*
                 * The bare field is populated too, from the most likely candidate.
                 * A bundle written by the OAuth flow has `accessToken` and no
                 * `value`, and a spec that never named a field would otherwise
                 * resolve to nothing and send no credential at all — a 401 whose
                 * cause is three layers away from its message.
                 */
                if (!out.containsKey(HttpAuthDefaults.BARE_FIELD)) {
                    val fallback = out["apiKey"] ?: out["accessToken"] ?: out["token"]
                        ?: out["key"] ?: out.values.firstOrNull()
                    if (fallback != null) out[HttpAuthDefaults.BARE_FIELD] = fallback
                }
                if (out.isEmpty()) mapOf(HttpAuthDefaults.BARE_FIELD to raw) else out
            } catch (_: Exception) {
                mapOf(HttpAuthDefaults.BARE_FIELD to raw)
            }
        }
    }

    private val values = LinkedHashSet<String>()

    /** Derived encodings of registered values — what actually appears on a wire. */
    private val encoded = LinkedHashSet<String>()

    @Volatile
    private var closed = false

    /**
     * Register a plaintext credential, and return it.
     *
     * Returns the value so a call site reads
     * `header(name, scope.protect(token))` — the registration cannot be
     * forgotten separately from the use, because it IS the use.
     */
    fun protect(value: String?): String {
        if (value.isNullOrEmpty()) return value ?: ""
        if (value.length >= MIN_SCRUBBABLE_LENGTH) {
            synchronized(values) {
                if (values.add(value)) {
                    /*
                     * A credential rarely appears verbatim. It appears base64'd
                     * inside a Basic header, percent-encoded inside a query
                     * string, and — for the api-key-in-query strategy — both.
                     * Registering the forms means a leak through any of those
                     * three paths is caught by the same scrub.
                     */
                    encoded += Base64.getEncoder().encodeToString(value.toByteArray())
                    encoded += Base64.getUrlEncoder().withoutPadding()
                        .encodeToString(value.toByteArray())
                    encoded += java.net.URLEncoder.encode(value, Charsets.UTF_8)
                }
            }
        }
        return value
    }

    /** Register the `user:password` pair a Basic header will carry. */
    fun protectBasicPair(username: String, password: String): String {
        val joined = "$username:$password"
        protect(password)
        val b64 = Base64.getEncoder().encodeToString(joined.toByteArray())
        synchronized(values) { encoded += b64 }
        return b64
    }

    /**
     * Replace every registered secret in [text] with [MARKER].
     *
     * Total by contract: never throws, and returns [text] unchanged when nothing
     * is registered. It is on the emit path of every event and span this
     * resolver writes, so a failure here would take down a tool call that
     * succeeded.
     */
    fun scrub(text: String?): String? {
        if (text.isNullOrEmpty() || closed) return text
        val snapshot = synchronized(values) { values.toList() to encoded.toList() }
        var out: String = text
        for (v in snapshot.first) if (v.isNotEmpty() && out.contains(v)) out = out.replace(v, MARKER)
        for (v in snapshot.second) if (v.length >= MIN_SCRUBBABLE_LENGTH && out.contains(v))
            out = out.replace(v, MARKER)
        return out
    }

    /** True when [text] still contains a registered secret. For assertions. */
    fun leaks(text: String?): Boolean {
        if (text.isNullOrEmpty()) return false
        val snapshot = synchronized(values) { values.toList() to encoded.toList() }
        return snapshot.first.any { it.isNotEmpty() && text.contains(it) } ||
            snapshot.second.any { it.length >= MIN_SCRUBBABLE_LENGTH && text.contains(it) }
    }

    /** How many distinct credentials this call touched. Safe to log. */
    fun size(): Int = synchronized(values) { values.size }

    override fun close() {
        closed = true
        synchronized(values) { values.clear(); encoded.clear() }
    }
}

/** Names shared between the spec model and the secret bundle reader. */
internal object HttpAuthDefaults {
    const val BARE_FIELD = "value"
}
