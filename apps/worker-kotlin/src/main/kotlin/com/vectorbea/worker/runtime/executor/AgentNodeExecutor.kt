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
) : NodeExecutor {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    private val llmExecutor by lazy { LlmNodeExecutor(connectionResolver, eventStore) }

    override fun execute(
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

        // ── Route iterative_agent type to AgentBrainRunner ────────────────────
        if (agent.agentType == "iterative_agent") {
            return executeIterativeAgent(agent, node, resolvedInputs, ctx)
        }
        // All other types fall through to the single-shot LLM path below

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

    private fun executeIterativeAgent(
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
            taskInstruction = node.config["taskInstruction"] as? String,
            allowedToolIds  = agent.allowedToolIds.mapNotNull {
                try { UUID.fromString(it) } catch (_: Exception) { null }
            }.toSet(),
            resolvedInput   = resolvedInputs,
        )

        return try {
            val result = brainRunner.run(config, ctx)
            if (result.stopReason == AgentLoopState.StopReason.FINAL_OUTPUT) {
                NodeResult.Completed(
                    // result.finalOutput is Map<String,Any?> — filter nulls to satisfy Map<String,Any>
                    output = result.finalOutput.filterValues { it != null }.mapValues { it.value!! } + mapOf(
                        "_brainIterations"  to result.iterationsUsed,
                        "_brainTokens"      to result.tokensUsed,
                        "_brainStopReason"  to result.stopReason.name,
                    ),
                )
            } else {
                NodeResult.Failed(
                    "Agent '${agent.name}' stopped with reason: ${result.stopReason} " +
                    "after ${result.iterationsUsed} iterations."
                )
            }
        } catch (e: BudgetExceededException) {
            NodeResult.Failed("Agent '${agent.name}' budget exceeded: ${e.message}")
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
