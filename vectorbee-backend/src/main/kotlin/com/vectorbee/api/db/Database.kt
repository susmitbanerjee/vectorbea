package com.vectorbee.api.db

import com.vectorbee.api.config.AppConfig
import java.sql.Connection
import java.sql.DriverManager

class Database(private val config: AppConfig) {
    init {
        Class.forName("org.postgresql.Driver")
    }

    fun getConnection(): Connection =
        DriverManager.getConnection(config.dbUrl, config.dbUser, config.dbPassword)

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
}
