package com.vectorbea.api.queue

import com.vectorbea.api.metrics.AppMetrics
import com.vectorbea.api.redis.RedisProvider
import org.slf4j.LoggerFactory

/**
 * Redis Streams implementation of [WorkflowQueue].
 *
 * Uses XADD to append jobs to a Redis Stream.  The stream is consumed by
 * worker processes (in apps/worker-kotlin) via XREADGROUP with the
 * consumer group [consumerGroup].
 *
 * Stream design:
 *   - Each field in the Redis Stream message maps to a job property.
 *   - The XADD message ID is returned as the enqueue receipt.
 *   - No MAXLEN trimming by default — configure externally if needed.
 *
 * Failure contract:
 *   If XADD fails for any reason, [WorkflowQueueException] is thrown.
 *   The caller MUST NOT mark the run as "queued" on exception.
 *
 * Stream auto-creation:
 *   XADD creates the stream automatically on first write — no setup needed.
 *   The consumer group must be created separately (worker startup creates it
 *   with XGROUP CREATE … $ MKSTREAM before consuming).
 */
class RedisStreamsWorkflowQueue(
    private val redis: RedisProvider,
    private val streamKey: String,
    private val consumerGroup: String,
    /**
     * Max bytes of inputJson allowed in a Redis message. Above this, input is
     * omitted from the message — the worker loads it from agent_runs.input_json
     * (the DB is the source of truth). Keeps Redis payloads small.
     */
    private val maxPayloadBytes: Int =
        System.getenv("MAX_REDIS_MESSAGE_PAYLOAD_BYTES")?.toIntOrNull() ?: 16_384,
) : WorkflowQueue {

    private val log = LoggerFactory.getLogger(RedisStreamsWorkflowQueue::class.java)

    /**
     * Appends [job] to the Redis Stream via XADD.
     *
     * The message body is a flat map of string → string fields.
     * All fields are serialized as strings to keep the consumer simple.
     *
     * @return Redis message ID on success.
     * @throws [WorkflowQueueException] if Redis write fails.
     */
    override fun enqueue(job: WorkflowRunJob): String {
        val fields = buildFields(job)
        return try {
            // Use auto-generated stream ID ("*") with no MAXLEN trimming
            val messageId = redis.commands.xadd(streamKey, fields)
                ?: throw WorkflowQueueException("XADD returned null for stream=$streamKey")
            // Redis-pressure metrics: count the write and the bytes actually sent.
            val payloadBytes = fields.entries.sumOf { it.key.length + it.value.toByteArray(Charsets.UTF_8).size }
            AppMetrics.redisStreamXadd.inc(job.jobType.name)
            AppMetrics.redisStreamPayloadBytes.inc(job.jobType.name, delta = payloadBytes.toLong())
            log.info(
                "[queue] enqueued jobId={} runId={} type={} bytes={} messageId={}",
                job.jobId, job.runId, job.jobType, payloadBytes, messageId,
            )
            messageId
        } catch (e: WorkflowQueueException) {
            throw e
        } catch (e: Exception) {
            log.error(
                "[queue] XADD failed for stream={} jobId={} runId={}: {}",
                streamKey, job.jobId, job.runId, e.message,
            )
            throw WorkflowQueueException(
                "Failed to enqueue job ${job.jobId} (run=${job.runId}) onto stream '$streamKey': ${e.message}",
                e,
            )
        }
    }

    /** Builds the flat string map that becomes the Redis Stream message body. */
    private fun buildFields(job: WorkflowRunJob): Map<String, String> =
        buildStreamFields(job, maxPayloadBytes) { runId, bytes ->
            AppMetrics.redisStreamInputOmitted.inc(job.jobType.name)
            log.warn(
                "[queue] inputJson ({} bytes) exceeds MAX_REDIS_MESSAGE_PAYLOAD_BYTES ({}) for runId={} — " +
                "omitting from Redis; worker will load it from agent_runs.input_json",
                bytes, maxPayloadBytes, runId,
            )
        }

    companion object {
        /**
         * Pure builder for the Redis Stream message body (testable, no I/O).
         *
         * Payload policy (keeps Redis small — the DB is the source of truth):
         *  - The run's input ALWAYS lives in agent_runs.input_json; the worker
         *    loads it from there. The message carries inputJson only as a convenience.
         *  - RESUME_RUN / RETRY_NODE / REPLAY_RUN NEVER carry inputJson.
         *  - START_RUN carries inputJson only when it is <= [maxPayloadBytes];
         *    otherwise it is omitted and [onInputOmitted] is invoked.
         */
        fun buildStreamFields(
            job: WorkflowRunJob,
            maxPayloadBytes: Int,
            onInputOmitted: (runId: String, bytes: Int) -> Unit = { _, _ -> },
        ): Map<String, String> = buildMap {
            put("jobId", job.jobId)
            put("commandId", job.jobId)          // target-contract alias
            put("runId", job.runId)
            put("workspaceId", job.workspaceId)
            put("tenantId", job.workspaceId)     // tenant == workspace in this model
            put("environmentId", job.environmentId)
            put("workflowId", job.workflowId)
            put("workflowVersionId", job.workflowVersionId)
            put("jobType", job.jobType.name)
            put("commandType", job.jobType.name) // target-contract alias
            put("reason", job.reason)
            put("triggeredBy", job.reason)       // worker classifier reads triggeredBy
            put("createdAt", job.createdAt.toString())
            put("attempt", job.attempt.toString())
            put("retryCount", job.attempt.toString())  // worker reads "retryCount"
            if (job.resumeFromNodeId != null) {
                put("resumeFromNodeId", job.resumeFromNodeId)
                put("nodeId", job.resumeFromNodeId)  // worker reads "nodeId"; keep both for compatibility
            }

            // inputJson: only fresh START_RUN may carry it, and only when small.
            val inputBytes = job.inputJson.toByteArray(Charsets.UTF_8).size
            val carryInput = job.jobType == JobType.START_RUN && inputBytes <= maxPayloadBytes
            if (carryInput) {
                put("inputJson", job.inputJson)  // must already have secrets stripped by caller
            } else if (job.jobType == JobType.START_RUN) {
                onInputOmitted(job.runId, inputBytes)  // oversized START input — omit; worker reads from DB
            }

            if (job.debugMode) put("debugMode", "true")
            // Audit: who triggered this run (app_users.id, verified server-side from JWT)
            if (job.requestedByUserId != null) put("requestedByUserId", job.requestedByUserId)
        }

        /**
         * Verifies the stream is reachable and logs stream info.
         * Called on startup to fail fast if Redis is misconfigured.
         */
        fun verifyStream(redis: RedisProvider, streamKey: String) {
            val log = LoggerFactory.getLogger(RedisStreamsWorkflowQueue::class.java)
            try {
                // XLEN returns 0 for a non-existent stream — that's fine
                val len = redis.commands.xlen(streamKey)
                log.info("[queue] stream='{}' len={} (ready)", streamKey, len)
            } catch (e: Exception) {
                log.warn("[queue] could not verify stream='{}': {}", streamKey, e.message)
            }
        }
    }
}
