package com.vectorbea.api.security

import java.net.URI

/**
 * Redacts secrets from strings, maps, JSON, headers, and connection strings.
 *
 * DESIGN RULES:
 * - Redaction is one-way (lossy by design). Do NOT try to recover originals.
 * - Replacement token is [REDACTED] — unambiguous and grep-friendly.
 * - Patterns are conservative: prefer over-redacting to under-redacting.
 * - Never include partial secret fragments in the replacement (no "sk-...XXXX").
 *
 * Use in:
 * - Log messages involving any user-supplied config or connection data
 * - Error messages returned from connection tests
 * - Any map/JSON before writing to run_events (sanitized fields)
 */
object Redactor {

    const val REDACTED = "[REDACTED]"

    // ── Sensitive header names (lowercase) ────────────────────────────────────

    private val SENSITIVE_HEADERS = setOf(
        "authorization",
        "x-api-key",
        "x-goog-api-key",
        "x-auth-token",
        "api-key",
        "cookie",
        "set-cookie",
        "proxy-authorization",
        "x-amz-security-token",
        "x-amz-session-token",
    )

    // ── Sensitive map key substrings (lowercase, normalized) ─────────────────

    private val SENSITIVE_KEY_FRAGMENTS = listOf(
        "password", "passwd", "secret", "apikey", "api_key",
        "token", "bearer", "credential", "privatekey", "private_key",
        "accesskey", "access_key", "secretkey", "secret_key",
        "clientsecret", "client_secret", "authtoken", "auth_token",
        "connectionstring", "connection_string", "dsn",
        "x-api-key", "x-goog-api-key",
    )

    // ── Regex patterns for inline secret detection in strings ─────────────────

    private val STRING_PATTERNS: List<Regex> = listOf(
        // Authorization header values: Bearer/Basic/Token <value>
        Regex("""(?i)(Bearer|Basic|Token)\s+[A-Za-z0-9+/=._\-]{8,}"""),
        // x-api-key / api-key header values (after colon)
        Regex("""(?i)(x-api-key|api[-_]key|x-goog-api-key)\s*:\s*\S+"""),
        // sk- prefixed keys (OpenAI style)
        Regex("""sk-[A-Za-z0-9_\-]{16,}"""),
        // Private key PEM blocks
        Regex("""-----BEGIN[A-Z ]+KEY-----[\s\S]+?-----END[A-Z ]+KEY-----"""),
    )

    // ── Connection string patterns with embedded credentials ─────────────────

    private val CONN_STRING_SCHEMES = setOf(
        "postgres", "postgresql", "mysql", "mongodb", "mongodb+srv",
        "redis", "rediss", "amqp", "amqps", "https", "http",
    )

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Redact known secret patterns from a plain string.
     * Safe to use in log messages.
     */
    fun redactString(input: String): String {
        var out = input
        for (pat in STRING_PATTERNS) {
            out = pat.replace(out) { mr ->
                val full = mr.value
                // Keep the key name portion for context; redact the value
                val colonIdx = full.indexOf(':')
                if (colonIdx >= 0) full.substring(0, colonIdx + 1) + " $REDACTED"
                else REDACTED
            }
        }
        return out
    }

    /**
     * Redact sensitive keys from a flat [Map].
     * Returns a new map with secret values replaced by [REDACTED].
     */
    fun redactMap(map: Map<String, Any?>): Map<String, Any?> =
        map.mapValues { (k, v) ->
            if (isSensitiveKey(k)) REDACTED else v
        }

    /**
     * Redact sensitive fields from a JSON string.
     * Uses regex-based replacement — not a full JSON parser, but safe for logs.
     */
    fun redactJson(json: String): String {
        var out = json
        // Replace string values of sensitive keys:
        // "password":"anyvalue" → "password":"[REDACTED]"
        for (fragment in SENSITIVE_KEY_FRAGMENTS) {
            val pat = Regex(
                """("(?:[^"]*)?${Regex.escape(fragment)}(?:[^"]*)?"\s*:\s*)"[^"]*"""",
                RegexOption.IGNORE_CASE,
            )
            out = pat.replace(out) { mr -> mr.groupValues[1] + "\"$REDACTED\"" }
        }
        return out
    }

    /**
     * Redact sensitive headers from a map of HTTP headers.
     * Case-insensitive key comparison.
     */
    fun redactHeaders(headers: Map<String, String>): Map<String, String> =
        headers.mapValues { (k, v) ->
            if (k.lowercase() in SENSITIVE_HEADERS) REDACTED else v
        }

    /**
     * Redact credentials from a connection/DSN string URL.
     *
     * Examples:
     *   postgres://user:pass@host/db     → postgres://[REDACTED]@host/db
     *   mysql://user:pass@host/db        → mysql://[REDACTED]@host/db
     *   https://user:pass@example.com/  → https://[REDACTED]@example.com/
     *   mongodb+srv://user:pass@cluster → mongodb+srv://[REDACTED]@cluster
     */
    fun redactConnectionString(url: String): String {
        return try {
            // Normalize mongodb+srv → use a placeholder scheme for URI parsing
            val parseableUrl = url.replace("mongodb+srv://", "mongodb-srv://")
                .replace("postgresql://", "postgres://")

            val uri = URI(parseableUrl)
            val scheme = uri.scheme?.lowercase() ?: return url

            if (scheme.replace("-", "+") !in CONN_STRING_SCHEMES) return url

            val userInfo = uri.userInfo
            if (userInfo.isNullOrBlank()) return url

            // Reconstruct URL with redacted userInfo
            val original = url
            val atIdx = original.indexOf('@')
            if (atIdx < 0) return original

            val schemeEnd = original.indexOf("://")
            if (schemeEnd < 0) return original

            original.substring(0, schemeEnd + 3) + REDACTED + "@" + original.substring(atIdx + 1)
        } catch (_: Exception) {
            // If URI parsing fails, run regex fallback
            redactConnectionStringFallback(url)
        }
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    private fun isSensitiveKey(key: String): Boolean {
        val normalized = key.lowercase().replace("-", "").replace("_", "")
        return SENSITIVE_KEY_FRAGMENTS.any { frag ->
            normalized.contains(frag.replace("_", "").replace("-", ""))
        }
    }

    private fun redactConnectionStringFallback(url: String): String {
        // Match scheme://anything@host — replace the anything with REDACTED
        val pat = Regex("""^([a-zA-Z+][a-zA-Z0-9+\-.]*://)([^@]+)(@.*)$""")
        return pat.replace(url) { mr ->
            mr.groupValues[1] + REDACTED + mr.groupValues[3]
        }
    }

    /**
     * Build a safe masked preview of a secret for display (e.g. in UI).
     * Shows first 4 chars + "..." + last 4 chars if long enough.
     * Never call this with a secret after decryption for storage — only for UI display.
     */
    fun maskedPreview(secret: String): String {
        val trimmed = secret.trim()
        return when {
            trimmed.length <= 8 -> "****"
            else -> "${trimmed.take(4)}...${trimmed.takeLast(4)}"
        }
    }
}
