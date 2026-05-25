package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbString
import com.vectorbea.api.db.setJsonb
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class Workflow(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val slug: String,
    val description: String?,
    val currentVersionId: UUID?,
    val triggerType: String,
    val triggerConfigJson: String,
    val status: String,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class WorkflowVersion(
    val id: UUID,
    val workflowId: UUID,
    val workspaceId: UUID,
    val version: Int,
    val definitionJson: String,
    val changeNotes: String?,
    val publishedAt: Instant?,
    val createdAt: Instant,
)

data class CreateWorkflowRequest(
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val slug: String,
    val description: String? = null,
    val triggerType: String = "manual",
    val triggerConfig: Map<String, Any> = emptyMap(),
    val status: String = "active",
)

data class CreateWorkflowVersionRequest(
    val workflowId: UUID,
    val workspaceId: UUID,
    val version: Int,
    val definition: Map<String, Any>,
    val changeNotes: String? = null,
    val publishedAt: Instant? = null,
)

class WorkflowRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(WorkflowRepository::class.java)

    private val cols = """
        id, workspace_id, environment_id, name, slug, description, current_version_id,
        trigger_type, trigger_config_json, status, created_at, updated_at
    """.trimIndent()

    private val versionCols = """
        id, workflow_id, workspace_id, version, definition_json, change_notes,
        published_at, created_at
    """.trimIndent()

    fun findById(id: UUID, workspaceId: UUID): Workflow? = queryOne(
        "SELECT $cols FROM workflows WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapRow,
    )

    fun findBySlug(slug: String, workspaceId: UUID): Workflow? = queryOne(
        "SELECT $cols FROM workflows WHERE slug = ? AND workspace_id = ?",
        { setString(1, slug); setUuid(2, workspaceId) },
        ::mapRow,
    )

    fun list(
        workspaceId: UUID,
        environmentId: UUID? = null,
        status: String? = null,
        params: PageParams = PageParams(),
    ): Page<Workflow> {
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
            sql = "SELECT $cols FROM workflows $where ORDER BY created_at DESC LIMIT ? OFFSET ?",
            countSql = "SELECT COUNT(*) FROM workflows $where",
            params = params,
            bind = {
                bindBase(this)
                setInt(filters.size + 1, params.limit)
                setInt(filters.size + 2, params.offset)
            },
            mapRow = ::mapRow,
        )
    }

    fun create(req: CreateWorkflowRequest): Workflow = executeReturning(
        """
        INSERT INTO workflows (
            workspace_id, environment_id, name, slug, description,
            trigger_type, trigger_config_json, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING $cols
        """.trimIndent(),
        {
            setUuid(1, req.workspaceId)
            setUuid(2, req.environmentId)
            setString(3, req.name)
            setString(4, req.slug)
            setString(5, req.description)
            setString(6, req.triggerType)
            setJsonb(7, req.triggerConfig)
            setString(8, req.status)
        },
        ::mapRow,
    )

    fun updateCurrentVersion(id: UUID, workspaceId: UUID, versionId: UUID): Workflow? = queryOne(
        """
        UPDATE workflows SET current_version_id = ?, updated_at = now()
        WHERE id = ? AND workspace_id = ?
        RETURNING $cols
        """.trimIndent(),
        { setUuid(1, versionId); setUuid(2, id); setUuid(3, workspaceId) },
        ::mapRow,
    )

    fun updateStatus(id: UUID, workspaceId: UUID, status: String): Workflow? = queryOne(
        "UPDATE workflows SET status = ?, updated_at = now() WHERE id = ? AND workspace_id = ? RETURNING $cols",
        { setString(1, status); setUuid(2, id); setUuid(3, workspaceId) },
        ::mapRow,
    )

    fun delete(id: UUID, workspaceId: UUID): Boolean =
        execute("DELETE FROM workflows WHERE id = ? AND workspace_id = ?") {
            setUuid(1, id); setUuid(2, workspaceId)
        } > 0

    // ── Workflow versions ─────────────────────────────────────────────────────

    fun createVersion(req: CreateWorkflowVersionRequest): WorkflowVersion = executeReturning(
        """
        INSERT INTO workflow_versions (
            workflow_id, workspace_id, version, definition_json, change_notes, published_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        RETURNING $versionCols
        """.trimIndent(),
        {
            setUuid(1, req.workflowId)
            setUuid(2, req.workspaceId)
            setInt(3, req.version)
            setJsonb(4, req.definition)
            setString(5, req.changeNotes)
            setInstantOrNull(6, req.publishedAt)
        },
        ::mapVersionRow,
    )

    fun findVersionById(id: UUID, workspaceId: UUID): WorkflowVersion? = queryOne(
        "SELECT $versionCols FROM workflow_versions WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapVersionRow,
    )

    fun listVersions(
        workflowId: UUID,
        workspaceId: UUID,
        params: PageParams = PageParams(),
    ): Page<WorkflowVersion> = queryPage(
        sql = """
            SELECT $versionCols FROM workflow_versions
            WHERE workflow_id = ? AND workspace_id = ?
            ORDER BY version DESC LIMIT ? OFFSET ?
        """.trimIndent(),
        countSql = "SELECT COUNT(*) FROM workflow_versions WHERE workflow_id = ? AND workspace_id = ?",
        params = params,
        bind = {
            setUuid(1, workflowId)
            setUuid(2, workspaceId)
            setInt(3, params.limit)
            setInt(4, params.offset)
        },
        mapRow = ::mapVersionRow,
    )

    private fun mapRow(rs: java.sql.ResultSet) = Workflow(
        id = rs.uuid("id"),
        workspaceId = rs.uuid("workspace_id"),
        environmentId = rs.uuid("environment_id"),
        name = rs.getString("name"),
        slug = rs.getString("slug"),
        description = rs.getString("description"),
        currentVersionId = rs.uuidOrNull("current_version_id"),
        triggerType = rs.getString("trigger_type"),
        triggerConfigJson = rs.getJsonbString("trigger_config_json"),
        status = rs.getString("status"),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
    )

    private fun mapVersionRow(rs: java.sql.ResultSet) = WorkflowVersion(
        id = rs.uuid("id"),
        workflowId = rs.uuid("workflow_id"),
        workspaceId = rs.uuid("workspace_id"),
        version = rs.getInt("version"),
        definitionJson = rs.getJsonbString("definition_json"),
        changeNotes = rs.getString("change_notes"),
        publishedAt = rs.instantOrNull("published_at"),
        createdAt = rs.instant("created_at"),
    )
}
