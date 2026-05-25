package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbString
import com.vectorbea.api.db.getJsonbStringOrNull
import com.vectorbea.api.db.setJsonb
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class AgentRun(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val workflowId: UUID?,
    val workflowVersionId: UUID?,
    val agentId: UUID?,
    val parentRunId: UUID?,
    val rootRunId: UUID?,
    val status: String,
    val triggerType: String,
    val triggerMetaJson: String,
    val inputJson: String,
    val outputJson: String?,
    val errorCode: String?,
    /** Sanitized error without PII/credentials */
    val errorMessageSanitized: String?,
    val startedAt: Instant?,
    val completedAt: Instant?,
    val durationMs: Int?,
    val tokenUsageJson: String?,
    val costUsd: Double?,
    val iterationCount: Int,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class CreateRunRequest(
    val workspaceId: UUID,
    val environmentId: UUID,
    val workflowId: UUID? = null,
    val workflowVersionId: UUID? = null,
    val agentId: UUID? = null,
    val parentRunId: UUID? = null,
    val rootRunId: UUID? = null,
    val triggerType: String = "manual",
    val triggerMeta: Map<String, Any> = emptyMap(),
    val input: Map<String, Any> = emptyMap(),
)

data class UpdateRunStatusRequest(
    val status: String,
    val output: Map<String, Any>? = null,
    val errorCode: String? = null,
    /** Must be sanitized before passing — never include raw exception messages */
    val errorMessageSanitized: String? = null,
    val startedAt: Instant? = null,
    val completedAt: Instant? = null,
    val durationMs: Int? = null,
    val tokenUsage: Map<String, Any>? = null,
    val costUsd: Double? = null,
    val iterationCount: Int? = null,
)

class RunRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(RunRepository::class.java)

    private val cols = """
        id, workspace_id, environment_id, workflow_id, workflow_version_id, agent_id,
        parent_run_id, root_run_id, status, trigger_type, trigger_meta_json,
        input_json, output_json, error_code, error_message_sanitized,
        started_at, completed_at, duration_ms, token_usage_json, cost_usd,
        iteration_count, created_at, updated_at
    """.trimIndent()

    fun findById(id: UUID, workspaceId: UUID): AgentRun? = queryOne(
        "SELECT $cols FROM agent_runs WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapRow,
    )

    fun list(
        workspaceId: UUID,
        environmentId: UUID? = null,
        workflowId: UUID? = null,
        agentId: UUID? = null,
        status: String? = null,
        parentRunId: UUID? = null,
        params: PageParams = PageParams(),
    ): Page<AgentRun> {
        val filters = buildList {
            add("workspace_id = ?")
            if (environmentId != null) add("environment_id = ?")
            if (workflowId != null) add("workflow_id = ?")
            if (agentId != null) add("agent_id = ?")
            if (status != null) add("status = ?")
            if (parentRunId != null) add("parent_run_id = ?")
        }
        val where = "WHERE ${filters.joinToString(" AND ")}"
        val bindBase: (java.sql.PreparedStatement) -> Unit = {
            var i = 1
            it.setUuid(i++, workspaceId)
            if (environmentId != null) it.setUuid(i++, environmentId)
            if (workflowId != null) it.setUuid(i++, workflowId)
            if (agentId != null) it.setUuid(i++, agentId)
            if (status != null) it.setString(i++, status)
            if (parentRunId != null) it.setUuid(i++, parentRunId)
        }
        return queryPage(
            sql = "SELECT $cols FROM agent_runs $where ORDER BY created_at DESC LIMIT ? OFFSET ?",
            countSql = "SELECT COUNT(*) FROM agent_runs $where",
            params = params,
            bind = {
                bindBase(this)
                setInt(filters.size + 1, params.limit)
                setInt(filters.size + 2, params.offset)
            },
            mapRow = ::mapRow,
        )
    }

    fun create(req: CreateRunRequest): AgentRun = executeReturning(
        """
        INSERT INTO agent_runs (
            workspace_id, environment_id, workflow_id, workflow_version_id, agent_id,
            parent_run_id, root_run_id, trigger_type, trigger_meta_json, input_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING $cols
        """.trimIndent(),
        {
            setUuid(1, req.workspaceId)
            setUuid(2, req.environmentId)
            setUuidOrNull(3, req.workflowId)
            setUuidOrNull(4, req.workflowVersionId)
            setUuidOrNull(5, req.agentId)
            setUuidOrNull(6, req.parentRunId)
            setUuidOrNull(7, req.rootRunId)
            setString(8, req.triggerType)
            setJsonb(9, req.triggerMeta)
            setJsonb(10, req.input)
        },
        ::mapRow,
    )

    fun updateStatus(id: UUID, workspaceId: UUID, req: UpdateRunStatusRequest): AgentRun? = queryOne(
        """
        UPDATE agent_runs SET
            status = ?,
            output_json = COALESCE(?, output_json),
            error_code = COALESCE(?, error_code),
            error_message_sanitized = COALESCE(?, error_message_sanitized),
            started_at = COALESCE(?, started_at),
            completed_at = COALESCE(?, completed_at),
            duration_ms = COALESCE(?, duration_ms),
            token_usage_json = COALESCE(?, token_usage_json),
            cost_usd = COALESCE(?, cost_usd),
            iteration_count = COALESCE(?, iteration_count),
            updated_at = now()
        WHERE id = ? AND workspace_id = ?
        RETURNING $cols
        """.trimIndent(),
        {
            setString(1, req.status)
            if (req.output != null) setJsonb(2, req.output) else setNull(2, java.sql.Types.OTHER)
            setString(3, req.errorCode)
            setString(4, req.errorMessageSanitized)
            setInstantOrNull(5, req.startedAt)
            setInstantOrNull(6, req.completedAt)
            if (req.durationMs != null) setInt(7, req.durationMs) else setNull(7, java.sql.Types.INTEGER)
            if (req.tokenUsage != null) setJsonb(8, req.tokenUsage) else setNull(8, java.sql.Types.OTHER)
            if (req.costUsd != null) setDouble(9, req.costUsd) else setNull(9, java.sql.Types.NUMERIC)
            if (req.iterationCount != null) setInt(10, req.iterationCount) else setNull(10, java.sql.Types.INTEGER)
            setUuid(11, id)
            setUuid(12, workspaceId)
        },
        ::mapRow,
    )

    fun delete(id: UUID, workspaceId: UUID): Boolean =
        execute("DELETE FROM agent_runs WHERE id = ? AND workspace_id = ?") {
            setUuid(1, id); setUuid(2, workspaceId)
        } > 0

    private fun mapRow(rs: java.sql.ResultSet) = AgentRun(
        id = rs.uuid("id"),
        workspaceId = rs.uuid("workspace_id"),
        environmentId = rs.uuid("environment_id"),
        workflowId = rs.uuidOrNull("workflow_id"),
        workflowVersionId = rs.uuidOrNull("workflow_version_id"),
        agentId = rs.uuidOrNull("agent_id"),
        parentRunId = rs.uuidOrNull("parent_run_id"),
        rootRunId = rs.uuidOrNull("root_run_id"),
        status = rs.getString("status"),
        triggerType = rs.getString("trigger_type"),
        triggerMetaJson = rs.getJsonbString("trigger_meta_json"),
        inputJson = rs.getJsonbString("input_json"),
        outputJson = rs.getJsonbStringOrNull("output_json"),
        errorCode = rs.getString("error_code"),
        errorMessageSanitized = rs.getString("error_message_sanitized"),
        startedAt = rs.instantOrNull("started_at"),
        completedAt = rs.instantOrNull("completed_at"),
        durationMs = rs.getObject("duration_ms") as? Int,
        tokenUsageJson = rs.getJsonbStringOrNull("token_usage_json"),
        costUsd = rs.getObject("cost_usd") as? Double,
        iterationCount = rs.getInt("iteration_count"),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
    )
}
