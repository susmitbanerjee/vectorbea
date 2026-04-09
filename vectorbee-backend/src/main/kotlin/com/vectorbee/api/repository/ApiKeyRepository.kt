package com.vectorbee.api.repository

import com.vectorbee.api.db.Database
import com.vectorbee.api.model.ApiKeyRecord
import java.time.OffsetDateTime
import java.util.UUID

class ApiKeyRepository(private val database: Database) {
    private fun mapRow(rs: java.sql.ResultSet): ApiKeyRecord = ApiKeyRecord(
        id = rs.getObject("id", UUID::class.java),
        organizationId = rs.getObject("organization_id", UUID::class.java),
        name = rs.getString("key_name") ?: "",
        keyHash = rs.getString("key_hash"),
        keyLastFour = rs.getString("key_last_four") ?: "",
        createdAt = rs.getObject("created_at", OffsetDateTime::class.java)
    )

    fun insert(organizationId: UUID, name: String, keyHash: String, keyLastFour: String): ApiKeyRecord =
        database.query { connection ->
            connection.prepareStatement(
                """
                insert into public.api_keys (organization_id, key_name, key_hash, key_last_four)
                values (?, ?, ?, ?)
                returning id, organization_id, key_name, key_hash, key_last_four, created_at
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, organizationId)
                statement.setString(2, name)
                statement.setString(3, keyHash)
                statement.setString(4, keyLastFour)
                statement.executeQuery().use { rs ->
                    rs.next()
                    mapRow(rs)
                }
            }
        }

    fun findOrganizationIdByKeyHash(keyHash: String): UUID? =
        database.query { connection ->
            connection.prepareStatement(
                """
                select organization_id
                from public.api_keys
                where key_hash = ?
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.setString(1, keyHash)
                statement.executeQuery().use { rs ->
                    if (rs.next()) rs.getObject("organization_id", UUID::class.java) else null
                }
            }
        }

    fun list(organizationId: UUID?): List<ApiKeyRecord> =
        database.query { connection ->
            val sql = if (organizationId != null) {
                "select id, organization_id, key_name, key_hash, key_last_four, created_at from public.api_keys where organization_id = ? order by created_at desc"
            } else {
                "select id, organization_id, key_name, key_hash, key_last_four, created_at from public.api_keys order by created_at desc"
            }
            connection.prepareStatement(sql).use { statement ->
                if (organizationId != null) statement.setObject(1, organizationId)
                statement.executeQuery().use { rs ->
                    val results = mutableListOf<ApiKeyRecord>()
                    while (rs.next()) {
                        results += mapRow(rs)
                    }
                    results
                }
            }
        }

    fun deleteById(id: UUID): Boolean =
        database.query { connection ->
            connection.prepareStatement("delete from public.api_keys where id = ?").use { statement ->
                statement.setObject(1, id)
                statement.executeUpdate() > 0
            }
        }

    fun findAnyOrganizationId(): UUID? =
        database.query { connection ->
            connection.prepareStatement(
                """
                select id
                from public.organizations
                order by created_at asc
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.executeQuery().use { rs ->
                    if (rs.next()) rs.getObject("id", UUID::class.java) else null
                }
            }
        }
}
