package com.vectorbea.worker.queue

import com.vectorbea.worker.config.WorkerConfig
import com.vectorbea.worker.fairness.SharedTenantAdmission
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.runtime.RunProcessor
import io.lettuce.core.Consumer
import io.lettuce.core.RedisBusyException
import io.lettuce.core.StreamMessage
import io.lettuce.core.XAutoClaimArgs
import io.lettuce.core.XReadArgs
import io.lettuce.core.api.sync.RedisCommands
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Consumes exactly one typed stream — `runs.short`, `runs.long`, `runs.agent` or
 * `runs.system` — and feeds exactly one execution pool.
 *
 * WHAT THIS DELETES
 * -----------------
 * The untyped consumer had to `XREADGROUP` first and probe Postgres afterwards
 * to learn what it had taken. If a batch turned out to be agent-heavy while the
 * agent pool was full, those messages sat in *that worker's* Pending Entries
 * List, unreachable by any other worker until the idle threshold expired. Head-
 * of-line blocking had simply relocated from the thread pool into the stream.
 *
 * Here the stream **is** the class. Two consequences, and the second is the one
 * that matters:
 *
 *   1. No classifier probe. One fewer query per job, one fewer failure mode.
 *   2. `COUNT` is the pool's **free slot count**, so a message is only ever
 *      claimed when a slot exists to run it. PEL hoarding is not mitigated; it
 *      is impossible by construction.
 *
 * The one residual is tenant admission: a message can arrive for a workspace
 * that is already at its per-tenant cap even though a slot is free. That is a
 * fairness decision, not a capacity one, so those few messages go to a small
 * bounded local buffer and are retried on the next iteration — they are never
 * left in the PEL for another worker to trip over.
 *
 * DURABILITY IS UNCHANGED
 * -----------------------
 * Same contract as before, because it is what makes a crash recoverable:
 * Postgres row committed first, XADD second, `enqueue_failed` if the XADD throws,
 * and XACK **last** — only after [RunProcessor.process] reaches a durable
 * terminal state for the tick.
 */
class TypedStreamConsumer(
    private val config: WorkerConfig,
    /** Dedicated connection — XREADGROUP BLOCK holds it for the whole window. */
    private val redis: RedisCommands<String, String>,
    private val processor: RunProcessor,
    private val router: ExecutionSlots,
    private val tenantLimiter: SharedTenantAdmission,
    /** The class this consumer serves. Also names the stream and the pool. */
    private val jobType: WorkerJobType,
) {
    private val log = logger()
    private val running = AtomicBoolean(false)
    private lateinit var pollThread: Thread

    /** `runs.short` etc. Kept in one place so API and worker cannot disagree. */
    val streamKey: String = streamKeyFor(jobType)
    private val group: String = "$streamKey.workers"
    private val consumer = Consumer.from(group, config.workerId)

    private val pendingIdleMs = (System.getenv("WORKER_PENDING_JOB_IDLE_MS") ?: "60000").toLong()
    private val reclaimIntervalMs = (System.getenv("WORKER_RECLAIM_INTERVAL_MS") ?: "30000").toLong()
    private val lastReclaimAt = AtomicLong(0L)

    /** Messages held unacked by this consumer, for the per-stream PEL gauge. */
    private val unackedMessageIds: MutableSet<String> = ConcurrentHashMap.newKeySet()

    /**
     * Messages read but refused by tenant admission. Strictly bounded, and
     * distinct from the PEL: these are held in this JVM and retried locally, so
     * they never become work another worker cannot reach.
     */
    private val deferred = ArrayDeque<Pending>()
    private val deferredLock = Any()
    private data class Pending(val job: WorkflowRunJob, val msgId: String)

    private val backoff = PollBackoff(
        baseMs = config.pollSleepMs,
        maxMs = config.pollMaxSleepMs,
        multiplier = config.pollBackoffMultiplier,
        jitterMs = config.pollJitterMs,
    )

    companion object {
        /** The single definition of the typed stream naming scheme. */
        fun streamKeyFor(type: WorkerJobType): String = "runs.${type.name.lowercase()}"

        /** Max messages deferred locally per consumer before we simply stop reading. */
        private const val MAX_DEFERRED = 8

        /**
         * Marks a job that came from [enqueueLocal] rather than a stream, so the
         * ack path knows there is nothing to XACK. Synthesized SYSTEM work is
         * already durable in Postgres; there is no message to acknowledge.
         */
        private const val SYNTHETIC_MSG_ID = ""

        /** True when this id refers to a real stream message. */
        private fun isStreamMessage(msgId: String) = msgId.isNotEmpty()
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    fun ensureConsumerGroup() {
        try {
            redis.xgroupCreate(
                XReadArgs.StreamOffset.from(streamKey, "0"),
                group,
                io.lettuce.core.XGroupCreateArgs.Builder.mkstream(),
            )
            log.info("[queue:{}] consumer group created [group={}]", streamKey, group)
        } catch (e: RedisBusyException) {
            log.info("[queue:{}] consumer group already exists", streamKey)
        } catch (e: Exception) {
            if (e.message?.contains("BUSYGROUP", ignoreCase = true) == true) {
                log.info("[queue:{}] consumer group already exists", streamKey)
            } else {
                throw e
            }
        }
    }

    fun start() {
        running.set(true)
        pollThread = Thread(::pollLoop, "worker-poll-${jobType.name.lowercase()}")
        pollThread.isDaemon = false
        pollThread.start()
        log.info("[queue:{}] consumer started [pool={}, slots={}]",
            streamKey, router.poolName(jobType), router.capacityOf(jobType))
    }

    fun stop(drainTimeoutMs: Long) {
        running.set(false)
        if (::pollThread.isInitialized) {
            pollThread.interrupt()
            pollThread.join(drainTimeoutMs)
        }
        log.info("[queue:{}] consumer stopped", streamKey)
    }

    // ── Poll loop ─────────────────────────────────────────────────────────────

    private fun pollLoop() {
        log.info("[queue:{}] poll loop started", streamKey)
        while (running.get()) {
            try {
                drainDeferred()

                val now = System.currentTimeMillis()
                if (now - lastReclaimAt.get() > reclaimIntervalMs) {
                    lastReclaimAt.set(now)
                    reclaimPendingMessages()
                }

                publishGauges()

                // THE BOUND: free slots, not total slots, minus anything already
                // held locally. Read no more than we can start right now.
                val freeSlots = router.availableCapacity(jobType)
                val deferredCount = synchronized(deferredLock) { deferred.size }
                val capacity = (freeSlots - deferredCount).coerceAtLeast(0)

                if (capacity <= 0) {
                    backoffSleep()
                    continue
                }

                val messages = readMessages(capacity)
                if (messages.isNullOrEmpty()) {
                    backoffSleep()
                    continue
                }

                WorkerMetrics.messagesRead.inc(delta = messages.size.toLong())

                var submittedAny = false
                for (msg in messages) {
                    if (!running.get()) break
                    if (handleIncoming(msg)) submittedAny = true
                }

                if (submittedAny) {
                    backoff.reset()
                    WorkerMetrics.pollBackoffMs.set(backoff.currentMs.toDouble())
                } else {
                    backoffSleep()
                }
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                log.info("[queue:{}] poll loop interrupted — shutting down", streamKey)
                break
            } catch (e: Exception) {
                if (!running.get()) break
                log.error("[queue:{}] poll loop error: {} — retrying in 2s", streamKey, e.message)
                Thread.sleep(2_000)
            }
        }
        log.info("[queue:{}] poll loop exited", streamKey)
    }

    private fun backoffSleep() {
        val delay = backoff.next()
        WorkerMetrics.pollBackoffMs.set(backoff.currentMs.toDouble())
        Thread.sleep(delay)
    }

    private fun readMessages(capacity: Int): List<StreamMessage<String, String>>? {
        if (capacity <= 0) return null
        val count = minOf(config.readBatchSize, capacity).toLong()
        WorkerMetrics.redisXreadgroup.inc()
        WorkerMetrics.readBatchSize.set(count.toDouble())
        return redis.xreadgroup(
            consumer,
            XReadArgs.Builder.count(count).block(config.pollBlockMs),
            XReadArgs.StreamOffset.lastConsumed(streamKey),
        )
    }

    /** Parse and submit. Returns true when the message reached a pool slot. */
    private fun handleIncoming(msg: StreamMessage<String, String>): Boolean {
        val msgId = msg.id
        unackedMessageIds.add(msgId)
        publishGauges()

        val job = try {
            WorkflowRunJob.parse(msgId, msg.body)
        } catch (e: WorkflowRunJob.ParseException) {
            log.warn("[queue:{}] malformed message — dead-lettering [msgId={}]: {}", streamKey, msgId, e.message)
            sendToDeadLetter(msgId, msg.body, "parse_error: ${e.message?.take(300)}")
            ackMessage(msgId)
            return true
        }

        // No classifier probe: arriving on this stream IS the classification.
        return trySubmit(job, msgId) || run {
            synchronized(deferredLock) {
                if (deferred.size < MAX_DEFERRED) deferred.addLast(Pending(job, msgId))
            }
            WorkerMetrics.messagesDeferred.inc(jobType.name)
            false
        }
    }

    /** Retry locally-deferred messages before reading anything new. */
    private fun drainDeferred() {
        while (true) {
            val pending = synchronized(deferredLock) { deferred.firstOrNull() } ?: return
            if (trySubmit(pending.job, pending.msgId)) {
                synchronized(deferredLock) { deferred.removeFirstOrNull() }
            } else {
                return // still throttled — try again next iteration
            }
        }
    }

    private fun trySubmit(job: WorkflowRunJob, msgId: String): Boolean {
        val permit = tenantLimiter.tryAcquire(job.workspaceId?.toString(), jobType)
        if (!permit.acquired) {
            WorkerMetrics.tenantThrottled.inc()
            return false
        }
        val submitted = router.submit(jobType) {
            try { processAndAck(job, msgId) } finally { permit.release() }
        }
        if (!submitted) {
            permit.release()
            WorkerMetrics.poolSaturated.inc(router.poolName(jobType))
            return false
        }
        return true
    }

    private suspend fun processAndAck(job: WorkflowRunJob, msgId: String) {
        try {
            processor.process(job)
            ackMessage(msgId)
            WorkerMetrics.messagesAck.inc()
        } catch (e: Exception) {
            log.error("[queue:{}] unexpected exception from processor [msgId={}, runId={}]: {}",
                streamKey, msgId, job.runId, e.message, e)
            sendToDeadLetter(msgId, job.toStreamFields(), "processor_error: ${e.message?.take(300)}")
            ackMessage(msgId)
        }
    }

    // ── Ack / DLQ / reclaim ───────────────────────────────────────────────────

    private fun ackMessage(messageId: String) {
        if (!isStreamMessage(messageId)) return  // synthesized job — nothing to XACK
        try {
            redis.xack(streamKey, group, messageId)
            WorkerMetrics.redisXack.inc()
        } catch (e: Exception) {
            log.warn("[queue:{}] XACK failed [msgId={}]: {}", streamKey, messageId, e.message)
        } finally {
            unackedMessageIds.remove(messageId)
            publishGauges()
        }
    }

    private fun sendToDeadLetter(originalMsgId: String, fields: Map<String, String>, reason: String) {
        if (!isStreamMessage(originalMsgId)) {
            // Synthesized SYSTEM job: the durable record is the timer/lease row,
            // and the recovery loop will find it again. Nothing to dead-letter.
            log.warn("[queue:{}] synthesized job failed: {}", streamKey, reason)
            return
        }
        try {
            val dlqFields = HashMap(fields).apply {
                put("_dlq_reason", reason)
                put("_dlq_original_id", originalMsgId)
                put("_dlq_worker", config.workerId)
                put("_dlq_stream", streamKey)
                put("_dlq_at", java.time.Instant.now().toString())
            }
            redis.xadd("$streamKey:dlq",
                io.lettuce.core.XAddArgs.Builder.maxlen(1_000L).approximateTrimming(), dlqFields)
            WorkerMetrics.redisXadd.inc()
            log.info("[queue:{}] message dead-lettered [msgId={}]", streamKey, originalMsgId)
        } catch (e: Exception) {
            log.error("[queue:{}] failed to write dead-letter entry [msgId={}]: {}", streamKey, originalMsgId, e.message)
        }
    }

    /**
     * Reclaim messages a crashed worker left in the PEL.
     *
     * Note `.messages`: on Lettuce 6.3 `xautoclaim` returns `ClaimedMessages`,
     * not `List<StreamMessage>`. The previous consumer cast it with `as?
     * List<…> ?: return`, which silently evaluated to null on every sweep — no
     * exception, no log, no metric — so pending recovery had never actually run
     * (TECH-DEBT.md#D4). Fixed here and in the legacy consumer.
     */
    private fun reclaimPendingMessages() {
        try {
            val claimed = redis.xautoclaim(
                streamKey,
                XAutoClaimArgs.Builder
                    .xautoclaim(consumer, pendingIdleMs, "0-0")
                    .count(config.readBatchSize.toLong()),
            )
            val messages = claimed?.messages ?: return
            if (messages.isEmpty()) return

            // A long-running agent can exceed pendingIdleMs while it is still
            // healthy. XAUTOCLAIM also returns messages already owned by this
            // consumer, so do not submit a second copy of work that is active
            // in this JVM. Messages from dead/other consumers remain eligible.
            val reclaimable = messages.filterNot { it.id in unackedMessageIds }
            if (reclaimable.isEmpty()) return

            // Only take back what we can actually start; the rest stay pending
            // and are reclaimed on a later sweep.
            val room = router.availableCapacity(jobType)
            if (room <= 0) return

            WorkerMetrics.pelReclaimed.inc(delta = reclaimable.size.toLong())
            WorkerMetrics.xautoclaimReclaimTotal.inc(delta = reclaimable.size.toLong())
            log.info("[queue:{}] reclaimed {} pending message(s) from idle workers", streamKey, reclaimable.size)
            reclaimable.take(room).forEach { handleIncoming(it) }
        } catch (e: Exception) {
            if (e.message?.contains("unknown command", ignoreCase = true) == true) {
                log.debug("[queue:{}] XAUTOCLAIM not available (Redis < 6.2)", streamKey)
            } else {
                log.warn("[queue:{}] reclaimPendingMessages failed: {}", streamKey, e.message)
            }
        }
    }

    private fun publishGauges() {
        val outstanding = router.capacityOf(jobType) - router.availableCapacity(jobType)
        val shortName = jobType.name.lowercase()
        WorkerMetrics.poolSlotsTotal.set(router.capacityOf(jobType).toDouble(), shortName)
        WorkerMetrics.poolSlotsActive.set(outstanding.coerceAtLeast(0).toDouble(), shortName)
        WorkerMetrics.pelDepth.set(unackedMessageIds.size.toDouble(), streamKey)
        WorkerMetrics.localBufferSize.set(
            synchronized(deferredLock) { deferred.size }.toDouble(), router.poolName(jobType))
    }

    /** Messages this consumer currently holds unacked — used by tests and the report. */
    fun pelDepth(): Int = unackedMessageIds.size

    /**
     * Place a job synthesized by this worker straight onto its pool, without a
     * round trip through Redis.
     *
     * `TimerScheduler` and `CrashRecoveryLoop` produce SYSTEM work that already
     * exists durably in Postgres — a timer row, or a run with an expired lease.
     * Publishing it to a stream would add a hop and a second copy of state that
     * is already authoritative, so it is submitted locally, exactly as before.
     *
     * Never dropped: SYSTEM work is what un-sticks the platform, so if the pool
     * is momentarily full the job waits in the local deferred buffer. The
     * upstream queries batch with a LIMIT, so that buffer is bounded by them.
     */
    fun enqueueLocal(job: WorkflowRunJob) {
        if (!running.get()) throw IllegalStateException("Consumer stopped")
        if (!trySubmit(job, msgId = SYNTHETIC_MSG_ID)) {
            synchronized(deferredLock) { deferred.addLast(Pending(job, SYNTHETIC_MSG_ID)) }
        }
    }
}
