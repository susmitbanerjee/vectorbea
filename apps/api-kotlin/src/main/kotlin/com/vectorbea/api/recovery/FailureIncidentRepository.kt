package com.vectorbea.api.recovery

import com.vectorbea.recovery.model.RecoveryIncidentDraft
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import org.slf4j.LoggerFactory
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class FailureIncidentRow(
    val id: UUID,
    val workspaceId: UUID,
    val runId: UUID,
    val workflowId: UUID,
    val failedNodeId: String?,
    val failedStepId: String?,
    val failedAgentId: UUID?,
    val failedToolId: UUID?,
    val failedConnectionId: UUID?,
    val category: String,
    val code: String,
    val severity: String,
    val retryable: Boolean,
    val autoReplaySafe: Boolean,
    val requiresHumanApproval: Boolean,
    val summary: String,
    val technicalSummary: String?,
    val recommendedAction: String?,
    val remediationJson: String,
    val detectedAt: Instant,
    val resolutionStatus: String,
)

class FailureIncidentRepository(private val ds: DataSource) {
    private val log = LoggerFactory.getLogger(FailureIncidentRepository::class.java)
    private val mapper = jacksonObjectMapper()

    fun create(draft: RecoveryIncidentDraft): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { conn ->
            conn.prepareStatement("""
                INSERT INTO failure_incidents
                  (id,workspace_id,environment_id,run_id,workflow_id,workflow_version_id,
                   failed_step_id,failed_node_id,failed_agent_id,failed_tool_id,failed_connection_id,
                   category,code,severity,retryable,auto_replay_safe,requires_human_approval,
                   summary,technical_summary,recommended_action,remediation_json,detected_at)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,now())
                ON CONFLICT DO NOTHING
            """.trimIndent()).use { stmt ->
                stmt.setObject(1, id)
                stmt.setObject(2, UUID.fromString(draft.workspaceId))
                stmt.setObject(3, UUID.fromString(draft.environmentId))
                stmt.setObject(4, UUID.fromString(draft.runId))
                stmt.setObject(5, UUID.fromString(draft.workflowId))
                stmt.setObject(6, UUID.fromString(draft.workflowVersionId))
                stmt.setString(7, draft.failedStepId)
                stmt.setString(8, draft.failedNodeId)
                stmt.setObject(9, draft.failedAgentId?.let { UUID.fromString(it) })
                stmt.setObject(10, draft.failedToolId?.let { UUID.fromString(it) })
                stmt.setObject(11, draft.failedConnectionId?.let { UUID.fromString(it) })
                stmt.setString(12, draft.classification.category.name)
                stmt.setString(13, draft.classification.code)
                stmt.setString(14, draft.classification.severity.name)
                stmt.setBoolean(15, draft.classification.retryable)
                stmt.setBoolean(16, draft.recommendation.autoReplaySafe)
                stmt.setBoolean(17, draft.recommendation.requiresHumanApproval)
                stmt.setString(18, draft.classification.summary)
                stmt.setString(19, draft.classification.technicalSummary)
                stmt.setString(20, draft.recommendation.recommendedAction)
                stmt.setString(21, mapper.writeValueAsString(draft.diagnosticBundle + draft.recommendation.remediation))
                stmt.executeUpdate()
            }
        }
        log.info("[recovery] incident created id={} category={} code={}", id, draft.classification.category, draft.classification.code)
        return id
    }

    fun findByRunId(runId: UUID, workspaceId: UUID): FailureIncidentRow? {
        ds.connection.use { conn ->
            conn.prepareStatement(
                "SELECT * FROM failure_incidents WHERE run_id=? AND workspace_id=? ORDER BY detected_at DESC LIMIT 1"
            ).use { stmt ->
                stmt.setObject(1, runId); stmt.setObject(2, workspaceId)
                val rs = stmt.executeQuery()
                if (!rs.next()) return null
                return mapRow(rs)
            }
        }
    }

    fun findById(id: UUID, workspaceId: UUID): FailureIncidentRow? {
        ds.connection.use { conn ->
            conn.prepareStatement("SELECT * FROM failure_incidents WHERE id=? AND workspace_id=?").use { stmt ->
                stmt.setObject(1, id); stmt.setObject(2, workspaceId)
                val rs = stmt.executeQuery()
                if (!rs.next()) return null
                return mapRow(rs)
            }
        }
    }

    fun list(workspaceId: UUID, status: String? = null, category: String? = null, limit: Int = 50): List<FailureIncidentRow> {
        val conditions = mutableListOf("workspace_id=?")
        if (status != null) conditions.add("resolution_status=?")
        if (category != null) conditions.add("category=?")
        val sql = "SELECT * FROM failure_incidents WHERE ${conditions.joinToString(" AND ")} ORDER BY detected_at DESC LIMIT $limit"
        ds.connection.use { conn ->
            conn.prepareStatement(sql).use { stmt ->
                var i = 1
                stmt.setObject(i++, workspaceId)
                if (status != null) stmt.setString(i++, status)
                if (category != null) stmt.setString(i, category)
                val rs = stmt.executeQuery()
                val rows = mutableListOf<FailureIncidentRow>()
                while (rs.next()) rows.add(mapRow(rs))
                return rows
            }
        }
    }

    fun markResolved(id: UUID, workspaceId: UUID): Boolean {
        ds.connection.use { conn ->
            conn.prepareStatement(
                "UPDATE failure_incidents SET resolution_status='resolved',resolved_at=now(),updated_at=now() WHERE id=? AND workspace_id=?"
            ).use { stmt ->
                stmt.setObject(1, id); stmt.setObject(2, workspaceId)
                return stmt.executeUpdate() > 0
            }
        }
    }

    private fun mapRow(rs: java.sql.ResultSet) = FailureIncidentRow(
        id = UUID.fromString(rs.getString("id")),
        workspaceId = UUID.fromString(rs.getString("workspace_id")),
        runId = UUID.fromString(rs.getString("run_id")),
        workflowId = UUID.fromString(rs.getString("workflow_id")),
        failedNodeId = rs.getString("failed_node_id"),
        failedStepId = rs.getString("failed_step_id"),
        failedAgentId = rs.getString("failed_agent_id")?.let { UUID.fromString(it) },
        failedToolId = rs.getString("failed_tool_id")?.let { UUID.fromString(it) },
        failedConnectionId = rs.getString("failed_connection_id")?.let { UUID.fromString(it) },
        category = rs.getString("category"),
        code = rs.getString("code"),
        severity = rs.getString("severity"),
        retryable = rs.getBoolean("retryable"),
        autoReplaySafe = rs.getBoolean("auto_replay_safe"),
        requiresHumanApproval = rs.getBoolean("requires_human_approval"),
        summary = rs.getString("summary"),
        technicalSummary = rs.getString("technical_summary"),
        recommendedAction = rs.getString("recommended_action"),
        remediationJson = rs.getString("remediation_json") ?: "{}",
        detectedAt = rs.getTimestamp("detected_at").toInstant(),
        resolutionStatus = rs.getString("resolution_status"),
    )
}
