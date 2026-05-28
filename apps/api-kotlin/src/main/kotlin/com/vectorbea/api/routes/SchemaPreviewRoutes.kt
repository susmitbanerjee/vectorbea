package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.connector.DbSchemaFetcher
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.api.secrets.SecretServiceUnavailableException
import org.slf4j.LoggerFactory

/**
 * POST /api/connections/schema-preview
 *
 * Connects to a database using a supplied connection string (unsaved)
 * or an existing saved connection, then returns structural metadata:
 *   schemas → tables → columns (names, types, pk flags, nullability).
 *
 * This powers the schema picker UI — letting non-technical users browse
 * their database without writing SQL.
 *
 * SECURITY:
 * - plaintextSecret is accepted only in POST body (never in URL).
 * - plaintextSecret is NEVER logged, stored, or returned.
 * - For saved connections, secrets are resolved via SecretService.
 * - Results contain only metadata — no row data, no credentials.
 * - Rate-limited by workspace (same as other mutation endpoints).
 *
 * POST /api/connections/:id/schema-preview
 *   Uses the saved connection's stored secret.
 */
class SchemaPreviewRoutes(
    private val connectionRepo: ConnectionRepository,
    private val secretService: SecretService,
) {
    private val log = LoggerFactory.getLogger(SchemaPreviewRoutes::class.java)

    fun register(router: Router) {
        router.post("/api/connections/schema-preview",      ::previewUnsaved)
        router.post("/api/connections/:id/schema-preview",  ::previewSaved)
    }

    // ── POST /api/connections/schema-preview (unsaved — connection string in body) ──

    private fun previewUnsaved(req: Request): Response {
        req.context()   // validate workspace header

        data class Body(
            val dbType: String?,
            /** Full connection string — NEVER log */
            val plaintextSecret: String?,
            val username: String? = null,
            val host: String? = null,
            val port: Int? = null,
            val database: String? = null,
        )

        val body = req.bodyAs<Body>()
        val dbType = body.dbType?.trim()?.takeIf { it.isNotBlank() }
            ?: throw ApiError.ValidationError("dbType is required (e.g. postgresql, mysql)")

        val result = fetchSchema(
            dbType        = dbType,
            connectionUrl = body.plaintextSecret,
            password      = null,
            username      = body.username,
            host          = body.host,
            port          = body.port,
            database      = body.database,
        )
        return Response.ok(result)
    }

    // ── POST /api/connections/:id/schema-preview (saved connection) ───────────

    private fun previewSaved(req: Request): Response {
        val ctx = req.context()
        val id  = req.pathParam("id").let {
            try { java.util.UUID.fromString(it) }
            catch (_: Exception) { throw ApiError.ValidationError("id must be a valid UUID") }
        }

        val conn = connectionRepo.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Connection")

        if (conn.type.lowercase() != "database") {
            throw ApiError.ValidationError("Schema preview is only available for database connections")
        }

        // Resolve secret — plaintext held only in this scope
        val secret: String? = conn.secretRef?.let { ref ->
            try {
                secretService.resolveSecretForRuntime(ref)
            } catch (e: SecretServiceUnavailableException) {
                throw ApiError.ServiceUnavailable("Secret service not configured — cannot resolve connection credentials")
            } catch (e: Exception) {
                log.warn("Secret resolution failed [connectionId={}, ref={}]: {}", id, ref, e.javaClass.simpleName)
                null
            }
        }

        if (secret == null) {
            throw ApiError.ValidationError("No credentials configured for this connection. Add a secret first.")
        }

        @Suppress("UNCHECKED_CAST")
        val config = try {
            com.fasterxml.jackson.databind.ObjectMapper()
                .readValue(conn.configJson, Map::class.java) as Map<String, Any?>
        } catch (_: Exception) { emptyMap<String, Any?>() }

        val result = fetchSchema(
            dbType        = conn.provider,
            connectionUrl = if (secret.startsWith("postgres") || secret.startsWith("jdbc:") || secret.startsWith("mysql")) secret else null,
            password      = if (!(secret.startsWith("postgres") || secret.startsWith("jdbc:") || secret.startsWith("mysql"))) secret else null,
            username      = config["username"] as? String ?: config["user"] as? String,
            host          = config["host"] as? String,
            port          = (config["port"] as? Number)?.toInt(),
            database      = config["database"] as? String,
        )
        return Response.ok(result)
    }

    // ── Shared ────────────────────────────────────────────────────────────────

    private fun fetchSchema(
        dbType: String,
        connectionUrl: String?,
        password: String?,
        username: String?,
        host: String?,
        port: Int?,
        database: String?,
    ): Map<String, Any?> {
        return try {
            val result = DbSchemaFetcher.fetch(DbSchemaFetcher.SchemaInput(
                dbType        = dbType,
                connectionUrl = connectionUrl,
                password      = password,
                username      = username,
                host          = host,
                port          = port,
                database      = database,
            ))
            mapOf(
                "schemas"      to result.schemas,
                "tables"       to result.tables.map { t ->
                    mapOf(
                        "schema"           to t.schema,
                        "table"            to t.table,
                        "tableType"        to t.tableType,
                        "rowCountEstimate" to t.rowCountEstimate,
                        "columns"          to t.columns.map { c ->
                            mapOf(
                                "name"         to c.name,
                                "dataType"     to c.dataType,
                                "nullable"     to c.nullable,
                                "isPrimaryKey" to c.isPrimaryKey,
                                "defaultValue" to c.defaultValue,
                                "maxLength"    to c.maxLength,
                            )
                        },
                    )
                },
                "provider"     to result.provider,
                "databaseName" to result.databaseName,
                "fetchedAt"    to result.fetchedAt,
            )
        } catch (e: UnsupportedOperationException) {
            throw ApiError.ValidationError(e.message ?: "Unsupported database type")
        } catch (e: Exception) {
            log.warn("Schema preview failed [dbType={}]: {}", dbType, e.javaClass.simpleName)
            // Sanitize — don't expose connection details in error
            val msg = when {
                e.message?.contains("timeout", ignoreCase = true) == true -> "Connection timed out — check host and port"
                e.message?.contains("password", ignoreCase = true) == true ||
                e.message?.contains("auth", ignoreCase = true) == true    -> "Authentication failed — check credentials"
                e.message?.contains("unknown host", ignoreCase = true) == true -> "Host not found — check connection string"
                else -> "Could not connect to database — verify credentials and network access"
            }
            throw ApiError.ValidationError(msg)
        }
    }
}
