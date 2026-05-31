package com.vectorbea.recovery.policy
import com.vectorbea.recovery.model.*

class RecoveryPolicyEngine {
    fun recommend(classification: FailureClassification, context: RecoveryContext): RecoveryRecommendation {
        val cat = classification.category
        val code = classification.code
        val retryable = classification.retryable && context.retryPolicyAllowsRetry
        val checkpoint = context.checkpointAvailable

        return when (cat) {
            FailureCategory.RATE_LIMIT -> RecoveryRecommendation(
                action = RecoveryAction.WAIT_AND_RETRY, retryable = true, autoReplaySafe = false,
                requiresHumanApproval = false, risk = "low",
                summary = "Rate limit hit. Waiting before retry.",
                recommendedAction = "Wait and retry with exponential backoff.",
                delayMs = context.retryDelayMs ?: 5000L)

            FailureCategory.TIMEOUT -> RecoveryRecommendation(
                action = RecoveryAction.RETRY_SAME_STEP, retryable = true, autoReplaySafe = false,
                requiresHumanApproval = false, risk = "low",
                summary = "Transient timeout. Retrying the failed step.",
                recommendedAction = "Retry the same step. Timeouts are usually transient.")

            FailureCategory.NETWORK_FAILURE -> RecoveryRecommendation(
                action = if (code == "WHITELIST_REQUIRED") RecoveryAction.OPEN_CONNECTION_SETTINGS
                         else if (code == "PRIVATE_RUNNER_REQUIRED") RecoveryAction.CONFIGURE_PRIVATE_RUNNER
                         else RecoveryAction.RETRY_SAME_STEP,
                retryable = classification.retryable, autoReplaySafe = false,
                requiresHumanApproval = code in setOf("WHITELIST_REQUIRED","PRIVATE_RUNNER_REQUIRED"),
                risk = "low",
                summary = classification.summary,
                recommendedAction = when (code) {
                    "WHITELIST_REQUIRED" -> "Add Vectorbea outbound IPs to the connection firewall allowlist."
                    "PRIVATE_RUNNER_REQUIRED" -> "Configure a private runner inside the network perimeter."
                    else -> "Retry — network failures are often transient."
                },
                remediation = buildMap {
                    if (context.checkpointId != null) put("checkpointId", context.checkpointId)
                })

            FailureCategory.AUTH_FAILURE -> RecoveryRecommendation(
                action = if (code == "SECRET_MISSING") RecoveryAction.ROTATE_SECRET else RecoveryAction.FIX_CONNECTION,
                retryable = false, autoReplaySafe = false, requiresHumanApproval = true,
                risk = "medium",
                summary = classification.summary,
                recommendedAction = if (code == "SECRET_MISSING") "Add or rotate the connection secret." else "Update connection credentials in Connection Settings.",
                remediation = buildMap {
                    classification.evidence["connectionId"]?.let { put("connectionId", it) }
                })

            FailureCategory.MAPPING_FAILURE -> RecoveryRecommendation(
                action = RecoveryAction.FIX_MAPPING, retryable = false,
                autoReplaySafe = false, requiresHumanApproval = false, risk = "low",
                summary = classification.summary,
                recommendedAction = "Open the failed node in Builder and fix the input mapping expression.",
                remediation = buildMap {
                    classification.evidence["nodeId"]?.let { put("failedNodeId", it) }
                })

            FailureCategory.DB_QUERY_FAILURE -> RecoveryRecommendation(
                action = if (code in setOf("DB_TABLE_NOT_FOUND","DB_COLUMN_NOT_FOUND")) RecoveryAction.FIX_SCHEMA
                         else RecoveryAction.OPEN_BUILDER_AT_NODE,
                retryable = false, autoReplaySafe = false, requiresHumanApproval = false, risk = "low",
                summary = classification.summary,
                recommendedAction = if (code in setOf("DB_TABLE_NOT_FOUND","DB_COLUMN_NOT_FOUND"))
                    "Update the SQL query to reference existing tables/columns." else "Fix the database query configuration.")

            FailureCategory.DB_WRITE_BLOCKED -> RecoveryRecommendation(
                action = RecoveryAction.FIX_CONNECTION, retryable = false,
                autoReplaySafe = false, requiresHumanApproval = true, risk = "medium",
                summary = classification.summary,
                recommendedAction = "Check the database connection permissions — write access may be required.")

            FailureCategory.LLM_OUTPUT_INVALID, FailureCategory.SCHEMA_VALIDATION_FAILURE -> RecoveryRecommendation(
                action = if (retryable) RecoveryAction.RETRY_SAME_STEP else RecoveryAction.OPEN_BUILDER_AT_NODE,
                retryable = retryable, autoReplaySafe = retryable, requiresHumanApproval = false, risk = "low",
                summary = classification.summary,
                recommendedAction = if (retryable) "Retry — LLM output failures are often non-deterministic."
                                    else "Update the output schema or prompt in the node configuration.")

            FailureCategory.RESOURCE_LIMIT_EXCEEDED -> RecoveryRecommendation(
                action = RecoveryAction.REDUCE_PAYLOAD_SIZE, retryable = false,
                autoReplaySafe = false, requiresHumanApproval = false, risk = "medium",
                summary = classification.summary,
                recommendedAction = "Reduce the prompt length or input size to fit within the model context window.")

            FailureCategory.WORKER_CRASHED -> RecoveryRecommendation(
                action = if (checkpoint) RecoveryAction.REPLAY_FROM_CHECKPOINT else RecoveryAction.RETRY_SAME_STEP,
                retryable = true,
                autoReplaySafe = checkpoint && context.replaySafety in setOf(ReplaySafety.SAFE_TO_REPLAY, ReplaySafety.IDEMPOTENT_WITH_KEY),
                requiresHumanApproval = !checkpoint,
                risk = if (checkpoint) "low" else "medium",
                summary = classification.summary,
                recommendedAction = if (checkpoint) "Replay from the most recent checkpoint." else "Retry the full run — no checkpoint is available.",
                checkpointId = context.checkpointId)

            FailureCategory.APPROVAL_REJECTED -> RecoveryRecommendation(
                action = RecoveryAction.NO_ACTION, retryable = false,
                autoReplaySafe = false, requiresHumanApproval = false, risk = "none",
                summary = "Approval was rejected. No automatic recovery is possible.",
                recommendedAction = "Review the rejection reason. Start a new run if appropriate.")

            FailureCategory.APPROVAL_TIMEOUT -> RecoveryRecommendation(
                action = RecoveryAction.REQUEST_HUMAN_APPROVAL, retryable = false,
                autoReplaySafe = false, requiresHumanApproval = true, risk = "low",
                summary = classification.summary,
                recommendedAction = "Request a new approval decision or increase the approval timeout.")

            FailureCategory.RETRY_EXHAUSTED -> RecoveryRecommendation(
                action = RecoveryAction.REQUEST_HUMAN_APPROVAL, retryable = false,
                autoReplaySafe = false, requiresHumanApproval = true, risk = "medium",
                summary = "All retry attempts exhausted. Human review required.",
                recommendedAction = "Review the root cause and decide whether to manually replay.")

            FailureCategory.CONNECTION_FAILURE -> RecoveryRecommendation(
                action = RecoveryAction.FIX_CONNECTION, retryable = classification.retryable,
                autoReplaySafe = false, requiresHumanApproval = !classification.retryable, risk = "medium",
                summary = classification.summary,
                recommendedAction = "Check the connection configuration and network reachability.")

            else -> RecoveryRecommendation(
                action = RecoveryAction.REQUEST_HUMAN_APPROVAL, retryable = false,
                autoReplaySafe = false, requiresHumanApproval = true, risk = "unknown",
                summary = classification.summary,
                recommendedAction = "Manual investigation required. Check the run event history for details.")
        }
    }
}
