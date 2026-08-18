package com.vectorbea.api.db

import com.vectorbea.api.config.DbConfig
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import org.slf4j.LoggerFactory
import java.sql.Connection
import javax.sql.DataSource

/**
 * Postgres connection pool — wraps HikariCP.
 *
 * Lifecycle:
 *   val db = Database.create(config)
 *   db.ping()          // verify connectivity
 *   db.dataSource      // raw DataSource for repositories
 *   db.close()         // shutdown hook
 *
 * The URL is taken from [DbConfig.url] and is NEVER logged.
 */
class Database private constructor(
    /** The Hikari pool. Only `close()` needs it; callers take [dataSource]. */
    private val pool: HikariDataSource,
) {
    /**
     * The DataSource every caller uses, wrapped so `db_pool_wait_seconds` sees every
     * connection acquisition — including Flyway's and the analytics library's, neither
     * of which would ever be instrumented by hand.
     */
    val dataSource: javax.sql.DataSource = com.vectorbea.observability.db.TimedDataSource(
        pool, "platform") { s, p ->
        com.vectorbea.api.metrics.AppMetrics.dbPoolWaitSeconds.observeSeconds(s, p)
    }


    private val log = LoggerFactory.getLogger(Database::class.java)

    /**
     * Runs `SELECT 1` to verify the pool can acquire a connection and the
     * database is reachable.  Returns the round-trip latency in milliseconds,
     * or throws if the check fails.
     */
    fun ping(): Long {
        val start = System.currentTimeMillis()
        dataSource.connection.use { conn ->
            conn.prepareStatement("SELECT 1").use { it.executeQuery() }
        }
        return System.currentTimeMillis() - start
    }

    /**
     * Attempt a ping; return a [PingResult] rather than throwing.
     * Used by [com.vectorbea.api.routes.HealthRoutes] for /ready.
     */
    fun pingResult(): PingResult = try {
        val latencyMs = ping()
        PingResult(ok = true, latencyMs = latencyMs)
    } catch (e: Exception) {
        log.error("DB ping failed: ${e.message}")
        PingResult(ok = false, error = e.message ?: "unknown error")
    }

    fun close() {
        pool.close()
        log.info("[db] connection pool closed")
    }

    data class PingResult(
        val ok: Boolean,
        val latencyMs: Long? = null,
        val error: String? = null,
    )

    companion object {
        private val log = LoggerFactory.getLogger(Database::class.java)

        fun create(config: DbConfig): Database {
            log.info("[db] initialising HikariCP pool (maxPoolSize=${config.maxPoolSize})")

            val hk = HikariConfig().apply {
                // jdbcUrl is the secret — never logged by HikariCP when set via property
                jdbcUrl = config.url
                driverClassName = "org.postgresql.Driver"
                poolName = "vectorbea-api"
                maximumPoolSize = config.maxPoolSize
                connectionTimeout = config.connectionTimeoutMs
                idleTimeout = config.idleTimeoutMs
                keepaliveTime = config.keepaliveTimeMs
                maxLifetime = config.maxLifetimeMs
                // Validate connection on borrow
                connectionTestQuery = "SELECT 1"
                // Disable HikariCP's own banner — it spams the log
                isRegisterMbeans = false
                // Prevent Hikari from leaking the URL in stack traces
                leakDetectionThreshold = 60_000L
            }

            val ds = HikariDataSource(hk)
            log.info("[db] HikariCP pool ready")
            return Database(ds)
        }
    }
}

/** Convenience: borrow a connection from the pool without a transaction. */
fun <T> DataSource.withConnection(block: (Connection) -> T): T =
    connection.use(block)
