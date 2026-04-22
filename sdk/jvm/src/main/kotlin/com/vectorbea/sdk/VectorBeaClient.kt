package com.vectorbea.sdk

import com.vectorbea.sdk.internal.HttpClient
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.Closeable
import java.util.Collections
import java.util.WeakHashMap
import kotlin.time.measureTimedValue

// Default to the local sidecar — the most common first-run experience.
// Override to "https://app.vectorbea.com" or your own host for cloud usage.
private const val DEFAULT_BASE_URL = "http://localhost:8080"
private const val DEFAULT_TIMEOUT_SECONDS = 10L

/**
 * The VectorBea JVM SDK client.
 *
 * Use [Builder] to construct an instance. Reuse one client across your
 * application — the underlying OkHttp connection pool is shared.
 *
 * ```kotlin
 * val client = VectorBeaClient.Builder()
 *     .apiKey("vbagent_your_token_here")
 *     .baseUrl("http://localhost:8080")
 *     .build()
 *
 * val prompt  = client.getPrompt("greet-user")
 * val message = prompt.compile(mapOf("name" to "Alice", "product" to "Acme AI"))
 * println(message) // "Hello Alice, welcome to Acme AI!"
 *
 * client.close() // release connection pool when done
 * ```
 */
class VectorBeaClient private constructor(
    private val http: HttpClient,
    private val baseUrl: String,
) : Closeable {

    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }
    private val auditPromptVersionIds = Collections.synchronizedMap(WeakHashMap<Prompt, String>())

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Fetch the latest published version of a prompt by name.
     *
     * The proxy fetch latency is measured automatically and an audit event
     * is reported to the VectorBea dashboard without any extra
     * instrumentation. Audit failures are swallowed so they never break
     * the caller.
     *
     * @param name The prompt name as defined in the VectorBea dashboard
     *   (e.g. `"greet-user"` or `"summarise-ticket"`).
     * @return The resolved [Prompt] with a [compile][Prompt.compile]
     *   extension function for variable substitution.
     *
     * @throws NotFoundException if the prompt does not exist or has no published version.
     * @throws AuthenticationException if the API key is invalid or inactive.
     * @throws ConnectionException if the proxy is not reachable.
     * @throws TimeoutException if the request exceeds the configured timeout.
     */
    suspend fun getPrompt(name: String): Prompt {
        val (rawPrompt, elapsed) = measureTimedValue {
            http.get<RawPrompt>("/v1/prompts/${name.encodeUrl()}")
        }
        val prompt = rawPrompt.toPrompt()
        auditPromptVersionIds[prompt] = rawPrompt.promptVersionId

        // Auto-report the proxy latency — audit failures are non-fatal
        runCatching {
            reportAudit(
                prompt = prompt,
                proxyLatencyMs = elapsed.inWholeMilliseconds.toDouble(),
            )
        }.onFailure { err ->
            // Log but never surface — audit must not break the caller
            System.err.println("[vectorbea] audit report failed (non-fatal): ${err.message}")
        }

        return prompt
    }

    /**
     * Report a full audit event including LLM latency and token count.
     *
     * [getPrompt] already reports the proxy fetch latency automatically.
     * Call this *after* your LLM responds to attach LLM latency and token
     * usage to the same record in the dashboard.
     *
     * @param prompt The [Prompt] returned by [getPrompt].
     * @param proxyLatencyMs Override the proxy latency (ms). Use the value
     *   you measured around [getPrompt] if you need fine-grained accuracy.
     * @param llmLatencyMs Round-trip latency of your LLM call in ms.
     * @param tokenCount Total tokens consumed (prompt + completion).
     * @param metadata Extra key/value pairs attached to the audit record.
     *
     * ```kotlin
     * val prompt = client.getPrompt("greet-user")
     * // ... call your LLM ...
     * client.logAudit(prompt, llmLatencyMs = 432, tokenCount = 87,
     *                 metadata = mapOf("model" to "gpt-4o"))
     * ```
     */
    suspend fun logAudit(
        prompt: Prompt,
        proxyLatencyMs: Double = 0.0,
        llmLatencyMs: Long = 0L,
        tokenCount: Int = 0,
        metadata: Map<String, String> = emptyMap(),
    ) {
        reportAudit(prompt, proxyLatencyMs, llmLatencyMs, tokenCount, metadata)
    }

    /**
     * Release the underlying OkHttp connection pool.
     *
     * Call once when you are done with this client (e.g. in application
     * shutdown). After this call, all further requests will fail.
     */
    override fun close() {
        http.close()
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private suspend fun reportAudit(
        prompt: Prompt,
        proxyLatencyMs: Double = 0.0,
        llmLatencyMs: Long = 0L,
        tokenCount: Int = 0,
        metadata: Map<String, String> = emptyMap(),
    ) {
        val promptVersionId = auditPromptVersionIds[prompt]
            ?: throw IllegalArgumentException(
                "Prompt audit reference missing. Use the Prompt returned by getPrompt() when calling logAudit().",
            )
        val normalizedMetadata = buildTraceMetadataV1(
            metadata = metadata,
            promptVersionId = promptVersionId,
            promptName = prompt.name,
            versionTag = prompt.versionTag,
            proxyLatencyMs = proxyLatencyMs,
            llmLatencyMs = llmLatencyMs,
            tokenCount = tokenCount,
            useType = "runtime",
        )

        val payload = buildString {
            append("""{"promptVersionId":""")
            append(json.encodeToString(promptVersionId))
            append(""","promptName":""")
            append(json.encodeToString(prompt.name))
            append(""","versionTag":""")
            append(json.encodeToString(prompt.versionTag))
            append(""","proxyLatencyMs":$proxyLatencyMs""")
            append(""","llmLatencyMs":$llmLatencyMs""")
            append(""","tokenCount":$tokenCount""")
            append(""","metadata":""")
            append(json.encodeToString(normalizedMetadata))
            append("}")
        }
        http.post<kotlinx.serialization.json.JsonObject>("/v1/audit", payload)
    }

    // ── Builder ───────────────────────────────────────────────────────────────

    /**
     * Builder for [VectorBeaClient].
     *
     * ```kotlin
     * val client = VectorBeaClient.Builder()
     *     .apiKey(System.getenv("VECTORBEA_API_KEY"))
     *     .baseUrl("http://localhost:8080")
     *     .timeoutSeconds(30)
     *     .build()
     * ```
     */
    class Builder {
        private var apiKey: String? = System.getenv("VECTORBEA_API_KEY")
        private var baseUrl: String = System.getenv("VECTORBEA_BASE_URL") ?: DEFAULT_BASE_URL
        private var timeoutSeconds: Long = DEFAULT_TIMEOUT_SECONDS

        /**
         * Set the workspace API key (starts with `vb_` or `vbagent_`).
         *
         * If not called, the SDK reads `VECTORBEA_API_KEY` from the environment.
         */
        fun apiKey(key: String) = apply { this.apiKey = key }

        /**
         * Set the base URL of the VectorBea proxy or hub.
         *
         * Defaults to the hosted cloud endpoint. Override to
         * `http://localhost:8080` when running the proxy container locally.
         */
        fun baseUrl(url: String) = apply { this.baseUrl = url.trimEnd('/') }

        /**
         * Set the connect/read/write timeout in seconds. Defaults to 10.
         */
        fun timeoutSeconds(seconds: Long) = apply { this.timeoutSeconds = seconds }

        /** Build and return the configured [VectorBeaClient]. */
        fun build(): VectorBeaClient {
            val http = HttpClient(
                baseUrl = baseUrl.trimEnd('/'),
                apiKey = apiKey,
                timeoutSeconds = timeoutSeconds,
            )
            return VectorBeaClient(http, baseUrl)
        }
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

private fun String.encodeUrl(): String =
    java.net.URLEncoder.encode(this, Charsets.UTF_8).replace("+", "%20")
