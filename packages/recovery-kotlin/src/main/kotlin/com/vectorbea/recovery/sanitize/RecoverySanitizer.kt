package com.vectorbea.recovery.sanitize

object RecoverySanitizer {
    private val SECRET_PATTERNS = listOf(
        Regex("""(?i)(authorization:\s*bearer\s+)\S+""") to "$1[REDACTED]",
        Regex("""(?i)(authorization:\s*basic\s+)\S+""") to "$1[REDACTED]",
        Regex("""(?i)(api[-_]?key['":\s=]+)[A-Za-z0-9+/\-_]{20,}""") to "$1[REDACTED]",
        Regex("""(?i)(password['":\s=]+)[^\s,'"]{4,}""") to "$1[REDACTED]",
        Regex("""(?i)(secret['":\s=]+)[^\s,'"]{8,}""") to "$1[REDACTED]",
        Regex("""postgresql://[^@]+@""") to "postgresql://[REDACTED]@",
        Regex("""mysql://[^@]+@""") to "mysql://[REDACTED]@",
        Regex("""mongodb(\+srv)?://[^@]+@""") to "mongodb://[REDACTED]@",
        Regex("""(?i)(bearer\s+)[A-Za-z0-9\-_=]{20,}""") to "$1[REDACTED]",
        Regex("""sk-[A-Za-z0-9]{20,}""") to "[REDACTED-API-KEY]",
        Regex("""eyJ[A-Za-z0-9\-_=]{50,}""") to "[REDACTED-JWT]",
        Regex("""(?i)(cookie:\s*)[^\r\n]+""") to "$1[REDACTED]",
    )
    private const val MAX_MESSAGE_LEN = 2000
    private const val MAX_LOG_LINES = 20
    private const val MAX_LOG_LINE_LEN = 500
    private const val MAX_METADATA_ENTRIES = 50

    fun sanitizeMessage(raw: String?): String? {
        if (raw == null) return null
        var s = raw.take(MAX_MESSAGE_LEN)
        SECRET_PATTERNS.forEach { (regex, replacement) -> s = regex.replace(s, replacement) }
        return s
    }

    fun sanitizeLogs(lines: List<String>): List<String> =
        lines.take(MAX_LOG_LINES).map { line ->
            var s = line.take(MAX_LOG_LINE_LEN)
            SECRET_PATTERNS.forEach { (regex, replacement) -> s = regex.replace(s, replacement) }
            s
        }

    fun sanitizeMetadata(meta: Map<String, Any?>): Map<String, Any?> =
        meta.entries.take(MAX_METADATA_ENTRIES).associate { (k, v) ->
            val sk = SECRET_PATTERNS.fold(k) { acc, (regex, r) -> regex.replace(acc, r) }
            val sv: Any? = when (v) {
                is String -> sanitizeMessage(v)
                else -> v
            }
            sk to sv
        }

    /**
     * What one pattern masked, so a reader sees a marker rather than a gap.
     */
    data class Redaction(val label: String, val count: Int)

    /** Redacted text plus the record of what was taken out of it. */
    data class RedactedPayload(val text: String, val redactions: List<Redaction>)

    /**
     * Human labels for [SECRET_PATTERNS], positionally aligned.
     *
     * The patterns themselves are the wrong thing to show a user — a regex in a
     * trace viewer explains nothing. These are what `redactions` records, and what
     * the reader sees as "[redacted: connection secret]".
     */
    private val PATTERN_LABELS = listOf(
        "bearer token", "basic auth", "api key", "password", "secret",
        "connection secret", "connection secret", "connection secret",
        "bearer token", "api key", "jwt", "cookie",
    )

    /**
     * Redact a payload WITHOUT truncating it.
     *
     * [sanitizeMessage] caps at 2000 characters because it produces a one-line
     * message for an incident record. A stored payload is a different thing: it is
     * the artefact a debugger renders and a resumed loop reads back, and silently
     * losing its tail would make both wrong. Length is the caller's decision — the
     * payload store applies its own cap and flags it — so this only redacts.
     *
     * Returns what it masked, because a redaction the reader cannot see is
     * indistinguishable from data that was never there.
     */
    fun redactForPayload(raw: String): RedactedPayload {
        var s = raw
        val found = mutableListOf<Redaction>()
        SECRET_PATTERNS.forEachIndexed { i, (regex, replacement) ->
            val hits = regex.findAll(s).count()
            if (hits > 0) {
                s = regex.replace(s, replacement)
                val label = PATTERN_LABELS.getOrElse(i) { "secret" }
                /* Patterns collapse onto shared labels - three connection-string
                   forms are one idea to a reader - so merge rather than listing
                   "connection secret" three times. */
                val at = found.indexOfFirst { it.label == label }
                if (at >= 0) found[at] = found[at].copy(count = found[at].count + hits)
                else found.add(Redaction(label, hits))
            }
        }
        return RedactedPayload(s, found)
    }

    fun containsSecret(text: String): Boolean =
        SECRET_PATTERNS.any { (regex, _) -> regex.containsMatchIn(text) }
}
