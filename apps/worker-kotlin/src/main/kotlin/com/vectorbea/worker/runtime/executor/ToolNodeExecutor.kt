package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.checkpoint.ApprovalDecision
import com.vectorbea.worker.runtime.checkpoint.ApprovalGateConfig
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.checkpoint.decideOnApproval
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowNode
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
    /**
     * Per-connection breaker, for outbound tool types.
     *
     * Null keeps every existing call site working unchanged; production wires the
     * same instance the other executors share, so an MCP server that is down stops
     * being called on exactly the terms an HTTP endpoint that is down does.
     */
    private val circuit: com.vectorbea.worker.net.ConnectionCircuit? = null,
    /**
     * Needed by the spec-driven HTTP path, for two things the legacy path never
     * did: reading a connection's secret as a named BUNDLE (so an auth strategy
     * can ask for `clientSecret` rather than "the secret"), and sealing a
     * refreshed OAuth2 token into `connection_oauth_tokens`.
     *
     * Null keeps every existing call site compiling and degrades the spec path
     * to what it can do without secrets — which is enough for an unauthenticated
     * endpoint and nothing else, and says so when it is not.
     */
    private val secretService: com.vectorbea.worker.connector.SecretService? = null,
    /**
     * The exactly-once guard, so a spec-driven POST is deduplicated on redelivery
     * exactly as `HttpNodeExecutor`'s is. Passing null disables deduplication —
     * acceptable in unit tests, never in production.
     */
    private val sideEffects: com.vectorbea.worker.durable.SideEffectGuard? = null,
) : NodeExecutor {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    /** Monthly cap on platform-subsidised built-in emails, per workspace. */
    private val builtinEmailMonthlyLimit: Int =
        System.getenv("BUILTIN_EMAIL_MONTHLY_LIMIT")?.toIntOrNull()?.takeIf { it > 0 } ?: 15

    private val httpExecutor    by lazy { HttpNodeExecutor(connectionResolver, eventStore) }

    /**
     * The spec-driven HTTP resolver, for tools that carry `http_spec_json`.
     *
     * ── WHY TWO EXECUTORS AND NOT A REWRITE IN PLACE ────────────────────────
     * `HttpNodeExecutor` reads loose config keys (`url`, `method`, `body`) with
     * no declared parameter mapping, one hard-coded auth header per `auth_type`,
     * and no response extraction. Everything currently registered is written in
     * those terms and works. Rewriting it to read a spec would mean synthesising
     * a spec for every existing tool at execution time — a translation layer
     * whose failures land in a customer's run rather than in a review.
     *
     * So the split is on DATA, not on a flag: a tool with a spec goes to
     * [HttpToolResolver], a tool without one goes where it always went. The old
     * path is deleted when the last tool has a spec, and not before.
     */
    private val httpSpecResolver by lazy {
        com.vectorbea.worker.tools.http.HttpToolResolver(
            connectionResolver = connectionResolver,
            eventStore = eventStore,
            secretService = secretService,
            dataSource = dataSource,
            sideEffects = sideEffects,
        )
    }

    /** MCP, lazily: most workspaces have no MCP server and should pay nothing. */
    private val mcpExecutor by lazy {
        com.vectorbea.worker.agents.tools.mcp.McpToolExecutor(
            connectionResolver = connectionResolver,
            discovery = com.vectorbea.worker.agents.tools.mcp.McpDiscovery(dataSource),
            circuit = circuit,
        )
    }
    private val dbReadExecutor  by lazy { DbReadNodeExecutor(connectionResolver, dbPoolManager, eventStore) }
    private val dbWriteExecutor by lazy { DbWriteNodeExecutor(connectionResolver, dbPoolManager,
        ApprovalStore(dataSource), eventStore) }
    private val approvalStore by lazy { ApprovalStore(dataSource) }

    override suspend fun execute(
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

        /* `<toolId>#<queryId>` when the caller selected a named query. The tool is
           loaded by its own id; the query id is read back out in
           [executeDatabaseTool], which is the only place it means anything. */
        val baseToolId = com.vectorbea.worker.agents.tools.NamedQuery.splitToolId(toolIdStr).first
        val toolId = try { UUID.fromString(baseToolId) }
        catch (_: Exception) {
            return NodeResult.Failed("Tool node '${node.id}': invalid toolId format (expected UUID)")
        }

        // Load tool definition — workspace-scoped
        val tool = loadTool(toolId, ctx.workspaceId)
            ?: return NodeResult.Failed("Tool '$toolIdStr' not found or not accessible for node '${node.id}'")

        /*
         * ── THE TOOL'S OWN requires_approval, ENFORCED FOR EVERY TOOL TYPE ───
         *
         * `requires_approval` was read from the tools table, copied into the synthetic
         * config as `requireApproval`, and then honoured by exactly one executor:
         * DbWriteNodeExecutor. Every other type ignored it. HttpNodeExecutor contains
         * no approval handling at all, and `slack`, `email` and `crm` are stored as
         * HTTP tools — so a tool flagged as needing approval fired its request,
         * completed, and no approval was ever created for anyone to decide. The flag
         * was on in the UI and off in the runtime.
         *
         * Gating here, at the boundary every tool type passes through, is the only
         * place that covers them all. DB writes now meet a gate twice: this one opens
         * it, and DbWriteNodeExecutor's finds the same row APPROVED under the same
         * (runId, nodeId) key and proceeds — they compose rather than conflict.
         *
         * Before TOOL_CALL_STARTED deliberately: a call held at a gate has not started.
         */
        if (tool.requiresApproval) {
            approvalGate(node, tool, resolvedInputs, ctx)?.let { return it }
        }

        emitEvent(ctx, node.id, EventType.TOOL_CALL_STARTED, "running",
            title   = "Tool call started: ${tool.name}",
            summary = "type=${tool.type}")

        /* Parent resolved from the node id this executor already holds — the step
           span registered itself under it. Works for an agent's synthetic
           `<stepId>:tool:<toolId>` node too, because the agent step registered that
           id when it opened. */
        val toolSpan = runCatching {
            ctx.tracer?.open("tool_call", tool.name, ctx.tracer.spanForNode(node.id)
                ?: ctx.tracer.tickSpanId)
        }.getOrNull()

        val startMs = System.currentTimeMillis()

        // Build a synthetic WorkflowNode with the tool's resolved config so existing
        // executor implementations (HttpNodeExecutor, etc.) work without modification.
        val syntheticConfig = buildSyntheticConfig(tool, node.config, resolvedInputs, ctx)
        val syntheticNode   = node.copy(config = syntheticConfig)

        val result: NodeResult = when (tool.type) {
            // Aliases for the canonical "http" type — some tools (e.g. architect-generated
            // before the type normalizer existed) may be persisted with these variants.
            "http", "http_api", "rest_api", "api", "rest" ->
                /*
                 * ── ONE BRANCH, DECIDED BY THE DATA ──────────────────────────
                 *
                 * A tool that carries `http_spec_json` executes on the resolver
                 * that understands it; everything else executes exactly where it
                 * did. There is no flag, no environment variable and no
                 * per-workspace rollout switch, because all three would let the
                 * two paths diverge for the SAME tool between one run and the
                 * next — and "it worked yesterday" on a tool that spends money is
                 * the failure this split exists to avoid.
                 */
                if (tool.httpSpecJson != null)
                    httpSpecResolver.execute(syntheticNode, resolvedInputs, ctx)
                else
                    httpExecutor.execute(syntheticNode, resolvedInputs, ctx)

            /*
             * ── DATABASE: A NAMED QUERY, OR A GATED FALLBACK ─────────────────
             *
             * This branch used to read the stored `sqlTemplate`, upper-case its
             * first whitespace-delimited token, and send it to the read path if
             * that token was `SELECT`. A leading comment, a CTE, or a
             * `SELECT writes_something()` all land somewhere the string match did
             * not intend, on a path that reaches a production database.
             *
             * The replacement does not classify better — it stops classifying.
             * `NamedQuery.access` is DECLARED by the tool author, and the routing
             * below reads the declaration. Nothing here inspects the SQL.
             */
            "database", "database_read", "database_write" ->
                executeDatabaseTool(tool, node, syntheticNode, resolvedInputs, ctx)

            /*
             * ── MCP: A TOOL TYPE, AND NOTHING MORE ───────────────────────────
             *
             * The whole point of this dispatch is that adding a type does not
             * change the runtime. Everything above and below this `when` — the
             * approval gate, the TOOL_CALL_* events, the `tool_call` span and its
             * parent, the idempotency key, the payload store — already ran or will
             * run, identically, because this is the same code path an HTTP tool
             * takes.
             *
             * `mcp_server` is accepted as an alias because the API's connection
             * tester already recognises it, and a tool type that works in one
             * service and not the other is the kind of split nobody finds until a
             * customer does.
             */
            "mcp", "mcp_server" -> executeMcpTool(tool, resolvedInputs, ctx)

            "builtin_email" -> {
                // Built-in email — calls the platform's /api/email/send route
                // which uses RESEND_API_KEY configured in Vercel.
                // No connection needed; worker calls the Next.js API directly.
                sendBuiltinEmail(node.config, resolvedInputs, ctx)
            }

            "slack", "email", "crm" -> {
                // Slack/Email/CRM tools are stored as HTTP tools under the hood,
                // and take the same spec-or-legacy split as `http` above.
                if (tool.httpSpecJson != null)
                    httpSpecResolver.execute(syntheticNode, resolvedInputs, ctx)
                else
                    httpExecutor.execute(syntheticNode, resolvedInputs, ctx)
            }

            else -> NodeResult.Failed(
                "Tool type '${tool.type}' is not yet supported by the worker (toolId=$toolIdStr)"
            )
        }

        val durationMs = System.currentTimeMillis() - startMs
        /*
         * A call held at an approval gate has not failed — it has not run yet.
         *
         * Everything that was not Completed was reported as `failed`, so a tool
         * correctly waiting for a human showed up on the timeline as a red
         * TOOL_CALL_COMPLETED status=failed. That is the "the tool call somehow
         * returns an error" that sends people looking at the tool, the connection and
         * the SQL, when nothing is wrong with any of them.
         */
        val eventStatus = when (result) {
            is NodeResult.Completed       -> "success"
            is NodeResult.ApprovalPaused  -> "waiting_for_approval"
            is NodeResult.Throttled       -> "throttled"
            else                          -> "failed"
        }
        val eventTitle = when (result) {
            is NodeResult.Completed      -> "Tool call completed: ${tool.name}"
            is NodeResult.ApprovalPaused -> "Tool call waiting for approval: ${tool.name}"
            is NodeResult.Throttled      -> "Tool call rate limited: ${tool.name}"
            else                         -> "Tool call failed: ${tool.name}"
        }
        emitEvent(ctx, node.id, EventType.TOOL_CALL_COMPLETED, eventStatus,
            title      = eventTitle,
            durationMs = durationMs)

        runCatching {
            ctx.tracer?.close(
                toolSpan, "tool_call", tool.name,
                status = when (result) {
                    is NodeResult.Completed      -> "ok"
                    is NodeResult.ApprovalPaused -> "paused"
                    is NodeResult.Throttled      -> "paused"
                    is NodeResult.Unsupported    -> "skipped"
                    else                         -> "error"
                },
                stepId = node.id,
                /* Attributes are for filtering and grouping — small, flat, already
                   safe. The tool's actual result is bulk content and belongs in the
                   payload store, not here. */
                attributesJson = """{"tool_id":"$toolId","tool_type":${jsonStr(tool.type)}}""",
                errorJson = (result as? NodeResult.Failed)
                    ?.let { """{"reason":${jsonStr(it.reason.take(300))}}""" },
            )
        }

        return result
    }

    private fun jsonStr(s: String): String =
        "\"${s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ")}\""

    /**
     * The tool's approval gate: null to proceed, otherwise the result to return.
     *
     * Keyed on (runId, node.id) — the same key DbWriteNodeExecutor uses, and the key
     * the resumed run looks the decision up by. For an agent's tool call `node.id` is
     * the stable `<stepId>:tool:<toolId>`, so approving once is enough however many
     * times the step re-executes.
     */
    private fun approvalGate(
        node: WorkflowNode,
        tool: ToolRow,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult? {
        val existing = runCatching { approvalStore.findApproval(ctx.runId, node.id) }
            .getOrElse { e ->
                log.error("[tool] approval lookup failed [nodeId={}]: {}", node.id, e.message)
                /* Fail closed. A tool marked as needing approval must not run because the
                   lookup broke — that is precisely the case where running it is worst. */
                return NodeResult.Failed(
                    "Tool '${tool.name}' requires approval and the approval could not be " +
                    "checked: ${e.message?.take(200)}", retryable = false)
            }

        if (existing != null) {
            /* The shared rule — see decideOnApproval in ApprovalStore.kt. The agent's own
               gate reads the same row through the same function. */
            return when (decideOnApproval(existing.status)) {
                ApprovalDecision.GRANT  -> null
                ApprovalDecision.REJECT -> NodeResult.Failed(
                    "Tool '${tool.name}' was not approved" +
                    (existing.resolvedBy?.let { " (decided by $it)" } ?: "") + ".",
                    retryable = false)
                ApprovalDecision.WAIT -> NodeResult.ApprovalPaused(
                    approvalId = existing.id.toString(),
                    message    = existing.message ?: "Waiting for approval to run '${tool.name}'")
            }
        }

        // Nothing on file: open the gate.
        val message = "Tool '${tool.name}' requires approval before it runs."
        return NodeResult.ApprovalPaused(
            approvalId = approvalStore.createPendingApproval(
                runId          = ctx.runId,
                workspaceId    = ctx.workspaceId,
                environmentId  = ctx.environmentId,
                nodeId         = node.id,
                message        = message,
                approvers      = emptyList(),
                resolvedInputs = resolvedInputs,
                gate = ApprovalGateConfig(
                    title     = "Tool approval: ${tool.name}",
                    riskLevel = tool.riskLevel ?: "medium",
                ),
            ),
            message = message,
        )
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

    /**
     * Invoke a remote MCP tool.
     *
     * ── THE GRANT WAS ALREADY CHECKED, AND NOT HERE ─────────────────────────
     * By the time this runs, `AgentSafetyGuard.validateToolAllowed` has compared
     * this tool's uuid against `allowed_tool_ids` read from our own database.
     * Nothing about MCP participates in that: a discovered tool is an ordinary
     * `tools` row, so a server-level grant is not refused here — it is
     * inexpressible, because the grant list holds tool ids and a server is a
     * connection.
     *
     * That is why a hostile tool description cannot widen what an agent may call.
     * The description reaches the prompt; the prompt is not an input to the grant
     * check. Invariant 1, applied to somebody else's server.
     */
    private suspend fun executeMcpTool(
        tool: ToolRow,
        resolvedInputs: Map<String, Any>,
        ctx: com.vectorbea.worker.runtime.graph.RuntimeContext,
    ): NodeResult {
        val connectionId = tool.mcpServerConnectionId?.let {
            runCatching { UUID.fromString(it) }.getOrNull()
        } ?: return NodeResult.Failed(
            "MCP tool '${tool.name}' has no server connection. It was probably created " +
            "by hand rather than by discovery; re-run discovery for its server.")

        val remoteName = tool.mcpToolName
            ?: return NodeResult.Failed(
                "MCP tool '${tool.name}' does not record what the remote server calls it.")

        /*
         * A resource read, when the caller asked for one.
         *
         * Resources are read-only context pulled on demand — the contextRefs model
         * from the delegation work, one layer out: pass a pointer and let the
         * callee read what it needs, rather than pushing every resource a server
         * offers into the prompt.
         */
        (resolvedInputs["resourceUri"] as? String)?.takeIf { it.isNotBlank() }?.let { uri ->
            return mcpExecutor.readResource(connectionId, uri, ctx.workspaceId)
        }

        return mcpExecutor.call(
            connectionId = connectionId,
            mcpToolName = remoteName,
            arguments = resolvedInputs,
            workspaceId = ctx.workspaceId,
            /* A locally-authored contract wins over the server's annotations: the
               customer's agent knows what it needs and the server author does
               not. Null here falls back to whatever discovery stored. */
            toolContract = com.vectorbea.worker.agents.tools.ToolResultContract
                .parse(tool.resultContractJson),
            timeoutMs = tool.timeoutMs?.toLong(),
        )
    }

    /**
     * Run a database tool: a named query, or a gated free-form fallback.
     *
     * ── THE ORDER OF THESE CHECKS IS THE SECURITY PROPERTY ──────────────────
     * A catalogue, once a tool has one, is exhaustive. A caller that names a
     * query not in it is refused before a connection is opened, and a caller that
     * supplies SQL to a tool with a catalogue is refused whatever the free-form
     * flag says — a tool that has declared what may run has declared that this may
     * not.
     *
     * The free-form flag is the LAST resort, not the first branch, so nothing can
     * reach the old path by omitting a field.
     */
    private suspend fun executeDatabaseTool(
        tool: ToolRow,
        node: WorkflowNode,
        syntheticNode: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: com.vectorbea.worker.runtime.graph.RuntimeContext,
    ): NodeResult {
        val catalogue = com.vectorbea.worker.agents.tools.NamedQuery.parseCatalogue(tool.namedQueriesJson)

        /* The query id arrives either on the synthetic tool id the model selected
           (`<toolId>#<queryId>` — one tool per query, so discovery is the same
           mechanism as every other tool) or as an explicit input for a caller that
           is not an agent. */
        val requestedQueryId =
            com.vectorbea.worker.agents.tools.NamedQuery.splitToolId(
                node.config["toolId"] as? String ?: "").second
                ?: (resolvedInputs["queryId"] as? String)?.takeIf { it.isNotBlank() }

        /* Any statement the CALLER is trying to supply. A tool's own stored
           `sqlTemplate` is not this: that SQL is the author's, and a tool with one
           already has the property named queries introduce. */
        val callerSuppliedSql = listOf("query", "sql", "statement")
            .firstNotNullOfOrNull { resolvedInputs[it] as? String }
            ?.takeIf { it.isNotBlank() }

        if (catalogue.isNotEmpty()) {
            if (callerSuppliedSql != null) {
                return NodeResult.Failed(
                    "Tool '${tool.name}' runs named queries only. It was given raw SQL, " +
                    "which it will not execute. Choose one of: " +
                    catalogue.joinToString { it.id } + ".")
            }
            if (requestedQueryId == null) {
                return NodeResult.Failed(
                    "Tool '${tool.name}' requires a query id. Available: " +
                    catalogue.joinToString { "${it.id} — ${it.description}" } + ".")
            }
            val query = catalogue.firstOrNull { it.id == requestedQueryId }
                ?: return NodeResult.Failed(
                    /* Named, not "invalid query": an agent that is told which ids
                       exist picks one, and an agent told only that it was wrong
                       tries a different guess. */
                    "Tool '${tool.name}' has no query '$requestedQueryId'. Available: " +
                    catalogue.joinToString { it.id } + ".")
            return runNamedQuery(tool, query, node, syntheticNode, resolvedInputs, ctx)
        }

        /* ── NO CATALOGUE: THE MIGRATION PATH ────────────────────────────────
           A caller-supplied statement needs the flag. A tool running its own
           stored SQL does not, and that is what keeps every existing tool
           working on the deploy that ships this. */
        if (callerSuppliedSql != null && !tool.allowFreeformSql) {
            return NodeResult.Failed(
                "Tool '${tool.name}' does not accept raw SQL. Declare named queries " +
                "on the tool, or set allow_freeform_sql if this tool genuinely needs " +
                "to run statements supplied by its caller.")
        }

        /*
         * The legacy routing, unchanged and now reached only here.
         *
         * Still a keyword match, and still wrong in the ways described in V057 —
         * kept because changing how an EXISTING tool's stored SQL is classified
         * would change what those tools do, which is the one thing this migration
         * promises not to do. A tool escapes it by declaring a catalogue.
         */
        val sql = (tool.configJson["sqlTemplate"] as? String ?: "").trimStart()
        val firstWord = sql.split(Regex("\\s+"), limit = 2).firstOrNull()?.uppercase() ?: ""
        return when {
            tool.type == "database_read" -> dbReadExecutor.execute(syntheticNode, resolvedInputs, ctx)
            tool.type == "database_write" -> dbWriteExecutor.execute(syntheticNode, resolvedInputs, ctx)
            firstWord == "SELECT" -> dbReadExecutor.execute(syntheticNode, resolvedInputs, ctx)
            else -> dbWriteExecutor.execute(syntheticNode, resolvedInputs, ctx)
        }
    }

    /**
     * Execute one named query: bind, bound, route by declaration.
     *
     * ── A WRITE MEETS THE GATE, WHATEVER THE TOOL SAYS ──────────────────────
     * `requires_approval` is a property of a TOOL, and one database tool can
     * legitimately expose a dozen reads and one write. Inheriting the tool's flag
     * would mean gating every read or gating no write, so a query declared WRITE
     * requires approval on its own account.
     *
     * The gate is the same `(runId, nodeId)` approval the tool boundary uses, so
     * the two compose rather than conflict — a tool that already required approval
     * finds its row APPROVED and proceeds.
     */
    private suspend fun runNamedQuery(
        tool: ToolRow,
        query: com.vectorbea.worker.agents.tools.NamedQuery,
        node: WorkflowNode,
        syntheticNode: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: com.vectorbea.worker.runtime.graph.RuntimeContext,
    ): NodeResult {
        val bound = query.bind()
        val values = query.bindValues(resolvedInputs, bound.order).getOrElse { e ->
            /* A parameter problem is the caller's to fix and is stated in its
               terms — which parameter, of which query, and what it wanted. */
            return NodeResult.Failed(e.message ?: "invalid parameters for query '${query.id}'")
        }

        if (query.access == com.vectorbea.worker.agents.tools.NamedQuery.Access.WRITE &&
            !tool.requiresApproval) {
            /* The tool boundary already gated tools whose own flag is set; this
               covers a write query on a tool whose flag is not. */
            approvalGate(node, tool, resolvedInputs, ctx)?.let { return it }
        }

        /*
         * The bound statement and its limits, handed to the existing executors.
         *
         * Reusing them rather than opening a connection here is deliberate: they
         * hold the pool management, the driver-level `socketTimeout` that is the
         * only bound that actually works against a blackholed host, the tenant
         * dispatcher and the read-only connection flag. A second implementation
         * would have to reproduce all of it and would drift.
         */
        val cfg = syntheticNode.config.toMutableMap()
        cfg["query"] = bound.sql
        cfg["statement"] = bound.sql
        cfg["params"] = values
        cfg["maxRows"] = query.maxRows
        cfg["timeoutMs"] = query.timeoutMs
        /* The write executor reads this to decide whether to gate again. It has
           already been gated above; leaving it set makes the two agree. */
        if (query.access == com.vectorbea.worker.agents.tools.NamedQuery.Access.WRITE) {
            cfg["requireApproval"] = tool.requiresApproval
        }
        val queryNode = syntheticNode.copy(config = cfg)

        log.info("[tool] named query [tool={}, query={}, access={}, maxRows={}, timeoutMs={}]",
            tool.name, query.id, query.access, query.maxRows, query.timeoutMs)

        return when (query.access) {
            com.vectorbea.worker.agents.tools.NamedQuery.Access.READ ->
                dbReadExecutor.execute(queryNode, resolvedInputs, ctx)
            com.vectorbea.worker.agents.tools.NamedQuery.Access.WRITE ->
                dbWriteExecutor.execute(queryNode, resolvedInputs, ctx)
        }
    }

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
        /** Raw `named_queries_json`. Parsed lazily — most tools have none. */
        val namedQueriesJson: String? = null,
        /** Whether a CALLER may supply SQL. Default false; see V057. */
        val allowFreeformSql: Boolean = false,
        /** The MCP connection this tool was discovered through, if any. */
        val mcpServerConnectionId: String? = null,
        /** What the remote server calls it. */
        val mcpToolName: String? = null,
        /** Locally-authored result contract. Overrides a server's annotations. */
        val resultContractJson: String? = null,
        /**
         * The declarative HTTP call (V064). Present means this tool executes on
         * [com.vectorbea.worker.tools.http.HttpToolResolver]; absent means it
         * executes on the legacy [HttpNodeExecutor], unchanged.
         */
        val httpSpecJson: String? = null,
    )

    private fun loadTool(toolId: UUID, workspaceId: UUID): ToolRow? = try {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT id, name, type, connection_id, config_json,
                   risk_level, requires_approval, timeout_ms,
                   named_queries_json, allow_freeform_sql,
                   mcp_server_connection_id, mcp_tool_name, result_contract_json,
                   http_spec_json
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
                        namedQueriesJson = rs.getString("named_queries_json"),
                        allowFreeformSql = rs.getBoolean("allow_freeform_sql"),
                        mcpServerConnectionId = rs.getString("mcp_server_connection_id"),
                        mcpToolName = rs.getString("mcp_tool_name"),
                        resultContractJson = rs.getString("result_contract_json"),
                        httpSpecJson = rs.getString("http_spec_json"),
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

        /*
         * The declarative spec, passed through verbatim.
         *
         * Everything below this line remaps legacy keys — `urlTemplate` to `url`,
         * `bodyTemplate` to a resolved `body`, `sqlTemplate` to `query`. None of
         * it applies to a spec-driven tool: `HttpToolResolver` reads the spec and
         * the model's arguments, and derives the URL, the body and the headers
         * itself. Handing it a pre-resolved body would be two layers deciding the
         * same thing, and the one that lost would do so silently.
         */
        tool.httpSpecJson?.let { result["httpSpec"] = it }

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

        /*
         * ── Bind parameters, but only what the statement actually asks for ─────
         *
         * THE BUG THIS FIXES: this block used to end with
         *
         *     result["params"] = resolvedInputs.values.toList()
         *
         * for any SQL without `{{…}}` templates, with nothing checking whether the
         * statement had placeholders to bind them to. `DbWriteNodeExecutor` then called
         * `setObject(1, …)` on a statement with none and the driver answered
         * "The column index is out of range: 1, number of columns: 0" - a description
         * of the driver's predicament, not of the user's mistake, and the reason a
         * perfectly ordinary tool could not be made to work by editing the SQL.
         *
         * A statement asking for nothing now gets nothing. The `?` count is the truth;
         * `$1`-style SQL is rewritten into it, because this file's own comment has long
         * described `$N` as the supported positional syntax while pgjdbc has only ever
         * bound `?`.
         *
         * Note the guard this replaces read `result["params"] != null ||
         * !result.containsKey("params")`, which is TRUE in both branches - the line
         * above removes the key, so the "skip" the comment promised could never happen.
         * Only the inner `sqlHasInlinedTemplates` check was doing the work.
         */
        val statementSql = result["statement"] as? String ?: result["query"] as? String
        val templatesWereInlined = (tool.configJson["sqlTemplate"] as? String)?.contains("{{") == true

        if (statementSql != null && !templatesWereInlined) {
            // A `$1`-style statement binds nothing until it is rewritten.
            val rewritten = SqlPlaceholders.rewriteDollarsToQuestionMarks(statementSql)
            if (rewritten != null) {
                result["statement"] = rewritten
                result["query"]     = rewritten
            }

            val placeholders = SqlPlaceholders.analyse(rewritten ?: statementSql).questionMarks

            if (placeholders == 0) {
                // Nothing to bind. Supplying values here is what produced the driver's
                // index error; a statement with no placeholders is complete as written.
                result.remove("params")
            } else {
                val toolParameters = tool.configJson["parameters"] as? Map<*, *>
                result["params"] = when {
                    // A declared `parameters` map is an ordered contract.
                    toolParameters != null && toolParameters.isNotEmpty() ->
                        toolParameters.keys.map { key -> resolvedInputs[key?.toString()] ?: toolParameters[key] }
                    // Otherwise fall back to the resolved inputs, in their own order.
                    else -> resolvedInputs.values.toList()
                }
                // A count mismatch is checked where the binding happens, so the message
                // can name both numbers rather than the driver's index.
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
        // APP_URL must be set so the worker can reach the email-send endpoint.
        // This is an operator config issue — keep the user message friendly and put
        // the fix instructions in the logs.
        val appUrl = System.getenv("APP_URL") ?: System.getenv("NEXT_PUBLIC_APP_URL")
        if (appUrl == null) {
            val friendly = "Built-in email is temporarily unavailable. Please try again later or contact support."
            log.error("[builtin-email] $friendly | detail=APP_URL/NEXT_PUBLIC_APP_URL not set in worker; cannot reach /api/email/send")
            return NodeResult.Failed(friendly)
        }

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

        // Abuse-proof monthly cap: atomically reserve a slot for this workspace.
        // If exhausted, fail the node with a clear, actionable message.
        if (!reserveBuiltinEmailQuota(ctx.workspaceId)) {
            return NodeResult.Failed(
                "Built-in email limit reached: $builtinEmailMonthlyLimit emails per month per workspace. " +
                "Connect your own email provider (a tool connection) to send more."
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
            // Shared client: bounded connect, headers, total call and body size.
            // `HttpClient.newHttpClient()` here previously had no connect timeout
            // at all and leaked a selector thread per email sent.
            val request = java.net.http.HttpRequest.newBuilder()
                .uri(java.net.URI.create(emailUrl))
                .header("Content-Type", "application/json")
                .header("X-Platform-Secret", platformSecret)
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(payload))

            val response = com.vectorbea.worker.net.OutboundHttp.send(
                request,
                totalCallMs = com.vectorbea.worker.net.OutboundHttp.policy().clampTotalCallMs(30_000L),
                maxResponseBytes = 262_144L,
            )
            val body = response.body

            if (response.statusCode !in 200..299) {
                refundBuiltinEmailQuota(ctx.workspaceId)  // no email went out — don't consume quota
                val friendly = if (response.statusCode in 400..499)
                    "We couldn't send the email — please check the recipient address and content, then try again."
                else
                    "The email service is temporarily unavailable. Please try again shortly."
                // Same friendly message in the log, plus technical detail for ops.
                log.warn("[builtin-email] $friendly | detail=HTTP ${response.statusCode} body=${body.take(300)}")
                return NodeResult.Failed(friendly)
            }

            log.info("[builtin-email] sent successfully to=$toRaw")

            @Suppress("UNCHECKED_CAST")
            val parsed = runCatching { mapper.readValue(body, Map::class.java) as Map<String, Any?> }.getOrDefault(emptyMap())
            NodeResult.Completed(output = mapOf(
                "sent"       to true,
                "messageId"  to (parsed["messageId"] ?: ""),
                "recipients" to toRaw,
                "provider"   to "builtin",
            ))
        } catch (e: Exception) {
            refundBuiltinEmailQuota(ctx.workspaceId)  // send threw — don't consume quota
            val friendly = "We couldn't send the email due to a temporary problem. Please try again shortly."
            // Same friendly message in the log, plus technical detail for ops.
            val detail = "${e::class.simpleName}: ${e.message ?: "no message"}"
            log.error("[builtin-email] $friendly | detail=$detail endpoint=$emailUrl")
            NodeResult.Failed(friendly)
        }
    }

    /** Current UTC quota period, e.g. "2026-06". */
    private fun currentEmailPeriod(): String =
        java.time.YearMonth.now(java.time.ZoneOffset.UTC).toString()

    /**
     * Atomically reserve one built-in-email slot for [workspaceId] this month.
     * Returns true if a slot was reserved (under the monthly limit), false if the
     * cap is already reached. The INSERT … ON CONFLICT … WHERE makes the
     * check-and-increment a single statement, so it is race-free across workers.
     */
    private fun reserveBuiltinEmailQuota(workspaceId: UUID): Boolean = try {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """
                INSERT INTO builtin_email_usage (workspace_id, period_month, sent_count, updated_at)
                VALUES (?, ?, 1, now())
                ON CONFLICT (workspace_id, period_month)
                DO UPDATE SET sent_count = builtin_email_usage.sent_count + 1, updated_at = now()
                WHERE builtin_email_usage.sent_count < ?
                RETURNING sent_count
                """.trimIndent()
            ).use { stmt ->
                stmt.setObject(1, workspaceId)
                stmt.setString(2, currentEmailPeriod())
                stmt.setInt(3, builtinEmailMonthlyLimit)
                stmt.executeQuery().use { rs -> rs.next() }  // a returned row == reserved
            }
        }
    } catch (e: Exception) {
        // The quota store is in the same DB the run already depends on; a failure
        // here is exceptional. Allow the send rather than hard-blocking on a blip.
        log.warn("[builtin-email] quota reservation failed, allowing send: {}", e.message)
        true
    }

    /** Release a previously reserved slot when the send did not actually go out. */
    private fun refundBuiltinEmailQuota(workspaceId: UUID) {
        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """
                    UPDATE builtin_email_usage
                       SET sent_count = GREATEST(sent_count - 1, 0), updated_at = now()
                     WHERE workspace_id = ? AND period_month = ?
                    """.trimIndent()
                ).use { stmt ->
                    stmt.setObject(1, workspaceId)
                    stmt.setString(2, currentEmailPeriod())
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) {
            log.warn("[builtin-email] quota refund failed: {}", e.message)
        }
    }
}
