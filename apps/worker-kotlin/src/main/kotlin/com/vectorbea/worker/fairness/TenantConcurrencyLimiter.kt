package com.vectorbea.worker.fairness

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.queue.WorkerJobType
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Semaphore

/**
 * In-memory per-tenant concurrency limiter — fairness protection so one
 * workspace cannot occupy every heavy worker slot.
 *
 * A job must hold BOTH:
 *   1. a per-tenant total permit ([maxRunsPerTenant]), and
 *   2. a per-(tenant, jobType) permit ([limitFor]).
 * Acquisition is all-or-nothing: if the type permit can't be taken, the total
 * permit is released, so a failed acquire leaves no permits held.
 *
 * [WorkerJobType.SYSTEM] is never throttled — operational continuations
 * (timer/approval/cancel/recovery) must always be admissible.
 *
 * SCOPE: single-process only. The in-process limiter is acceptable for
 * single-worker beta and avoids extra Redis calls.
 *
 * TODO: For multi-worker production, replace in-memory TenantConcurrencyLimiter
 * with a Redis-backed or DB-backed distributed limiter. Do not enable this for
 * beta unless multiple worker instances are deployed.
 */
class TenantConcurrencyLimiter(
    private val maxRunsPerTenant: Int,
    private val maxAgentRunsPerTenant: Int,
    private val maxLongRunsPerTenant: Int,
    private val maxShortRunsPerTenant: Int,
) {
    private val log = logger()

    /** Fairness across processes is NOT provided by this in-memory limiter. */
    private val tenantTotal = ConcurrentHashMap<String, Semaphore>()
    private val tenantByType = ConcurrentHashMap<String, Semaphore>()

    /** Observability: number of times a tenant was throttled, by tenant. */
    private val throttledCounts = ConcurrentHashMap<String, Long>()

    /** Held permits — release is idempotent. */
    inner class Permit internal constructor(
        val acquired: Boolean,
        private val tenantKey: String,
        private val typeKey: String?,
    ) {
        @Volatile private var released = false
        fun release() {
            if (released || !acquired) return
            released = true
            tenantTotal[tenantKey]?.release()
            typeKey?.let { tenantByType[it]?.release() }
        }
    }

    private fun limitFor(type: WorkerJobType): Int = when (type) {
        WorkerJobType.AGENT  -> maxAgentRunsPerTenant
        WorkerJobType.LONG   -> maxLongRunsPerTenant
        WorkerJobType.SHORT  -> maxShortRunsPerTenant
        WorkerJobType.SYSTEM -> Int.MAX_VALUE // never throttled
    }

    /**
     * Try to admit one job for [tenantKey] of [type] without blocking.
     * Always call [Permit.release] in a finally for an acquired permit.
     */
    fun tryAcquire(tenantKey: String?, type: WorkerJobType): Permit {
        val key = tenantKey?.takeIf { it.isNotBlank() } ?: "unknown"

        // SYSTEM jobs bypass tenant throttling entirely.
        if (type == WorkerJobType.SYSTEM) return Permit(acquired = true, tenantKey = key, typeKey = null)

        val totalSem = tenantTotal.computeIfAbsent(key) { Semaphore(maxRunsPerTenant.coerceAtLeast(1)) }
        if (!totalSem.tryAcquire()) {
            recordThrottle(key, type, "tenant_total")
            return Permit(acquired = false, tenantKey = key, typeKey = null)
        }

        val typeKey = "$key:$type"
        val typeSem = tenantByType.computeIfAbsent(typeKey) { Semaphore(limitFor(type).coerceAtLeast(1)) }
        if (!typeSem.tryAcquire()) {
            totalSem.release() // all-or-nothing
            recordThrottle(key, type, "tenant_type")
            return Permit(acquired = false, tenantKey = key, typeKey = null)
        }

        return Permit(acquired = true, tenantKey = key, typeKey = typeKey)
    }

    private fun recordThrottle(key: String, type: WorkerJobType, reason: String) {
        throttledCounts.merge(key, 1L, Long::plus)
        log.info("[fairness] tenant throttled [tenant={}, jobType={}, reason={}]", key, type, reason)
    }

    fun throttledCount(tenantKey: String): Long = throttledCounts[tenantKey] ?: 0L
    fun totalThrottled(): Long = throttledCounts.values.sum()
}
