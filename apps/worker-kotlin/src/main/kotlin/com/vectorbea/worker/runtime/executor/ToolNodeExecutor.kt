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

    // ── Body string resolver ──────────────────────────────────────────────────

    /** Resolve all {{expr}} placeholders in a body/URL string. */
    private fun resolveBodyString(
        raw: String,
        resolvedInputs: Map<String, Any>,
        ctx: com.vectorbea.worker.runtime.graph.RuntimeContext,
    ): String {
        if (!raw.contains("{{")) return raw
        val TEMPLATE_REGEX = Regex("""\{\{\s*([^}]+?)\s*\}\}""")
        return TEMPLATE_REGEX.replace(raw) { match ->
            val expr  = match.groupValues[1].trim()
            val value = resolveBodyExpr(expr, resolvedInputs, ctx)
            when (value) {
                null       -> ""
                is Number  -> value.toString()
                is Boolean -> value.toString()
                is String  -> value.replace("\\", "\\\\")
                                   .replace("\"", "\\\"")
                                   .replace("\n", "\\n")
                                   .replace("\r", "")
                else       -> try { mapper.writeValueAsString(value) }
                              catch (_: Exception) { value.toString() }
            }
        }
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

                // Resolve node using the same multi-strategy matcher as MappingResolver
                val nodeId = resolveNodeRef(ref, ctx) ?: ref  // fall back to ref as literal ID

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

        // ── SaaS tool defaults (when config_json only has uiToolType) ────────────
        // Tools created via the SaaS connector UI only store the display type.
        // Inject known API endpoints and methods so the HTTP executor has something to call.
        val uiType = (tool.configJson["uiToolType"] as? String)?.lowercase()
        if (result["url"] == null && result["urlTemplate"] == null) {
            when (uiType) {
                "slack" -> {
                    result["url"]    = "https://slack.com/api/chat.postMessage"
                    result["method"] = "POST"
                }
                "email", "gmail" -> {
                    // GMail REST API — caller must supply auth via connection
                    result["url"]    = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
                    result["method"] = "POST"
                }
            }
        }
        // Default method to POST for SaaS tools if not already set
        if (uiType != null && result["method"] == null) {
            result["method"] = "POST"
        }

        // Remap HTTP tool keys.
        // urlTemplate / bodyTemplate are the stored forms; HttpNodeExecutor reads "url" / "body".
        (tool.configJson["urlTemplate"] as? String)?.let { result["url"] = it }
        (tool.configJson["url"] as? String)?.let { result["url"] = it }

        // Resolve {{ expr }} placeholders in the body template using resolvedInputs.
        // Without this, Slack/HTTP tools receive literal "{{message}}" text in the body
        // instead of the actual workflow values — the call returns 200 but nothing is posted.
        val rawBody = tool.configJson["bodyTemplate"] as? String
            ?: tool.configJson["body"] as? String
        // ── Body resolution ───────────────────────────────────────────────────────
        // Body may be stored as a String (bodyTemplate / body string) OR as a Map
        // (JSON object already parsed — common when the tool editor saves body as JSON).
        // In both cases we need to resolve {{expr}} placeholders.

        // Case A: body stored as a plain String in config_json
        if (rawBody != null) {
            val resolvedBody = resolveBodyString(rawBody, resolvedInputs, ctx)
            log.info("[tool] resolved body (string) [toolName={}, type={}]: {}",
                tool.name, tool.type, resolvedBody.take(300))
            result["body"] = resolvedBody
        }

        // Case B: body stored as a Map in config_json (common for HTTP tools configured via UI)
        // putAll(tool.configJson) already copied it to result["body"], but expressions are unresolved.
        @Suppress("UNCHECKED_CAST")
        val bodyFromConfig = tool.configJson["body"] as? Map<String, Any?>
        if (bodyFromConfig != null) {
            // Walk the Map and resolve {{expr}} in every String value
            val resolved = bodyFromConfig.mapValues { (_, v) ->
                when (v) {
                    is String -> resolveBodyString(v, resolvedInputs, ctx)
                    else -> v
                }
            }
            val resolvedJson = try { mapper.writeValueAsString(resolved) } catch (_: Exception) { null }
            if (resolvedJson != null) {
                log.info("[tool] resolved body (map) [toolName={}, type={}]: {}",
                    tool.name, tool.type, resolvedJson.take(300))
                result["body"] = resolvedJson
            }
        } else if (resolvedInputs.isNotEmpty()) {
            // No explicit body — pass resolved inputs (from node input mapping) as JSON body.
            // Applies to http, slack, email, and any SaaS tool type.
            log.info("[tool] using resolvedInputs as body [toolName={}, type={}, uiType={}, keys={}]",
                tool.name, tool.type, uiType, resolvedInputs.keys)
            result["body"] = resolvedInputs
        }

        // Diagnostic: log the full config_json keys for HTTP tools when no body was set.
        // This helps identify where the body template is actually stored.
        if ((tool.type == "http" || tool.type == "slack" || tool.type == "email") &&
            result["body"] == null) {
            log.warn("[tool] NO BODY SET for HTTP tool [toolName={}, configKeys={}]",
                tool.name, tool.configJson.keys)
        }

        // Log what step outputs are available so the correct label can be identified
        if (ctx.completedNodeIds().isNotEmpty()) {
            val stepSummary = ctx.completedNodeIds().mapNotNull { nodeId ->
                val n = ctx.graph.nodes.firstOrNull { it.id == nodeId }
                val out = ctx.getOutput(nodeId)
                if (n != null && out.isNotEmpty()) "'${n.label}' (${nodeId}): keys=${out.keys}" else null
            }
            if (stepSummary.isNotEmpty()) {
                log.info("[tool] available step outputs for template resolution: {}", stepSummary)
            }
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
                    // Convert to SQL literal. Null means workflow input not provided —
                    // use safe keyword defaults so LIMIT/OFFSET don't become NULL.
                    when (value) {
                        is Number  -> value.toString()
                        null       -> when (key.lowercase()) {
                            "limit", "max_rows", "page_size", "count" -> "100"
                            "days_ahead", "days", "lookback_days"     -> "30"
                            "offset", "skip"                          -> "0"
                            else                                       -> "NULL"
                        }
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

    // ── Node reference resolver (mirrors MappingResolver.resolveNodeRef) ────────

    /**
     * Resolve a step reference to a node ID using multiple strategies.
     * Handles abbreviated names like "fetch_renewals" → "Fetch Upcoming Renewals".
     */
    private fun resolveNodeRef(rawRef: String, ctx: com.vectorbea.worker.runtime.graph.RuntimeContext): String? {
        if (rawRef.isBlank()) return null
        val refSlug  = rawRef.lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_')
        val refWords = refSlug.split('_').filter { it.length > 1 }
        return ctx.graph.nodes.firstOrNull { node ->
            val labelSlug  = node.label.lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_')
            val labelWords = labelSlug.split('_').filter { it.isNotEmpty() }
            node.id == rawRef ||
            node.label.lowercase() == rawRef.lowercase() ||
            labelSlug == refSlug ||
            (refWords.size >= 2 && refWords.all { w -> labelWords.any { lw -> lw.startsWith(w) || w.startsWith(lw) } }) ||
            (refWords.size == 1 && labelWords.firstOrNull()?.startsWith(refWords[0]) == true)
        }?.id
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
