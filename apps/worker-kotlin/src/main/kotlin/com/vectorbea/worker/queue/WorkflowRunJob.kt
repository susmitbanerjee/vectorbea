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
    /**
     * Workspace that enqueued this job — included for security validation.
     * After loading the run from DB, the worker must verify:
     *   run.workspaceId == job.workspaceId
     * A mismatch indicates a corrupted or forged job and must fail immediately.
     * Nullable for backward-compatibility with jobs enqueued before this field existed.
     */
    val workspaceId: UUID? = null,
    /**
     * App user ID who triggered this run (from verified JWT, not from user-supplied input).
     * Used for audit trail only — does not affect execution.
     */
    val requestedByUserId: String? = null,
    /** True for "Debug Run" — instructs the worker to capture per-node debug snapshots. */
    val debugMode: Boolean = false,
    /**
     * Whether the Redis message actually carried an inputJson field. Slim messages
     * (RESUME_RUN re-enqueues, oversized-omitted START_RUN) set this false, telling
     * the worker to load the authoritative input from agent_runs.input_json instead.
     * Defaults true so legacy messages and direct constructions are unaffected.
     */
    val inputProvided: Boolean = true,
    /**
     * W3C traceparent from the process that enqueued this job.
     *
     * This is what makes a trace survive the queue. In-process tracing is easy — the
     * context is ambient and every child span finds its parent. The moment work crosses
     * a queue the parent is in a different process that has already returned, and the
     * trace breaks exactly where it becomes interesting: "the user pressed Run at 09:41
     * and the node started at 09:46, where were those five minutes?" is a question that
     * only spans the boundary.
     *
     * Carried as data, the same way the run id is. Null on jobs enqueued before this
     * existed and on any deploy with tracing off, in which case the worker starts a new
     * root span rather than refusing the job.
     */
    val traceparent: String? = null,
    val tracestate: String? = null,
) {
    /** The carrier shape [com.vectorbea.observability.tracing.Tracing] extracts from. */
    fun traceCarrier(): Map<String, String> = buildMap {
        traceparent?.let { put("traceparent", it) }
        tracestate?.let { put("tracestate", it) }
    }

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
                triggeredBy = fields["triggeredBy"] ?: fields["triggered_by"] ?: fields["reason"] ?: "unknown",
                // inputJson may be absent on slim messages; the worker loads the
                // authoritative input from agent_runs.input_json. Default "{}".
                inputJson = fields["inputJson"] ?: fields["input_json"] ?: "{}",
                inputProvided = fields.containsKey("inputJson") || fields.containsKey("input_json"),
                retryCount = fields["retryCount"]?.toIntOrNull() ?: 0,
                nodeId = fields["nodeId"] ?: fields["node_id"] ?: fields["resumeFromNodeId"],
                checkpointId = (fields["checkpointId"] ?: fields["checkpoint_id"])
                    ?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                workspaceId = (fields["workspaceId"] ?: fields["workspace_id"])
                    ?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                requestedByUserId = fields["requestedByUserId"] ?: fields["requested_by_user_id"],
                debugMode = (fields["debugMode"] ?: fields["debug_mode"])?.equals("true", ignoreCase = true) ?: false,
                traceparent = fields["traceparent"],
                tracestate = fields["tracestate"],
            )
        }

        private fun parseUuid(value: String, field: String, msgId: String): UUID =
            try { UUID.fromString(value.trim()) }
            catch (e: IllegalArgumentException) {
                throw ParseException("Invalid UUID for '$field' in message $msgId: $value")
            }
    }

    /**
     * Serialize this job back into Redis Stream fields (the inverse of [parse]).
     * Used to durably re-enqueue a RESUME_RUN after a cooperative yield.
     *
     * SECURITY/SIZE: carries ONLY IDs and small control fields. In particular it
     * NEVER carries inputJson — the run input lives in agent_runs.input_json and
     * the worker loads it from there (the DB is the source of truth). This keeps
     * RESUME_RUN messages tiny and bounds Redis payload size.
     */
    fun toStreamFields(): Map<String, String> = buildMap {
        put("jobType", jobType.name)
        put("runId", runId.toString())
        put("workflowId", workflowId.toString())
        put("triggeredBy", triggeredBy)
        put("reason", triggeredBy)
        put("retryCount", retryCount.toString())
        nodeId?.let { put("nodeId", it) }
        checkpointId?.let { put("checkpointId", it.toString()) }
        workspaceId?.let { put("workspaceId", it.toString()) }
        requestedByUserId?.let { put("requestedByUserId", it) }
        if (debugMode) put("debugMode", "true")
        // NOTE: inputJson intentionally omitted — see KDoc.
    }

    class ParseException(message: String) : Exception(message)
}
