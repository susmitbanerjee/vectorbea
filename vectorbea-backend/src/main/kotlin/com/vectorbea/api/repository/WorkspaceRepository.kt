package com.vectorbea.api.repository

import com.vectorbea.api.db.Database
import com.vectorbea.api.model.WorkspaceView
import java.time.OffsetDateTime
import java.util.UUID

open class WorkspaceRepository(private val database: Database) {
    open fun create(organizationId: UUID, name: String): WorkspaceView =
        database.query { connection ->
            connection.prepareStatement(
                """
                insert into public.workspaces (organization_id, name)
                values (?, ?)
                returning id, organization_id, name, created_at
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, organizationId)
                statement.setString(2, name)
                statement.executeQuery().use { rs ->
                    rs.next()
                    WorkspaceView(
                        id = rs.getObject("id", UUID::class.java),
                        organizationId = rs.getObject("organization_id", UUID::class.java),
                        name = rs.getString("name"),
                        createdAt = rs.getObject("created_at", OffsetDateTime::class.java)
                    )
                }
            }
        }
}
