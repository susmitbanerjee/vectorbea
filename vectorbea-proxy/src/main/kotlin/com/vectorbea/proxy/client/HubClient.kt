package com.vectorbea.proxy.client

import com.vectorbea.proxy.config.AppConfig
import com.vectorbea.proxy.model.AuditEvent
import com.vectorbea.proxy.model.PromptPayload
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.accept
import io.ktor.client.request.get
import io.ktor.client.request.head
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.content.TextContent
import io.ktor.http.encodeURLPathPart
import io.ktor.http.isSuccess
import kotlinx.serialization.builtins.ListSerializer
import java.util.concurrent.TimeUnit
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.ConnectionPool
import okhttp3.Protocol
import org.slf4j.LoggerFactory

class HubClient(private val config: AppConfig) {
    private val logger = LoggerFactory.getLogger(HubClient::class.java)
    private val json = Json {
        ignoreUnknownKeys = true
        explicitNulls = false
    }

    // ── HTTP client ─────────────────────────────────────────────────────────
    //
    // OkHttp engine because:
    //   1. Negotiates ALPN h2 on first request and multiplexes every
    //      subsequent prompt fetch, heartbeat, and audit flush over one
    //      TCP+TLS connection. Ktor CIO is HTTP/1.1 only — it would re-use
    //      an idle connection but cannot multiplex, so concurrent audit
    //      flushes stall behind prompt GETs under high fan-out.
    //   2. Explicit ConnectionPool control: 10 idle connections held for
    //      5 minutes matches our low-traffic cold-start profile (one pod
    //      maybe makes a handful of fetches per minute) while keeping the
    //      TLS handshake warm so that ad-hoc traffic never pays the 200 ms
    //      TLS 1.3 penalty.
    //   3. Socket-level connect/read/write timeouts, independent of the
    //      suspending call timeout.
    private val client = HttpClient(OkHttp) {
        engine {
            config {
                protocols(listOf(Protocol.HTTP_2, Protocol.HTTP_1_1))
                connectionPool(ConnectionPool(10, 5, TimeUnit.MINUTES))
                retryOnConnectionFailure(true)
                connectTimeout(2, TimeUnit.SECONDS)
                readTimeout(10, TimeUnit.SECONDS)
                writeTimeout(5, TimeUnit.SECONDS)
                // Keep the TCP socket hot — hub is the same VPC so RTT is
                // sub-ms and the kernel keepalive is more than enough.
                pingInterval(30, TimeUnit.SECONDS)
            }
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
        return json.decodeFromString(PromptPayload.serializer(), response.bodyAsText())
    }

    /**
     * Flush a batch of audit events to the M2M audit endpoint.
     * Uses /api/proxy/audit/batch which authenticates via deployment_agents.api_token
     * instead of requiring a browser session.
     */
    suspend fun flushAuditBatch(logs: List<AuditEvent>) {
        val response = client.post("${config.hubUrl}/api/proxy/audit/batch") {
            setBody(
                TextContent(
                    json.encodeToString(ListSerializer(AuditEvent.serializer()), logs),
                    ContentType.Application.Json,
                )
            )
        }

        if (!response.status.isSuccess()) {
            error("Hub rejected audit batch with ${response.status.value}: ${response.bodyAsText()}")
        }
    }

    /**
     * Send a heartbeat to the hub so the agent shows as online in the dashboard
     * and live telemetry latency data is recorded.
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
            setBody(
                TextContent(
                    json.encodeToString(HeartbeatPayload.serializer(), payload),
                    ContentType.Application.Json,
                ),
            )
        }
        if (!response.status.isSuccess()) {
            error("Heartbeat rejected with ${response.status.value}: ${response.bodyAsText()}")
        }
    }

    /**
     * Prime the HTTP/2 connection to the hub *before* we accept inbound
     * traffic. This forces:
     *   - TCP SYN + TLS 1.3 handshake + ALPN h2 (≈ 100–300 ms)
     *   - OkHttp's dispatcher and connection pool classloading + init
     *   - JIT warming of the Ktor request pipeline and kotlinx.serialization
     *     code paths used by fetchPrompt / flushAuditBatch
     *
     * The endpoint can 2xx/4xx/5xx — we just want the socket open and the
     * classloader paths touched. Any exception is swallowed; the proxy
     * must still come up if the hub is temporarily unreachable.
     */
    suspend fun warmup() {
        runCatching {
            // HEAD is cheap — no body parsing, still opens the connection.
            client.head("${config.hubUrl}/api/health")
        }.onSuccess {
            logger.info("Hub HTTP/2 connection primed (status={})", it.status.value)
        }.onFailure {
            // Log but do NOT fail boot — the hub being cold shouldn't gate
            // the proxy from binding its UDS and serving cache hits.
            logger.warn("Hub warmup failed (will retry on first real request): {}", it.message)
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
