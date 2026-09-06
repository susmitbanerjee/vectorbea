package com.vectorbea.api.billing

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.time.Duration
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * The HTTP and crypto both providers need, in one place.
 *
 * ── WHY THERE IS NO STRIPE SDK HERE ─────────────────────────────────────────
 * The repo's rule is no new dependencies without asking, and two vendor SDKs
 * would be two — each pulling its own HTTP client, its own JSON binding and its
 * own release cadence. Both providers expose ordinary form-encoded or JSON REST
 * APIs, and what we use of them is small: create, update, cancel, report, verify.
 *
 * There is a second reason and it is the better one. An SDK's types would leak
 * into the calling code the way SDK types do, and the abstraction that is
 * supposed to make providers interchangeable would quietly acquire a Stripe
 * shape. Writing both against the same tiny client keeps the seam honest.
 *
 * What is genuinely lost: automatic retries, connection pooling tuned by the
 * vendor, and new API fields arriving for free. The first two are here; the
 * third is a deliberate trade, because a field we do not read cannot help us.
 */
internal object ProviderHttp {

    private val log = LoggerFactory.getLogger(ProviderHttp::class.java)
    val mapper: ObjectMapper = jacksonObjectMapper()

    /**
     * One client for the process.
     *
     * `HttpClient` is thread-safe and pools connections; constructing one per
     * request would open a new TLS session for every call to a provider that is
     * the same host every time.
     */
    private val client: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NEVER)
        .build()

    data class Response(val status: Int, val body: String) {
        val ok: Boolean get() = status in 200..299
        fun json(): JsonNode = mapper.readTree(body)
    }

    /**
     * POST, form-encoded or JSON, with an idempotency header when one is given.
     *
     * The timeout is per REQUEST and not per client: a provider that accepts the
     * connection and then hangs would otherwise hold a thread until the socket
     * timeout, and the calls that matter here are on a user's request path.
     */
    fun post(
        url: String,
        headers: Map<String, String>,
        body: String,
        contentType: String,
        timeout: Duration = Duration.ofSeconds(20),
    ): BillingResult<Response> = send(
        HttpRequest.newBuilder(URI.create(url))
            .timeout(timeout)
            .header("Content-Type", contentType)
            .apply { headers.forEach { (k, v) -> header(k, v) } }
            .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
            .build()
    )

    /**
     * DELETE. Stripe distinguishes cancel-now from cancel-at-period-end by the
     * VERB, so this is not an optional convenience.
     */
    fun delete(
        url: String,
        headers: Map<String, String>,
        timeout: Duration = Duration.ofSeconds(20),
    ): BillingResult<Response> = send(
        HttpRequest.newBuilder(URI.create(url))
            .timeout(timeout)
            .apply { headers.forEach { (k, v) -> header(k, v) } }
            .DELETE()
            .build()
    )

    fun get(
        url: String,
        headers: Map<String, String>,
        timeout: Duration = Duration.ofSeconds(20),
    ): BillingResult<Response> = send(
        HttpRequest.newBuilder(URI.create(url))
            .timeout(timeout)
            .apply { headers.forEach { (k, v) -> header(k, v) } }
            .GET()
            .build()
    )

    /**
     * Send, and classify the failure.
     *
     * ── THE RETRYABLE DECISION IS THE POINT ─────────────────────────────────
     * A timeout, a connection refusal and a 5xx are transient: the next sweep
     * should try again. A 4xx is a configuration error — a price that does not
     * exist, a customer that was deleted — and retrying it forever would hide it
     * behind a queue that never drains and never alerts.
     *
     * 429 is the exception that proves it: a rate limit is a 4xx that IS
     * retryable, and treating it as permanent would abandon work the provider
     * merely asked us to slow down.
     */
    private fun send(request: HttpRequest): BillingResult<Response> = try {
        val res = client.send(request, HttpResponse.BodyHandlers.ofString())
        val wrapped = Response(res.statusCode(), res.body() ?: "")
        if (wrapped.ok) {
            BillingResult.Success(wrapped)
        } else {
            val retryable = res.statusCode() >= 500 || res.statusCode() == 429
            log.warn("[billing] {} {} -> {} ({})",
                request.method(), request.uri().host, res.statusCode(),
                if (retryable) "retryable" else "permanent")
            BillingResult.Failure(
                message = providerMessage(wrapped) ?: "provider returned ${res.statusCode()}",
                retryable = retryable,
                providerCode = errorCode(wrapped),
            )
        }
    } catch (e: java.net.http.HttpTimeoutException) {
        BillingResult.Failure("provider timed out", retryable = true, cause = e)
    } catch (e: java.io.IOException) {
        // Includes connection refused and DNS failure — the provider being
        // unreachable, which must never be fatal to anything but this call.
        BillingResult.Failure("provider unreachable: ${e.message}", retryable = true, cause = e)
    } catch (e: Exception) {
        BillingResult.Failure("provider call failed: ${e.message}", retryable = false, cause = e)
    }

    /** Both providers nest their human-readable message differently. */
    private fun providerMessage(res: Response): String? = runCatching {
        val root = res.json()
        root.path("error").path("message").asText(null)
            ?: root.path("error").path("description").asText(null)
            ?: root.path("message").asText(null)
    }.getOrNull()

    private fun errorCode(res: Response): String? = runCatching {
        val root = res.json()
        root.path("error").path("code").asText(null)
            ?: root.path("error").path("type").asText(null)
    }.getOrNull()

    // ── Encoding and crypto ───────────────────────────────────────────────────

    fun formEncode(params: Map<String, String?>): String =
        params.entries
            .filter { it.value != null }
            .joinToString("&") { (k, v) ->
                "${enc(k)}=${enc(v!!)}"
            }

    private fun enc(s: String) = java.net.URLEncoder.encode(s, StandardCharsets.UTF_8)

    fun basicAuth(user: String, password: String): String =
        "Basic " + java.util.Base64.getEncoder()
            .encodeToString("$user:$password".toByteArray(StandardCharsets.UTF_8))

    fun hmacSha256Hex(key: String, message: String): String {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key.toByteArray(StandardCharsets.UTF_8), "HmacSHA256"))
        return mac.doFinal(message.toByteArray(StandardCharsets.UTF_8))
            .joinToString("") { "%02x".format(it) }
    }

    /**
     * Compare two hex digests without leaking where they differ.
     *
     * `==` on strings returns as soon as a byte differs, and the time it took is
     * a measurement of how many leading bytes were right. That is a real attack
     * on a signature check, and it costs one function to not have.
     */
    fun constantTimeEquals(a: String, b: String): Boolean {
        if (a.length != b.length) return false
        var diff = 0
        for (i in a.indices) diff = diff or (a[i].code xor b[i].code)
        return diff == 0
    }
}
