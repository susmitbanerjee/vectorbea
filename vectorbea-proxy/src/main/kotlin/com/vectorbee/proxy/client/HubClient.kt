package com.vectorbea.proxy.client

import com.vectorbea.proxy.config.AppConfig
import com.vectorbea.proxy.model.AuditEvent
import com.vectorbea.proxy.model.PromptPayload
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.accept
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.encodeURLPathPart
import io.ktor.http.isSuccess
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

class HubClient(private val config: AppConfig) {
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    private val client = HttpClient(CIO) {
        install(ContentNegotiation) {
            json(json)
        }
        defaultRequest {
            url(config.hubUrl)
            header(HttpHeaders.Authorization, "Bearer ${config.apiKey}")
            accept(ContentType.Application.Json)
            header(HttpHeaders.ContentType, ContentType.Application.Json.toString())
        }
    }

    suspend fun fetchPrompt(name: String): PromptPayload {
        val response = client.get("${config.hubUrl}/api/proxy/prompts/${name.encodeURLPathPart()}")
        if (!response.status.isSuccess()) {
            // Read the raw body so the caller sees the actual hub error message
            // (e.g. "Prompt not found", "Invalid agent token") rather than a
            // Kotlin deserialization crash about missing PromptPayload fields.
            val errorBody = response.bodyAsText()
            error("Hub returned ${response.status.value} for prompt '$name': $errorBody")
        }
        return response.body()
    }

    /**
     * Flush a batch of audit events to the M2M audit endpoint.
     * Uses /api/proxy/audit/batch which authenticates via deployment_agents.api_token
     * instead of requiring a browser session.
     */
    suspend fun flushAuditBatch(logs: List<AuditEvent>) {
        val response = client.post("${config.hubUrl}/api/proxy/audit/batch") {
            setBody(logs)
        }

        if (!response.status.isSuccess()) {
            error("Hub rejected audit batch with ${response.status.value}: ${response.bodyAsText()}")
        }
    }

    /**
     * Send a heartbeat to the hub so the agent shows as online in the dashboard
     * and live telemetry latency data is recorded.
     *
     * @param avgLatencyMs  Rolling average proxy latency over the heartbeat window (ms).
     * @param cpuUsagePercent  CPU usage 0–100 (pass 0.0 if not tracked).
     * @param memoryUsageMb   JVM heap used in MB.
     * @param activeReplicas  Number of active proxy replicas (typically 1 for a single container).
     */
    suspend fun sendHeartbeat(
        avgLatencyMs: Double = 0.0,
        cpuUsagePercent: Double = 0.0,
        memoryUsageMb: Double = 0.0,
        activeReplicas: Int = 1,
    ) {
        val payload = HeartbeatPayload(
            metrics = HeartbeatMetrics(
                latencyMs = avgLatencyMs,
                cpuUsagePercent = cpuUsagePercent,
                memoryUsageMb = memoryUsageMb,
                activeReplicas = activeReplicas,
                status = "online",
            )
        )
        val response = client.post("${config.hubUrl}/api/agents/heartbeat") {
            setBody(payload)
        }
        if (!response.status.isSuccess()) {
            error("Heartbeat rejected with ${response.status.value}: ${response.bodyAsText()}")
        }
    }

    fun close() {
        client.close()
    }
}

// ── Heartbeat request models ──────────────────────────────────────────────────

@Serializable
internal data class HeartbeatPayload(val metrics: HeartbeatMetrics)

@Serializable
internal data class HeartbeatMetrics(
    val latencyMs: Double,
    val cpuUsagePercent: Double,
    val memoryUsageMb: Double,
    val activeReplicas: Int,
    val status: String,
)
