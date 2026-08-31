package com.vectorbea.worker.queue

import com.vectorbea.worker.config.WorkerConfig
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.runtime.RunProcessor
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.locks.LockSupport

/**
 * One claim loop per execution class, replacing [TypedStreamConsumer].
 *
 * Same shape as the stream consumer it replaces — claim only what there are free
 * permits for, submit, repeat — but with three things gone that the stream
 * version needed: no PEL, no XACK, and no reclaim of messages this worker was
 * holding but could not run. A claimed row is state in Postgres, visible to
 * everyone, recoverable by a single sweep.
 *
 * The loop parks rather than spins. It is unparked by [ClaimWakeup] — a NOTIFY
 * when work arrives, or the 2 s safety poll — so an idle queue costs nothing.
 */
class ClaimConsumer(
    private val config: WorkerConfig,
    private val claim: PostgresClaim,
    private val processor: RunProcessor,
    private val slots: ExecutionSlots,
    private val jobType: WorkerJobType,
) {
    private val log = logger()
    private val running = AtomicBoolean(false)
    private var thread: Thread? = null

    /** Set when a wakeup arrives while the loop is working, so it re-checks. */
    private val pending = AtomicBoolean(true)

    /**
     * Permits this pool holds open for the priority lane.
     *
     * Never more than half the pool: a reserve larger than that starves the
     * traffic it is meant to protect, which is a worse outcome than a slow demo.
     */
    private val reservedPermits: Int =
        (System.getenv("CLAIM_RESERVED_PRIORITY_SLOTS")?.toIntOrNull() ?: 1)
            .coerceIn(0, maxOf(0, slots.capacityOf(jobType) / 2))

    fun start() {
        running.set(true)
        thread = Thread(::loop, "claim-${jobType.name.lowercase()}").apply {
            isDaemon = false
            start()
        }
        log.info("[claim:{}] consumer started [permits={} reserved-for-priority={}]",
            jobType.label, slots.capacityOf(jobType), reservedPermits)
    }

    /** Called by [ClaimWakeup]. Cheap and safe from any thread. */
    fun wakeup() {
        pending.set(true)
        thread?.let { LockSupport.unpark(it) }
    }

    fun stop(drainTimeoutMs: Long) {
        running.set(false)
        thread?.let { LockSupport.unpark(it); it.join(drainTimeoutMs) }
        log.info("[claim:{}] consumer stopped", jobType.name.lowercase())
    }

    private fun loop() {
        log.info("[claim:{}] loop started", jobType.name.lowercase())
        while (running.get()) {
            try {
                if (!pending.getAndSet(false)) {
                    // Nothing signalled. Park until woken — the safety poll
                    // guarantees this is never indefinite.
                    LockSupport.parkNanos(java.util.concurrent.TimeUnit.SECONDS.toNanos(5))
                    continue
                }

                // Claim only what can start right now. Claiming more would
                // reproduce, in Postgres, the hoarding this design removes from
                // Redis — a row sitting in `claimed` is just as unreachable to
                // other workers as a message in a PEL.
                val free = slots.availableCapacity(jobType)
                if (free <= 0) {
                    LockSupport.parkNanos(java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(200))
                    pending.set(true)
                    continue
                }

                // ── The reserved lane ────────────────────────────────────────
                //
                // `reservedPermits` of this pool are kept free for priority
                // traffic at all times, so a demo never queues behind a flood.
                // The rule is a floor on free permits rather than a running count
                // of who holds what:
                //
                //   free  > reserved → claim anything, but only down to the
                //                      reserve. Priority still goes first because
                //                      the claim orders by priority DESC.
                //   free <= reserved → claim priority runs only. Ordinary traffic
                //                      cannot touch the last N permits.
                //
                // Stateless, so it stays correct across restarts and across
                // replicas without any coordination — each worker independently
                // holds N permits open, and the fleet-wide reserve is the sum.
                val ordinaryBudget = free - reservedPermits
                val priorityFloor = if (ordinaryBudget > 0) 0 else PostgresClaim.PRIORITY_LANE_FLOOR
                val batch = minOf(if (ordinaryBudget > 0) ordinaryBudget else free, config.readBatchSize)

                val claimed = claim.claim(
                    executionClass = jobType,
                    batchSize = batch,
                    // SYSTEM is exempt from the tenant total. Timer resumes,
                    // cancellations and crash recovery are the platform's own
                    // work; holding them behind a customer's run quota would let
                    // a busy workspace delay its own recovery.
                    defaultTotalCap = if (jobType == WorkerJobType.SYSTEM) Int.MAX_VALUE
                                      else config.maxActiveRunsPerTenant,
                    defaultClassCap = when (jobType) {
                        WorkerJobType.AGENT,
                        WorkerJobType.AGENT_CHILD,
                        WorkerJobType.AGENT_INTERACTIVE -> config.maxActiveAgentRunsPerTenant
                        WorkerJobType.LONG -> config.maxActiveLongRunsPerTenant
                        WorkerJobType.SHORT -> config.maxActiveShortRunsPerTenant
                        WorkerJobType.SYSTEM -> Int.MAX_VALUE
                    },
                    priorityFloor = priorityFloor,
                )
                if (priorityFloor > 0 && claimed.isNotEmpty()) {
                    WorkerMetrics.claimReservedLaneTotal.inc(jobType.label, delta = claimed.size.toLong())
                }

                if (claimed.isEmpty()) continue

                WorkerMetrics.messagesRead.inc(delta = claimed.size.toLong())
                for (run in claimed) {
                    if (!running.get()) { claim.release(run.runId); continue }
                    val submitted = slots.submit(jobType) {
                        processor.process(run.toJob())
                    }
                    if (!submitted) {
                        // A permit vanished between the capacity check and the
                        // submit. Put it back rather than hold it — an unstarted
                        // claim is a run nobody else can see.
                        claim.release(run.runId)
                    }
                }
                // More may be waiting; re-check without parking.
                pending.set(true)

            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt(); break
            } catch (e: Exception) {
                if (!running.get()) break
                log.error("[claim:{}] loop error: {} — retrying in 2s", jobType.name.lowercase(), e.message)
                runCatching { Thread.sleep(2_000) }
            }
        }
        log.info("[claim:{}] loop exited", jobType.name.lowercase())
    }
}
