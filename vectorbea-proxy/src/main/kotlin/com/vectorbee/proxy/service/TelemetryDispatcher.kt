package com.vectorbea.proxy.service

import com.vectorbea.proxy.config.AppConfig
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.content.TextContent
import io.ktor.http.isSuccess
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
 * samples to the dedicated telemetry service. Local Docker testing does not
 * always have that endpoint available, so telemetry can be disabled via config.
 */
class TelemetryDispatcher(
    private val config: AppConfig,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val logger = LoggerFactory.getLogger(TelemetryDispatcher::class.java)
    private val enabled = config.telemetryEnabled

    private val latencySumMs = DoubleAdder()
    private val latencyCount = AtomicLong(0)
    private val executionBuffer = ConcurrentLinkedQueue<ExecutionSample>()

    private val httpClient by lazy(LazyThreadSafetyMode.NONE) {
        HttpClient(OkHttp) {
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
            defaultRequest {
                header(HttpHeaders.Authorization, "Bearer ${config.apiKey}")
                header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
            }
        }
    }

    fun recordLatency(proxyLatencyMs: Double) {
        if (!enabled) return
        latencySumMs.add(proxyLatencyMs)
        latencyCount.incrementAndGet()
    }

    fun recordExecution(
        promptName: String,
        latencyMs: Double,
        tokensUsed: Int,
    ) {
        if (!enabled) return
        executionBuffer.add(ExecutionSample(promptName, latencyMs, tokensUsed))
        while (executionBuffer.size > 2_000) {
            executionBuffer.poll()
        }
    }

    fun start() {
        if (!enabled) {
            logger.info(
                "TelemetryDispatcher disabled for this runtime. Set VECTORBEA_ENABLE_TELEMETRY=true and VECTORBEA_TELEMETRY_URL to enable telemetry pushes.",
            )
            return
        }

        scope.launch { runWorker() }
        logger.info(
            "TelemetryDispatcher started - pushing to {} every {} ms, env={}, hostId={}",
            config.telemetryUrl,
            config.telemetryIntervalMs,
            config.environment,
            config.proxyHostId,
        )
    }

    fun stop() {
        if (!enabled) return
        httpClient.close()
    }

    private suspend fun runWorker() {
        delay(5_000)

        while (scope.isActive) {
            runCatching { push() }
                .onFailure { ex ->
                    logger.warn(
                        "[telemetry] Push to {} failed - will retry next cycle: {}",
                        config.telemetryUrl,
                        ex.message,
                    )
                }

            delay(config.telemetryIntervalMs)
        }
    }

    private suspend fun push() {
        val count = latencyCount.getAndSet(0)
        val sum = latencySumMs.sumThenReset()
        val avgMs = if (count == 0L) 0.0 else sum / count

        val metrics = buildList {
            add(MetricPoint("latency", avgMs))
            add(MetricPoint("cpu_usage", jvmCpuPercent()))
            add(MetricPoint("memory_usage", jvmHeapUsedMb()))
        }

        val executions = buildList<ExecutionPoint> {
            repeat(minOf(executionBuffer.size, 500)) {
                val sample = executionBuffer.poll() ?: return@repeat
                add(ExecutionPoint(sample.promptName, sample.latencyMs, sample.tokensUsed))
            }
        }

        if (metrics.all { it.value == 0.0 } && executions.isEmpty()) {
            logger.trace("[telemetry] No data to push - skipping cycle")
            return
        }

        val payload = IngestPayload(
            environment = config.environment,
            proxyHostId = config.proxyHostId,
            metrics = metrics,
            promptExecutions = executions,
        )

        val response = httpClient.post("${config.telemetryUrl}/api/ingest") {
            setBody(
                TextContent(
                    Json.encodeToString(IngestPayload.serializer(), payload),
                    ContentType.Application.Json,
                ),
            )
        }

        if (!response.status.isSuccess()) {
            val body = runCatching { response.bodyAsText() }.getOrElse { "<unreadable>" }
            logger.warn(
                "[telemetry] Ingest returned {} - body: {}",
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

    private fun jvmHeapUsedMb(): Double {
        val rt = Runtime.getRuntime()
        return (rt.totalMemory() - rt.freeMemory()).toDouble() / (1024 * 1024)
    }

    private fun jvmCpuPercent(): Double = SystemMetrics.cpuPercent()

    private data class ExecutionSample(
        val promptName: String,
        val latencyMs: Double,
        val tokensUsed: Int,
    )
}

@Serializable
internal data class IngestPayload(
    val environment: String,
    val proxyHostId: String,
    val metrics: List<MetricPoint>,
    val promptExecutions: List<ExecutionPoint>,
)

@Serializable
internal data class MetricPoint(
    val name: String,
    val value: Double,
)

@Serializable
internal data class ExecutionPoint(
    val promptName: String,
    val latencyMs: Double,
    val tokensUsed: Int,
)
