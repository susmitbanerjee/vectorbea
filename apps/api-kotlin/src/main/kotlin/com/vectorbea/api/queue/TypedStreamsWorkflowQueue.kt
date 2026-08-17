package com.vectorbea.api.queue

import com.vectorbea.api.metrics.AppMetrics
import com.vectorbea.api.redis.RedisProvider
import org.slf4j.LoggerFactory

/**
 * Routes each job to the stream for its [ExecutionClass].
 *
 * `runs.short` · `runs.long` · `runs.agent` · `runs.system`, one consumer group
 * each. A worker pool subscribes only to its own stream and reads at most as
 * many messages as it has free slots, so it can never claim a message it is
 * unable to run — which is the entire point. PEL hoarding stops being something
 * to mitigate and becomes structurally impossible.
 *
 * THE DURABILITY CONTRACT IS UNCHANGED
 * ------------------------------------
 * Same ordering as the single-stream queue it replaces, because that ordering is
 * what makes a crash recoverable rather than silent:
 *
 *   1. `agent_runs` row committed with `status='queued'` — by the caller, first.
 *   2. XADD — here.
 *   3. On XADD failure, throw so the caller can flip the run to `enqueue_failed`.
 *   4. XACK last, by the worker, only after a durable terminal state.
 *
 * A crash between (1) and (2) leaves a `queued` row with no message, which crash
 * recovery finds. The reverse — message with no row — is what would be
 * unrecoverable, and this ordering makes it impossible.
 *
 * MIGRATION
 * ---------
 * [legacyStreamKey] is a transitional escape hatch, not a permanent feature.
 * While set, every job is ALSO written to the old single stream so a worker that
 * has not yet been upgraded still sees it. Removing it is the final step of
 * docs/architecture/TYPED-QUEUE-MIGRATION.md.
 */
class TypedStreamsWorkflowQueue(
    private val redis: RedisProvider,
    /**
     * When non-null, mirror every enqueue onto this legacy stream as well.
     * Null once every worker consumes typed streams.
     */
    private val legacyStreamKey: String? = null,
    private val maxPayloadBytes: Int =
        System.getenv("MAX_REDIS_MESSAGE_PAYLOAD_BYTES")?.toIntOrNull() ?: 16_384,
) : WorkflowQueue {

    private val log = LoggerFactory.getLogger(TypedStreamsWorkflowQueue::class.java)

    override fun enqueue(job: WorkflowRunJob): String {
        val streamKey = job.executionClass.streamKey
        val fields = buildFields(job)

        val messageId = try {
            redis.commands.xadd(streamKey, fields)
                ?: throw WorkflowQueueException("XADD returned null for stream=$streamKey")
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

        val payloadBytes = fields.entries.sumOf { it.key.length + it.value.toByteArray(Charsets.UTF_8).size }
        AppMetrics.redisStreamXadd.inc(job.jobType.name)
        AppMetrics.redisStreamPayloadBytes.inc(job.jobType.name, delta = payloadBytes.toLong())
        AppMetrics.enqueuedByClass.inc(job.executionClass.wire, job.jobType.name)

        // Legacy mirror. Deliberately best-effort and AFTER the authoritative
        // write: during migration the typed stream is the source of truth, and a
        // failure to mirror must never fail a trigger that already succeeded.
        // Worst case an old worker misses the job and the typed worker runs it —
        // which is the correct outcome anyway.
        legacyStreamKey?.let { legacy ->
            runCatching { redis.commands.xadd(legacy, fields) }
                .onFailure { log.warn("[queue] legacy mirror XADD failed for runId={}: {}", job.runId, it.message) }
        }

        log.info(
            "[queue] enqueued jobId={} runId={} type={} class={} stream={} bytes={} messageId={}",
            job.jobId, job.runId, job.jobType, job.executionClass.wire, streamKey, payloadBytes, messageId,
        )
        return messageId
    }

    private fun buildFields(job: WorkflowRunJob): Map<String, String> =
        RedisStreamsWorkflowQueue.buildStreamFields(job, maxPayloadBytes) { runId, bytes ->
            AppMetrics.redisStreamInputOmitted.inc(job.jobType.name)
            log.warn(
                "[queue] inputJson ({} bytes) exceeds MAX_REDIS_MESSAGE_PAYLOAD_BYTES ({}) for runId={} — " +
                    "omitting from Redis; worker will load it from agent_runs.input_json",
                bytes, maxPayloadBytes, runId,
            )
        } + mapOf(
            // Carried so a worker can log/verify routing without a DB read. The
            // stream a message arrives on is authoritative; this is for humans.
            "executionClass" to job.executionClass.wire,
        )

    companion object {
        /**
         * Log the depth of every typed stream at startup. Cheap, and it is the
         * fastest way to spot a migration half-done — messages piling up on a
         * stream nobody is consuming yet.
         */
        fun verifyStreams(redis: RedisProvider, legacyStreamKey: String?) {
            val log = LoggerFactory.getLogger(TypedStreamsWorkflowQueue::class.java)
            for (cls in ExecutionClass.entries) {
                val len = runCatching { redis.commands.xlen(cls.streamKey) }.getOrNull()
                log.info("[queue] stream='{}' len={} (ready)", cls.streamKey, len ?: "unknown")
            }
            legacyStreamKey?.let {
                val len = runCatching { redis.commands.xlen(it) }.getOrNull()
                log.warn(
                    "[queue] LEGACY MIRROR ACTIVE — stream='{}' len={}. Every enqueue is written twice. " +
                        "Remove REDIS_LEGACY_QUEUE_STREAM once all workers consume typed streams " +
                        "(docs/architecture/TYPED-QUEUE-MIGRATION.md).",
                    it, len ?: "unknown",
                )
            }
        }
    }
}
