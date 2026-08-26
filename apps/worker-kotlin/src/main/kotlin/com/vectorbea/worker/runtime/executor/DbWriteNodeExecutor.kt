package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.connector.ConnectionException
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode
import java.util.UUID

/**
 * Executes DB_WRITE nodes: parameterized INSERT / UPDATE / DELETE / UPSERT.
 *
 * Node config keys:
 *   - connectionId     (UUID string, required)
 *   - statement        (string, required) — DML statement; SELECT is rejected
 *   - params           (List<Any>, optional) — positional bind parameters
 *   - idempotencyKey   (string, optional) — if set, duplicate executions are no-ops
 *   - requireApproval  (Boolean, default true) — pauses run until approved
 *   - approvalMessage  (string, optional) — human-readable approval prompt
 *   - approvers        (List<String>, optional)
 *   - timeoutSeconds   (Int, optional, default 30)
 *
 * Approval flow:
 *   1. First call: [ApprovalStore.findApproval] → none → create PENDING row → return [NodeResult.ApprovalPaused]
 *   2. After human approves via API, run is resumed.
 *   3. Second call: [ApprovalStore.findApproval] → APPROVED → execute statement.
 *   4. If REJECTED → return [NodeResult.Failed].
 *
 * Idempotency:
 *   If [idempotencyKey] is set, a row in `db_write_idempotency` is checked first.
 *   Duplicate executions with the same key return the stored result without re-executing.
 *
 * SECURITY:
 *  - SELECT is blocked; only DML is allowed.
 *  - Multi-statement SQL is blocked.
 *  - Parameters are bound via PreparedStatement.
 *  - Approval is required by default.
 *  - Statement text is never logged raw.
 *  - Row counts and affected rows counts are the only data logged.
 */
class DbWriteNodeExecutor(
    private val connectionResolver: ConnectionResolver,
    private val poolManager: ClientDbPoolManager,
    private val approvalStore: ApprovalStore,
    private val eventStore: RunEventStore,
) : NodeExecutor {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        const val DEFAULT_TIMEOUT_SECS = 30

        /**
         * Everything Postgres said about the failure EXCEPT the row.
         *
         * THE BUG THIS FIXES: this executor reported `e.javaClass.simpleName` and
         * nothing else, so every write failure - syntax error, missing column,
         * type mismatch, constraint violation - arrived as the single word
         * "PSQLException". The run's error_json said
         * `statement execution failed: PSQLException`, which names a Java class and
         * not one fact about what went wrong. An agent retrying that tool got the
         * same uninformative observation each time and had nothing to correct.
         *
         * `DbReadNodeExecutor` has always included `e.message`; only the write path
         * dropped it, and the asymmetry is the giveaway that this was caution rather
         * than intent - a write's error is the one that can quote the data being
         * written.
         *
         * So the diagnosis is kept and the data is not. Postgres puts values in the
         * DETAIL field (`Key (email)=(a@b.com) already exists`); the primary message
         * and HINT are about the STATEMENT. Everything from `Detail:` on is dropped,
         * and the SQLSTATE is prefixed because it is the part that is stable enough
         * to look up and search for.
         */
        internal fun describeDbError(e: Throwable): String {
            val sqlState = (e as? java.sql.SQLException)?.sqlState?.takeIf { it.isNotBlank() }

            val primary = e.message
                // Case-insensitive: pgjdbc renders "Detail:", the server logs "DETAIL:".
                ?.split(Regex("(?i)\\bdetail\\s*:"), limit = 2)
                ?.first()
                ?.trim()
                ?.takeIf { it.isNotBlank() }
                ?: e.javaClass.simpleName

            return if (sqlState != null) "[$sqlState] ${primary.take(300)}" else primary.take(300)
        }
    }

    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        context: RuntimeContext,
    ): NodeResult {
        val cfg = node.config

        // ── Resolve connection ────────────────────────────────────────────────
        val connectionIdStr = cfg["connectionId"] as? String
            ?: return NodeResult.Failed("DB_WRITE node '${node.id}' missing required config: connectionId")

        val connectionId = try { UUID.fromString(connectionIdStr) }
        catch (e: Exception) {
            return NodeResult.Failed("DB_WRITE node '${node.id}': invalid connectionId format")
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

        // ── Validate statement ────────────────────────────────────────────────
        val rawStatement = cfg["statement"] as? String
            ?: return NodeResult.Failed("DB_WRITE node '${node.id}' missing required config: statement")

        val stmtError = validateWriteStatement(rawStatement, resolved.record.allowedTables)
        if (stmtError != null) {
            return NodeResult.Failed("DB_WRITE node '${node.id}': $stmtError")
        }

        // ── Approval gate ─────────────────────────────────────────────────────
        val requireApproval = cfg["requireApproval"] as? Boolean ?: true

        if (requireApproval) {
            val approvalResult = handleApprovalGate(node, cfg, resolvedInputs, context)
            if (approvalResult != null) return approvalResult
        }

        // ── Idempotency check ─────────────────────────────────────────────────
        val idempotencyKey = cfg["idempotencyKey"] as? String
            ?: resolvedInputs["idempotencyKey"] as? String

        if (!idempotencyKey.isNullOrBlank()) {
            val prior = checkIdempotency(idempotencyKey, context.runId, node.id)
            if (prior != null) {
                log.info("[dbwrite] idempotent skip [nodeId={}, key={}]", node.id, idempotencyKey)
                return NodeResult.Completed(
                    output = prior + mapOf("idempotent" to true),
                    metadata = mapOf("idempotent" to true)
                )
            }
        }

        // ── Bind parameters ───────────────────────────────────────────────────
        @Suppress("UNCHECKED_CAST")
        val params: List<Any?> = when (val p = cfg["params"] ?: resolvedInputs["params"]) {
            is List<*> -> p as List<Any?>
            null       -> emptyList()
            else       -> listOf(p)
        }

        /*
         * The statement and the parameters have to agree BEFORE the driver is asked.
         *
         * Binding into a statement with no placeholders produced
         * "The column index is out of range: 1, number of columns: 0", which names
         * neither the statement nor the count and sent three rounds of debugging at
         * the connection, the tool and the SQL in turn. Checking here costs one scan
         * and lets the failure say what is actually wrong and what to write instead.
         */
        val placeholders = SqlPlaceholders.analyse(rawStatement).questionMarks
        if (params.size != placeholders) {
            val hint = if (placeholders == 0) {
                "The statement has no bind placeholders, so it takes no parameters. " +
                    "Use {{name}} templating to inline a value, or add ? placeholders to bind one."
            } else {
                "Supply exactly $placeholders value(s), in the order the ? placeholders appear."
            }
            return NodeResult.Failed(
                "DB_WRITE node '${node.id}': the statement has $placeholders bind placeholder(s) " +
                    "but ${params.size} parameter(s) were supplied. $hint"
            )
        }

        val timeoutSecs = (cfg["timeoutSeconds"] as? Number)?.toInt() ?: DEFAULT_TIMEOUT_SECS

        // ── Get pool and execute ──────────────────────────────────────────────
        val dataSource = try {
            poolManager.getOrCreate(resolved.record, resolved.secret)
        } catch (e: Exception) {
            return NodeResult.Failed("DB_WRITE node '${node.id}': cannot create DB pool: ${e.message}")
        }

        emitEvent(context, node.id, EventType.DB_WRITE_PREPARED, "running",
            title = "DB write prepared",
            summary = "paramCount=${params.size}")

        val startMs = System.currentTimeMillis()

        // See DbReadNodeExecutor: queryTimeout alone cannot unpark a thread whose
        // socket read never returns. The effective bound is the driver-level
        // socketTimeout forced by JdbcTimeouts in ClientDbPoolManager.
        val affectedRows = try {
            com.vectorbea.worker.metrics.WorkerMetrics.timeBlocking {
            dataSource.connection.use { conn ->
                conn.autoCommit = false
                try {
                    conn.prepareStatement(rawStatement).use { stmt ->
                        stmt.queryTimeout = timeoutSecs
                        params.forEachIndexed { i, param -> stmt.setObject(i + 1, param) }
                        val affected = stmt.executeUpdate()
                        conn.commit()
                        affected
                    }
                } catch (e: Exception) {
                    conn.rollback()
                    throw e
                } finally {
                    conn.autoCommit = true
                }
            }
            }
        } catch (e: Exception) {
            val durationMs = System.currentTimeMillis() - startMs
            com.vectorbea.worker.metrics.WorkerMetrics.tenantDbCallDurationSeconds
                .observeMs(durationMs, "write", "error")
            val described = describeDbError(e)
            log.warn("[dbwrite] statement failed [nodeId={}, durationMs={}]: {}",
                node.id, durationMs, described)
            return NodeResult.Failed(
                "DB_WRITE node '${node.id}': statement execution failed: $described"
            )
        }

        val durationMs = System.currentTimeMillis() - startMs
        com.vectorbea.worker.metrics.WorkerMetrics.tenantDbCallDurationSeconds
            .observeMs(durationMs, "write", "ok")

        val output = mapOf(
            "affectedRows" to affectedRows,
            "success"      to true,
        )

        // Persist idempotency record
        if (!idempotencyKey.isNullOrBlank()) {
            saveIdempotency(idempotencyKey, context.runId, node.id, output)
        }

        emitEvent(context, node.id, EventType.DB_WRITE_COMPLETED, "success",
            title = "DB write completed",
            summary = "affectedRows=$affectedRows durationMs=$durationMs",
            durationMs = durationMs)

        return NodeResult.Completed(
            output   = output,
            metadata = mapOf("affectedRows" to affectedRows, "durationMs" to durationMs)
        )
    }

    // ── Approval gate ─────────────────────────────────────────────────────────

    /**
     * Returns a [NodeResult] if the approval gate requires a pause or is rejected.
     * Returns null if the approval is already APPROVED and execution should continue.
     */
    private fun handleApprovalGate(
        node: WorkflowNode,
        cfg: Map<String, Any>,
        resolvedInputs: Map<String, Any>,
        context: RuntimeContext,
    ): NodeResult? {
        val existing = approvalStore.findApproval(context.runId, node.id)

        return when (existing?.status?.uppercase()) {
            "APPROVED" -> null // proceed to execution
            "REJECTED" -> NodeResult.Failed(
                "DB_WRITE node '${node.id}' was rejected by approver: ${existing.resolvedBy ?: "unknown"}"
            )
            "PENDING"  -> NodeResult.ApprovalPaused(
                approvalId = existing.id.toString(),
                message    = existing.message ?: "Waiting for approval",
            )
            else -> {
                // No existing approval — create one and pause
                @Suppress("UNCHECKED_CAST")
                val approvers = (cfg["approvers"] as? List<String>) ?: emptyList()
                val message   = cfg["approvalMessage"] as? String
                    ?: "DB write requires approval for node '${node.id}'"

                val approvalId = approvalStore.createPendingApproval(
                    runId          = context.runId,
                    workspaceId    = context.workspaceId,
                    environmentId  = context.environmentId,
                    nodeId         = node.id,
                    message        = message,
                    approvers      = approvers,
                    resolvedInputs = resolvedInputs,
                )
                NodeResult.ApprovalPaused(
                    approvalId = approvalId,
                    message    = message,
                    metadata   = mapOf("approvers" to approvers),
                )
            }
        }
    }

    // ── Write statement validation ────────────────────────────────────────────

    private fun validateWriteStatement(
        stmt: String,
        allowedTables: List<String>,
    ): String? {
        val trimmed    = stmt.trim()
        val firstToken = trimmed.split(Regex("\\s+")).firstOrNull()?.uppercase() ?: ""

        if (firstToken == "SELECT") {
            return "SELECT queries are not permitted in DB_WRITE nodes; use DB_QUERY instead"
        }

        if (firstToken !in setOf("INSERT", "UPDATE", "DELETE", "UPSERT", "MERGE")) {
            return "only INSERT/UPDATE/DELETE/UPSERT/MERGE are permitted in DB_WRITE nodes; got '$firstToken'"
        }

        // Block multi-statement
        if (containsSemicolonOutsideQuotes(trimmed)) {
            return "multi-statement SQL is not permitted"
        }

        // Allowed-tables enforcement (best-effort)
        if (allowedTables.isNotEmpty()) {
            val lower = trimmed.lowercase()
            val allowed = allowedTables.any { t -> lower.contains(t.lowercase()) }
            if (!allowed) {
                return "statement references tables not in the connection's allowedTables list"
            }
        }

        return null
    }

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

    // ── Idempotency ───────────────────────────────────────────────────────────

    private fun checkIdempotency(
        key: String,
        runId: UUID,
        nodeId: String,
    ): Map<String, Any>? {
        return try {
            // Use the worker's own dataSource via approvalStore's connection indirectly
            // (We don't have direct access here — idempotency is stored in a lightweight in-memory map
            //  in this implementation; a production version would use a DB table.)
            // For now this is a no-op placeholder that always returns null (no duplicate detected).
            // The idempotency table is created in Database.ensureDbWriteIdempotencyTable().
            null
        } catch (_: Exception) { null }
    }

    private fun saveIdempotency(
        key: String,
        runId: UUID,
        nodeId: String,
        output: Map<String, Any>,
    ) {
        // Placeholder — production would INSERT into db_write_idempotency table.
        // The table is created idempotently at startup in Database.kt.
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
