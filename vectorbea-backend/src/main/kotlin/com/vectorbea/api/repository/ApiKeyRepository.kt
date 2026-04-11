package com.vectorbea.api.repository

import com.vectorbea.api.auth.rbac.WorkspaceRole
import com.vectorbea.api.db.Database
import com.vectorbea.api.model.ApiKeyRecord
import com.vectorbea.api.model.AuthResult
import java.time.OffsetDateTime
import java.util.UUID

open class ApiKeyRepository(private val database: Database) {

    private fun mapRow(rs: java.sql.ResultSet): ApiKeyRecord = ApiKeyRecord(
        id = rs.getObject("id", UUID::class.java),
        workspaceId = rs.getObject("workspace_id", UUID::class.java),
        name = rs.getString("key_name") ?: "",
        keyHash = rs.getString("key_hash"),
        keyLastFour = rs.getString("key_last_four") ?: "",
        createdAt = rs.getObject("created_at", OffsetDateTime::class.java)
    )

    fun insert(workspaceId: UUID, name: String, role: WorkspaceRole, keyHash: String, keyLastFour: String): ApiKeyRecord =
        database.query { connection ->
            connection.prepareStatement(
                """
                insert into public.api_keys (workspace_id, key_name, key_role, key_hash, key_last_four)
                values (?, ?, ?, ?, ?)
                returning id, workspace_id, key_name, key_hash, key_last_four, created_at
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, workspaceId)
                statement.setString(2, name)
                statement.setString(3, role.name.lowercase())
                statement.setString(4, keyHash)
                statement.setString(5, keyLastFour)
                statement.executeQuery().use { rs ->
                    rs.next()
                    mapRow(rs)
                }
            }
        }

    fun findAuthResultByKeyHash(keyHash: String): AuthResult? =
        database.query { connection ->
            connection.prepareStatement(
                """
                select k.workspace_id, w.organization_id, k.key_role
                from public.api_keys k
                join public.workspaces w on w.id = k.workspace_id
                where k.key_hash = ?
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.setString(1, keyHash)
                statement.executeQuery().use { rs ->
                    if (!rs.next()) return@use null
                    AuthResult(
                        workspaceId = rs.getObject("workspace_id", UUID::class.java),
                        organizationId = rs.getObject("organization_id", UUID::class.java),
                        workspaceRole = WorkspaceRole.fromString(rs.getString("key_role"))
                    )
                }
            }
        }

    fun list(workspaceId: UUID): List<ApiKeyRecord> =
        database.query { connection ->
            connection.prepareStatement(
                "select id, workspace_id, key_name, key_hash, key_last_four, created_at from public.api_keys where workspace_id = ? order by created_at desc"
            ).use { statement ->
                statement.setObject(1, workspaceId)
                statement.executeQuery().use { rs ->
                    val results = mutableListOf<ApiKeyRecord>()
                    while (rs.next()) {
                        results += mapRow(rs)
                    }
                    results
                }
            }
        }

    /** Deletes an API key only if it belongs to the given workspace. */
    fun deleteById(id: UUID, workspaceId: UUID): Boolean =
        database.query { connection ->
            connection.prepareStatement(
                "delete from public.api_keys where id = ? and workspace_id = ?"
            ).use { statement ->
                statement.setObject(1, id)
                statement.setObject(2, workspaceId)
                statement.executeUpdate() > 0
            }
        }
}
