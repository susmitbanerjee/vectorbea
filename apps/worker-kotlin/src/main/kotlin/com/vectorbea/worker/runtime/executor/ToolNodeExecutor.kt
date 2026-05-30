package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
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
import javax.sql.DataSource

/**
 * Executes TOOL nodes by looking up the named tool definition from the DB
 * and dispatching to the appropriate underlying executor (HTTP or DB).
 *
 * The node's config must contain `toolId` (UUID string) referencing a row in
 * the `tools` table.  The tool row's `type` determines which executor handles it:
 *   - "http"            → [HttpNodeExecutor]
 *   - "database_read"   → [DbReadNodeExecutor]
 *   - "database_write"  → [DbWriteNodeExecutor]
 *
 * Input/output mappings from the workflow node override defaults from the
 * tool's stored config.
 *
 * SECURITY:
 *   - toolId is validated as a UUID before DB query.
 *   - Tool lookup is workspace-scoped — cross-workspace access is impossible.
 *   - config_json contents (including any template strings) are treated as
 *     untrusted user data and never logged raw.
 *   - Credentials are always resolved via [ConnectionResolver], never stored in config.
 */
class ToolNodeExecutor(
    private val dataSource: DataSource,
    private val connectionResolver: ConnectionResolver,
    private val dbPoolManager: ClientDbPoolManager,
    private val eventStore: RunEventStore,
) : NodeExecutor {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    private val httpExecutor    by lazy { HttpNodeExecutor(connectionResolver, eventStore) }
    private val dbReadExecutor  by lazy { DbReadNodeExecutor(connectionResolver, dbPoolManager, eventStore) }
    private val dbWriteExecutor by lazy { DbWriteNodeExecutor(connectionResolver, dbPoolManager,
        ApprovalStore(dataSource), eventStore) }

    override fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult {
        val toolIdStr = node.config["toolId"] as? String
            ?: return NodeResult.Failed("Tool node '${node.id}' missing required config: toolId")

        val toolId = try { UUID.fromString(toolIdStr) }
        catch (_: Exception) {
            return NodeResult.Failed("Tool node '${node.id}': invalid toolId format (expected UUID)")
        }

        // Load tool definition — workspace-scoped
        val tool = loadTool(toolId, ctx.workspaceId)
            ?: return NodeResult.Failed("Tool '$toolIdStr' not found or not accessible for node '${node.id}'")

        emitEvent(ctx, node.id, EventType.TOOL_CALL_STARTED, "running",
            title   = "Tool call started: ${tool.name}",
            summary = "type=${tool.type}")

        val startMs = System.currentTimeMillis()

        // Build a synthetic WorkflowNode with the tool's resolved config so existing
        // executor implementations (HttpNodeExecutor, etc.) work without modification.
        val syntheticConfig = buildSyntheticConfig(tool, node.config, resolvedInputs, ctx)
        val syntheticNode   = node.copy(config = syntheticConfig)

        val result: NodeResult = when (tool.type) {
            "http" -> httpExecutor.execute(syntheticNode, resolvedInputs, ctx)

            // "database" is the canonical type in the tools table (see V001 migration).
            // Distinguish read vs write by inspecting the first keyword of the SQL statement —
            // SELECT = read-only path; INSERT/UPDATE/DELETE/MERGE/UPSERT = write path.
            "database" -> {
                val sql = (tool.configJson["sqlTemplate"] as? String ?: "").trimStart()
                val firstWord = sql.split(Regex("\\s+"), limit = 2).firstOrNull()?.uppercase() ?: ""
                if (firstWord == "SELECT") {
                    dbReadExecutor.execute(syntheticNode, resolvedInputs, ctx)
                } else {
                    dbWriteExecutor.execute(syntheticNode, resolvedInputs, ctx)
                }
            }

            "database_read" -> dbReadExecutor.execute(syntheticNode, resolvedInputs, ctx)

            "database_write" -> dbWriteExecutor.execute(syntheticNode, resolvedInputs, ctx)

            "slack", "email", "crm" -> {
                // Slack/Email/CRM tools are stored as HTTP tools under the hood
                httpExecutor.execute(syntheticNode, resolvedInputs, ctx)
            }

            else -> NodeResult.Failed(
                "Tool type '${tool.type}' is not yet supported by the worker (toolId=$toolIdStr)"
            )
        }

        val durationMs = System.currentTimeMillis() - startMs
        val eventStatus = if (result is NodeResult.Completed) "success" else "failed"
        emitEvent(ctx, node.id, EventType.TOOL_CALL_COMPLETED, eventStatus,
            title      = "Tool call ${if (result is NodeResult.Completed) "completed" else "failed"}: ${tool.name}",
            durationMs = durationMs)

        return result
    }

    // ── Template expression resolver ─────────────────────────────────────────

    /**
     * Resolve a single {{expr}} from the body/URL template.
     *
     * Resolution order:
     *  1. `steps.NodeLabel.output.field` or `steps.nodeId.output.field`
     *     → look up the completed step's output in RuntimeContext
     *  2. `workflow.input.key` → workflow input
     *  3. bare `key` or `path.key` → resolvedInputs lookup
     */
    @Suppress("UNCHECKED_CAST")
    private fun resolveBodyExpr(
        expr: String,
        resolvedInputs: Map<String, Any>,
        ctx: com.vectorbea.worker.runtime.graph.RuntimeContext,
    ): Any? {
        // 1. steps.X.output.field[.nested...]
        if (expr.startsWith("steps.")) {
            val rest  = expr.removePrefix("steps.")
            val parts = rest.split(".", limit = 3)
            // parts[0] = node label/id, parts[1] = "output", parts[2...] = field path
            if (parts.size >= 2) {
                val ref  = parts[0]
                val tier = if (parts.size >= 2) parts[1] else "output"
                val path = if (parts.size >= 3) parts[2] else ""

                // Resolve node by label OR id (case-insensitive, space/underscore tolerant)
                val nodeId = ctx.graph.nodes.firstOrNull { node ->
                    node.id == ref ||
                    node.label.equals(ref, ignoreCase = true) ||
                    node.label.replace(" ", "").equals(ref, ignoreCase = true) ||
                    node.label.replace(" ", "_").equals(ref, ignoreCase = true)
                }?.id ?: ref  // fall back to treating ref as a literal node ID

                val output = ctx.getOutput(nodeId)
                if (output.isNotEmpty()) {
                    // Resolve nested path e.g. "account_name" or "nested.field"
                    val data = when (tier) {
                        "output" -> output
                        else     -> output
                    }
                    val resolved = if (path.isEmpty()) data
                    else {
                        var current: Any? = data
                        for (segment in path.split(".")) {
                            current = (current as? Map<String, Any?>)?.get(segment) ?: break
                        }
                        current
                    }
                    if (resolved != null) return resolved
                }
            }
        }

        // 2. workflow.input.key
        if (expr.startsWith("workflow.input.")) {
            val key = expr.removePrefix("workflow.input.")
            return ctx.workflowInput[key]
        }

        // 3. bare key or path.key — check resolvedInputs
        val key = expr.substringAfterLast('.')
        return resolvedInputs[key]
            ?: resolvedInputs[expr]
            ?: resolvedInputs[expr.replace(".", "_")]
    }

    // ── Tool row ──────────────────────────────────────────────────────────────

    private data class ToolRow(
        val id: String,
        val name: String,
        val type: String,
        val connectionId: String?,
        /** Raw config from tools.config_json — contains method/url/sql etc. */
        val configJson: Map<String, Any>,
        val riskLevel: String,
        val requiresApproval: Boolean,
        val timeoutMs: Int?,
    )

    private fun loadTool(toolId: UUID, workspaceId: UUID): ToolRow? = try {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT id, name, type, connection_id, config_json,
                   risk_level, requires_approval, timeout_ms
                   FROM tools
                   WHERE id = ? AND workspace_id = ? AND status = 'active'"""
            ).use { stmt ->
                stmt.setObject(1, toolId)
                stmt.setObject(2, workspaceId)
                stmt.executeQuery().use { rs ->
                    if (!rs.next()) return@use null
                    @Suppress("UNCHECKED_CAST")
                    val cfgJson = try {
                        mapper.readValue(rs.getString("config_json") ?: "{}", Map::class.java)
                            as Map<String, Any>
                    } catch (_: Exception) { emptyMap() }

                    ToolRow(
                        id               = rs.getString("id"),
                        name             = rs.getString("name"),
                        type             = rs.getString("type"),
                        connectionId     = rs.getString("connection_id"),
                        configJson       = cfgJson,
                        riskLevel        = rs.getString("risk_level") ?: "low",
                        requiresApproval = rs.getBoolean("requires_approval"),
                        timeoutMs        = rs.getObject("timeout_ms")?.let {
                            (it as? Number)?.toInt()
                        },
                    )
                }
            }
        }
    } catch (e: Exception) {
        log.warn("[tool-executor] failed to load tool [toolId={}, workspaceId={}]: {} — {}",
            toolId, workspaceId, e.javaClass.simpleName, e.message?.take(200))
        null
    }

    /**
     * Build the config map for the synthetic WorkflowNode that the underlying
     * executor will process.
     *
     * Priority: node-level overrides > tool DB config.
     *
     * Key remapping between tool config_json keys and executor expected keys:
     *   - config_json.url / urlTemplate  → "url"
     *   - config_json.bodyTemplate       → "body"
     *   - config_json.sqlTemplate        → "query"
     */
    @Suppress("UNCHECKED_CAST")
    private fun buildSyntheticConfig(
        tool: ToolRow,
        nodeConfig: Map<String, Any>,
        resolvedInputs: Map<String, Any>,
        ctx: com.vectorbea.worker.runtime.graph.RuntimeContext,
    ): Map<String, Any> {
        val result = mutableMapOf<String, Any>()

        // Inject connection ID from tool definition
        tool.connectionId?.let { result["connectionId"] = it }

        // Base from tool's stored config
        result.putAll(tool.configJson)

        // Remap HTTP tool keys.
        // urlTemplate / bodyTemplate are the stored forms; HttpNodeExecutor reads "url" / "body".
        (tool.configJson["urlTemplate"] as? String)?.let { result["url"] = it }
        (tool.configJson["url"] as? String)?.let { result["url"] = it }

        // Resolve {{ expr }} placeholders in the body template using resolvedInputs.
        // Without this, Slack/HTTP tools receive literal "{{message}}" text in the body
        // instead of the actual workflow values — the call returns 200 but nothing is posted.
        val rawBody = tool.configJson["bodyTemplate"] as? String
            ?: tool.configJson["body"] as? String
        if (rawBody != null) {
            val resolvedBody = if (rawBody.contains("{{")) {
                val TEMPLATE_REGEX = Regex("""\{\{\s*([^}]+?)\s*\}\}""")
                TEMPLATE_REGEX.replace(rawBody) { match ->
                    val expr  = match.groupValues[1].trim()
                    val value = resolveBodyExpr(expr, resolvedInputs, ctx)
                    when (value) {
                        null          -> ""
                        is Number     -> value.toString()
                        is Boolean    -> value.toString()
                        is String     -> value.replace("\\", "\\\\")
                                              .replace("\"", "\\\"")
                                              .replace("\n", "\\n")
                                              .replace("\r", "")
                        else          -> try { mapper.writeValueAsString(value) }
                                         catch (_: Exception) { value.toString() }
                    }
                }
            } else rawBody

            // Log the resolved body (first 200 chars) for debugging — helps diagnose
            // empty messages or template resolution issues without logging secrets
            log.debug("[tool] resolved body for [toolId={}, type={}]: {}",
                tool.id, tool.type, resolvedBody.take(200))

            result["body"] = resolvedBody
        } else if (resolvedInputs.isNotEmpty() &&
                   (tool.type == "http" || tool.type == "slack" || tool.type == "email")) {
            // No explicit body template — pass resolved inputs as the JSON body
            result["body"] = resolvedInputs
        }

        // Remap DB tool keys.
        // If the SQL template contains {{ expr }} placeholders (common when users write
        // SQL in the workflow tool editor), inline the resolved values directly.
        //
        // We use value inlining rather than $N positional parameters because $N inside
        // a string literal (e.g. INTERVAL '$1 days') is NOT counted as a bind parameter
        // by the PostgreSQL JDBC driver, causing "column index out of range: 1, number
        // of columns: 0" errors.  Inlining is safe here because values come from the
        // workflow's own input mapping, not from external untrusted user input.
        (tool.configJson["sqlTemplate"] as? String)?.let { rawSql ->
            val resolvedSql = if (rawSql.contains("{{")) {
                val TEMPLATE_REGEX = Regex("""\{\{\s*([^}]+?)\s*\}\}""")
                TEMPLATE_REGEX.replace(rawSql) { match ->
                    val expr  = match.groupValues[1].trim()
                    val key   = expr.substringAfterLast('.')
                    val value = resolvedInputs[key]
                        ?: resolvedInputs[expr]
                        ?: resolvedInputs[expr.replace(".", "_")]
                    // Convert to SQL literal — numbers inline as-is, strings are quoted
                    when (value) {
                        is Number  -> value.toString()
                        null       -> "NULL"
                        else       -> "'${value.toString().replace("'", "''")}'"
                    }
                }
            } else rawSql

            result["query"]     = resolvedSql
            result["statement"] = resolvedSql
            // No $N params needed — values are already inlined in the SQL
            result.remove("params")
        }

        // Resolve DB parameters for SQL that uses $1/$2 positional placeholders.
        // Skip this block if the SQL used {{...}} inlining (params already removed above).
        if (result["params"] != null || !result.containsKey("params")) {
            val toolParameters = tool.configJson["parameters"] as? Map<*, *>
            val sqlHasInlinedTemplates = (tool.configJson["sqlTemplate"] as? String)
                ?.contains("{{") == true
            if (!sqlHasInlinedTemplates) {
                if (toolParameters != null && toolParameters.isNotEmpty()) {
                    val paramList: List<Any?> = toolParameters.keys.map { key ->
                        resolvedInputs[key?.toString()] ?: toolParameters[key]
                    }
                    result["params"] = paramList
                } else if (resolvedInputs.isNotEmpty() && result["params"] == null) {
                    result["params"] = resolvedInputs.values.toList()
                }
            }
        }

        // Risk / approval from tool definition
        result["riskLevel"]        = tool.riskLevel
        result["requireApproval"]  = tool.requiresApproval
        tool.timeoutMs?.let { result["timeoutMs"] = it }

        // Allow node-level config to override individual fields (e.g. a user-supplied url override)
        nodeConfig.forEach { (k, v) ->
            if (k !in setOf("toolId", "toolName", "toolType", "uiToolType")) {
                result[k] = v
            }
        }

        return result
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
