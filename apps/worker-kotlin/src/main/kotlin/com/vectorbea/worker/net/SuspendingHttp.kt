package com.vectorbea.worker.net

import com.vectorbea.worker.config.OutboundTimeouts
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.engine.cio.endpoint
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.timeout
import io.ktor.client.request.HttpRequestBuilder
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.http.HttpMethod
import io.ktor.utils.io.core.isEmpty
import io.ktor.utils.io.core.readBytes
import kotlinx.coroutines.withTimeoutOrNull
import org.slf4j.LoggerFactory
import java.nio.charset.StandardCharsets

/**
 * Suspending outbound HTTP, replacing the blocking JDK client.
 *
 * WHY THIS EXISTS
 * ---------------
 * `OutboundHttp` bounded every call correctly, but it bounded them *while
 * holding a thread*. `future.get(totalCallMs)` parks the caller for the whole
 * exchange, so an agent run waiting 6 s on a provider owned an execution slot —
 * a thread — for 6 s of doing nothing. That is the capacity being paid for and
 * not used (§1.4).
 *
 * Ktor's CIO engine is non-blocking end to end: an in-flight request holds a
 * continuation on the heap, not a thread. The same four bounds still apply —
 * connect, headers, total call, response size — they simply no longer cost a
 * thread each.
 *
 * CONNECTION LIMITS ARE VERIFIED, NOT ASSUMED
 * -------------------------------------------
 * This is the trap the brief calls out and it is a real one. HTTP client engines
 * default to a small per-host connection cap — often around 5 — and that cap
 * silently serialises every call to the same host. Raising the agent semaphore
 * to 200 while the client will only open 5 connections to `api.openai.com` buys
 * nothing: 195 coroutines simply queue inside the engine, invisible to every
 * metric the worker exposes.
 *
 * So the configured values are read back from the engine config at startup and
 * logged, and [verifyConnectionLimits] fails loudly if they did not take effect.
 * A limit you did not verify is a limit you do not have.
 */
object SuspendingHttp {

    private val log = LoggerFactory.getLogger(SuspendingHttp::class.java)

    @Volatile
    private var timeouts: OutboundTimeouts = OutboundTimeouts.fromEnv()

    /** Total connections across all hosts, for the LLM client. */
    private val llmMaxTotal = envInt("HTTP_LLM_MAX_CONNECTIONS", 100)
    /** Per-host connections for the LLM client — the one that is usually wrong. */
    private val llmMaxPerHost = envInt("HTTP_LLM_MAX_PER_HOST", 50)

    private val toolMaxTotal = envInt("HTTP_TOOL_MAX_CONNECTIONS", 100)
    private val toolMaxPerHost = envInt("HTTP_TOOL_MAX_PER_HOST", 20)

    private fun envInt(name: String, default: Int) =
        System.getenv(name)?.trim()?.toIntOrNull() ?: default

    fun configure(policy: OutboundTimeouts) {
        timeouts = policy
    }

    fun policy(): OutboundTimeouts = timeouts

    // ── Clients ───────────────────────────────────────────────────────────────

    /**
     * LLM provider client. Separate from the tool client so a flood of tool calls
     * cannot consume the connections agent runs need, and so the two can carry
     * different per-host caps — providers tolerate far more concurrency than a
     * customer's own webhook endpoint.
     */
    val llm: HttpClient by lazy { buildClient("llm", llmMaxTotal, llmMaxPerHost) }

    /** HTTP tool client. Lower per-host cap: one slow endpoint must not starve the rest. */
    val tool: HttpClient by lazy { buildClient("tool", toolMaxTotal, toolMaxPerHost) }

    private fun buildClient(name: String, maxTotal: Int, maxPerHost: Int): HttpClient =
        HttpClient(CIO) {
            expectSuccess = false  // status handling belongs to the executors

            engine {
                // Total connections this engine will hold open, across all hosts.
                maxConnectionsCount = maxTotal

                endpoint {
                    // THE ONE THAT SILENTLY SERIALISES EVERYTHING IF LEFT DEFAULT.
                    maxConnectionsPerRoute = maxPerHost
                    // Bound the queue in front of those connections too, so
                    // backpressure surfaces as a timeout rather than an
                    // unbounded internal wait nothing can see.
                    pipelineMaxSize = 20
                    connectTimeout = timeouts.httpConnectTimeoutMs
                    keepAliveTime = 60_000
                    connectAttempts = 1  // retries are a policy decision, made above this layer
                }
            }

            install(HttpTimeout) {
                connectTimeoutMillis = timeouts.httpConnectTimeoutMs
                // Per-call values are supplied by the caller; these are ceilings.
                requestTimeoutMillis = timeouts.httpTotalCallCeilingMs
                socketTimeoutMillis = timeouts.httpHeadersTimeoutMs
            }
        }.also {
            log.info(
                "[http] suspending {} client ready [maxConnections={}, maxPerHost={}, connectTimeout={}ms]",
                name, maxTotal, maxPerHost, timeouts.httpConnectTimeoutMs,
            )
        }

    /**
     * Read the effective connection limits back and fail loudly on a mismatch.
     *
     * Called at startup. The failure this guards against is the quiet one: a
     * per-host cap that stayed at the engine default while the semaphores were
     * raised to hundreds, so concurrency looks configured, every metric looks
     * healthy, and throughput never moves because the engine is serialising
     * everything behind five connections.
     */
    fun verifyConnectionLimits() {
        var ok = true
        for ((name, client, wantTotal, wantPerHost) in listOf(
            Quad("llm", llm, llmMaxTotal, llmMaxPerHost),
            Quad("tool", tool, toolMaxTotal, toolMaxPerHost),
        )) {
            val cfg = runCatching {
                (client.engineConfig as io.ktor.client.engine.cio.CIOEngineConfig)
            }.getOrNull()

            if (cfg == null) {
                log.warn("[http] could not read {} engine config — connection limits UNVERIFIED", name)
                ok = false
                continue
            }

            val actualTotal = cfg.maxConnectionsCount
            val actualPerHost = cfg.endpoint.maxConnectionsPerRoute

            if (actualTotal != wantTotal || actualPerHost != wantPerHost) {
                log.error(
                    "[http] {} client connection limits DID NOT TAKE EFFECT — " +
                        "wanted total={}/perHost={}, engine reports total={}/perHost={}. " +
                        "Concurrency above the per-host limit will silently serialise.",
                    name, wantTotal, wantPerHost, actualTotal, actualPerHost,
                )
                ok = false
            } else {
                log.info("[http] {} connection limits verified: total={} perHost={}",
                    name, actualTotal, actualPerHost)
            }
        }
        if (!ok) {
            log.error("[http] ONE OR MORE CONNECTION LIMITS ARE UNVERIFIED — " +
                "treat measured concurrency numbers as suspect until resolved")
        }
    }

    private data class Quad(
        val name: String, val client: HttpClient, val total: Int, val perHost: Int,
    )

    // ── Bounded suspending send ───────────────────────────────────────────────

    data class Result(
        val statusCode: Int,
        val body: String,
        val headers: Map<String, List<String>>,
        val durationMs: Long,
    )

    class ResponseTooLargeException(val limitBytes: Long) :
        Exception("Response exceeded $limitBytes bytes and was aborted")

    class TotalCallTimeoutException(val budgetMs: Long) :
        Exception("Call exceeded its total budget of ${budgetMs}ms (connect + headers + body)")

    /**
     * Perform one bounded call, suspending throughout.
     *
     * The total-call ceiling covers body streaming, which a headers-phase timeout
     * does not — a server that answers 200 and then stalls the body has already
     * satisfied a request timeout. Here `withTimeoutOrNull` cancels the whole
     * coroutine, and Ktor releases the connection on cancellation.
     */
    suspend fun send(
        client: HttpClient,
        url: String,
        method: String,
        headers: Map<String, String>,
        body: String?,
        totalCallMs: Long,
        maxResponseBytes: Long,
    ): Result {
        val startedAt = System.nanoTime()

        val result = withTimeoutOrNull(totalCallMs) {
            val response: HttpResponse = client.request(url) {
                this.method = HttpMethod.parse(method.uppercase())
                headers.forEach { (k, v) -> this.headers.append(k, v) }
                body?.let { setBody(it) }
                applyPerCallTimeouts(totalCallMs)
            }
            val text = readBounded(response, maxResponseBytes)
            Result(
                statusCode = response.status.value,
                body = text,
                headers = response.headers.entries().associate { it.key to it.value },
                durationMs = (System.nanoTime() - startedAt) / 1_000_000,
            )
        }
        return result ?: throw TotalCallTimeoutException(totalCallMs)
    }

    private fun HttpRequestBuilder.applyPerCallTimeouts(totalCallMs: Long) {
        timeout {
            requestTimeoutMillis = totalCallMs
            connectTimeoutMillis = timeouts.httpConnectTimeoutMs
            socketTimeoutMillis = minOf(timeouts.httpHeadersTimeoutMs, totalCallMs)
        }
    }

    /**
     * Stream the body, aborting the moment the byte budget is exceeded.
     *
     * Enforced while reading rather than afterwards: checking the size of a fully
     * buffered string documents an allocation that already happened. With
     * hundreds of concurrent in-flight steps, that distinction is the difference
     * between a bounded heap and an OOM.
     */
    private suspend fun readBounded(response: HttpResponse, maxBytes: Long): String {
        val channel = response.bodyAsChannel()
        val out = java.io.ByteArrayOutputStream(8_192)
        var total = 0L
        while (!channel.isClosedForRead) {
            val packet = channel.readRemaining(8_192L)
            while (!packet.isEmpty) {
                val bytes = packet.readBytes()
                total += bytes.size
                if (total > maxBytes) {
                    channel.cancel(ResponseTooLargeException(maxBytes))
                    throw ResponseTooLargeException(maxBytes)
                }
                out.write(bytes)
            }
        }
        return String(out.toByteArray(), StandardCharsets.UTF_8)
    }

    fun close() {
        runCatching { llm.close() }
        runCatching { tool.close() }
    }
}
