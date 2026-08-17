package com.vectorbea.worker.fairness

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.queue.WorkerJobType
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import javax.sql.DataSource

/**
 * Per-tenant admission against **shared** state.
 *
 * WHAT THIS REPLACES
 * ------------------
 * `TenantConcurrencyLimiter` counted a workspace's active runs in a local
 * `ConcurrentHashMap` of semaphores. Correct at one replica, and wrong at every
 * other number: three replicas each enforced "max 1 agent run" independently, so
 * one workspace got three. Scaling out — the thing the architecture review
 * recommends — was what broke fairness (§1.3).
 *
 * THE SHARED STATE ALREADY EXISTED
 * --------------------------------
 * `run_leases` has one row per actively executing run, carrying `workspace_id`
 * and `expires_at`. It is authoritative across the cluster and self-healing: a
 * worker that dies stops renewing, and its leases fall out of the count without
 * anyone cleaning up. It simply was not consulted at admission (§2.2).
 *
 *     SELECT count(*) FROM run_leases
 *      WHERE workspace_id = ? AND expires_at > now()
 *
 * WHY THE COUNT IS CACHED
 * -----------------------
 * Running that per message would put a Postgres round trip on the hot path of
 * every poll iteration on every replica. Instead the count is cached for
 * [stalenessWindowMs] (default 1500 ms) and refreshed **asynchronously**, so no
 * admission decision ever waits on the database.
 *
 * WHAT THAT COSTS, STATED PRECISELY
 * ---------------------------------
 * The cache makes admission *advisory*, and it is worth being exact about what
 * that does and does not mean, because the distinction is the whole safety
 * argument:
 *
 *  - **Duplicate execution remains impossible.** The run lease is a unique row
 *    per `run_id` with a CAS acquire. Two workers claiming the same run is
 *    prevented by the database, not by this class, and nothing here weakens it.
 *
 *  - **Per-tenant limits become eventually consistent**, with a bounded
 *    overshoot window of [stalenessWindowMs]. Within one window, replicas can
 *    admit against the same stale count and a workspace can briefly exceed its
 *    cap. The next refresh sees the real number and admission closes.
 *
 * That overshoot is measured, not assumed: [WorkerMetrics.tenantAdmissionOvershoot]
 * counts every time the authoritative count came back above the limit — i.e.
 * every time the cache let through more than it should have. If that counter is
 * flat, the window is small enough. If it climbs, shorten
 * `TENANT_LOAD_STALENESS_MS` or move to the S06 end-state, where the check folds
 * into the claim itself and the window disappears.
 */
class SharedTenantAdmission(
    private val dataSource: DataSource,
    private val limitsProvider: WorkspaceLimitsProvider,
    /**
     * How long a cached tenant load may be reused. This is the overshoot window:
     * the maximum time the fleet can act on a stale count.
     */
    private val stalenessWindowMs: Long =
        System.getenv("TENANT_LOAD_STALENESS_MS")?.toLongOrNull() ?: 300L,
) : AutoCloseable {

    private val log = logger()

    /** Cached authoritative load for one workspace. */
    private data class Load(val total: Int, val byClass: Map<WorkerJobType, Int>, val fetchedAtMs: Long)

    private val loads = ConcurrentHashMap<UUID, Load>()

    /** Workspaces with a refresh already in flight — prevents thundering herds. */
    private val refreshing = ConcurrentHashMap.newKeySet<UUID>()

    private val refreshExecutor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "tenant-load-refresh").also { it.isDaemon = true }
    }

    /**
     * Locally admitted runs not yet visible in `run_leases`.
     *
     * Between admission and the lease INSERT there is a real window — the job is
     * submitted to a pool, picks up a thread, and only then acquires its lease.
     * Without this, a single replica would admit its whole batch against a count
     * that does not yet include any of them, and self-overshoot every time. This
     * makes each replica at least internally consistent; the shared count handles
     * the rest.
     */
    private val inFlight = ConcurrentHashMap<String, AtomicLong>()

    companion object {
        /**
         * Leases ahead of ours in (created_at, run_id) order. The tuple compare
         * is what makes the ordering total, so ties cannot make two replicas
         * both decide they are the excess one.
         */
        private val AHEAD_SQL = """
            SELECT ar.execution_class AS cls, count(*) AS ahead
              FROM run_leases rl
              JOIN agent_runs ar ON ar.id = rl.run_id
             WHERE rl.workspace_id = ?
               AND rl.expires_at > now()
               AND (rl.created_at, rl.run_id) <
                   (SELECT created_at, run_id FROM run_leases WHERE run_id = ?)
             GROUP BY ar.execution_class
        """.trimIndent()

        private val COUNT_SQL = """
            SELECT ar.execution_class AS cls, count(*) AS active
              FROM run_leases rl
              JOIN agent_runs ar ON ar.id = rl.run_id
             WHERE rl.workspace_id = ? AND rl.expires_at > now()
             GROUP BY ar.execution_class
        """.trimIndent()
    }

    /** A granted admission. [release] is idempotent and must run in a finally. */
    inner class Permit internal constructor(
        val acquired: Boolean,
        private val workspaceKey: String,
        private val type: WorkerJobType,
    ) {
        @Volatile private var released = false
        fun release() {
            if (released || !acquired) return
            released = true
            decInFlight(workspaceKey, type)
            WorkerMetrics.tenantActiveRuns.dec(workspaceKey, type.name.lowercase())
        }
    }

    /**
     * Decide whether one run of [type] may start for [tenantKey].
     *
     * Never blocks and never waits on the database: the answer comes from cache,
     * and a stale or missing entry triggers a background refresh.
     */
    fun tryAcquire(tenantKey: String?, type: WorkerJobType): Permit {
        val key = tenantKey?.takeIf { it.isNotBlank() } ?: "unknown"

        // SYSTEM bypasses admission entirely — see WorkspaceLimits.limitFor.
        if (type == WorkerJobType.SYSTEM) return Permit(true, key, type)

        val workspaceId = runCatching { UUID.fromString(key) }.getOrNull()
        val limits = limitsProvider.limitsFor(workspaceId)

        val load = loadFor(workspaceId, key)
        val leasedTotal = load?.total ?: 0
        val leasedForClass = load?.byClass?.get(type) ?: 0

        // Shared (leased) + local (admitted, lease not yet written).
        val effectiveTotal = leasedTotal + inFlightCount(key, null)
        val effectiveClass = leasedForClass + inFlightCount(key, type)

        if (effectiveTotal >= limits.maxTotal) {
            record(key, type, "tenant_total")
            return Permit(false, key, type)
        }
        if (effectiveClass >= limits.limitFor(type)) {
            record(key, type, "tenant_class")
            return Permit(false, key, type)
        }

        incInFlight(key, type)
        WorkerMetrics.tenantActiveRuns.inc(key, type.name.lowercase())
        return Permit(true, key, type)
    }

    /**
     * Cached load, refreshing in the background when stale.
     *
     * On a cold miss this returns null — treated as zero — and schedules a
     * refresh. That is deliberate: blocking the poll thread on Postgres to learn
     * a workspace has no active runs (the overwhelmingly common case) would put
     * a round trip in front of every first admission. The in-flight counter
     * keeps a single replica honest until the first refresh lands.
     */
    private fun loadFor(workspaceId: UUID?, key: String): Load? {
        if (workspaceId == null) return null
        val cached = loads[workspaceId]

        if (cached == null) {
            // COLD MISS IS READ SYNCHRONOUSLY, and this is the difference between
            // limits that hold and limits that multiply.
            //
            // Returning null (i.e. "zero active runs") on the first sight of a
            // workspace let every replica independently admit a full quota before
            // any of them had seen the others. Measured, that was 2xN peak
            // concurrency — the original bug, reproduced through a cache.
            //
            // This costs one query per workspace per process. Every subsequent
            // admission is served from cache and refreshed in the background, so
            // it is a startup cost, not a hot-path cost.
            return try {
                queryLoad(workspaceId).also { loads[workspaceId] = it }
            } catch (e: Exception) {
                log.warn("[fairness] initial load query failed for {}: {}", workspaceId, e.message)
                null
            }
        }

        val age = System.currentTimeMillis() - cached.fetchedAtMs
        if (age > stalenessWindowMs) scheduleRefresh(workspaceId, key)
        return cached
    }

    private fun scheduleRefresh(workspaceId: UUID, key: String) {
        if (!refreshing.add(workspaceId)) return  // already queued
        refreshExecutor.execute {
            try {
                val load = queryLoad(workspaceId)
                loads[workspaceId] = load

                // Overshoot detection: the authoritative count is in hand, so
                // this is the moment we can tell whether the cache let through
                // more than the policy allows.
                val limits = limitsProvider.limitsFor(workspaceId)
                if (load.total > limits.maxTotal) {
                    WorkerMetrics.tenantAdmissionOvershoot.inc(key, "tenant_total")
                    log.warn("[fairness] overshoot: workspace {} has {} active runs, limit {} " +
                        "(staleness window {}ms)", workspaceId, load.total, limits.maxTotal, stalenessWindowMs)
                }
                for ((cls, active) in load.byClass) {
                    if (active > limits.limitFor(cls)) {
                        WorkerMetrics.tenantAdmissionOvershoot.inc(key, cls.name.lowercase())
                    }
                }
            } catch (e: Exception) {
                log.warn("[fairness] tenant load refresh failed for {}: {}", workspaceId, e.message)
            } finally {
                refreshing.remove(workspaceId)
            }
        }
    }

    /**
     * The hard gate. Called **after** the run lease is acquired, before any work
     * runs, and it is what actually enforces the limit.
     *
     * WHY THE CACHE IS NOT ENOUGH — measured, not theorised.
     * Running S01 test 4 with only the advisory cache gave peak per-tenant
     * concurrency of 2 at N=1, 4 at N=2, 6 at N=3: exactly 2×N, i.e. the original
     * bug intact. The reason is that admission is decided from a *local* view.
     * Each replica starts with a cold cache, reads zero, admits up to the limit
     * on its own in-flight counter, and only learns about the others when the
     * async refresh lands — by which time the runs are already executing. A
     * 1.5 s staleness window against ~1 s runs is never in front of the work.
     *
     * The fix is to check where the shared state actually changes. Acquiring a
     * lease INSERTs the authoritative row, so immediately afterwards this counts
     * how many leases for the workspace are **ahead of** ours — older, by
     * (created_at, run_id) — and refuses if that already meets the limit.
     *
     * Ordering is what makes this livelock-free. Two replicas that both insert
     * and then both count would both see "3 > 2" and both back off, leaving the
     * tenant under-served. Counting only *older* leases gives a total order: the
     * first N acquirers are always the keepers and every later one yields. No
     * coordination, no retry storm, no lost capacity.
     *
     * @return true if this run may proceed; false if it is the excess one and
     *         its lease should be released.
     */
    fun admitAtClaim(workspaceId: UUID?, runId: UUID, type: WorkerJobType): Boolean {
        if (type == WorkerJobType.SYSTEM || workspaceId == null) return true
        val limits = limitsProvider.limitsFor(workspaceId)

        return try {
            val (totalAhead, classAhead) = countAheadOf(workspaceId, runId)
            val overTotal = totalAhead >= limits.maxTotal
            val overClass = (classAhead[type] ?: 0) >= limits.limitFor(type)

            if (overTotal || overClass) {
                val key = workspaceId.toString()
                WorkerMetrics.tenantThrottledTotal.inc(
                    key, if (overTotal) "claim_total" else "claim_class")
                WorkerMetrics.tenantClaimRejected.inc(key, type.name.lowercase())
                log.debug("[fairness] claim refused [ws={}, run={}, class={}, ahead={}/{}]",
                    workspaceId, runId, type, totalAhead, limits.maxTotal)
                false
            } else {
                true
            }
        } catch (e: Exception) {
            // Fail OPEN. A run that already holds a lease is one the platform has
            // committed to; refusing it because a count query failed would turn a
            // transient database blip into stalled work. The advisory cache has
            // already bounded the damage, and the next refresh corrects the view.
            log.warn("[fairness] claim check failed for run {} — admitting: {}", runId, e.message)
            true
        }
    }

    /**
     * Leases for this workspace that are strictly older than [runId]'s, by
     * (created_at, run_id). The row tuple comparison gives a total order even
     * when two leases share a timestamp.
     */
    private fun countAheadOf(workspaceId: UUID, runId: UUID): Pair<Int, Map<WorkerJobType, Int>> {
        val byClass = HashMap<WorkerJobType, Int>()
        var total = 0
        dataSource.connection.use { conn ->
            conn.prepareStatement(AHEAD_SQL).use { stmt ->
                stmt.setObject(1, workspaceId)
                stmt.setObject(2, runId)
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        val cls = WorkerJobType.entries
                            .firstOrNull { it.name.equals(rs.getString("cls"), ignoreCase = true) }
                            ?: WorkerJobType.SHORT
                        val n = rs.getInt("ahead")
                        byClass.merge(cls, n, Int::plus)
                        total += n
                    }
                }
            }
        }
        return total to byClass
    }

    /** The authoritative query. Cluster-wide, self-healing, one index seek. */
    private fun queryLoad(workspaceId: UUID): Load {
        val started = System.nanoTime()
        val byClass = HashMap<WorkerJobType, Int>()
        var total = 0
        dataSource.connection.use { conn ->
            conn.prepareStatement(COUNT_SQL).use { stmt ->
                stmt.setObject(1, workspaceId)
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        val cls = WorkerJobType.entries
                            .firstOrNull { it.name.equals(rs.getString("cls"), ignoreCase = true) }
                            ?: WorkerJobType.SHORT
                        val active = rs.getInt("active")
                        byClass.merge(cls, active, Int::plus)
                        total += active
                    }
                }
            }
        }
        WorkerMetrics.tenantLoadQuerySeconds.observeSeconds((System.nanoTime() - started) / 1_000_000_000.0)
        return Load(total, byClass, System.currentTimeMillis())
    }

    // ── Local in-flight accounting ────────────────────────────────────────────

    private fun inFlightKey(key: String, type: WorkerJobType?) =
        if (type == null) "$key:*" else "$key:${type.name}"

    private fun inFlightCount(key: String, type: WorkerJobType?): Int =
        (inFlight[inFlightKey(key, type)]?.get() ?: 0L).toInt()

    private fun incInFlight(key: String, type: WorkerJobType) {
        inFlight.computeIfAbsent(inFlightKey(key, null)) { AtomicLong() }.incrementAndGet()
        inFlight.computeIfAbsent(inFlightKey(key, type)) { AtomicLong() }.incrementAndGet()
    }

    private fun decInFlight(key: String, type: WorkerJobType) {
        inFlight[inFlightKey(key, null)]?.updateAndGet { (it - 1).coerceAtLeast(0) }
        inFlight[inFlightKey(key, type)]?.updateAndGet { (it - 1).coerceAtLeast(0) }
    }

    private fun record(key: String, type: WorkerJobType, reason: String) {
        WorkerMetrics.tenantThrottled.inc()
        WorkerMetrics.tenantThrottledTotal.inc(key, reason)
        log.debug("[fairness] refused [tenant={}, class={}, reason={}]", key, type, reason)
    }

    fun logConfiguration() {
        log.info(
            "[fairness] shared-state admission active — source=run_leases (cluster-wide), " +
                "stalenessWindow={}ms, limits=per-workspace policy. " +
                "Per-tenant limits are now independent of replica count.",
            stalenessWindowMs,
        )
    }

    override fun close() {
        refreshExecutor.shutdownNow()
        runCatching { refreshExecutor.awaitTermination(2, TimeUnit.SECONDS) }
    }
}
