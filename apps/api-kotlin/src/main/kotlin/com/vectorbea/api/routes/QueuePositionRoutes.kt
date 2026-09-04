package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import org.slf4j.LoggerFactory
import javax.sql.DataSource

/**
 * `GET /api/runs/:id/queue-position`
 *
 * A visible position is patience; an unexplained `queued` is a bug report
 * (09 §7). This endpoint exists so the Runs page can say *why* a run is waiting,
 * and the distinction it draws is the one that matters to the person reading it:
 *
 *   **tenant_cap**        you are at your own concurrency limit. Your other runs
 *                         are the reason. Nothing is wrong; upgrade or wait.
 *   **global_saturation** the platform is busy. Not your fault, not your fix.
 *
 * The UI shows those differently, and conflating them turns "your plan's limit"
 * into "the product is broken".
 *
 * Only possible because the claim decision lives in Postgres: position is
 * `count(*) WHERE fair_vtime < mine`, which a Redis stream cannot answer at all.
 */
class QueuePositionRoutes(private val dataSource: DataSource) {

    private val log = LoggerFactory.getLogger(QueuePositionRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/runs/:id/queue-position") { req -> position(req) }
    }

    private fun position(req: Request): Response {
        val ctx = req.context()
        val id = req.pathParam("id")

        return try {
            dataSource.connection.use { conn ->
                // ── The run's own state ───────────────────────────────────────
                val run = conn.prepareStatement(
                    """SELECT status, execution_class, fair_vtime, priority, created_at
                         FROM agent_runs WHERE id = ?::uuid AND workspace_id = ?"""
                ).use { stmt ->
                    stmt.setString(1, id); stmt.setObject(2, ctx.workspaceId)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) return Response(status = 404,
                            body = """{"error":"Run not found"}""",
                            headers = mapOf("Content-Type" to "application/json"))
                        RunState(
                            status = rs.getString("status"),
                            executionClass = rs.getString("execution_class") ?: "short",
                            fairVtime = rs.getDouble("fair_vtime"),
                            priority = rs.getInt("priority"),
                        )
                    }
                }

                // A run that is no longer waiting has no position, and saying
                // "position 0" would read as "next" rather than "started".
                if (run.status !in setOf("queued", "yielded")) {
                    return Response.ok(mapOf(
                        "runId" to id, "status" to run.status,
                        "queued" to false, "position" to null,
                        "message" to "This run is no longer queued.",
                    ))
                }

                // ── Position: how many runs would be claimed first ────────────
                // Spelled out rather than written as a row comparison on
                // `(priority, -fair_vtime)`: negating a bind parameter leaves
                // Postgres unable to resolve the operator. This is the same
                // ordering the claim uses — priority DESC, then fair_vtime ASC —
                // so it is the real answer, not an approximation of it.
                val ahead = conn.prepareStatement(
                    """SELECT count(*)::int AS ahead
                         FROM agent_runs
                        WHERE status IN ('queued','yielded')
                          AND execution_class = ?
                          AND (priority > ? OR (priority = ? AND fair_vtime < ?))"""
                ).use { stmt ->
                    stmt.setString(1, run.executionClass)
                    stmt.setInt(2, run.priority)
                    stmt.setInt(3, run.priority)
                    stmt.setDouble(4, run.fairVtime)
                    stmt.executeQuery().use { rs -> if (rs.next()) rs.getInt("ahead") else 0 }
                }

                // ── Why is it waiting? ────────────────────────────────────────
                val atTenantCap = conn.prepareStatement(
                    """SELECT COALESCE(count(rl.*), 0) >= COALESCE(MAX(p.max_concurrent_runs), 2) AS at_cap
                         FROM run_leases rl
                         LEFT JOIN workspace_usage_policies p ON p.workspace_id = rl.workspace_id
                        WHERE rl.workspace_id = ? AND rl.expires_at > now()"""
                ).use { stmt ->
                    stmt.setObject(1, ctx.workspaceId)
                    stmt.executeQuery().use { rs -> rs.next() && rs.getBoolean("at_cap") }
                }

                // ── ETA from recent throughput ────────────────────────────────
                // Measured, not modelled: completions per second for this class
                // over the last five minutes. A model would be wrong the moment
                // the fleet is resized; this tracks it automatically.
                val ratePerSec = conn.prepareStatement(
                    """SELECT count(*)::float / 300.0 AS rate
                         FROM agent_runs
                        WHERE execution_class = ?
                          AND completed_at > now() - interval '5 minutes'"""
                ).use { stmt ->
                    stmt.setString(1, run.executionClass)
                    stmt.executeQuery().use { rs -> if (rs.next()) rs.getDouble("rate") else 0.0 }
                }

                val etaSeconds = if (ratePerSec > 0.0001) Math.ceil((ahead + 1) / ratePerSec).toInt() else null

                val reason = if (atTenantCap) "tenant_cap" else "global_saturation"
                Response.ok(mapOf(
                    "runId" to id,
                    "status" to run.status,
                    "queued" to true,
                    "position" to ahead + 1,
                    "executionClass" to run.executionClass,
                    "priority" to run.priority,
                    "reason" to reason,
                    "etaSeconds" to etaSeconds,
                    "throughputPerSecond" to Math.round(ratePerSec * 1000.0) / 1000.0,
                    // Phrased for a person, not a log. Active voice, states what
                    // happened and what to do — the copy rules apply to API
                    // strings the UI renders verbatim.
                    "message" to when {
                        atTenantCap && etaSeconds != null ->
                            "Waiting on your workspace's concurrency limit. " +
                            "Position ${ahead + 1}, about ${humanize(etaSeconds)}."
                        atTenantCap ->
                            "Waiting on your workspace's concurrency limit. Position ${ahead + 1}."
                        etaSeconds != null ->
                            "Waiting for capacity. Position ${ahead + 1}, about ${humanize(etaSeconds)}."
                        else ->
                            "Waiting for capacity. Position ${ahead + 1}."
                    },
                ))
            }
        } catch (e: Exception) {
            log.error("[queue-position] failed for run {}", id, e)
            Response(status = 500,
                body = """{"error":"Could not determine queue position"}""",
                headers = mapOf("Content-Type" to "application/json"))
        }
    }

    private data class RunState(
        val status: String, val executionClass: String,
        val fairVtime: Double, val priority: Int,
    )

    private fun humanize(seconds: Int): String = when {
        seconds < 60 -> "$seconds seconds"
        seconds < 3600 -> "${seconds / 60} minute${if (seconds / 60 == 1) "" else "s"}"
        else -> "${seconds / 3600} hour${if (seconds / 3600 == 1) "" else "s"}"
    }
}
