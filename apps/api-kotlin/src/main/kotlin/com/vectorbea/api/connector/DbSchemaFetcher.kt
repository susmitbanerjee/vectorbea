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

    /**
     * Per-read socket ceiling, above the per-query one.
     *
     * These were the same number, which left no headroom: a query allowed 8s to
     * run was killed by the socket at exactly 8s, and the error surfaced as a
     * read timeout rather than as the query timeout that was actually intended.
     */
    private const val SOCKET_TIMEOUT_SECONDS = 15

    /** Beyond this the picker is unusable anyway, and the payload is large. */
    private const val MAX_TABLES = 200

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
        /**
         * Whether the connection insists on TLS.
         *
         * Carried so introspection negotiates exactly as the connection test
         * did. It was absent here, so a connection saved with `sslRequired`
         * tested under `sslmode=require` and introspected under `prefer` — two
         * different conversations with the same server, for no reason anybody
         * chose.
         */
        val sslRequired: Boolean? = null,
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
        sslRequired = sslRequired,
    )

    /** The tester's input, as a schema input. The two describe the same target. */
    fun from(input: DbTester.DbTestInput) = SchemaInput(
        dbType = input.dbType,
        connectionUrl = input.connectionUrl,
        password = input.password,
        username = input.username,
        host = input.host,
        port = input.port,
        database = input.database,
        sslRequired = input.sslRequired,
    )

    /*
     * DISPATCHED ON THE SAME SETS THE TESTER USES, and for the same reason it
     * gives: the families are keyed on the WIRE PROTOCOL, not the vendor. This
     * carried its own four-name allowlist — postgres, postgresql, neon,
     * supabase — so Timescale, Cockroach, Redshift, RDS, Aurora, AlloyDB and
     * PlanetScale could all be tested green and then refuse to list a table,
     * purely because nobody had added the string here as well. Two lists that
     * had to be edited together were only ever going to be edited once.
     */
    fun fetch(input: SchemaInput): SchemaResult {
        return when (input.dbType.lowercase()) {
            in DbTester.POSTGRES_WIRE -> fetchPostgres(input)
            in DbTester.MYSQL_WIRE -> fetchMysql(input)
            else -> throw UnsupportedOperationException(
                "Schema preview is not yet supported for '${input.dbType}'. " +
                    "Supported: PostgreSQL-compatible and MySQL-compatible databases."
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
                setProperty("socketTimeout", SOCKET_TIMEOUT_SECONDS.toString())
                setProperty("loginTimeout", CONNECT_TIMEOUT_SECONDS.toString())
                /*
                 * ── NEVER SERVER-PREPARE DURING INTROSPECTION ────────────────
                 *
                 * pgjdbc promotes a statement to a named server-side prepared
                 * statement once the same SQL has run `prepareThreshold` times
                 * (default 5). Introspection reruns the same three queries for
                 * every table, so from the fifth table onward every query was
                 * server-prepared — and a TRANSACTION-MODE POOLER cannot carry
                 * those across the connections it multiplexes. Supabase's
                 * Supavisor, PgBouncer and RDS Proxy all run that way, and they
                 * are the connection strings those dashboards hand out.
                 *
                 * The failure looked exactly like the report: "test connection"
                 * passed, because that is ONE `SELECT 1` over the simple
                 * protocol, and schema preview then failed on a database with
                 * more than four tables. `prepareThreshold=0` disables the
                 * promotion. Introspection runs once and throws the connection
                 * away, so there is nothing to gain from caching plans anyway.
                 */
                setProperty("prepareThreshold", "0")
                // Matches the tester exactly. Diverging here is how a connection
                // that tested green failed to introspect.
                if (!target.jdbcUrl.contains("sslmode=", ignoreCase = true)) {
                    setProperty("sslmode", if (input.sslRequired == true) "require" else "prefer")
                }
                if (!target.username.isNullOrBlank()) setProperty("user", target.username)
                if (!password.isNullOrBlank()) setProperty("password", password)
            }

            DriverManager.getConnection(target.jdbcUrl, props).use { conn ->
                /*
                 * FIVE ROUND TRIPS, NOT SIX HUNDRED.
                 *
                 * This used to query the primary key, the columns and the row
                 * estimate once PER TABLE — up to 200 tables, so up to 601
                 * round trips. Against a managed database 80ms away that is
                 * roughly a minute of latency alone, comfortably past the
                 * client's 30s ceiling and past any pooler's idle limit. The
                 * same information comes back in one query each, filtered to the
                 * tables we selected and grouped in memory.
                 */
                val schemas = fetchPostgresSchemas(conn)
                if (schemas.isEmpty()) {
                    return@attemptWithFallback SchemaResult(
                        schemas = emptyList(),
                        tables = emptyList(),
                        provider = "postgresql",
                        databaseName = catalogOf(conn, input),
                    )
                }

                val located = fetchPostgresTableList(conn, schemas)
                val keys = if (located.isEmpty()) emptyMap() else fetchPostgresPrimaryKeys(conn, located)
                val columns = if (located.isEmpty()) emptyMap() else fetchPostgresColumns(conn, located, keys)
                val rowCounts = if (located.isEmpty()) emptyMap() else fetchPostgresRowCounts(conn, located)

                val tables = located.map { (key, tableType) ->
                    TableInfo(
                        schema = key.first,
                        table = key.second,
                        tableType = tableType,
                        columns = columns[key] ?: emptyList(),
                        rowCountEstimate = if (tableType == "TABLE") rowCounts[key] else null,
                    )
                }

                SchemaResult(
                    schemas = schemas,
                    tables = tables,
                    provider = "postgresql",
                    databaseName = catalogOf(conn, input),
                )
            }
        }
    }

    private fun catalogOf(conn: java.sql.Connection, input: SchemaInput): String? =
        try { conn.catalog } catch (_: Exception) { input.database }

    /** Non-system schemas, in name order. */
    private fun fetchPostgresSchemas(conn: java.sql.Connection): List<String> {
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
            stmt.executeQuery().use { rs -> while (rs.next()) schemas.add(rs.getString(1)) }
        }
        return schemas
    }

    /** (schema, table) -> "TABLE" | "VIEW", capped, in a stable order. */
    private fun fetchPostgresTableList(
        conn: java.sql.Connection,
        schemas: List<String>,
    ): Map<Pair<String, String>, String> {
        val located = LinkedHashMap<Pair<String, String>, String>()
        val placeholders = schemas.joinToString(",") { "?" }
        conn.prepareStatement(
            """
            SELECT table_schema, table_name, table_type
            FROM information_schema.tables
            WHERE table_schema IN ($placeholders)
              AND table_type IN ('BASE TABLE','VIEW')
            ORDER BY table_schema, table_name
            LIMIT $MAX_TABLES
            """.trimIndent()
        ).use { stmt ->
            stmt.queryTimeout = QUERY_TIMEOUT_SECONDS
            schemas.forEachIndexed { i, value -> stmt.setString(i + 1, value) }
            stmt.executeQuery().use { rs ->
                while (rs.next()) {
                    val key = rs.getString("table_schema") to rs.getString("table_name")
                    located[key] = if (rs.getString("table_type") == "BASE TABLE") "TABLE" else "VIEW"
                }
            }
        }
        return located
    }

    /**
     * Primary-key columns for every selected table, in one query.
     *
     * READ FROM THE CATALOG, NOT information_schema.
     *
     * `information_schema.table_constraints` only shows constraints on tables the
     * current role owns or holds a privilege OTHER THAN SELECT on. A read-only
     * reporting role — exactly the kind of credential you would point at a
     * reporting database — therefore sees NO primary keys at all, and every
     * column came back `isPrimaryKey = false`. Measured against a SELECT-only
     * role: information_schema returned 0 rows for a table that plainly has a
     * primary key, while the catalog returned it.
     *
     * That silence is expensive here: the tool builder derives the WHERE clause
     * for updates and deletes from the primary key, so an invisible key means an
     * unqualified statement.
     *
     * `pg_index` is readable by every role, and `indisprimary` is the same fact
     * without the privilege filter.
     */
    private fun fetchPostgresPrimaryKeys(
        conn: java.sql.Connection,
        located: Map<Pair<String, String>, String>,
    ): Map<Pair<String, String>, Set<String>> {
        val keys = mutableMapOf<Pair<String, String>, MutableSet<String>>()
        conn.prepareStatement(
            """
            SELECT n.nspname AS schema_name, c.relname AS table_name, a.attname AS column_name
            FROM pg_index i
            JOIN pg_class c ON c.oid = i.indrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey)
            WHERE i.indisprimary
              AND n.nspname = ANY(?)
              AND c.relname = ANY(?)
            """.trimIndent()
        ).use { stmt ->
            stmt.queryTimeout = QUERY_TIMEOUT_SECONDS
            bindNameArrays(conn, stmt, located)
            stmt.executeQuery().use { rs ->
                while (rs.next()) {
                    val key = rs.getString("schema_name") to rs.getString("table_name")
                    // The two ANY() filters match a cross product, so a table name
                    // that exists in two schemas comes back for both. Keeping only
                    // pairs we actually selected is what makes that harmless.
                    if (key in located) keys.getOrPut(key) { mutableSetOf() }.add(rs.getString("column_name"))
                }
            }
        }
        return keys
    }

    /** Every column of every selected table, in one query, in ordinal order. */
    private fun fetchPostgresColumns(
        conn: java.sql.Connection,
        located: Map<Pair<String, String>, String>,
        keys: Map<Pair<String, String>, Set<String>>,
    ): Map<Pair<String, String>, List<ColumnInfo>> {
        val columns = mutableMapOf<Pair<String, String>, MutableList<ColumnInfo>>()
        conn.prepareStatement(
            """
            SELECT table_schema, table_name, column_name, data_type, is_nullable,
                   column_default, character_maximum_length
            FROM information_schema.columns
            WHERE table_schema = ANY(?) AND table_name = ANY(?)
            ORDER BY table_schema, table_name, ordinal_position
            """.trimIndent()
        ).use { stmt ->
            stmt.queryTimeout = QUERY_TIMEOUT_SECONDS
            bindNameArrays(conn, stmt, located)
            stmt.executeQuery().use { rs ->
                while (rs.next()) {
                    val key = rs.getString("table_schema") to rs.getString("table_name")
                    if (key !in located) continue
                    val name = rs.getString("column_name")
                    columns.getOrPut(key) { mutableListOf() }.add(
                        ColumnInfo(
                            name = name,
                            dataType = rs.getString("data_type"),
                            nullable = rs.getString("is_nullable") == "YES",
                            isPrimaryKey = keys[key]?.contains(name) == true,
                            defaultValue = rs.getString("column_default"),
                            maxLength = rs.getObject("character_maximum_length") as? Int,
                        )
                    )
                }
            }
        }
        return columns
    }

    /** Planner row estimates for every selected table, in one query. */
    private fun fetchPostgresRowCounts(
        conn: java.sql.Connection,
        located: Map<Pair<String, String>, String>,
    ): Map<Pair<String, String>, Long> = try {
        val counts = mutableMapOf<Pair<String, String>, Long>()
        conn.prepareStatement(
            """
            SELECT n.nspname AS schema_name, c.relname AS table_name, c.reltuples::bigint AS rows
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE c.relkind = 'r' AND n.nspname = ANY(?) AND c.relname = ANY(?)
            """.trimIndent()
        ).use { stmt ->
            stmt.queryTimeout = QUERY_TIMEOUT_SECONDS
            bindNameArrays(conn, stmt, located)
            stmt.executeQuery().use { rs ->
                while (rs.next()) {
                    val key = rs.getString("schema_name") to rs.getString("table_name")
                    if (key in located) counts[key] = rs.getLong("rows").coerceAtLeast(0)
                }
            }
        }
        counts
    } catch (_: Exception) {
        // A row estimate is a nicety. Losing it must not lose the schema.
        emptyMap()
    }

    /** Binds the schema-name and table-name arrays the three bulk queries share. */
    private fun bindNameArrays(
        conn: java.sql.Connection,
        stmt: java.sql.PreparedStatement,
        located: Map<Pair<String, String>, String>,
    ) {
        val schemaNames = located.keys.map { it.first }.distinct().toTypedArray()
        val tableNames = located.keys.map { it.second }.distinct().toTypedArray()
        stmt.setArray(1, conn.createArrayOf("text", schemaNames))
        stmt.setArray(2, conn.createArrayOf("text", tableNames))
    }

    // ── MySQL ─────────────────────────────────────────────────────────────────

    private fun fetchMysql(input: SchemaInput): SchemaResult {
        // Same shared resolver as Postgres, for the same reason.
        val target = DbTester.resolveMysqlTarget(input.toTestInput())

        return DbTester.attemptWithFallback(target.password, target.alternatePassword) { password ->
        val props = Properties().apply {
            setProperty("connectTimeout", (CONNECT_TIMEOUT_SECONDS * 1000).toString())
            setProperty("socketTimeout", (SOCKET_TIMEOUT_SECONDS * 1000).toString())
            // The MySQL equivalent of prepareThreshold=0. Off by default in
            // Connector/J, set explicitly so a URL that turns it on cannot break
            // introspection through a pooler.
            setProperty("useServerPrepStmts", "false")
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
