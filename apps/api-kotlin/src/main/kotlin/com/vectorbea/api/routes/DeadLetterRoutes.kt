package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import org.slf4j.LoggerFactory
import javax.sql.DataSource

/**
 * Dead-lettered jobs, for the Incidents UI.
 *
 * A dead letter is the most actionable failure the platform produces: it is a
 * job the system has given up on, which means nothing else is going to retry it
 * and a customer's work is simply not happening. It needs a human, and the point
 * of this endpoint is that the human can diagnose it **without reproducing the
 * crash** — the payload, the full error chain across every attempt, and which
 * workers it killed are all here.
 *
 *   GET   /api/incidents/dead-letters       list, newest first
 *   GET   /api/incidents/dead-letters/:id   full detail incl. payload
 *   POST  /api/incidents/dead-letters/:id/acknowledge
 */
class DeadLetterRoutes(private val dataSource: DataSource) {

    private val log = LoggerFactory.getLogger(DeadLetterRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/incidents/dead-letters") { req -> list(req) }
        router.get("/api/incidents/dead-letters/:id") { req -> detail(req) }
        router.post("/api/incidents/dead-letters/:id/acknowledge") { req -> acknowledge(req) }
    }

    private fun list(req: Request): Response {
        val ctx = req.context()
        val onlyOpen = req.query("status")?.equals("open", ignoreCase = true) ?: true

        return try {
            val rows = mutableListOf<Map<String, Any?>>()
            dataSource.connection.use { conn ->
                val sql = buildString {
                    append("""
                        SELECT id, run_id, workflow_id, job_type, attempts, max_attempts,
                               reason, status, created_at,
                               jsonb_array_length(error_chain_json) AS error_count
                          FROM dead_letters
                         WHERE workspace_id = ?
                    """.trimIndent())
                    // Default to the open ones: a resolved dead letter is history,
                    // and an Incidents page that leads with history buries the
                    // thing that needs attention now.
                    if (onlyOpen) append(" AND status IN ('new','acknowledged')")
                    append(" ORDER BY created_at DESC LIMIT 200")
                }
                conn.prepareStatement(sql).use { stmt ->
                    stmt.setObject(1, ctx.workspaceId)
                    stmt.executeQuery().use { rs ->
                        while (rs.next()) {
                            rows += mapOf(
                                "id" to rs.getString("id"),
                                "runId" to rs.getString("run_id"),
                                "workflowId" to rs.getString("workflow_id"),
                                "jobType" to rs.getString("job_type"),
                                "attempts" to rs.getInt("attempts"),
                                "maxAttempts" to rs.getInt("max_attempts"),
                                "reason" to rs.getString("reason"),
                                "status" to rs.getString("status"),
                                "errorCount" to rs.getInt("error_count"),
                                "createdAt" to rs.getTimestamp("created_at")?.toInstant()?.toString(),
                            )
                        }
                    }
                }
            }
            Response.ok(mapOf("deadLetters" to rows, "count" to rows.size))
        } catch (e: Exception) {
            log.error("[incidents] dead-letter list failed", e)
            Response(status = 500,
                body = """{"error":"Could not load dead letters"}""",
                headers = mapOf("Content-Type" to "application/json"))
        }
    }

    private fun detail(req: Request): Response {
        val ctx = req.context()
        val id = req.pathParam("id")
            ?: return Response(status = 400, body = """{"error":"id required"}""",
                headers = mapOf("Content-Type" to "application/json"))

        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT id, run_id, workflow_id, job_type, execution_class,
                              payload_json, error_chain_json, worker_context_json,
                              attempts, max_attempts, reason, status,
                              acknowledged_by, acknowledged_at, created_at
                         FROM dead_letters
                        WHERE id = ?::uuid AND workspace_id = ?"""
                ).use { stmt ->
                    stmt.setString(1, id)
                    stmt.setObject(2, ctx.workspaceId)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) {
                            return Response(status = 404, body = """{"error":"Not found"}""",
                                headers = mapOf("Content-Type" to "application/json"))
                        }
                        return Response.ok(mapOf(
                            "id" to rs.getString("id"),
                            "runId" to rs.getString("run_id"),
                            "workflowId" to rs.getString("workflow_id"),
                            "jobType" to rs.getString("job_type"),
                            "executionClass" to rs.getString("execution_class"),
                            // The three fields that make this diagnosable without
                            // reproducing the crash.
                            "payload" to rs.getString("payload_json"),
                            "errorChain" to rs.getString("error_chain_json"),
                            "workerContext" to rs.getString("worker_context_json"),
                            "attempts" to rs.getInt("attempts"),
                            "maxAttempts" to rs.getInt("max_attempts"),
                            "reason" to rs.getString("reason"),
                            "status" to rs.getString("status"),
                            "acknowledgedBy" to rs.getString("acknowledged_by"),
                            "acknowledgedAt" to rs.getTimestamp("acknowledged_at")?.toInstant()?.toString(),
                            "createdAt" to rs.getTimestamp("created_at")?.toInstant()?.toString(),
                        ))
                    }
                }
            }
        } catch (e: Exception) {
            log.error("[incidents] dead-letter detail failed", e)
            Response(status = 500, body = """{"error":"Could not load dead letter"}""",
                headers = mapOf("Content-Type" to "application/json"))
        }
    }

    /**
     * Acknowledge only — deliberately not "replay".
     *
     * Replaying a dead letter re-runs a job that has already crashed several
     * workers, and doing that from a UI button before anyone has looked at the
     * payload is how one poison job becomes an outage twice. Acknowledgement
     * records that a human has seen it; re-running is a deliberate act through
     * the normal replay path once the cause is fixed.
     */
    private fun acknowledge(req: Request): Response {
        val ctx = req.context()
        val id = req.pathParam("id")
            ?: return Response(status = 400, body = """{"error":"id required"}""",
                headers = mapOf("Content-Type" to "application/json"))

        return try {
            val updated = dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE dead_letters
                          SET status='acknowledged', acknowledged_by=?, acknowledged_at=now(),
                              updated_at=now()
                        WHERE id=?::uuid AND workspace_id=? AND status='new'"""
                ).use { stmt ->
                    stmt.setString(1, req.principal?.appUserId?.toString() ?: "unknown")
                    stmt.setString(2, id)
                    stmt.setObject(3, ctx.workspaceId)
                    stmt.executeUpdate()
                }
            }
            if (updated > 0) Response.ok(mapOf("id" to id, "status" to "acknowledged"))
            else Response(status = 409,
                body = """{"error":"Not found or already acknowledged"}""",
                headers = mapOf("Content-Type" to "application/json"))
        } catch (e: Exception) {
            log.error("[incidents] acknowledge failed", e)
            Response(status = 500, body = """{"error":"Could not acknowledge"}""",
                headers = mapOf("Content-Type" to "application/json"))
        }
    }
}
