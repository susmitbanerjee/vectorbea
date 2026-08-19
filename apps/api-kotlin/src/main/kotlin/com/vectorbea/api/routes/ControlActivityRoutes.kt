package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import javax.sql.DataSource

/**
 * A workspace-wide tail of durable run events for Control.
 *
 * This is intentionally one bounded query rather than fetching recent runs and
 * then polling `/api/runs/:id/events` for each one. Besides being cheaper, the
 * single query gives the stream a real global ordering across concurrent runs.
 */
class ControlActivityRoutes(private val ds: DataSource) {
    fun register(router: Router) {
        router.get("/api/control/activity", ::activity)
    }

    private fun activity(req: Request): Response {
        val ctx = req.context()
        val limit = req.query("limit")?.toIntOrNull()?.coerceIn(1, 100) ?: 20

        val events = ds.connection.use { conn ->
            conn.prepareStatement(
                """
                SELECT e.id, e.run_id, e.type, e.status, e.source, e.timestamp,
                       e.duration_ms, e.step_id, e.title, e.summary, w.name AS workflow_name
                  FROM run_events e
                  JOIN agent_runs r ON r.id = e.run_id AND r.workspace_id = e.workspace_id
                  JOIN workflows w ON w.id = r.workflow_id AND w.workspace_id = e.workspace_id
                 WHERE e.workspace_id = ?
                   AND (?::uuid IS NULL OR e.environment_id = ?::uuid)
                 ORDER BY e.timestamp DESC, e.created_at DESC
                 LIMIT ?
                """.trimIndent()
            ).use { stmt ->
                stmt.setObject(1, ctx.workspaceId)
                stmt.setObject(2, ctx.environmentId)
                stmt.setObject(3, ctx.environmentId)
                stmt.setInt(4, limit)
                stmt.queryTimeout = 3
                stmt.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) {
                            add(mapOf(
                                "id" to rs.getObject("id").toString(),
                                "runId" to rs.getObject("run_id").toString(),
                                "type" to rs.getString("type"),
                                "status" to rs.getString("status"),
                                "source" to rs.getString("source"),
                                "timestamp" to rs.getTimestamp("timestamp").toInstant().toString(),
                                "durationMs" to rs.getObject("duration_ms")?.let { rs.getLong("duration_ms") },
                                "stepId" to rs.getString("step_id"),
                                "title" to rs.getString("title"),
                                "summary" to rs.getString("summary"),
                                "workflowName" to rs.getString("workflow_name"),
                            ))
                        }
                    }
                }
            }
        }

        return Response.ok(events)
    }
}
