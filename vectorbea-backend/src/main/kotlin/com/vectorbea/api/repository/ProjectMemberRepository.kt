package com.vectorbea.api.repository

import com.vectorbea.api.model.ProjectMemberView
import java.sql.Connection
import java.time.OffsetDateTime
import java.util.UUID

class ProjectMemberRepository(private val database: com.vectorbea.api.db.Database) {
    data class ProjectSeatPolicy(
        val organizationId: UUID,
        val maxSeats: Int,
    )

    fun isProjectMember(projectId: UUID, userId: UUID): Boolean =
        database.query { connection ->
            connection.prepareStatement(
                """
                select 1
                from vectorbea.workspace_members
                where workspace_id = ? and user_id = ?
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, projectId)
                statement.setObject(2, userId)
                statement.executeQuery().use { rs -> rs.next() }
            }
        }

    fun isProjectAdmin(projectId: UUID, userId: UUID): Boolean =
        database.query { connection ->
            connection.prepareStatement(
                """
                select 1
                from vectorbea.workspace_members
                where workspace_id = ? and user_id = ? and role = 'admin'::vectorbea.workspace_role
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, projectId)
                statement.setObject(2, userId)
                statement.executeQuery().use { rs -> rs.next() }
            }
        }

    fun getProjectSeatPolicy(projectId: UUID): ProjectSeatPolicy? =
        database.query { connection ->
            connection.prepareStatement(
                """
                select w.organization_id, o.max_seats
                from vectorbea.workspaces w
                join vectorbea.organizations o on o.id = w.organization_id
                where w.id = ?
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, projectId)
                statement.executeQuery().use { rs ->
                    if (!rs.next()) return@use null
                    ProjectSeatPolicy(
                        organizationId = rs.getObject("organization_id", UUID::class.java),
                        maxSeats = rs.getInt("max_seats"),
                    )
                }
            }
        }

    fun countDistinctUsersInOrganization(organizationId: UUID): Int =
        database.query { connection ->
            connection.prepareStatement(
                """
                select count(distinct wm.user_id)
                from vectorbea.workspace_members wm
                join vectorbea.workspaces w on w.id = wm.workspace_id
                where w.organization_id = ?
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, organizationId)
                statement.executeQuery().use { rs ->
                    rs.next()
                    rs.getInt(1)
                }
            }
        }

    fun findUserIdByEmail(organizationId: UUID, email: String): UUID? =
        database.query { connection ->
            connection.prepareStatement(
                """
                select id
                from vectorbea.users
                where organization_id = ? and lower(email) = lower(?)
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, organizationId)
                statement.setString(2, email)
                statement.executeQuery().use { rs ->
                    if (rs.next()) rs.getObject("id", UUID::class.java) else null
                }
            }
        }

    fun userOccupiesSeatInOrganization(organizationId: UUID, userId: UUID): Boolean =
        database.query { connection ->
            connection.prepareStatement(
                """
                select 1
                from vectorbea.workspace_members wm
                join vectorbea.workspaces w on w.id = wm.workspace_id
                where w.organization_id = ? and wm.user_id = ?
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, organizationId)
                statement.setObject(2, userId)
                statement.executeQuery().use { rs -> rs.next() }
            }
        }

    fun inviteMember(projectId: UUID, organizationId: UUID, email: String, role: String): ProjectMemberView =
        database.transaction { connection ->
            val userId = findOrCreateUser(connection, organizationId, email)

            connection.prepareStatement(
                """
                insert into vectorbea.org_members (user_id, organization_id, role)
                values (?, ?, 'member'::vectorbea.org_role)
                on conflict (user_id, organization_id) do nothing
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, userId)
                statement.setObject(2, organizationId)
                statement.executeUpdate()
            }

            connection.prepareStatement(
                """
                insert into vectorbea.workspace_members (user_id, workspace_id, role)
                values (?, ?, ?::vectorbea.workspace_role)
                on conflict (user_id, workspace_id) do update
                set role = excluded.role
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, userId)
                statement.setObject(2, projectId)
                statement.setString(3, role)
                statement.executeUpdate()
            }

            connection.prepareStatement(
                """
                select u.id as user_id, wm.workspace_id, u.email, wm.role::text as role, wm.granted_at
                from vectorbea.workspace_members wm
                join vectorbea.users u on u.id = wm.user_id
                where wm.workspace_id = ? and wm.user_id = ?
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, projectId)
                statement.setObject(2, userId)
                statement.executeQuery().use { rs ->
                    rs.next()
                    ProjectMemberView(
                        userId = rs.getObject("user_id", UUID::class.java),
                        projectId = rs.getObject("workspace_id", UUID::class.java),
                        email = rs.getString("email"),
                        role = rs.getString("role"),
                        grantedAt = rs.getObject("granted_at", OffsetDateTime::class.java),
                    )
                }
            }
        }

    private fun findOrCreateUser(connection: Connection, organizationId: UUID, email: String): UUID {
        connection.prepareStatement(
            """
            select id
            from vectorbea.users
            where organization_id = ? and lower(email) = lower(?)
            limit 1
            """.trimIndent()
        ).use { statement ->
            statement.setObject(1, organizationId)
            statement.setString(2, email)
            statement.executeQuery().use { rs ->
                if (rs.next()) {
                    return rs.getObject("id", UUID::class.java)
                }
            }
        }

        connection.prepareStatement(
            """
            insert into vectorbea.users (organization_id, email, role)
            values (?, ?, 'member')
            returning id
            """.trimIndent()
        ).use { statement ->
            statement.setObject(1, organizationId)
            statement.setString(2, email)
            statement.executeQuery().use { rs ->
                rs.next()
                return rs.getObject("id", UUID::class.java)
            }
        }
    }
}
