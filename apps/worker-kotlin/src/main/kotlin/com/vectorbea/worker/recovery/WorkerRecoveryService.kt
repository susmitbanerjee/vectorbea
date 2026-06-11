package com.vectorbea.worker.recovery

import com.vectorbea.recovery.bundle.DiagnosticBundleBuilder
import com.vectorbea.recovery.classifier.FailureClassifier
import com.vectorbea.recovery.model.*
import com.vectorbea.recovery.policy.RecoveryPolicyEngine
import com.vectorbea.recovery.policy.ReplaySafetyAnalyzer
import com.vectorbea.recovery.sanitize.RecoverySanitizer
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * Worker-side integration point for the Recovery Engine.
 *
 * On terminal failure: call classifyAndPersist() to create a failure incident.
 * The caller then emits FAILURE_INCIDENT_CREATED to the run event log.
 *
 * Security: sanitizes all evidence before classification — no secrets, no
 * connection strings, no authorization headers reach the incident record.
 */
class WorkerRecoveryService(
    private val dataSource: DataSource,
    private val classifier: FailureClassifier = FailureClassifier(),
    private val policyEngine: RecoveryPolicyEngine = RecoveryPolicyEngine(),
    private val safetyAnalyzer: ReplaySafetyAnalyzer = ReplaySafetyAnalyzer(),
) {
    private val log = LoggerFactory.getLogger(WorkerRecoveryService::class.java)
    private val mapper = jacksonObjectMapper()

    data class TerminalFailureContext(
        val runId: UUID,
        val workspaceId: UUID,
        val environmentId: UUID,
        val workflowId: UUID,
        val workflowVersionId: UUID,
        val failedNodeId: String? = null,
        val failedNodeType: String? = null,
        val failedStepId: String? = null,
        val failedAgentId: UUID? = null,
        val failedToolId: UUID? = null,
        val failedConnectionId: UUID? = null,
        val errorMessage: String? = null,
        val errorCode: String? = null,
        val errorType: String? = null,
        val httpStatus: Int? = null,
        val dbSqlState: String? = null,
        val eventType: String? = null,
        val retryAttempt: Int? = null,
        val maxRetries: Int? = null,
        val checkpointAvailable: Boolean = false,
        val checkpointId: UUID? = null,
        val recentEventTypes: List<String> = emptyList(),
        val sanitizedLogs: List<String> = emptyList(),
        val operationType: String? = null,
        val hasIdempotencyKey: Boolean = false,
        val connectionStatus: String? = null,
        val connectionNetworkStatus: String? = null,
        val provider: String? = null,
        val schemaValidationErrors: List<String> = emptyList(),
        val mappingErrors: List<String> = emptyList(),
    )

    fun classifyAndPersist(ctx: TerminalFailureContext): UUID? = try {
        val evidence = FailureEvidence(
            workspaceId = ctx.workspaceId.toString(),
            environmentId = ctx.environmentId.toString(),
            runId = ctx.runId.toString(),
            workflowId = ctx.workflowId.toString(),
            workflowVersionId = ctx.workflowVersionId.toString(),
            failedStepId = ctx.failedStepId,
            failedNodeId = ctx.failedNodeId,
            failedNodeType = ctx.failedNodeType,
            failedAgentId = ctx.failedAgentId?.toString(),
            failedToolId = ctx.failedToolId?.toString(),
            failedConnectionId = ctx.failedConnectionId?.toString(),
            eventType = ctx.eventType,
            errorCode = ctx.errorCode,
            errorMessage = RecoverySanitizer.sanitizeMessage(ctx.errorMessage),
            errorType = ctx.errorType,
            httpStatus = ctx.httpStatus,
            dbSqlState = ctx.dbSqlState,
            provider = ctx.provider,
            retryAttempt = ctx.retryAttempt,
            maxRetries = ctx.maxRetries,
            connectionStatus = ctx.connectionStatus,
            connectionNetworkStatus = ctx.connectionNetworkStatus,
            operationType = ctx.operationType,
            schemaValidationErrors = ctx.schemaValidationErrors.take(10),
            mappingErrors = ctx.mappingErrors.take(10),
            recentEventTypes = ctx.recentEventTypes.take(10),
            sanitizedLogs = RecoverySanitizer.sanitizeLogs(ctx.sanitizedLogs),
        )
        val classification = classifier.classify(evidence)
        val replaySafety = safetyAnalyzer.analyze(ctx.failedNodeType, ctx.operationType, ctx.hasIdempotencyKey)
        val recoveryCtx = RecoveryContext(
            checkpointAvailable = ctx.checkpointAvailable,
            checkpointId = ctx.checkpointId?.toString(),
            replaySafety = replaySafety,
            retryPolicyAllowsRetry = (ctx.retryAttempt ?: 0) < (ctx.maxRetries ?: 3),
            idempotencyKeyAvailable = ctx.hasIdempotencyKey,
        )
        val recommendation = policyEngine.recommend(classification, recoveryCtx)
        val bundle = DiagnosticBundleBuilder.build(evidence, classification, recommendation)
        val draft = RecoveryIncidentDraft(
            workspaceId = ctx.workspaceId.toString(),
            environmentId = ctx.environmentId.toString(),
            runId = ctx.runId.toString(),
            workflowId = ctx.workflowId.toString(),
            workflowVersionId = ctx.workflowVersionId.toString(),
            failedStepId = ctx.failedStepId,
            failedNodeId = ctx.failedNodeId,
            failedAgentId = ctx.failedAgentId?.toString(),
            failedToolId = ctx.failedToolId?.toString(),
            failedConnectionId = ctx.failedConnectionId?.toString(),
            classification = classification,
            recommendation = recommendation,
            diagnosticBundle = bundle,
        )
        val id = persistIncident(draft)
        log.info("[recovery] incident id={} category={} code={} run={}", id, classification.category, classification.code, ctx.runId)
        id
    } catch (e: Exception) {
        log.error("[recovery] classify/persist failed run={}: {}", ctx.runId, e.message)
        null
    }

    private fun persistIncident(draft: RecoveryIncidentDraft): UUID {
        val id = UUID.randomUUID()
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "INSERT INTO failure_incidents (id,workspace_id,environment_id,run_id,workflow_id,workflow_version_id," +
                "failed_step_id,failed_node_id,failed_agent_id,failed_tool_id,failed_connection_id," +
                "category,code,severity,retryable,auto_replay_safe,requires_human_approval," +
                "summary,technical_summary,recommended_action,remediation_json) " +
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb) ON CONFLICT DO NOTHING"
            ).use { s ->
                s.setObject(1, id)
                s.setObject(2, UUID.fromString(draft.workspaceId))
                s.setObject(3, UUID.fromString(draft.environmentId))
                s.setObject(4, UUID.fromString(draft.runId))
                s.setObject(5, UUID.fromString(draft.workflowId))
                s.setObject(6, UUID.fromString(draft.workflowVersionId))
                s.setString(7, draft.failedStepId)
                s.setString(8, draft.failedNodeId)
                s.setObject(9, draft.failedAgentId?.let { UUID.fromString(it) })
                s.setObject(10, draft.failedToolId?.let { UUID.fromString(it) })
                s.setObject(11, draft.failedConnectionId?.let { UUID.fromString(it) })
                s.setString(12, draft.classification.category.name)
                s.setString(13, draft.classification.code)
                s.setString(14, draft.classification.severity.name)
                s.setBoolean(15, draft.classification.retryable)
                s.setBoolean(16, draft.recommendation.autoReplaySafe)
                s.setBoolean(17, draft.recommendation.requiresHumanApproval)
                s.setString(18, draft.classification.summary)
                s.setString(19, draft.classification.technicalSummary)
                s.setString(20, draft.recommendation.recommendedAction)
                s.setString(21, mapper.writeValueAsString(draft.diagnosticBundle))
                s.executeUpdate()
            }
        }
        return id
    }
}
