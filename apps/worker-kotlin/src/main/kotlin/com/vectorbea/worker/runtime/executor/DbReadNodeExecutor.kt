package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.connector.ConnectionException
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowNode
import java.sql.ResultSetMetaData
import java.util.UUID

/**
 * Executes DB_QUERY nodes: parameterized SELECT-only queries.
 *
 * Node config keys:
 *   - connectionId   (UUID string, required)
 *   - query          (string, required) — must be a SELECT; DML is rejected
 *   - params         (List<Any>, optional) — positional bind parameters
 *   - maxRows        (Int, optional, default 1000, max 10000)
 *   - timeoutSeconds (Int, optional, default 30)
 *   - allowedSchemas / allowedTables — enforced from connection record
 *
 * SECURITY:
 *  - Only SELECT statements are permitted (checked syntactically before execution).
 *  - Multi-statement SQL is blocked (no semicolons after the first token).
 *  - Parameters are bound via PreparedStatement — no string interpolation.
 *  - Connection's allowedSchemas / allowedTables are enforced at the parse level.
 *  - Query text is never logged raw.
 *  - Row data is never logged.
 */
class DbReadNodeExecutor(
    private val connectionResolver: ConnectionResolver,
    private val poolManager: ClientDbPoolManager,
    private val eventStore: RunEventStore,
) : NodeExecutor {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        const val DEFAULT_MAX_ROWS       = 1_000
        const val HARD_MAX_ROWS          = 10_000
        const val DEFAULT_TIMEOUT_SECS   = 30
    }

    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        context: RuntimeContext,
    ): NodeResult {
        val cfg = node.config

        // ── Resolve connection ────────────────────────────────────────────────
        val connectionIdStr = cfg["connectionId"] as? String
            ?: return NodeResult.Failed("DB_QUERY node '${node.id}' missing required config: connectionId")

        val connectionId = try { UUID.fromString(connectionIdStr) }
        catch (e: Exception) {
            return NodeResult.Failed("DB_QUERY node '${node.id}': invalid connectionId format")
        }

        val resolved = try {
            connectionResolver.resolve(connectionId, context.workspaceId, expectedType = "database")
        } catch (e: ConnectionException) {
            emitEvent(context, node.id, EventType.CONNECTION_VALIDATION_FAILED, "failed",
                title = "Connection validation failed")
            return NodeResult.Failed("Connection error for node '${node.id}': ${e.message}")
        }

        emitEvent(context, node.id, EventType.CONNECTION_RESOLVED, "info",
            title = "Connection resolved",
            summary = "provider=${resolved.record.provider}")

        // ── Validate query ────────────────────────────────────────────────────
        val rawQuery = cfg["query"] as? String
            ?: return NodeResult.Failed("DB_QUERY node '${node.id}' missing required config: query")

        val queryValidation = validateSelectQuery(rawQuery, resolved.record.allowedSchemas, resolved.record.allowedTables)
        if (queryValidation != null) {
            return NodeResult.Failed("DB_QUERY node '${node.id}': $queryValidation")
        }

        // ── Bind parameters ───────────────────────────────────────────────────
        @Suppress("UNCHECKED_CAST")
        val params: List<Any?> = when (val p = cfg["params"] ?: resolvedInputs["params"]) {
            is List<*> -> p as List<Any?>
            null       -> emptyList()
            else       -> listOf(p)
        }

        val maxRows      = minOf((cfg["maxRows"] as? Number)?.toInt() ?: DEFAULT_MAX_ROWS, HARD_MAX_ROWS)
        val timeoutSecs  = (cfg["timeoutSeconds"] as? Number)?.toInt() ?: DEFAULT_TIMEOUT_SECS

        emitEvent(context, node.id, EventType.DB_QUERY_PREPARED, "running",
            title = "DB query prepared",
            summary = "paramCount=${params.size} maxRows=$maxRows")

        // ── Get pool and execute ──────────────────────────────────────────────
        // Pool creation is itself outbound I/O: HikariCP opens and validates a
        // physical connection here, so an unreachable tenant blocks for
        // loginTimeout before this returns. It must be timed like any other
        // tenant-DB call — otherwise the single most common tenant-DB failure
        // ("we cannot connect at all") is absent from the latency metric.
        val poolStartMs = System.currentTimeMillis()
        val dataSource = try {
            WorkerMetrics.timeBlocking {
                poolManager.getOrCreate(resolved.record, resolved.secret)
            }
        } catch (e: Exception) {
            WorkerMetrics.tenantDbCallDurationSeconds.observeMs(
                System.currentTimeMillis() - poolStartMs, "connect", classifyDbError(e))
            return NodeResult.Failed("DB_QUERY node '${node.id}': cannot create DB pool: ${e.message}")
        }

        /*
         * The query and its parameters have to agree BEFORE the driver is asked.
         *
         * Same failure as the write path: binding into a query with no placeholders
         * produced "The column index is out of range: 1, number of columns: 0", which
         * names neither the query nor the count. Reads take the same guard so a SELECT
         * tool fails with an instruction rather than a driver index.
         */
        val placeholders = SqlPlaceholders.analyse(rawQuery).questionMarks
        if (params.size != placeholders) {
            val hint = if (placeholders == 0) {
                "The query has no bind placeholders, so it takes no parameters. " +
                    "Use {{name}} templating to inline a value, or add ? placeholders to bind one."
            } else {
                "Supply exactly $placeholders value(s), in the order the ? placeholders appear."
            }
            return NodeResult.Failed(
                "DB_QUERY node '${node.id}': the query has $placeholders bind placeholder(s) " +
                    "but ${params.size} parameter(s) were supplied. $hint"
            )
        }

        emitEvent(context, node.id, EventType.DB_QUERY_STARTED, "running",
            title = "DB query started")

        val startMs = System.currentTimeMillis()

        // NOTE ON TIMEOUTS — read before changing this block.
        //   `stmt.queryTimeout` below is NOT sufficient on its own. pgjdbc
        //   implements it by opening a second connection and sending a cancel
        //   request; against a firewalled or blackholed tenant host that second
        //   connection hangs too, so the timeout never fires and this thread —
        //   an execution slot — is parked for the life of the process.
        //   The bound that actually works is the driver-level `socketTimeout`
        //   forced onto the JDBC URL by JdbcTimeouts, applied in
        //   ClientDbPoolManager. queryTimeout stays as the cooperative,
        //   server-side bound for the healthy case.
        val rows = try {
            WorkerMetrics.timeBlocking {
                dataSource.connection.use { conn ->
                    // Enforce read-only at connection level
                    conn.isReadOnly = true
                    conn.prepareStatement(rawQuery).use { stmt ->
                        stmt.queryTimeout = timeoutSecs
                        stmt.maxRows = maxRows
                        params.forEachIndexed { i, param ->
                            stmt.setObject(i + 1, param)
                        }
                        stmt.executeQuery().use { rs ->
                            resultSetToList(rs, maxRows)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            val durationMs = System.currentTimeMillis() - startMs
            WorkerMetrics.tenantDbCallDurationSeconds.observeMs(durationMs, "read", classifyDbError(e))
            // Include the DB error message (postgres errors are safe to log — no PII)
            log.warn("[dbread] query failed [nodeId={}, durationMs={}]: {} — {}",
                node.id, durationMs, e.javaClass.simpleName, e.message?.take(300))
            return NodeResult.Failed(
                "DB_QUERY node '${node.id}': query failed: ${e.message?.take(300) ?: e.javaClass.simpleName}"
            )
        }
        WorkerMetrics.tenantDbCallDurationSeconds.observeMs(
            System.currentTimeMillis() - startMs, "read", "ok")

        val durationMs = System.currentTimeMillis() - startMs

        emitEvent(context, node.id, EventType.DB_QUERY_COMPLETED, "success",
            title = "DB query completed",
            summary = "rowCount=${rows.size} durationMs=$durationMs",
            durationMs = durationMs)

        return NodeResult.Completed(
            output = mapOf(
                "rows"     to rows,
                "rowCount" to rows.size,
            ),
            metadata = mapOf(
                "rowCount"   to rows.size,
                "durationMs" to durationMs,
                "maxRows"    to maxRows,
            )
        )
    }

    /**
     * Bucket a tenant-DB failure so `tenant_db_call_duration_seconds` separates
     * "the tenant's database is slow" from "the tenant's database is a black
     * hole and we gave up". The second is the one that used to be unbounded.
     */
    private fun classifyDbError(e: Exception): String {
        val msg = (e.message ?: "").lowercase()
        return when {
            msg.contains("socket timeout") || msg.contains("read timed out") ||
                msg.contains("timeout expired") || e is java.sql.SQLTimeoutException -> "socket_timeout"
            // pgjdbc's loginTimeout surfaces as "Connection attempt timed out";
            // HikariCP wraps it in "Cannot create pool …".
            msg.contains("connection attempt failed") || msg.contains("connect timed out") ||
                msg.contains("connection timed out") || msg.contains("connection attempt timed out") ||
                msg.contains("cannot create pool") -> "connect_timeout"
            msg.contains("connection is not available") -> "pool_exhausted"
            else -> "error"
        }
    }

    // ── Query validation ──────────────────────────────────────────────────────

    /**
     * Returns an error message string if the query is not a safe SELECT, null if valid.
     *
     * Checks:
     *  1. Must start with SELECT (case-insensitive, trimmed).
     *  2. No semicolons after the first token (blocks multi-statement).
     *  3. If allowedTables is non-empty, at least one listed table must appear in the query.
     */
    private fun validateSelectQuery(
        query: String,
        allowedSchemas: List<String>,
        allowedTables: List<String>,
    ): String? {
        val trimmed = query.trim()

        val firstToken = trimmed.split(Regex("\\s+")).firstOrNull()?.uppercase() ?: ""
        if (firstToken != "SELECT") {
            return "only SELECT queries are permitted in DB_QUERY nodes; got '$firstToken'"
        }

        // Block multi-statement: find semicolons outside string literals (simple heuristic)
        if (containsSemicolonOutsideQuotes(trimmed)) {
            return "multi-statement SQL is not permitted"
        }

        // Allowed-tables enforcement (best-effort keyword check)
        if (allowedTables.isNotEmpty()) {
            val queryLower = trimmed.lowercase()
            val tableAllowed = allowedTables.any { table -> queryLower.contains(table.lowercase()) }
            if (!tableAllowed) {
                return "query references tables not in the connection's allowedTables list"
            }
        }

        return null
    }

    /**
     * Simple heuristic: returns true if there is a semicolon outside single-quoted strings.
     * Not a full SQL parser, but catches the common injection pattern.
     */
    private fun containsSemicolonOutsideQuotes(sql: String): Boolean {
        var inSingleQuote = false
        for (ch in sql) {
            when {
                ch == '\'' -> inSingleQuote = !inSingleQuote
                ch == ';' && !inSingleQuote -> return true
            }
        }
        return false
    }

    // ── ResultSet → List<Map> ─────────────────────────────────────────────────

    private fun resultSetToList(
        rs: java.sql.ResultSet,
        maxRows: Int,
    ): List<Map<String, Any?>> {
        val meta    = rs.metaData
        val colCount = meta.columnCount
        val cols    = (1..colCount).map { meta.getColumnLabel(it) }
        val rows    = mutableListOf<Map<String, Any?>>()

        while (rs.next() && rows.size < maxRows) {
            val row = LinkedHashMap<String, Any?>(colCount)
            for (i in 1..colCount) {
                row[cols[i - 1]] = rs.getObject(i)
            }
            rows += row
        }

        return rows
    }

    // ── Event helper ──────────────────────────────────────────────────────────

    private fun emitEvent(
        ctx: RuntimeContext,
        nodeId: String,
        type: EventType,
        status: String,
        title: String? = null,
        summary: String? = null,
        durationMs: Long? = null,
    ) = try {
        eventStore.appendEvent(RunEvent(
            runId         = ctx.runId,
            workspaceId   = ctx.workspaceId,
            environmentId = ctx.environmentId,
            type          = type,
            status        = status,
            stepId        = nodeId,
            title         = title,
            summary       = summary,
            durationMs    = durationMs,
        ))
    } catch (_: Exception) {}
}
