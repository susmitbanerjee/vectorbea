package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbStringOrNull
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class NodeDebugSnapshot(
    val id: UUID,
    val workflowRunId: UUID,
    val nodeRunId: UUID?,
    val workflowId: UUID,
    val nodeId: String,
    val nodeType: String,
    val nodeName: String?,
    val attempt: Int,
    val status: String,
    val inputTemplateJson: String?,
    val resolvedInputJson: String?,
    val resolvedVariablesJson: String?,
    val variableSourcesJson: String?,
    val outputJson: String?,
    val parsedOutputJson: String?,
    val schemaValidationJson: String?,
    val errorType: String?,
    val errorMessage: String?,
    val humanFailureReason: String?,
    val suggestedFix: String?,
    val modelProvider: String?,
    val modelName: String?,
    val tokensInput: Int?,
    val tokensOutput: Int?,
    val costEstimate: Double?,
    val startedAt: Instant?,
    val finishedAt: Instant?,
    val durationMs: Long?,
    val createdAt: Instant,
)

open class DebugSnapshotRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(DebugSnapshotRepository::class.java)

    private val cols = """
        id, workflow_run_id, node_run_id, workflow_id, node_id, node_type, node_name,
        attempt, status, input_template_json, resolved_input_json, resolved_variables_json,
        variable_sources_json, output_json, parsed_output_json, schema_validation_json,
        error_type, error_message, human_failure_reason, suggested_fix,
        model_provider, model_name, tokens_input, tokens_output, cost_estimate,
        started_at, finished_at, duration_ms, created_at
    """.trimIndent()

    /** Latest attempt per node — used for the node-summary list view. */
    open fun listLatestByRun(runId: UUID, workspaceId: UUID): List<NodeDebugSnapshot> = query(
        """
        SELECT DISTINCT ON (node_id) $cols
        FROM workflow_node_debug_snapshots
        WHERE workflow_run_id = ? AND workspace_id = ?
        ORDER BY node_id, attempt DESC
        """.trimIndent(),
        { setUuid(1, runId); setUuid(2, workspaceId) },
        ::mapRow,
    )

    /** Latest attempt for a single node. */
    open fun findLatest(runId: UUID, workspaceId: UUID, nodeId: String): NodeDebugSnapshot? = queryOne(
        """
        SELECT $cols FROM workflow_node_debug_snapshots
        WHERE workflow_run_id = ? AND workspace_id = ? AND node_id = ?
        ORDER BY attempt DESC LIMIT 1
        """.trimIndent(),
        { setUuid(1, runId); setUuid(2, workspaceId); setString(3, nodeId) },
        ::mapRow,
    )

    /** All attempts for a node, oldest first. */
    open fun listAttempts(runId: UUID, workspaceId: UUID, nodeId: String): List<NodeDebugSnapshot> = query(
        """
        SELECT $cols FROM workflow_node_debug_snapshots
        WHERE workflow_run_id = ? AND workspace_id = ? AND node_id = ?
        ORDER BY attempt ASC
        """.trimIndent(),
        { setUuid(1, runId); setUuid(2, workspaceId); setString(3, nodeId) },
        ::mapRow,
    )

    /** Deletes snapshots older than the retention window — call from a scheduled cleanup job. */
    open fun deleteOlderThan(cutoff: Instant): Int = dataSource.connection.use { conn ->
        conn.prepareStatement("DELETE FROM workflow_node_debug_snapshots WHERE created_at < ?").use { stmt ->
            stmt.setObject(1, java.sql.Timestamp.from(cutoff))
            stmt.executeUpdate()
        }
    }

    private fun mapRow(rs: java.sql.ResultSet) = NodeDebugSnapshot(
        id = rs.uuid("id"),
        workflowRunId = rs.uuid("workflow_run_id"),
        nodeRunId = rs.uuidOrNull("node_run_id"),
        workflowId = rs.uuid("workflow_id"),
        nodeId = rs.getString("node_id"),
        nodeType = rs.getString("node_type"),
        nodeName = rs.getString("node_name"),
        attempt = rs.getInt("attempt"),
        status = rs.getString("status"),
        inputTemplateJson = rs.getJsonbStringOrNull("input_template_json"),
        resolvedInputJson = rs.getJsonbStringOrNull("resolved_input_json"),
        resolvedVariablesJson = rs.getJsonbStringOrNull("resolved_variables_json"),
        variableSourcesJson = rs.getJsonbStringOrNull("variable_sources_json"),
        outputJson = rs.getJsonbStringOrNull("output_json"),
        parsedOutputJson = rs.getJsonbStringOrNull("parsed_output_json"),
        schemaValidationJson = rs.getJsonbStringOrNull("schema_validation_json"),
        errorType = rs.getString("error_type"),
        errorMessage = rs.getString("error_message"),
        humanFailureReason = rs.getString("human_failure_reason"),
        suggestedFix = rs.getString("suggested_fix"),
        modelProvider = rs.getString("model_provider"),
        modelName = rs.getString("model_name"),
        tokensInput = rs.getObject("tokens_input") as? Int,
        tokensOutput = rs.getObject("tokens_output") as? Int,
        costEstimate = (rs.getObject("cost_estimate") as? java.math.BigDecimal)?.toDouble()
            ?: (rs.getObject("cost_estimate") as? Double),
        startedAt = rs.instantOrNull("started_at"),
        finishedAt = rs.instantOrNull("finished_at"),
        durationMs = rs.getObject("duration_ms") as? Long,
        createdAt = rs.instant("created_at"),
    )
}
