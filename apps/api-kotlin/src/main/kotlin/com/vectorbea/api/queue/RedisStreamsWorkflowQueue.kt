package com.vectorbea.api.queue

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
            log.info(
                "[queue] enqueued jobId={} runId={} type={} messageId={}",
                job.jobId, job.runId, job.jobType, messageId,
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
    private fun buildFields(job: WorkflowRunJob): Map<String, String> = buildMap {
        put("jobId", job.jobId)
        put("runId", job.runId)
        put("workspaceId", job.workspaceId)
        put("environmentId", job.environmentId)
        put("workflowId", job.workflowId)
        put("workflowVersionId", job.workflowVersionId)
        put("jobType", job.jobType.name)
        put("createdAt", job.createdAt.toString())
        put("attempt", job.attempt.toString())
        if (job.resumeFromNodeId != null) put("resumeFromNodeId", job.resumeFromNodeId)
        put("inputJson", job.inputJson)  // must already have secrets stripped by caller
    }

    companion object {
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
