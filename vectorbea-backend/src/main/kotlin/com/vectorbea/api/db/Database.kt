package com.vectorbea.api.db

import com.vectorbea.api.config.AppConfig
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import java.sql.Connection

open class Database {

    private val dataSource: HikariDataSource?

    /** Production constructor — creates a real HikariCP pool. */
    constructor(config: AppConfig) {
        val hikariConfig = HikariConfig().apply {
            jdbcUrl = config.dbUrl
            username = config.dbUser
            password = config.dbPassword
            driverClassName = "org.postgresql.Driver"

            maximumPoolSize = config.dbPoolMaxSize
            minimumIdle = config.dbPoolMinIdle
            connectionTimeout = config.dbConnectionTimeoutMs
            idleTimeout = config.dbIdleTimeoutMs
            maxLifetime = 1_800_000 // 30 minutes

            connectionTestQuery = "SELECT 1"
            validationTimeout = 3_000

            poolName = "vectorbea-pool"
        }
        dataSource = HikariDataSource(hikariConfig)
    }

    /** Test-only constructor — no connection pool is created. */
    protected constructor() {
        dataSource = null
    }

    open fun getConnection(): Connection =
        dataSource?.connection
            ?: throw UnsupportedOperationException("No database in test mode")

    fun <T> transaction(block: (Connection) -> T): T =
        getConnection().use { connection ->
            connection.autoCommit = false
            try {
                val result = block(connection)
                connection.commit()
                result
            } catch (ex: Exception) {
                connection.rollback()
                throw ex
            } finally {
                connection.autoCommit = true
            }
        }

    fun <T> query(block: (Connection) -> T): T =
        getConnection().use(block)

    fun close() {
        dataSource?.close()
    }
}
