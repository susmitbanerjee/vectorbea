package com.vectorbea.worker.queue

import com.vectorbea.worker.logging.logger
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * Routes jobs to one of four isolated, bounded thread pools — one per
 * [WorkerJobType]. This is the core fix for head-of-line blocking: long/agent
 * runs can occupy at most their own pool's threads, so short and system jobs
 * always retain capacity.
 *
 * Capacity model:
 *  - Each pool runs at most [capacityOf] tasks concurrently.
 *  - We track "outstanding" (submitted-but-not-finished) per pool with an
 *    [AtomicInteger] and only submit while outstanding < capacity, so the pool's
 *    internal queue never backs up. Prefetch buffering lives in the consumer,
 *    not here — this keeps each pool a clean fixed-width execution slot.
 *
 * Thread naming: `vectorbea-worker-{short|long|agent|system}-N`.
 */
class ExecutionPoolRouter(
    private val shortConcurrency: Int,
    private val longConcurrency: Int,
    private val agentConcurrency: Int,
    private val systemConcurrency: Int,
) {
    private val log = logger()

    private data class Pool(
        val name: String,
        val executor: ExecutorService,
        val capacity: Int,
        val outstanding: AtomicInteger = AtomicInteger(0),
    )

    private val pools: Map<WorkerJobType, Pool> = mapOf(
        WorkerJobType.SHORT  to pool("short",  shortConcurrency),
        WorkerJobType.LONG   to pool("long",   longConcurrency),
        WorkerJobType.AGENT  to pool("agent",  agentConcurrency),
        WorkerJobType.SYSTEM to pool("system", systemConcurrency),
    )

    private fun pool(name: String, concurrency: Int): Pool {
        val cap = concurrency.coerceAtLeast(1)
        val counter = AtomicInteger(0)
        val exec = Executors.newFixedThreadPool(cap) { r ->
            Thread(r).also {
                it.name = "vectorbea-worker-$name-${counter.incrementAndGet()}"
                it.isDaemon = false
            }
        }
        return Pool("vectorbea-worker-$name", exec, cap)
    }

    /** Threads currently free in the pool for [type] (>= 0). */
    fun availableCapacity(type: WorkerJobType): Int {
        val p = pools.getValue(type)
        return (p.capacity - p.outstanding.get()).coerceAtLeast(0)
    }

    fun hasCapacity(type: WorkerJobType): Boolean = availableCapacity(type) > 0

    /** Configured max concurrency for [type]. */
    fun capacityOf(type: WorkerJobType): Int = pools.getValue(type).capacity

    fun poolName(type: WorkerJobType): String = pools.getValue(type).name

    /** Total free execution slots across all pools. */
    fun totalAvailableCapacity(): Int = pools.keys.sumOf { availableCapacity(it) }

    /**
     * Submit [task] to the pool for [type] if it has a free slot.
     * Returns true if accepted (and the slot is reserved until [task] finishes),
     * false if the pool is at capacity — the caller should buffer/defer.
     *
     * The outstanding counter is decremented in a finally so a thrown task still
     * releases its slot.
     */
    fun submit(type: WorkerJobType, task: Runnable): Boolean {
        val p = pools.getValue(type)
        // Reserve a slot optimistically; roll back if we overshoot capacity.
        if (p.outstanding.incrementAndGet() > p.capacity) {
            p.outstanding.decrementAndGet()
            return false
        }
        return try {
            p.executor.submit {
                try { task.run() } finally { p.outstanding.decrementAndGet() }
            }
            true
        } catch (e: Exception) {
            // RejectedExecutionException (e.g. during shutdown) — release the slot.
            p.outstanding.decrementAndGet()
            log.warn("[pools] submit rejected for {} pool: {}", p.name, e.message)
            false
        }
    }

    /** Snapshot of per-pool utilization for metrics/logging. */
    fun utilization(): Map<WorkerJobType, Pair<Int, Int>> =
        pools.mapValues { (_, p) -> p.outstanding.get() to p.capacity }

    /**
     * Graceful shutdown: stop accepting tasks, wait up to [timeoutMs] total for
     * in-flight work to drain, then force-stop whatever remains.
     */
    fun shutdown(timeoutMs: Long) {
        log.info("[pools] shutting down (timeout={}ms)…", timeoutMs)
        pools.values.forEach { it.executor.shutdown() }
        val deadline = System.currentTimeMillis() + timeoutMs
        pools.values.forEach { p ->
            val remaining = (deadline - System.currentTimeMillis()).coerceAtLeast(0)
            val drained = runCatching {
                p.executor.awaitTermination(remaining, TimeUnit.MILLISECONDS)
            }.getOrDefault(false)
            if (!drained) {
                log.warn("[pools] {} did not drain in time — forcing shutdown", p.name)
                p.executor.shutdownNow()
            }
        }
        log.info("[pools] shutdown complete")
    }
}
