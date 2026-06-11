package com.vectorbea.api.routes

import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.toJson
import org.slf4j.LoggerFactory
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * POST /api/bootstrap
 *
 * Called by the frontend on first load (or when localStorage is empty).
 * Idempotent — safe to call on every cold start.
 *
 * Behaviour:
 *  1. If no workspace exists → create one (name = "My Workspace").
 *  2. If a workspace exists → use the first one.
 *  3. If no production environment exists for that workspace → create one.
 *  4. Return { workspaceId, environmentId } so the client can store them.
 *
 * No authentication required — this endpoint is intentionally open.
 * In a multi-tenant setup, this would be replaced by a proper sign-up flow
 * that creates a workspace per user after identity verification.
 *
 * GET /api/bootstrap — same as POST, for simple fetch() without body.
 */
class BootstrapRoutes(private val dataSource: DataSource) {

    private val log = LoggerFactory.getLogger(BootstrapRoutes::class.java)

    fun register(router: Router) {
        router.post("/api/bootstrap") { bootstrap() }
        router.get("/api/bootstrap")  { bootstrap() }
    }

    private fun bootstrap(): Response {
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

                    val body = toJson(mapOf(
                        "workspaceId"   to workspaceId.toString(),
                        "environmentId" to environmentId.toString(),
                    ))
                    Response(status = 200, body = body,
                        headers = mapOf("Content-Type" to "application/json"))
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
}
