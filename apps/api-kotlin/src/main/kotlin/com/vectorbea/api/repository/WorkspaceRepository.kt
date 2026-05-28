package com.vectorbea.api.repository

import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class Workspace(
    val id: UUID,
    val name: String,
    val slug: String,
    val createdAt: Instant,
    val updatedAt: Instant,
)

class WorkspaceRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(WorkspaceRepository::class.java)

    fun findById(id: UUID): Workspace? = queryOne(
        "SELECT id, name, slug, created_at, updated_at FROM workspaces WHERE id = ?",
        { setUuid(1, id) },
        ::mapRow,
    )

    fun findBySlug(slug: String): Workspace? = queryOne(
        "SELECT id, name, slug, created_at, updated_at FROM workspaces WHERE slug = ?",
        { setString(1, slug) },
        ::mapRow,
    )

    fun list(params: PageParams = PageParams()): Page<Workspace> = queryPage(
        sql = "SELECT id, name, slug, created_at, updated_at FROM workspaces ORDER BY created_at DESC",
        countSql = "SELECT COUNT(*) FROM workspaces",
        params = params,
        bind = {},
        mapRow = ::mapRow,
    )

    fun create(name: String, slug: String): Workspace = executeReturning(
        """
        INSERT INTO workspaces (name, slug)
        VALUES (?, ?)
        RETURNING id, name, slug, created_at, updated_at
        """.trimIndent(),
        {
            setString(1, name)
            setString(2, slug)
        },
        ::mapRow,
    )

    fun update(id: UUID, name: String): Workspace? = queryOne(
        """
        UPDATE workspaces
        SET name = ?, updated_at = now()
        WHERE id = ?
        RETURNING id, name, slug, created_at, updated_at
        """.trimIndent(),
        {
            setString(1, name)
            setUuid(2, id)
        },
        ::mapRow,
    )

    fun delete(id: UUID): Boolean =
        execute("DELETE FROM workspaces WHERE id = ?") { setUuid(1, id) } > 0

    private fun mapRow(rs: java.sql.ResultSet) = Workspace(
        id = rs.uuid("id"),
        name = rs.getString("name"),
        slug = rs.getString("slug"),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
    )
}
