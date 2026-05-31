package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * GET /api/agent-iterations/:runId
 * Returns agent brain iteration trace for a run. Workspace-scoped.
 * Only returns sanitized summaries — no raw LLM output.
 */
class AgentIterationRoutes(private val ds: DataSource) {
    private val log = LoggerFactory.getLogger(AgentIterationRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/agent-iterations/:runId", ::list)
    }

    private fun list(req: Request): Response {
        val ctx    = req.context()
        val runId  = req.pathUUID("runId")
        val stepId = req.query("stepId")

        val rows = ds.connection.use { conn ->
            val whereParts = mutableListOf("run_id = ?", "workspace_id = ?")
            if (stepId != null) whereParts.add("step_id = ?")
            conn.prepareStatement(
                """SELECT id, iteration_number, status, thought_summary_sanitized,
                   action_type, selected_tool_id, observation_summary_sanitized,
                   tokens_used, estimated_cost_cents, started_at, completed_at
                   FROM agent_iterations
                   WHERE ${whereParts.joinToString(" AND ")}
                   ORDER BY iteration_number ASC"""
            ).use { stmt ->
                stmt.setObject(1, runId)
                stmt.setObject(2, ctx.workspaceId)
                if (stepId != null) stmt.setString(3, stepId)
                val rs = stmt.executeQuery()
                buildList {
                    while (rs.next()) {
                        add(mapOf(
                            "id"                           to rs.getString("id"),
                            "iterationNumber"              to rs.getInt("iteration_number"),
                            "status"                       to rs.getString("status"),
                            "thoughtSummarySanitized"      to rs.getString("thought_summary_sanitized"),
                            "actionType"                   to rs.getString("action_type"),
                            "selectedToolId"               to rs.getString("selected_tool_id"),
                            "observationSummarySanitized"  to rs.getString("observation_summary_sanitized"),
                            "tokensUsed"                   to rs.getInt("tokens_used"),
                            "estimatedCostCents"           to (rs.getDouble("estimated_cost_cents")),
                            "startedAt"                    to rs.getTimestamp("started_at")?.toInstant()?.toString(),
                            "completedAt"                  to rs.getTimestamp("completed_at")?.toInstant()?.toString(),
                        ))
                    }
                }
            }
        }
        return Response.ok(rows)
    }
}
