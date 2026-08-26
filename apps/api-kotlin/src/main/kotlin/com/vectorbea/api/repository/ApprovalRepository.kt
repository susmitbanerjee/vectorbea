package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbStringOrNull
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Repository for human-in-the-loop approvals.
 *
 * Approvals are created by the workflow executor when an agent step requires
 * human sign-off. `run_approvals` is authoritative after V027; keeping reads
 * and decisions on that table prevents approved gates appearing as pending.
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
    /*
     * ── THE FIELDS P13 ASKED FOR, FINALLY READ ───────────────────────────────
     *
     * V027 added `sla_deadline_at`, `escalation_policy_json`,
     * `decision_context_json`, `evidence_refs_json` and `confidence_score` to
     * `run_approvals` specifically so an approval card could show a countdown,
     * who may decide, and where each value came from. The columns were written
     * and never selected, so the Approvals page filled the gap with constants —
     * `slaMs: 1`, `approverGroup: "Not provided by API"`. They are selected now.
     */
    /** When the decision becomes late. Null when the gate declares no SLA. */
    val slaDeadlineAt: Instant?,
    /** `{onTimeout, approverGroup, slaMinutes}` as the canvas configured it. */
    val escalationPolicyJson: String?,
    /** Provenance for each value in the decision context. */
    val evidenceRefsJson: String?,
    /** The agent's own confidence, 0..1, when the gate came from confidence routing. */
    val confidenceScore: Double?,
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
        a.id, a.run_id, COALESCE(a.workflow_id, r.workflow_id) AS workflow_id,
        a.node_id AS step_id, a.agent_id, a.status,
        COALESCE(a.title, 'Approval gate') AS title, a.message,
        COALESCE(a.risk_level, 'medium') AS risk_level, a.requested_by,
        a.resolved_by AS decided_by, a.created_at AS requested_at,
        a.resolved_at AS decided_at, a.decision_reason,
        COALESCE(a.decision_context_json, a.metadata_json) AS payload_json_sanitized,
        a.created_at, a.updated_at,
        a.sla_deadline_at, a.escalation_policy_json, a.evidence_refs_json,
        a.confidence_score
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
        UPDATE run_approvals a
        SET status        = UPPER(?),
            resolved_by   = ?,
            resolved_at   = now(),
            decision_reason = ?,
            updated_at    = now()
        WHERE a.id = ?
          AND a.workspace_id = ?
          AND UPPER(a.status) = 'PENDING'
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
        FROM run_approvals a
        JOIN agent_runs r ON r.id = a.run_id
        WHERE a.id = ? AND a.workspace_id = ?
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
            add("a.workspace_id = ?")
            if (workflowId != null) add("COALESCE(a.workflow_id, r.workflow_id) = ?")
            if (runId != null) add("a.run_id = ?")
            // Case-insensitive for clients and rows created before V027 normalization.
            if (status != null) add("LOWER(a.status) = LOWER(?)")
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
                FROM run_approvals a JOIN agent_runs r ON r.id = a.run_id
                $where
                ORDER BY a.created_at DESC
            """.trimIndent(),
            countSql = """
                SELECT COUNT(*)
                FROM run_approvals a JOIN agent_runs r ON r.id = a.run_id
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
        slaDeadlineAt = rs.instantOrNull("sla_deadline_at"),
        escalationPolicyJson = rs.getJsonbStringOrNull("escalation_policy_json"),
        evidenceRefsJson = rs.getJsonbStringOrNull("evidence_refs_json"),
        confidenceScore = rs.getObject("confidence_score")?.let { (it as? Number)?.toDouble() },
    )
}
