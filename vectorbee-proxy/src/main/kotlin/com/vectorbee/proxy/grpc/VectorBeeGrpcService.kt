package com.vectorbee.proxy.grpc

import com.vectorbee.proxy.model.AuditEvent
import com.vectorbee.proxy.service.AuditDispatcher
import com.vectorbee.proxy.service.PromptService
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
class VectorBeeGrpcService(
    private val promptService: PromptService,
    private val auditDispatcher: AuditDispatcher,
    private val json: Json
) : VectorBeeDataPlaneGrpcKt.VectorBeeDataPlaneCoroutineImplBase() {

    private val logger = LoggerFactory.getLogger(VectorBeeGrpcService::class.java)

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

        val event = AuditEvent(
            promptVersionId = request.promptVersionId,
            proxyLatencyMs = request.proxyLatencyMs,
            llmLatencyMs = request.llmLatencyMs,
            tokenCount = request.tokenCount,
            metadata = metadata
        )

        // Non-blocking enqueue into the unbounded channel — the AuditDispatcher
        // worker drains it in batches and POSTs to the hub asynchronously.
        val accepted = auditDispatcher.tryEnqueue(event)

        return LogAuditResponse.newBuilder()
            .setAccepted(accepted)
            .build()
    }
}
