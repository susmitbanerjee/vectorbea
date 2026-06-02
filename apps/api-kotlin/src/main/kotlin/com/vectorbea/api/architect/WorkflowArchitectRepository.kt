package com.vectorbea.api.architect

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.api.repository.BaseRepository
import org.slf4j.LoggerFactory
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import javax.sql.DataSource

data class ArchitectSession(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val createdByUserId: UUID,
    val status: String,
    val userGoal: String,
    val refinedGoal: String?,
    val clarificationQuestionsJson: String,
    val userAnswersJson: String,
    val generatedPlanJson: String?,
    val generatedGraphJson: String?,
    val animationStepsJson: String?,
    val generatedWorkflowId: UUID?,
    val generatedWorkflowVersionId: UUID?,
    val failureReason: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

class WorkflowArchitectRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(WorkflowArchitectRepository::class.java)
    private val mapper = jacksonObjectMapper()

    private val cols = """
        id, workspace_id, environment_id, created_by_user_id, status, user_goal,
        refined_goal, clarification_questions_json, user_answers_json,
        generated_plan_json, generated_graph_json, animation_steps_json,
        generated_workflow_id, generated_workflow_version_id, failure_reason,
        created_at, updated_at
    """.trimIndent()

    fun create(
        workspaceId: UUID, environmentId: UUID, userId: UUID, goal: String,
    ): ArchitectSession = executeReturning(
        "INSERT INTO workflow_architect_sessions (workspace_id, environment_id, created_by_user_id, user_goal) " +
        "VALUES (?,?,?,?) RETURNING $cols",
        { setObject(1, workspaceId); setObject(2, environmentId); setObject(3, userId); setString(4, goal) },
        ::mapRow,
    )

    fun findById(id: UUID, workspaceId: UUID): ArchitectSession? = queryOne(
        "SELECT $cols FROM workflow_architect_sessions WHERE id=? AND workspace_id=?",
        { setObject(1, id); setObject(2, workspaceId) }, ::mapRow,
    )

    fun updateStatus(id: UUID, status: String, failureReason: String? = null) {
        execute("UPDATE workflow_architect_sessions SET status=?, failure_reason=?, updated_at=now() WHERE id=?") {
            setString(1, status); setString(2, failureReason); setObject(3, id)
        }
    }

    fun savePlan(id: UUID, planJson: String, graphJson: String?, animSteps: String?) {
        execute(
            "UPDATE workflow_architect_sessions SET generated_plan_json=?::jsonb, generated_graph_json=?::jsonb, " +
            "animation_steps_json=?::jsonb, status='plan_generated', updated_at=now() WHERE id=?"
        ) {
            setString(1, planJson); setString(2, graphJson); setString(3, animSteps); setObject(4, id)
        }
    }

    fun saveWorkflowIds(id: UUID, workflowId: UUID, versionId: UUID) {
        execute(
            "UPDATE workflow_architect_sessions SET generated_workflow_id=?, generated_workflow_version_id=?, " +
            "status='workflow_created', updated_at=now() WHERE id=?"
        ) { setObject(1, workflowId); setObject(2, versionId); setObject(3, id) }
    }

    fun saveClarifications(id: UUID, questionsJson: String) {
        execute(
            "UPDATE workflow_architect_sessions SET clarification_questions_json=?::jsonb, " +
            "status='needs_clarification', updated_at=now() WHERE id=?"
        ) { setString(1, questionsJson); setObject(2, id) }
    }

    // Usage tracking
    fun incrementUsage(workspaceId: UUID, planGenerations: Int = 0, tokensUsed: Int = 0, costCents: Int = 0) {
        execute("""
            INSERT INTO workflow_architect_usage (workspace_id, usage_date, planning_requests, plan_generations, tokens_used, estimated_cost_cents)
            VALUES (?, CURRENT_DATE, 1, ?, ?, ?)
            ON CONFLICT (workspace_id, usage_date) DO UPDATE SET
                planning_requests = workflow_architect_usage.planning_requests + 1,
                plan_generations  = workflow_architect_usage.plan_generations + EXCLUDED.plan_generations,
                tokens_used       = workflow_architect_usage.tokens_used + EXCLUDED.tokens_used,
                estimated_cost_cents = workflow_architect_usage.estimated_cost_cents + EXCLUDED.estimated_cost_cents,
                updated_at        = now()
        """.trimIndent()) {
            setObject(1, workspaceId); setInt(2, planGenerations)
            setInt(3, tokensUsed); setInt(4, costCents)
        }
    }

    fun getDailyPlanningRequests(workspaceId: UUID): Int = queryOne(
        "SELECT COALESCE(planning_requests, 0) FROM workflow_architect_usage WHERE workspace_id=? AND usage_date=CURRENT_DATE",
        { setObject(1, workspaceId) },
        { rs -> rs.getInt(1) },
    ) ?: 0

    fun getRevisionCount(sessionId: UUID): Int = queryOne(
        "SELECT COUNT(*) FROM workflow_architect_events WHERE session_id=? AND event_type='ARCHITECT_PLAN_REVISED'",
        { setObject(1, sessionId) },
        { rs -> rs.getInt(1) },
    ) ?: 0

    fun appendEvent(workspaceId: UUID, sessionId: UUID, eventType: String, title: String, message: String? = null) {
        execute("""
            INSERT INTO workflow_architect_events (workspace_id, session_id, sequence, event_type, title, message)
            VALUES (?, ?, (SELECT COALESCE(MAX(sequence),0)+1 FROM workflow_architect_events WHERE session_id=?), ?, ?, ?)
        """.trimIndent()) {
            setObject(1, workspaceId); setObject(2, sessionId); setObject(3, sessionId)
            setString(4, eventType); setString(5, title); setString(6, message)
        }
    }

    private fun mapRow(rs: java.sql.ResultSet) = ArchitectSession(
        id                        = UUID.fromString(rs.getString("id")),
        workspaceId               = UUID.fromString(rs.getString("workspace_id")),
        environmentId             = UUID.fromString(rs.getString("environment_id")),
        createdByUserId           = UUID.fromString(rs.getString("created_by_user_id")),
        status                    = rs.getString("status"),
        userGoal                  = rs.getString("user_goal"),
        refinedGoal               = rs.getString("refined_goal"),
        clarificationQuestionsJson = rs.getString("clarification_questions_json") ?: "[]",
        userAnswersJson           = rs.getString("user_answers_json") ?: "{}",
        generatedPlanJson         = rs.getString("generated_plan_json"),
        generatedGraphJson        = rs.getString("generated_graph_json"),
        animationStepsJson        = rs.getString("animation_steps_json"),
        generatedWorkflowId       = rs.getString("generated_workflow_id")?.let { UUID.fromString(it) },
        generatedWorkflowVersionId = rs.getString("generated_workflow_version_id")?.let { UUID.fromString(it) },
        failureReason             = rs.getString("failure_reason"),
        createdAt                 = rs.getTimestamp("created_at").toInstant(),
        updatedAt                 = rs.getTimestamp("updated_at").toInstant(),
    )
}
