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

    fun containsSecret(text: String): Boolean =
        SECRET_PATTERNS.any { (regex, _) -> regex.containsMatchIn(text) }
}
