package com.vectorbea.worker.fairness

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.queue.WorkerJobType
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.sql.DataSource

/**
 * Per-workspace concurrency limits, read from `workspace_usage_policies`.
 *
 * These used to be four global env constants, which meant every workspace on the
 * platform shared one policy and raising a limit for one customer required a
 * redeploy for all of them. They are now per-workspace rows, so a limit is
 * policy — something support can change for one account — rather than
 * configuration.
 *
 * [defaults] still exist and still come from the same env vars, because a
 * workspace with no policy row must get *something*, and the something should be
 * what the platform used to do.
 */
data class WorkspaceLimits(
    val maxTotal: Int,
    val maxAgent: Int,
    val maxLong: Int,
    val maxShort: Int,
) {
    fun limitFor(type: WorkerJobType): Int = when (type) {
        WorkerJobType.AGENT -> maxAgent
        /* The same per-tenant agent cap covers all three agent lanes, and
           deliberately as ONE budget rather than three: giving children their own
           allowance would mean a tenant at its agent cap could still start
           unlimited work by fanning out, which is the cap not existing. The
           per-run and per-workspace ACTIVATION caps are what bound the fan-out's
           width; this bounds the tenant's total agent concurrency. */
        WorkerJobType.AGENT_CHILD, WorkerJobType.AGENT_INTERACTIVE -> maxAgent
        WorkerJobType.LONG -> maxLong
        WorkerJobType.SHORT -> maxShort
        // Operational continuations must always be admissible: a timer resume or
        // a crash recovery is what un-sticks the platform, so throttling it would
        // deadlock exactly the situation it exists to resolve.
        WorkerJobType.SYSTEM -> Int.MAX_VALUE
    }
}

/**
 * Loads and caches [WorkspaceLimits].
 *
 * The cache has no TTL and needs none: a policy row changes when a human changes
 * a plan, not on the scale of a poll loop. [invalidate] exists for when that
 * happens; until then, re-reading a row that changes monthly on every admission
 * decision would be pure cost.
 *
 * Distinct from the *load* cache in [SharedTenantAdmission], which is short-lived
 * precisely because load changes constantly. Limits and load are cached
 * differently because they change on completely different timescales.
 */
class WorkspaceLimitsProvider(
    private val dataSource: DataSource,
    private val defaults: WorkspaceLimits,
) {
    private val log = logger()
    private val cache = ConcurrentHashMap<UUID, WorkspaceLimits>()

    companion object {
        private const val SAFETY_LIMIT = 20_000

        private val SQL = """
            SELECT max_concurrent_runs, max_concurrent_agent_runs,
                   max_concurrent_long_runs, max_concurrent_short_runs
              FROM workspace_usage_policies
             WHERE workspace_id = ?
             LIMIT 1
        """.trimIndent()
    }

    fun limitsFor(workspaceId: UUID?): WorkspaceLimits {
        if (workspaceId == null) return defaults
        cache[workspaceId]?.let { return it }

        val loaded = try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(SQL).use { stmt ->
                    stmt.setObject(1, workspaceId)
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) {
                            WorkspaceLimits(
                                maxTotal = rs.getInt("max_concurrent_runs"),
                                maxAgent = rs.getInt("max_concurrent_agent_runs"),
                                maxLong = rs.getInt("max_concurrent_long_runs"),
                                maxShort = rs.getInt("max_concurrent_short_runs"),
                            )
                        } else {
                            // No policy row: a workspace that was never given one
                            // gets the platform default, not zero. Failing closed
                            // here would refuse every run for every new signup.
                            defaults
                        }
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[fairness] could not load limits for workspace {} — using defaults: {}",
                workspaceId, e.message)
            defaults
        }

        if (cache.size >= SAFETY_LIMIT) cache.clear()
        cache[workspaceId] = loaded
        return loaded
    }

    /** Drop a cached policy — call when a plan changes. */
    fun invalidate(workspaceId: UUID) {
        cache.remove(workspaceId)
    }

    fun cachedWorkspaces(): Int = cache.size
}
