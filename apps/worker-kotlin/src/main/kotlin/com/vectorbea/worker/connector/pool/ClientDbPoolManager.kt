package com.vectorbea.worker.connector.pool

import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.SecretValue
import com.vectorbea.worker.logging.logger
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import javax.sql.DataSource

/**
 * Manages per-client-connection HikariCP pools.
 *
 * Each [ConnectionRecord] that requires a JDBC connection gets its own small
 * pool keyed by [ConnectionRecord.id].  Pools are created on first use and
 * reused on subsequent calls.
 *
 * Pool sizing: max [maxConnectionsPerPool] connections per client connection.
 * This is intentionally small — client DB connections are not the worker's
 * own pool; they are outbound tenant connections.
 *
 * SECURITY:
 *  - JDBC URL is built from [ConnectionRecord.configJson], never from
 *    user-supplied template expressions.
 *  - The [SecretValue] (password) is extracted via [SecretValue.asStringRetained]
 *    only for HikariCP pool initialisation, then discarded.
 *  - Pool names never include credentials.
 *  - [close] must be called on shutdown to release all pools.
 */
open class ClientDbPoolManager(
    private val maxConnectionsPerPool: Int = 3,
    private val connectionTimeoutMs: Long = 10_000L,
    private val idleTimeoutMs: Long = 300_000L,
) : AutoCloseable {

    private val log = logger()

    /** Active pools keyed by connection record UUID. */
    private val pools = ConcurrentHashMap<UUID, HikariDataSource>()

    /**
     * Return (and lazily create) a [DataSource] for [record].
     *
     * [secret] is used only during pool creation; after this call it should be
     * discarded by the caller.
     *
     * @throws [ClientDbPoolException] if the pool cannot be created.
     */
    open fun getOrCreate(record: ConnectionRecord, secret: SecretValue?): DataSource {
        // Fast path: pool already exists
        pools[record.id]?.let { return it }

        // Slow path: create under a per-ID lock pattern using computeIfAbsent
        return pools.computeIfAbsent(record.id) { _ ->
            log.info("[clientdb] creating pool [connId={}, provider={}]",
                record.id, record.provider)
            buildPool(record, secret)
        }
    }

    /** Evict and close the pool for [connectionId] (e.g. when connection is deactivated). */
    fun evict(connectionId: UUID) {
        pools.remove(connectionId)?.also { ds ->
            log.info("[clientdb] evicting pool [connId={}]", connectionId)
            ds.close()
        }
    }

    /** Close all managed pools. Safe to call multiple times. */
    override fun close() {
        log.info("[clientdb] closing all {} client pools", pools.size)
        val snapshot = pools.keys.toList()
        for (id in snapshot) {
            evict(id)
        }
    }

    // ── Pool construction ─────────────────────────────────────────────────────

    private fun buildPool(record: ConnectionRecord, secret: SecretValue?): HikariDataSource {
        val jdbcUrl = buildJdbcUrl(record)
        val username = record.configJson["username"] as? String ?: ""

        return try {
            val hk = HikariConfig().apply {
                this.jdbcUrl = jdbcUrl
                driverClassName = driverFor(record.provider)
                poolName = "client-${record.id}"
                maximumPoolSize = maxConnectionsPerPool
                minimumIdle = 1
                connectionTimeout = connectionTimeoutMs
                idleTimeout = idleTimeoutMs
                maxLifetime = 1_800_000L
                connectionTestQuery = "SELECT 1"
                isRegisterMbeans = false
                leakDetectionThreshold = 60_000L

                if (username.isNotBlank()) {
                    this.username = username
                }
                // Set password from secret — never log it
                if (secret != null && !secret.isCleared()) {
                    this.password = secret.asStringRetained()
                }

                // Read-only mode can be set via configJson
                val readOnly = record.configJson["readOnly"] as? Boolean ?: false
                isReadOnly = readOnly
            }
            HikariDataSource(hk)
        } catch (e: Exception) {
            // Sanitize: never include jdbcUrl (may contain credentials) in message
            log.error("[clientdb] failed to create pool [connId={}, provider={}]: {}",
                record.id, record.provider, e.javaClass.simpleName)
            throw ClientDbPoolException(
                "Cannot create pool for connection '${record.name}' (${record.id}): " +
                        e.javaClass.simpleName
            )
        }
    }

    private fun buildJdbcUrl(record: ConnectionRecord): String {
        val cfg = record.configJson

        // Allow an explicit jdbcUrl override in configJson (rare)
        val explicitUrl = cfg["jdbcUrl"] as? String
        if (!explicitUrl.isNullOrBlank()) {
            return normaliseJdbcUrl(explicitUrl, record.provider)
        }

        val host     = cfg["host"] as? String ?: "localhost"
        val port     = cfg["port"]?.toString()?.toIntOrNull() ?: defaultPortFor(record.provider)
        val database = cfg["database"] as? String ?: cfg["dbname"] as? String ?: ""
        val sslMode  = cfg["sslMode"] as? String

        return when (record.provider.lowercase()) {
            "postgresql", "postgres" -> {
                val base = "jdbc:postgresql://$host:$port/$database"
                if (!sslMode.isNullOrBlank()) "$base?sslmode=$sslMode" else base
            }
            "mysql" -> {
                val base = "jdbc:mysql://$host:$port/$database"
                if (!sslMode.isNullOrBlank()) "$base?sslMode=$sslMode" else base
            }
            "mariadb" -> "jdbc:mariadb://$host:$port/$database"
            "sqlserver", "mssql" -> "jdbc:sqlserver://$host:$port;databaseName=$database"
            else -> throw ClientDbPoolException(
                "Unsupported DB provider '${record.provider}' for connection '${record.name}'"
            )
        }
    }

    private fun normaliseJdbcUrl(url: String, provider: String): String =
        when {
            url.startsWith("jdbc:") -> url
            url.startsWith("postgresql://") || url.startsWith("postgres://") ->
                "jdbc:postgresql://" + url.substringAfter("://")
            url.startsWith("mysql://") -> "jdbc:mysql://" + url.substringAfter("://")
            else -> url
        }

    private fun driverFor(provider: String): String = when (provider.lowercase()) {
        "postgresql", "postgres" -> "org.postgresql.Driver"
        "mysql"                  -> "com.mysql.cj.jdbc.Driver"
        "mariadb"                -> "org.mariadb.jdbc.Driver"
        "sqlserver", "mssql"     -> "com.microsoft.sqlserver.jdbc.SQLServerDriver"
        else                     -> "org.postgresql.Driver" // fallback
    }

    private fun defaultPortFor(provider: String): Int = when (provider.lowercase()) {
        "postgresql", "postgres" -> 5432
        "mysql"                  -> 3306
        "mariadb"                -> 3306
        "sqlserver", "mssql"     -> 1433
        else                     -> 5432
    }
}

class ClientDbPoolException(message: String) : Exception(message)
