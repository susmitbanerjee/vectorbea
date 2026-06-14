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

    /**
     * Reachability-only test: any HTTP response (even 4xx) proves the host is live
     * and serving. Used for endpoints we can't fully authenticate against without
     * request signing (e.g. S3/GCS object-storage buckets), where a 401/403 still
     * confirms the endpoint exists and is reachable.
     */
    fun testReachability(rawUrl: String): ConnectionTestResult {
        val start = System.currentTimeMillis()
        try {
            SsrfGuard.validate(rawUrl)
        } catch (e: SsrfGuard.SsrfBlockedException) {
            return ConnectionTestResult.privateHost(0)
        } catch (e: IllegalArgumentException) {
            return ConnectionTestResult.failed(0, "INVALID_URL", "Malformed URL: ${e.message}")
        }
        return try {
            val attempt: (String) -> Int = { method ->
                val conn = URL(rawUrl).openConnection() as HttpURLConnection
                conn.requestMethod = method
                conn.connectTimeout = CONNECT_TIMEOUT_MS
                conn.readTimeout = READ_TIMEOUT_MS
                conn.setRequestProperty("User-Agent", "vectorbee-connection-tester/1.0")
                conn.instanceFollowRedirects = false
                val code = conn.responseCode
                conn.disconnect()
                code
            }
            val status = try { attempt("HEAD") } catch (_: Exception) { attempt("GET") }
            val latency = System.currentTimeMillis() - start
            if (status in 200..499)
                ConnectionTestResult.connected(latency, "Endpoint reachable (HTTP $status)")
            else
                ConnectionTestResult.failed(latency, "SERVER_ERROR", "Server returned $status")
        } catch (e: SsrfGuard.SsrfBlockedException) {
            ConnectionTestResult.privateHost(System.currentTimeMillis() - start)
        } catch (e: Exception) {
            val (code, msg) = classifyException(e)
            log.warn("Reachability test failed errorClass={}", e.javaClass.simpleName)
            ConnectionTestResult.failed(System.currentTimeMillis() - start, code, msg)
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
        // Slack-specific: use auth.test to validate the token, not just reachability.
        // A HEAD to slack.com/api/ returns 200 even with an invalid token.
        if (url.contains("slack.com") && !input.apiKey.isNullOrBlank()) {
            return testSlackAuth(input, start)
        }

        // Try HEAD first (no response body), fall back to GET
        return try {
            doRequest(url, "HEAD", input, start)
        } catch (_: Exception) {
            doRequest(url, "GET", input, start)
        }
    }

    /**
     * Validate a Slack Bearer token via api/auth.test.
     * Returns connected if ok=true (token valid + bot info returned),
     * failed with the specific Slack error if ok=false.
     */
    private fun testSlackAuth(input: HttpTestInput, start: Long): ConnectionTestResult {
        val authTestUrl = "https://slack.com/api/auth.test"
        return try {
            SsrfGuard.validate(authTestUrl)
            val conn = java.net.URL(authTestUrl).openConnection() as java.net.HttpURLConnection
            conn.requestMethod = "POST"
            conn.connectTimeout = CONNECT_TIMEOUT_MS
            conn.readTimeout = READ_TIMEOUT_MS
            conn.setRequestProperty("Authorization", "Bearer ${input.apiKey}")
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.outputStream.write("{}".toByteArray())

            val status  = conn.responseCode
            val latency = System.currentTimeMillis() - start
            val body    = conn.inputStream.bufferedReader().readText().take(MAX_RESPONSE_BYTES)
            conn.disconnect()

            @Suppress("UNCHECKED_CAST")
            val json = try {
                com.fasterxml.jackson.module.kotlin.jacksonObjectMapper()
                    .readValue(body, Map::class.java) as Map<String, Any?>
            } catch (_: Exception) { emptyMap<String, Any?>() }

            when {
                json["ok"] == true -> {
                    val botName = json["user"]?.toString() ?: "bot"
                    val team    = json["team"]?.toString() ?: ""
                    ConnectionTestResult.connected(latency,
                        "Slack token valid — $botName @ $team (chat:write scope required to post)")
                }
                json["ok"] == false -> {
                    val error = json["error"]?.toString() ?: "unknown"
                    ConnectionTestResult.failed(latency, "SLACK_AUTH_FAILED",
                        "Slack token invalid: $error — check your Bot Token in the connection settings")
                }
                else ->
                    ConnectionTestResult.failed(latency, "SLACK_UNEXPECTED",
                        "Unexpected Slack response (HTTP $status)")
            }
        } catch (e: Exception) {
            val (code, msg) = classifyException(e)
            ConnectionTestResult.failed(System.currentTimeMillis() - start, code, msg)
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
