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
              ),
              failed_24h AS (
                SELECT COUNT(*) AS cnt
                FROM agent_runs
                WHERE workspace_id = ? $envFilter
                  AND status = 'failed'
                  AND updated_at >= NOW() - INTERVAL '24 hours'
              ),
              succeeded_24h AS (
                SELECT COUNT(*) AS cnt
                FROM agent_runs
                WHERE workspace_id = ? $envFilter
                  AND status = 'succeeded'
                  AND updated_at >= NOW() - INTERVAL '24 hours'
              ),
              usage_24h AS (
                SELECT
                  COALESCE(SUM(token_count), 0)     AS tokens,
                  COALESCE(SUM(estimated_cost), 0.0) AS cost
                FROM agent_runs
                WHERE workspace_id = ? $envFilter
                  AND created_at >= NOW() - INTERVAL '24 hours'
              ),
              pending_approvals AS (
                SELECT COUNT(*) AS cnt
                FROM approvals a
                JOIN agent_runs r ON r.id = a.run_id
                WHERE r.workspace_id = ?
                  ${if (environmentId != null) "AND r.environment_id = ?" else ""}
                  AND a.status = 'pending'
              ),
              total_runs AS (
                SELECT COUNT(*) AS cnt
                FROM agent_runs
                WHERE workspace_id = ? $envFilter
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
