package com.vectorbea.recovery.bundle
import com.vectorbea.recovery.model.*
import com.vectorbea.recovery.sanitize.RecoverySanitizer

object DiagnosticBundleBuilder {
    fun build(
        evidence: FailureEvidence,
        classification: FailureClassification,
        recommendation: RecoveryRecommendation,
    ): Map<String, Any?> = buildMap {
        put("runId", evidence.runId)
        put("workflowId", evidence.workflowId)
        put("failedNodeId", evidence.failedNodeId)
        put("failedNodeType", evidence.failedNodeType)
        put("category", classification.category.name)
        put("code", classification.code)
        put("severity", classification.severity.name)
        put("retryable", classification.retryable)
        put("summary", classification.summary)
        put("technicalSummary", classification.technicalSummary)
        put("recommendedAction", recommendation.recommendedAction)
        put("action", recommendation.action.name)
        put("autoReplaySafe", recommendation.autoReplaySafe)
        put("requiresHumanApproval", recommendation.requiresHumanApproval)
        put("checkpointId", recommendation.checkpointId)
        put("recentEventTypes", evidence.recentEventTypes.take(10))
        put("retryAttempt", evidence.retryAttempt)
        put("maxRetries", evidence.maxRetries)
        put("sanitizedError", RecoverySanitizer.sanitizeMessage(evidence.errorMessage))
        put("sanitizedLogs", RecoverySanitizer.sanitizeLogs(evidence.sanitizedLogs))
        put("schemaErrors", evidence.schemaValidationErrors.take(5))
        put("mappingErrors", evidence.mappingErrors.take(5))
        put("llmReady", false) // Set to true when AI diagnosis is enabled
    }
}
