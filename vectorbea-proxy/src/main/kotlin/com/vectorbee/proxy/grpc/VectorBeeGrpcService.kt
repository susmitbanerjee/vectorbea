package com.vectorbea.proxy.grpc

import com.vectorbea.proxy.model.AuditEvent
import com.vectorbea.proxy.model.TraceMetadataBuilder
import com.vectorbea.proxy.model.WorkflowEventPayload
import com.vectorbea.proxy.model.WorkflowIngestAcceptedResponse
import com.vectorbea.proxy.model.WorkflowTraceEnvelope
import com.vectorbea.proxy.service.AuditDispatcher
import com.vectorbea.proxy.service.PromptService
import com.vectorbea.proxy.service.TelemetryDispatcher
import com.vectorbea.proxy.service.WorkflowTelemetryDispatcher
import io.grpc.Status
import io.grpc.StatusException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import org.slf4j.LoggerFactory

/**
 * gRPC implementation of the data-plane RPCs. Wires the generated Kotlin
 * coroutine base class to our existing in-memory cache and async audit
 * batcher — the service holds no state of its own.
 */
class VectorBeaGrpcService(
    private val promptService: PromptService,
    private val auditDispatcher: AuditDispatcher,
    private val json: Json,
    // Optional so existing test harnesses and Docker images that haven't set
    // VECTORBEA_TELEMETRY_URL yet continue to work without any config change.
    private val telemetryDispatcher: TelemetryDispatcher? = null,
    private val workflowTelemetryDispatcher: WorkflowTelemetryDispatcher? = null,
) : VectorBeaDataPlaneGrpcKt.VectorBeaDataPlaneCoroutineImplBase() {

    private val logger = LoggerFactory.getLogger(VectorBeaGrpcService::class.java)

    override suspend fun getPrompt(request: GetPromptRequest): GetPromptResponse {
        if (request.name.isBlank()) {
            throw StatusException(Status.INVALID_ARGUMENT.withDescription("name must be non-empty"))
        }

        val prompt = try {
            // Hits the existing ConcurrentHashMap; falls through to HubClient on miss.
            promptService.getPrompt(request.name)
        } catch (ex: Exception) {
            logger.warn("getPrompt({}) failed", request.name, ex)
            throw StatusException(
                Status.UNAVAILABLE.withDescription(ex.message ?: "prompt fetch failed").withCause(ex)
            )
        }

        return GetPromptResponse.newBuilder()
            .setPromptId(prompt.promptId)
            .setPromptVersionId(prompt.promptVersionId)
            .setOrganizationId(prompt.organizationId)
            .setName(prompt.name)
            .setDescription(prompt.description.orEmpty())
            .setVersionTag(prompt.versionTag)
            .setTemplateText(prompt.templateText)
            .setParametersJson(prompt.parameters.toString())
            .setCreatedAt(prompt.createdAt)
            .build()
    }

    override suspend fun logAudit(request: LogAuditRequest): LogAuditResponse {
        val metadata: JsonObject = if (request.metadataJson.isNotEmpty()) {
            try {
                json.parseToJsonElement(request.metadataJson) as? JsonObject
                    ?: JsonObject(emptyMap())
            } catch (ex: Exception) {
                logger.warn("invalid metadata JSON, dropping field", ex)
                JsonObject(emptyMap())
            }
        } else {
            JsonObject(emptyMap())
        }

        val normalizedMetadata = TraceMetadataBuilder.normalize(
            metadata = metadata,
            promptVersionId = request.promptVersionId,
            promptName = request.promptName,
            versionTag = request.versionTag,
            proxyLatencyMs = request.proxyLatencyMs,
            llmLatencyMs = request.llmLatencyMs,
            tokenCount = request.tokenCount,
            useType = "runtime",
        )

        val event = AuditEvent(
            promptVersionId = request.promptVersionId,
            proxyLatencyMs = request.proxyLatencyMs,
            llmLatencyMs = request.llmLatencyMs,
            tokenCount = request.tokenCount,
            metadata = normalizedMetadata,
            promptName = request.promptName,
            versionTag = request.versionTag,
        )

        // Non-blocking enqueue into the unbounded channel — the AuditDispatcher
        // worker drains it in batches and POSTs to the hub asynchronously.
        val accepted = auditDispatcher.tryEnqueue(event)

        // Mirror the same execution data to the telemetry service (fire-and-
        // forget, lock-free). Both dispatchers accumulate independently so that
        // the telemetry endpoint can be on a completely different domain / VPC
        // without coupling the two background workers.
        telemetryDispatcher?.recordLatency(event.proxyLatencyMs)
        telemetryDispatcher?.recordExecution(
            promptName = event.promptName,
            latencyMs  = event.proxyLatencyMs,
            tokensUsed = event.tokenCount,
        )

        return LogAuditResponse.newBuilder()
            .setAccepted(accepted)
            .build()
    }

    override suspend fun logWorkflowEvents(request: LogWorkflowEventsRequest): LogWorkflowEventsResponse {
        val dispatcher = workflowTelemetryDispatcher
            ?: throw StatusException(Status.UNAVAILABLE.withDescription("workflow dispatcher is not configured"))

        fun parseJson(jsonText: String): kotlinx.serialization.json.JsonElement? =
            jsonText.takeIf { it.isNotBlank() }?.let {
                runCatching { json.parseToJsonElement(it) }
                    .onFailure { ex -> logger.warn("invalid workflow event JSON field dropped: {}", ex.message) }
                    .getOrNull()
            }

        val metadata = runCatching {
            request.metadataJson.takeIf { it.isNotBlank() }
                ?.let { json.parseToJsonElement(it) as? JsonObject }
                ?: JsonObject(emptyMap())
        }.getOrElse {
            logger.warn("invalid workflow metadata JSON, dropping field", it)
            JsonObject(emptyMap())
        }

        val trace = WorkflowTraceEnvelope(
            traceId = request.traceId,
            workspaceId = request.workspaceId.takeIf { it.isNotBlank() },
            capabilityId = request.capabilityId.takeIf { it.isNotBlank() },
            capabilityVersionId = request.capabilityVersionId.takeIf { it.isNotBlank() },
            capabilityName = request.capabilityName.takeIf { it.isNotBlank() },
            capabilityVersion = request.capabilityVersion.takeIf { it.isNotBlank() },
            environment = request.environment.takeIf { it.isNotBlank() },
            serviceName = request.serviceName.takeIf { it.isNotBlank() },
            source = request.source.takeIf { it.isNotBlank() } ?: "sidecar",
            metadata = metadata,
            events = request.eventsList.map { event ->
                WorkflowEventPayload(
                    type = event.type,
                    spanId = event.spanId.takeIf { it.isNotBlank() },
                    parentSpanId = event.parentSpanId.takeIf { it.isNotBlank() },
                    timestamp = event.timestamp.takeIf { it.isNotBlank() },
                    provider = event.provider.takeIf { it.isNotBlank() },
                    model = event.model.takeIf { it.isNotBlank() },
                    promptVersion = event.promptVersion.takeIf { it.isNotBlank() },
                    promptName = event.promptName.takeIf { it.isNotBlank() },
                    toolName = event.toolName.takeIf { it.isNotBlank() },
                    mcpServerName = event.mcpServerName.takeIf { it.isNotBlank() },
                    status = event.status.takeIf { it.isNotBlank() },
                    latencyMs = event.latencyMs.takeIf { it > 0 },
                    costEstimate = event.costEstimate.takeIf { it > 0 },
                    tokensInput = event.tokensInput.takeIf { it > 0 },
                    tokensOutput = event.tokensOutput.takeIf { it > 0 },
                    errorMessage = event.errorMessage.takeIf { it.isNotBlank() },
                    finalResponse = event.finalResponse.takeIf { it.isNotBlank() },
                    finalAction = event.finalAction.takeIf { it.isNotBlank() },
                    outcomeStatus = event.outcomeStatus.takeIf { it.isNotBlank() },
                    outcomeReason = event.outcomeReason.takeIf { it.isNotBlank() },
                    input = parseJson(event.inputJson),
                    output = parseJson(event.outputJson),
                    response = parseJson(event.responseJson),
                    result = parseJson(event.resultJson),
                    arguments = parseJson(event.argumentsJson),
                    query = event.query.takeIf { it.isNotBlank() },
                    documents = parseJson(event.documentsJson),
                    scores = parseJson(event.scoresJson),
                    selectedContext = event.selectedContext.takeIf { it.isNotBlank() },
                    metadata = runCatching {
                        event.metadataJson.takeIf { it.isNotBlank() }
                            ?.let { json.parseToJsonElement(it) as? JsonObject }
                            ?: JsonObject(emptyMap())
                    }.getOrElse { JsonObject(emptyMap()) },
                )
            },
        )

        val accepted = dispatcher.tryEnqueue(trace)
        return LogWorkflowEventsResponse.newBuilder()
            .setAccepted(accepted)
            .setQueued(accepted)
            .setDropped(!accepted)
            .setMessage(if (accepted) "" else "Local sidecar queue is full")
            .build()
    }
}
