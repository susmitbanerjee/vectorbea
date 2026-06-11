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
    private val endpoint: String,
    private val internalToken: String,
    private val environment: String,
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

    companion object {
        private val log = LoggerFactory.getLogger(TelemetryClient::class.java)
        val NOOP: TelemetryClient? = null

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

            log.info("[telemetry] enabled — endpoint={} env={}", endpoint, env)
            return TelemetryClient(endpoint = endpoint, internalToken = token, environment = env)
        }
    }
}
