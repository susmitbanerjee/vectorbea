package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbString
import com.vectorbea.api.db.withConnection
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/** One imported API document. See V064. */
data class SpecImport(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val sourceKind: String,
    val sourceType: String,
    val sourceUrl: String?,
    val documentSha256: String,
    val documentBytes: Int,
    val title: String?,
    val specVersion: String?,
    val serversJson: String,
    val securitySchemesJson: String,
    val operationCount: Int,
    val connectionId: UUID?,
    val previousImportId: UUID?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

/** One operation in an import, whether or not it became a tool. */
data class SpecOperation(
    val id: UUID,
    val importId: UUID,
    val workspaceId: UUID,
    val operationKey: String,
    val method: String,
    val path: String,
    val summary: String?,
    val description: String?,
    val tags: List<String>,
    val deprecated: Boolean,
    val fingerprint: String,
    val httpSpecJson: String?,
    val inputSchemaJson: String?,
    val resultContractJson: String?,
    val toolId: UUID?,
)

data class CreateSpecImport(
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val sourceKind: String,
    val sourceType: String,
    val sourceUrl: String?,
    val documentJson: String,
    val documentSha256: String,
    val documentBytes: Int,
    val title: String?,
    val specVersion: String?,
    val serversJson: String,
    val securitySchemesJson: String,
    val operationCount: Int,
    val connectionId: UUID?,
    val previousImportId: UUID?,
    val createdBy: UUID?,
)

/**
 * Reads and writes imported API documents.
 *
 * ── THE DOCUMENT IS STORED WHOLE, AND THAT IS THE POINT ─────────────────────
 * A re-import produces a diff, and a diff needs both sides. Reconstructing the
 * old side from the tools it produced cannot work: a tool may have been edited
 * since, so "what changed in the spec" would come back as "what changed in the
 * spec, plus everything you did to the tool". Keeping the document makes the two
 * questions separable, which is what makes the review meaningful.
 *
 * ── EVERY QUERY IS WORKSPACE-SCOPED ─────────────────────────────────────────
 * Including the ones that already have a primary key to go on. An id is not an
 * authorisation, and the one place a `WHERE workspace_id = ?` is forgotten is
 * the place a cross-tenant read happens (invariant 8).
 */
class SpecImportRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(SpecImportRepository::class.java)

    private val cols = """
        id, workspace_id, environment_id, name, source_kind, source_type, source_url,
        document_sha256, document_bytes, title, spec_version, servers_json,
        security_schemes_json, operation_count, connection_id, previous_import_id,
        created_at, updated_at
    """.trimIndent()

    fun create(req: CreateSpecImport): SpecImport = executeReturning(
        """INSERT INTO api_spec_imports
             (workspace_id, environment_id, name, source_kind, source_type, source_url,
              document_json, document_sha256, document_bytes, title, spec_version,
              servers_json, security_schemes_json, operation_count, connection_id,
              previous_import_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, ?, ?)
           RETURNING $cols""",
        {
            setUuid(1, req.workspaceId)
            setUuid(2, req.environmentId)
            setString(3, req.name)
            setString(4, req.sourceKind)
            setString(5, req.sourceType)
            setString(6, req.sourceUrl)
            setString(7, req.documentJson)
            setString(8, req.documentSha256)
            setInt(9, req.documentBytes)
            setString(10, req.title)
            setString(11, req.specVersion)
            setString(12, req.serversJson)
            setString(13, req.securitySchemesJson)
            setInt(14, req.operationCount)
            setUuidOrNull(15, req.connectionId)
            setUuidOrNull(16, req.previousImportId)
            setUuidOrNull(17, req.createdBy)
        },
        ::mapImport,
    )

    fun findById(id: UUID, workspaceId: UUID): SpecImport? = queryOne(
        "SELECT $cols FROM api_spec_imports WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapImport,
    )

    /**
     * The stored document, as JSON text.
     *
     * Separate from [findById] because it is megabytes and almost nothing wants
     * it: the list screen, the operation table and the diff summary all read the
     * denormalised columns. Loading 12 MB to render a row would be the reason the
     * imports page is slow.
     */
    fun documentOf(id: UUID, workspaceId: UUID): String? = queryOne(
        "SELECT document_json FROM api_spec_imports WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        { rs -> rs.getJsonbString("document_json") },
    )

    fun list(workspaceId: UUID, environmentId: UUID?, params: PageParams): Page<SpecImport> {
        val where = if (environmentId != null) "workspace_id = ? AND environment_id = ?"
        else "workspace_id = ?"
        val bind: java.sql.PreparedStatement.() -> Unit = {
            setUuid(1, workspaceId)
            if (environmentId != null) setUuid(2, environmentId)
        }
        return queryPage(
            "SELECT $cols FROM api_spec_imports WHERE $where ORDER BY created_at DESC",
            "SELECT count(*) FROM api_spec_imports WHERE $where",
            params, bind, ::mapImport,
        )
    }

    /**
     * The most recent import for the same API, for diffing against.
     *
     * Matched on the SOURCE URL when there is one, else on the document's title.
     * Neither is perfect — a vendor can move a URL, and two APIs can share a
     * title — so the caller may also pass an explicit previous import, and the UI
     * offers the choice. What this gets right is the common case: somebody
     * pasting the same URL again six months later.
     */
    fun findPrevious(
        workspaceId: UUID,
        sourceUrl: String?,
        title: String?,
        excludingId: UUID?,
    ): SpecImport? {
        if (sourceUrl == null && title == null) return null
        val clause = if (sourceUrl != null) "source_url = ?" else "title = ?"
        return queryOne(
            """SELECT $cols FROM api_spec_imports
               WHERE workspace_id = ? AND $clause AND (? IS NULL OR id <> ?)
               ORDER BY created_at DESC LIMIT 1""",
            {
                setUuid(1, workspaceId)
                setString(2, sourceUrl ?: title)
                setUuidOrNull(3, excludingId)
                setUuidOrNull(4, excludingId)
            },
            ::mapImport,
        )
    }

    fun attachConnection(id: UUID, workspaceId: UUID, connectionId: UUID?): Int = execute(
        "UPDATE api_spec_imports SET connection_id = ?, updated_at = now() WHERE id = ? AND workspace_id = ?",
        { setUuidOrNull(1, connectionId); setUuid(2, id); setUuid(3, workspaceId) },
    )

    // ── Operations ───────────────────────────────────────────────────────────

    private val opCols = """
        id, import_id, workspace_id, operation_key, method, path, summary, description,
        tags, deprecated, fingerprint, http_spec_json, input_schema_json,
        result_contract_json, tool_id
    """.trimIndent()

    /**
     * Insert every operation of an import in one batch.
     *
     * A batch rather than a loop because GitHub's document has nine hundred of
     * them, and nine hundred round trips inside one request is the difference
     * between an import that feels instant and one that times out.
     */
    fun insertOperations(importId: UUID, workspaceId: UUID, operations: List<SpecOperationDraft>) {
        if (operations.isEmpty()) return
        dataSource.withConnection { conn ->
            conn.prepareStatement(
                """INSERT INTO api_spec_operations
                     (import_id, workspace_id, operation_key, method, path, summary,
                      description, tags, deprecated, fingerprint, http_spec_json,
                      input_schema_json, result_contract_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?::jsonb)
                   ON CONFLICT (import_id, operation_key) DO NOTHING"""
            ).use { stmt ->
                for (op in operations) {
                    stmt.setObject(1, importId)
                    stmt.setObject(2, workspaceId)
                    stmt.setString(3, op.operationKey)
                    stmt.setString(4, op.method)
                    stmt.setString(5, op.path)
                    stmt.setString(6, op.summary)
                    stmt.setString(7, op.description)
                    stmt.setArray(8, conn.createArrayOf("text", op.tags.toTypedArray()))
                    stmt.setBoolean(9, op.deprecated)
                    stmt.setString(10, op.fingerprint)
                    stmt.setString(11, op.httpSpecJson)
                    stmt.setString(12, op.inputSchemaJson)
                    stmt.setString(13, op.resultContractJson)
                    stmt.addBatch()
                }
                stmt.executeBatch()
            }
        }
    }

    fun operations(importId: UUID, workspaceId: UUID): List<SpecOperation> = query(
        """SELECT $opCols FROM api_spec_operations
           WHERE import_id = ? AND workspace_id = ? ORDER BY created_at, path, method""",
        { setUuid(1, importId); setUuid(2, workspaceId) },
        ::mapOperation,
    )

    fun operation(importId: UUID, workspaceId: UUID, key: String): SpecOperation? = queryOne(
        "SELECT $opCols FROM api_spec_operations WHERE import_id = ? AND workspace_id = ? AND operation_key = ?",
        { setUuid(1, importId); setUuid(2, workspaceId); setString(3, key) },
        ::mapOperation,
    )

    fun linkTool(importId: UUID, workspaceId: UUID, operationKey: String, toolId: UUID): Int = execute(
        """UPDATE api_spec_operations SET tool_id = ?
           WHERE import_id = ? AND workspace_id = ? AND operation_key = ?""",
        { setUuid(1, toolId); setUuid(2, importId); setUuid(3, workspaceId); setString(4, operationKey) },
    )

    /**
     * The previous import's operations, joined to whether an agent holds the tool.
     *
     * The grant check is in SQL rather than a second query per operation: the
     * diff screen shows it for every changed row, and nine hundred round trips
     * to answer "is this granted" is the same mistake as inserting one at a time.
     */
    fun previousForDiff(importId: UUID, workspaceId: UUID): List<PreviousOperationRow> = query(
        """SELECT o.operation_key, o.fingerprint, o.method, o.path, o.summary,
                  o.tool_id, o.http_spec_json,
                  EXISTS (
                      SELECT 1 FROM agents a
                       WHERE a.workspace_id = o.workspace_id
                         AND o.tool_id IS NOT NULL
                         AND o.tool_id::text = ANY (a.allowed_tool_ids)
                  ) AS is_granted
             FROM api_spec_operations o
            WHERE o.import_id = ? AND o.workspace_id = ?""",
        { setUuid(1, importId); setUuid(2, workspaceId) },
        { rs ->
            PreviousOperationRow(
                operationKey = rs.getString("operation_key"),
                fingerprint = rs.getString("fingerprint"),
                method = rs.getString("method"),
                path = rs.getString("path"),
                summary = rs.getString("summary"),
                toolId = rs.getString("tool_id")?.let(UUID::fromString),
                isGranted = rs.getBoolean("is_granted"),
                httpSpecJson = rs.getJsonbString("http_spec_json"),
            )
        },
    )

    // ── Mapping ──────────────────────────────────────────────────────────────

    private fun mapImport(rs: java.sql.ResultSet) = SpecImport(
        id = UUID.fromString(rs.getString("id")),
        workspaceId = UUID.fromString(rs.getString("workspace_id")),
        environmentId = UUID.fromString(rs.getString("environment_id")),
        name = rs.getString("name"),
        sourceKind = rs.getString("source_kind"),
        sourceType = rs.getString("source_type"),
        sourceUrl = rs.getString("source_url"),
        documentSha256 = rs.getString("document_sha256"),
        documentBytes = rs.getInt("document_bytes"),
        title = rs.getString("title"),
        specVersion = rs.getString("spec_version"),
        serversJson = rs.getJsonbString("servers_json") ?: "[]",
        securitySchemesJson = rs.getJsonbString("security_schemes_json") ?: "{}",
        operationCount = rs.getInt("operation_count"),
        connectionId = rs.getString("connection_id")?.let(UUID::fromString),
        previousImportId = rs.getString("previous_import_id")?.let(UUID::fromString),
        createdAt = rs.getTimestamp("created_at").toInstant(),
        updatedAt = rs.getTimestamp("updated_at").toInstant(),
    )

    private fun mapOperation(rs: java.sql.ResultSet) = SpecOperation(
        id = UUID.fromString(rs.getString("id")),
        importId = UUID.fromString(rs.getString("import_id")),
        workspaceId = UUID.fromString(rs.getString("workspace_id")),
        operationKey = rs.getString("operation_key"),
        method = rs.getString("method"),
        path = rs.getString("path"),
        summary = rs.getString("summary"),
        description = rs.getString("description"),
        tags = (rs.getArray("tags")?.array as? Array<*>)?.mapNotNull { it?.toString() } ?: emptyList(),
        deprecated = rs.getBoolean("deprecated"),
        fingerprint = rs.getString("fingerprint"),
        httpSpecJson = rs.getJsonbString("http_spec_json"),
        inputSchemaJson = rs.getJsonbString("input_schema_json"),
        resultContractJson = rs.getJsonbString("result_contract_json"),
        toolId = rs.getString("tool_id")?.let(UUID::fromString),
    )
}

/** An operation about to be written. */
data class SpecOperationDraft(
    val operationKey: String,
    val method: String,
    val path: String,
    val summary: String?,
    val description: String?,
    val tags: List<String>,
    val deprecated: Boolean,
    val fingerprint: String,
    val httpSpecJson: String?,
    val inputSchemaJson: String?,
    val resultContractJson: String?,
)

/** A previous operation plus whether its tool is granted. Feeds `SpecDiff`. */
data class PreviousOperationRow(
    val operationKey: String,
    val fingerprint: String,
    val method: String,
    val path: String,
    val summary: String?,
    val toolId: UUID?,
    val isGranted: Boolean,
    val httpSpecJson: String?,
)
