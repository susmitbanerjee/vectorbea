package com.vectorbea.api.repository

import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class Environment(
    val id: UUID,
    val workspaceId: UUID,
    val name: String,
    val slug: String,
    val type: String,
    val createdAt: Instant,
    val updatedAt: Instant,
)

class EnvironmentRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(EnvironmentRepository::class.java)

    private val cols = "id, workspace_id, name, slug, type, created_at, updated_at"

    fun findById(id: UUID, workspaceId: UUID): Environment? = queryOne(
        "SELECT $cols FROM environments WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapRow,
    )

    fun findBySlug(slug: String, workspaceId: UUID): Environment? = queryOne(
        "SELECT $cols FROM environments WHERE slug = ? AND workspace_id = ?",
        { setString(1, slug); setUuid(2, workspaceId) },
        ::mapRow,
    )

    /**
     * The workspace's default environment — its oldest — or null when it has none.
     *
     * Separate from [list] because this is on the write path: every request that
     * omits `X-Environment-Id` resolves through it, and `list` runs a COUNT
     * alongside the page for pagination nobody reads here.
     */
    fun firstByWorkspace(workspaceId: UUID): Environment? = queryOne(
        "SELECT $cols FROM environments WHERE workspace_id = ? ORDER BY created_at ASC LIMIT 1",
        { setUuid(1, workspaceId) },
        ::mapRow,
    )

    fun list(workspaceId: UUID, params: PageParams = PageParams()): Page<Environment> = queryPage(
        sql = "SELECT $cols FROM environments WHERE workspace_id = ? ORDER BY created_at ASC",
        countSql = "SELECT COUNT(*) FROM environments WHERE workspace_id = ?",
        params = params,
        bind = { setUuid(1, workspaceId) },
        mapRow = ::mapRow,
    )

    fun create(workspaceId: UUID, name: String, slug: String, type: String): Environment =
        executeReturning(
            """
            INSERT INTO environments (workspace_id, name, slug, type)
            VALUES (?, ?, ?, ?)
            RETURNING $cols
            """.trimIndent(),
            {
                setUuid(1, workspaceId)
                setString(2, name)
                setString(3, slug)
                setString(4, type)
            },
            ::mapRow,
        )

    fun findOrCreate(workspaceId: UUID, slug: String): Environment = executeReturning(
        """
        INSERT INTO environments (workspace_id, name, slug, type)
        VALUES (?, ?, ?, ?)
        ON CONFLICT (workspace_id, slug) DO UPDATE SET slug = EXCLUDED.slug
        RETURNING $cols
        """.trimIndent(),
        {
            setUuid(1, workspaceId)
            setString(2, slug.replaceFirstChar { it.uppercase() })
            setString(3, slug)
            setString(4, slug)
        },
        ::mapRow,
    )

    fun update(id: UUID, workspaceId: UUID, name: String, type: String): Environment? = queryOne(
        """
        UPDATE environments
        SET name = ?, type = ?, updated_at = now()
        WHERE id = ? AND workspace_id = ?
        RETURNING $cols
        """.trimIndent(),
        {
            setString(1, name)
            setString(2, type)
            setUuid(3, id)
            setUuid(4, workspaceId)
        },
        ::mapRow,
    )

    fun delete(id: UUID, workspaceId: UUID): Boolean =
        execute("DELETE FROM environments WHERE id = ? AND workspace_id = ?") {
            setUuid(1, id); setUuid(2, workspaceId)
        } > 0

    private fun mapRow(rs: java.sql.ResultSet) = Environment(
        id = rs.uuid("id"),
        workspaceId = rs.uuid("workspace_id"),
        name = rs.getString("name"),
        slug = rs.getString("slug"),
        type = rs.getString("type"),
        createdAt = rs.instant("created_at"),
        updatedAt = rs.instant("updated_at"),
    )
}
