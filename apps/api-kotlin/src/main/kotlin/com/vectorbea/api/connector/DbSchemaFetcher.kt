package com.vectorbea.api.connector

import org.slf4j.LoggerFactory
import java.sql.DriverManager
import java.util.Properties

/**
 * Fetches schema metadata (schemas → tables → columns) from a live database.
 *
 * Used by the /api/connections/schema-preview endpoint to power the
 * schema picker UI — letting non-technical users browse their database
 * structure without writing SQL.
 *
 * SECURITY:
 * - Connection string / password NEVER logged.
 * - Results contain only structural metadata — no row data, no credentials.
 * - Timeout is capped at 10s to prevent slow-loris abuse.
 * - Only information_schema is queried — no DDL execution.
 */
object DbSchemaFetcher {

    private val log = LoggerFactory.getLogger(DbSchemaFetcher::class.java)

    private const val CONNECT_TIMEOUT_SECONDS = 10
    private const val QUERY_TIMEOUT_SECONDS = 8

    data class SchemaInput(
        val dbType: String,
        /** Full connection URL — NEVER log */
        val connectionUrl: String?,
        /** Password — NEVER log */
        val password: String?,
        val username: String?,
        val host: String?,
        val port: Int?,
        val database: String?,
    )

    data class ColumnInfo(
        val name: String,
        val dataType: String,
        val nullable: Boolean,
        val isPrimaryKey: Boolean,
        val defaultValue: String?,
        val maxLength: Int?,
    )

    data class TableInfo(
        val schema: String,
        val table: String,
        val tableType: String,   // "TABLE" | "VIEW"
        val columns: List<ColumnInfo>,
        val rowCountEstimate: Long?,
    )

    data class SchemaResult(
        val schemas: List<String>,
        val tables: List<TableInfo>,
        val provider: String,
        val databaseName: String?,
        val fetchedAt: String = java.time.Instant.now().toString(),
    )

    /**
     * The tester's input shape, so both paths resolve credentials identically.
     *
     * Schema preview and "test connection" must agree about what a connection
     * string means. When they parsed it separately they disagreed, and a
     * connection that tested green could still fail to list a single table.
     */
    private fun SchemaInput.toTestInput() = DbTester.DbTestInput(
        dbType = dbType,
        connectionUrl = connectionUrl,
        password = password,
        username = username,
        host = host,
        port = port,
        database = database,
    )

    fun fetch(input: SchemaInput): SchemaResult {
        return when (input.dbType.lowercase()) {
            "postgres", "postgresql", "neon", "supabase" -> fetchPostgres(input)
            "mysql", "mariadb" -> fetchMysql(input)
            else -> throw UnsupportedOperationException(
                "Schema preview is not yet supported for '${input.dbType}'. Supported: postgresql, mysql."
            )
        }
    }

    // ── PostgreSQL ────────────────────────────────────────────────────────────

    private fun fetchPostgres(input: SchemaInput): SchemaResult {
        // Resolved by the SAME parser the connection tester uses. This used to
        // build the JDBC URL by string-swapping the scheme, which left
        // `user:password@` sitting in the authority - and the PostgreSQL driver
        // does not accept credentials there, so it read the whole `user:pass@host`
        // blob as a hostname. The effect was that schema preview failed for every
        // connection string that carried its own credentials, which is nearly all
        // of them. See ConnectionUrl.kt for why URI parsing cannot do this.
        val target = DbTester.resolvePostgresTarget(input.toTestInput())

        return DbTester.attemptWithFallback(target.password, target.alternatePassword) { password ->
        val props = Properties().apply {
            setProperty("connectTimeout", CONNECT_TIMEOUT_SECONDS.toString())
            setProperty("socketTimeout", QUERY_TIMEOUT_SECONDS.toString())
            setProperty("loginTimeout", CONNECT_TIMEOUT_SECONDS.toString())
            if (!target.jdbcUrl.contains("sslmode=", ignoreCase = true)) setProperty("sslmode", "prefer")
            if (!target.username.isNullOrBlank()) setProperty("user", target.username)
            if (!password.isNullOrBlank()) setProperty("password", password)
        }

        DriverManager.getConnection(target.jdbcUrl, props).use { conn ->
            // 1. Fetch non-system schemas
            val schemas = mutableListOf<String>()
            conn.prepareStatement(
                """
                SELECT schema_name FROM information_schema.schemata
                WHERE schema_name NOT IN ('information_schema','pg_catalog','pg_toast',
                    'pg_temp_1','pg_toast_temp_1')
                  AND schema_name NOT LIKE 'pg_%'
                ORDER BY schema_name
                """.trimIndent()
            ).use { stmt ->
                stmt.queryTimeout = QUERY_TIMEOUT_SECONDS
                stmt.executeQuery().use { rs ->
                    while (rs.next()) schemas.add(rs.getString(1))
                }
            }

            // 2. Fetch tables + views for those schemas
            val tables = mutableListOf<TableInfo>()
            if (schemas.isNotEmpty()) {
                val placeholders = schemas.joinToString(",") { "?" }
                conn.prepareStatement(
                    """
                    SELECT table_schema, table_name, table_type
                    FROM information_schema.tables
                    WHERE table_schema IN ($placeholders)
                      AND table_type IN ('BASE TABLE','VIEW')
                    ORDER BY table_schema, table_name
                    LIMIT 200
                    """.trimIndent()
                ).use { stmt ->
                    stmt.queryTimeout = QUERY_TIMEOUT_SECONDS
                    schemas.forEachIndexed { i, s -> stmt.setString(i + 1, s) }
                    stmt.executeQuery().use { rs ->
                        while (rs.next()) {
                            val schema = rs.getString("table_schema")
                            val table  = rs.getString("table_name")
                            val ttype  = rs.getString("table_type")
                            val cols   = fetchPostgresColumns(conn, schema, table)
                            val rows   = if (ttype == "BASE TABLE") estimateRowCount(conn, schema, table) else null
                            tables.add(TableInfo(schema, table, if (ttype == "BASE TABLE") "TABLE" else "VIEW", cols, rows))
                        }
                    }
                }
            }

            val dbName = try { conn.catalog } catch (_: Exception) { input.database }
            SchemaResult(
                schemas = schemas,
                tables  = tables,
                provider = "postgresql",
                databaseName = dbName,
            )
        }
        }
    }

    private fun fetchPostgresColumns(conn: java.sql.Connection, schema: String, table: String): List<ColumnInfo> {
        // Fetch columns
        val pkCols = mutableSetOf<String>()
        // READ FROM THE CATALOG, NOT information_schema.
        //
        // `information_schema.table_constraints` only shows constraints on
        // tables the current role owns or holds a privilege OTHER THAN SELECT
        // on. A read-only reporting role - exactly the kind of credential you
        // would point at a reporting database - therefore sees NO primary keys
        // at all, and every column came back `isPrimaryKey = false`. Measured
        // against a SELECT-only role: information_schema returned 0 rows for a
        // table that plainly has a primary key, while the catalog returned it.
        //
        // That silence is expensive here: the tool builder derives the WHERE
        // clause for updates and deletes from the primary key, so an invisible
        // key means an unqualified statement.
        //
        // `pg_index` is readable by every role, and `indisprimary` is the same
        // fact without the privilege filter.
        conn.prepareStatement(
            """
            SELECT a.attname
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
            WHERE i.indisprimary AND n.nspname = ? AND c.relname = ?
            """.trimIndent()
        ).use { stmt ->
            stmt.queryTimeout = QUERY_TIMEOUT_SECONDS
            stmt.setString(1, schema); stmt.setString(2, table)
            stmt.executeQuery().use { rs -> while (rs.next()) pkCols.add(rs.getString(1)) }
        }

        val cols = mutableListOf<ColumnInfo>()
        conn.prepareStatement(
            """
            SELECT column_name, data_type, is_nullable, column_default,
                   character_maximum_length, numeric_precision
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ?
            ORDER BY ordinal_position
            """.trimIndent()
        ).use { stmt ->
            stmt.queryTimeout = QUERY_TIMEOUT_SECONDS
            stmt.setString(1, schema); stmt.setString(2, table)
            stmt.executeQuery().use { rs ->
                while (rs.next()) {
                    val colName = rs.getString("column_name")
                    cols.add(ColumnInfo(
                        name         = colName,
                        dataType     = rs.getString("data_type"),
                        nullable     = rs.getString("is_nullable") == "YES",
                        isPrimaryKey = colName in pkCols,
                        defaultValue = rs.getString("column_default"),
                        maxLength    = rs.getObject("character_maximum_length") as? Int,
                    ))
                }
            }
        }
        return cols
    }

    private fun estimateRowCount(conn: java.sql.Connection, schema: String, table: String): Long? = try {
        conn.prepareStatement(
            "SELECT reltuples::bigint FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = ? AND c.relname = ?"
        ).use { stmt ->
            stmt.setString(1, schema); stmt.setString(2, table)
            stmt.executeQuery().use { rs -> if (rs.next()) rs.getLong(1).coerceAtLeast(0) else null }
        }
    } catch (_: Exception) { null }

    // ── MySQL ─────────────────────────────────────────────────────────────────

    private fun fetchMysql(input: SchemaInput): SchemaResult {
        // Same shared resolver as Postgres, for the same reason.
        val target = DbTester.resolveMysqlTarget(input.toTestInput())

        return DbTester.attemptWithFallback(target.password, target.alternatePassword) { password ->
        val props = Properties().apply {
            if (!target.username.isNullOrBlank()) setProperty("user", target.username)
            if (!password.isNullOrBlank()) setProperty("password", password)
        }

        DriverManager.getConnection(target.jdbcUrl, props).use { conn ->
            val dbName = try { conn.catalog } catch (_: Exception) { input.database }

            val schemas = mutableListOf<String>()
            if (!dbName.isNullOrBlank()) schemas.add(dbName)
            else {
                conn.prepareStatement(
                    "SELECT schema_name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','mysql','performance_schema','sys') ORDER BY schema_name"
                ).use { stmt ->
                    stmt.executeQuery().use { rs -> while (rs.next()) schemas.add(rs.getString(1)) }
                }
            }

            val tables = mutableListOf<TableInfo>()
            for (schema in schemas.take(5)) {
                conn.prepareStatement(
                    "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME LIMIT 100"
                ).use { stmt ->
                    stmt.setString(1, schema)
                    stmt.executeQuery().use { rs ->
                        while (rs.next()) {
                            val tname = rs.getString("TABLE_NAME")
                            val ttype = rs.getString("TABLE_TYPE")
                            val cols  = fetchMysqlColumns(conn, schema, tname)
                            tables.add(TableInfo(schema, tname, if (ttype == "BASE TABLE") "TABLE" else "VIEW", cols, null))
                        }
                    }
                }
            }

            SchemaResult(schemas = schemas, tables = tables, provider = "mysql", databaseName = dbName)
        }
        }
    }

    private fun fetchMysqlColumns(conn: java.sql.Connection, schema: String, table: String): List<ColumnInfo> {
        val cols = mutableListOf<ColumnInfo>()
        conn.prepareStatement(
            "SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH, COLUMN_KEY FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION"
        ).use { stmt ->
            stmt.setString(1, schema); stmt.setString(2, table)
            stmt.executeQuery().use { rs ->
                while (rs.next()) {
                    cols.add(ColumnInfo(
                        name         = rs.getString("COLUMN_NAME"),
                        dataType     = rs.getString("DATA_TYPE"),
                        nullable     = rs.getString("IS_NULLABLE") == "YES",
                        isPrimaryKey = rs.getString("COLUMN_KEY") == "PRI",
                        defaultValue = rs.getString("COLUMN_DEFAULT"),
                        maxLength    = rs.getObject("CHARACTER_MAXIMUM_LENGTH") as? Int,
                    ))
                }
            }
        }
        return cols
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

}
