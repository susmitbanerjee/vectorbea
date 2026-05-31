package com.vectorbea.api.users

import org.slf4j.LoggerFactory
import java.sql.Connection
import java.util.UUID
import javax.sql.DataSource

/**
 * Maps Supabase auth users to Neon application data.
 *
 * On every authenticated request:
 *  1. Upserts a row in app_users keyed on supabase_user_id.
 *  2. Updates email/full_name/avatar_url from the JWT's user_metadata.
 *  3. Loads the user's active workspace memberships.
 *  4. If no memberships, attempts first-run bootstrap (assign to unowned workspace).
 */
class AppUserRepository(private val ds: DataSource) {

    private val log = LoggerFactory.getLogger(AppUserRepository::class.java)

    data class UserProfile(
        val id: UUID,
        val supabaseUserId: String,
        val email: String?,
        val fullName: String?,
        val avatarUrl: String?,
        val authorizedWorkspaceIds: Set<UUID>,
    )

    fun resolveUser(
        supabaseUserId: String,
        email: String?,
        fullName: String? = null,
        avatarUrl: String? = null,
    ): UserProfile {
        ds.connection.use { conn ->
            val userId = upsertUser(conn, supabaseUserId, email, fullName, avatarUrl)
            var workspaceIds = loadWorkspaces(conn, userId)

            if (workspaceIds.isEmpty()) {
                val bootstrapped = bootstrapIfFirst(conn, userId)
                if (bootstrapped != null) {
                    log.info("[auth] bootstrapped user {} as owner of workspace {}", supabaseUserId, bootstrapped)
                    workspaceIds = setOf(bootstrapped)
                } else {
                    log.warn("[auth] user {} has no workspace memberships", supabaseUserId)
                }
            }

            return UserProfile(
                id                     = userId,
                supabaseUserId         = supabaseUserId,
                email                  = email,
                fullName               = fullName,
                avatarUrl              = avatarUrl,
                authorizedWorkspaceIds = workspaceIds,
            )
        }
    }

    fun loadWorkspacesWithRoles(userId: UUID): List<WorkspaceMembership> {
        ds.connection.use { conn ->
            conn.prepareStatement(
                """
                SELECT wm.workspace_id, w.name, w.slug, wm.role
                FROM workspace_members wm
                JOIN workspaces w ON w.id = wm.workspace_id
                WHERE wm.user_id = ? AND wm.status = 'active'
                ORDER BY w.name
                """.trimIndent()
            ).use { stmt ->
                stmt.setObject(1, userId)
                val rs = stmt.executeQuery()
                val list = mutableListOf<WorkspaceMembership>()
                while (rs.next()) {
                    list += WorkspaceMembership(
                        workspaceId = UUID.fromString(rs.getString("workspace_id")),
                        name        = rs.getString("name"),
                        slug        = rs.getString("slug"),
                        role        = rs.getString("role"),
                    )
                }
                return list
            }
        }
    }

    fun createWorkspace(userId: UUID, name: String, slug: String): UUID {
        ds.connection.use { conn ->
            val wsId = conn.prepareStatement(
                "INSERT INTO workspaces (name, slug, owner_user_id) VALUES (?, ?, ?) RETURNING id"
            ).use { stmt ->
                stmt.setString(1, name)
                stmt.setString(2, slug)
                stmt.setObject(3, userId)
                val rs = stmt.executeQuery()
                check(rs.next()) { "INSERT INTO workspaces returned no rows" }
                UUID.fromString(rs.getString("id"))
            }

            // Default Development environment
            conn.prepareStatement(
                "INSERT INTO environments (workspace_id, name, slug, type) VALUES (?, 'Development', 'development', 'development') ON CONFLICT (workspace_id, slug) DO NOTHING"
            ).use { stmt ->
                stmt.setObject(1, wsId)
                stmt.executeUpdate()
            }

            // Owner membership
            conn.prepareStatement(
                "INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES (?, ?, 'owner', 'active') ON CONFLICT (workspace_id, user_id) DO NOTHING"
            ).use { stmt ->
                stmt.setObject(1, wsId)
                stmt.setObject(2, userId)
                stmt.executeUpdate()
            }

            log.info("[auth] created workspace {} slug={} owner={}", wsId, slug, userId)
            return wsId
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    private fun upsertUser(
        conn: Connection,
        supabaseUserId: String,
        email: String?,
        fullName: String?,
        avatarUrl: String?,
    ): UUID {
        conn.prepareStatement(
            """
            INSERT INTO app_users (supabase_user_id, email, full_name, avatar_url, updated_at)
            VALUES (?, ?, ?, ?, now())
            ON CONFLICT (supabase_user_id) DO UPDATE
              SET email      = COALESCE(EXCLUDED.email,      app_users.email),
                  full_name  = COALESCE(EXCLUDED.full_name,  app_users.full_name),
                  avatar_url = COALESCE(EXCLUDED.avatar_url, app_users.avatar_url),
                  updated_at = now()
            RETURNING id
            """.trimIndent()
        ).use { stmt ->
            stmt.setString(1, supabaseUserId)
            stmt.setString(2, email)
            stmt.setString(3, fullName)
            stmt.setString(4, avatarUrl)
            val rs = stmt.executeQuery()
            check(rs.next()) { "UPSERT into app_users returned no rows" }
            return UUID.fromString(rs.getString("id"))
        }
    }

    private fun loadWorkspaces(conn: Connection, userId: UUID): Set<UUID> {
        conn.prepareStatement(
            "SELECT workspace_id FROM workspace_members WHERE user_id = ? AND status = 'active'"
        ).use { stmt ->
            stmt.setObject(1, userId)
            val rs = stmt.executeQuery()
            val ids = mutableSetOf<UUID>()
            while (rs.next()) ids += UUID.fromString(rs.getString("workspace_id"))
            return ids
        }
    }

    private fun bootstrapIfFirst(conn: Connection, userId: UUID): UUID? {
        val wsId = conn.prepareStatement(
            "SELECT w.id FROM workspaces w WHERE NOT EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id) LIMIT 1"
        ).use { stmt ->
            val rs = stmt.executeQuery()
            if (rs.next()) UUID.fromString(rs.getString("id")) else return null
        }
        conn.prepareStatement(
            "INSERT INTO workspace_members (workspace_id, user_id, role, status) VALUES (?, ?, 'owner', 'active') ON CONFLICT DO NOTHING"
        ).use { stmt ->
            stmt.setObject(1, wsId)
            stmt.setObject(2, userId)
            stmt.executeUpdate()
        }
        return wsId
    }
}

data class WorkspaceMembership(
    val workspaceId: UUID,
    val name: String,
    val slug: String,
    val role: String,
)
