package com.vectorbea.api.users

import org.slf4j.LoggerFactory
import java.sql.Connection
import java.util.UUID
import javax.sql.DataSource

/**
 * Manages the mapping between Supabase auth users and Neon application data.
 *
 * Responsibilities:
 *  1. Upsert a row in [app_users] the first time a Supabase user logs in.
 *  2. Load that user's authorized [workspace_members] rows.
 *  3. Auto-bootstrap: if a user has no memberships and there is exactly one
 *     workspace with no members yet, assign them as 'owner' (first-run convenience).
 *
 * Security: all workspace authorization decisions derive from this repository,
 * never from client-supplied headers.
 */
class AppUserRepository(private val ds: DataSource) {

    private val log = LoggerFactory.getLogger(AppUserRepository::class.java)

    /**
     * Find or create a local user record for [supabaseUserId], then load their
     * workspace memberships.
     *
     * If the user has no workspace memberships after upsert, [bootstrapIfFirst] is
     * attempted to assign them to the first unowned workspace (development convenience).
     *
     * @return Pair of (app_user UUID, Set of authorized workspace UUIDs)
     */
    fun resolveUser(supabaseUserId: String, email: String?): Pair<UUID, Set<UUID>> {
        ds.connection.use { conn ->
            val userId = upsertUser(conn, supabaseUserId, email)
            var workspaceIds = loadWorkspaces(conn, userId)

            if (workspaceIds.isEmpty()) {
                // First login — try auto-bootstrap
                val bootstrapped = bootstrapIfFirst(conn, userId)
                if (bootstrapped != null) {
                    log.info("[auth] bootstrapped user {} as owner of workspace {}", supabaseUserId, bootstrapped)
                    workspaceIds = setOf(bootstrapped)
                } else {
                    log.warn("[auth] user {} has no workspace memberships", supabaseUserId)
                }
            }

            return Pair(userId, workspaceIds)
        }
    }

    // ── Private helpers ───────────────────────────────────────────────────────

    /**
     * INSERT OR UPDATE app_users, returning the internal UUID.
     * Updates email if it was previously null (e.g. first login used SSO without email).
     */
    private fun upsertUser(conn: Connection, supabaseUserId: String, email: String?): UUID {
        conn.prepareStatement(
            """
            INSERT INTO app_users (supabase_user_id, email, updated_at)
            VALUES (?, ?, now())
            ON CONFLICT (supabase_user_id) DO UPDATE
              SET email      = COALESCE(EXCLUDED.email, app_users.email),
                  updated_at = now()
            RETURNING id
            """.trimIndent()
        ).use { stmt ->
            stmt.setString(1, supabaseUserId)
            stmt.setString(2, email)
            val rs = stmt.executeQuery()
            check(rs.next()) { "UPSERT into app_users returned no rows for supabase_user_id=$supabaseUserId" }
            return UUID.fromString(rs.getString("id"))
        }
    }

    /** Return all workspace IDs where [userId] is a member. */
    private fun loadWorkspaces(conn: Connection, userId: UUID): Set<UUID> {
        conn.prepareStatement(
            "SELECT workspace_id FROM workspace_members WHERE user_id = ?"
        ).use { stmt ->
            stmt.setObject(1, userId)
            val rs = stmt.executeQuery()
            val ids = mutableSetOf<UUID>()
            while (rs.next()) ids += UUID.fromString(rs.getString("workspace_id"))
            return ids
        }
    }

    /**
     * If there is exactly one workspace that has zero members, add [userId] as owner.
     * Returns the workspace ID if bootstrap succeeded, null otherwise.
     *
     * This is the "first user on the platform" convenience — subsequent users must be
     * explicitly invited.
     */
    private fun bootstrapIfFirst(conn: Connection, userId: UUID): UUID? {
        // Find a workspace that has no members yet
        val wsId = conn.prepareStatement(
            """
            SELECT w.id FROM workspaces w
            WHERE NOT EXISTS (
                SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = w.id
            )
            LIMIT 1
            """.trimIndent()
        ).use { stmt ->
            val rs = stmt.executeQuery()
            if (rs.next()) UUID.fromString(rs.getString("id")) else return null
        }

        conn.prepareStatement(
            """
            INSERT INTO workspace_members (workspace_id, user_id, role)
            VALUES (?, ?, 'owner')
            ON CONFLICT DO NOTHING
            """.trimIndent()
        ).use { stmt ->
            stmt.setObject(1, wsId)
            stmt.setObject(2, userId)
            stmt.executeUpdate()
        }

        return wsId
    }
}
