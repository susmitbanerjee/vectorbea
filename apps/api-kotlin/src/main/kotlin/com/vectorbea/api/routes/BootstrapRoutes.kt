package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.toJson
import com.vectorbea.api.repository.EnvironmentRepository
import org.slf4j.LoggerFactory
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * The ids a client needs before it can write anything.
 *
 * ── WHY THIS FILE CHANGED ────────────────────────────────────────────────────
 *
 * `POST/GET /api/bootstrap` used to answer with the OLDEST workspace in the
 * database and that workspace's first environment, for every caller, with no
 * authentication. For whoever owned that workspace the answer was right by luck.
 * For everybody else it was another tenant's environment id — and since every
 * write endpoint calls `requireEnvironmentId()`, the web app was left choosing
 * between writing into the wrong tenant and refusing to create anything. It
 * chose to refuse, which is why registering a tool reported that the record
 * might land in a different workspace.
 *
 * Two changes fix that at the source:
 *
 *   1. **Bootstrap is scoped when the caller is authenticated.** With a verified
 *      principal it answers with the caller's own workspace and that workspace's
 *      environment, creating the environment if the workspace has none. The
 *      unauthenticated single-tenant behaviour is kept for local development,
 *      where there is no principal and exactly one workspace.
 *
 *   2. **`GET /api/environments` exists.** It is the per-workspace endpoint the
 *      integration notes recorded as missing, and it is what the web client now
 *      reads. It never returns an environment belonging to another workspace, so
 *      the client has nothing to second-guess.
 */
class BootstrapRoutes(
    private val dataSource: DataSource,
    private val environments: EnvironmentRepository = EnvironmentRepository(dataSource),
) {

    private val log = LoggerFactory.getLogger(BootstrapRoutes::class.java)

    fun register(router: Router) {
        router.post("/api/bootstrap") { req -> bootstrap(req) }
        router.get("/api/bootstrap") { req -> bootstrap(req) }
        router.get("/api/environments", ::listEnvironments)
    }

    // ── GET /api/environments ────────────────────────────────────────────────

    /**
     * Every environment in the caller's workspace, oldest first.
     *
     * `Request.context()` has already verified that the caller is a member of
     * the workspace it names, so the list cannot span tenants. A workspace with
     * no environment row gets one here rather than an empty list: the client
     * asked this question because it is about to write, and answering "none"
     * would hand it back exactly the dead end this endpoint exists to remove.
     */
    private fun listEnvironments(req: Request): Response {
        val ctx = req.context()
        val existing = environments.list(ctx.workspaceId).items
        val rows = existing.ifEmpty { listOf(environments.findOrCreate(ctx.workspaceId, DEFAULT_SLUG)) }
        return Response.ok(
            mapOf(
                "items" to rows.map {
                    mapOf(
                        "id" to it.id.toString(),
                        "workspaceId" to it.workspaceId.toString(),
                        "name" to it.name,
                        "slug" to it.slug,
                        "type" to it.type,
                    )
                },
                "total" to rows.size,
                // The one a write lands in when the client names none. Stated
                // rather than left to the client to infer from ordering.
                "defaultEnvironmentId" to rows.first().id.toString(),
            )
        )
    }

    // ── GET/POST /api/bootstrap ──────────────────────────────────────────────

    private fun bootstrap(req: Request): Response {
        // Authenticated: answer for the caller's own workspace. `context()`
        // refuses a workspace the principal is not a member of, so the id below
        // is always one this caller may write into.
        if (req.principal != null) {
            val ctx = req.context()
            val environment = environments.firstByWorkspace(ctx.workspaceId)
                ?: environments.findOrCreate(ctx.workspaceId, DEFAULT_SLUG)
            return Response.ok(
                mapOf(
                    "workspaceId" to ctx.workspaceId.toString(),
                    "environmentId" to environment.id.toString(),
                )
            )
        }

        return unauthenticatedBootstrap()
    }

    /**
     * Local development, where `AuthMiddleware` is disabled and the database
     * holds a single workspace. Unchanged behaviour, deliberately: it is the
     * path that makes a fresh checkout work against a fresh database.
     */
    private fun unauthenticatedBootstrap(): Response {
        return try {
            dataSource.connection.use { conn ->
                conn.autoCommit = false
                try {
                    // ── 1. Find or create workspace ───────────────────────────
                    val workspaceId: UUID = conn.prepareStatement(
                        "SELECT id FROM workspaces ORDER BY created_at ASC LIMIT 1"
                    ).use { stmt ->
                        stmt.executeQuery().use { rs ->
                            if (rs.next()) UUID.fromString(rs.getString("id")) else null
                        }
                    } ?: run {
                        val id = UUID.randomUUID()
                        val now = Timestamp.from(Instant.now())
                        conn.prepareStatement(
                            "INSERT INTO workspaces (id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
                        ).use { stmt ->
                            stmt.setObject(1, id)
                            stmt.setString(2, "My Workspace")
                            stmt.setString(3, "my-workspace")
                            stmt.setTimestamp(4, now)
                            stmt.setTimestamp(5, now)
                            stmt.executeUpdate()
                        }
                        log.info("[bootstrap] created workspace id={}", id)
                        id
                    }

                    // ── 2. Find or create environment ─────────────────────────
                    val environmentId: UUID = conn.prepareStatement(
                        "SELECT id FROM environments WHERE workspace_id = ? ORDER BY created_at ASC LIMIT 1"
                    ).use { stmt ->
                        stmt.setObject(1, workspaceId)
                        stmt.executeQuery().use { rs ->
                            if (rs.next()) UUID.fromString(rs.getString("id")) else null
                        }
                    } ?: run {
                        val id = UUID.randomUUID()
                        val now = Timestamp.from(Instant.now())
                        conn.prepareStatement(
                            """INSERT INTO environments (id, workspace_id, name, slug, type, created_at, updated_at)
                               VALUES (?, ?, ?, ?, ?, ?, ?)"""
                        ).use { stmt ->
                            stmt.setObject(1, id)
                            stmt.setObject(2, workspaceId)
                            stmt.setString(3, "Production")
                            stmt.setString(4, "production")
                            stmt.setString(5, "production")
                            stmt.setTimestamp(6, now)
                            stmt.setTimestamp(7, now)
                            stmt.executeUpdate()
                        }
                        log.info("[bootstrap] created environment id={} workspaceId={}", id, workspaceId)
                        id
                    }

                    conn.commit()

                    val body = toJson(
                        mapOf(
                            "workspaceId" to workspaceId.toString(),
                            "environmentId" to environmentId.toString(),
                        )
                    )
                    Response(
                        status = 200, body = body,
                        headers = mapOf("Content-Type" to "application/json")
                    )
                } catch (e: Exception) {
                    conn.rollback()
                    throw e
                }
            }
        } catch (e: Exception) {
            log.error("[bootstrap] failed", e)
            Response(
                status = 500,
                body = """{"error":"Bootstrap failed: ${e.message}"}""",
                headers = mapOf("Content-Type" to "application/json"),
            )
        }
    }

    companion object {
        /**
         * The slug a workspace's first environment gets.
         *
         * `production` rather than `development`: real execution is the default
         * since V039, and naming the only environment "development" would put a
         * misleading badge on every run in a workspace that has just one.
         */
        const val DEFAULT_SLUG = "production"
    }
}
