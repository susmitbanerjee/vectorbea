package com.vectorbea.worker.connector

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * Loads connection metadata from the `connections` table and resolves the
 * associated secret via [SecretService].
 *
 * Workflow for each connector executor:
 *   1. [resolve] → loads record + decrypts secret
 *   2. Executor validates type / status compatibility
 *   3. Executor uses the resolved connection for the actual I/O call
 *   4. [SecretValue] is discarded (GC'd) immediately after use
 *
 * SECURITY:
 *  - [secretRef] from the DB is NEVER returned to callers.
 *  - The resolved [SecretValue] must be used immediately and not stored.
 *  - Connection status is checked — inactive / errored connections are rejected.
 */
open class ConnectionResolver(
    private val dataSource: DataSource,
    private val secretService: SecretService,
) {
    private val log    = logger()
    private val untestedWarned = java.util.concurrent.ConcurrentHashMap.newKeySet<Any>()
    private val mapper = jacksonObjectMapper()

    /**
     * The secret service this resolver decrypts with, for executors built from it.
     *
     * Exposed so the agent brain's tool executor is wired with the SAME secrets a
     * workflow `tool` node gets. It was built without one, so an agent calling a
     * tool that needs to read or seal a credential — a signed-in MCP server's
     * refresh, a spec-driven HTTP tool's named secret fields — took a degraded
     * path the identical workflow step never did.
     */
    val secrets: SecretService get() = secretService

    /**
     * Load and return a [ResolvedConnection] for the given [connectionId] scoped
     * to [workspaceId].
     *
     * @param expectedType  expected connection type ("llm", "http", "database", …).
     *                      Pass null to skip type check.
     * @throws [ConnectionException] if the connection is not found, not active, or wrong type.
     */
    open fun resolve(
        connectionId: UUID,
        workspaceId: UUID,
        expectedType: String? = null,
    ): ResolvedConnection {
        val record = loadRecord(connectionId, workspaceId)
            ?: throw ConnectionException("Connection $connectionId not found for workspace $workspaceId")

        log.debug("[conn] resolved [id={}, type={}, provider={}, status={}]",
            connectionId, record.type, record.provider, record.status)

        // Validate status.
        // "active"     → tested and confirmed working — always allowed.
        // "not_tested" → newly created, never tested — allowed with a warning;
        //                the real connectivity error will surface during I/O.
        // "inactive"   → explicitly disabled by the user — reject.
        // "error"      → last test failed — reject to surface the problem early.
        when (record.status) {
            // All usable statuses — "connected" is what the UI/API sets after a
            // successful test; "active" is the legacy value; "not_tested" means
            // the user skipped the test step (proceed with a warning).
            "active", "connected", "ok" -> { /* OK */ }
            /* Once per connection per process: it was logged on every model call,
               so one agent run printed it a dozen times and buried real errors. */
            "not_tested" -> if (untestedWarned.add(record.id)) log.warn(
                "[conn] connection '{}' ({}) has not been tested — proceeding anyway",
                record.name, record.id
            )
            else -> throw ConnectionException(
                "Connection '${record.name}' (${record.id}) cannot be used — status: ${record.status}. " +
                "Check the connection in your workspace settings."
            )
        }

        // Validate type compatibility
        if (expectedType != null && !isTypeCompatible(record.type, expectedType)) {
            throw ConnectionException(
                "Connection '${record.name}' has type '${record.type}', expected '$expectedType'"
            )
        }

        // Resolve secret — scoped to the connection's workspace to prevent cross-tenant leakage
        val secret = try {
            secretService.resolve(record.secretRef, record.workspaceId)
        } catch (e: SecretException) {
            throw ConnectionException("Secret resolution failed for connection '${record.name}': ${e.message}")
        }

        return ResolvedConnection(record = record, secret = secret)
    }

    // ── DB query ──────────────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun loadRecord(id: UUID, workspaceId: UUID): ConnectionRecord? {
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(SELECT_SQL).use { stmt ->
                    stmt.setObject(1, id)
                    stmt.setObject(2, workspaceId)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) return@use null

                        val configJson: Map<String, Any> = try {
                            mapper.readValue(
                                rs.getString("config_json") ?: "{}",
                                Map::class.java
                            ) as Map<String, Any>
                        } catch (_: Exception) { emptyMap() }

                        fun parseJsonList(col: String): List<String> = try {
                            mapper.readValue(
                                rs.getString(col) ?: "[]",
                                List::class.java
                            ) as List<String>
                        } catch (_: Exception) { emptyList() }

                        ConnectionRecord(
                            id             = UUID.fromString(rs.getString("id")),
                            workspaceId    = UUID.fromString(rs.getString("workspace_id")),
                            environmentId  = UUID.fromString(rs.getString("environment_id")),
                            name           = rs.getString("name") ?: "",
                            type           = rs.getString("type") ?: "",
                            provider       = rs.getString("provider") ?: "",
                            status         = rs.getString("status") ?: "inactive",
                            authType       = rs.getString("auth_type") ?: "none",
                            secretRef      = rs.getString("secret_ref"),   // NOT returned to callers
                            configJson     = configJson,
                            allowedHosts   = parseJsonList("allowed_hosts"),
                            /* Tolerated missing: the API applies V071 and the
                               worker may be running ahead of it. An unreadable
                               policy reads as PUBLIC, which is the restrictive
                               answer and the one that fails visibly. */
                            egressPolicy   = SsrfGuard.EgressPolicy.of(
                                runCatching { rs.getString("egress_policy") }.getOrNull()),
                            allowedPaths   = parseJsonList("allowed_paths"),
                            allowedSchemas = parseJsonList("allowed_schemas"),
                            allowedTables  = parseJsonList("allowed_tables"),
                        )
                    }
                }
            }
        } catch (e: Exception) {
            log.error("[conn] DB error loading connection {}: {}", id, e.message)
            null
        }
    }

    /**
     * Type compatibility — map between the stored connection type in the DB and
     * the expectedType string each executor passes.
     *
     * DB `type` values (from V001 migration): "llm" | "database" | "http" | "tool"
     * Executor expectedType values: "llm" | "database" | "http" | "db" | "db_query"
     */
    private fun isTypeCompatible(actual: String, expected: String): Boolean {
        if (actual == expected) return true
        val aliases = mapOf(
            "database"    to setOf("db", "db_query", "database_read", "database_write"),
            "db"          to setOf("database", "db_query"),
            "db_query"    to setOf("database", "db"),
            "http"        to setOf("tool", "http_tool"),
            "tool"        to setOf("http", "http_tool"),
            "llm"         to setOf("llm_provider", "ai"),
        )
        return aliases[actual]?.contains(expected) ?: false
    }

    companion object {
        private val SELECT_SQL = """
            SELECT id, workspace_id, environment_id, name, type, provider,
                   status, auth_type, secret_ref, config_json,
                   allowed_hosts, allowed_paths, allowed_schemas, allowed_tables,
                   COALESCE(egress_policy, 'public') AS egress_policy
            FROM connections
            WHERE id = ? AND workspace_id = ?
        """.trimIndent()
    }
}
