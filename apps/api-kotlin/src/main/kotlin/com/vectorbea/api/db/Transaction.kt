package com.vectorbea.api.db

import org.slf4j.LoggerFactory
import java.sql.Connection
import java.sql.Savepoint
import javax.sql.DataSource

private val txLog = LoggerFactory.getLogger("com.vectorbea.api.db.transaction")

/**
 * Executes [block] inside a single JDBC transaction.
 *
 * - Acquires a connection from the pool.
 * - Disables auto-commit.
 * - Commits on success.
 * - Rolls back and rethrows on any exception.
 * - Restores auto-commit and returns the connection to the pool.
 *
 * Usage:
 * ```kotlin
 * val run = db.dataSource.transaction { conn ->
 *     runRepo.create(conn, ...)
 *     eventRepo.create(conn, ...)  // same connection → same tx
 * }
 * ```
 */
fun <T> DataSource.transaction(block: (Connection) -> T): T {
    val conn = connection
    val prevAutoCommit = conn.autoCommit
    conn.autoCommit = false
    return try {
        val result = block(conn)
        conn.commit()
        result
    } catch (e: Exception) {
        try {
            conn.rollback()
            txLog.debug("[tx] rolled back due to: ${e.javaClass.simpleName}: ${e.message}")
        } catch (rollbackEx: Exception) {
            txLog.error("[tx] rollback failed: ${rollbackEx.message}", rollbackEx)
        }
        throw e
    } finally {
        try {
            conn.autoCommit = prevAutoCommit
        } catch (_: Exception) { /* best-effort */ }
        conn.close()  // returns to HikariCP pool
    }
}

/**
 * Creates a JDBC savepoint named [name] and rolls back to it if [block] throws.
 * The outer transaction is NOT rolled back — only changes since the savepoint.
 *
 * Useful for "try this step; if it fails, skip and continue" patterns.
 */
fun <T> Connection.savepoint(name: String, block: (Savepoint) -> T): T {
    val sp = setSavepoint(name)
    return try {
        block(sp)
    } catch (e: Exception) {
        rollback(sp)
        throw e
    } finally {
        try { releaseSavepoint(sp) } catch (_: Exception) { /* already released */ }
    }
}
