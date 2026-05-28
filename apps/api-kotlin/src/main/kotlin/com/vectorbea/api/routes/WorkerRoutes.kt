package com.vectorbea.api.routes

import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import org.slf4j.LoggerFactory
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.sql.DataSource

/**
 * GET /api/workers
 *
 * Returns all workers that have sent a heartbeat in the last 2 minutes.
 * Workers are registered via the worker service's DB heartbeat
 * (INSERT INTO workers ... ON CONFLICT (id) DO UPDATE SET ...).
 *
 * Response: JSON array of WorkerItem objects.
 *   { id, status, queue, activeTasks, maxCapacity, heartbeat, version, region }
 *
 * Note: workspace_id is not required — workers are global to the deployment.
 * The endpoint still requires X-Workspace-Id for auth consistency.
 */
class WorkerRoutes(private val dataSource: DataSource) {

    private val log = LoggerFactory.getLogger(WorkerRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/workers") { req -> list(req) }
    }

    private fun list(req: Request): Response {
        // Require workspace header for auth consistency (but don't filter by it —
        // workers are deployment-global, not per-workspace).
        req.header("x-workspace-id") ?: req.query("workspaceId")
            ?: return Response(
                status = 400,
                body = """{"error":"X-Workspace-Id header or workspaceId query param is required"}""",
                headers = mapOf("Content-Type" to "application/json"),
            )

        val cutoff = Instant.now().minus(2, ChronoUnit.MINUTES)

        return try {
            val workers = queryWorkers(cutoff)
            Response.ok(workers)
        } catch (e: Exception) {
            log.error("Failed to list workers", e)
            Response(
                status = 500,
                body = """{"error":"Failed to list workers"}""",
                headers = mapOf("Content-Type" to "application/json"),
            )
        }
    }

    private fun queryWorkers(cutoff: Instant): List<Map<String, Any?>> {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """
                SELECT id, name, status, queue, capacity, active_tasks,
                       last_heartbeat_at, version, region
                FROM workers
                WHERE last_heartbeat_at >= ?
                ORDER BY last_heartbeat_at DESC
                """.trimIndent()
            ).use { stmt ->
                stmt.setTimestamp(1, java.sql.Timestamp.from(cutoff))
                stmt.executeQuery().use { rs ->
                    val result = mutableListOf<Map<String, Any?>>()
                    while (rs.next()) {
                        val rawStatus = rs.getString("status") ?: "idle"
                        val uiStatus = when (rawStatus.lowercase()) {
                            "running"  -> "CONNECTED"
                            "idle"     -> "IDLE"
                            "starting" -> "IDLE"
                            else       -> "DISCONNECTED"   // draining, stopped
                        }
                        val lastHb = rs.getTimestamp("last_heartbeat_at")
                        val heartbeatLabel = if (lastHb != null) {
                            val secsAgo = ChronoUnit.SECONDS.between(lastHb.toInstant(), Instant.now())
                            when {
                                secsAgo < 60   -> "${secsAgo}s ago"
                                secsAgo < 3600 -> "${secsAgo / 60}m ago"
                                else           -> "${secsAgo / 3600}h ago"
                            }
                        } else null

                        result.add(mapOf(
                            "id"          to rs.getString("id"),
                            "status"      to uiStatus,
                            "queue"       to rs.getString("queue"),
                            "activeTasks" to rs.getInt("active_tasks"),
                            "maxCapacity" to rs.getInt("capacity"),
                            "heartbeat"   to heartbeatLabel,
                            "version"     to rs.getString("version"),
                            "region"      to rs.getString("region"),
                        ))
                    }
                    return result
                }
            }
        }
    }
}
