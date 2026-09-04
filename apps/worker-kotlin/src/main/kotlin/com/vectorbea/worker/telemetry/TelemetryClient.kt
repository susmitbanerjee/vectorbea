package com.vectorbea.worker.telemetry

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.vectorbea.worker.net.OutboundHttp
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.http.HttpRequest
import java.time.Instant
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Best-effort analytics client for worker-kotlin.
 *
 * Telemetry failure must never interrupt workflow execution.
 * Events are dispatched on a background thread.
 *
 * Note: run_events (customer-facing workflow timeline) are written durably
 * through RunEventRepository — not through this client. This client is for
 * business/product analytics only.
 */
class TelemetryClient private constructor(
    private val endpoint: String,
    private val internalToken: String,
    private val environment: String,
) {
    private val log = LoggerFactory.getLogger(TelemetryClient::class.java)

    /**
     * Bounded, daemon, and drop-on-full. A cached pool with an untimed HTTP
     * client meant a stalled telemetry endpoint grew one thread per tracked
     * event without limit. Analytics must never be able to exhaust the process.
     */
    private val executor = ThreadPoolExecutor(
        0, TELEMETRY_THREADS,
        30L, TimeUnit.SECONDS,
        LinkedBlockingQueue(TELEMETRY_QUEUE_DEPTH),
        ThreadFactory { r -> Thread(r, "telemetry-dispatch").apply { isDaemon = true } },
        ThreadPoolExecutor.DiscardPolicy(),
    )
    private val mapper = ObjectMapper().registerKotlinModule()

    fun track(
        eventName: String,
        eventCategory: String,
        workspaceId: String? = null,
        appUserId: String? = null,
        runId: String? = null,
        workflowId: String? = null,
        agentId: String? = null,
        toolId: String? = null,
        properties: Map<String, Any?> = emptyMap(),
    ) {
        executor.execute {
            try {
                val body = mapper.writeValueAsString(mapOf(
                    "events" to listOf(mapOf(
                        "eventName" to eventName,
                        "eventCategory" to eventCategory,
                        "occurredAt" to Instant.now().toString(),
                        "environment" to environment,
                        "workspaceId" to workspaceId,
                        "appUserId" to appUserId,
                        "runId" to runId,
                        "workflowId" to workflowId,
                        "agentId" to agentId,
                        "toolId" to toolId,
                        "sourceService" to "vectorbea-worker",
                        "properties" to properties,
                    ))
                ))

                val req = HttpRequest.newBuilder()
                    .uri(URI.create("$endpoint/internal/telemetry/events"))
                    .header("Content-Type", "application/json")
                    .header("X-Telemetry-Token", internalToken)
                    .header("X-Source-Service", "vectorbea-worker")
                    .POST(HttpRequest.BodyPublishers.ofString(body))

                val resp = OutboundHttp.send(
                    req,
                    totalCallMs = OutboundHttp.policy().telemetryTotalCallMs,
                    maxResponseBytes = 65_536L,
                )
                if (resp.statusCode !in 200..299) {
                    log.warn("[telemetry] event rejected: status={}", resp.statusCode)
                } else {
                    log.debug("[telemetry] tracked event={}", eventName)
                }
            } catch (e: Exception) {
                // Telemetry failure must not propagate — log and continue
                log.warn("[telemetry] failed to send event={}: {}", eventName, e.message)
            }
        }
    }

    companion object {
        private val log = LoggerFactory.getLogger(TelemetryClient::class.java)

        /** Hard cap on dispatch threads — analytics never competes for execution slots. */
        private const val TELEMETRY_THREADS = 4
        /** Beyond this backlog, events are dropped rather than queued. */
        private const val TELEMETRY_QUEUE_DEPTH = 256

        fun fromEnv(): TelemetryClient? {
            val enabled = System.getenv("TELEMETRY_ENABLED")?.lowercase() == "true"
            if (!enabled) return null
            val endpoint = System.getenv("TELEMETRY_ENDPOINT")?.trimEnd('/') ?: return null
            val token = System.getenv("TELEMETRY_INTERNAL_TOKEN") ?: return null
            val env = System.getenv("VECTORBEA_ENV")?.lowercase()
                ?.takeIf { it in setOf("dev", "stage", "prod") } ?: "prod"
            log.info("[telemetry] worker client enabled — endpoint={} env={}", endpoint, env)
            return TelemetryClient(endpoint = endpoint, internalToken = token, environment = env)
        }
    }
}
