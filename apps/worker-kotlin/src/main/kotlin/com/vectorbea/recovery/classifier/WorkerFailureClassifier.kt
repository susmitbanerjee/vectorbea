package com.vectorbea.recovery.classifier
import com.vectorbea.recovery.model.*
class WorkerFailureClassifier : SpecificFailureClassifier {
    override fun classify(e: FailureEvidence): FailureClassification? {
        val msg = e.errorMessage?.lowercase() ?: ""
        val code = e.errorCode?.lowercase() ?: ""
        val et = e.eventType?.uppercase() ?: ""
        return when {
            code == "worker_crashed" || et == "WORKER_CRASHED" || (msg.contains("worker") && msg.contains("crash")) ->
                FailureClassification(FailureCategory.WORKER_CRASHED, "WORKER_CRASHED", FailureSeverity.HIGH, true,
                    summary = "The worker crashed during execution. Replay from checkpoint if available.")
            code == "job_stuck" || msg.contains("stuck") || (msg.contains("pending") && msg.contains("too long")) ->
                FailureClassification(FailureCategory.WORKER_CRASHED, "JOB_STUCK", FailureSeverity.MEDIUM, true,
                    summary = "The workflow job appears stuck. Re-enqueueing may be required.")
            code == "queue_delivery_failed" || (msg.contains("queue") && msg.contains("failed")) ->
                FailureClassification(FailureCategory.CONNECTION_FAILURE, "QUEUE_DELIVERY_FAILED", FailureSeverity.HIGH, true,
                    summary = "Failed to deliver job to the queue. Redis may be unavailable.")
            code == "security_context_mismatch" ->
                FailureClassification(FailureCategory.WORKFLOW_GRAPH_INVALID, "SECURITY_CONTEXT_MISMATCH", FailureSeverity.CRITICAL, false,
                    summary = "Security mismatch: job workspace does not match run workspace.")
            else -> null
        }
    }
}
