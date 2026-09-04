package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.connector.ConnectionTester
import com.vectorbea.api.connector.DbSchemaFetcher
import com.vectorbea.api.connector.DbTester
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
            val config: Map<String, Any?>? = null,
        )

        val body = req.bodyAs<Body>()
        val dbType = body.dbType?.trim()?.takeIf { it.isNotBlank() }
            ?: throw ApiError.ValidationError("dbType is required (e.g. postgresql, mysql)")

        /* Resolved through the same function the connection tester uses, so an
           unsaved preview and an unsaved test read the same string the same way.
           The explicit fields still win, because on this path the caller typed
           them into their own form inputs. */
        val resolved = ConnectionTester.databaseInput(
            provider = dbType,
            config = buildMap {
                putAll(body.config ?: emptyMap())
                body.username?.let { put("username", it) }
                body.host?.let { put("host", it) }
                body.port?.let { put("port", it) }
                body.database?.let { put("database", it) }
            },
            secret = body.plaintextSecret,
        )

        return Response.ok(fetchSchema(resolved))
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

        // Resolve secret — workspace-scoped to prevent cross-tenant leakage
        val secret: String? = conn.secretRef?.let { ref ->
            try {
                secretService.resolveSecretForRuntime(ref, ctx.workspaceId)
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

        /*
         * ── THE SAME RESOLVER THE TEST USES ──────────────────────────────────
         *
         * This route used to decide for itself what a saved connection meant,
         * and its copy had drifted from `ConnectionTester.testDatabase`. The
         * copy never read `config.connectionUrl`, so a connection whose secret
         * is a bare PASSWORD — the URL living in config — resolved to no URL at
         * all, fell through to the host/port/database fields it also did not
         * have, and `resolvePostgresTarget` defaulted to
         * `jdbc:postgresql://localhost:5432/postgres`. The API dialled its own
         * loopback, was refused, and told the user to "verify credentials and
         * network access" for a connection they had just watched turn green.
         * It dropped `config.db` and `sslRequired` for the same reason.
         *
         * One function now answers "what does this connection point at", for
         * both the test and the preview. They cannot disagree again.
         */
        val resolved = ConnectionTester.databaseInput(conn.provider, config, secret)
        return Response.ok(fetchSchema(resolved))
    }

    // ── Shared ────────────────────────────────────────────────────────────────

    private fun fetchSchema(input: DbTester.DbTestInput): Map<String, Any?> {
        return try {
            val result = DbSchemaFetcher.fetch(DbSchemaFetcher.from(input))
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
            /*
             * CLASSIFIED THE WAY THE CONNECTION TEST CLASSIFIES.
             *
             * This used to match on `e.message` of the TOP exception only. JDBC
             * drivers put the useful sentence in a CAUSE — pgjdbc wraps a
             * `ConnectException` inside a generic `PSQLException` — so almost
             * every real failure missed all three patterns and fell to
             * "Could not connect to database — verify credentials and network
             * access". That one sentence was shown for a refused connection, a
             * wrong password, an expired certificate and a pooler rejecting a
             * prepared statement alike, and it named the two things the user had
             * just proved were fine.
             *
             * `DbTester.classifyException` walks twelve levels of cause and reads
             * the SQLSTATE, and the host guidance beside it is the same sentence
             * the test screen already gives.
             */
            val (code, message) = DbTester.classifyException(e)
            val guidance = DbTester.hostGuidance(code, DbTester.hostOf(input))
            log.warn("Schema preview failed [dbType={}, code={}]: {}", input.dbType, code, e.javaClass.simpleName)
            throw ApiError.ValidationError(
                if (guidance == null) message else "$message. $guidance"
            )
        }
    }
}
