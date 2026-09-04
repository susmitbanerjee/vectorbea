package com.vectorbea.observability.analytics

import com.vectorbea.observability.analytics.AnalyticsConfig
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID

data class IngestEventRequest(
    val eventName: String = "",
    val eventCategory: String = "",
    val occurredAt: String? = null,
    val environment: String? = null,
    val workspaceId: String? = null,
    val environmentId: String? = null,
    val appUserId: String? = null,
    val supabaseUserId: String? = null,
    val sessionId: String? = null,
    val anonymousId: String? = null,
    val sourceService: String? = null,
    val sourcePage: String? = null,
    val sourceComponent: String? = null,
    val userAgent: String? = null,
    val workflowId: String? = null,
    val runId: String? = null,
    val agentId: String? = null,
    val toolId: String? = null,
    val connectionId: String? = null,
    val architectSessionId: String? = null,
    val properties: Map<String, Any?> = emptyMap(),
    val context: Map<String, Any?> = emptyMap(),
)

data class IngestBatchRequest(val events: List<IngestEventRequest> = emptyList())

data class IngestionResult(val accepted: Int, val rejected: Int, val errors: List<String>)

class AnalyticsIngestionService(
    private val repo: AnalyticsRepository,
    private val config: AnalyticsConfig,
) {
    private val log = LoggerFactory.getLogger(AnalyticsIngestionService::class.java)

    fun ingestBatch(batch: IngestBatchRequest, sourceService: String): IngestionResult {
        if (batch.events.isEmpty()) return IngestionResult(0, 0, emptyList())

        val limited = batch.events.take(config.maxBatchSize)
        val errors = mutableListOf<String>()
        val records = mutableListOf<AnalyticsEventRecord>()

        for (req in limited) {
            val validation = AnalyticsEventValidator.validate(req, config.vectorbeaEnv)
            if (!validation.valid) {
                errors += "Event '${req.eventName}': ${validation.errors.joinToString(", ")}"
                continue
            }

            val sanitizedProps = AnalyticsSanitizer.sanitizeProperties(req.properties, config.maxEventSizeBytes)
            val sanitizedCtx = AnalyticsSanitizer.sanitizeContext(req.context)

            val record = AnalyticsEventRecord(
                id = UUID.randomUUID(),
                environment = req.environment ?: config.vectorbeaEnv,
                eventName = req.eventName,
                eventCategory = req.eventCategory,
                eventVersion = 1,
                occurredAt = req.occurredAt?.let { Instant.parse(it) } ?: Instant.now(),
                receivedAt = Instant.now(),
                workspaceId = req.workspaceId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                environmentId = req.environmentId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                appUserId = req.appUserId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                supabaseUserId = req.supabaseUserId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                sessionId = req.sessionId,
                anonymousId = req.anonymousId,
                sourceService = req.sourceService ?: sourceService,
                sourcePage = req.sourcePage,
                sourceComponent = req.sourceComponent,
                userAgent = req.userAgent,
                ipHash = null, // IP hashing intentionally omitted
                workflowId = req.workflowId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                workflowVersionId = null,
                runId = req.runId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                agentId = req.agentId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                toolId = req.toolId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                connectionId = req.connectionId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                architectSessionId = req.architectSessionId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                propertiesJson = sanitizedProps,
                contextJson = sanitizedCtx,
            )
            records += record
        }

        if (records.isNotEmpty()) {
            try {
                repo.insert(records)
                log.info("[ingestion] stored {} analytics events", records.size)
            } catch (e: Exception) {
                log.error("[ingestion] failed to store events: ${e.message}", e)
                errors += "Storage error: ${e.message}"
                return IngestionResult(0, limited.size, errors)
            }
        }

        return IngestionResult(
            accepted = records.size,
            rejected = limited.size - records.size,
            errors = errors,
        )
    }
}
