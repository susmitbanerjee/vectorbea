package com.vectorbea.api.repository

import com.vectorbea.api.db.JSONB_EMPTY_ARRAY
import com.vectorbea.api.db.JSONB_EMPTY_OBJECT
import com.vectorbea.api.db.getJsonbString
import com.vectorbea.api.db.getJsonbStringOrNull
import com.vectorbea.api.db.setJsonb
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class Connection(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val slug: String,
    val type: String,
    val provider: String,
    val status: String,
    val networkStatus: String,
    val authType: String,
    /** Secret ref — never expose to clients; included here for server-side resolution only */
    val secretRef: String?,
    val configJson: String,          // raw JSON string; never contains credentials
    val allowedHosts: String,
    val allowedPaths: String,
    val allowedSchemas: String,
    val allowedTables: String,
    val lastTestedAt: Instant?,
    val lastTestStatus: String?,
    val lastTestLatencyMs: Int?,
    val lastTestErrorCode: String?,
    val lastTestErrorMessageSanitized: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class CreateConnectionRequest(
    val workspaceId: UUID,
    val environmentId: UUID,
    val name: String,
    val slug: String,
    val type: String,
    val provider: String,
    val authType: String,
    val secretRef: String? = null,
    val configJson: Map<String, Any> = emptyMap(),
    val allowedHosts: List<String> = emptyList(),
    val allowedPaths: List<String> = emptyList(),
    val allowedSchemas: List<String> = emptyList(),
    val allowedTables: List<String> = emptyList(),
)

class ConnectionRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(ConnectionRepository::class.java)

    private val cols = """
        id, workspace_id, environment_id, name, slug, type, provider, status, network_status,
        auth_type, secret_ref, config_json, allowed_hosts, allowed_paths, allowed_schemas,
        allowed_tables, last_tested_at, last_test_status, last_test_latency_ms,
        last_test_error_code, last_test_error_message_sanitized, created_at, updated_at
    """.trimIndent()

    fun findById(id: UUID, workspaceId: UUID): Connection? = queryOne(
        "SELECT $cols FROM connections WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapRow,
    )

    fun list(
        workspaceId: UUID,
        environmentId: UUID? = null,
        type: String? = null,
        status: String? = null,
        params: PageParams = PageParams(),
    ): Page<Connection> {
        // Build WHERE clauses dynamically — using a fixed list of optional filters
        // Parameterized — no user input concatenated into the SQL string
        val filters = buildList {
            add("workspace_id = ?")
            if (environmentId != null) add("environment_id = ?")
            if (type != null) add("type = ?")
            if (status != null) add("status = ?")
        }
        val where = "WHERE ${filters.joinToString(" AND ")}"
        val bindParams: (java.sql.PreparedStatement) -> Unit = {
            var idx = 1
            it.setUuid(idx++, workspaceId)
            if (environmentId != null) it.setUuid(idx++, environmentId)
            if (type != null) it.setString(idx++, type)
            if (status != null) it.setString(idx++, status)
        }

        return queryPage(
            sql = """
                SELECT $cols FROM connections $where
                ORDER BY created_at DESC LIMIT ? OFFSET ?
            """.trimIndent(),
            countSql = "SELECT COUNT(*) FROM connections $where",
            params = params,
            bind = {
                bindParams(this)
                setInt(filters.size + 1, params.limit)
                setInt(filters.size + 2, params.offset)
            },
            mapRow = ::mapRow,
        )
    }

    fun create(req: CreateConnectionRequest): Connection = executeReturning(
        """
        INSERT INTO connections (
            workspace_id, environment_id, name, slug, type, provider, auth_type,
            secret_ref, config_json, allowed_hosts, allowed_paths, allowed_schemas, allowed_tables
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING $cols
        """.trimIndent(),
        {
            setUuid(1, req.workspaceId)
            setUuid(2, req.environmentId)
            setString(3, req.name)
            setString(4, req.slug)
            setString(5, req.type)
            setString(6, req.provider)
            setString(7, req.authType)
            setString(8, req.secretRef)
            setJsonb(9, req.configJson)
            setJsonb(10, req.allowedHosts)
            setJsonb(11, req.allowedPaths)
            setJsonb(12, req.allowedSchemas)
            setJsonb(13, req.allowedTables)
        },
        ::mapRow,
    )

    fun updateStatus(
        id: UUID,
        workspaceId: UUID,
        status: String,
        networkStatus: String,
        lastTestedAt: Instant,
        latencyMs: Int?,
        errorCode: String?,
        errorMessage: String?,
    ): Connection? = queryOne(
        """
        UPDATE connections SET
            status = ?, network_status = ?, last_tested_at = ?, last_test_status = ?,
            last_test_latency_ms = ?, last_test_error_code = ?,
            last_test_error_message_sanitized = ?, updated_at = now()
        WHERE id = ? AND workspace_id = ?
        RETURNING $cols
        """.trimIndent(),
        {
            setString(1, status)
            setString(2, networkStatus)
            setInstant(3, lastTestedAt)
            setString(4, status)
            if (latencyMs != null) setInt(5, latencyMs) else setNull(5, java.sql.Types.INTEGER)
            setString(6, errorCode)
            setString(7, errorMessage)
            setUuid(8, id)
            setUuid(9, workspaceId)
        },
        ::mapRow,
    )

    fun delete(id: UUID, workspaceId: UUID): Boolean =
        execute("DELETE FROM connections WHERE id = ? AND workspace_id = ?") {
            setUuid(1, id); setUuid(2, workspaceId)
        } > 0

    private fun mapRow(rs: java.sql.ResultSet) = Connection(
        id = rs.uuid("id"),
        workspaceId = rs.uuid("workspace_id"),
        environmentId = rs.uuid("environment_id"),
        name = rs.getString("name"),
        slug = rs.getString("slug"),
        type = rs.getString("type"),
        provider = rs.getString("provider"),
        status = rs.getString("status"),
        networkStatus = rs.getString("network_status"),
        authType = rs.getString("auth_type"),
        secretRef = rs.getString("secret_ref"),
        configJson = rs.getJsonbString("config_json"),
        allowedHosts = rs.getJsonbString("allowed_hosts"),
        allowedPaths = rs.getJsonbString("allowed_paths"),
        allowedSchemas = rs.getJsonbString("allowed_schemas"),
        allowedTables = rs.getJsonbString("allowed_tables"),
        lastTestedAt = rs.instantOrNull("last_tested_at"),
        lastTestStatus = rs.getString("last_test_status"),
        lastTestLatencyMs = rs.getObject("last_test_latency_ms") as? Int,
        lastTestErrorCode = rs.getString("last_test_error_code"),
        lastTestErrorMessageSanitized = rs.getString("last_test_error_message_sanitized"),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
    )
}
