package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbStringOrNull
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Read-only repository for human-in-the-loop approvals.
 *
 * Approvals are created by the workflow executor when an agent step requires
 * human sign-off. The API surfaces them for review; approval/rejection is
 * a separate write operation (handled by the execution engine prompt).
 *
 * Security: [payloadJsonSanitized] has already had secrets stripped by the executor.
 */
data class Approval(
    val id: UUID,
    val runId: UUID,
    val workflowId: UUID,
    val stepId: String,
    val agentId: UUID?,
    val status: String,         // pending | approved | rejected | expired
    val title: String,
    val message: String?,
    val riskLevel: String,
    val requestedBy: String?,
    val decidedBy: String?,
    val requestedAt: Instant,
    val decidedAt: Instant?,
    val decisionReason: String?,
    /** Sanitized payload — safe to return to clients */
    val payloadJsonSanitized: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class DecideApprovalRequest(
    val id: UUID,
    val workspaceId: UUID,
    /** "approved" or "rejected" */
    val decision: String,
    val decidedBy: String,
    val reason: String?,
)

class ApprovalRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(ApprovalRepository::class.java)

    private val cols = """
        a.id, a.run_id, a.workflow_id, a.step_id, a.agent_id, a.status,
        a.title, a.message, a.risk_level, a.requested_by, a.decided_by,
        a.requested_at, a.decided_at, a.decision_reason,
        a.payload_json_sanitized, a.created_at, a.updated_at
    """.trimIndent()

    /**
     * Record an approve or reject decision on a PENDING approval.
     * Returns false if the approval was not found, already decided, or workspace mismatch.
     *
     * Uses an optimistic check: only updates rows with status='pending' to prevent
     * double-deciding a row that was already resolved.
     */
    fun decide(req: DecideApprovalRequest): Boolean = execute(
        """
        UPDATE approvals a
        SET status        = ?,
            decided_by    = ?,
            decided_at    = now(),
            decision_reason = ?,
            updated_at    = now()
        FROM agent_runs r
        WHERE a.id = ?
          AND a.run_id = r.id
          AND r.workspace_id = ?
          AND a.status = 'pending'
        """.trimIndent(),
    ) {
        setString(1, req.decision)
        setString(2, req.decidedBy)
        setString(3, req.reason)
        setUuid(4, req.id)
        setUuid(5, req.workspaceId)
    } > 0

    /**
     * Find an approval by ID, scoped to workspace via the workflow.
     * Joins agent_runs → workflows to enforce workspace scoping.
     */
    fun findById(id: UUID, workspaceId: UUID): Approval? = queryOne(
        """
        SELECT $cols
        FROM approvals a
        JOIN agent_runs r ON r.id = a.run_id
        WHERE a.id = ? AND r.workspace_id = ?
        """.trimIndent(),
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapRow,
    )

    fun list(
        workspaceId: UUID,
        workflowId: UUID? = null,
        runId: UUID? = null,
        status: String? = null,
        params: PageParams = PageParams(),
    ): Page<Approval> {
        val filters = buildList {
            add("r.workspace_id = ?")
            if (workflowId != null) add("a.workflow_id = ?")
            if (runId != null) add("a.run_id = ?")
            if (status != null) add("a.status = ?")
        }
        val where = "WHERE ${filters.joinToString(" AND ")}"
        val bindBase: (java.sql.PreparedStatement) -> Unit = {
            var i = 1
            it.setUuid(i++, workspaceId)
            if (workflowId != null) it.setUuid(i++, workflowId)
            if (runId != null) it.setUuid(i++, runId)
            if (status != null) it.setString(i++, status)
        }
        return queryPage(
            sql = """
                SELECT $cols
                FROM approvals a JOIN agent_runs r ON r.id = a.run_id
                $where
                ORDER BY a.requested_at DESC
            """.trimIndent(),
            countSql = """
                SELECT COUNT(*)
                FROM approvals a JOIN agent_runs r ON r.id = a.run_id
                $where
            """.trimIndent(),
            params = params,
            bind = { bindBase(this) },
            mapRow = ::mapRow,
        )
    }

    private fun mapRow(rs: java.sql.ResultSet) = Approval(
        id = rs.uuid("id"),
        runId = rs.uuid("run_id"),
        workflowId = rs.uuid("workflow_id"),
        stepId = rs.getString("step_id"),
        agentId = rs.uuidOrNull("agent_id"),
        status = rs.getString("status"),
        title = rs.getString("title"),
        message = rs.getString("message"),
        riskLevel = rs.getString("risk_level"),
        requestedBy = rs.getString("requested_by"),
        decidedBy = rs.getString("decided_by"),
        requestedAt = rs.instant("requested_at"),
        decidedAt = rs.instantOrNull("decided_at"),
        decisionReason = rs.getString("decision_reason"),
        payloadJsonSanitized = rs.getJsonbStringOrNull("payload_json_sanitized"),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
    )
}
