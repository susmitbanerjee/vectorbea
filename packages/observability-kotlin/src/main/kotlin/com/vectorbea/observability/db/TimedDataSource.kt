package com.vectorbea.observability.db

import java.io.PrintWriter
import java.sql.Connection
import java.util.logging.Logger
import javax.sql.DataSource

/**
 * A DataSource that measures how long callers wait for a connection.
 *
 * §5.4 asks for `db_pool_wait_seconds` and says why: "rising means the DB pool is the
 * bottleneck". That is the metric which separates two failures with identical symptoms
 * and opposite fixes — a slow query (add an index) and no connection to run it on
 * (raise the pool, or find what is holding connections).
 *
 * WHY A WRAPPER AND NOT INSTRUMENTATION AT THE CALL SITES
 * ------------------------------------------------------
 * There are well over a hundred `dataSource.connection.use { }` sites across the API
 * and the worker. Timing them individually would miss the ones added next week, and
 * would miss Flyway, Hikari's own housekeeping and any library that takes the
 * DataSource. A wrapper is the only place that sees every acquisition.
 *
 * WHAT THIS DOES NOT MEASURE
 * --------------------------
 * Query time. `getConnection()` returns as soon as a connection is available; what the
 * caller then does with it is `job_execution_duration_seconds` and the per-operation
 * histograms. Keeping them separate is the entire point — conflating them is what makes
 * "the database is slow" an unactionable statement.
 *
 * The overhead is one `System.nanoTime()` pair per acquisition, which is noise next to
 * the JDBC round trip it is measuring.
 */
class TimedDataSource(
    private val delegate: DataSource,
    private val poolName: String,
    private val record: (seconds: Double, pool: String) -> Unit,
) : DataSource by delegate {

    override fun getConnection(): Connection = timed { delegate.connection }

    override fun getConnection(username: String?, password: String?): Connection =
        timed { delegate.getConnection(username, password) }

    private inline fun timed(block: () -> Connection): Connection {
        val startedAt = System.nanoTime()
        try {
            return block()
        } finally {
            // In the `finally` so a timeout waiting for a connection is measured too.
            // Excluding failures would make the metric look best exactly when the pool
            // is most exhausted, which is the opposite of useful.
            record((System.nanoTime() - startedAt) / 1_000_000_000.0, poolName)
        }
    }

    // ── Explicit overrides ────────────────────────────────────────────────────
    // Kotlin's `by` delegation covers these, but Hikari-specific callers sometimes
    // unwrap, so `isWrapperFor`/`unwrap` must reach the delegate rather than answering
    // for the wrapper. Getting this wrong surfaces as a ClassCastException deep inside
    // a library, months later.

    override fun <T : Any?> unwrap(iface: Class<T>?): T =
        if (iface != null && iface.isInstance(this)) iface.cast(this) else delegate.unwrap(iface)

    override fun isWrapperFor(iface: Class<*>?): Boolean =
        (iface != null && iface.isInstance(this)) || delegate.isWrapperFor(iface)

    override fun getLogWriter(): PrintWriter? = delegate.logWriter
    override fun setLogWriter(out: PrintWriter?) { delegate.logWriter = out }
    override fun getParentLogger(): Logger = delegate.parentLogger
}
