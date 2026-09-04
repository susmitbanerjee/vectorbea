package com.vectorbea.worker.runtime

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import java.util.concurrent.Callable
import java.util.concurrent.Future
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.asCoroutineDispatcher
import java.util.concurrent.atomic.AtomicInteger

/**
 * The only place `db_read` / `db_write` node execution is allowed to run.
 *
 * WHY THIS EXISTS
 * ---------------
 * A tenant database is the one outbound dependency the platform cannot fix,
 * cannot health-check ahead of time, and cannot route around. It is reached over
 * the public internet, to a host the tenant controls, and the realistic failure
 * is not "refused" (which fails in milliseconds and is harmless) but "TCP
 * accepted, nothing ever answered".
 *
 * Before this dispatcher, every node type shared one execution path, so a
 * hanging tenant database consumed threads that agent and short runs also needed.
 * The bound was correct — driver-level `socketTimeout`, see TIMEOUT-AUDIT.md —
 * but a bound is not isolation. Thirty seconds × N hung queries still came out of
 * everyone's capacity.
 *
 * THE CONTAINMENT GUARANTEE
 * -------------------------
 * A hanging tenant database can exhaust **this dispatcher and nothing else.**
 *
 * That guarantee is why the rejection policy is [RejectedExecutionException] and
 * **not** `CallerRunsPolicy`. Caller-runs is the usual choice for a bounded pool
 * and it is exactly wrong here: it would run the query on whichever pool thread
 * submitted it, spilling the hang straight back into the agent or short pool and
 * silently deleting the isolation this class exists to provide. When the
 * dispatcher is full, a `db_*` node fails fast with an actionable message
 * instead. A failed run is recoverable; a stalled platform is not.
 *
 * SIZING
 * ------
 * [maxThreads] defaults to 16 (`WORKER_POOL_TENANT_DB`). At the 30 s socket
 * timeout that is 16 concurrent hung queries absorbed before rejection begins.
 * Threads are the cost — each is a stack, parked on a socket — so this is
 * bounded by memory rather than CPU.
 *
 * WHAT THIS DOES NOT DO
 * ---------------------
 * Isolation here is dispatcher-level, not tenant-level. One workspace with a
 * black-hole database can still consume all 16 threads and cause *other
 * workspaces'* database nodes to be rejected. Per-tenant reservation inside the
 * dispatcher belongs with the shared-fairness work in §3 of
 * 09-EXECUTION-ARCHITECTURE-REVISED.md. What is fixed today is the part that
 * matters most: agent, short, long and system work no longer pay for it at all.
 */
class TenantDbDispatcher(
    private val maxThreads: Int = 16,
    /**
     * Queue depth in front of the threads. Small on purpose: a deep queue turns
     * rejection (fast, visible, actionable) into latency (slow, invisible, and
     * indistinguishable from the hang itself).
     */
    private val queueDepth: Int = 8,
) : AutoCloseable {

    private val log = logger()
    private val threadCounter = AtomicInteger(0)

    /** Submitted-but-not-finished, for the saturation gauge. */
    private val inFlight = AtomicInteger(0)

    private val executor = ThreadPoolExecutor(
        maxThreads, maxThreads,
        60L, TimeUnit.SECONDS,
        LinkedBlockingQueue(queueDepth),
        { r ->
            Thread(r).also {
                it.name = "tenant-db-${threadCounter.incrementAndGet()}"
                // Daemon: a thread parked on a black-hole socket must never keep
                // the JVM alive during shutdown.
                it.isDaemon = true
            }
        },
        // NOT CallerRunsPolicy — see the class KDoc. Rejection is the guarantee.
        ThreadPoolExecutor.AbortPolicy(),
    ).apply {
        allowCoreThreadTimeOut(true)
    }

    /** Raised when the dispatcher is full. Carries a message safe to show a user. */
    class DispatcherFullException(val capacity: Int, val queued: Int) : Exception(
        "Tenant database capacity is exhausted ($capacity concurrent queries, $queued queued). " +
            "This usually means one or more configured databases are not responding. " +
            "Check the Connections page, then retry."
    )

    /**
     * Submit tenant-database work. Returns a [Future] the caller bounds with its
     * own node timeout, exactly as before — the difference is which threads the
     * work runs on.
     *
     * @throws DispatcherFullException when no thread and no queue slot is free.
     */
    fun <T> submit(task: Callable<T>): Future<T> {
        publishGauges()
        return try {
            executor.submit(Callable {
                inFlight.incrementAndGet()
                // Publish AFTER the increment, not before submit — otherwise the
                // active gauge only ever samples zero, which is exactly the
                // reading you get during the incident you built it for.
                publishGauges()
                try {
                    task.call()
                } finally {
                    inFlight.decrementAndGet()
                    publishGauges()
                }
            })
        } catch (e: RejectedExecutionException) {
            WorkerMetrics.tenantDbRejectedTotal.inc()
            log.warn(
                "[tenant-db] dispatcher full — rejecting [threads={}, queued={}]. " +
                    "A tenant database is likely unresponsive; pool work is unaffected.",
                maxThreads, executor.queue.size,
            )
            throw DispatcherFullException(maxThreads, executor.queue.size)
        }
    }

    // ── Suspending entry point, with per-tenant sub-limits ────────────────────

    private val dispatcher = executor.asCoroutineDispatcher()

    /**
     * Per-tenant permits *inside* the dispatcher.
     *
     * The dispatcher already stops a hanging tenant database from reaching the
     * agent or short pools. What it did not stop was one tenant consuming all 16
     * of its threads and starving every *other* tenant's database node — the
     * containment was dispatcher-level, not tenant-level (TECH-DEBT.md#D2).
     *
     * A sub-limit fixes that: one workspace can hold at most
     * [maxPerTenant] of the threads, so a black-hole database costs its owner
     * their share and leaves the rest for everyone else.
     */
    private val perTenant = java.util.concurrent.ConcurrentHashMap<java.util.UUID, kotlinx.coroutines.sync.Semaphore>()

    private val maxPerTenant: Int =
        System.getenv("TENANT_DB_MAX_PER_TENANT")?.toIntOrNull()
            ?: (maxThreads / 4).coerceAtLeast(2)

    /**
     * Run blocking JDBC work on this dispatcher, suspending the caller.
     *
     * The coroutine suspends; a dispatcher thread blocks. That is the trade §2.3
     * describes: JDBC cannot be made non-blocking, so it is contained instead —
     * and now contained per tenant as well as in aggregate.
     *
     * @throws DispatcherFullException when this tenant's sub-limit is exhausted.
     */
    suspend fun <T> withTenantDbContext(workspaceId: java.util.UUID?, block: suspend () -> T): T {
        val gate = workspaceId?.let {
            perTenant.computeIfAbsent(it) { kotlinx.coroutines.sync.Semaphore(maxPerTenant) }
        }

        if (gate != null && !gate.tryAcquire()) {
            WorkerMetrics.tenantDbRejectedTotal.inc()
            log.warn("[tenant-db] workspace {} at its sub-limit of {} concurrent queries — " +
                "refusing so other tenants keep capacity", workspaceId, maxPerTenant)
            throw DispatcherFullException(maxPerTenant, 0)
        }

        inFlight.incrementAndGet()
        publishGauges()
        return try {
            kotlinx.coroutines.withContext(dispatcher) { block() }
        } finally {
            inFlight.decrementAndGet()
            gate?.release()
            publishGauges()
        }
    }

    private fun publishGauges() {
        WorkerMetrics.tenantDbSlotsTotal.set(maxThreads.toDouble())
        WorkerMetrics.tenantDbSlotsActive.set(inFlight.get().coerceAtLeast(0).toDouble())
        WorkerMetrics.tenantDbQueueDepth.set(executor.queue.size.toDouble())
    }

    /** Log the configured shape once at startup so it is visible in the boot log. */
    fun logConfiguration() {
        log.info(
            "[tenant-db] isolated dispatcher ready [threads={}, perTenantMax={}, queueDepth={}, onFull=reject] " +
                "— a hanging tenant database can exhaust its own share and nothing else",
            maxThreads, maxPerTenant, queueDepth,
        )
        publishGauges()
    }

    /**
     * Shut down without waiting on threads parked in a socket read.
     *
     * `shutdownNow` interrupts, and a classic `java.net.Socket` read ignores
     * interrupts, so a hung query's thread will not stop here. That is precisely
     * why these threads are daemons: the JVM exits regardless. Waiting would
     * mean a stuck tenant database could block every deploy.
     */
    override fun close() {
        val pending = executor.shutdownNow().size
        if (pending > 0) {
            log.info("[tenant-db] shutdown discarded {} queued task(s)", pending)
        }
        if (!executor.awaitTermination(2, TimeUnit.SECONDS)) {
            log.warn(
                "[tenant-db] {} thread(s) still parked on tenant sockets at shutdown — " +
                    "they are daemons, so exit proceeds", inFlight.get(),
            )
        }
    }
}
