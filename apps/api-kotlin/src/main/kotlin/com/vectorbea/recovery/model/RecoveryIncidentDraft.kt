package com.vectorbea.recovery.model

data class RecoveryIncidentDraft(
    val workspaceId: String,
    val environmentId: String,
    val runId: String,
    val workflowId: String,
    val workflowVersionId: String,
    val failedStepId: String? = null,
    val failedNodeId: String? = null,
    val failedAgentId: String? = null,
    val failedToolId: String? = null,
    val failedConnectionId: String? = null,
    val classification: FailureClassification,
    val recommendation: RecoveryRecommendation,
    val diagnosticBundle: Map<String, Any?> = emptyMap(),
)
