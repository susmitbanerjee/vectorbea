package com.vectorbea.sdk.internal

import com.vectorbea.sdk.APIException
import com.vectorbea.sdk.AuthenticationException
import com.vectorbea.sdk.ConnectionException
import com.vectorbea.sdk.NotFoundException
import com.vectorbea.sdk.TimeoutException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.SocketTimeoutException
import java.util.concurrent.TimeUnit

private const val SDK_VERSION = "0.2.1"
private val JSON_MEDIA_TYPE = "application/json; charset=utf-8".toMediaType()

// ── Message sanitisation ──────────────────────────────────────────────────────
//
// Server error bodies may contain internal identifiers (workspace UUIDs, user
// UUIDs, internal service names) that should never be forwarded to the caller
// and end up in application logs, Sentry, Datadog, etc.
//
// Every server-sourced string must pass through sanitize() before it is placed
// into an exception message.

private val UUID_REGEX = Regex(
    "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}",
    RegexOption.IGNORE_CASE,
)
private const val MAX_MSG_LENGTH = 200

private fun sanitize(raw: String): String =
    raw.replace(UUID_REGEX, "[id]")     // strip workspace / resource UUIDs
        .take(MAX_MSG_LENGTH)           // cap length — avoids huge blobs in logs
        .trim()

/**
 * Internal HTTP transport layer.
 * Not part of the public API — use [com.vectorbea.sdk.VectorBeaClient] instead.
 */
internal class HttpClient(
    private val baseUrl: String,
    private val apiKey: String?,
    timeoutSeconds: Long,
) {
    // Safe representation of baseUrl for use in error messages.
    // Strips any embedded userinfo (user:password@host) that a caller might
    // accidentally include in the baseUrl string.
    private val safeBaseUrl: String = runCatching {
        val uri = java.net.URI(baseUrl)
        java.net.URI(uri.scheme, null, uri.host, uri.port, null, null, null).toString()
    }.getOrDefault(baseUrl.substringAfterLast("@").let { "${baseUrl.substringBefore("://")}://$it" })

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    // ── OkHttp client ─────────────────────────────────────────────────────────
    //
    // A single OkHttpClient is shared for all requests from this SDK instance.
    // OkHttp manages a connection pool internally so this is the correct pattern
    // for long-lived service objects (mirrors the Stripe-java SDK approach).
    private val okhttp = OkHttpClient.Builder()
        .connectTimeout(timeoutSeconds, TimeUnit.SECONDS)
        .readTimeout(timeoutSeconds, TimeUnit.SECONDS)
        .writeTimeout(timeoutSeconds, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)   // SDK caller controls retry logic
        .build()

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Execute a GET request and decode the response body to [T].
     * Runs on [Dispatchers.IO] — safe to call from any coroutine context.
     */
    suspend inline fun <reified T> get(path: String): T = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl$path")
            .applyHeaders()
            .get()
            .build()
        execute(request, path)
    }

    /**
     * Execute a POST request with a JSON body and decode the response to [T].
     * Runs on [Dispatchers.IO].
     */
    suspend inline fun <reified T> post(path: String, body: String): T = withContext(Dispatchers.IO) {
        val request = Request.Builder()
            .url("$baseUrl$path")
            .applyHeaders()
            .post(body.toRequestBody(JSON_MEDIA_TYPE))
            .build()
        execute(request, path)
    }

    // ── Internal helpers ───────────────────────────────────────────────────────

    fun Request.Builder.applyHeaders(): Request.Builder = apply {
        header("Accept", "application/json")
        header("Content-Type", "application/json")
        header("User-Agent", "vectorbea-jvm/$SDK_VERSION")
        if (!apiKey.isNullOrBlank()) header("Authorization", "Bearer $apiKey")
    }

    inline fun <reified T> execute(request: Request, path: String): T {
        val response = try {
            okhttp.newCall(request).execute()
        } catch (e: SocketTimeoutException) {
            throw TimeoutException(
                "Request to $safeBaseUrl timed out. " +
                    "Increase the timeout via VectorBeaClient.Builder.timeoutSeconds().",
                e,
            )
        } catch (e: IOException) {
            throw ConnectionException(
                "Could not connect to VectorBea proxy at $safeBaseUrl. " +
                    "Is the container running? Verify Docker is up and port 8080 is mapped.",
                e,
            )
        }

        response.use { resp ->
            val bodyText = resp.body?.string() ?: ""
            val status = resp.code

            if (resp.isSuccessful) {
                return json.decodeFromString<T>(bodyText)
            }

            // Extract the error message from JSON body if possible, then sanitise
            // before it reaches any exception message or caller log.
            val raw: String = runCatching {
                json.decodeFromString<JsonObject>(bodyText)["error"]
                    ?.jsonPrimitive?.content
                    ?: bodyText
            }.getOrDefault(bodyText)

            val message = sanitize(raw)

            when (status) {
                401 -> throw AuthenticationException(
                    // Do not echo server detail for auth failures — the response
                    // body may contain workspace context that should not be visible
                    // to the caller.
                    "Invalid or inactive API key. " +
                        "Regenerate it from the VectorBea dashboard → API Keys."
                )
                404 -> throw NotFoundException(
                    message.ifBlank {
                        "Resource not found at $path. " +
                            "Check the prompt name exists in your workspace " +
                            "and has at least one published version."
                    }
                )
                else -> throw APIException(
                    "HTTP $status: $message",
                    statusCode = status,
                )
            }
        }
    }

    /** Release the underlying connection pool. Call once when done with the client. */
    fun close() {
        okhttp.dispatcher.executorService.shutdown()
        okhttp.connectionPool.evictAll()
        okhttp.cache?.close()
    }
}
