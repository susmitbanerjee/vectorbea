package com.vectorbea.worker.queue

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import kotlinx.coroutines.CoroutineName
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.withTimeoutOrNull
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicInteger

/**
 * Execution slots as **permits**, not threads.
 *
 * WHAT CHANGED AND WHY IT MATTERS
 * -------------------------------
 * `ExecutionPoolRouter` gave each class a fixed thread pool, so a slot was a
 * thread. An agent run spends 2–30 s parked on an LLM socket doing nothing, and
 * for all of that time it owned a thread. With an agent pool of 6 that is six
 * threads, mostly asleep, and a hard ceiling of six concurrent agent runs per
 * replica no matter how idle the CPU is (§1.4).
 *
 * Cooperative yield did not help: it releases the thread *between* nodes, and an
 * LLM call is one node.
 *
 * Here a slot is a [Semaphore] permit. A run holds a permit for its whole life,
 * but while it awaits I/O it holds no thread at all — the continuation sits on
 * the heap and a small shared dispatcher runs whatever is actually runnable. The
 * ceiling stops being "how many threads can we afford" and becomes "how much
 * memory does an in-flight step cost, and what will the provider let us send".
 *
 * WHAT THE LIMITS ACTUALLY ARE NOW
 * --------------------------------
 * Defaults are the §2.3 targets (short 400 / long 100 / agent 200 / system 20),
 * but they are starting points to measure from, not claims. The real ceilings are
 * heap per in-flight step and provider rate limits, both of which are measured
 * rather than assumed — see docs/architecture/SUSPENDING-IO.md.
 */
class ExecutionSlots(
    private val shortPermits: Int,
    private val longPermits: Int,
    private val agentPermits: Int,
    private val systemPermits: Int,
    /**
     * Threads backing the coroutine dispatcher.
     *
     * Small on purpose, and the number to watch: if the conversion worked, a few
     * threads serve hundreds of concurrent runs. If this needs to grow with
     * concurrency, something is still blocking and BlockHound should have caught
     * it.
     */
    private val dispatcherThreads: Int =
        System.getenv("WORKER_DISPATCHER_THREADS")?.toIntOrNull()
            ?: (Runtime.getRuntime().availableProcessors() * 2).coerceAtLeast(4),
) : AutoCloseable {

    private val log = logger()
    private val threadCounter = AtomicInteger(0)

    private val executor = Executors.newFixedThreadPool(dispatcherThreads) { r ->
        Thread(r, "vectorbea-worker-exec-${threadCounter.incrementAndGet()}").apply {
            isDaemon = false
        }
    }
    private val dispatcher = executor.asCoroutineDispatcher()

    private val supervisor = SupervisorJob()
    private val scope = CoroutineScope(supervisor + dispatcher + CoroutineName("run-exec"))

    private data class Lane(
        val name: String,
        val permits: Int,
        val semaphore: Semaphore,
        val inFlight: AtomicInteger = AtomicInteger(0),
    )

    private val lanes: Map<WorkerJobType, Lane> = mapOf(
        WorkerJobType.SHORT to lane("short", shortPermits),
        WorkerJobType.LONG to lane("long", longPermits),
        WorkerJobType.AGENT to lane("agent", agentPermits),
        WorkerJobType.SYSTEM to lane("system", systemPermits),
    )

    private fun lane(name: String, permits: Int) =
        Lane("vectorbea-worker-$name", permits.coerceAtLeast(1), Semaphore(permits.coerceAtLeast(1)))

    // ── Capacity queries — same shape the consumers already use ───────────────

    /** Free permits for [type]. Consumers read at most this many messages. */
    fun availableCapacity(type: WorkerJobType): Int {
        val l = lanes.getValue(type)
        return (l.permits - l.inFlight.get()).coerceAtLeast(0)
    }

    fun capacityOf(type: WorkerJobType): Int = lanes.getValue(type).permits
    fun poolName(type: WorkerJobType): String = lanes.getValue(type).name
    fun hasCapacity(type: WorkerJobType): Boolean = availableCapacity(type) > 0
    fun totalAvailableCapacity(): Int = lanes.keys.sumOf { availableCapacity(it) }

    fun utilization(): Map<WorkerJobType, Pair<Int, Int>> =
        lanes.mapValues { (_, l) -> l.inFlight.get() to l.permits }

    /**
     * Submit suspending work under a permit for [type].
     *
     * Returns false without launching if no permit is free — the caller buffers,
     * exactly as it did with the thread pool. `tryAcquire` rather than `acquire`
     * keeps this non-blocking so the poll loop is never parked by admission.
     */
    fun submit(type: WorkerJobType, block: suspend () -> Unit): Boolean {
        val l = lanes.getValue(type)
        if (!l.semaphore.tryAcquire()) return false
        l.inFlight.incrementAndGet()
        return try {
            scope.launch {
                try {
                    block()
                } catch (t: Throwable) {
                    // A run that throws must not take the lane down with it.
                    log.error("[slots] uncaught error in {} lane: {}", l.name, t.message, t)
                } finally {
                    l.inFlight.decrementAndGet()
                    l.semaphore.release()
                }
            }
            true
        } catch (e: Exception) {
            l.inFlight.decrementAndGet()
            l.semaphore.release()
            log.warn("[slots] launch rejected for {} lane: {}", l.name, e.message)
            false
        }
    }

    fun logConfiguration() {
        log.info(
            "[slots] permit-based execution — short={} long={} agent={} system={} (total {} permits) " +
                "on {} dispatcher threads. A slot is a permit, not a thread: waiting on I/O costs " +
                "memory, not capacity.",
            shortPermits, longPermits, agentPermits, systemPermits,
            shortPermits + longPermits + agentPermits + systemPermits, dispatcherThreads,
        )
        lanes.forEach { (type, l) ->
            WorkerMetrics.poolSlotsTotal.set(l.permits.toDouble(), type.name.lowercase())
        }
    }

    /**
     * Wait for in-flight work to finish, then stop.
     *
     * Cancels rather than waits forever: a run still suspended on a provider that
     * never answers must not be able to block a deploy.
     */
    fun shutdown(timeoutMs: Long) {
        log.info("[slots] draining (timeout={}ms)…", timeoutMs)
        kotlinx.coroutines.runBlocking {
            val drained = withTimeoutOrNull(timeoutMs) {
                while (lanes.values.any { it.inFlight.get() > 0 }) {
                    kotlinx.coroutines.delay(100)
                }
                true
            }
            if (drained == null) {
                val stuck = lanes.values.filter { it.inFlight.get() > 0 }
                    .joinToString { "${it.name}=${it.inFlight.get()}" }
                log.warn("[slots] did not drain in time — cancelling [{}]", stuck)
            }
        }
        supervisor.cancel()
        executor.shutdownNow()
    }

    override fun close() = shutdown(5_000)

    /** Live dispatcher threads — the proof that the conversion worked. */
    fun dispatcherThreadCount(): Int = dispatcherThreads
}
