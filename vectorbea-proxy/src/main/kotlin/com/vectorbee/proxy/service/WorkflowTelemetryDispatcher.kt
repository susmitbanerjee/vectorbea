package com.vectorbea.proxy.service

import com.vectorbea.proxy.client.HubClient
import com.vectorbea.proxy.config.AppConfig
import com.vectorbea.proxy.model.WorkflowEventPayload
import com.vectorbea.proxy.model.WorkflowTelemetryHealth
import com.vectorbea.proxy.model.WorkflowTraceBatchForwardRequest
import com.vectorbea.proxy.model.WorkflowTraceEnvelope
import java.time.Instant
import java.util.ArrayDeque
import java.util.concurrent.ThreadLocalRandom
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.slf4j.LoggerFactory

class WorkflowTelemetryDispatcher(
    private val config: AppConfig,
    private val hubClient: HubClient,
    private val json: Json,
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.IO),
) {
    private val logger = LoggerFactory.getLogger(WorkflowTelemetryDispatcher::class.java)
    private val queue = ArrayDeque<WorkflowTraceEnvelope>()
    private val eventsReceivedTotal = AtomicLong(0)
    private val eventsForwardedTotal = AtomicLong(0)
    private val eventsFailedTotal = AtomicLong(0)
    private val eventsDroppedTotal = AtomicLong(0)
    private val redactionCount = AtomicLong(0)

    @Volatile private var lastFlushAt: String? = null
    @Volatile private var lastBackendStatus: String = "unknown"

    private val sidecarVersion: String =
        WorkflowTelemetryDispatcher::class.java.`package`?.implementationVersion ?: "dev"

    fun start() {
        scope.launch { runWorker() }
    }

    fun stop() {
        // Background coroutine stops when process exits; queue is in-memory only for now.
    }

    fun tryEnqueue(trace: WorkflowTraceEnvelope): Boolean {
        if (config.sampleRate < 1.0 && ThreadLocalRandom.current().nextDouble() > config.sampleRate) {
            eventsDroppedTotal.incrementAndGet()
            return config.failOpen
        }

        val sanitized = sanitizeTrace(trace)
        eventsReceivedTotal.addAndGet(sanitized.events.size.toLong())

        synchronized(queue) {
            if (queue.size >= config.maxQueueSize) {
                eventsDroppedTotal.addAndGet(sanitized.events.size.toLong())
                if (!config.failOpen) {
                    return false
                }
                return true
            }
            queue.addLast(sanitized)
        }
        return true
    }

    fun snapshot(): WorkflowTelemetryHealth =
        WorkflowTelemetryHealth(
            status = if (lastBackendStatus.startsWith("error")) "degraded" else "ok",
            sidecarVersion = sidecarVersion,
            queueSize = synchronized(queue) { queue.size },
            lastFlushAt = lastFlushAt,
            lastBackendStatus = lastBackendStatus,
            eventsReceivedTotal = eventsReceivedTotal.get(),
            eventsForwardedTotal = eventsForwardedTotal.get(),
            eventsFailedTotal = eventsFailedTotal.get(),
            eventsDroppedTotal = eventsDroppedTotal.get(),
            redactionCount = redactionCount.get(),
        )

    fun prometheusMetrics(): String {
        val health = snapshot()
        return buildString {
            appendLine("vectorbea_events_received_total ${health.eventsReceivedTotal}")
            appendLine("vectorbea_events_forwarded_total ${health.eventsForwardedTotal}")
            appendLine("vectorbea_events_failed_total ${health.eventsFailedTotal}")
            appendLine("vectorbea_events_dropped_total ${health.eventsDroppedTotal}")
            appendLine("vectorbea_queue_size ${health.queueSize}")
            appendLine("vectorbea_redaction_count ${health.redactionCount}")
        }
    }

    private suspend fun runWorker() {
        var retryDelayMs = 1_000L
        while (scope.isActive) {
            delay(config.flushIntervalMillis)
            val batch = drainBatch()
            if (batch.isEmpty()) continue

            try {
                hubClient.forwardWorkflowBatch(
                    WorkflowTraceBatchForwardRequest(
                        sidecarVersion = sidecarVersion,
                        serviceName = config.serviceName,
                        environment = config.environment,
                        traces = batch,
                    ),
                )
                eventsForwardedTotal.addAndGet(batch.sumOf { it.events.size }.toLong())
                lastFlushAt = Instant.now().toString()
                lastBackendStatus = "ok"
                retryDelayMs = 1_000L
            } catch (ex: Exception) {
                logger.warn("Workflow batch forward failed for {} traces: {}", batch.size, ex.message)
                eventsFailedTotal.addAndGet(batch.sumOf { it.events.size }.toLong())
                requeue(batch)
                lastBackendStatus = "error:${ex.message ?: "unknown"}"
                delay(retryDelayMs)
                retryDelayMs = (retryDelayMs * 2).coerceAtMost(30_000L)
            }
        }
    }

    private fun drainBatch(): List<WorkflowTraceEnvelope> =
        synchronized(queue) {
            buildList(capacity = minOf(queue.size, config.flushBatchSize)) {
                repeat(minOf(queue.size, config.flushBatchSize)) {
                    add(queue.removeFirst())
                }
            }
        }

    private fun requeue(batch: List<WorkflowTraceEnvelope>) {
        synchronized(queue) {
            batch.asReversed().forEach { queue.addFirst(it) }
        }
    }

    private fun sanitizeTrace(trace: WorkflowTraceEnvelope): WorkflowTraceEnvelope {
        fun redact(element: JsonElement?, allow: Boolean): JsonElement {
            if (!allow) return JsonNull
            val result = WorkflowRedactor.redact(element, aggressive = config.redactSecrets)
            redactionCount.addAndGet(result.redactionCount)
            return result.element
        }

        val metadataResult = WorkflowRedactor.redact(trace.metadata, aggressive = config.redactSecrets)
        redactionCount.addAndGet(metadataResult.redactionCount)

        val enrichedMetadata = buildJsonObject {
            metadataResult.element as? JsonObject ?: JsonObject(emptyMap())
            (metadataResult.element as? JsonObject)?.forEach { (key, value) -> put(key, value) }
            put("ingestion_mode", "sidecar")
            put("sidecar_version", sidecarVersion)
            put("service_name", trace.serviceName ?: config.serviceName)
            put("environment", trace.environment ?: config.environment)
            config.clusterName?.let { put("cluster_name", it) }
            config.namespace?.let { put("namespace", it) }
            config.podName?.let { put("pod_name", it) }
            config.containerName?.let { put("container_name", it) }
            put("hostname", config.proxyHostId)
        }

        return trace.copy(
            source = "sidecar",
            environment = trace.environment ?: config.environment,
            serviceName = trace.serviceName ?: config.serviceName,
            metadata = enrichedMetadata,
            events = trace.events.map { event ->
                val inputRedacted = redact(event.input, config.captureInputs)
                val outputRedacted = redact(event.output, config.captureOutputs)
                val responseRedacted = redact(event.response, config.captureOutputs)
                val resultRedacted = redact(event.result, config.captureOutputs)
                val argumentsRedacted = redact(event.arguments, config.captureInputs)
                val docsRedacted = redact(event.documents, config.captureOutputs)
                val scoresRedacted = redact(event.scores, allow = true)
                val eventMetadata = WorkflowRedactor.redact(event.metadata, aggressive = config.redactSecrets)
                redactionCount.addAndGet(eventMetadata.redactionCount)

                event.copy(
                    input = inputRedacted,
                    output = outputRedacted,
                    response = responseRedacted,
                    result = resultRedacted,
                    arguments = argumentsRedacted,
                    documents = docsRedacted,
                    scores = scoresRedacted,
                    metadata = buildJsonObject {
                        (eventMetadata.element as? JsonObject)?.forEach { (key, value) -> put(key, value) }
                        put("source_mode", "sidecar")
                    },
                )
            },
        )
    }
}
