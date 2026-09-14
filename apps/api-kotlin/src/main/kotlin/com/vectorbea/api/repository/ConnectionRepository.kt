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
    /**
     * How far this connection may reach: `public` or `private_allowed`.
     *
     * Meaningless without [allowedHosts], and the schema refuses the
     * combination — see V071. The two are one decision.
     */
    val egressPolicy: String = "public",
    /**
     * The wire shape, when it differs from what [provider] implies.
     *
     * Null for every connection that points at the vendor whose name it
     * carries, which is all of them until a customer runs their own gateway.
     */
    val protocol: String? = null,
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

open class ConnectionRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(ConnectionRepository::class.java)

    private val cols = """
        id, workspace_id, environment_id, name, slug, type, provider, status, network_status,
        auth_type, secret_ref, config_json, allowed_hosts, allowed_paths, allowed_schemas,
        allowed_tables,
        COALESCE(egress_policy, 'public') AS egress_policy, protocol,
        last_tested_at, last_test_status, last_test_latency_ms,
        last_test_error_code, last_test_error_message_sanitized, created_at, updated_at
    """.trimIndent()

    open fun findById(id: UUID, workspaceId: UUID): Connection? = queryOne(
        "SELECT $cols FROM connections WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapRow,
    )

    open fun list(
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
            sql = "SELECT $cols FROM connections $where ORDER BY created_at DESC",
            countSql = "SELECT COUNT(*) FROM connections $where",
            params = params,
            bind = { bindParams(this) },
            mapRow = ::mapRow,
        )
    }

    open fun create(req: CreateConnectionRequest): Connection = executeReturning(
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

    open fun update(
        id: UUID,
        workspaceId: UUID,
        name: String? = null,
        configJson: Map<String, Any>? = null,
        allowedHosts: List<String>? = null,
        allowedPaths: List<String>? = null,
        allowedSchemas: List<String>? = null,
        allowedTables: List<String>? = null,
        status: String? = null,
        /** Opaque secret ref — stored as-is, never the plaintext */
        secretRef: String? = null,
        /**
         * `public` | `private_allowed`. Widens what this connection may reach.
         *
         * Takes the person who set it, because this is the one setting that lets
         * the platform talk to a customer's internal network, and "who decided
         * that, and when" is a question a security review asks and an incident
         * asks louder.
         */
        egressPolicy: String? = null,
        egressPolicySetBy: UUID? = null,
        /** `openai` | `anthropic` | `gemini`, when it differs from the provider. */
        protocol: String? = null,
        /**
         * How the credential is presented. Changes when an MCP server that was
         * saved unauthenticated is signed in to, which is the only time a
         * connection's auth type moves after creation.
         */
        authType: String? = null,
    ): Connection? {
        val setClauses = buildList {
            if (name != null) add("name = ?")
            if (configJson != null) add("config_json = ?")
            if (allowedHosts != null) add("allowed_hosts = ?")
            if (allowedPaths != null) add("allowed_paths = ?")
            if (allowedSchemas != null) add("allowed_schemas = ?")
            if (allowedTables != null) add("allowed_tables = ?")
            if (status != null) add("status = ?")
            if (secretRef != null) add("secret_ref = ?")
            if (egressPolicy != null) {
                add("egress_policy = ?")
                /* Stamped in the same UPDATE, so there is no window where the
                   policy is on and nobody owns it. */
                add("egress_policy_set_by_user_id = ?")
                add("egress_policy_set_at = now()")
            }
            if (protocol != null) add("protocol = ?")
            if (authType != null) add("auth_type = ?")
            add("updated_at = now()")
        }
        if (setClauses.size == 1) return findById(id, workspaceId)
        return queryOne(
            "UPDATE connections SET ${setClauses.joinToString(", ")} WHERE id = ? AND workspace_id = ? RETURNING $cols",
            {
                var i = 1
                if (name != null) setString(i++, name)
                if (configJson != null) setJsonb(i++, configJson)
                if (allowedHosts != null) setJsonb(i++, allowedHosts)
                if (allowedPaths != null) setJsonb(i++, allowedPaths)
                if (allowedSchemas != null) setJsonb(i++, allowedSchemas)
                if (allowedTables != null) setJsonb(i++, allowedTables)
                if (status != null) setString(i++, status)
                if (secretRef != null) setString(i++, secretRef)
                if (egressPolicy != null) {
                    setString(i++, egressPolicy)
                    setUuidOrNull(i++, egressPolicySetBy)
                }
                if (protocol != null) setString(i++, protocol)
                if (authType != null) setString(i++, authType)
                setUuid(i++, id)
                setUuid(i, workspaceId)
            },
            ::mapRow,
        )
    }

    /**
     * Update last-test result fields after a connection test.
     * [errorMessage] is expected to be already sanitized (no secrets).
     */
    open fun updateStatus(
        id: UUID,
        workspaceId: UUID,
        status: String,
        networkStatus: String,
        lastTestedAt: java.time.Instant,
        latencyMs: Int?,
        errorCode: String?,
        errorMessage: String?,
        /** Value stored in last_test_status — defaults to "ok"/"failed" vocabulary for the frontend */
        testStatus: String = if (status == "connected") "ok" else "failed",
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
            setString(4, testStatus)
            if (latencyMs != null) setInt(5, latencyMs) else setNull(5, java.sql.Types.INTEGER)
            setString(6, errorCode)
            setString(7, errorMessage)
            setUuid(8, id)
            setUuid(9, workspaceId)
        },
        ::mapRow,
    )

    open fun delete(id: UUID, workspaceId: UUID): Boolean =
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
        egressPolicy = rs.getString("egress_policy") ?: "public",
        protocol = rs.getString("protocol"),
        lastTestedAt = rs.instantOrNull("last_tested_at"),
        lastTestStatus = rs.getString("last_test_status"),
        lastTestLatencyMs = rs.getObject("last_test_latency_ms") as? Int,
        lastTestErrorCode = rs.getString("last_test_error_code"),
        lastTestErrorMessageSanitized = rs.getString("last_test_error_message_sanitized"),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
    )
}
