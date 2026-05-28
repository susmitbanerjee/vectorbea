package com.vectorbea.api.repository

import com.vectorbea.api.db.withConnection
import com.vectorbea.api.metrics.AppMetrics
import org.slf4j.Logger
import java.sql.PreparedStatement
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Shared JDBC utilities for all repositories.
 *
 * Subclass and inject [DataSource]; use [query], [queryOne], [execute] helpers
 * for all SQL so the parameterized-statement discipline is enforced centrally.
 *
 * Rules enforced here:
 *  - All SQL uses PreparedStatement — never String concatenation with user input.
 *  - All reads are workspace-scoped (workspaceId required on every public method).
 *  - Results are always mapped via explicit [mapRow] functions; no reflection.
 */
abstract class BaseRepository(protected val dataSource: DataSource) {

    protected abstract val log: Logger

    // ── Query helpers ─────────────────────────────────────────────────────────

    /**
     * Executes a SELECT and maps each row with [mapRow].
     * [bind] sets PreparedStatement parameters (1-indexed).
     */
    protected fun <T> query(
        sql: String,
        bind: PreparedStatement.() -> Unit = {},
        mapRow: (ResultSet) -> T,
    ): List<T> {
        val t0 = System.currentTimeMillis()
        return try {
            dataSource.withConnection { conn ->
                conn.prepareStatement(sql).use { stmt ->
                    stmt.bind()
                    stmt.executeQuery().use { rs ->
                        buildList { while (rs.next()) add(mapRow(rs)) }
                    }
                }
            }
        } finally {
            AppMetrics.dbQueryDuration.observe(System.currentTimeMillis() - t0, "query")
        }
    }

    /** Executes a SELECT and returns the first row, or null if empty. */
    protected fun <T> queryOne(
        sql: String,
        bind: PreparedStatement.() -> Unit = {},
        mapRow: (ResultSet) -> T,
    ): T? {
        val t0 = System.currentTimeMillis()
        return try {
            dataSource.withConnection { conn ->
                conn.prepareStatement(sql).use { stmt ->
                    stmt.bind()
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) mapRow(rs) else null
                    }
                }
            }
        } finally {
            AppMetrics.dbQueryDuration.observe(System.currentTimeMillis() - t0, "query_one")
        }
    }

    /**
     * Executes a paginated SELECT and returns a [Page<T>].
     * [countSql] must be the same query wrapped in `SELECT COUNT(*) FROM (…) c`.
     */
    protected fun <T> queryPage(
        sql: String,
        countSql: String,
        params: PageParams,
        bind: PreparedStatement.() -> Unit = {},
        mapRow: (ResultSet) -> T,
    ): Page<T> = dataSource.withConnection { conn ->
        val total = conn.prepareStatement(countSql).use { stmt ->
            stmt.bind()
            stmt.executeQuery().use { rs -> if (rs.next()) rs.getLong(1) else 0L }
        }
        val items = conn.prepareStatement(sql).use { stmt ->
            stmt.bind()
            stmt.executeQuery().use { rs ->
                buildList { while (rs.next()) add(mapRow(rs)) }
            }
        }
        Page(items = items, total = total, page = params.page, pageSize = params.pageSize)
    }

    /** Executes INSERT / UPDATE / DELETE and returns rows affected. */
    protected fun execute(
        sql: String,
        bind: PreparedStatement.() -> Unit = {},
    ): Int {
        val t0 = System.currentTimeMillis()
        return try {
            dataSource.withConnection { conn ->
                conn.prepareStatement(sql).use { stmt ->
                    stmt.bind()
                    stmt.executeUpdate()
                }
            }
        } finally {
            AppMetrics.dbQueryDuration.observe(System.currentTimeMillis() - t0, "execute")
        }
    }

    /**
     * Executes INSERT … RETURNING and maps the single returned row.
     * Throws [IllegalStateException] if nothing is returned.
     */
    protected fun <T> executeReturning(
        sql: String,
        bind: PreparedStatement.() -> Unit = {},
        mapRow: (ResultSet) -> T,
    ): T {
        val t0 = System.currentTimeMillis()
        return try {
            dataSource.withConnection { conn ->
                conn.prepareStatement(sql).use { stmt ->
                    stmt.bind()
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) mapRow(rs)
                        else throw IllegalStateException("INSERT RETURNING produced no row")
                    }
                }
            }
        } finally {
            AppMetrics.dbQueryDuration.observe(System.currentTimeMillis() - t0, "execute_returning")
        }
    }

    // ── ResultSet helpers ─────────────────────────────────────────────────────

    protected fun ResultSet.uuid(col: String): UUID = UUID.fromString(getString(col))
    protected fun ResultSet.uuidOrNull(col: String): UUID? = getString(col)?.let { UUID.fromString(it) }
    protected fun ResultSet.instant(col: String): Instant = getTimestamp(col).toInstant()
    protected fun ResultSet.instantOrNull(col: String): Instant? = getTimestamp(col)?.toInstant()

    // ── PreparedStatement helpers ─────────────────────────────────────────────

    protected fun PreparedStatement.setUuid(index: Int, uuid: UUID) = setObject(index, uuid)
    protected fun PreparedStatement.setUuidOrNull(index: Int, uuid: UUID?) =
        if (uuid != null) setObject(index, uuid) else setNull(index, java.sql.Types.OTHER)
    protected fun PreparedStatement.setInstant(index: Int, instant: Instant) =
        setTimestamp(index, Timestamp.from(instant))
    protected fun PreparedStatement.setInstantOrNull(index: Int, instant: Instant?) =
        if (instant != null) setTimestamp(index, Timestamp.from(instant)) else setNull(index, java.sql.Types.TIMESTAMP_WITH_TIMEZONE)
}
