package com.vectorbea.worker.agents.brain.runtime

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.agents.brain.model.*
import com.vectorbea.worker.agents.brain.prompts.AgentPromptBuilder
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.executor.LlmNodeExecutor
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.executor.ToolNodeExecutor
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
    /**
     * Pool manager for TENANT databases, needed because an agent may call a
     * database tool. Null only in tests that exercise no such tool; a null here
     * means database tools report "not available" rather than being silently
     * mis-executed as HTTP.
     */
    private val dbPoolManager: ClientDbPoolManager? = null,
    private val budgetGuard: AgentBudgetGuard = AgentBudgetGuard(),
    private val safetyGuard: AgentSafetyGuard = AgentSafetyGuard(),
    private val memoryStore: AgentMemoryStore = AgentMemoryStore(dataSource),
) {
    private val log = logger()
    private val mapper = jacksonObjectMapper()

    /**
     * The SAME executor a `tool` node uses, so an agent calling a tool and a
     * workflow calling that tool do the same thing.
     *
     * This used to be a bare [com.vectorbea.worker.runtime.executor.HttpNodeExecutor],
     * which meant every agent tool call was executed as an HTTP request no matter
     * what the tool actually was. A Postgres tool resolved its `database`
     * connection against an executor demanding `http` and came back
     * "Connection 'X' has type 'database', expected 'http'" — recorded as one
     * failed observation inside the loop, after which the agent carried on and
     * the run still finished `succeeded`. Nothing was written and nothing said so.
     *
     * [ToolNodeExecutor] dispatches on the tool's own `type` (http / database /
     * builtin_email / SaaS aliases), applies its `requires_approval` flag, and
     * resolves `sqlTemplate` placeholders — none of which the HTTP path could do.
     */
    private val toolExecutor: ToolNodeExecutor? by lazy {
        val ds = dataSource ?: return@lazy null
        val pools = dbPoolManager ?: return@lazy null
        ToolNodeExecutor(ds, connectionResolver, pools, eventStore)
    }

    /**
     * The SAME executor an `llm` node uses.
     *
     * The loop previously built its own OpenAI request by hand, which broke in two
     * ways. It appended `/chat/completions` to the connection's `baseUrl`, while
     * every other caller in the platform (`LlmNodeExecutor`, `LlmTester`,
     * `lib/server/execution.ts`) appends `/v1/chat/completions` — so a connection
     * whose `baseUrl` is `https://api.openai.com`, which is the form those callers
     * store, produced `https://api.openai.com/chat/completions` and a 404. And it
     * spoke OpenAI's dialect to every provider, so an Anthropic connection got an
     * OpenAI body and an `Authorization: Bearer` header posted to a path Anthropic
     * does not serve — another 404.
     *
     * Delegating fixes both and inherits the provider throttle, the connection
     * circuit breaker, replay recording and the cost/token metrics for free.
     */
    private val llmExecutor by lazy { LlmNodeExecutor(connectionResolver, eventStore) }

    data class RunResult(
        val finalOutput: Map<String, Any?>,
        val stopReason: AgentLoopState.StopReason,
        val iterationsUsed: Int,
        val tokensUsed: Int,
        val estimatedCostCents: Double,
        val observations: List<AgentObservation>,
        /**
         * WHAT actually went wrong, when something did.
         *
         * The stop reason alone is a category, not a diagnosis. A run that died
         * because the LLM connection was refused recorded
         * `error_json: {"message": "Agent 'X' stopped with reason: ERROR after 1
         * iterations."}` — which is what the run detail screen shows for a failed
         * run, and it names nothing. The real cause ("HTTP request failed:
         * ConnectException") was written to an AGENT_FAILED event and went no
         * further, so the summary the screen leads with was the one place the
         * answer was missing.
         *
         * Null when the loop ended cleanly.
         */
        val failureReason: String? = null,
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

        /* Carries the cause out of the loop and into RunResult. See RunResult.failureReason. */
        var failureReason: String? = null

        try {
            while (!state.isDone) {
                budget.iterationStarted()
                state.iteration++

                // Hard budget check before each iteration
                try { budgetGuard.checkOrThrow(budget, "before iteration ${state.iteration}") }
                catch (e: BudgetExceededException) {
                    state.stopReason = AgentLoopState.StopReason.BUDGET_EXCEEDED
                    failureReason = "Budget exceeded: ${e.message}"
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

                val llmResult = callLlm(config, systemPrompt, userPrompt, runtimeCtx)
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
            failureReason = e.message?.take(300) ?: e.javaClass.simpleName
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
            /* No explicit reason recorded? The last unsuccessful observation is the
               next best evidence — for a loop that ran out of iterations while a
               tool kept failing, it is the actual answer. */
            failureReason      = failureReason
                ?: state.observations.lastOrNull { !it.success }?.sanitizedSummary,
        )
    }

    // ── LLM calling ──────────────────────────────────────────────────────────

    private data class LlmCallResult(val rawContent: String, val tokensUsed: Int, val estimatedCostCents: Double)

    private suspend fun callLlm(
        config: AgentBrainConfig,
        systemPrompt: String,
        userPrompt: String,
        runtimeCtx: RuntimeContext,
    ): LlmCallResult {
        /* The synthetic node carries the AGENT's step id, not a made-up one, so the
           LLM_CALL_* events the executor emits attach to the step the timeline
           already shows rather than to a node nobody can find. */
        val node = WorkflowNode(
            id   = config.stepId,
            type = "llm",
            config = buildMap {
                put("connectionId", config.llmConnectionId.toString())
                put("model",        config.modelName)
                put("temperature",  config.temperature)
                put("maxTokens",    config.maxTokens)
                put("timeoutMs",    config.timeoutMs)
                put("messages", listOf(
                    mapOf("role" to "system", "content" to systemPrompt),
                    mapOf("role" to "user",   "content" to userPrompt),
                ))
            },
        )

        return when (val result = llmExecutor.execute(node, emptyMap(), runtimeCtx)) {
            is NodeResult.Completed -> {
                val content = result.output["content"] as? String ?: ""
                val tokens  = (result.output["tokenCount"] as? Number)?.toInt() ?: 0
                LlmCallResult(content, tokens, estimateCostCents(tokens, config.modelName))
            }

            /* A 429 is not a failure of the task, and it is not something the loop
               can reason its way past. Surfacing the provider's own message keeps
               "we were rate limited" distinguishable from "the agent could not do
               it", which the previous generic RuntimeException("returned 429")
               did not. */
            is NodeResult.Throttled ->
                throw LlmCallException("${result.provider} rate limited this call. ${result.message}")

            is NodeResult.Failed ->
                throw LlmCallException(result.reason)

            else ->
                throw LlmCallException("LLM call returned an unexpected result: ${result::class.simpleName}")
        }
    }

    /** Raised when the LLM leg of an iteration cannot produce content. */
    class LlmCallException(message: String) : RuntimeException(message)

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

        val executor = toolExecutor
            ?: return AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                "Tool execution is not available on this worker", false)

        return try {
            /* A `tool` node, not an `http` one. ToolNodeExecutor owns the lookup,
               the type dispatch and the config remapping, so the agent path and the
               workflow path cannot disagree about what calling a tool means. */
            val syntheticNode = WorkflowNode(
                id     = "${config.stepId}:tool-${state.iteration}",
                type   = "tool",
                config = mapOf("toolId" to toolId.toString()),
            )

            @Suppress("UNCHECKED_CAST")
            val inputs = (action.toolInput ?: emptyMap<String, Any?>())
                .filterValues { it != null } as Map<String, Any>

            when (val execResult = executor.execute(syntheticNode, inputs, runtimeCtx)) {
                is NodeResult.Completed -> {
                    val summary = buildToolObservationSummary(toolId, execResult.output)
                    AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(), summary, true)
                }

                is NodeResult.Failed -> {
                    val errSummary = "Tool $toolId failed: ${execResult.reason.take(200)}"
                    log.warn("[brain] tool execution failed toolId={}: {}", toolId, execResult.reason)
                    AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(), errSummary, false)
                }

                /* A tool that needs a human is not a tool the agent may retry its
                   way around, and it is not an error either. Reporting it as an
                   unsuccessful observation stops the loop from looping on it while
                   leaving the pending approval to be resolved out of band. */
                is NodeResult.ApprovalPaused ->
                    AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                        "Tool $toolId requires human approval before it can run", false)

                is NodeResult.Throttled ->
                    AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                        "Tool $toolId was rate limited by ${execResult.provider}", false)

                is NodeResult.Unsupported ->
                    AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                        "Tool $toolId has a type this worker cannot execute", false)
            }
        } catch (e: Exception) {
            val errSummary = "Tool $toolId failed: ${e.message?.take(200)}"
            log.warn("[brain] tool execution failed: {}", errSummary)
            AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(), errSummary, false)
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
