package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
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

        val agentStatus = if (result is NodeResult.Completed) "success" else "failed"
        emitEvent(ctx, node.id, EventType.AGENT_COMPLETED, agentStatus,
            title = "Agent ${if (result is NodeResult.Completed) "completed" else "failed"}: ${agent.name}")

        return result
    }

    // ── Agent row ─────────────────────────────────────────────────────────────

    private data class AgentRow(
        val id: String,
        val name: String,
        val instructions: String?,
        val llmConnectionId: String?,
        val modelName: String?,
        val temperature: Double?,
        val maxTokens: Int?,
    )

    private fun loadAgent(agentId: UUID, workspaceId: UUID): AgentRow? = try {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT id, name, instructions, llm_connection_id,
                   model_name, temperature, max_tokens
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
                        instructions    = rs.getString("instructions"),
                        llmConnectionId = rs.getString("llm_connection_id"),
                        modelName       = rs.getString("model_name"),
                        temperature     = rs.getObject("temperature")?.let {
                            (it as? Number)?.toDouble()
                        },
                        maxTokens       = rs.getObject("max_tokens")?.let {
                            (it as? Number)?.toInt()
                        },
                    )
                }
            }
        }
    } catch (e: Exception) {
        log.warn("[agent-executor] failed to load agent [agentId={}, workspaceId={}]: {}",
            agentId, workspaceId, e.javaClass.simpleName)
        null
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
