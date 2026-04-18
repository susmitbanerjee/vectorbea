package com.vectorbea.proxy.service

import com.vectorbea.proxy.config.AppConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import java.lang.management.ManagementFactory
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.DoubleAdder
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.ConnectionPool
import okhttp3.Protocol
import org.slf4j.LoggerFactory

/**
 * Background worker that pushes infrastructure metrics and prompt-execution
 * samples to the dedicated telemetry service (`dev-telemetry.vectorbea.com`).
 *
 * Architecture notes
 * ──────────────────
 * • **Completely decoupled from AuditDispatcher**: uses its own HTTP client,
 *   its own latency accumulator, and its own coroutine scope. The control-plane
 *   hub and the telemetry service can be on different domains / VPCs without
 *   any code entanglement.
 *
 * • **Zero hot-path overhead**: [recordExecution] and [recordLatency] are both
 *   lock-free (DoubleAdder / ConcurrentLinkedQueue). They are called directly
 *   from the gRPC request thread and return in < 100 ns.
 *
 * • **Fail-open**: every push failure is logged and silently swallowed. Telemetry
 *   must never degrade the proxy's ability to serve prompt requests.
 *
 * • **Auth**: the sidecar presents its [AppConfig.apiKey] (= deployment_agents
 *   .api_token) as the Bearer token. The telemetry ingest route validates this
 *   against the same DB table that the control-plane uses — no separate secret.
 */
class TelemetryDispatcher(
    private val config: AppConfig,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val logger = LoggerFactory.getLogger(TelemetryDispatcher::class.java)

    // ── Lock-free latency accumulator (same technique as AuditDispatcher) ────
    private val latencySumMs  = DoubleAdder()
    private val latencyCount  = AtomicLong(0)

    // ── Prompt-execution buffer: drained and batched on every flush cycle ────
    // ConcurrentLinkedQueue is wait-free for producers and cheap to drain from
    // a single consumer (the flush coroutine).
    private val executionBuffer = ConcurrentLinkedQueue<ExecutionSample>()

    // ── Dedicated HTTP/2 client pointing at telemetryUrl ─────────────────────
    private val httpClient = HttpClient(OkHttp) {
        engine {
            config {
                protocols(listOf(Protocol.HTTP_2, Protocol.HTTP_1_1))
                connectionPool(ConnectionPool(5, 5, TimeUnit.MINUTES))
                connectTimeout(3, TimeUnit.SECONDS)
                readTimeout(10, TimeUnit.SECONDS)
                writeTimeout(5, TimeUnit.SECONDS)
                pingInterval(30, TimeUnit.SECONDS)
            }
        }
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true; explicitNulls = false })
        }
        defaultRequest {
            // The sidecar's api_token is the same credential used for prompt
            // fetches and audit POSTs — no separate telemetry secret required.
            header(HttpHeaders.Authorization, "Bearer ${config.apiKey}")
            header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
        }
    }

    // ── Public API (called from gRPC hot path, must be lock-free) ────────────

    /**
     * Record the proxy-side latency for a single prompt execution.
     * Called from [com.vectorbea.proxy.grpc.VectorBeaGrpcService.logAudit]
     * alongside [AuditDispatcher.tryEnqueue].
     */
    fun recordLatency(proxyLatencyMs: Double) {
        latencySumMs.add(proxyLatencyMs)
        latencyCount.incrementAndGet()
    }

    /**
     * Buffer one prompt execution for inclusion in the next telemetry batch.
     * The buffer is drained asynchronously; this call never blocks.
     */
    fun recordExecution(
        promptName: String,
        latencyMs: Double,
        tokensUsed: Int,
    ) {
        executionBuffer.add(ExecutionSample(promptName, latencyMs, tokensUsed))
        // Coarse cap: if the buffer exceeds 2000 entries the flush coroutine
        // is behind — drop the oldest to avoid unbounded memory growth.
        while (executionBuffer.size > 2_000) {
            executionBuffer.poll()
        }
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun start() {
        scope.launch { runWorker() }
        logger.info(
            "TelemetryDispatcher started — pushing to {} every {} ms, env={}, hostId={}",
            config.telemetryUrl,
            config.telemetryIntervalMs,
            config.environment,
            config.proxyHostId,
        )
    }

    fun stop() {
        httpClient.close()
    }

    // ── Worker loop ───────────────────────────────────────────────────────────

    private suspend fun runWorker() {
        // Initial delay: let the proxy finish binding sockets and JIT-warm
        // before the first push so the first batch isn't cold-path heavy.
        delay(5_000)

        while (scope.isActive) {
            runCatching { push() }
                .onFailure { ex ->
                    // Telemetry failures must never surface as proxy errors.
                    logger.warn(
                        "[telemetry] Push to {} failed — will retry next cycle: {}",
                        config.telemetryUrl,
                        ex.message,
                    )
                }

            delay(config.telemetryIntervalMs)
        }
    }

    private suspend fun push() {
        // ── 1. Snapshot and reset latency accumulator ─────────────────────
        val count  = latencyCount.getAndSet(0)
        val sum    = latencySumMs.sumThenReset()
        val avgMs  = if (count == 0L) 0.0 else sum / count

        // ── 2. Build metric list ──────────────────────────────────────────
        val metrics = buildList {
            add(MetricPoint("latency",      avgMs))
            add(MetricPoint("cpu_usage",    jvmCpuPercent()))
            add(MetricPoint("memory_usage", jvmHeapUsedMb()))
        }

        // ── 3. Drain the execution buffer (up to 500 per batch) ───────────
        val executions = buildList<ExecutionPoint> {
            repeat(minOf(executionBuffer.size, 500)) {
                val sample = executionBuffer.poll() ?: return@repeat
                add(ExecutionPoint(sample.promptName, sample.latencyMs, sample.tokensUsed))
            }
        }

        // Skip the network round-trip if there is truly nothing to report
        // (e.g. sidecar just started with no traffic yet).
        if (metrics.all { it.value == 0.0 } && executions.isEmpty()) {
            logger.trace("[telemetry] No data to push — skipping cycle")
            return
        }

        // ── 4. POST to ${telemetryUrl}/api/ingest ─────────────────────────
        val payload = IngestPayload(
            environment      = config.environment,
            proxyHostId      = config.proxyHostId,
            metrics          = metrics,
            promptExecutions = executions,
        )

        val response = httpClient.post("${config.telemetryUrl}/api/ingest") {
            setBody(payload)
        }

        if (!response.status.isSuccess()) {
            val body = runCatching { response.bodyAsText() }.getOrElse { "<unreadable>" }
            // Log at WARN — don't throw, caller already wraps in runCatching.
            logger.warn(
                "[telemetry] Ingest returned {} — body: {}",
                response.status.value,
                body,
            )
            return
        }

        logger.debug(
            "[telemetry] Pushed {} metrics + {} executions (avgLatency={} ms)",
            metrics.size,
            executions.size,
            "%.1f".format(avgMs),
        )
    }

    // ── JVM metric helpers (same as AuditDispatcher) ─────────────────────────

    private fun jvmHeapUsedMb(): Double {
        val rt = Runtime.getRuntime()
        return (rt.totalMemory() - rt.freeMemory()).toDouble() / (1024 * 1024)
    }

    private fun jvmCpuPercent(): Double = try {
        val bean = ManagementFactory.getOperatingSystemMXBean()
        if (bean is com.sun.management.OperatingSystemMXBean) {
            val load = bean.processCpuLoad
            if (load > 0.0) load * 100.0
            else {
                val sys = bean.systemCpuLoad
                if (sys > 0.0) sys * 100.0 else 0.0
            }
        } else {
            val avg = bean.systemLoadAverage
            if (avg > 0.0) (avg / Runtime.getRuntime().availableProcessors()) * 100.0 else 0.0
        }
    } catch (_: Exception) { 0.0 }

    // ── Private data structures ───────────────────────────────────────────────

    private data class ExecutionSample(
        val promptName: String,
        val latencyMs: Double,
        val tokensUsed: Int,
    )
}

// ── Serializable payload types ────────────────────────────────────────────────
// Must match the Zod schema in vectorbea-telemetry/app/api/ingest/route.ts.

@Serializable
private data class IngestPayload(
    val environment:      String,
    val proxyHostId:      String,
    val metrics:          List<MetricPoint>,
    val promptExecutions: List<ExecutionPoint>,
)

@Serializable
private data class MetricPoint(
    val name:  String,
    val value: Double,
)

@Serializable
private data class ExecutionPoint(
    val promptName: String,
    val latencyMs:  Double,
    val tokensUsed: Int,
)
