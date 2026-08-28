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

    internal companion object {
        /** The `:tool-<n>` attempt counter in a synthetic tool node's id. */
        private val ATTEMPT_SUFFIX = Regex(":tool-\\d+")

        /**
         * A tool failure with the attempt number taken out, so two identical failures
         * compare equal.
         *
         * The synthetic node handed to the tool executor is named
         * `<stepId>:tool-<iteration>`, and the executors put that id into their error
         * text: `DB_WRITE node 'n-new-agent-2:tool-3': ...`. So the same failure reads
         * differently every iteration purely because of the counter, and a naive
         * equality check on the summary never fires - which is exactly how the first
         * version of this stop condition failed to stop anything.
         *
         * The counter is the ONLY part normalised. Anything else that differs between
         * two attempts - a different column, a different value, a different SQLSTATE -
         * is a real difference and must keep the loop going.
         *
         * On the companion because it depends on no instance state, which also means a
         * test can exercise it without standing up a runner and its collaborators.
         */
        internal fun failureSignature(summary: String): String =
            summary.replace(ATTEMPT_SUFFIX, ":tool-N")
    }

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
         * Tool calls that failed, even when the agent went on to declare success.
         *
         * An agent can observe a tool failure and still return FINAL - the model
         * decides it has enough to answer. The runtime then reported a clean
         * `succeeded` run, which is how a workflow whose entire purpose was a database
         * write finished green with nothing written, three separate times, each time
         * with the real cause buried in one observation event mid-timeline.
         *
         * Kept so the step can carry it into its output and the run can say so. The
         * status is deliberately NOT changed here: an agent that tried a tool, found it
         * unavailable and produced a considered fallback is a legitimate success, and
         * that judgement belongs to whoever designed the workflow. What is not
         * legitimate is saying nothing.
         */
        val failedToolCalls: List<String> = emptyList(),

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
                    failureReason = "The agent produced an action the runtime could not execute: ${e.message}"
                    break
                } catch (e: ToolNotAllowedException) {
                    log.warn("[brain] tool not allowed toolId={}: {}", e.toolId, e.message)
                    emitEvent(config, RunEventStore.EventType.AGENT_TOOL_NOT_ALLOWED, "running",
                        "Tool ${e.toolId} not allowed")
                    persistIterationComplete(iterationId, "failed", action, null, budget)
                    state.stopReason = AgentLoopState.StopReason.TOOL_NOT_ALLOWED
                    failureReason = "The agent tried to call tool ${e.toolId}, which is not in its allowed tool list."
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

                        /* The observation BEFORE this call, so a repeat can be spotted. */
                        val previous = state.observations.lastOrNull()

                        val obs = executeTool(action, config, runtimeCtx, state)
                        state.addObservation(obs)
                        state.addMemory("obs_${state.iteration}_${action.toolId}", obs.sanitizedSummary)
                        emitEvent(config, RunEventStore.EventType.AGENT_OBSERVATION_RECORDED, "running",
                            obs.sanitizedSummary)
                        persistIterationComplete(iterationId, "completed", action, obs.sanitizedSummary, budget)

                        /*
                         * STOP WHEN THE SAME CALL FAILS THE SAME WAY TWICE.
                         *
                         * A tool that fails deterministically - bad SQL, a missing
                         * column, a revoked credential - fails identically however many
                         * times it is asked. The loop had no notion of that: it fed the
                         * failure back as an observation and let the model try again
                         * until max iterations, which for one reported run meant ten
                         * iterations, ten LLM calls and ten identical errors before the
                         * step gave up. Every one of those was paid for.
                         *
                         * Identical means SAME TOOL and SAME MESSAGE. If the model
                         * changes its arguments and draws a different error it is
                         * learning something, and it keeps its remaining iterations;
                         * repeating itself verbatim is the case that cannot improve.
                         *
                         * The failure carries the tool's own message, so the run says
                         * what was wrong with the call rather than that the agent
                         * ran out of turns.
                         */
                        if (!obs.success && previous != null && !previous.success &&
                            previous.actionType == "CALL_TOOL" &&
                            previous.toolId == obs.toolId &&
                            failureSignature(previous.sanitizedSummary) == failureSignature(obs.sanitizedSummary)
                        ) {
                            state.stopReason = AgentLoopState.StopReason.ERROR
                            failureReason = "Tool ${obs.toolId} failed twice with the same error, so the " +
                                "agent stopped rather than retrying it further: ${obs.sanitizedSummary}"
                            emitEvent(config, RunEventStore.EventType.AGENT_FAILED, "failed",
                                "Stopped after an identical repeated tool failure: ${obs.sanitizedSummary}")
                        }
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
                            failureReason = "The agent's final output did not match the required output " +
                                "schema. It returned: ${action.finalOutput.keys.take(8).joinToString().ifBlank { "no fields" }}"
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
                        /* `sanitizeReasoningSummary` returns "" for a null or blank input, never
                           null, so the elvis that used to stand here could not fire: an agent that
                           chose FAIL without filling in `failReason` produced an empty reason, and
                           the empty reason then travelled all the way to the run detail screen.
                           Fall back through the fields the model actually filled in. */
                        val reason = safetyGuard.sanitizeReasoningSummary(action.failReason)
                            .ifBlank { sanitizedReason }
                        /* THE AGENT SAID WHY. RECORD IT.
                           This is the one stop reason where the cause is stated outright, and it
                           was the one that lost it: `failureReason` stayed null, so RunResult fell
                           through to its observation fallback, found nothing failed (the agent had
                           only THOUGHT before giving up), and AgentNodeExecutor reported
                           "did not produce a final output (stopReason=AGENT_FAILED)" — the model's
                           own explanation discarded one frame above the screen that needed it. */
                        failureReason = if (reason.isNotBlank())
                            "The agent stopped and reported: $reason"
                        else null
                        emitEvent(config, RunEventStore.EventType.AGENT_FAILED, "failed",
                            "Agent reported failure: ${reason.ifBlank { "no reason given" }}")
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

        val failedToolCalls = state.observations
            .filter { it.actionType == "CALL_TOOL" && !it.success }
            .map { it.sanitizedSummary }

        val finalStatus = if (state.stopReason == AgentLoopState.StopReason.FINAL_OUTPUT) "succeeded" else "failed"

        /* A "succeeded" that had failed tool calls is the case that has repeatedly
           looked clean while nothing happened. Say it on the event the timeline leads
           with, rather than leaving it to one observation further up. */
        val toolNote = if (failedToolCalls.isNotEmpty())
            " — ${failedToolCalls.size} tool call(s) FAILED: ${failedToolCalls.last().take(160)}"
        else ""

        emitEvent(config, RunEventStore.EventType.AGENT_COMPLETED,
            if (finalStatus == "succeeded" && failedToolCalls.isNotEmpty()) "warning" else finalStatus,
            "Agent finished — stopReason=${state.stopReason} iterations=${state.iteration}$toolNote")

        return RunResult(
            finalOutput        = state.finalOutput,
            stopReason         = state.stopReason ?: AgentLoopState.StopReason.ERROR,
            iterationsUsed     = state.iteration,
            tokensUsed         = budget.tokensUsed,
            estimatedCostCents = budget.estimatedCostCents,
            observations       = state.observations.toList(),
            failedToolCalls    = failedToolCalls,
            /* No explicit reason recorded? The last unsuccessful observation is the
               next best evidence — for a loop that ran out of iterations while a
               tool kept failing, it is the actual answer. Failing that, name the stop
               reason in words: every path out of this loop that is not FINAL_OUTPUT
               now carries SOMETHING a person can read, because the alternative is the
               caller printing "did not produce a final output" and the run detail
               screen leading with a sentence that identifies nothing. */
            failureReason      = if (state.stopReason == AgentLoopState.StopReason.FINAL_OUTPUT) null
                                 else failureReason
                                     ?: state.observations.lastOrNull { !it.success }?.sanitizedSummary
                                     ?: describeStop(state.stopReason, config),
        )
    }

    /**
     * A readable sentence for a stop reason, used only when nothing more specific was
     * recorded. A stop reason is a category — "AGENT_FAILED", "MAX_ITERATIONS" — and a
     * category shown on its own tells whoever opened the run nothing about their run.
     */
    private fun describeStop(reason: AgentLoopState.StopReason?, config: AgentBrainConfig): String = when (reason) {
        AgentLoopState.StopReason.MAX_ITERATIONS ->
            "The agent used all ${config.maxIterations} of its iterations without producing a final output. " +
            "Raise the iteration limit or narrow the task."
        AgentLoopState.StopReason.BUDGET_EXCEEDED ->
            "The agent ran out of its token, cost or tool-call budget before finishing."
        AgentLoopState.StopReason.AGENT_FAILED ->
            "The agent reported it could not complete the task but gave no reason."
        AgentLoopState.StopReason.APPROVAL_REQUESTED ->
            "The agent asked for human approval before it could continue."
        AgentLoopState.StopReason.TOOL_NOT_ALLOWED ->
            "The agent tried to call a tool that is not in its allowed tool list."
        AgentLoopState.StopReason.SCHEMA_INVALID ->
            "The agent's final output did not match the required output schema."
        AgentLoopState.StopReason.ERROR, null ->
            "The agent stopped with an error that was not recorded."
        AgentLoopState.StopReason.FINAL_OUTPUT -> ""
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
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO agent_iterations
                       (id,workspace_id,environment_id,run_id,step_id,agent_id,iteration_number,status)
                       VALUES(?,?,?,?,?,?,?,'running')
                       ON CONFLICT (run_id,step_id,iteration_number) DO UPDATE SET
                         status='running',
                         action_type=NULL,
                         thought_summary_sanitized=NULL,
                         observation_summary_sanitized=NULL,
                         tokens_used=0,
                         estimated_cost_cents=0,
                         started_at=now(),
                         completed_at=NULL
                       RETURNING id"""
                ).use { stmt ->
                    stmt.setObject(1, id); stmt.setObject(2, config.workspaceId)
                    stmt.setObject(3, config.environmentId); stmt.setObject(4, config.runId)
                    stmt.setString(5, config.stepId); stmt.setObject(6, config.agentId)
                    stmt.setInt(7, state.iteration)
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) rs.getObject("id", UUID::class.java) else id
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[brain] persist iteration start failed: {}", e.message)
            id
        }
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
                    "SELECT id, name, description, input_schema_json FROM tools WHERE id IN ($placeholders) AND workspace_id=? AND status='active'"
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
                                /* THE ARGUMENT NAMES. `ToolDescriptor` has carried an
                                   `inputSchema` field since it was written and the
                                   system prompt has always rendered it, but this query
                                   never selected the column - it selected `config_json`
                                   and then ignored that too - so every tool reached the
                                   model as a name and a sentence with no parameters.
                                   The model was being asked to call a tool and left to
                                   guess what to pass it, which is how a tool call comes
                                   back with the right intent and the wrong keys. */
                                inputSchema = parseJsonObject(rs.getString("input_schema_json")),
                            ))
                        }
                    }
                }
            }
        } catch (e: Exception) { log.warn("[brain] load tools failed: {}", e.message); emptyList() }
    }

    /** A jsonb column as a map. Empty when absent or not an object. */
    @Suppress("UNCHECKED_CAST")
    private fun parseJsonObject(raw: String?): Map<String, Any?> =
        if (raw.isNullOrBlank()) emptyMap()
        else runCatching { mapper.readValue(raw, Map::class.java) as Map<String, Any?> }
            .getOrDefault(emptyMap())

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
