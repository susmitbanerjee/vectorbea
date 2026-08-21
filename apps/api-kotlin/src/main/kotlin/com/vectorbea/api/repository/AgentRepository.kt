package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbString
import com.vectorbea.api.db.setJsonb
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class Agent(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val slug: String,
    val description: String?,
    val type: String,
    val role: String?,
    val instructions: String?,
    val llmConnectionId: UUID?,
    val modelName: String?,
    val temperature: Double?,
    val maxTokens: Int?,
    val maxIterations: Int?,
    val allowedToolIds: List<String>,
    val memoryPolicyJson: String,
    val retryPolicyJson: String,
    val timeoutPolicyJson: String,
    val approvalPolicyJson: String,
    val outputSchemaJson: String,
    val status: String,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class CreateAgentRequest(
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val slug: String,
    val description: String? = null,
    val type: String,
    val role: String? = null,
    val instructions: String? = null,
    val llmConnectionId: UUID? = null,
    val modelName: String? = null,
    val temperature: Double? = null,
    val maxTokens: Int? = null,
    val maxIterations: Int? = null,
    val allowedToolIds: List<String> = emptyList(),
    val memoryPolicy: Map<String, Any> = emptyMap(),
    val retryPolicy: Map<String, Any> = emptyMap(),
    val timeoutPolicy: Map<String, Any> = emptyMap(),
    val approvalPolicy: Map<String, Any> = emptyMap(),
    val outputSchema: Map<String, Any> = emptyMap(),
    val status: String = "active",
)

class AgentRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(AgentRepository::class.java)

    private val cols = """
        id, workspace_id, environment_id, name, slug, description, type, role, instructions,
        llm_connection_id, model_name, temperature, max_tokens, max_iterations,
        allowed_tool_ids,
        memory_policy_json, retry_policy_json, timeout_policy_json,
        approval_policy_json, output_schema_json, status, created_at, updated_at
    """.trimIndent()

    fun findById(id: UUID, workspaceId: UUID): Agent? = queryOne(
        "SELECT $cols FROM agents WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapRow,
    )

    fun list(
        workspaceId: UUID,
        environmentId: UUID? = null,
        status: String? = null,
        params: PageParams = PageParams(),
    ): Page<Agent> {
        val filters = buildList {
            add("workspace_id = ?")
            if (environmentId != null) add("environment_id = ?")
            if (status != null) add("status = ?")
        }
        val where = "WHERE ${filters.joinToString(" AND ")}"
        val bindBase: (java.sql.PreparedStatement) -> Unit = {
            var i = 1
            it.setUuid(i++, workspaceId)
            if (environmentId != null) it.setUuid(i++, environmentId)
            if (status != null) it.setString(i++, status)
        }
        return queryPage(
            sql = "SELECT $cols FROM agents $where ORDER BY created_at DESC",
            countSql = "SELECT COUNT(*) FROM agents $where",
            params = params,
            bind = { bindBase(this) },
            mapRow = ::mapRow,
        )
    }

    fun create(req: CreateAgentRequest): Agent = executeReturning(
        """
        INSERT INTO agents (
            workspace_id, environment_id, name, slug, description, type, role, instructions,
            llm_connection_id, model_name, temperature, max_tokens, max_iterations,
            allowed_tool_ids,
            memory_policy_json, retry_policy_json, timeout_policy_json,
            approval_policy_json, output_schema_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING $cols
        """.trimIndent(),
        {
            setUuid(1, req.workspaceId)
            setUuid(2, req.environmentId)
            setString(3, req.name)
            setString(4, req.slug)
            setString(5, req.description)
            setString(6, req.type)
            setString(7, req.role)
            setString(8, req.instructions)
            setUuidOrNull(9, req.llmConnectionId)
            setString(10, req.modelName)
            if (req.temperature != null) setDouble(11, req.temperature) else setNull(11, java.sql.Types.NUMERIC)
            if (req.maxTokens != null) setInt(12, req.maxTokens) else setNull(12, java.sql.Types.INTEGER)
            if (req.maxIterations != null) setInt(13, req.maxIterations) else setNull(13, java.sql.Types.INTEGER)
            setTextArray(14, req.allowedToolIds)
            setJsonb(15, req.memoryPolicy)
            setJsonb(16, req.retryPolicy)
            setJsonb(17, req.timeoutPolicy)
            setJsonb(18, req.approvalPolicy)
            setJsonb(19, req.outputSchema)
            setString(20, req.status)
        },
        ::mapRow,
    )

    fun update(
        id: UUID,
        workspaceId: UUID,
        name: String? = null,
        description: String? = null,
        role: String? = null,
        instructions: String? = null,
        llmConnectionId: UUID? = null,
        modelName: String? = null,
        temperature: Double? = null,
        maxTokens: Int? = null,
        maxIterations: Int? = null,
        allowedToolIds: List<String>? = null,
        memoryPolicy: Map<String, Any>? = null,
        retryPolicy: Map<String, Any>? = null,
        timeoutPolicy: Map<String, Any>? = null,
        approvalPolicy: Map<String, Any>? = null,
        outputSchema: Map<String, Any>? = null,
        status: String? = null,
    ): Agent? {
        val setClauses = buildList {
            if (name != null) add("name = ?")
            if (description != null) add("description = ?")
            if (role != null) add("role = ?")
            if (instructions != null) add("instructions = ?")
            if (llmConnectionId != null) add("llm_connection_id = ?")
            if (modelName != null) add("model_name = ?")
            if (temperature != null) add("temperature = ?")
            if (maxTokens != null) add("max_tokens = ?")
            if (maxIterations != null) add("max_iterations = ?")
            if (allowedToolIds != null) add("allowed_tool_ids = ?")
            if (memoryPolicy != null) add("memory_policy_json = ?")
            if (retryPolicy != null) add("retry_policy_json = ?")
            if (timeoutPolicy != null) add("timeout_policy_json = ?")
            if (approvalPolicy != null) add("approval_policy_json = ?")
            if (outputSchema != null) add("output_schema_json = ?")
            if (status != null) add("status = ?")
            add("updated_at = now()")
        }
        if (setClauses.size == 1) return findById(id, workspaceId)
        return queryOne(
            "UPDATE agents SET ${setClauses.joinToString(", ")} WHERE id = ? AND workspace_id = ? RETURNING $cols",
            {
                var i = 1
                if (name != null) setString(i++, name)
                if (description != null) setString(i++, description)
                if (role != null) setString(i++, role)
                if (instructions != null) setString(i++, instructions)
                if (llmConnectionId != null) setUuid(i++, llmConnectionId)
                if (modelName != null) setString(i++, modelName)
                if (temperature != null) setDouble(i++, temperature)
                if (maxTokens != null) setInt(i++, maxTokens)
                if (maxIterations != null) setInt(i++, maxIterations)
                if (allowedToolIds != null) setTextArray(i++, allowedToolIds)
                if (memoryPolicy != null) setJsonb(i++, memoryPolicy)
                if (retryPolicy != null) setJsonb(i++, retryPolicy)
                if (timeoutPolicy != null) setJsonb(i++, timeoutPolicy)
                if (approvalPolicy != null) setJsonb(i++, approvalPolicy)
                if (outputSchema != null) setJsonb(i++, outputSchema)
                if (status != null) setString(i++, status)
                setUuid(i++, id)
                setUuid(i, workspaceId)
            },
            ::mapRow,
        )
    }

    fun updateStatus(id: UUID, workspaceId: UUID, status: String): Agent? = queryOne(
        "UPDATE agents SET status = ?, updated_at = now() WHERE id = ? AND workspace_id = ? RETURNING $cols",
        { setString(1, status); setUuid(2, id); setUuid(3, workspaceId) },
        ::mapRow,
    )

    fun delete(id: UUID, workspaceId: UUID): Boolean =
        execute("DELETE FROM agents WHERE id = ? AND workspace_id = ?") {
            setUuid(1, id); setUuid(2, workspaceId)
        } > 0

    @Suppress("UNCHECKED_CAST")
    private fun mapRow(rs: java.sql.ResultSet) = Agent(
        id = rs.uuid("id"),
        workspaceId = rs.uuid("workspace_id"),
        environmentId = rs.uuid("environment_id"),
        name = rs.getString("name"),
        slug = rs.getString("slug"),
        description = rs.getString("description"),
        type = rs.getString("type"),
        role = rs.getString("role"),
        instructions = rs.getString("instructions"),
        llmConnectionId = rs.uuidOrNull("llm_connection_id"),
        modelName = rs.getString("model_name"),
        temperature = rs.getObject("temperature") as? Double,
        maxTokens = rs.getObject("max_tokens") as? Int,
        maxIterations = rs.getObject("max_iterations") as? Int,
        allowedToolIds = (rs.getArray("allowed_tool_ids")?.array as? Array<*>)
            ?.filterIsInstance<String>() ?: emptyList(),
        memoryPolicyJson = rs.getJsonbString("memory_policy_json"),
        retryPolicyJson = rs.getJsonbString("retry_policy_json"),
        timeoutPolicyJson = rs.getJsonbString("timeout_policy_json"),
        approvalPolicyJson = rs.getJsonbString("approval_policy_json"),
        outputSchemaJson = rs.getJsonbString("output_schema_json"),
        status = rs.getString("status"),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
    )
}
