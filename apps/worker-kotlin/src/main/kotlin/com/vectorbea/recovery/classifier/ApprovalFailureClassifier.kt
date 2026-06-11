package com.vectorbea.recovery.classifier
import com.vectorbea.recovery.model.*
class ApprovalFailureClassifier : SpecificFailureClassifier {
    override fun classify(e: FailureEvidence): FailureClassification? {
        val msg = e.errorMessage?.lowercase() ?: ""
        val et = e.eventType?.uppercase() ?: ""
        return when {
            et == "APPROVAL_REJECTED" || (msg.contains("rejected") && msg.contains("approval")) ->
                FailureClassification(FailureCategory.APPROVAL_REJECTED, "APPROVAL_REJECTED", FailureSeverity.HIGH, false,
                    summary = "A human reviewer rejected the approval gate. The workflow will not continue automatically.")
            et == "APPROVAL_EXPIRED" || (msg.contains("approval") && (msg.contains("timeout") || msg.contains("expired"))) ->
                FailureClassification(FailureCategory.APPROVAL_TIMEOUT, "APPROVAL_TIMEOUT", FailureSeverity.MEDIUM, false,
                    summary = "The approval gate timed out before a decision was made.")
            else -> null
        }
    }
}
