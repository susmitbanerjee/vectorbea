package com.vectorbea.recovery.classifier
import com.vectorbea.recovery.model.*

class WorkerFailureClassifier : SpecificFailureClassifier {
    override fun classify(e: FailureEvidence): FailureClassification? {
        val msg  = e.errorMessage?.lowercase() ?: ""
        val code = e.errorCode?.lowercase() ?: ""
        val et   = e.eventType?.uppercase() ?: ""
        return when {

            // ── Workflow configuration errors — never retryable ────────────────
            // "missing required config: toolId" — tool node has no registered tool
            msg.contains("missing required config") ||
            msg.contains("missing required field") ||
            msg.contains("invalid toolid format") ||
            (msg.contains("not found or not accessible") && msg.contains("node")) ||
            (msg.contains("builtin_email") && msg.contains("not configured")) ->
                FailureClassification(
                    category  = FailureCategory.WORKFLOW_GRAPH_INVALID,
                    code      = "WORKFLOW_NODE_MISCONFIGURED",
                    severity  = FailureSeverity.HIGH,
                    retryable = false,   // retrying cannot fix a config error
                    summary   = "A workflow node is misconfigured: ${e.errorMessage?.take(200)}. " +
                                "Open the workflow builder and fix the node configuration.",
                    technicalSummary = "Node config validation failed — check toolId, agentId, or built-in email settings.",
                )

            // ── Tool not found / inaccessible ─────────────────────────────────
            msg.contains("tool") && (msg.contains("not found") || msg.contains("not accessible")) ->
                FailureClassification(
                    category  = FailureCategory.WORKFLOW_GRAPH_INVALID,
                    code      = "TOOL_NOT_FOUND",
                    severity  = FailureSeverity.HIGH,
                    retryable = false,
                    summary   = "The tool referenced by this node does not exist or is not accessible in this workspace. " +
                                "Register the tool or update the workflow node.",
                )

            // ── Agent not found ───────────────────────────────────────────────
            msg.contains("agent") && (msg.contains("not found") || msg.contains("not accessible")) ->
                FailureClassification(
                    category  = FailureCategory.WORKFLOW_GRAPH_INVALID,
                    code      = "AGENT_NOT_FOUND",
                    severity  = FailureSeverity.HIGH,
                    retryable = false,
                    summary   = "The agent referenced by this node does not exist or is inactive. " +
                                "Register the agent or update the workflow node.",
                )

            // ── Worker infrastructure failures ────────────────────────────────
            code == "worker_crashed" || et == "WORKER_CRASHED" ||
            (msg.contains("worker") && msg.contains("crash")) ->
                FailureClassification(FailureCategory.WORKER_CRASHED, "WORKER_CRASHED", FailureSeverity.HIGH, true,
                    summary = "The worker crashed during execution. Replay from checkpoint if available.")

            code == "job_stuck" || msg.contains("stuck") ||
            (msg.contains("pending") && msg.contains("too long")) ->
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
