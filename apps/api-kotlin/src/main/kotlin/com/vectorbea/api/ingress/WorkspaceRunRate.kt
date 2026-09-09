package com.vectorbea.api.ingress

import java.util.UUID
import javax.sql.DataSource

/**
 * How fast a workspace may create runs.
 *
 * Lived inside `RunRoutes` as a private helper, which is why the scheduler never
 * applied a rate limit at all — the lookup was not reachable from anywhere else.
 * It is one indexed read, and it belongs beside the thing that enforces it.
 */
object WorkspaceRunRate {

    /**
     * Platform default when a workspace has no policy row.
     *
     * 60/minute sustained with a burst of 120 — generous enough that no
     * legitimate client notices, tight enough that a runaway loop is stopped in
     * a second rather than after it has filled the queue.
     */
    val DEFAULT: Pair<Int, Int> = 60 to 120

    /**
     * Read per call rather than cached: a plan upgrade has to take effect
     * immediately, and a cache here would make an operator raising a limit
     * during an incident wait for a TTL they cannot see.
     */
    fun of(dataSource: DataSource?, workspaceId: UUID): Pair<Int, Int> =
        dataSource?.let { ds ->
            runCatching {
                ds.connection.use { conn ->
                    conn.prepareStatement(
                        """SELECT max_runs_per_minute, runs_per_minute_burst
                             FROM workspace_usage_policies WHERE workspace_id = ?"""
                    ).use { stmt ->
                        stmt.setObject(1, workspaceId)
                        stmt.executeQuery().use { rs ->
                            if (rs.next()) rs.getInt(1) to rs.getInt(2) else DEFAULT
                        }
                    }
                }
            }.getOrDefault(DEFAULT)
        } ?: DEFAULT
}
