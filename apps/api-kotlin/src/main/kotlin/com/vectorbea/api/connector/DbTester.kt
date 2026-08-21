package com.vectorbea.api.connector

import com.vectorbea.api.security.Redactor
import org.slf4j.LoggerFactory
import java.sql.DriverManager
import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.Properties
import java.sql.SQLException
import java.sql.SQLTimeoutException

/**
 * Tests database connections by opening a JDBC connection and executing
 * a lightweight query (SELECT 1 for Postgres/MySQL, db.runCommand for MongoDB).
 *
 * SECURITY:
 * - The connection string / password is NEVER logged.
 * - Redacted form is used for any diagnostic output.
 * - Errors are sanitized before return — no host/user/password in messages.
 */
object DbTester {

    private val log = LoggerFactory.getLogger(DbTester::class.java)

    private const val CONNECT_TIMEOUT_SECONDS = 10
    private const val QUERY_TIMEOUT_SECONDS = 8

    data class DbTestInput(
        val dbType: String,      // "postgres" | "mysql" | "mongodb"
        /** Full JDBC/connection URL — NEVER log this */
        val connectionUrl: String?,
        /** Plain password — NEVER log this */
        val password: String?,
        val username: String?,
        val host: String?,
        val port: Int?,
        val database: String?,
        val sslRequired: Boolean? = null,
    )

    fun test(input: DbTestInput): ConnectionTestResult {
        val start = System.currentTimeMillis()
        return try {
            when (input.dbType.lowercase()) {
                "postgres", "postgresql", "neon", "supabase" -> testPostgres(input, start)
                "mysql", "mariadb" -> testMysql(input, start)
                "mongodb" -> testMongoDB(input, start)
                else -> ConnectionTestResult.failed(0, "UNSUPPORTED_DB",
                    "Database type '${input.dbType}' is not yet supported for testing")
            }
        } catch (e: Exception) {
            val latency = System.currentTimeMillis() - start
            // SECURITY: do not include e.message (may contain connection string details)
            val (code, msg) = classifyException(e)
            log.warn("DB connection test failed [dbType={}] errorClass={}", input.dbType, e.javaClass.simpleName)
            ConnectionTestResult.failed(latency, code, msg)
        }
    }

    // ── Postgres ──────────────────────────────────────────────────────────────

    private fun testPostgres(input: DbTestInput, start: Long): ConnectionTestResult {
        val target = resolvePostgresTarget(input)
        val props = Properties().apply {
            setProperty("connectTimeout", CONNECT_TIMEOUT_SECONDS.toString())
            setProperty("socketTimeout", QUERY_TIMEOUT_SECONDS.toString())
            setProperty("loginTimeout", CONNECT_TIMEOUT_SECONDS.toString())
            // SECURITY: SSL preferred but not required for test (may be self-signed in dev)
            setProperty("sslmode", if (input.sslRequired == true) "require" else "prefer")
            if (!target.username.isNullOrBlank()) setProperty("user", target.username)
            if (!target.password.isNullOrBlank()) setProperty("password", target.password)
        }

        // SECURITY: do not log jdbcUrl — it may contain credentials
        DriverManager.getConnection(target.jdbcUrl, props).use { conn ->
            conn.createStatement().use { stmt ->
                stmt.queryTimeout = QUERY_TIMEOUT_SECONDS
                stmt.executeQuery("SELECT 1").use { rs ->
                    rs.next()
                    val latencyMs = System.currentTimeMillis() - start
                    val version = safeGetDbVersion(conn)
                    return ConnectionTestResult.connected(
                        latencyMs = latencyMs,
                        message = "PostgreSQL connection successful",
                        details = mapOf("dbVersion" to version),
                    )
                }
            }
        }
    }

    internal data class PostgresTarget(
        val jdbcUrl: String,
        val username: String?,
        val password: String?,
    )

    /** Convert common postgres:// URLs into a JDBC URL and JDBC properties.
     * PostgreSQL's JDBC driver does not accept user:password in the URL authority,
     * so credentials must be extracted before opening the connection. */
    internal fun resolvePostgresTarget(input: DbTestInput): PostgresTarget {
        if (!input.connectionUrl.isNullOrBlank()) {
            val url = input.connectionUrl
            val uriValue = when {
                url.startsWith("jdbc:postgresql://") -> url.removePrefix("jdbc:")
                url.startsWith("postgres://") -> "postgresql://" + url.removePrefix("postgres://")
                url.startsWith("postgresql://") -> url
                else -> null
            }
            if (uriValue != null) {
                val uri = URI(uriValue)
                val userInfo = uri.rawUserInfo?.split(":", limit = 2).orEmpty()
                val decodedUser = userInfo.getOrNull(0)?.let(::percentDecode)
                val decodedPassword = userInfo.getOrNull(1)?.let(::percentDecode)
                val host = uri.host ?: throw IllegalArgumentException("PostgreSQL URL must include a host")
                val renderedHost = if (host.contains(':')) "[$host]" else host
                val authority = if (uri.port >= 0) "$renderedHost:${uri.port}" else renderedHost
                val query = uri.rawQuery?.let { "?$it" }.orEmpty()
                return PostgresTarget(
                    jdbcUrl = "jdbc:postgresql://$authority${uri.rawPath.orEmpty()}$query",
                    username = input.username ?: decodedUser,
                    password = input.password ?: decodedPassword,
                )
            }
            return PostgresTarget(
                jdbcUrl = if (url.startsWith("jdbc:")) url else "jdbc:postgresql://$url",
                username = input.username,
                password = input.password,
            )
        }
        val host = input.host ?: "localhost"
        val port = input.port ?: 5432
        val db = input.database ?: "postgres"
        return PostgresTarget("jdbc:postgresql://$host:$port/$db", input.username, input.password)
    }

    private fun percentDecode(value: String): String =
        URLDecoder.decode(value.replace("+", "%2B"), StandardCharsets.UTF_8)

    // ── MySQL ─────────────────────────────────────────────────────────────────

    private fun testMysql(input: DbTestInput, start: Long): ConnectionTestResult {
        val target = resolveMysqlTarget(input)
        val props = Properties().apply {
            setProperty("connectTimeout", (CONNECT_TIMEOUT_SECONDS * 1000).toString())
            setProperty("socketTimeout", (QUERY_TIMEOUT_SECONDS * 1000).toString())
            if (!target.username.isNullOrBlank()) setProperty("user", target.username)
            if (!target.password.isNullOrBlank()) setProperty("password", target.password)
        }

        DriverManager.getConnection(target.jdbcUrl, props).use { conn ->
            conn.createStatement().use { stmt ->
                stmt.queryTimeout = QUERY_TIMEOUT_SECONDS
                stmt.executeQuery("SELECT 1").use { rs ->
                    rs.next()
                    val latency = System.currentTimeMillis() - start
                    return ConnectionTestResult.connected(latency, "MySQL connection successful")
                }
            }
        }
    }

    internal data class MysqlTarget(
        val jdbcUrl: String,
        val username: String?,
        val password: String?,
    )

    internal fun resolveMysqlTarget(input: DbTestInput): MysqlTarget {
        if (!input.connectionUrl.isNullOrBlank()) {
            val raw = input.connectionUrl
            val uriValue = when {
                raw.startsWith("jdbc:mysql://") -> raw.removePrefix("jdbc:")
                raw.startsWith("mysql://") -> raw
                else -> null
            }
            if (uriValue != null) {
                val uri = URI(uriValue)
                val userInfo = uri.rawUserInfo?.split(":", limit = 2).orEmpty()
                val host = uri.host ?: throw IllegalArgumentException("MySQL URL must include a host")
                val renderedHost = if (host.contains(':')) "[$host]" else host
                val authority = if (uri.port >= 0) "$renderedHost:${uri.port}" else renderedHost
                val query = uri.rawQuery?.let { "?$it" }.orEmpty()
                return MysqlTarget(
                    jdbcUrl = "jdbc:mysql://$authority${uri.rawPath.orEmpty()}$query",
                    username = input.username ?: userInfo.getOrNull(0)?.let(::percentDecode),
                    password = input.password ?: userInfo.getOrNull(1)?.let(::percentDecode),
                )
            }
            return MysqlTarget(
                jdbcUrl = if (raw.startsWith("jdbc:")) raw else "jdbc:mysql://$raw",
                username = input.username,
                password = input.password,
            )
        }

        return run {
            val host = input.host ?: "localhost"
            val port = input.port ?: 3306
            val db = input.database ?: ""
            MysqlTarget("jdbc:mysql://$host:$port/$db", input.username, input.password)
        }
    }

    // ── MongoDB (scaffold) ────────────────────────────────────────────────────

    private fun testMongoDB(input: DbTestInput, start: Long): ConnectionTestResult {
        // MongoDB driver not on classpath — return informative failure
        // When the mongo-driver dependency is added, implement here.
        return ConnectionTestResult.failed(
            latencyMs = System.currentTimeMillis() - start,
            errorCode = "DRIVER_NOT_AVAILABLE",
            message = "MongoDB driver not available in this build. Add mongo-driver-sync dependency."
        )
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun safeGetDbVersion(conn: java.sql.Connection): String? = try {
        conn.metaData.databaseProductVersion
    } catch (_: Exception) { null }

    internal fun classifyException(e: Exception): Pair<String, String> {
        val chain = generateSequence<Throwable>(e) { it.cause }.take(12).toList()
        val msg = chain.joinToString(" ") { it.message.orEmpty().lowercase() }
        val sqlState = chain.filterIsInstance<SQLException>().firstNotNullOfOrNull { it.sqlState }
        return when {
            chain.any { it is SQLTimeoutException || it is java.net.SocketTimeoutException } || msg.contains("timeout") ->
                "TIMEOUT" to "Database connection timed out — check network access, host, and port"
            sqlState?.startsWith("28") == true || msg.contains("authentication") ||
                msg.contains("password authentication failed") || msg.contains("access denied for user") ->
                "AUTH_FAILED" to "Database authentication failed — check credentials"
            sqlState == "3D000" || (msg.contains("database") && msg.contains("not exist")) ->
                "DATABASE_NOT_FOUND" to "Database not found — check database name"
            msg.contains("no suitable driver") ->
                "DRIVER_NOT_AVAILABLE" to "This database driver is not available in the API service"
            msg.contains("ssl") || msg.contains("tls") || msg.contains("certificate") ->
                "TLS_FAILED" to "TLS/SSL handshake failed — check the server certificate and SSL mode"
            chain.any { it is java.net.UnknownHostException } || msg.contains("unknown host") ->
                "DNS_FAILED" to "Database host could not be resolved — check the hostname"
            chain.any { it is java.net.ConnectException } || msg.contains("connection refused") ->
                "CONNECTION_REFUSED" to "Database refused the connection — check host, port, and firewall rules"
            e is IllegalArgumentException || e is java.net.URISyntaxException ->
                "INVALID_CONNECTION_STRING" to "The database connection string is invalid"
            sqlState?.startsWith("08") == true ->
                "NETWORK_UNREACHABLE" to "Database could not be reached from Vectorbea — allow the service egress IPs or configure a private runner"
            chain.any { it is SQLException } ->
                "DATABASE_ERROR" to "Database rejected the connection test"
            else ->
                "CONNECTION_ERROR" to "Database connection failed — verify the connection settings and network access"
        }
    }
}
