package com.vectorbea.telemetry.security

/**
 * Redacts secrets and sensitive values from analytics event properties.
 * Telemetry must never contain secrets, credentials, or raw prompts.
 */
object Redactor {
    private val SENSITIVE_KEYS = setOf(
        "password", "passwd", "secret", "token", "api_key", "apikey",
        "authorization", "auth", "credential", "private_key", "privatekey",
        "connection_string", "connectionstring", "database_url", "databaseurl",
        "redis_url", "redisurl", "cookie", "session", "bearer",
        "access_token", "refresh_token", "client_secret",
        "prompt", "raw_prompt", "llm_output", "raw_output",
    )

    private val SENSITIVE_PATTERNS = listOf(
        Regex("Bearer\\s+[A-Za-z0-9\\-._~+/]+=*", RegexOption.IGNORE_CASE),
        Regex("(sk|pk|rk|ak)-[A-Za-z0-9]{20,}"),
        Regex("postgres(?:ql)?://[^\\s\"']+", RegexOption.IGNORE_CASE),
        Regex("redis://[^\\s\"']+", RegexOption.IGNORE_CASE),
        Regex("mysql://[^\\s\"']+", RegexOption.IGNORE_CASE),
    )

    /** Redact a map of properties — returns a sanitized copy. */
    fun redact(props: Map<String, Any?>): Map<String, Any?> =
        props.mapValues { (key, value) ->
            if (isSensitiveKey(key)) "[REDACTED]"
            else sanitizeValue(value)
        }

    private fun isSensitiveKey(key: String): Boolean =
        SENSITIVE_KEYS.any { key.lowercase().contains(it) }

    private fun sanitizeValue(value: Any?): Any? = when (value) {
        null -> null
        is String -> redactString(value)
        is Map<*, *> -> @Suppress("UNCHECKED_CAST") redact(value as Map<String, Any?>)
        is List<*> -> value.take(20).map { sanitizeValue(it) }
        is Number, is Boolean -> value
        else -> value.toString().let { redactString(it) }
    }

    private fun redactString(s: String): String {
        var result = s
        for (pattern in SENSITIVE_PATTERNS) {
            result = pattern.replace(result, "[REDACTED]")
        }
        return result
    }

    /** Enforce max payload size — truncates oversized strings. */
    fun enforceSize(props: Map<String, Any?>, maxBytes: Int): Map<String, Any?> {
        val json = com.vectorbea.telemetry.http.mapper.writeValueAsString(props)
        if (json.toByteArray().size <= maxBytes) return props
        // If oversized, keep only string values truncated to 256 chars
        return props.mapValues { (_, v) ->
            when (v) {
                is String -> v.take(256)
                is Map<*, *> -> "[truncated]"
                is List<*> -> "[truncated]"
                else -> v
            }
        }
    }
}
