package com.vectorbea.api.connector

import com.vectorbea.api.security.Redactor
import org.slf4j.LoggerFactory
import java.sql.DriverManager
import java.util.Properties

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
        val jdbcUrl = resolvePostgresUrl(input)
        val props = Properties().apply {
            setProperty("connectTimeout", CONNECT_TIMEOUT_SECONDS.toString())
            setProperty("socketTimeout", QUERY_TIMEOUT_SECONDS.toString())
            setProperty("loginTimeout", CONNECT_TIMEOUT_SECONDS.toString())
            // SECURITY: SSL preferred but not required for test (may be self-signed in dev)
            setProperty("sslmode", "prefer")
            if (!input.username.isNullOrBlank()) setProperty("user", input.username)
            if (!input.password.isNullOrBlank()) setProperty("password", input.password)
        }

        // SECURITY: do not log jdbcUrl — it may contain credentials
        DriverManager.getConnection(jdbcUrl, props).use { conn ->
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

    private fun resolvePostgresUrl(input: DbTestInput): String {
        // If full URL supplied (may be from secret), use it directly as JDBC URL
        if (!input.connectionUrl.isNullOrBlank()) {
            // Convert postgres:// to jdbc:postgresql:// if needed
            val url = input.connectionUrl
            return when {
                url.startsWith("jdbc:") -> url
                url.startsWith("postgres://") -> "jdbc:postgresql://" + url.removePrefix("postgres://")
                url.startsWith("postgresql://") -> "jdbc:postgresql://" + url.removePrefix("postgresql://")
                else -> "jdbc:postgresql://${url}"
            }
        }
        // Build from components
        val host = input.host ?: "localhost"
        val port = input.port ?: 5432
        val db = input.database ?: "postgres"
        return "jdbc:postgresql://$host:$port/$db"
    }

    // ── MySQL ─────────────────────────────────────────────────────────────────

    private fun testMysql(input: DbTestInput, start: Long): ConnectionTestResult {
        val jdbcUrl = if (!input.connectionUrl.isNullOrBlank()) {
            val url = input.connectionUrl
            when {
                url.startsWith("jdbc:") -> url
                url.startsWith("mysql://") -> "jdbc:mysql://" + url.removePrefix("mysql://")
                else -> "jdbc:mysql://${url}"
            }
        } else {
            val host = input.host ?: "localhost"
            val port = input.port ?: 3306
            val db = input.database ?: ""
            "jdbc:mysql://$host:$port/$db?connectTimeout=${CONNECT_TIMEOUT_SECONDS * 1000}&socketTimeout=${QUERY_TIMEOUT_SECONDS * 1000}"
        }

        val props = Properties().apply {
            if (!input.username.isNullOrBlank()) setProperty("user", input.username)
            if (!input.password.isNullOrBlank()) setProperty("password", input.password)
        }

        DriverManager.getConnection(jdbcUrl, props).use { conn ->
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

    private fun classifyException(e: Exception): Pair<String, String> {
        val msg = e.message?.lowercase() ?: ""
        return when {
            e is java.sql.SQLTimeoutException || msg.contains("timeout") ->
                "TIMEOUT" to "Connection timed out"
            msg.contains("authentication") || msg.contains("password") || msg.contains("auth") ->
                "AUTH_FAILED" to "Database authentication failed — check credentials"
            msg.contains("ssl") || msg.contains("tls") ->
                "TLS_FAILED" to "TLS/SSL handshake failed"
            e is java.net.UnknownHostException || msg.contains("unknown host") ->
                "DNS_FAILED" to "DNS resolution failed — check host"
            e is java.net.ConnectException || msg.contains("connection refused") ->
                "CONNECTION_REFUSED" to "Connection refused — check host and port"
            msg.contains("database") && msg.contains("not exist") ->
                "DATABASE_NOT_FOUND" to "Database not found — check database name"
            e is java.sql.SQLException ->
                "SQL_ERROR" to "Database connection failed"
            else ->
                "CONNECTION_ERROR" to "Connection failed"
        }
    }
}
