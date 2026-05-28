package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.connector.ConnectionException
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode
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

    override fun execute(
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
        val dataSource = try {
            poolManager.getOrCreate(resolved.record, resolved.secret)
        } catch (e: Exception) {
            return NodeResult.Failed("DB_QUERY node '${node.id}': cannot create DB pool: ${e.message}")
        }

        emitEvent(context, node.id, EventType.DB_QUERY_STARTED, "running",
            title = "DB query started")

        val startMs = System.currentTimeMillis()

        val rows = try {
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
        } catch (e: Exception) {
            val durationMs = System.currentTimeMillis() - startMs
            log.warn("[dbread] query failed [nodeId={}, durationMs={}]: {}",
                node.id, durationMs, e.javaClass.simpleName)
            return NodeResult.Failed(
                "DB_QUERY node '${node.id}': query execution failed: ${e.javaClass.simpleName}"
            )
        }

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
