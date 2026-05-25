package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbString
import com.vectorbea.api.db.setJsonb
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class Tool(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val slug: String,
    val type: String,
    val description: String?,
    val connectionId: UUID?,
    val inputSchemaJson: String,
    val outputSchemaJson: String,
    val configJson: String,
    val riskLevel: String,
    val requiresApproval: Boolean,
    val timeoutMs: Int?,
    val retryPolicyJson: String,
    val idempotencyStrategy: String?,
    val status: String,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class CreateToolRequest(
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val slug: String,
    val type: String,
    val description: String? = null,
    val connectionId: UUID? = null,
    val inputSchema: Map<String, Any> = emptyMap(),
    val outputSchema: Map<String, Any> = emptyMap(),
    val config: Map<String, Any> = emptyMap(),
    val riskLevel: String = "low",
    val requiresApproval: Boolean = false,
    val timeoutMs: Int? = null,
    val retryPolicy: Map<String, Any> = emptyMap(),
    val idempotencyStrategy: String? = null,
    val status: String = "active",
)

class ToolRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(ToolRepository::class.java)

    private val cols = """
        id, workspace_id, environment_id, name, slug, type, description, connection_id,
        input_schema_json, output_schema_json, config_json, risk_level, requires_approval,
        timeout_ms, retry_policy_json, idempotency_strategy, status, created_at, updated_at
    """.trimIndent()

    fun findById(id: UUID, workspaceId: UUID): Tool? = queryOne(
        "SELECT $cols FROM tools WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapRow,
    )

    fun list(
        workspaceId: UUID,
        environmentId: UUID? = null,
        type: String? = null,
        status: String? = null,
        params: PageParams = PageParams(),
    ): Page<Tool> {
        val filters = buildList {
            add("workspace_id = ?")
            if (environmentId != null) add("environment_id = ?")
            if (type != null) add("type = ?")
            if (status != null) add("status = ?")
        }
        val where = "WHERE ${filters.joinToString(" AND ")}"
        val bindBase: (java.sql.PreparedStatement) -> Unit = {
            var i = 1
            it.setUuid(i++, workspaceId)
            if (environmentId != null) it.setUuid(i++, environmentId)
            if (type != null) it.setString(i++, type)
            if (status != null) it.setString(i++, status)
        }
        return queryPage(
            sql = "SELECT $cols FROM tools $where ORDER BY created_at DESC LIMIT ? OFFSET ?",
            countSql = "SELECT COUNT(*) FROM tools $where",
            params = params,
            bind = {
                bindBase(this)
                setInt(filters.size + 1, params.limit)
                setInt(filters.size + 2, params.offset)
            },
            mapRow = ::mapRow,
        )
    }

    fun create(req: CreateToolRequest): Tool = executeReturning(
        """
        INSERT INTO tools (
            workspace_id, environment_id, name, slug, type, description, connection_id,
            input_schema_json, output_schema_json, config_json, risk_level, requires_approval,
            timeout_ms, retry_policy_json, idempotency_strategy, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING $cols
        """.trimIndent(),
        {
            setUuid(1, req.workspaceId)
            setUuid(2, req.environmentId)
            setString(3, req.name)
            setString(4, req.slug)
            setString(5, req.type)
            setString(6, req.description)
            setUuidOrNull(7, req.connectionId)
            setJsonb(8, req.inputSchema)
            setJsonb(9, req.outputSchema)
            setJsonb(10, req.config)
            setString(11, req.riskLevel)
            setBoolean(12, req.requiresApproval)
            if (req.timeoutMs != null) setInt(13, req.timeoutMs) else setNull(13, java.sql.Types.INTEGER)
            setJsonb(14, req.retryPolicy)
            setString(15, req.idempotencyStrategy)
            setString(16, req.status)
        },
        ::mapRow,
    )

    fun delete(id: UUID, workspaceId: UUID): Boolean =
        execute("DELETE FROM tools WHERE id = ? AND workspace_id = ?") {
            setUuid(1, id); setUuid(2, workspaceId)
        } > 0

    private fun mapRow(rs: java.sql.ResultSet) = Tool(
        id = rs.uuid("id"),
        workspaceId = rs.uuid("workspace_id"),
        environmentId = rs.uuid("environment_id"),
        name = rs.getString("name"),
        slug = rs.getString("slug"),
        type = rs.getString("type"),
        description = rs.getString("description"),
        connectionId = rs.uuidOrNull("connection_id"),
        inputSchemaJson = rs.getJsonbString("input_schema_json"),
        outputSchemaJson = rs.getJsonbString("output_schema_json"),
        configJson = rs.getJsonbString("config_json"),
        riskLevel = rs.getString("risk_level"),
        requiresApproval = rs.getBoolean("requires_approval"),
        timeoutMs = rs.getObject("timeout_ms") as? Int,
        retryPolicyJson = rs.getJsonbString("retry_policy_json"),
        idempotencyStrategy = rs.getString("idempotency_strategy"),
        status = rs.getString("status"),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
    )
}
