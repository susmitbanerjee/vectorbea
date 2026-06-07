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
        // ── Built-in email: check BEFORE toolId validation (no toolId needed) ──
        val toolType = (node.config["toolType"] as? String)?.lowercase()
        if (toolType == "builtin_email" ||
            (node.config["builtinEmail"] as? Boolean) == true) {
            return sendBuiltinEmail(node.config, resolvedInputs, ctx)
        }

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
            // Aliases for the canonical "http" type — some tools (e.g. architect-generated
            // before the type normalizer existed) may be persisted with these variants.
            "http", "http_api", "rest_api", "api", "rest" -> httpExecutor.execute(syntheticNode, resolvedInputs, ctx)

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

            "builtin_email" -> {
                // Built-in email — calls the platform's /api/email/send route
                // which uses RESEND_API_KEY configured in Vercel.
                // No connection needed; worker calls the Next.js API directly.
                sendBuiltinEmail(node.config, resolvedInputs, ctx)
            }

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

    // ── Built-in email via platform /api/email/send ───────────────────────────

    /**
     * Sends email using the platform's built-in Resend integration.
     * Calls the Next.js /api/email/send route which uses RESEND_API_KEY
     * configured in Vercel — no separate tool connection required.
     *
     * node.config fields read:
     *   emailTo      — recipient(s): string | comma-separated string
     *   emailSubject — subject line (supports {{template}} expressions resolved by caller)
     *   emailBody    — HTML body    (supports {{template}} expressions resolved by caller)
     */
    /**
     * Resolve {{expression}} template placeholders in email fields.
     *
     * Supported patterns:
     *   {{steps.nodeLabel.output.fieldName}}  — step output by node label
     *   {{steps.nodeLabel.fieldName}}          — same (output. prefix optional)
     *   {{steps.nodeId.output.fieldName}}      — step output by node ID (n1008)
     *   {{input.key}}                          — workflow trigger input
     *   {{input.key.nested}}                   — nested input field
     *
     * Node labels are normalised: "Price Analyst" → "price_analyst" for matching.
     * If a placeholder cannot be resolved it is left as-is.
     */
    /** Remove ```json / ``` markdown fences from LLM output strings. */
    private fun stripMarkdownFences(s: String): String =
        s.trim()
            .removePrefix("```json").removePrefix("```javascript").removePrefix("```")
            .removeSuffix("```")
            .trim()

    /**
     * Try to parse JSON that may be truncated (finishReason=length).
     * If full parse fails, tries to recover a partial Map from what was parsed before truncation.
     */
    @Suppress("UNCHECKED_CAST")
    private fun parseJsonBestEffort(content: String): Map<String, Any?>? {
        // 1. Normal parse
        runCatching { return mapper.readValue(content, Map::class.java) as Map<String, Any?> }
        // 2. Truncated — try trimming to last valid position
        // Find the last complete object by trimming from the end
        var s = content.trimEnd()
        while (s.length > 2) {
            runCatching {
                val result = mapper.readValue(s, Map::class.java) as Map<String, Any?>
                return result
            }
            // Remove last char and try again (expensive but rarely runs deep)
            if (s.length < content.length - 500) break  // give up after 500 chars trimmed
            s = s.dropLast(1).trimEnd().trimEnd(',').trimEnd('"').trimEnd()
        }
        return null
    }

    /** Format raw JSON or plain content into readable HTML email body. */
    @Suppress("UNCHECKED_CAST")
    private fun formatContentAsHtml(content: String, requestedField: String): String {
        val parsed = parseJsonBestEffort(content)
        if (parsed != null) {
            val target = parsed[requestedField] ?: parsed.values.firstOrNull()
            return formatValueAsHtml(target ?: parsed)
        }
        // Fallback: treat as plain text, strip any remaining code fence artifacts
        return content
            .replace(Regex("^```[a-z]*\\s*", RegexOption.MULTILINE), "")
            .replace("```", "")
            .trim()
            .replace("\n", "<br>")
    }

    /**
     * Convert any structured value into a clean, readable plain-text email string.
     * No JSON, no HTML tags, no code blocks — just human-readable lines.
     */
    @Suppress("UNCHECKED_CAST")
    private fun formatValueAsHtml(value: Any?): String {
        val lines = mutableListOf<String>()
        flattenToLines(value, lines)
        return lines.joinToString("\n")
    }

    @Suppress("UNCHECKED_CAST")
    private fun flattenToLines(value: Any?, out: MutableList<String>, depth: Int = 0) {
        when (value) {
            is Map<*, *> -> {
                val map = value as Map<*, *>

                // Detect a "day" entry: has date/destination/activities
                val isDay = map.containsKey("date") || map.containsKey("activities") || map.containsKey("destination")

                if (isDay) {
                    val date = map["date"]?.toString()
                    val dest = map["destination"]?.toString()
                    out.add("")
                    if (date != null || dest != null) {
                        out.add("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                        val header = listOfNotNull(
                            date?.let { "📅 $it" },
                            dest?.let { "📍 $it" }
                        ).joinToString("  |  ")
                        out.add(header)
                        out.add("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
                    }
                    val activities = map["activities"] as? List<*>
                    if (activities != null) {
                        for (act in activities) {
                            val a = act as? Map<*, *> ?: continue
                            val time     = a["time"]?.toString()
                            val activity = a["activity"]?.toString() ?: a["name"]?.toString() ?: continue
                            val details  = a["details"]?.toString() ?: a["description"]?.toString()
                            val cost     = a["cost"]?.toString()
                            val food     = a["food_suggestion"]?.toString()
                            val place    = a["place"]?.toString()
                            val line = buildString {
                                if (time != null) append("$time  ")
                                append(activity)
                                if (!place.isNullOrBlank()) append(" (📍 $place)")
                                if (!details.isNullOrBlank()) append("\n          → $details")
                                if (!food.isNullOrBlank()) append("\n          🍽 $food")
                                if (!cost.isNullOrBlank()) append("\n          💰 $cost")
                            }
                            out.add(line)
                        }
                    }
                    val tips       = map["photo_tips"]?.toString()
                    val backup     = map["backup_plan"]?.toString()
                    val totalCost  = map["total_cost"]?.toString()
                    if (!tips.isNullOrBlank())      out.add("📸 $tips")
                    if (!backup.isNullOrBlank())     out.add("🌧 Backup: $backup")
                    if (!totalCost.isNullOrBlank())  out.add("💰 Day total: $totalCost")
                    return
                }

                // Trip summary block: {destination, dates, budget}
                val dest   = map["destination"]?.toString()
                val budget = map["budget"]?.toString()
                val dates  = map["dates"] as? Map<*, *>
                if (dest != null || budget != null) {
                    out.add("")
                    if (dest != null)   out.add("✈️  Destination: $dest")
                    if (dates != null)  out.add("📅 Dates: ${dates["start"]} → ${dates["end"]}")
                    if (budget != null) out.add("💰 Budget: $budget")
                    out.add("")
                    return
                }

                // Generic map — recursively process each key
                for ((k, v) in map) {
                    val key = k?.toString() ?: continue
                    // Skip metadata fields
                    if (key in setOf("model","provider","tokenCount","finishReason","usage")) continue
                    when (v) {
                        is Map<*, *>, is List<*> -> flattenToLines(v, out, depth + 1)
                        else -> if (v != null) out.add("${k}: $v")
                    }
                }
            }
            is List<*> -> value.forEach { flattenToLines(it, out, depth) }
            is String  -> if (value.isNotBlank()) out.add(value)
            else       -> if (value != null) out.add(value.toString())
        }
    }

    /** Format raw step outputs as HTML (used when specific field lookup fails). */
    @Suppress("UNCHECKED_CAST")
    private fun formatOutputAsHtml(outputs: Map<String, Any>): String {
        val metaFields = setOf("model", "provider", "tokenCount", "finishReason", "usage")
        return outputs.entries.filter { it.key !in metaFields }.joinToString("\n") { (k, v) ->
            "<p><strong>$k</strong>: ${v.toString().replace("\n", "<br>")}</p>"
        }
    }

    private fun resolveEmailTemplate(template: String, ctx: RuntimeContext): String {
        if (!template.contains("{{")) return template

        val allOutputs: Map<String, Map<String, Any>> = ctx.allOutputs()

        // Build multiple lookup maps so users can reference nodes flexibly:
        //   steps.nodeId            → direct node ID  (n1008)
        //   steps.node_label        → node label normalised
        //   steps.agent_name        → registered agent name from config
        val nameToId = mutableMapOf<String, String>()
        for (node in ctx.graph.nodes) {
            // By node ID directly
            nameToId[node.id] = node.id
            // By normalised label ("Agent Step" → "agent_step")
            val labelKey = node.label.lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_')
            nameToId[labelKey] = node.id
            // By agent name stored in config ("Price Analyst" → "price_analyst")
            val agentName = (node.config["agentName"] as? String ?: "")
                .lowercase().replace(Regex("[^a-z0-9]+"), "_").trim('_')
            if (agentName.isNotEmpty()) nameToId[agentName] = node.id
        }

        // Log available outputs so users can see what keys to use in templates
        if (allOutputs.isNotEmpty()) {
            val available = allOutputs.entries.joinToString(", ") { (id, out) ->
                val label = ctx.graph.nodes.find { it.id == id }?.label ?: id
                "$id('$label'): ${out.keys.joinToString("+")}"
            }
            log.debug("[email-template] available step outputs: $available")
            log.info("[email-template] available step outputs for template resolution: [${
                allOutputs.entries.joinToString(", ") { (id, out) ->
                    "'${ctx.graph.nodes.find { it.id == id }?.label ?: id}' ($id): keys=[${out.keys.joinToString(", ")}]"
                }
            }]")
        }

        // Special ref: "previous" → last completed step before the current email node
        // Use completionOrderedIds() for reliable ordering (ConcurrentHashMap has no order)
        val emailNodeId = ctx.graph.nodes.find { n ->
            n.config["toolType"] == "builtin_email" ||
            n.config["builtinEmail"] == true ||
            n.label.lowercase().contains("email")
        }?.id
        val previousNodeId: String? =
            // Prefer direct inbound predecessor via graph edges
            emailNodeId?.let { eid ->
                ctx.graph.inboundSources(eid).filter { allOutputs.containsKey(it) }.lastOrNull()
            }
            // Fallback: most recently completed step
            ?: ctx.completionOrderedIds().lastOrNull { allOutputs.containsKey(it) }

        // Build reverse output-mapping lookup: outputMapping value → stored key
        // e.g. outputMappings: {itinerary ← final_itinerary}
        // means stored key="itinerary", source expr="final_itinerary"
        // So if template uses "final_itinerary" we should return outputs["itinerary"]
        val reverseMappings = mutableMapOf<String, Pair<String, String>>() // sourceExpr → (nodeId, storedKey)
        for (node in ctx.graph.nodes) {
            val nodeId = node.id
            if (!allOutputs.containsKey(nodeId)) continue
            for ((storedKey, sourceExpr) in node.outputMapping) {
                // sourceExpr is something like "final_itinerary" or "result.summary"
                reverseMappings[sourceExpr.removePrefix("output.").trim()] = nodeId to storedKey
            }
        }

        val placeholderRegex = Regex("\\{\\{([^}]+)\\}\\}")
        return placeholderRegex.replace(template) { match ->
            val expr = match.groupValues[1].trim()
            val resolved: Any? = when {
                // {{steps.nameOrId.output.field}} or {{steps.nameOrId.field}}
                expr.startsWith("steps.") -> {
                    val parts = expr.removePrefix("steps.").split(".")
                    if (parts.isEmpty()) null else {
                        val ref    = parts[0]
                        // "previous" resolves to the last completed step before this node
                        val nodeId = when (ref.lowercase()) {
                            "previous", "prev", "last" ->
                                previousNodeId ?: (nameToId[ref] ?: ref)
                            else ->
                                nameToId[ref] ?: nameToId[ref.lowercase()] ?: ref
                        }
                        val outputs = allOutputs[nodeId] ?: emptyMap()
                        // Skip "output" segment (steps.name.output.field → same as steps.name.field)
                        val fields = if (parts.size >= 2 && parts[1] == "output") parts.drop(2) else parts.drop(1)
                        if (fields.isEmpty()) {
                            // {{steps.name}} with no field → return cleaned content or entire meaningful output
                            val raw = outputs["content"] ?: outputs["summary"] ?: outputs["result"]
                                ?: if (outputs.size == 1) outputs.values.first() else null
                            raw?.let { stripMarkdownFences(it.toString()) } ?: formatOutputAsHtml(outputs)
                        } else {
                            val field = fields.last()
                            // 1. Nested field path (steps.X.a.b.c)
                            val nested = fields.fold(outputs as Any?) { acc, key -> (acc as? Map<*, *>)?.get(key) }
                            // 2. Flat lookup in top-level outputs
                            val flat = outputs[field]
                            // 3. Reverse output-mapping (template uses source expr, stored under mapped key)
                            val viaMapping = reverseMappings[field]?.let { (nid, storedKey) ->
                                allOutputs[nid]?.get(storedKey)
                            }
                            // 4. Parse content field as JSON (handles truncated JSON too)
                            //    e.g. agent returns {content: "```json {\"itinerary\":{...}}"
                            val insideContent = allOutputs.values.firstNotNullOfOrNull { out ->
                                val raw = out["content"]?.toString() ?: return@firstNotNullOfOrNull null
                                val json = stripMarkdownFences(raw)
                                val parsed = parseJsonBestEffort(json) ?: return@firstNotNullOfOrNull null
                                parsed[field]
                                    ?: fields.fold(parsed as Any?) { acc, key -> (acc as? Map<*, *>)?.get(key) }
                            }
                            // 5. Global search across ALL step outputs for field name
                            val globalSearch = allOutputs.values.firstNotNullOfOrNull { it[field] }
                            // 6. Entire content of previous step, cleaned and formatted as HTML
                            val entireOutput = if (outputs.isNotEmpty()) {
                                val raw = outputs["content"]?.toString()
                                if (raw != null) formatContentAsHtml(stripMarkdownFences(raw), field)
                                else formatOutputAsHtml(outputs)
                            } else null

                            val result = nested ?: flat ?: viaMapping ?: insideContent ?: globalSearch ?: entireOutput
                            // Format Maps/Lists through readable formatter; strip fences from strings
                            when (result) {
                                is Map<*, *>, is List<*> -> formatValueAsHtml(result)
                                is String                -> stripMarkdownFences(result)
                                else                     -> result
                            }
                        }
                    }
                }
                // {{input.key}} or {{input.key.nested}}
                expr.startsWith("input.") -> {
                    val parts = expr.removePrefix("input.").split(".")
                    parts.fold(ctx.workflowInput as Any?) { acc, key -> (acc as? Map<*, *>)?.get(key) }
                }
                else -> null
            }
            if (resolved == null) {
                log.warn("[email-template] could not resolve '{{{}}}' — previousNodeId={}, outputs={}",
                    expr, previousNodeId,
                    allOutputs.entries.joinToString { "'${ctx.graph.nodes.find { n -> n.id == it.key }?.label ?: it.key}': ${it.value.keys}" })
                // Last resort: dump content from all steps (excluding LLM metadata fields)
                val metaFields = setOf("model", "provider", "tokenCount", "finishReason", "usage")
                allOutputs.entries.joinToString("\n\n") { (nid, out) ->
                    val content = out["content"]?.toString()
                    if (content != null) {
                        formatContentAsHtml(stripMarkdownFences(content), "output")
                    } else {
                        out.entries.filter { it.key !in metaFields }.joinToString("\n") { (k, v) -> "$k: $v" }
                    }
                }
            } else {
                // Format Maps/Lists through the readable formatter, not .toString()
                when (resolved) {
                    is Map<*, *>, is List<*> -> formatValueAsHtml(resolved)
                    is String                -> stripMarkdownFences(resolved)
                    else                     -> resolved.toString()
                }
            }
        }
    }

    /**
     * Last-mile email body cleaner — always called before sending.
     * If the body looks like JSON (starts with { or [), parse and format it.
     * Otherwise strip markdown fences and pass through.
     */
    @Suppress("UNCHECKED_CAST")
    private fun cleanEmailBody(body: String): String {
        val trimmed = body.trim()

        // Already plain text — just ensure no leftover markdown fences
        if (!trimmed.startsWith("{") && !trimmed.startsWith("[") && !trimmed.startsWith("```")) {
            return trimmed.replace("```json", "").replace("```", "").trim()
        }

        // Strip markdown fences then try to parse JSON
        val json = stripMarkdownFences(trimmed)

        // Try full parse, then best-effort parse for truncated JSON
        val parsed: Any? = runCatching {
            val m = mapper.readValue(json, Map::class.java) as Map<String, Any?>
            // If top-level has a single key that's the actual data, unwrap it
            if (m.size == 1) m.values.first() else m
        }.getOrNull() ?: runCatching {
            val m = parseJsonBestEffort(json) as Map<String, Any?>
            if (m.size == 1) m.values.first() else m
        }.getOrNull() ?: runCatching {
            mapper.readValue(json, List::class.java)
        }.getOrNull()

        return if (parsed != null) formatValueAsHtml(parsed) else json
    }

    private fun sendBuiltinEmail(
        config: Map<String, Any>,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult {
        // APP_URL must be set in Railway to point at the Vercel Next.js app.
        // Without it we cannot reach /api/email/send.
        val appUrl = System.getenv("APP_URL")
            ?: System.getenv("NEXT_PUBLIC_APP_URL")
            ?: return NodeResult.Failed(
                "Built-in email: APP_URL environment variable is not set in the worker. " +
                "Add APP_URL=https://dev.vectorbea.com (your Vercel app URL) to Railway Variables."
            )

        val platformSecret = System.getenv("VECTORBEA_INGEST_SECRET") ?: ""

        val rawTo      = (config["emailTo"]      as? String ?: resolvedInputs["to"]      as? String ?: "").trim()
        val rawSubject = (config["emailSubject"] as? String ?: resolvedInputs["subject"] as? String ?: "(no subject)").trim()
        val rawHtml    = (config["emailBody"]    as? String ?: resolvedInputs["html"]    as? String ?: "").trim()

        // Resolve {{steps.nodeName.output.field}} and {{input.key}} templates
        val toRaw   = resolveEmailTemplate(rawTo,      ctx)
        val subject = resolveEmailTemplate(rawSubject, ctx)
        val html    = cleanEmailBody(resolveEmailTemplate(rawHtml, ctx))

        if (toRaw.isEmpty()) {
            return NodeResult.Failed(
                "Built-in email: 'To (recipient emails)' is empty. " +
                "Open the workflow builder, click the email tool node, and fill in the To field."
            )
        }

        val payload = mapper.writeValueAsString(mapOf(
            "to"      to toRaw,
            "subject" to subject,
            "html"    to html,
        ))

        val emailUrl = "$appUrl/api/email/send"
        log.info("[builtin-email] POST $emailUrl to=$toRaw subject='$subject'")

        return try {
            val http    = java.net.http.HttpClient.newHttpClient()
            val request = java.net.http.HttpRequest.newBuilder()
                .uri(java.net.URI.create(emailUrl))
                .header("Content-Type", "application/json")
                .header("X-Platform-Secret", platformSecret)
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(payload))
                .timeout(java.time.Duration.ofSeconds(30))
                .build()

            val response = http.send(request, java.net.http.HttpResponse.BodyHandlers.ofString())
            val body = response.body() ?: ""

            if (response.statusCode() !in 200..299) {
                log.warn("[builtin-email] HTTP ${response.statusCode()}: $body")
                return NodeResult.Failed(
                    "Built-in email HTTP ${response.statusCode()}: $body".take(400)
                )
            }

            log.info("[builtin-email] sent successfully to=$toRaw")

            @Suppress("UNCHECKED_CAST")
            val parsed = runCatching { mapper.readValue(body, Map::class.java) as Map<String, Any?> }.getOrDefault(emptyMap())
            NodeResult.Completed(output = mapOf(
                "sent"       to true,
                "messageId"  to (parsed["messageId"] ?: ""),
                "recipients" to toRaw,
                "provider"   to "resend",
            ))
        } catch (e: Exception) {
            // Show exception class + message so "null" never appears
            val detail = "${e::class.simpleName}: ${e.message ?: "no message"}"
            log.error("[builtin-email] failed: $detail")
            NodeResult.Failed("Built-in email failed ($detail). Check that APP_URL=$appUrl is reachable from Railway.")
        }
    }
}
