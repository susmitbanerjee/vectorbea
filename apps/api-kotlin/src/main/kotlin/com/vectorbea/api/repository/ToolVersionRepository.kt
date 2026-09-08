package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbString
import com.vectorbea.api.db.withConnection
import org.slf4j.LoggerFactory
import java.sql.PreparedStatement
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/** An immutable snapshot of a tool's definition. See V064. */
data class ToolVersion(
    val id: UUID,
    val toolId: UUID,
    val workspaceId: UUID,
    val version: Int,
    val name: String,
    val description: String?,
    val connectionId: UUID?,
    val inputSchemaJson: String,
    val outputSchemaJson: String,
    val configJson: String,
    val httpSpecJson: String?,
    val resultContractJson: String?,
    val riskLevel: String,
    val requiresApproval: Boolean,
    val timeoutMs: Int?,
    val reviewState: String,
    val source: String,
    val specImportId: UUID?,
    val changeSummary: String?,
    val changeJson: String?,
    val createdAt: Instant,
    val appliedAt: Instant?,
)

data class CreateToolVersion(
    val toolId: UUID,
    val workspaceId: UUID,
    val name: String,
    val description: String?,
    val connectionId: UUID?,
    val inputSchemaJson: String,
    val outputSchemaJson: String = "{}",
    val configJson: String = "{}",
    val httpSpecJson: String?,
    val resultContractJson: String?,
    val riskLevel: String,
    val requiresApproval: Boolean,
    val timeoutMs: Int?,
    val reviewState: String,
    val source: String,
    val specImportId: UUID?,
    val changeSummary: String?,
    val changeJson: String?,
    val createdBy: UUID?,
)

/**
 * Tool versions, and the one operation that changes what an agent can do.
 *
 * ── WHY APPLYING IS A METHOD HERE AND NOT AN UPDATE IN A ROUTE ──────────────
 * [apply] copies a snapshot onto `tools` and bumps `current_version` in ONE
 * transaction. Split across two statements, a failure between them leaves a tool
 * whose behaviour is version 7 and whose `current_version` says 6 — and every
 * later diff would then compare against the wrong side, silently.
 *
 * It is also the only writer of `tools.http_spec_json` outside the tool editor,
 * which is what makes the guarantee in V064 checkable: a re-import cannot change
 * a granted tool, because a re-import never calls this.
 */
class ToolVersionRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(ToolVersionRepository::class.java)

    private val cols = """
        id, tool_id, workspace_id, version, name, description, connection_id,
        input_schema_json, output_schema_json, config_json, http_spec_json,
        result_contract_json, risk_level, requires_approval, timeout_ms,
        review_state, source, spec_import_id, change_summary, change_json,
        created_at, applied_at
    """.trimIndent()

    /**
     * Write a new version.
     *
     * The version NUMBER is allocated inside the insert, from the tool's own
     * maximum, so two concurrent imports cannot both claim version 4 — the unique
     * constraint would reject the second, and a subquery makes it retry-able
     * rather than requiring the caller to hold a lock.
     */
    fun create(req: CreateToolVersion): ToolVersion = executeReturning(
        """INSERT INTO tool_versions
             (tool_id, workspace_id, version, name, description, connection_id,
              input_schema_json, output_schema_json, config_json, http_spec_json,
              result_contract_json, risk_level, requires_approval, timeout_ms,
              review_state, source, spec_import_id, change_summary, change_json, created_by)
           VALUES (?, ?,
                   (SELECT COALESCE(MAX(version), 0) + 1 FROM tool_versions WHERE tool_id = ?),
                   ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb,
                   ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?)
           RETURNING $cols""",
        {
            setObject(1, req.toolId)
            setObject(2, req.workspaceId)
            setObject(3, req.toolId)
            setString(4, req.name)
            setString(5, req.description)
            setUuidOrNull(6, req.connectionId)
            setString(7, req.inputSchemaJson)
            setString(8, req.outputSchemaJson)
            setString(9, req.configJson)
            setString(10, req.httpSpecJson)
            setString(11, req.resultContractJson)
            setString(12, req.riskLevel)
            setBoolean(13, req.requiresApproval)
            if (req.timeoutMs == null) setNull(14, java.sql.Types.INTEGER)
            else setInt(14, req.timeoutMs)
            setString(15, req.reviewState)
            setString(16, req.source)
            setUuidOrNull(17, req.specImportId)
            setString(18, req.changeSummary)
            setString(19, req.changeJson)
            setUuidOrNull(20, req.createdBy)
        },
        ::mapRow,
    )

    fun listForTool(toolId: UUID, workspaceId: UUID): List<ToolVersion> = query(
        "SELECT $cols FROM tool_versions WHERE tool_id = ? AND workspace_id = ? ORDER BY version DESC",
        { setObject(1, toolId); setObject(2, workspaceId) },
        ::mapRow,
    )

    fun findById(id: UUID, workspaceId: UUID): ToolVersion? = queryOne(
        "SELECT $cols FROM tool_versions WHERE id = ? AND workspace_id = ?",
        { setObject(1, id); setObject(2, workspaceId) },
        ::mapRow,
    )

    /** Everything awaiting review, with whether an agent holds the tool. */
    fun pendingReview(workspaceId: UUID): List<PendingReview> = query(
        """SELECT version_id, tool_id, tool_name, version, change_summary, source,
                  spec_import_id, created_at, is_granted
             FROM tool_versions_pending_review
            WHERE workspace_id = ?
            ORDER BY is_granted DESC, created_at DESC""",
        { setObject(1, workspaceId) },
        { rs ->
            PendingReview(
                versionId = UUID.fromString(rs.getString("version_id")),
                toolId = UUID.fromString(rs.getString("tool_id")),
                toolName = rs.getString("tool_name"),
                version = rs.getInt("version"),
                changeSummary = rs.getString("change_summary"),
                source = rs.getString("source"),
                specImportId = rs.getString("spec_import_id")?.let(UUID::fromString),
                createdAt = rs.getTimestamp("created_at").toInstant(),
                isGranted = rs.getBoolean("is_granted"),
            )
        },
    )

    /**
     * Make a pending version live.
     *
     * ── ONE TRANSACTION, AND A GUARD ON THE STATE ───────────────────────────
     * The `review_state = 'pending'` predicate in the UPDATE is what makes this
     * safe to call twice: the second call updates zero rows and returns false,
     * rather than re-applying a version that was already applied and superseded.
     * Two people clicking Apply on the same review is not hypothetical.
     */
    fun apply(versionId: UUID, workspaceId: UUID, appliedBy: UUID?): Boolean =
        dataSource.withConnection { conn ->
            conn.autoCommit = false
            try {
                val claimed = conn.prepareStatement(
                    """UPDATE tool_versions
                          SET review_state = 'applied', applied_at = now(), applied_by = ?
                        WHERE id = ? AND workspace_id = ? AND review_state = 'pending'
                        RETURNING tool_id, version"""
                ).use { stmt ->
                    stmt.setUuidOrNull(1, appliedBy)
                    stmt.setObject(2, versionId)
                    stmt.setObject(3, workspaceId)
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) UUID.fromString(rs.getString("tool_id")) to rs.getInt("version")
                        else null
                    }
                } ?: run { conn.rollback(); return@withConnection false }

                val (toolId, version) = claimed

                /*
                 * The snapshot becomes the tool. Every column the version carries
                 * is copied — an apply that updated only the spec would leave a
                 * tool whose input schema described the previous version's
                 * arguments, which is a model calling with parameters the request
                 * assembler will refuse.
                 */
                conn.prepareStatement(
                    """UPDATE tools t
                          SET name                 = v.name,
                              description          = v.description,
                              connection_id        = v.connection_id,
                              input_schema_json    = v.input_schema_json,
                              output_schema_json   = v.output_schema_json,
                              config_json          = v.config_json,
                              http_spec_json       = v.http_spec_json,
                              result_contract_json = v.result_contract_json,
                              risk_level           = v.risk_level,
                              requires_approval    = v.requires_approval,
                              timeout_ms           = v.timeout_ms,
                              current_version      = v.version,
                              updated_at           = now()
                         FROM tool_versions v
                        WHERE v.id = ? AND t.id = ? AND t.workspace_id = ?"""
                ).use { stmt ->
                    stmt.setObject(1, versionId)
                    stmt.setObject(2, toolId)
                    stmt.setObject(3, workspaceId)
                    stmt.executeUpdate()
                }

                /* Any OTHER pending version of the same tool is now stale: it was
                   computed against a definition that no longer exists. Left
                   pending it would apply a diff on top of a different base. */
                conn.prepareStatement(
                    """UPDATE tool_versions
                          SET review_state = 'rejected',
                              change_summary = COALESCE(change_summary, '') ||
                                  ' (superseded by version ' || ? || ')'
                        WHERE tool_id = ? AND workspace_id = ?
                          AND review_state = 'pending' AND id <> ?"""
                ).use { stmt ->
                    stmt.setInt(1, version)
                    stmt.setObject(2, toolId)
                    stmt.setObject(3, workspaceId)
                    stmt.setObject(4, versionId)
                    stmt.executeUpdate()
                }

                conn.commit()
                true
            } catch (e: Exception) {
                conn.rollback()
                throw e
            } finally {
                conn.autoCommit = true
            }
        }

    fun reject(versionId: UUID, workspaceId: UUID): Boolean = execute(
        """UPDATE tool_versions SET review_state = 'rejected'
           WHERE id = ? AND workspace_id = ? AND review_state = 'pending'""",
        { setObject(1, versionId); setObject(2, workspaceId) },
    ) > 0

    private fun mapRow(rs: java.sql.ResultSet) = ToolVersion(
        id = UUID.fromString(rs.getString("id")),
        toolId = UUID.fromString(rs.getString("tool_id")),
        workspaceId = UUID.fromString(rs.getString("workspace_id")),
        version = rs.getInt("version"),
        name = rs.getString("name"),
        description = rs.getString("description"),
        connectionId = rs.getString("connection_id")?.let(UUID::fromString),
        inputSchemaJson = rs.getJsonbString("input_schema_json") ?: "{}",
        outputSchemaJson = rs.getJsonbString("output_schema_json") ?: "{}",
        configJson = rs.getJsonbString("config_json") ?: "{}",
        httpSpecJson = rs.getJsonbString("http_spec_json"),
        resultContractJson = rs.getJsonbString("result_contract_json"),
        riskLevel = rs.getString("risk_level"),
        requiresApproval = rs.getBoolean("requires_approval"),
        timeoutMs = rs.getObject("timeout_ms")?.let { (it as Number).toInt() },
        reviewState = rs.getString("review_state"),
        source = rs.getString("source"),
        specImportId = rs.getString("spec_import_id")?.let(UUID::fromString),
        changeSummary = rs.getString("change_summary"),
        changeJson = rs.getJsonbString("change_json"),
        createdAt = rs.getTimestamp("created_at").toInstant(),
        appliedAt = rs.getTimestamp("applied_at")?.toInstant(),
    )
}

data class PendingReview(
    val versionId: UUID,
    val toolId: UUID,
    val toolName: String,
    val version: Int,
    val changeSummary: String?,
    val source: String,
    val specImportId: UUID?,
    val createdAt: Instant,
    /** True when an agent currently holds this tool. A review, not a chore. */
    val isGranted: Boolean,
)
