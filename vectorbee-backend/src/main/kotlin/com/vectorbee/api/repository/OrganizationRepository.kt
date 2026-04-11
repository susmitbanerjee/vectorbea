package com.vectorbee.api.repository

import com.vectorbee.api.db.Database
import com.vectorbee.api.model.OrganizationView
import java.time.OffsetDateTime
import java.util.UUID

class OrganizationRepository(private val database: Database) {
    fun list(organizationId: UUID): List<OrganizationView> =
        database.query { connection ->
            connection.prepareStatement(
                """
                select id, name, created_at
                from public.organizations
                where id = ?
                order by created_at asc, name asc
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, organizationId)
                statement.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) {
                            add(
                                OrganizationView(
                                    id = rs.getObject("id", UUID::class.java),
                                    name = rs.getString("name"),
                                    createdAt = rs.getObject("created_at", OffsetDateTime::class.java)
                                )
                            )
                        }
                    }
                }
            }
        }

    fun create(name: String): OrganizationView =
        database.query { connection ->
            connection.prepareStatement(
                """
                insert into public.organizations (name)
                values (?)
                returning id, name, created_at
                """.trimIndent()
            ).use { statement ->
                statement.setString(1, name)
                statement.executeQuery().use { rs ->
                    rs.next()
                    OrganizationView(
                        id = rs.getObject("id", UUID::class.java),
                        name = rs.getString("name"),
                        createdAt = rs.getObject("created_at", OffsetDateTime::class.java)
                    )
                }
            }
        }
}
