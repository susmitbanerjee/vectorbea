package com.vectorbea.proxy.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

@Serializable
data class WorkflowTraceEnvelope(
    @SerialName("trace_id")
    val traceId: String,
    @SerialName("workspace_id")
    val workspaceId: String? = null,
    @SerialName("capability_id")
    val capabilityId: String? = null,
    @SerialName("capability_version_id")
    val capabilityVersionId: String? = null,
    @SerialName("capability_name")
    val capabilityName: String? = null,
    @SerialName("capability_version")
    val capabilityVersion: String? = null,
    val environment: String? = null,
    @SerialName("service_name")
    val serviceName: String? = null,
    val source: String = "sidecar",
    val metadata: JsonObject = JsonObject(emptyMap()),
    val events: List<WorkflowEventPayload>,
)

@Serializable
data class WorkflowEventPayload(
    val type: String,
    @SerialName("span_id")
    val spanId: String? = null,
    @SerialName("parent_span_id")
    val parentSpanId: String? = null,
    val timestamp: String? = null,
    val provider: String? = null,
    val model: String? = null,
    @SerialName("prompt_version")
    val promptVersion: String? = null,
    @SerialName("prompt_name")
    val promptName: String? = null,
    @SerialName("tool_name")
    val toolName: String? = null,
    @SerialName("mcp_server_name")
    val mcpServerName: String? = null,
    val status: String? = null,
    @SerialName("latency_ms")
    val latencyMs: Double? = null,
    @SerialName("cost_estimate")
    val costEstimate: Double? = null,
    @SerialName("tokens_input")
    val tokensInput: Int? = null,
    @SerialName("tokens_output")
    val tokensOutput: Int? = null,
    @SerialName("error_message")
    val errorMessage: String? = null,
    @SerialName("final_response")
    val finalResponse: String? = null,
    @SerialName("final_action")
    val finalAction: String? = null,
    @SerialName("outcome_status")
    val outcomeStatus: String? = null,
    @SerialName("outcome_reason")
    val outcomeReason: String? = null,
    val input: JsonElement? = null,
    val output: JsonElement? = null,
    val response: JsonElement? = null,
    val result: JsonElement? = null,
    val arguments: JsonElement? = null,
    val query: String? = null,
    val documents: JsonElement? = null,
    val scores: JsonElement? = null,
    @SerialName("selected_context")
    val selectedContext: String? = null,
    val metadata: JsonObject = JsonObject(emptyMap()),
)

@Serializable
data class WorkflowTraceBatchForwardRequest(
    val source: String = "sidecar",
    @SerialName("sidecar_version")
    val sidecarVersion: String,
    @SerialName("service_name")
    val serviceName: String,
    val environment: String,
    val traces: List<WorkflowTraceEnvelope>,
)

@Serializable
data class WorkflowIngestAcceptedResponse(
    val accepted: Boolean,
    val queued: Boolean = true,
    val dropped: Boolean = false,
    val message: String? = null,
)

@Serializable
data class WorkflowTelemetryHealth(
    val status: String,
    @SerialName("sidecar_version")
    val sidecarVersion: String,
    @SerialName("queue_size")
    val queueSize: Int,
    @SerialName("last_flush_at")
    val lastFlushAt: String? = null,
    @SerialName("last_backend_status")
    val lastBackendStatus: String = "unknown",
    @SerialName("events_received_total")
    val eventsReceivedTotal: Long,
    @SerialName("events_forwarded_total")
    val eventsForwardedTotal: Long,
    @SerialName("events_failed_total")
    val eventsFailedTotal: Long,
    @SerialName("events_dropped_total")
    val eventsDroppedTotal: Long,
    @SerialName("redaction_count")
    val redactionCount: Long,
)
