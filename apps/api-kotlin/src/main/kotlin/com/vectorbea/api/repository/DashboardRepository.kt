package com.vectorbea.api.repository

import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * Efficient dashboard summary — computes all overview metrics in a single SQL round-trip.
 *
 * Workspace and environment scoped on every query.
 * Safe to cache for 15-30 seconds (caller decides TTL).
 */
data class DashboardSummaryData(
    val activeWorkflows:   Int,
    val runningNow:        Int,      // running + queued + recovering
    val failedLast24h:     Int,
    val succeededLast24h:  Int,
    val pendingApprovals:  Int,
    val tokensLast24h:     Long,
    val estimatedCostLast24h: Double,
    val recentRunsTotal:   Int,
)

/**
 * A run the workspace's numbers are ABOUT.
 *
 * ── WHY EVERY AGGREGATE HERE HAS TO SAY THIS ────────────────────────────────
 * A replay re-executes a past run to work out what went wrong. It is a debugging
 * tool, and counting it as production traffic corrupts exactly the number
 * somebody is using the debugger to defend: replay a failed run five times
 * hunting the bug and the workspace's failure count goes up by five, so the
 * success rate falls because an engineer investigated. The same replays also
 * inflate the token and cost tiles, which are what a customer is billed against.
 *
 * `agent_runs` marks a replay three ways — `trigger_type='replay'`,
 * `execution_mode_kind='replay'` and a non-null `source_run_id` — and this checks
 * all three rather than picking one, because they are written by different code
 * paths and a replay that set only two would otherwise slip through. Any one of
 * them is enough to mean "not production".
 *
 * Deliberately NOT applied to `pending_approvals`: a replay that opens a real
 * approval gate is a real person being asked a real question, and hiding it would
 * leave a gate nobody knows to decide.
 */
private const val NOT_A_REPLAY =
    "(COALESCE(trigger_type,'') <> 'replay' " +
    " AND COALESCE(execution_mode_kind,'') <> 'replay' " +
    " AND source_run_id IS NULL)"

class DashboardRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(DashboardRepository::class.java)

    /**
     * Returns all dashboard summary metrics in one efficient CTE query.
     * environmentId may be null to query across all environments in the workspace.
     */
    fun getSummary(workspaceId: UUID, environmentId: UUID?): DashboardSummaryData {
        val envFilter = if (environmentId != null) "AND environment_id = ?" else ""

        val sql = """
            WITH
              active_wf AS (
                SELECT COUNT(*) AS cnt
                FROM workflows
                WHERE workspace_id = ? $envFilter AND status = 'active'
              ),
              running_runs AS (
                SELECT COUNT(*) AS cnt
                FROM agent_runs
                WHERE workspace_id = ? $envFilter
                  AND status IN ('running', 'queued', 'recovering', 'waiting_for_timer')
                  AND $NOT_A_REPLAY
              ),
              failed_24h AS (
                SELECT COUNT(*) AS cnt
                FROM agent_runs
                WHERE workspace_id = ? $envFilter
                  AND status = 'failed'
                  AND updated_at >= NOW() - INTERVAL '24 hours'
                  AND $NOT_A_REPLAY
              ),
              succeeded_24h AS (
                SELECT COUNT(*) AS cnt
                FROM agent_runs
                WHERE workspace_id = ? $envFilter
                  AND status = 'succeeded'
                  AND updated_at >= NOW() - INTERVAL '24 hours'
                  AND $NOT_A_REPLAY
              ),
              -- Sum tokens/cost directly from agent_runs (not run_events).
              -- agent_runs.token_count and estimated_cost are now correctly
              -- populated by updateRunCompleted() + V012 backfill migration.
              -- run_events.token_count/estimated_cost is still NULL for many
              -- historical brain events, making the JOIN approach unreliable.
              usage_24h AS (
                SELECT
                  COALESCE(SUM(token_count), 0)      AS tokens,
                  COALESCE(SUM(estimated_cost), 0.0)  AS cost
                FROM agent_runs
                WHERE workspace_id = ? $envFilter
                  AND (started_at  >= NOW() - INTERVAL '24 hours'
                    OR created_at  >= NOW() - INTERVAL '24 hours')
                  AND token_count > 0
                  AND $NOT_A_REPLAY
              ),
              -- `run_approvals`, not `approvals`: V027 made the former
              -- authoritative and every writer now targets it. Counting the
              -- legacy table left the dashboard tile at zero while the
              -- Approvals page listed pending gates. Status is compared
              -- case-insensitively because rows migrated from `approvals`
              -- carry the old lower-case vocabulary.
              pending_approvals AS (
                SELECT COUNT(*) AS cnt
                FROM run_approvals a
                JOIN agent_runs r ON r.id = a.run_id
                WHERE r.workspace_id = ?
                  ${if (environmentId != null) "AND r.environment_id = ?" else ""}
                  AND UPPER(a.status) = 'PENDING'
              ),
              total_runs AS (
                SELECT COUNT(*) AS cnt
                FROM agent_runs
                WHERE workspace_id = ? $envFilter
                  AND $NOT_A_REPLAY
              )
            SELECT
              (SELECT cnt FROM active_wf)::int         AS active_workflows,
              (SELECT cnt FROM running_runs)::int       AS running_now,
              (SELECT cnt FROM failed_24h)::int         AS failed_last_24h,
              (SELECT cnt FROM succeeded_24h)::int      AS succeeded_last_24h,
              (SELECT tokens FROM usage_24h)::bigint    AS tokens_last_24h,
              (SELECT cost   FROM usage_24h)::float8    AS cost_last_24h,
              (SELECT cnt FROM pending_approvals)::int  AS pending_approvals,
              (SELECT cnt FROM total_runs)::int         AS recent_runs_total
        """.trimIndent()

        return queryOne(sql,
            {
                var p = 1
                // Each CTE needs workspace_id (and optionally environment_id)
                repeat(7) { // 7 CTEs
                    setObject(p++, workspaceId)
                    if (environmentId != null) setObject(p++, environmentId)
                }
            },
        ) { rs ->
            DashboardSummaryData(
                activeWorkflows    = rs.getInt("active_workflows"),
                runningNow         = rs.getInt("running_now"),
                failedLast24h      = rs.getInt("failed_last_24h"),
                succeededLast24h   = rs.getInt("succeeded_last_24h"),
                pendingApprovals   = rs.getInt("pending_approvals"),
                tokensLast24h      = rs.getLong("tokens_last_24h"),
                estimatedCostLast24h = rs.getDouble("cost_last_24h"),
                recentRunsTotal    = rs.getInt("recent_runs_total"),
            )
        } ?: DashboardSummaryData(0, 0, 0, 0, 0, 0L, 0.0, 0)
    }
}
