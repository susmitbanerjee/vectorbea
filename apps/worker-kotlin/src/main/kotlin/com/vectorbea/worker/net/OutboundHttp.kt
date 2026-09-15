package com.vectorbea.worker.net

import com.vectorbea.worker.config.OutboundTimeouts
import org.slf4j.LoggerFactory
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.ByteBuffer
import java.nio.charset.StandardCharsets
import java.time.Duration
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executors
import java.util.concurrent.Flow
import java.util.concurrent.ThreadFactory
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import java.util.concurrent.atomic.AtomicInteger

/**
 * The worker's single outbound HTTP surface.
 *
 * PROBLEM THIS SOLVES
 * -------------------
 * `HttpRequest.timeout(...)` is **not** a total-call timeout. The JDK stops
 * counting once response *headers* arrive. A peer that answers `200 OK` and then
 * trickles — or stalls — the body holds the calling thread for as long as it
 * likes. On a worker whose agent pool is two threads wide, two such peers are
 * the entire platform's agent capacity.
 *
 * [send] closes that hole with four independent bounds:
 *
 *   1. **connect**  — [HttpClient.connectTimeout], 5s by default.
 *   2. **headers**  — [HttpRequest.timeout], surfaces a fast `HttpTimeoutException`.
 *   3. **total**    — the exchange runs on the client's executor; the caller waits
 *                     on `CompletableFuture.get(totalMs)` and `cancel(true)`s the
 *                     exchange on expiry. This covers body streaming, which (2)
 *                     does not, and it is what actually unparks the worker thread.
 *   4. **size**     — [BoundedBodySubscriber] cancels the subscription the moment
 *                     the byte budget is exceeded, so an unbounded body is aborted
 *                     mid-stream rather than buffered and measured afterwards.
 *
 * All executors share one [HttpClient] so connections are reused and the number
 * of selector threads is fixed. Creating a client per call (the previous
 * behaviour in `AgentBrainRunner` and `TelemetryClient`) leaks a selector thread
 * per call on JDK 17, where `HttpClient` is not `AutoCloseable`.
 */
object OutboundHttp {

    private val log = LoggerFactory.getLogger(OutboundHttp::class.java)

    @Volatile
    private var timeouts: OutboundTimeouts = OutboundTimeouts.fromEnv()

    /**
     * Install the process-wide timeout policy. Must be called before the first
     * [client] access for [OutboundTimeouts.httpConnectionPoolSize] to take
     * effect — the JDK reads that system property when the client is built.
     */
    fun configure(policy: OutboundTimeouts) {
        timeouts = policy
        // JDK HttpClient exposes no maxConnectionsTotal/perHost knob. What it does
        // expose is the size of the idle-connection cache. The real bound on
        // concurrent exchanges is the executor width below; both are reported.
        System.setProperty("jdk.httpclient.connectionPoolSize", policy.httpConnectionPoolSize.toString())
        System.setProperty("jdk.httpclient.keepalive.timeout", "60")
    }

    fun policy(): OutboundTimeouts = timeouts

    private val threadCounter = AtomicInteger(0)

    private val executor = Executors.newFixedThreadPool(
        timeouts.httpExecutorThreads,
        ThreadFactory { r ->
            Thread(r, "vectorbea-http-${threadCounter.incrementAndGet()}").apply { isDaemon = true }
        },
    )

    /** The one shared client. Built lazily so [configure] can run first. */
    val client: HttpClient by lazy {
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(timeouts.httpConnectTimeoutMs))
            .followRedirects(HttpClient.Redirect.NORMAL)
            .executor(executor)
            .build()
            .also {
                log.info(
                    "[http] shared outbound client ready [connectTimeout={}ms, executorThreads={}, connectionPoolSize={}]",
                    timeouts.httpConnectTimeoutMs, timeouts.httpExecutorThreads, timeouts.httpConnectionPoolSize,
                )
            }
    }

    /**
     * Pay the first-HTTPS-call cost at startup instead of inside a node.
     *
     * THE COLD START THIS REMOVES. The first outbound TLS request a JVM makes is
     * far more expensive than every one after it: the JSSE provider is loaded and
     * initialised, `SecureRandom` is seeded (which on a container with little
     * entropy can block for seconds), the cipher suites are negotiated for the
     * first time, and none of that code has been JIT-compiled. On the node path
     * that cost lands inside the node's wall-clock budget and inside the 5s
     * connect timeout, so the FIRST agent step of the first run after a deploy
     * fails and the retry — with everything warm — succeeds. That is the reported
     * "cold start problem", and no timeout value fixes it, because the work is
     * real; it just belongs at startup rather than in a user's run.
     *
     * Deliberately does no network I/O beyond a TLS handshake attempt against
     * the loopback address, which fails immediately. What matters is that
     * everything ABOVE the socket is initialised, and that happens whether or
     * not the connection succeeds. Nothing is contacted, nothing is sent, and a
     * worker with no egress warms up exactly as well as one with.
     *
     * Best-effort and non-blocking to the caller's correctness: any failure is
     * logged at debug and startup continues.
     */
    fun prewarm() {
        val started = System.nanoTime()
        try {
            // Building the client materialises the executor and the selector
            // threads. This alone is a meaningful part of the first-call cost.
            val ready = client
            // Forces JSSE + SecureRandom initialisation. 127.0.0.1:1 refuses
            // instantly on every platform, so this costs a failed connect, not a
            // timeout — and the cost we are paying is everything that happens
            // before the socket is reached.
            val request = HttpRequest.newBuilder()
                .uri(java.net.URI.create("https://127.0.0.1:1/"))
                .timeout(Duration.ofMillis(250))
                .GET()
                .build()
            runCatching { ready.send(request, HttpResponse.BodyHandlers.discarding()) }
            // Independently of the socket: initialising a default SSLContext is
            // the part that seeds SecureRandom, and it must happen even if the
            // request above was rejected before reaching TLS.
            runCatching { javax.net.ssl.SSLContext.getDefault().createSSLEngine() }
            log.info("[http] outbound stack prewarmed in {}ms", (System.nanoTime() - started) / 1_000_000)
        } catch (e: Throwable) {
            log.debug("[http] prewarm skipped: {}", e.message)
        }
    }

    /** Result of a bounded exchange. */
    data class Result(
        val statusCode: Int,
        val body: String,
        val headers: Map<String, List<String>>,
        val durationMs: Long,
    )

    /** The response exceeded [limitBytes] and was aborted mid-stream. */
    class ResponseTooLargeException(val limitBytes: Long) :
        Exception("Response exceeded $limitBytes bytes and was aborted")

    /** The call exceeded its total-call ceiling and the exchange was cancelled. */
    class TotalCallTimeoutException(val budgetMs: Long) :
        Exception("Call exceeded its total budget of ${budgetMs}ms (connect + headers + body)")

    /**
     * Apply the standard header timeout to [builder] and send it under a total
     * call ceiling of [totalCallMs] with a [maxResponseBytes] streaming cap.
     *
     * @param totalCallMs already clamped by [OutboundTimeouts.clampTotalCallMs].
     * @param headersTimeoutMs how long to wait for the response headers. Defaults to
     *   HTTP_HEADERS_TIMEOUT_MS. A model provider sends no headers until the whole
     *   completion is generated, so for those calls the wait for headers IS the
     *   call — LLM calls pass their total budget here, or a 30s headers limit cuts
     *   off every answer that takes longer than 30s to write.
     */
    fun send(
        builder: HttpRequest.Builder,
        totalCallMs: Long,
        maxResponseBytes: Long,
        httpClient: HttpClient = client,
        headersTimeoutMs: Long = timeouts.httpHeadersTimeoutMs,
    ): Result {
        val headersBudget = minOf(headersTimeoutMs, totalCallMs)
        val request = builder.timeout(Duration.ofMillis(headersBudget)).build()
        return send(request, totalCallMs, maxResponseBytes, httpClient)
    }

    fun send(
        request: HttpRequest,
        totalCallMs: Long,
        maxResponseBytes: Long,
        httpClient: HttpClient = client,
    ): Result {
        val startedAt = System.nanoTime()
        val future: CompletableFuture<HttpResponse<String>> =
            httpClient.sendAsync(request) { _ -> BoundedBodySubscriber(maxResponseBytes) }

        val response = try {
            future.get(totalCallMs, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            // Cancelling the future aborts the underlying exchange and closes the
            // connection, so the socket is released rather than merely abandoned.
            future.cancel(true)
            throw TotalCallTimeoutException(totalCallMs)
        } catch (e: ExecutionException) {
            throw unwrap(e)
        } catch (e: InterruptedException) {
            future.cancel(true)
            Thread.currentThread().interrupt()
            throw e
        }

        val durationMs = (System.nanoTime() - startedAt) / 1_000_000
        return Result(response.statusCode(), response.body(), response.headers().map(), durationMs)
    }

    private fun unwrap(e: ExecutionException): Exception {
        val cause = e.cause
        return if (cause is Exception) cause else e
    }

    // ── Bounded body subscriber ───────────────────────────────────────────────

    /**
     * Accumulates the body as UTF-8, cancelling the subscription as soon as the
     * byte budget is exceeded. The cap is enforced **while** reading, not after —
     * so a 10 GB response never becomes a 10 GB heap allocation.
     */
    private class BoundedBodySubscriber(
        private val maxBytes: Long,
    ) : HttpResponse.BodySubscriber<String> {

        private val result = CompletableFuture<String>()
        private val buffer = java.io.ByteArrayOutputStream(8_192)
        private var total = 0L

        @Volatile
        private var subscription: Flow.Subscription? = null

        override fun getBody(): CompletableFuture<String> = result

        override fun onSubscribe(s: Flow.Subscription) {
            subscription = s
            s.request(Long.MAX_VALUE)
        }

        override fun onNext(items: MutableList<ByteBuffer>) {
            for (item in items) {
                val n = item.remaining()
                if (total + n > maxBytes) {
                    subscription?.cancel()
                    result.completeExceptionally(ResponseTooLargeException(maxBytes))
                    return
                }
                total += n
                val chunk = ByteArray(n)
                item.get(chunk)
                buffer.write(chunk)
            }
        }

        override fun onError(throwable: Throwable) {
            result.completeExceptionally(throwable)
        }

        override fun onComplete() {
            result.complete(String(buffer.toByteArray(), StandardCharsets.UTF_8))
        }
    }
}
