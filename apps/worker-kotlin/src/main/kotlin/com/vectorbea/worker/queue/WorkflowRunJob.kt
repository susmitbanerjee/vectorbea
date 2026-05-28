package com.vectorbea.worker.queue

import java.util.UUID

/**
 * A job pulled from the Redis Stream `workflow-runs`.
 *
 * Message format (Redis Stream fields):
 *   jobType    → "START_RUN" | "RESUME_RUN" | "RETRY_NODE" | "REPLAY_RUN"
 *   runId      → UUID string of the agent_run
 *   workflowId → UUID string of the workflow
 *   triggeredBy → opaque string (user id, scheduler, webhook id)
 *   inputJson  → JSON-encoded input payload (may be empty "{}")
 *   retryCount → integer string, default "0"
 *   nodeId     → step/node id for RETRY_NODE jobs (may be absent)
 *   checkpointId → UUID for RESUME_RUN from checkpoint (may be absent)
 *
 * SECURITY: [inputJson] may contain user data — treat as untrusted, sanitize
 * before storing to run_events.  It must never be logged raw.
 */
data class WorkflowRunJob(
    /** Redis Stream message ID — used for XACK */
    val streamMessageId: String,
    val jobType: JobType,
    val runId: UUID,
    val workflowId: UUID,
    val triggeredBy: String,
    /** Raw JSON — treat as untrusted, never log */
    val inputJson: String,
    val retryCount: Int,
    /** For RETRY_NODE: which node to retry */
    val nodeId: String?,
    /** For RESUME_RUN: checkpoint to resume from */
    val checkpointId: UUID?,
) {
    enum class JobType {
        START_RUN,
        RESUME_RUN,
        RETRY_NODE,
        REPLAY_RUN,
        UNKNOWN,
        ;

        companion object {
            fun fromString(s: String?): JobType =
                entries.firstOrNull { it.name == s?.uppercase() } ?: UNKNOWN
        }
    }

    companion object {
        /**
         * Parse a Redis Stream message body into a [WorkflowRunJob].
         * Missing required fields result in [ParseException].
         */
        fun parse(messageId: String, fields: Map<String, String>): WorkflowRunJob {
            val runIdStr = fields["runId"] ?: fields["run_id"]
                ?: throw ParseException("Missing 'runId' field in stream message $messageId")
            val workflowIdStr = fields["workflowId"] ?: fields["workflow_id"]
                ?: throw ParseException("Missing 'workflowId' field in stream message $messageId")

            return WorkflowRunJob(
                streamMessageId = messageId,
                jobType = JobType.fromString(fields["jobType"] ?: fields["job_type"]),
                runId = parseUuid(runIdStr, "runId", messageId),
                workflowId = parseUuid(workflowIdStr, "workflowId", messageId),
                triggeredBy = fields["triggeredBy"] ?: fields["triggered_by"] ?: "unknown",
                inputJson = fields["inputJson"] ?: fields["input_json"] ?: "{}",
                retryCount = fields["retryCount"]?.toIntOrNull() ?: 0,
                nodeId = fields["nodeId"] ?: fields["node_id"] ?: fields["resumeFromNodeId"],
                checkpointId = (fields["checkpointId"] ?: fields["checkpoint_id"])
                    ?.let { runCatching { UUID.fromString(it) }.getOrNull() },
            )
        }

        private fun parseUuid(value: String, field: String, msgId: String): UUID =
            try { UUID.fromString(value.trim()) }
            catch (e: IllegalArgumentException) {
                throw ParseException("Invalid UUID for '$field' in message $msgId: $value")
            }
    }

    class ParseException(message: String) : Exception(message)
}
