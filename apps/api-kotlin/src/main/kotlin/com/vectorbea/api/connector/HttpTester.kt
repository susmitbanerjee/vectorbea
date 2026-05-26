package com.vectorbea.api.connector

import com.vectorbea.api.security.SsrfGuard
import org.slf4j.LoggerFactory
import java.net.HttpURLConnection
import java.net.URL

/**
 * Tests HTTP/API endpoint connectivity with SSRF protection.
 *
 * SECURITY:
 * - ALL outbound URLs are validated through [SsrfGuard] before connection.
 * - API keys / auth are applied as headers server-side — never in URLs.
 * - Response bodies are NOT logged.
 * - Error messages are sanitized before return.
 */
object HttpTester {

    private val log = LoggerFactory.getLogger(HttpTester::class.java)

    private const val CONNECT_TIMEOUT_MS = 8_000
    private const val READ_TIMEOUT_MS = 12_000
    private const val MAX_RESPONSE_BYTES = 32_768

    data class HttpTestInput(
        val url: String,
        val authType: String,          // "api_key" | "bearer" | "basic" | "none"
        /** Resolved plaintext secret — NEVER log */
        val apiKey: String?,
        val username: String?,
        /** Resolved plaintext password — NEVER log */
        val password: String?,
        /** Header name for api_key auth (default: Authorization) */
        val apiKeyHeaderName: String? = null,
        /** Custom health path to append */
        val healthPath: String? = null,
        /** Extra safe config fields */
        val extraConfig: Map<String, Any?> = emptyMap(),
    )

    fun test(input: HttpTestInput): ConnectionTestResult {
        val start = System.currentTimeMillis()

        // ── SSRF validation ────────────────────────────────────────────────────
        try {
            SsrfGuard.validate(input.url)
        } catch (e: SsrfGuard.SsrfBlockedException) {
            return ConnectionTestResult.privateHost(0)
        } catch (e: IllegalArgumentException) {
            return ConnectionTestResult.failed(0, "INVALID_URL", "Malformed URL: ${e.message}")
        }

        val testUrl = buildTestUrl(input)

        return try {
            // ── SSRF check on final URL too (in case healthPath changes host) ──
            SsrfGuard.validate(testUrl)

            performRequest(testUrl, input, start)
        } catch (e: SsrfGuard.SsrfBlockedException) {
            ConnectionTestResult.privateHost(System.currentTimeMillis() - start)
        } catch (e: Exception) {
            val latency = System.currentTimeMillis() - start
            val (code, msg) = classifyException(e)
            log.warn("HTTP connection test failed errorClass={}", e.javaClass.simpleName)
            ConnectionTestResult.failed(latency, code, msg)
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun buildTestUrl(input: HttpTestInput): String {
        val base = input.url.trimEnd('/')
        if (!input.healthPath.isNullOrBlank()) {
            val path = if (input.healthPath.startsWith("/")) input.healthPath
                       else "/${input.healthPath}"
            return "$base$path"
        }
        return base
    }

    private fun performRequest(url: String, input: HttpTestInput, start: Long): ConnectionTestResult {
        // Try HEAD first (no response body), fall back to GET
        return try {
            doRequest(url, "HEAD", input, start)
        } catch (_: Exception) {
            doRequest(url, "GET", input, start)
        }
    }

    private fun doRequest(url: String, method: String, input: HttpTestInput, start: Long): ConnectionTestResult {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = CONNECT_TIMEOUT_MS
        conn.readTimeout = READ_TIMEOUT_MS
        conn.setRequestProperty("User-Agent", "vectorbee-connection-tester/1.0")
        conn.instanceFollowRedirects = false

        // ── Apply auth headers server-side — NEVER add to URL ─────────────────
        applyAuth(conn, input)

        val status = conn.responseCode
        val latency = System.currentTimeMillis() - start

        conn.disconnect()

        return when {
            status in 200..299 ->
                ConnectionTestResult.connected(latency, "HTTP $method $status — endpoint reachable")
            status == 401 ->
                ConnectionTestResult.failed(latency, "AUTH_FAILED", "Authentication failed — check API key")
            status == 403 ->
                ConnectionTestResult.failed(latency, "AUTH_FAILED", "Endpoint returned 403 Forbidden")
            status == 404 ->
                // 404 on health path is still a reachable server
                ConnectionTestResult.connected(latency, "Endpoint reachable (404 — health path not found)")
            status == 429 ->
                ConnectionTestResult.failed(latency, "RATE_LIMITED", "Rate limit exceeded")
            status in 300..399 ->
                ConnectionTestResult.connected(latency, "Endpoint redirects (status=$status) — reachable")
            status in 500..599 ->
                ConnectionTestResult.failed(latency, "SERVER_ERROR", "Server returned $status")
            else ->
                ConnectionTestResult.failed(latency, "UNEXPECTED_STATUS", "HTTP $method returned $status")
        }
    }

    private fun applyAuth(conn: HttpURLConnection, input: HttpTestInput) {
        // SECURITY: credentials go in headers — never in URL query params
        when (input.authType.lowercase()) {
            "api_key" -> {
                val headerName = input.apiKeyHeaderName?.takeIf { it.isNotBlank() } ?: "Authorization"
                val key = input.apiKey ?: return
                if (headerName.lowercase() == "authorization") {
                    conn.setRequestProperty("Authorization", "Bearer $key")
                } else {
                    conn.setRequestProperty(headerName, key)
                }
            }
            "bearer" -> {
                if (!input.apiKey.isNullOrBlank()) {
                    conn.setRequestProperty("Authorization", "Bearer ${input.apiKey}")
                }
            }
            "basic" -> {
                val user = input.username ?: return
                val pass = input.password ?: ""
                val encoded = java.util.Base64.getEncoder()
                    .encodeToString("$user:$pass".toByteArray(Charsets.UTF_8))
                conn.setRequestProperty("Authorization", "Basic $encoded")
            }
            "none" -> { /* no-op */ }
        }
    }

    private fun classifyException(e: Exception): Pair<String, String> = when {
        e is java.net.SocketTimeoutException || e.javaClass.name.contains("SocketTimeout") ->
            "TIMEOUT" to "Connection timed out"
        e.javaClass.name.contains("SSL") || e.javaClass.name.contains("TLS") ->
            "TLS_FAILED" to "TLS/SSL handshake failed"
        e is java.net.UnknownHostException ->
            "DNS_FAILED" to "DNS resolution failed — check URL"
        e is java.net.ConnectException ->
            "CONNECTION_REFUSED" to "Connection refused — check host and port"
        else -> "CONNECTION_ERROR" to "Connection failed"
    }
}
