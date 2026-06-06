package com.vectorbea.telemetry.db

import com.vectorbea.telemetry.config.DbConfig
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import org.slf4j.LoggerFactory
import java.sql.Connection
import javax.sql.DataSource

class Database private constructor(val dataSource: HikariDataSource) {

    private val log = LoggerFactory.getLogger(Database::class.java)

    fun ping(): Long {
        val start = System.currentTimeMillis()
        dataSource.connection.use { conn ->
            conn.prepareStatement("SELECT 1").use { it.executeQuery() }
        }
        return System.currentTimeMillis() - start
    }

    fun pingResult(): PingResult = try {
        val ms = ping()
        PingResult(ok = true, latencyMs = ms)
    } catch (e: Exception) {
        log.error("DB ping failed: ${e.message}")
        PingResult(ok = false, error = e.message ?: "unknown")
    }

    fun close() {
        dataSource.close()
        log.info("[db] connection pool closed")
    }

    data class PingResult(val ok: Boolean, val latencyMs: Long? = null, val error: String? = null)

    companion object {
        private val log = LoggerFactory.getLogger(Database::class.java)

        fun create(config: DbConfig): Database {
            log.info("[db] initialising HikariCP pool (maxPoolSize=${config.maxPoolSize})")
            val hk = HikariConfig().apply {
                jdbcUrl = config.url
                driverClassName = "org.postgresql.Driver"
                poolName = "vectorbea-telemetry"
                maximumPoolSize = config.maxPoolSize
                connectionTimeout = config.connectionTimeoutMs
                idleTimeout = config.idleTimeoutMs
                keepaliveTime = config.keepaliveTimeMs
                maxLifetime = config.maxLifetimeMs
                connectionTestQuery = "SELECT 1"
                isRegisterMbeans = false
                leakDetectionThreshold = 60_000L
            }
            val ds = HikariDataSource(hk)
            log.info("[db] HikariCP pool ready")
            return Database(ds)
        }
    }
}

fun <T> DataSource.withConnection(block: (Connection) -> T): T = connection.use(block)
