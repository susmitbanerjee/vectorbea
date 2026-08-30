package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import com.vectorbea.worker.agents.brain.model.AgentLoopState
import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner
import com.vectorbea.worker.agents.brain.runtime.BudgetExceededException
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode
import java.util.UUID
import javax.sql.DataSource

/**
 * Executes AGENT nodes by looking up the agent definition from the `agents` table
 * and invoking it as an LLM call via [LlmNodeExecutor].
 *
 * The node's config must contain `agentId` (UUID string) referencing a row in the
 * `agents` table.  The agent's `llm_connection_id`, `model_name`, `instructions`,
 * and `temperature` are used to build a synthetic LLM call.
 *
 * An optional `taskInstruction` string in the node config (or resolved inputs) is
 * appended as the user message.  If absent, all resolved inputs are serialised to
 * JSON and used as the user message so that downstream template-filled values still
 * reach the model.
 *
 * This is a single-iteration agent call (no multi-turn tool loop) — full agentic
 * tool-calling loops are a planned enhancement.
 *
 * SECURITY:
 *   - agentId is validated as a UUID before DB query.
 *   - Agent lookup is workspace-scoped — cross-workspace access is impossible.
 *   - API keys are always resolved via [ConnectionResolver]; never logged or cached.
 *   - System prompt / task instruction content is treated as untrusted and never logged raw.
 */
class AgentNodeExecutor(
    private val dataSource: DataSource,
    private val connectionResolver: ConnectionResolver,
    private val eventStore: RunEventStore,
    /**
     * Tenant-database pools, forwarded to [AgentBrainRunner] so an iterative
     * agent can call a database tool. Without it the brain has no way to reach a
     * tenant database and says so, instead of running the call down a path that
     * cannot work.
     */
    private val dbPoolManager: com.vectorbea.worker.connector.pool.ClientDbPoolManager? = null,
    /**
     * Whether this executor routes agents through an activation.
     *
     * Defaults to the env flag; a parameter for the same reason
     * [AgentBrainRunner.reconstructionEnabled] is one — the differential test has to
     * run the SAME agent down BOTH paths in one JVM and compare, and process
     * environment cannot be flipped between them portably.
     */
    private val activationsEnabled: Boolean = ACTIVATIONS_ENABLED,
    /**
     * Forwarded to [AgentBrainRunner]. Null in production, where the shared bounded
     * client is used. See that parameter for why the seam exists.
     */
    private val llmHttpClient: java.net.http.HttpClient? = null,
) : NodeExecutor {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    internal companion object {
        /**
         * Agent types whose whole point is calling tools, so they take the loop even
         * with no tools granted yet - an empty grant list is a setup step, not a
         * decision to run them as a single prompt.
         */
        val TOOL_CALLING_AGENT_TYPES = setOf("iterative_agent", "tool_agent")

        /**
         * Route the single-agent path through an activation.
         *
         * Default OFF. This phase must not change how a single-agent workflow
         * behaves, and the only way to be sure of that is for the old path to
         * remain reachable and unmodified until the differential evidence is
         * signed off.
         */
        internal val ACTIVATIONS_ENABLED: Boolean =
            System.getenv("AGENT_ACTIVATIONS_ENABLED")?.lowercase() == "true"

        /**
         * Whether this step runs the tool-calling loop or a single model call.
         *
         * Extracted so the rule can be read and tested on its own. It decided
         * silently and wrongly for a long time, and the symptom - a green run with an
         * empty table - pointed at the tool, the connection and the SQL long before
         * it pointed here.
         */
        internal fun shouldUseToolLoop(
            agentType: String,
            hasGrantedTools: Boolean,
            brainEnabled: Boolean?,
        ): Boolean = brainEnabled
            ?: (agentType in TOOL_CALLING_AGENT_TYPES || hasGrantedTools)
    }

    private val llmExecutor by lazy { LlmNodeExecutor(connectionResolver, eventStore) }

    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult {
        val agentIdStr = node.config["agentId"] as? String
            ?: return NodeResult.Failed("Agent node '${node.id}' missing required config: agentId")

        val agentId = try { UUID.fromString(agentIdStr) }
        catch (_: Exception) {
            return NodeResult.Failed("Agent node '${node.id}': invalid agentId format (expected UUID)")
        }

        // Load agent definition — workspace-scoped
        val agent = loadAgent(agentId, ctx.workspaceId)
            ?: return NodeResult.Failed("Agent '$agentIdStr' not found or not accessible for node '${node.id}'")

        /*
         * ── Which path: the tool-calling loop, or a single LLM call? ──────────
         *
         * THE BUG THIS FIXES: this asked only `agentType == "iterative_agent"`.
         * Everything else fell through to the single-shot path below, which has no
         * tool loop at all - it builds one LLM request and returns the text.
         *
         * But the platform lets you grant tools to ANY agent type. So an agent whose
         * instructions said "write the result to postgres", with the Postgres tool
         * granted, called the model once, got prose back, and reported success. The
         * run was green and the table was empty. Nothing in the event stream said the
         * tool had been skipped, because from the executor's point of view nothing had
         * gone wrong - it was never asked to call one.
         *
         * `tool_agent` is the same story with a name that makes it plainer: a type
         * literally meaning "uses tools" could not call one.
         *
         * So the question is no longer "what is this agent labelled" but "is this
         * agent set up to use tools". Granting a tool is the operator saying it should
         * be used; an agent that ignores its granted tools is not a configuration
         * anyone chose.
         *
         * `brainEnabled` on the node overrides in BOTH directions. The builder has
         * written that key since the loop shipped (`WorkflowInspector` sets it when you
         * pick an agent) and nothing has ever read it, so the toggle silently did
         * nothing. Honouring it also leaves a way to force the cheap single-shot path
         * for an agent that has tools but should not use them here.
         */
        val useBrain = shouldUseToolLoop(
            agentType      = agent.agentType,
            hasGrantedTools = agent.allowedToolIds.isNotEmpty(),
            brainEnabled   = node.config["brainEnabled"] as? Boolean,
        )

        if (useBrain) {
            return executeIterativeAgent(agent, node, resolvedInputs, ctx)
        }

        /* Reachable only when `brainEnabled = false` was set explicitly on a node whose
           agent does have tools. That is a legitimate choice, but a silent one, and
           silence is what made the original bug so hard to see - so it is stated. */
        if (agent.allowedToolIds.isNotEmpty()) {
            emitEvent(ctx, node.id, EventType.AGENT_STARTED, "running",
                title   = "Tool calling is off for this step",
                summary = "Agent '${agent.name}' has ${agent.allowedToolIds.size} tool(s) granted, but " +
                          "brainEnabled=false on node '${node.id}', so this is a single model call and " +
                          "no tool will run.")
        }

        // Single-shot LLM path: one request, no tool loop.

        val connectionId = agent.llmConnectionId
            ?: return NodeResult.Failed(
                "Agent '${agent.name}' has no LLM connection configured. " +
                "Assign a connection to the agent before running this workflow."
            )

        emitEvent(ctx, node.id, EventType.AGENT_STARTED, "running",
            title   = "Agent started: ${agent.name}",
            summary = "model=${agent.modelName ?: "default"}")

        // ── Build messages ────────────────────────────────────────────────────

        val systemPrompt  = agent.instructions
        // Node-level taskInstruction overrides; fall back to resolved input keys
        val taskInstruction: String? = node.config["taskInstruction"] as? String
            ?: resolvedInputs["taskInstruction"] as? String
            ?: resolvedInputs["task"] as? String
            ?: resolvedInputs["prompt"] as? String
            ?: resolvedInputs["input"] as? String

        val messages = mutableListOf<Map<String, Any>>()
        if (!systemPrompt.isNullOrBlank()) {
            messages += mapOf("role" to "system", "content" to systemPrompt)
        }
        // If there are resolved inputs but no explicit task instruction, pass them as JSON
        val userContent: String = taskInstruction
            ?: if (resolvedInputs.isNotEmpty()) {
                try { mapper.writeValueAsString(resolvedInputs) } catch (_: Exception) { "" }
            } else ""

        if (userContent.isNotBlank()) {
            messages += mapOf("role" to "user", "content" to userContent)
        }

        if (messages.isEmpty()) {
            return NodeResult.Failed(
                "Agent node '${node.id}': no system prompt or task instruction provided — " +
                "set taskInstruction in the node config or supply input mapping."
            )
        }

        // ── Model overrides from node config (optional) ───────────────────────

        val modelOverride  = node.config["modelName"] as? String
        val tempOverride   = (node.config["temperature"] as? Number)?.toDouble()
        val tokensOverride = (node.config["maxTokens"] as? Number)?.toInt()

        val syntheticConfig = buildMap<String, Any> {
            put("connectionId", connectionId)
            put("messages",     messages)
            (modelOverride  ?: agent.modelName)?.let  { put("model",       it) }
            (tempOverride   ?: agent.temperature)?.let { put("temperature", it) }
            (tokensOverride ?: agent.maxTokens)?.let  { put("maxTokens",   it) }
            /*
             * ── THE TWO BUDGETS DISAGREED, AND THE OUTER ONE WON ─────────────
             *
             * The synthetic node carried no `timeoutMs`, so `LlmNodeExecutor`
             * fell back to its own 60s default while `WorkflowRuntime` wrapped
             * this whole call in `withTimeoutOrNull(node.timeoutPolicy.timeoutMs)`
             * — 30s for any node the Advanced tab had ever been opened on.
             *
             * The outer one fires first, and it cancels rather than reporting:
             * the run records "Node 'x' timed out after 30000ms" and loses the
             * provider's actual response, its status code, and its latency. The
             * retry then succeeds because the TLS session, the connection and
             * the JIT are all warm the second time — which is exactly the
             * "first agent execution fails, retry succeeds" pattern.
             *
             * Passing the node's own budget down makes the HTTP client the thing
             * that gives up, so the failure carries the provider's error instead
             * of a cancellation, and the abort releases the socket rather than
             * abandoning it.
             */
            node.timeoutPolicy.timeoutMs.takeIf { it > 0 }?.let { put("timeoutMs", innerBudgetMs(it)) }
        }

        val syntheticNode = node.copy(type = "llm", config = syntheticConfig)

        val result = llmExecutor.execute(syntheticNode, resolvedInputs, ctx)

        // If the LLM returned valid JSON in `content`, merge the parsed fields into the output.
        // This lets downstream nodes use {{steps.agentId.output.risk_level}} etc. directly
        // without needing a separate Transform node to parse the LLM response.
        val enrichedResult = if (result is NodeResult.Completed) {
            val content = result.output["content"] as? String
            if (!content.isNullOrBlank()) {
                @Suppress("UNCHECKED_CAST")
                val parsed: Map<String, Any>? = try {
                    val json = com.fasterxml.jackson.module.kotlin.jacksonObjectMapper()
                        .readValue(content.trim(), Map::class.java) as? Map<String, Any>
                    // Only merge if it's a JSON object (not an array or primitive)
                    json
                } catch (_: Exception) { null }

                if (parsed != null) {
                    // Merge parsed fields — original LLM metadata (model, tokenCount, etc.)
                    // is kept but parsed fields take precedence for any overlaps
                    NodeResult.Completed(
                        output   = result.output + parsed,
                        metadata = result.metadata,
                    )
                } else result
            } else result
        } else result

        val agentStatus = if (enrichedResult is NodeResult.Completed) "success" else "failed"
        emitEvent(ctx, node.id, EventType.AGENT_COMPLETED, agentStatus,
            title = "Agent ${if (enrichedResult is NodeResult.Completed) "completed" else "failed"}: ${agent.name}")

        return enrichedResult
    }

    /**
     * The HTTP budget to give the model call, given the node's wall-clock budget.
     *
     * Deliberately SHORTER than the node's own timeout. If the two were equal the
     * race would be arbitrary, and losing it means the coroutine is cancelled
     * mid-flight: no status code, no provider message, no latency — just
     * "timed out after Nms", which is the least useful thing a failed agent step
     * can say. A tenth of the budget, capped at five seconds, is enough headroom
     * for the client to abort cleanly and for this executor to return a real
     * failure that the recovery classifier can categorise.
     */
    private fun innerBudgetMs(nodeTimeoutMs: Long): Long {
        val headroom = (nodeTimeoutMs / 10).coerceAtMost(5_000L)
        return (nodeTimeoutMs - headroom).coerceAtLeast(1_000L)
    }

    // ── Agent row ─────────────────────────────────────────────────────────────

    private data class AgentRow(
        val id: String,
        val name: String,
        val agentType: String,
        val instructions: String?,
        val llmConnectionId: String?,
        val modelName: String?,
        val temperature: Double?,
        val maxTokens: Int?,
        val maxIterations: Int,
        val maxToolCalls: Int,
        val maxCostCents: Int,
        val allowedToolIds: List<String>,
    )

    /**
     * Load agent row from DB.
     *
     * Uses a two-stage approach to handle schema version skew between deployments:
     *   Stage 1: Query with V010 columns (max_tool_calls, max_cost_cents, allowed_tool_ids).
     *   Stage 2: If that fails (columns not yet present), fall back to V001 base columns
     *            and derive limits from timeout_policy_json with correct integer casts.
     *
     * This makes the worker resilient to the window between API deployment
     * (which runs Flyway migrations) and worker deployment.
     */
    private fun loadAgent(agentId: UUID, workspaceId: UUID): AgentRow? {
        // ── Stage 1: V010 schema (preferred) ─────────────────────────────────
        try {
            return dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT id, name, type, instructions, llm_connection_id,
                       model_name, temperature, max_tokens, max_iterations,
                       COALESCE(max_tool_calls, 5)  AS max_tool_calls_val,
                       COALESCE(max_cost_cents, 50) AS max_cost_cents_val,
                       -- allowed_tool_ids is TEXT[] (added by V003), not JSONB.
                       -- to_jsonb() converts text[] → ["id1","id2"] as jsonb safely.
                       COALESCE(to_jsonb(allowed_tool_ids), '[]'::jsonb) AS allowed_tool_ids_json
                       FROM agents
                       WHERE id = ? AND workspace_id = ? AND status = 'active'"""
                ).use { stmt ->
                    stmt.setObject(1, agentId)
                    stmt.setObject(2, workspaceId)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) return@use null
                        @Suppress("UNCHECKED_CAST")
                        val toolIds = try {
                            mapper.readValue(rs.getString("allowed_tool_ids_json") ?: "[]", List::class.java) as List<String>
                        } catch (_: Exception) { emptyList() }
                        AgentRow(
                            id              = rs.getString("id"),
                            name            = rs.getString("name"),
                            agentType       = rs.getString("type") ?: "native_llm_agent",
                            instructions    = rs.getString("instructions"),
                            llmConnectionId = rs.getString("llm_connection_id"),
                            modelName       = rs.getString("model_name"),
                            temperature     = rs.getObject("temperature")?.let { (it as? Number)?.toDouble() },
                            maxTokens       = rs.getObject("max_tokens")?.let { (it as? Number)?.toInt() },
                            maxIterations   = rs.getObject("max_iterations")?.let { (it as? Number)?.toInt() } ?: 5,
                            maxToolCalls    = rs.getObject("max_tool_calls_val")?.let { (it as? Number)?.toInt() } ?: 5,
                            maxCostCents    = rs.getObject("max_cost_cents_val")?.let { (it as? Number)?.toInt() } ?: 50,
                            allowedToolIds  = toolIds,
                        )
                    }
                }
            }
        } catch (e: Exception) {
            // Log with full message so we can diagnose the exact SQL error
            log.warn("[agent-executor] V010 query failed ({}): {} — retrying with V001 fallback",
                agentId, e.message?.take(200))
        }

        // ── Stage 2: V001 base schema fallback ───────────────────────────────
        // Used when V010 columns (max_tool_calls, max_cost_cents, allowed_tool_ids)
        // don't exist yet because the API migration hasn't run on this environment.
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT id, name, type, instructions, llm_connection_id,
                       model_name, temperature, max_tokens, max_iterations,
                       COALESCE(
                           (SELECT value::integer
                            FROM jsonb_each_text(timeout_policy_json)
                            WHERE key = 'maxToolCalls'
                            LIMIT 1),
                           5
                       ) AS max_tool_calls_val,
                       COALESCE(
                           (SELECT value::integer
                            FROM jsonb_each_text(timeout_policy_json)
                            WHERE key = 'maxCostCents'
                            LIMIT 1),
                           50
                       ) AS max_cost_cents_val
                       FROM agents
                       WHERE id = ? AND workspace_id = ? AND status = 'active'"""
                ).use { stmt ->
                    stmt.setObject(1, agentId)
                    stmt.setObject(2, workspaceId)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) return@use null
                        AgentRow(
                            id              = rs.getString("id"),
                            name            = rs.getString("name"),
                            agentType       = rs.getString("type") ?: "native_llm_agent",
                            instructions    = rs.getString("instructions"),
                            llmConnectionId = rs.getString("llm_connection_id"),
                            modelName       = rs.getString("model_name"),
                            temperature     = rs.getObject("temperature")?.let { (it as? Number)?.toDouble() },
                            maxTokens       = rs.getObject("max_tokens")?.let { (it as? Number)?.toInt() },
                            maxIterations   = rs.getObject("max_iterations")?.let { (it as? Number)?.toInt() } ?: 5,
                            maxToolCalls    = rs.getObject("max_tool_calls_val")?.let { (it as? Number)?.toInt() } ?: 5,
                            maxCostCents    = rs.getObject("max_cost_cents_val")?.let { (it as? Number)?.toInt() } ?: 50,
                            allowedToolIds  = emptyList(),
                        )
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[agent-executor] V001 fallback also failed [agentId={}, workspaceId={}]: {} — {}",
                agentId, workspaceId, e.javaClass.simpleName, e.message?.take(300))
            null
        }
    }

    // ── Iterative agent execution via AgentBrainRunner ────────────────────────

    private suspend fun executeIterativeAgent(
        agent: AgentRow,
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult {
        val connectionId = agent.llmConnectionId
            ?: return NodeResult.Failed("Iterative agent '${agent.name}' has no LLM connection configured.")

        val brainRunner = AgentBrainRunner(
            dataSource         = dataSource,
            eventStore         = eventStore,
            connectionResolver = connectionResolver,
            dbPoolManager      = dbPoolManager,
            /* So ASK_APPROVAL can open a real row in `run_approvals` — the same table
               the Approvals screen reads and the same gate DB_WRITE nodes use. */
            approvalStore      = com.vectorbea.worker.runtime.checkpoint.ApprovalStore(dataSource),
            llmHttpClient      = llmHttpClient,
        )

        val config = AgentBrainConfig(
            agentId         = UUID.fromString(agent.id),
            workspaceId     = ctx.workspaceId,
            environmentId   = ctx.environmentId,
            runId           = ctx.runId,
            stepId          = node.id,
            agentName       = agent.name,
            role            = null,
            instructions    = agent.instructions ?: "Complete the task.",
            llmConnectionId = UUID.fromString(connectionId),
            modelName       = agent.modelName ?: "gpt-4o-mini",
            temperature     = agent.temperature ?: 0.2,
            maxTokens       = agent.maxTokens ?: 2048,
            maxIterations   = agent.maxIterations,
            maxToolCalls    = agent.maxToolCalls,
            maxCostCents    = agent.maxCostCents,
            /* The same fallback chain the single-shot path uses. Without it, routing
               an agent here that supplied its task through input mapping rather than
               a node-level field would drop the task entirely and prompt the model
               with "Complete the task based on the provided inputs." */
            taskInstruction = node.config["taskInstruction"] as? String
                ?: resolvedInputs["taskInstruction"] as? String
                ?: resolvedInputs["task"] as? String
                ?: resolvedInputs["prompt"] as? String
                ?: resolvedInputs["input"] as? String,
            allowedToolIds  = agent.allowedToolIds.mapNotNull {
                try { UUID.fromString(it) } catch (_: Exception) { null }
            }.toSet(),
            resolvedInput   = resolvedInputs,
        )

        /*
         * ── THE ACTIVATION PATH, BEHIND ITS FLAG ─────────────────────────────
         *
         * With AGENT_ACTIVATIONS_ENABLED the same brain runs, with the same
         * config, under an activation row that reattaches on resume. Off, not one
         * line of it executes and the path below is exactly what shipped.
         *
         * The result is mapped back to the SAME NodeResult shapes the old branch
         * produced, because the whole promise of this phase is that a
         * single-agent workflow cannot tell the difference.
         */
        if (activationsEnabled) {
            return runActivation(agent, node, config, brainRunner, ctx)
        }

        return try {
            val result = brainRunner.run(config, ctx)

            /*
             * A step waiting on a person is paused, not failed.
             *
             * Everything that was not FINAL_OUTPUT used to fall into the failure branch
             * below, APPROVAL_REQUESTED included — so the one action whose purpose is to
             * wait for a human ended the run instead. The runtime has handled
             * ApprovalPaused all along: it parks the run as `waiting_for_approval`, marks
             * the node GATED on the ribbon, and resumes when the decision arrives.
             */
            if (result.stopReason == AgentLoopState.StopReason.APPROVAL_REQUESTED &&
                result.approvalId != null
            ) {
                return NodeResult.ApprovalPaused(
                    approvalId = result.approvalId,
                    message    = result.approvalMessage
                        ?: "Agent '${agent.name}' is waiting for approval to continue.",
                    metadata   = mapOf(
                        "agentName"       to agent.name,
                        "brainIterations" to result.iterationsUsed,
                    ),
                )
            }

            if (result.stopReason == AgentLoopState.StopReason.FINAL_OUTPUT) {
                NodeResult.Completed(
                    // result.finalOutput is Map<String,Any?> — filter nulls to satisfy Map<String,Any>
                    output = result.finalOutput.filterValues { it != null }.mapValues { it.value!! } + mapOf(
                        "_brainIterations"  to result.iterationsUsed,
                        "_brainTokens"      to result.tokensUsed,
                        "_brainStopReason"  to result.stopReason.name,
                    ) + if (result.failedToolCalls.isEmpty()) emptyMap() else mapOf(
                        /* The agent declared success having had tool calls fail. That is
                           allowed - see RunResult.failedToolCalls - but it travels with
                           the output so a downstream branch can test it and the run
                           detail shows it, instead of the run simply reading green. */
                        "_toolFailures"        to result.failedToolCalls.size,
                        "_toolFailureMessages" to result.failedToolCalls.map { it.take(300) },
                    ),
                )
            } else {
                /* Lead with WHAT went wrong, then the category. This string becomes
                   the run's error_json, which is what the run detail screen shows
                   for a failed run — "stopped with reason: ERROR after 1 iterations"
                   told whoever opened it nothing at all, while the real cause sat in
                   an event further down the timeline. */
                val cause = result.failureReason?.takeIf { it.isNotBlank() }
                NodeResult.Failed(
                    buildString {
                        append("Agent '${agent.name}' ")
                        if (cause != null) append("failed: $cause") else append("did not produce a final output")
                        append(" (stopReason=${result.stopReason}, iterations=${result.iterationsUsed})")
                    },
                    /* The loop decides this, not the stop reason: StopReason.ERROR covers
                       both a refused LLM connection (retry, by all means) and a tool that
                       failed identically twice (retrying replays it). See
                       RunResult.retryable. */
                    retryable = result.retryable,
                )
            }
        } catch (e: BudgetExceededException) {
            /* The next attempt gets the same budget and the same work. */
            NodeResult.Failed("Agent '${agent.name}' budget exceeded: ${e.message}", retryable = false)
        } catch (e: Exception) {
            NodeResult.Failed("Agent '${agent.name}' error: ${e.message?.take(300)}")
        }
    }

    /**
     * Run this agent as an activation.
     *
     * Everything hard lives in [AgentHarness]; this maps its result back onto the
     * NodeResult vocabulary the runtime already speaks. The mapping is one-to-one
     * with the legacy branch above, which is what makes the differential test
     * meaningful rather than decorative.
     */
    private suspend fun runActivation(
        agent: AgentRow,
        node: WorkflowNode,
        config: com.vectorbea.worker.agents.brain.model.AgentBrainConfig,
        brainRunner: AgentBrainRunner,
        ctx: RuntimeContext,
    ): NodeResult {
        val harness = com.vectorbea.worker.agents.orchestration.AgentHarness(
            store = com.vectorbea.worker.agents.orchestration.ActivationStore(dataSource),
            brainRunner = brainRunner,
        )

        val request = com.vectorbea.worker.agents.orchestration.AgentHarness.ActivationRequest(
            runId = ctx.runId,
            workspaceId = ctx.workspaceId,
            environmentId = ctx.environmentId,
            stepId = node.id,
            agentId = UUID.fromString(agent.id),
            agentName = agent.name,
            resolvedTaskInstruction = config.taskInstruction,
            /* The DEFINITION, pinned. Granted tool ids are deliberately absent:
               a grant is policy and is re-read live on every execution so a
               revoked tool takes effect on a paused run. */
            agentSnapshot = mapOf(
                "instructions" to agent.instructions,
                "modelName" to agent.modelName,
                "temperature" to agent.temperature,
                "maxTokens" to agent.maxTokens,
                "maxIterations" to agent.maxIterations,
                "maxToolCalls" to agent.maxToolCalls,
                "maxCostCents" to agent.maxCostCents,
            ),
            agentVersion = null,
            budgetAllocated = mapOf(
                "maxIterations" to agent.maxIterations,
                "maxToolCalls" to agent.maxToolCalls,
                "maxCostCents" to agent.maxCostCents,
            ),
            /* The pinned instruction is substituted here and nowhere else, so the
               rest of the config is built exactly as the legacy path builds it. */
            buildConfig = { instruction -> config.copy(taskInstruction = instruction) },
        )

        return try {
            when (val r = harness.activate(request, ctx)) {
                is com.vectorbea.worker.agents.orchestration.AgentHarness.ActivationResult.Completed ->
                    NodeResult.Completed(output = r.output)

                is com.vectorbea.worker.agents.orchestration.AgentHarness.ActivationResult.Paused ->
                    NodeResult.ApprovalPaused(
                        approvalId = r.approvalId,
                        message = r.message,
                        metadata = mapOf(
                            "agentName" to agent.name,
                            "brainIterations" to r.iterationsUsed,
                        ),
                    )

                is com.vectorbea.worker.agents.orchestration.AgentHarness.ActivationResult.Failed ->
                    NodeResult.Failed(r.reason, retryable = r.retryable)

                /* Unreachable in this phase and NOT defaulted: when P7 starts
                   constructing these, the compiler points at every place that has
                   to learn about them. */
                is com.vectorbea.worker.agents.orchestration.AgentHarness.ActivationResult.Delegated,
                is com.vectorbea.worker.agents.orchestration.AgentHarness.ActivationResult.Transferred ->
                    NodeResult.Failed(
                        "Agent '${agent.name}' attempted a delegation, which this " +
                        "version of the runtime cannot execute.", retryable = false)
            }
        } catch (e: BudgetExceededException) {
            NodeResult.Failed("Agent '${agent.name}' budget exceeded: ${e.message}", retryable = false)
        } catch (e: Exception) {
            NodeResult.Failed("Agent '${agent.name}' error: ${e.message?.take(300)}")
        }
    }

    // ── Event helper ──────────────────────────────────────────────────────────

    private fun emitEvent(
        ctx: RuntimeContext,
        nodeId: String,
        type: EventType,
        status: String,
        title: String? = null,
        summary: String? = null,
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
        ))
    } catch (_: Exception) {}
}
