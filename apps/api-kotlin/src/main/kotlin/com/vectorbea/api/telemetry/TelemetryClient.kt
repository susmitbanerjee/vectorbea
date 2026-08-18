package com.vectorbea.api.telemetry

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Instant
import java.util.concurrent.Executors

/**
 * Best-effort analytics client for api-kotlin.
 *
 * Events are dispatched on a background thread. Telemetry failure never
 * blocks or fails the calling API flow.
 *
 * Configuration:
 *  TELEMETRY_ENABLED=true
 *  TELEMETRY_ENDPOINT=https://telemetry.vectorbea.com
 *  TELEMETRY_INTERNAL_TOKEN=<secret>
 *  VECTORBEA_ENV=dev|stage|prod
 */
class TelemetryClient private constructor(
    private val endpoint: String?,
    private val internalToken: String?,
    private val environment: String,
    /**
     * In-process ingestion, set when analytics runs inside this JVM.
     *
     * When present the HTTP path is not used at all. The API posting events to its own
     * `/internal/telemetry/events` would be a loopback request that serialises, opens a
     * socket, re-authenticates against a token it configured itself, and re-parses -
     * for a write it could do directly. It would also make the API's analytics depend
     * on the API's own HTTP server being healthy, which is precisely the moment you
     * most want the event recorded.
     *
     * The HTTP path is kept for the worker, which is a different process.
     */
    private val local: com.vectorbea.observability.analytics.AnalyticsIngestionService? = null,
) {
    private val log = LoggerFactory.getLogger(TelemetryClient::class.java)
    private val executor = Executors.newCachedThreadPool()
    private val http = HttpClient.newHttpClient()
    private val mapper = ObjectMapper().registerKotlinModule()

    /**
     * Tracks an analytics event. Fire-and-forget — never throws.
     * Do NOT pass secrets, raw prompts, or PII in properties.
     */
    fun track(
        eventName: String,
        eventCategory: String,
        workspaceId: String? = null,
        environmentId: String? = null,
        appUserId: String? = null,
        runId: String? = null,
        workflowId: String? = null,
        connectionId: String? = null,
        architectSessionId: String? = null,
        agentId: String? = null,
        toolId: String? = null,
        properties: Map<String, Any?> = emptyMap(),
    ) {
        executor.execute {
            try {
                if (local != null) {
                    trackLocally(
                        eventName, eventCategory, workspaceId, environmentId, appUserId,
                        runId, workflowId, connectionId, architectSessionId, agentId,
                        toolId, properties,
                    )
                    return@execute
                }
                val body = mapper.writeValueAsString(mapOf(
                    "events" to listOf(mapOf(
                        "eventName" to eventName,
                        "eventCategory" to eventCategory,
                        "occurredAt" to Instant.now().toString(),
                        "environment" to environment,
                        "workspaceId" to workspaceId,
                        "environmentId" to environmentId,
                        "appUserId" to appUserId,
                        "runId" to runId,
                        "workflowId" to workflowId,
                        "connectionId" to connectionId,
                        "architectSessionId" to architectSessionId,
                        "agentId" to agentId,
                        "toolId" to toolId,
                        "sourceService" to "vectorbea-api",
                        "properties" to properties,
                    ))
                ))

                val req = HttpRequest.newBuilder()
                    .uri(URI.create("$endpoint/internal/telemetry/events"))
                    .header("Content-Type", "application/json")
                    .header("X-Telemetry-Token", internalToken)
                    .header("X-Source-Service", "vectorbea-api")
                    .POST(HttpRequest.BodyPublishers.ofString(body))
                    .build()

                val response = http.send(req, HttpResponse.BodyHandlers.ofString())
                if (response.statusCode() !in 200..299) {
                    log.warn("[telemetry] event rejected: status={} body={}", response.statusCode(), response.body().take(200))
                } else {
                    log.debug("[telemetry] tracked event={}", eventName)
                }
            } catch (e: Exception) {
                // Telemetry failure must not propagate — log and continue
                log.warn("[telemetry] failed to send event={}: {}", eventName, e.message)
            }
        }
    }

    private fun trackLocally(
        eventName: String, eventCategory: String, workspaceId: String?, environmentId: String?,
        appUserId: String?, runId: String?, workflowId: String?, connectionId: String?,
        architectSessionId: String?, agentId: String?, toolId: String?,
        properties: Map<String, Any?>,
    ) {
        val result = local!!.ingestBatch(
            com.vectorbea.observability.analytics.IngestBatchRequest(
                events = listOf(com.vectorbea.observability.analytics.IngestEventRequest(
                    eventName = eventName,
                    eventCategory = eventCategory,
                    occurredAt = Instant.now().toString(),
                    environment = environment,
                    workspaceId = workspaceId,
                    environmentId = environmentId,
                    appUserId = appUserId,
                    runId = runId,
                    workflowId = workflowId,
                    connectionId = connectionId,
                    architectSessionId = architectSessionId,
                    agentId = agentId,
                    toolId = toolId,
                    properties = properties,
                ))
            ),
            sourceService = "vectorbea-api",
        )
        if (result.rejected > 0) {
            log.warn("[telemetry] event {} rejected: {}", eventName, result.errors.take(2))
        }
    }

    companion object {
        private val log = LoggerFactory.getLogger(TelemetryClient::class.java)
        val NOOP: TelemetryClient? = null

        /**
         * In-process client — the arrangement after the fold.
         *
         * Note there is no `TELEMETRY_ENABLED` gate here. That flag existed because the
         * remote service might not be deployed; a library that is on the classpath is
         * always deployed. Analytics now follows the database: if there is one, events
         * are recorded.
         */
        fun local(
            ingestion: com.vectorbea.observability.analytics.AnalyticsIngestionService,
            environment: String,
        ): TelemetryClient {
            log.info("[telemetry] in-process — no network hop, env={}", environment)
            return TelemetryClient(endpoint = null, internalToken = null,
                environment = environment, local = ingestion)
        }

        fun fromEnv(): TelemetryClient? {
            val enabled = System.getenv("TELEMETRY_ENABLED")?.lowercase() == "true"
            if (!enabled) {
                log.info("[telemetry] disabled (TELEMETRY_ENABLED != true)")
                return null
            }
            val endpoint = System.getenv("TELEMETRY_ENDPOINT")?.trimEnd('/')
            val token = System.getenv("TELEMETRY_INTERNAL_TOKEN")
            val env = System.getenv("VECTORBEA_ENV")?.lowercase()
                ?.takeIf { it in setOf("dev", "stage", "prod") } ?: "prod"

            if (endpoint == null || token == null) {
                log.warn("[telemetry] TELEMETRY_ENDPOINT or TELEMETRY_INTERNAL_TOKEN not set — disabled")
                return null
            }

            log.info("[telemetry] enabled over HTTP — endpoint={} env={}", endpoint, env)
            return TelemetryClient(endpoint = endpoint, internalToken = token, environment = env)
        }
    }
}
