package com.vectorbea.worker.queue

import com.vectorbea.worker.config.WorkerConfig
import com.vectorbea.worker.fairness.SharedTenantAdmission
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.runtime.RunProcessor
import io.lettuce.core.Consumer
import io.lettuce.core.RedisBusyException
import io.lettuce.core.StreamMessage
import io.lettuce.core.XReadArgs
import io.lettuce.core.XAutoClaimArgs
import io.lettuce.core.api.sync.RedisCommands
import java.util.EnumMap
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * Redis Streams consumer group worker with **isolated, pool-aware backpressure**.
 *
 * The old model used a single fixed thread pool and stopped reading whenever
 * in-flight == concurrency. Four long-running jobs could therefore block every
 * new run from starting (head-of-line blocking).
 *
 * New model:
 *   Redis Stream → small bounded read → [JobClassifier] → [TenantConcurrencyLimiter]
 *   → [ExecutionPoolRouter] (short / long / agent / system pools) → [RunProcessor]
 *
 * Backpressure is per-pool: we only read as many messages as can be *placed*
 * (free pool slots + free per-pool buffer room), so long/agent saturation never
 * stalls short/system work, and the Pending Entries List can't grow unbounded.
 *
 * Ack semantics are unchanged: a message is XACK'd only AFTER [RunProcessor.process]
 * reaches a durable terminal state for that tick (completed / waiting / yielded+
 * checkpointed / failed+persisted). Yields re-enqueue a fresh RESUME_RUN, so
 * acking the original message is correct.
 */
class WorkflowQueueConsumer(
    private val config: WorkerConfig,
    private val redis: RedisCommands<String, String>,
    private val processor: RunProcessor,
    private val router: ExecutionSlots,
    private val classifier: JobClassifier,
    private val tenantLimiter: SharedTenantAdmission,
) {
    private val log = logger()

    private val running = AtomicBoolean(false)

    /**
     * Adaptive read sizing — shrinks when messages get parked in the PEL, grows
     * back when every read message finds a home. See [AdaptiveReadBatch].
     */
    private val readBatch = AdaptiveReadBatch(config.readBatchSize)

    /** Adaptive backoff for idle/saturated poll iterations — reduces wasted XREADGROUPs. */
    private val backoff = PollBackoff(
        baseMs = config.pollSleepMs,
        maxMs = config.pollMaxSleepMs,
        multiplier = config.pollBackoffMultiplier,
        jitterMs = config.pollJitterMs,
    )

    /** Outcome of placing a message — used to drive backoff reset. */
    private enum class PlaceOutcome { SUBMITTED, BUFFERED, PARKED }

    /** Dedicated poll thread — not part of any execution pool. */
    private lateinit var pollThread: Thread

    /** Consumer identity in the Redis Streams consumer group. */
    private val consumer = Consumer.from(config.queueGroup, config.workerId)

    /** How long a message can be in the PEL before we reclaim it (ms). */
    private val pendingIdleMs = (System.getenv("WORKER_PENDING_JOB_IDLE_MS") ?: "60000").toLong()
    /** How often to run the reclaim scan (ms). */
    private val reclaimIntervalMs = (System.getenv("WORKER_RECLAIM_INTERVAL_MS") ?: "30000").toLong()
    private val lastReclaimAt = AtomicLong(0L)

    /**
     * Message IDs read from the consumer group and not yet XACKed — this worker's
     * share of the Pending Entries List. Every one of these is a message no other
     * worker can touch until [pendingIdleMs] elapses, so depth here is the direct
     * measure of head-of-line blocking at the stream layer.
     *
     * A SET, not a counter. A parked message is re-read by [reclaimPendingMessages]
     * on every XAUTOCLAIM sweep until it can finally be placed, so a counter
     * incremented per delivery would count the same message once per sweep and
     * drift upward without bound. Set membership is idempotent, which is exactly
     * the semantics "messages this worker currently holds" requires.
     */
    private val unackedMessageIds: MutableSet<String> =
        java.util.concurrent.ConcurrentHashMap.newKeySet()

    // ── Bounded per-pool prefetch buffers ──────────────────────────────────────
    // A message that was read but whose pool is momentarily full waits here
    // instead of being executed on the poll thread. Strictly bounded by the read
    // gate (see [totalAcceptCapacity]); accessed under [bufferLock] because both
    // the poll thread and recovery/timer threads can enqueue.

    private data class Pending(val job: WorkflowRunJob, val type: WorkerJobType, val msgId: String?)

    private val bufferLock = Any()
    private val buffers: EnumMap<WorkerJobType, ArrayDeque<Pending>> =
        EnumMap<WorkerJobType, ArrayDeque<Pending>>(WorkerJobType::class.java).apply {
            WorkerJobType.entries.forEach { put(it, ArrayDeque()) }
        }

    /** Drain order — SYSTEM first so operational continuations are never starved. */
    private val drainOrder = listOf(WorkerJobType.SYSTEM, WorkerJobType.SHORT, WorkerJobType.LONG, WorkerJobType.AGENT)

    // ── Startup ───────────────────────────────────────────────────────────────

    /**
     * Create the consumer group if it does not already exist (idempotent,
     * tolerates BUSYGROUP). Must be called before [start].
     */
    fun ensureConsumerGroup() {
        try {
            redis.xgroupCreate(
                XReadArgs.StreamOffset.from(config.queueStream, "0"),
                config.queueGroup,
                io.lettuce.core.XGroupCreateArgs.Builder.mkstream(),
            )
            log.info("[queue] consumer group created [stream={}, group={}]",
                config.queueStream, config.queueGroup)
        } catch (e: RedisBusyException) {
            log.info("[queue] consumer group already exists [stream={}, group={}]",
                config.queueStream, config.queueGroup)
        } catch (e: Exception) {
            if (e.message?.contains("BUSYGROUP", ignoreCase = true) == true) {
                log.info("[queue] consumer group already exists [stream={}, group={}]",
                    config.queueStream, config.queueGroup)
            } else {
                throw e
            }
        }
    }

    fun start() {
        running.set(true)
        pollThread = Thread(::pollLoop, "worker-poll")
        pollThread.isDaemon = false
        pollThread.start()
        log.info("[queue] consumer started [stream={}, group={}, consumer={}, pools=short:{}/long:{}/agent:{}/system:{}]",
            config.queueStream, config.queueGroup, config.workerId,
            config.shortConcurrency, config.longConcurrency, config.agentConcurrency, config.systemConcurrency)
    }

    /**
     * Enqueue a synthesized job (crash recovery / timer scheduler). Classified as
     * SYSTEM so it is never tenant-throttled and runs on the system pool. If the
     * system pool is momentarily full it is buffered, not run on the caller thread.
     */
    fun enqueueRecovery(job: WorkflowRunJob) {
        if (!running.get()) throw IllegalStateException("Consumer stopped")
        val type = WorkerJobType.SYSTEM
        if (!trySubmit(job, type, msgId = null)) {
            // Synthesized jobs have no PEL to fall back on, so they are always
            // retained in the system buffer. Bounded by the upstream LIMIT on the
            // timer/crash-recovery queries (they enqueue in small batches).
            synchronized(bufferLock) { buffers.getValue(type).addLast(Pending(job, type, null)) }
        }
    }

    /**
     * Graceful shutdown: stop the poll loop, then drain the execution pools within
     * [WorkerConfig.shutdownTimeoutMs].
     */
    fun stop(drainTimeoutSeconds: Long = config.shutdownTimeoutMs / 1000L) {
        log.info("[queue] stopping consumer (drain timeout={}s)…", drainTimeoutSeconds)
        running.set(false)

        if (::pollThread.isInitialized) {
            pollThread.interrupt()
            pollThread.join(drainTimeoutSeconds * 1_000L)
        }

        router.shutdown(config.shutdownTimeoutMs)
        log.info("[queue] consumer stopped")
    }

    // ── Poll loop ─────────────────────────────────────────────────────────────

    private fun pollLoop() {
        log.info("[queue] poll loop started")

        while (running.get()) {
            try {
                // 1. Drain anything buffered from a previous iteration into now-free slots.
                drainBuffers()

                // 2. Periodically reclaim pending messages from dead workers.
                val now = System.currentTimeMillis()
                if (now - lastReclaimAt.get() > reclaimIntervalMs) {
                    lastReclaimAt.set(now)
                    reclaimPendingMessages()
                }

                publishPoolGauges()

                // 3. Pool-aware backpressure: only read what we can actually place.
                // When nothing can be placed, back off adaptively instead of spinning
                // XREADGROUP on messages we cannot serve.
                val capacity = totalAcceptCapacity()
                if (capacity <= 0) {
                    backoffSleep()
                    continue
                }

                val messages = readMessages(capacity)

                if (messages.isNullOrEmpty()) {
                    // Idle: no work within the block window — grow backoff.
                    backoffSleep()
                    continue
                }

                WorkerMetrics.messagesRead.inc(delta = messages.size.toLong())
                log.debug("[queue] received {} message(s)", messages.size)

                var submittedAny = false
                var parkedAny = false
                for (msg in messages) {
                    if (!running.get()) break
                    when (handleIncoming(msg)) {
                        PlaceOutcome.SUBMITTED -> submittedAny = true
                        PlaceOutcome.PARKED    -> parkedAny = true
                        PlaceOutcome.BUFFERED  -> { /* placed locally, no backoff change */ }
                    }
                }

                // Feed the read controller: parking means we pulled work this
                // worker could not start, which is the thing to stop doing.
                if (parkedAny) readBatch.onParked() else readBatch.onAllPlaced()

                // Progress was made → reset to the floor for snappy throughput.
                if (submittedAny) {
                    backoff.reset()
                    WorkerMetrics.pollBackoffMs.set(backoff.currentMs.toDouble())
                }
                // Some messages couldn't be placed (a class is saturated). They stay
                // in the PEL (durable, reclaimed later) and we back off so we don't
                // keep pulling work we can't serve.
                if (parkedAny && !submittedAny) backoffSleep()

            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                log.info("[queue] poll loop interrupted — shutting down")
                break
            } catch (e: Exception) {
                if (!running.get()) break
                log.error("[queue] poll loop error: {} — retrying in 2s", e.message)
                Thread.sleep(2_000)
            }
        }

        log.info("[queue] poll loop exited")
    }

    /** Sleep for the next adaptive backoff interval and publish the gauge. */
    private fun backoffSleep() {
        val delay = backoff.next()
        WorkerMetrics.pollBackoffMs.set(backoff.currentMs.toDouble())
        Thread.sleep(delay)
    }

    /**
     * Placements available right now = **free** pool slots (capacity minus
     * outstanding, never total) plus **free** local buffer room (the per-pool
     * cap minus what is already buffered), summed across the four pools.
     *
     * Necessary, but not sufficient on its own: the stream is untyped, so a
     * message's class is only known after it is read. See [AdaptiveReadBatch]
     * for the control that covers the gap, and §2.1 of
     * 09-EXECUTION-ARCHITECTURE-REVISED.md for the real fix.
     */
    private fun totalAcceptCapacity(): Int = synchronized(bufferLock) {
        WorkerJobType.entries.sumOf { type ->
            val bufferRoom = (config.maxPrefetchPerPool - buffers.getValue(type).size).coerceAtLeast(0)
            router.availableCapacity(type) + bufferRoom
        }
    }

    private fun readMessages(capacity: Int): List<StreamMessage<String, String>>? {
        val count = readBatch.next(capacity)
        // Never request work with nowhere to put it. The previous
        // `.coerceAtLeast(1)` meant a zero-capacity call still pulled one
        // message straight into the PEL; the poll loop guarded against that at
        // the call site, but the function was unsafe on its own terms.
        if (count <= 0) return null
        WorkerMetrics.readBatchSize.set(count.toDouble())
        WorkerMetrics.redisXreadgroup.inc()
        return redis.xreadgroup(
            consumer,
            XReadArgs.Builder.count(count.toLong()).block(config.pollBlockMs),
            XReadArgs.StreamOffset.lastConsumed(config.queueStream),
        )
    }

    /**
     * Parse → classify → place. Malformed messages are dead-lettered + acked.
     * Returns the [PlaceOutcome] so the poll loop can drive adaptive backoff.
     */
    private fun handleIncoming(msg: StreamMessage<String, String>): PlaceOutcome {
        val msgId = msg.id
        val fields = msg.body

        // The message is ours from this point until XACK. Re-adding an ID we
        // already hold (a reclaimed park) is a no-op, which is the point.
        unackedMessageIds.add(msgId)
        WorkerMetrics.pelDepth.set(unackedMessageIds.size.toDouble(), config.queueStream)

        val job = try {
            WorkflowRunJob.parse(msgId, fields)
        } catch (e: WorkflowRunJob.ParseException) {
            log.warn("[queue] malformed message — dead-lettering [msgId={}]: {}", msgId, e.message)
            sendToDeadLetter(msgId, fields, "parse_error: ${e.message?.take(300)}")
            ackMessage(msgId)
            return PlaceOutcome.SUBMITTED // handled = progress
        }

        // §6.1: the classifier probes Postgres on the hot path. Measure it, so the
        // cost of removing it later can be stated rather than guessed.
        val classifyStart = System.nanoTime()
        val type = classifier.classify(job)
        WorkerMetrics.jobClassifyDurationSeconds.observeSeconds(
            (System.nanoTime() - classifyStart) / 1_000_000_000.0, type.name.lowercase())

        return tryPlace(job, type, msgId)
    }

    /**
     * Submit to the pool, or buffer (strictly bounded by [WorkerConfig.maxPrefetchPerPool]).
     * If neither is possible the message is left UNACKED — it stays in the Redis
     * PEL (durable) and is reclaimed by [reclaimPendingMessages] once idle. This
     * caps JVM memory: a saturated class can never grow the local buffer past its
     * hard limit.
     */
    private fun tryPlace(job: WorkflowRunJob, type: WorkerJobType, msgId: String?): PlaceOutcome {
        if (trySubmit(job, type, msgId)) return PlaceOutcome.SUBMITTED
        val buffered = synchronized(bufferLock) {
            val q = buffers.getValue(type)
            if (q.size < config.maxPrefetchPerPool) { q.addLast(Pending(job, type, msgId)); true } else false
        }
        if (buffered) {
            WorkerMetrics.messagesDeferred.inc(type.name)
            return PlaceOutcome.BUFFERED
        }
        WorkerMetrics.poolSaturated.inc(router.poolName(type))
        WorkerMetrics.pelParked.inc(router.poolName(type))
        log.debug("[queue] pool {} saturated — leaving message in PEL for reclaim [msgId={}]",
            router.poolName(type), msgId)
        return PlaceOutcome.PARKED
    }

    /**
     * Drain buffered messages into now-free pool slots. SYSTEM first. Stops a pool
     * as soon as it can't place its head item (full pool or throttled tenant).
     */
    private fun drainBuffers() {
        for (type in drainOrder) {
            while (true) {
                val pending = synchronized(bufferLock) { buffers.getValue(type).firstOrNull() } ?: break
                if (trySubmit(pending.job, pending.type, pending.msgId)) {
                    synchronized(bufferLock) { buffers.getValue(type).removeFirstOrNull() }
                } else {
                    break // pool full or tenant throttled — try again next iteration
                }
            }
        }
    }

    /**
     * Acquire a tenant permit and a pool slot, then submit. Returns false (without
     * side effects beyond metrics) if either is unavailable so the caller buffers.
     * The permit is released in the task's finally, even on failure.
     */
    private fun trySubmit(job: WorkflowRunJob, type: WorkerJobType, msgId: String?): Boolean {
        val tenantKey = job.workspaceId?.toString()
        val permit = tenantLimiter.tryAcquire(tenantKey, type)
        if (!permit.acquired) {
            WorkerMetrics.tenantThrottled.inc()
            return false
        }
        val submitted = router.submit(type) {
            try {
                processAndAck(job, msgId)
            } finally {
                permit.release()
            }
        }
        if (!submitted) {
            permit.release()
            WorkerMetrics.poolSaturated.inc(router.poolName(type))
            return false
        }
        return true
    }

    /**
     * Run the job, then XACK only on a durable terminal state. The processor never
     * throws (it converts failures to RUN_FAILED), so the catch is a last resort
     * that dead-letters before clearing the PEL.
     */
    private suspend fun processAndAck(job: WorkflowRunJob, msgId: String?) {
        try {
            processor.process(job)
            if (msgId != null) {
                ackMessage(msgId)
                WorkerMetrics.messagesAck.inc()
            }
        } catch (e: Exception) {
            log.error("[queue] unexpected exception from processor [msgId={}, runId={}]: {}",
                msgId, job.runId, e.message, e)
            if (msgId != null) {
                sendToDeadLetter(msgId, job.toStreamFields(), "processor_error: ${e.message?.take(300)}")
                ackMessage(msgId)
            }
        }
    }

    // ── Dead-letter / ack ──────────────────────────────────────────────────────

    private fun sendToDeadLetter(originalMsgId: String, fields: Map<String, String>, reason: String) {
        try {
            val dlqFields = HashMap(fields).apply {
                put("_dlq_reason", reason)
                put("_dlq_original_id", originalMsgId)
                put("_dlq_worker", config.workerId)
                put("_dlq_at", java.time.Instant.now().toString())
            }
            redis.xadd(
                "${config.queueStream}:dlq",
                io.lettuce.core.XAddArgs.Builder.maxlen(1_000L).approximateTrimming(),
                dlqFields,
            )
            WorkerMetrics.redisXadd.inc()
            log.info("[queue] message dead-lettered [msgId={}, dlq={}:dlq]", originalMsgId, config.queueStream)
        } catch (e: Exception) {
            log.error("[queue] failed to write dead-letter entry [msgId={}]: {}", originalMsgId, e.message)
        }
    }

    private fun ackMessage(messageId: String) {
        try {
            redis.xack(config.queueStream, config.queueGroup, messageId)
            WorkerMetrics.redisXack.inc()
            log.debug("[queue] XACK [msgId={}]", messageId)
        } catch (e: Exception) {
            log.warn("[queue] XACK failed [msgId={}]: {}", messageId, e.message)
        } finally {
            // Whether or not the XACK reached Redis, this worker is no longer
            // holding the message for the purpose of local capacity accounting.
            unackedMessageIds.remove(messageId)
            WorkerMetrics.pelDepth.set(unackedMessageIds.size.toDouble(), config.queueStream)
        }
    }

    /**
     * Reclaim messages idle in the PEL longer than [pendingIdleMs] — recovers jobs
     * claimed by a crashed worker. Reclaimed messages go through the same
     * classify/submit path; idempotency guards prevent duplicate side effects.
     *
     * FIXED HERE (was TECH-DEBT.md#D4). On Lettuce 6.3.2 the sync API is:
     *
     *   ClaimedMessages<K, V> xautoclaim(K key, XAutoClaimArgs<K> args)
     *
     * not `List<StreamMessage<K, V>>`. This previously read
     * `... as? List<StreamMessage<String, String>> ?: return`, which evaluated
     * to null on every sweep and returned silently — no exception, no log line,
     * no metric — so pending recovery had never once run. Messages a saturated
     * pool parked here sat until the process restarted.
     *
     * Typed streams make parking rare (a message is only claimed when a slot
     * exists), but this path still matters for the case it was written for:
     * recovering work from a worker that died mid-flight.
     */
    private fun reclaimPendingMessages() {
        try {
            val claimed = redis.xautoclaim(
                config.queueStream,
                XAutoClaimArgs.Builder
                    .xautoclaim(consumer, pendingIdleMs, "0-0")
                    .count(config.readBatchSize.toLong()),
            )
            val messages = claimed?.messages ?: return
            if (messages.isNotEmpty()) {
                WorkerMetrics.pelReclaimed.inc(delta = messages.size.toLong())
                WorkerMetrics.xautoclaimReclaimTotal.inc(delta = messages.size.toLong())
                log.info("[queue] reclaimed {} pending message(s) from idle workers", messages.size)
                messages.forEach { handleIncoming(it) }
            }
        } catch (e: Exception) {
            if (e.message?.contains("XAUTOCLAIM") == true || e.message?.contains("unknown command") == true) {
                log.debug("[queue] XAUTOCLAIM not available (Redis < 6.2) — pending recovery disabled")
            } else {
                log.warn("[queue] reclaimPendingMessages failed: {}", e.message)
            }
        }
    }

    private fun publishPoolGauges() {
        var freeAcrossPools = 0L
        router.utilization().forEach { (type, util) ->
            val (outstanding, capacity) = util
            val name = router.poolName(type)
            // Short label ("agent") for the new metrics; the legacy metrics keep
            // the fully-qualified pool name so existing dashboards do not break.
            val shortName = type.name.lowercase()
            WorkerMetrics.activeRunsByPool.set(outstanding.toDouble(), name)
            val free = (capacity - outstanding).coerceAtLeast(0)
            freeAcrossPools += free
            WorkerMetrics.poolCapacityAvailable.set(free.toDouble(), name)
            WorkerMetrics.poolSlotsTotal.set(capacity.toDouble(), shortName)
            WorkerMetrics.poolSlotsActive.set(outstanding.toDouble(), shortName)
            val buffered = synchronized(bufferLock) { buffers.getValue(type).size }
            WorkerMetrics.localBufferSize.set(buffered.toDouble(), name)
        }
        // The §5.4 headline number: free slots on this worker, all pools together.
        WorkerMetrics.workerSlotsAvailable.set(freeAcrossPools.toDouble())
        WorkerMetrics.pelDepth.set(unackedMessageIds.size.toDouble(), config.queueStream)
    }
}
