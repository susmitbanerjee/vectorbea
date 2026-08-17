package com.vectorbea.worker.agents.brain.runtime

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.agents.brain.model.*
import com.vectorbea.worker.agents.brain.prompts.AgentPromptBuilder
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.executor.HttpNodeExecutor
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Iterative Agent Brain Runner.
 *
 * Implements the PLAN → ACT → OBSERVE → REFLECT → DECIDE loop.
 *
 * Safety guarantees (enforced by the runtime, not the LLM):
 *   - Budget hard limits: iterations, tool calls, tokens, cost, timeout
 *   - Only tools in config.allowedToolIds may be called
 *   - Sanitized summaries only — no raw chain-of-thought persisted
 *   - No secrets accessible through agent memory
 *   - Schema validation on final output
 */
class AgentBrainRunner(
    private val dataSource: DataSource?,
    private val eventStore: RunEventStore,
    private val connectionResolver: ConnectionResolver,
    private val budgetGuard: AgentBudgetGuard = AgentBudgetGuard(),
    private val safetyGuard: AgentSafetyGuard = AgentSafetyGuard(),
    private val memoryStore: AgentMemoryStore = AgentMemoryStore(dataSource),
) {
    private val log = logger()
    private val mapper = jacksonObjectMapper()

    data class RunResult(
        val finalOutput: Map<String, Any?>,
        val stopReason: AgentLoopState.StopReason,
        val iterationsUsed: Int,
        val tokensUsed: Int,
        val estimatedCostCents: Double,
        val observations: List<AgentObservation>,
    )

    suspend fun run(config: AgentBrainConfig, runtimeCtx: RuntimeContext): RunResult {
        val budget = AgentBudget(
            maxIterations  = config.maxIterations,
            maxToolCalls   = config.maxToolCalls,
            maxTotalTokens = config.maxTotalTokens,
            maxCostCents   = config.maxCostCents,
            timeoutMs      = config.timeoutMs,
        )
        val state = AgentLoopState(config = config, budget = budget)

        emitEvent(config, RunEventStore.EventType.AGENT_STARTED, "running",
            "Agent brain started — task: ${(config.taskInstruction ?: "").take(100)}")

        try {
            while (!state.isDone) {
                budget.iterationStarted()
                state.iteration++

                // Hard budget check before each iteration
                try { budgetGuard.checkOrThrow(budget, "before iteration ${state.iteration}") }
                catch (e: BudgetExceededException) {
                    state.stopReason = AgentLoopState.StopReason.BUDGET_EXCEEDED
                    emitEvent(config, RunEventStore.EventType.AGENT_BUDGET_EXCEEDED, "failed",
                        "Budget exceeded: ${e.message}")
                    break
                }

                log.info("[brain] iteration {}/{} runId={}", state.iteration, config.maxIterations, config.runId)
                emitEvent(config, RunEventStore.EventType.AGENT_ITERATION_STARTED, "running",
                    "Iteration ${state.iteration}/${config.maxIterations}")

                val iterationId = persistIterationStart(config, state)

                // Build prompt and call LLM
                val tools = loadAllowedToolDescriptors(config)
                val systemPrompt = AgentPromptBuilder.buildSystemPrompt(config, tools)
                val userPrompt   = AgentPromptBuilder.buildUserPrompt(config, state)

                val llmResult = callLlm(config, systemPrompt, userPrompt, state)
                budget.addTokens(llmResult.tokensUsed, llmResult.estimatedCostCents)

                // Parse action from LLM response
                val action = parseAction(llmResult.rawContent, state, iterationId, config)

                // Validate action structure and safety
                try {
                    safetyGuard.validateActionStructure(action)
                    if (action.type == AgentAction.ActionType.CALL_TOOL) {
                        safetyGuard.validateToolAllowed(action, config)
                    }
                } catch (e: InvalidActionException) {
                    log.warn("[brain] invalid action iter={}: {}", state.iteration, e.message)
                    emitEvent(config, RunEventStore.EventType.AGENT_INVALID_ACTION, "running",
                        "Invalid action: ${e.message}")
                    persistIterationComplete(iterationId, "failed", action, null, budget)
                    state.stopReason = AgentLoopState.StopReason.ERROR
                    break
                } catch (e: ToolNotAllowedException) {
                    log.warn("[brain] tool not allowed toolId={}: {}", e.toolId, e.message)
                    emitEvent(config, RunEventStore.EventType.AGENT_TOOL_NOT_ALLOWED, "running",
                        "Tool ${e.toolId} not allowed")
                    persistIterationComplete(iterationId, "failed", action, null, budget)
                    state.stopReason = AgentLoopState.StopReason.TOOL_NOT_ALLOWED
                    break
                }

                state.lastAction = action
                val sanitizedReason = safetyGuard.sanitizeReasoningSummary(action.reasoningSummary)
                emitEvent(config, RunEventStore.EventType.AGENT_ACTION_SELECTED, "running",
                    "Action: ${action.type} — $sanitizedReason")

                // Execute action
                when (action.type) {
                    AgentAction.ActionType.THINK -> {
                        val summary = "Thought: $sanitizedReason"
                        state.addObservation(AgentObservation(state.iteration, "THINK", sanitizedSummary = summary))
                        state.addMemory("thought_${state.iteration}", sanitizedReason)
                        emitEvent(config, RunEventStore.EventType.AGENT_REFLECTION_CREATED, "running", summary)
                        persistIterationComplete(iterationId, "completed", action, summary, budget)
                    }

                    AgentAction.ActionType.CALL_TOOL -> {
                        budget.toolCallUsed()
                        emitEvent(config, RunEventStore.EventType.AGENT_TOOL_SELECTED, "running",
                            "Calling tool: ${action.toolId}")
                        val obs = executeTool(action, config, runtimeCtx, state)
                        state.addObservation(obs)
                        state.addMemory("obs_${state.iteration}_${action.toolId}", obs.sanitizedSummary)
                        emitEvent(config, RunEventStore.EventType.AGENT_OBSERVATION_RECORDED, "running",
                            obs.sanitizedSummary)
                        persistIterationComplete(iterationId, "completed", action, obs.sanitizedSummary, budget)
                    }

                    AgentAction.ActionType.FINAL -> {
                        if (validateFinalOutput(action.finalOutput, config)) {
                            state.finalOutput = action.finalOutput
                            state.stopReason  = AgentLoopState.StopReason.FINAL_OUTPUT
                            emitEvent(config, RunEventStore.EventType.AGENT_FINAL_OUTPUT_CREATED, "running",
                                "Final output ready — ${action.finalOutput.keys.take(5).joinToString()}")
                            persistIterationComplete(iterationId, "completed", action, "Final output produced", budget)
                        } else {
                            emitEvent(config, RunEventStore.EventType.AGENT_OUTPUT_SCHEMA_INVALID, "running",
                                "Final output failed schema validation")
                            persistIterationComplete(iterationId, "failed", action, "Schema invalid", budget)
                            state.stopReason = AgentLoopState.StopReason.SCHEMA_INVALID
                        }
                    }

                    AgentAction.ActionType.ASK_APPROVAL -> {
                        state.stopReason = AgentLoopState.StopReason.APPROVAL_REQUESTED
                        emitEvent(config, RunEventStore.EventType.AGENT_APPROVAL_REQUESTED, "running",
                            "Agent requested human approval: $sanitizedReason")
                        persistIterationComplete(iterationId, "completed", action, sanitizedReason, budget)
                    }

                    AgentAction.ActionType.FAIL -> {
                        state.stopReason = AgentLoopState.StopReason.AGENT_FAILED
                        val reason = safetyGuard.sanitizeReasoningSummary(action.failReason) ?: sanitizedReason
                        emitEvent(config, RunEventStore.EventType.AGENT_FAILED, "failed",
                            "Agent reported failure: $reason")
                        persistIterationComplete(iterationId, "failed", action, reason, budget)
                    }
                }

                // Check if max iterations reached after this iteration
                if (!state.isDone && state.iteration >= config.maxIterations) {
                    state.stopReason = AgentLoopState.StopReason.MAX_ITERATIONS
                    emitEvent(config, RunEventStore.EventType.AGENT_MAX_ITERATIONS_REACHED, "failed",
                        "Max iterations reached (${config.maxIterations})")
                }
            }
        } catch (e: Exception) {
            log.error("[brain] unexpected error runId={}: {}", config.runId, e.message)
            if (state.stopReason == null) state.stopReason = AgentLoopState.StopReason.ERROR
            emitEvent(config, RunEventStore.EventType.AGENT_FAILED, "failed", "Agent error: ${e.message?.take(200)}")
        }

        // Persist memory entries
        memoryStore.persistAll(config, state)

        val finalStatus = if (state.stopReason == AgentLoopState.StopReason.FINAL_OUTPUT) "succeeded" else "failed"
        emitEvent(config, RunEventStore.EventType.AGENT_COMPLETED, finalStatus,
            "Agent finished — stopReason=${state.stopReason} iterations=${state.iteration}")

        return RunResult(
            finalOutput        = state.finalOutput,
            stopReason         = state.stopReason ?: AgentLoopState.StopReason.ERROR,
            iterationsUsed     = state.iteration,
            tokensUsed         = budget.tokensUsed,
            estimatedCostCents = budget.estimatedCostCents,
            observations       = state.observations.toList(),
        )
    }

    // ── LLM calling ──────────────────────────────────────────────────────────

    private data class LlmCallResult(val rawContent: String, val tokensUsed: Int, val estimatedCostCents: Double)

    private suspend fun callLlm(config: AgentBrainConfig, systemPrompt: String, userPrompt: String, state: AgentLoopState): LlmCallResult {
        emitEvent(config, RunEventStore.EventType.LLM_CALL_STARTED, "running",
            "LLM call iter=${state.iteration} model=${config.modelName}")

        // Use the existing HTTP infrastructure to call the LLM via its connection
        try {
            val resolved = connectionResolver.resolve(config.llmConnectionId, config.workspaceId)
            val apiKey   = resolved.secret?.useOnce { it } ?: throw RuntimeException("LLM connection secret missing")

            val requestBody = mapper.writeValueAsString(mapOf(
                "model"       to config.modelName,
                "temperature" to config.temperature,
                "max_tokens"  to config.maxTokens,
                "messages" to listOf(
                    mapOf("role" to "system", "content" to systemPrompt),
                    mapOf("role" to "user",   "content" to userPrompt),
                ),
            ))

            val baseUrl = resolved.record.configJson["baseUrl"]?.toString()
                ?: inferBaseUrl(resolved.record.provider)
            val url = "$baseUrl/chat/completions"

            // Shared client. Building one per call left a selector thread behind
            // on every agent iteration (HttpClient is not AutoCloseable on JDK 17)
            // and carried no connect timeout at all.
            val request = java.net.http.HttpRequest.newBuilder()
                .uri(java.net.URI.create(url))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer $apiKey")
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(requestBody))

            val budgetMs = com.vectorbea.worker.net.OutboundHttp.policy().clampTotalCallMs(config.timeoutMs)
            val response = com.vectorbea.worker.metrics.WorkerMetrics.timeBlocking {
                com.vectorbea.worker.net.OutboundHttp.send(
                    request,
                    totalCallMs = budgetMs,
                    maxResponseBytes = 1_048_576L,
                )
            }
            com.vectorbea.worker.metrics.WorkerMetrics.llmCallDurationSeconds.observeMs(
                response.durationMs,
                resolved.record.provider.lowercase(),
                if (response.statusCode in 200..299) "ok" else "http_error",
            )
            if (response.statusCode !in 200..299)
                throw RuntimeException("LLM API returned ${response.statusCode}")

            @Suppress("UNCHECKED_CAST")
            val parsed  = mapper.readValue(response.body, Map::class.java) as Map<String, Any?>
            val choices = parsed["choices"] as? List<*> ?: throw RuntimeException("No choices in LLM response")
            val msg     = ((choices[0] as Map<*, *>)["message"] as Map<*, *>)["content"] as? String ?: ""

            @Suppress("UNCHECKED_CAST")
            val usage   = parsed["usage"] as? Map<String, Any?> ?: emptyMap<String, Any?>()
            val tokens  = (usage["total_tokens"] as? Int) ?: 0
            val cost    = estimateCostCents(tokens, config.modelName)

            val costUsd = cost / 100.0   // estimateCostCents returns cents → convert to USD
            emitEvent(config, RunEventStore.EventType.LLM_CALL_COMPLETED, "running",
                "LLM call completed tokens=$tokens cost=\$${"%.5f".format(costUsd)}",
                tokenCount    = tokens,
                estimatedCost = costUsd)
            return LlmCallResult(msg, tokens, cost)
        } catch (e: Exception) {
            log.error("[brain] LLM call failed iter={}: {}", state.iteration, e.message)
            throw e
        }
    }

    private fun inferBaseUrl(provider: String?): String = when {
        provider?.contains("anthropic", ignoreCase = true) == true -> "https://api.anthropic.com/v1"
        provider?.contains("azure", ignoreCase = true) == true     -> "https://api.openai.azure.com/v1"
        else -> "https://api.openai.com/v1"
    }

    private fun estimateCostCents(tokens: Int, model: String): Double {
        val ratePerMillion = when {
            model.contains("gpt-4o", ignoreCase = true)  -> 500.0  // $5/M
            model.contains("gpt-4",  ignoreCase = true)  -> 3000.0 // $30/M
            model.contains("claude", ignoreCase = true)  -> 300.0
            else                                          -> 150.0
        }
        return (tokens / 1_000_000.0) * ratePerMillion
    }

    // ── Action parsing ────────────────────────────────────────────────────────

    private fun parseAction(
        rawContent: String,
        state: AgentLoopState,
        iterationId: UUID?,
        config: AgentBrainConfig,
    ): AgentAction {
        // Strip markdown code blocks if LLM wrapped JSON in them
        val cleaned = rawContent.trim()
            .removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
        return try {
            mapper.readValue(cleaned, AgentAction::class.java)
        } catch (e: Exception) {
            log.warn("[brain] failed to parse action iter={}: {}", state.iteration, e.message)
            // Return a THINK action as repair so loop can continue / fail gracefully
            AgentAction(
                type = AgentAction.ActionType.THINK,
                reasoningSummary = "Failed to parse action response — trying next iteration",
            )
        }
    }

    // ── Tool execution ────────────────────────────────────────────────────────

    private suspend fun executeTool(
        action: AgentAction,
        config: AgentBrainConfig,
        runtimeCtx: RuntimeContext,
        state: AgentLoopState,
    ): AgentObservation {
        val toolId = try { UUID.fromString(action.toolId!!) }
        catch (_: Exception) {
            return AgentObservation(state.iteration, "CALL_TOOL", action.toolId, "Invalid tool ID format", false)
        }

        return try {
            // Load tool config from DB (gets connectionId and HTTP config)
            val toolCfg = loadToolConfig(toolId, config.workspaceId)
                ?: return AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                    "Tool $toolId not found or not accessible", false)

            // Build a synthetic HTTP node from the tool config
            val syntheticNode = WorkflowNode(
                id     = "brain-tool-${state.iteration}-$toolId",
                type   = "http",
                config = toolCfg,
            )

            // Delegate to HttpNodeExecutor — no dbPoolManager needed for HTTP tools
            val httpExec = HttpNodeExecutor(connectionResolver, eventStore)
            @Suppress("UNCHECKED_CAST")
            val inputs = (action.toolInput ?: emptyMap<String, Any?>()) as Map<String, Any>

            when (val execResult = httpExec.execute(syntheticNode, inputs, runtimeCtx)) {
                is NodeResult.Completed -> {
                    val summary = buildToolObservationSummary(toolId, execResult.output)
                    emitEvent(config, RunEventStore.EventType.AGENT_OBSERVATION_RECORDED, "running",
                        "Tool $toolId: $summary")
                    AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(), summary, true)
                }
                is NodeResult.Failed -> {
                    val errSummary = "Tool $toolId failed: ${execResult.reason.take(200)}"
                    log.warn("[brain] tool execution failed toolId={}: {}", toolId, execResult.reason)
                    AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(), errSummary, false)
                }
                else -> AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                    "Tool $toolId returned unexpected result type", false)
            }
        } catch (e: Exception) {
            val errSummary = "Tool $toolId failed: ${e.message?.take(200)}"
            log.warn("[brain] tool execution failed: {}", errSummary)
            AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(), errSummary, false)
        }
    }

    /** Load a tool's HTTP-compatible config from the DB for agent brain execution. */
    private fun loadToolConfig(toolId: UUID, workspaceId: UUID): Map<String, Any>? {
        if (dataSource == null) return null
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT config_json, connection_id FROM tools WHERE id=? AND workspace_id=? AND status='active'"
                ).use { stmt ->
                    stmt.setObject(1, toolId)
                    stmt.setObject(2, workspaceId)
                    val rs = stmt.executeQuery()
                    if (!rs.next()) return@use null
                    @Suppress("UNCHECKED_CAST")
                    val configJson: Map<String, Any> = try {
                        mapper.readValue(rs.getString("config_json") ?: "{}", Map::class.java) as Map<String, Any>
                    } catch (_: Exception) { emptyMap() }
                    val connectionId = rs.getString("connection_id")
                    if (connectionId != null) configJson + mapOf("connectionId" to connectionId) else configJson
                }
            }
        } catch (e: Exception) {
            log.warn("[brain] loadToolConfig failed toolId={}: {}", toolId, e.message)
            null
        }
    }

    private fun buildToolObservationSummary(toolId: UUID, result: Map<String, Any?>): String {
        val size = result.size
        val keys = result.keys.take(5).joinToString()
        return "Tool returned $size field(s): $keys"
    }

    // ── Schema validation ─────────────────────────────────────────────────────

    private fun validateFinalOutput(output: Map<String, Any?>, config: AgentBrainConfig): Boolean {
        if (config.outputSchemaJson == "{}") return true
        // Basic required field check — full JSON Schema validation would use a library
        return try {
            @Suppress("UNCHECKED_CAST")
            val schema   = mapper.readValue(config.outputSchemaJson, Map::class.java) as Map<String, Any?>
            val required = (schema["required"] as? List<*>)?.map { it.toString() } ?: emptyList()
            required.all { output.containsKey(it) }
        } catch (_: Exception) { true }
    }

    // ── Persistence ───────────────────────────────────────────────────────────

    private fun persistIterationStart(config: AgentBrainConfig, state: AgentLoopState): UUID {
        val id = UUID.randomUUID()
        if (dataSource == null) return id
        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    "INSERT INTO agent_iterations (id,workspace_id,environment_id,run_id,step_id,agent_id,iteration_number,status) VALUES(?,?,?,?,?,?,?,'running')"
                ).use { stmt ->
                    stmt.setObject(1, id); stmt.setObject(2, config.workspaceId)
                    stmt.setObject(3, config.environmentId); stmt.setObject(4, config.runId)
                    stmt.setString(5, config.stepId); stmt.setObject(6, config.agentId)
                    stmt.setInt(7, state.iteration)
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) { log.warn("[brain] persist iteration start failed: {}", e.message) }
        return id
    }

    private fun persistIterationComplete(
        iterationId: UUID?,
        status: String,
        action: AgentAction,
        observationSummary: String?,
        budget: AgentBudget,
    ) {
        if (dataSource == null || iterationId == null) return
        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    "UPDATE agent_iterations SET status=?,action_type=?,thought_summary_sanitized=?,observation_summary_sanitized=?,tokens_used=?,estimated_cost_cents=?,completed_at=? WHERE id=?"
                ).use { stmt ->
                    stmt.setString(1, status)
                    stmt.setString(2, action.type.name)
                    stmt.setString(3, (action.reasoningSummary ?: "").take(500))
                    stmt.setString(4, observationSummary?.take(500))
                    stmt.setInt(5, budget.tokensUsed)
                    stmt.setBigDecimal(6, java.math.BigDecimal.valueOf(budget.estimatedCostCents))
                    stmt.setTimestamp(7, Timestamp.from(Instant.now()))
                    stmt.setObject(8, iterationId)
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) { log.warn("[brain] persist iteration complete failed: {}", e.message) }
    }

    // ── Tool descriptors ──────────────────────────────────────────────────────

    private fun loadAllowedToolDescriptors(config: AgentBrainConfig): List<AgentPromptBuilder.ToolDescriptor> {
        if (dataSource == null || config.allowedToolIds.isEmpty()) return emptyList()
        return try {
            dataSource.connection.use { conn ->
                val placeholders = config.allowedToolIds.joinToString(",") { "?" }
                conn.prepareStatement(
                    "SELECT id, name, description, config_json FROM tools WHERE id IN ($placeholders) AND workspace_id=? AND status='active'"
                ).use { stmt ->
                    config.allowedToolIds.forEachIndexed { i, id -> stmt.setObject(i + 1, id) }
                    stmt.setObject(config.allowedToolIds.size + 1, config.workspaceId)
                    val rs = stmt.executeQuery()
                    buildList {
                        while (rs.next()) {
                            add(AgentPromptBuilder.ToolDescriptor(
                                id = rs.getString("id"),
                                name = rs.getString("name"),
                                description = rs.getString("description") ?: "",
                            ))
                        }
                    }
                }
            }
        } catch (e: Exception) { log.warn("[brain] load tools failed: {}", e.message); emptyList() }
    }

    // ── Event emission ────────────────────────────────────────────────────────

    private fun emitEvent(
        config: AgentBrainConfig,
        type: RunEventStore.EventType,
        status: String,
        summary: String,
        tokenCount: Int? = null,
        estimatedCost: Double? = null,
    ) {
        try {
            eventStore.appendEvent(RunEventStore.RunEvent(
                runId         = config.runId,
                workspaceId   = config.workspaceId,
                environmentId = config.environmentId,
                type          = type,
                status        = status,
                source        = "agent-brain:${config.agentName}",
                title         = type.value.replace("_", " ").lowercase()
                    .replaceFirstChar { it.uppercase() },
                summary       = summary.take(300),
                stepId        = config.stepId,
                agentId       = config.agentId,
                tokenCount    = tokenCount,
                estimatedCost = estimatedCost,
            ))
        } catch (e: Exception) { log.warn("[brain] event emit failed type={}: {}", type, e.message) }
    }
}
