package com.vectorbea.api.connector

import com.vectorbea.api.security.Redactor
import com.vectorbea.api.security.SsrfGuard
import org.slf4j.LoggerFactory
import java.net.HttpURLConnection
import java.net.URL

/**
 * Tests LLM provider connectivity by making a lightweight, non-destructive
 * API call (model list or minimal inference).
 *
 * SECURITY:
 * - API keys are supplied as HTTP headers ONLY — never in URLs.
 * - Keys are NEVER logged at any level.
 * - Request/response bodies are not logged.
 * - Error messages are sanitized before return.
 *
 * Supported providers:
 *   openai     — GET /v1/models  (Authorization: Bearer <key>)
 *   anthropic  — GET /v1/models  (x-api-key: <key>, anthropic-version)
 *   google     — GET /v1beta/models  (x-goog-api-key: <key>  — NOT in URL)
 *   custom     — GET <baseUrl>/models or HEAD <baseUrl>  (Authorization: Bearer <key>)
 */
object LlmTester {

    private val log = LoggerFactory.getLogger(LlmTester::class.java)

    private const val CONNECT_TIMEOUT_MS = 8_000
    private const val READ_TIMEOUT_MS = 15_000
    private const val MAX_RESPONSE_BYTES = 32_768  // 32 KB — enough for model list

    /** Required on every Anthropic API request. Version pinning is not optional there. */
    private const val ANTHROPIC_VERSION = "2023-06-01"

    data class LlmTestInput(
        val provider: String,
        /** Resolved plaintext API key — handle with care, never log */
        val apiKey: String?,
        /** For openai-compatible or custom providers */
        val baseUrl: String? = null,
        /** Extra headers (safe ones only, never the key) */
        val extraConfig: Map<String, Any?> = emptyMap(),
    )

    fun test(input: LlmTestInput): ConnectionTestResult {
        val start = System.currentTimeMillis()
        return try {
            when (input.provider.lowercase()) {
                "openai"         -> testOpenAi(input, start)
                "anthropic"      -> testAnthropic(input, start)
                "google", "gemini", "google_gemini" -> testGoogle(input, start)
                "azure_openai"   -> testAzureOpenAi(input, start)
                "custom", "mistral", "cohere", "openai_compatible" ->
                    testOpenAiCompatible(input, start)
                else             -> testOpenAiCompatible(input, start)
            }
        } catch (e: SsrfGuard.SsrfBlockedException) {
            ConnectionTestResult.privateHost(System.currentTimeMillis() - start)
        } catch (e: Exception) {
            val latency = System.currentTimeMillis() - start
            // SECURITY: sanitize — do not include e.message which may contain key fragments
            val (code, msg) = classifyException(e)
            log.warn("LLM connection test failed [provider={}] errorClass={}", input.provider, e.javaClass.simpleName)
            ConnectionTestResult.failed(latency, code, msg)
        }
    }

    // ── Provider implementations ──────────────────────────────────────────────

    private fun testOpenAi(input: LlmTestInput, start: Long): ConnectionTestResult {
        val base = (input.baseUrl?.trimEnd('/') ?: "https://api.openai.com").trimEnd('/')
        val url = "$base/v1/models"
        val conn = openConnection(url)
        conn.setRequestProperty("Authorization", "Bearer ${input.apiKey ?: ""}")
        return executeGet(conn, start, expectedStatus = 200)
    }

    /**
     * Anthropic connectivity, via GET /v1/models.
     *
     * This used to POST /v1/messages with `"model":"claude-haiku-20240307"` and
     * treat 200/400 as success. That model id does not exist — the real one is
     * `claude-3-haiku-20240307` — so the API answered 404 `not_found_error` and
     * the `when` fell through to UNEXPECTED_STATUS. The result: a perfectly good
     * Anthropic key could never pass its connection test, and the failure named
     * an HTTP status rather than anything the user could act on.
     *
     * The models list is the right probe regardless of that bug. It is the
     * documented capability-discovery endpoint, it authenticates exactly like a
     * real call, it cannot be broken by a model being renamed or retired, and it
     * generates no tokens — so testing a connection never costs the customer
     * money. `anthropic-version` is required on every request to this API.
     */
    private fun testAnthropic(input: LlmTestInput, start: Long): ConnectionTestResult {
        val base = (input.baseUrl?.trimEnd('/') ?: "https://api.anthropic.com").trimEnd('/')
        val conn = openConnection("$base/v1/models")
        // SECURITY: API key in header, never in URL
        conn.setRequestProperty("x-api-key", input.apiKey ?: "")
        conn.setRequestProperty("anthropic-version", ANTHROPIC_VERSION)

        val status = conn.responseCode
        val latency = System.currentTimeMillis() - start

        return when (status) {
            200 -> ConnectionTestResult.connected(latency, "Anthropic API key is valid")
            401 -> ConnectionTestResult.failed(latency, "AUTH_FAILED",
                "Anthropic rejected the API key. Check it was copied whole and has not been revoked.")
            403 -> ConnectionTestResult.failed(latency, "AUTH_FAILED",
                "This Anthropic key is not authorised for the Messages API. Check the workspace it belongs to.")
            429 -> ConnectionTestResult.failed(latency, "RATE_LIMITED",
                "Anthropic rate limit reached. The key works — retry in a minute.")
            529 -> ConnectionTestResult.failed(latency, "OVERLOADED",
                "Anthropic is overloaded. The key works — retry shortly.")
            else -> ConnectionTestResult.failed(latency, "UNEXPECTED_STATUS",
                "Anthropic answered HTTP $status. Check the base URL if this connection uses a proxy.")
        }
    }

    private fun testGoogle(input: LlmTestInput, start: Long): ConnectionTestResult {
        // SECURITY: key goes in x-goog-api-key header — NEVER in URL query param
        val base = (input.baseUrl?.trimEnd('/') ?: "https://generativelanguage.googleapis.com").trimEnd('/')
        val url = "$base/v1beta/models"
        val conn = openConnection(url)
        // SECURITY: x-goog-api-key header — key is NOT appended to URL
        conn.setRequestProperty("x-goog-api-key", input.apiKey ?: "")
        return executeGet(conn, start, expectedStatus = 200)
    }

    private fun testAzureOpenAi(input: LlmTestInput, start: Long): ConnectionTestResult {
        val base = input.baseUrl?.trimEnd('/')
            ?: return ConnectionTestResult.failed(0, "CONFIG_ERROR", "Azure OpenAI requires baseUrl (endpoint)")
        // Azure uses api-key header
        val url = "$base/openai/deployments?api-version=2024-02-01"
        val conn = openConnection(url)
        conn.setRequestProperty("api-key", input.apiKey ?: "")
        return executeGet(conn, start, expectedStatus = 200)
    }

    private fun testOpenAiCompatible(input: LlmTestInput, start: Long): ConnectionTestResult {
        val providerDefault = when (input.provider.lowercase()) {
            "mistral" -> "https://api.mistral.ai/v1"
            else -> null
        }
        val base = (input.baseUrl ?: providerDefault)?.trimEnd('/')
            ?: return ConnectionTestResult.failed(0, "CONFIG_ERROR", "Custom/OpenAI-compatible provider requires baseUrl")
        val url = "$base/models"
        val conn = openConnection(url)
        if (!input.apiKey.isNullOrBlank()) {
            conn.setRequestProperty("Authorization", "Bearer ${input.apiKey}")
        }
        return executeGet(conn, start, expectedStatus = 200)
    }

    // ── HTTP helpers ──────────────────────────────────────────────────────────

    private fun openConnection(url: String, method: String = "GET"): HttpURLConnection {
        // Validate every provider/custom URL at the final outbound boundary.
        SsrfGuard.validate(url)
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = CONNECT_TIMEOUT_MS
        conn.readTimeout = READ_TIMEOUT_MS
        conn.setRequestProperty("User-Agent", "vectorbea-connection-tester/1.0")
        conn.setRequestProperty("Accept", "application/json")
        conn.instanceFollowRedirects = false
        return conn
    }

    private fun executeGet(
        conn: HttpURLConnection,
        start: Long,
        expectedStatus: Int,
    ): ConnectionTestResult {
        val status = conn.responseCode
        val latency = System.currentTimeMillis() - start

        return when {
            status == expectedStatus || status in 200..299 ->
                ConnectionTestResult.connected(latency, "Connection successful (status=$status)")
            status == 401 ->
                ConnectionTestResult.failed(latency, "AUTH_FAILED", "Authentication failed — check API key")
            status == 403 ->
                ConnectionTestResult.failed(latency, "AUTH_FAILED", "API key unauthorized")
            status == 429 ->
                ConnectionTestResult.failed(latency, "RATE_LIMITED", "Rate limit reached")
            status in 500..599 ->
                ConnectionTestResult.failed(latency, "PROVIDER_ERROR", "Provider returned server error $status")
            else ->
                ConnectionTestResult.failed(latency, "UNEXPECTED_STATUS", "HTTP $status")
        }
    }

    private fun classifyException(e: Exception): Pair<String, String> = when {
        e.javaClass.name.contains("SocketTimeout") || e is java.net.SocketTimeoutException ->
            "TIMEOUT" to "Connection timed out"
        e.javaClass.name.contains("SSL") || e.javaClass.name.contains("TLS") ->
            "TLS_FAILED" to "TLS/SSL handshake failed"
        e is java.net.UnknownHostException ->
            "DNS_FAILED" to "DNS resolution failed — check provider endpoint"
        e is java.net.ConnectException ->
            "CONNECTION_REFUSED" to "Connection refused — check host and port"
        else -> "CONNECTION_ERROR" to "Connection failed"
    }
}
