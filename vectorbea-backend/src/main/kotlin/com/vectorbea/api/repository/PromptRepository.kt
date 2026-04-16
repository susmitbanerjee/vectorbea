package com.vectorbea.api.repository

import com.vectorbea.api.db.Database
import com.vectorbea.api.http.Json
import com.vectorbea.api.model.PromptListItem
import com.vectorbea.api.model.PromptRecord
import com.vectorbea.api.model.PromptVersionRecord
import com.vectorbea.api.model.PromptVersionView
import java.sql.ResultSet
import java.time.OffsetDateTime
import java.util.UUID

open class PromptRepository(private val database: Database) {
    open fun createPromptWithInitialVersion(
        workspaceId: UUID,
        name: String,
        description: String?,
        versionTag: String,
        templateText: String,
        parametersJson: String
    ): Pair<PromptRecord, PromptVersionRecord> =
        database.transaction { connection ->
            val prompt = connection.prepareStatement(
                """
                insert into vectorbea.prompts (workspace_id, name, description)
                values (?, ?, ?)
                returning id, workspace_id, name, description, created_at
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, workspaceId)
                statement.setString(2, name)
                statement.setString(3, description)

                statement.executeQuery().use { rs ->
                    rs.next()
                    PromptRecord(
                        id = rs.getObject("id", UUID::class.java),
                        workspaceId = rs.getObject("workspace_id", UUID::class.java),
                        name = rs.getString("name"),
                        description = rs.getString("description"),
                        createdAt = rs.getObject("created_at", OffsetDateTime::class.java)
                    )
                }
            }

            val promptVersion = connection.prepareStatement(
                """
                insert into vectorbea.prompt_versions (prompt_id, version_tag, template_text, parameters, is_published)
                values (?, ?, ?, ?::jsonb, false)
                returning id, prompt_id, version_tag, template_text, parameters, created_at
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, prompt.id)
                statement.setString(2, versionTag)
                statement.setString(3, templateText)
                statement.setString(4, parametersJson)

                statement.executeQuery().use { rs ->
                    rs.next()
                    PromptVersionRecord(
                        id = rs.getObject("id", UUID::class.java),
                        promptId = rs.getObject("prompt_id", UUID::class.java),
                        versionTag = rs.getString("version_tag"),
                        templateText = rs.getString("template_text"),
                        parameters = Json.decodeJsonNode(rs.getString("parameters")),
                        createdAt = rs.getObject("created_at", OffsetDateTime::class.java)
                    )
                }
            }

            prompt to promptVersion
        }

    open fun listPrompts(workspaceId: UUID): List<PromptListItem> =
        database.query { connection ->
            connection.prepareStatement(
                """
                select
                    p.id,
                    p.name,
                    p.description,
                    pv.version_tag as latest_version,
                    pv.is_published,
                    pv.created_at as updated_at
                from vectorbea.prompts p
                join lateral (
                    select version_tag, is_published, created_at
                    from vectorbea.prompt_versions
                    where prompt_id = p.id
                    order by created_at desc, id desc
                    limit 1
                ) pv on true
                where p.workspace_id = ?
                order by pv.created_at desc, p.name asc
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, workspaceId)
                statement.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) {
                            add(
                                PromptListItem(
                                    id = rs.getObject("id", UUID::class.java),
                                    name = rs.getString("name"),
                                    description = rs.getString("description"),
                                    latestVersion = rs.getString("latest_version"),
                                    isPublished = rs.getBoolean("is_published"),
                                    updatedAt = rs.getObject("updated_at", OffsetDateTime::class.java)
                                )
                            )
                        }
                    }
                }
            }
        }

    open fun findById(promptId: UUID, workspaceId: UUID): PromptVersionView? =
        database.query { connection ->
            connection.prepareStatement(
                """
                $PROMPT_VERSION_SELECT
                where p.id = ? and p.workspace_id = ?
                order by pv.created_at desc, pv.id desc
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, promptId)
                statement.setObject(2, workspaceId)
                statement.executeQuery().use { rs ->
                    if (rs.next()) mapPromptVersionView(rs) else null
                }
            }
        }

    open fun findLatestByName(workspaceId: UUID, name: String): PromptVersionView? =
        database.query { connection ->
            connection.prepareStatement(
                """
                $PROMPT_VERSION_SELECT
                where p.workspace_id = ? and p.name = ? and pv.is_published = true
                order by pv.created_at desc, pv.id desc
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, workspaceId)
                statement.setString(2, name)
                statement.executeQuery().use { rs ->
                    if (rs.next()) mapPromptVersionView(rs) else null
                }
            }
        }

    open fun listVersions(promptId: UUID, workspaceId: UUID): List<PromptVersionView> =
        database.query { connection ->
            connection.prepareStatement(
                """
                $PROMPT_VERSION_SELECT
                where p.id = ? and p.workspace_id = ?
                order by pv.created_at desc, pv.id desc
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, promptId)
                statement.setObject(2, workspaceId)
                statement.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) {
                            add(mapPromptVersionView(rs))
                        }
                    }
                }
            }
        }

    open fun updatePrompt(
        promptId: UUID,
        workspaceId: UUID,
        description: String?,
        templateText: String,
        parametersJson: String,
        versionTag: String?
    ): PromptVersionView? =
        database.transaction { connection ->
            val promptExists = connection.prepareStatement(
                """
                update vectorbea.prompts
                set description = ?
                where id = ? and workspace_id = ?
                returning id
                """.trimIndent()
            ).use { statement ->
                statement.setString(1, description)
                statement.setObject(2, promptId)
                statement.setObject(3, workspaceId)
                statement.executeQuery().use { rs -> rs.next() }
            }

            if (!promptExists) return@transaction null

            val currentVersion = connection.prepareStatement(
                """
                select id, version_tag, is_published
                from vectorbea.prompt_versions
                where prompt_id = ?
                order by created_at desc, id desc
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, promptId)
                statement.executeQuery().use { rs ->
                    if (!rs.next()) null
                    else Triple(
                        rs.getObject("id", UUID::class.java),
                        rs.getString("version_tag"),
                        rs.getBoolean("is_published")
                    )
                }
            } ?: return@transaction null

            if (currentVersion.third) {
                connection.prepareStatement(
                    """
                    insert into vectorbea.prompt_versions (prompt_id, version_tag, template_text, parameters, is_published)
                    values (?, ?, ?, ?::jsonb, false)
                    """.trimIndent()
                ).use { statement ->
                    statement.setObject(1, promptId)
                    val nextVersionTag = versionTag
                        ?.takeIf { it != currentVersion.second }
                        ?: bumpVersionTag(currentVersion.second)
                    statement.setString(2, nextVersionTag)
                    statement.setString(3, templateText)
                    statement.setString(4, parametersJson)
                    statement.executeUpdate()
                }
            } else {
                connection.prepareStatement(
                    """
                    update vectorbea.prompt_versions
                    set template_text = ?, parameters = ?::jsonb, version_tag = coalesce(?, version_tag), is_published = false
                    where id = ?
                    """.trimIndent()
                ).use { statement ->
                    statement.setString(1, templateText)
                    statement.setString(2, parametersJson)
                    statement.setString(3, versionTag)
                    statement.setObject(4, currentVersion.first)
                    statement.executeUpdate()
                }
            }

            findById(promptId, workspaceId)
        }

    open fun publishPrompt(promptId: UUID, workspaceId: UUID): PromptVersionView? =
        database.transaction { connection ->
            // Verify prompt belongs to workspace
            val ownsPrompt = connection.prepareStatement(
                "select 1 from vectorbea.prompts where id = ? and workspace_id = ?"
            ).use { statement ->
                statement.setObject(1, promptId)
                statement.setObject(2, workspaceId)
                statement.executeQuery().use { rs -> rs.next() }
            }
            if (!ownsPrompt) return@transaction null

            val promptVersionId = connection.prepareStatement(
                """
                select id
                from vectorbea.prompt_versions
                where prompt_id = ?
                order by created_at desc, id desc
                limit 1
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, promptId)
                statement.executeQuery().use { rs ->
                    if (rs.next()) rs.getObject("id", UUID::class.java) else null
                }
            } ?: return@transaction null

            connection.prepareStatement(
                """
                update vectorbea.prompt_versions
                set is_published = false
                where prompt_id = ?
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, promptId)
                statement.executeUpdate()
            }

            connection.prepareStatement(
                """
                update vectorbea.prompt_versions
                set is_published = true
                where id = ?
                """.trimIndent()
            ).use { statement ->
                statement.setObject(1, promptVersionId)
                statement.executeUpdate()
            }

            findById(promptId, workspaceId)
        }

    private fun bumpVersionTag(versionTag: String): String {
        val normalized = versionTag.removePrefix("v")
        val parts = normalized.split(".").mapNotNull { it.toIntOrNull() }.toMutableList()
        if (parts.isEmpty()) return "v1.0.0"
        while (parts.size < 3) {
            parts.add(0)
        }
        parts[parts.lastIndex] = parts.last() + 1
        return "v${parts.joinToString(".")}"
    }

    companion object {
        private const val PROMPT_VERSION_SELECT = """
            select
                p.id as prompt_id,
                p.workspace_id,
                p.name,
                p.description,
                pv.id as prompt_version_id,
                pv.version_tag,
                pv.template_text,
                pv.parameters,
                pv.is_published,
                pv.created_at
            from vectorbea.prompts p
            join vectorbea.prompt_versions pv on pv.prompt_id = p.id"""

        private fun mapPromptVersionView(rs: ResultSet) = PromptVersionView(
            promptId = rs.getObject("prompt_id", UUID::class.java),
            promptVersionId = rs.getObject("prompt_version_id", UUID::class.java),
            workspaceId = rs.getObject("workspace_id", UUID::class.java),
            name = rs.getString("name"),
            description = rs.getString("description"),
            versionTag = rs.getString("version_tag"),
            templateText = rs.getString("template_text"),
            parameters = Json.decodeJsonNode(rs.getString("parameters")),
            isPublished = rs.getBoolean("is_published"),
            createdAt = rs.getObject("created_at", OffsetDateTime::class.java)
        )
    }
}
