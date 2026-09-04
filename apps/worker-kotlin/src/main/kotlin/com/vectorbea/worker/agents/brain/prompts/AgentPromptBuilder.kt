package com.vectorbea.worker.agents.brain.prompts

import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import com.vectorbea.worker.agents.brain.model.AgentLoopState
import com.vectorbea.worker.agents.context.ContextAssembler
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper

/**
 * Builds system and user prompts for the agent brain loop.
 *
 * The LLM is instructed to return ONLY structured JSON.
 * It selects actions — it never executes tools directly.
 * Hidden chain-of-thought is explicitly forbidden.
 */
object AgentPromptBuilder {
    private val mapper = jacksonObjectMapper()

    /**
     * Assemble the user prompt through [ContextAssembler] instead of concatenating
     * it. Default OFF.
     *
     * Off, [buildUserPrompt] produces the bytes it has always produced. On, the
     * SAME sections are emitted in the same order, but under a hard budget with
     * every drop named in the trace. The flag exists because the difference only
     * shows up on a prompt that is too big — which is exactly the case nobody has
     * a regression test for, and exactly the case where being wrong is expensive.
     */
    val CONTEXT_ASSEMBLY_ENABLED: Boolean =
        System.getenv("AGENT_CONTEXT_ASSEMBLY_ENABLED")?.lowercase() == "true"

    /**
     * The assembled context's character budget.
     *
     * Characters, not tokens, deliberately. A token count needs the provider's
     * tokenizer, which differs per model and is not available here without a
     * network call or a vendored table — and a budget that is approximately right
     * and always computable beats one that is exact and sometimes unavailable.
     * Four characters per token is the usual rough ratio, so 48k characters is
     * roughly 12k tokens of context.
     */
    val CONTEXT_CHAR_BUDGET: Int =
        System.getenv("AGENT_CONTEXT_CHAR_BUDGET")?.toIntOrNull()?.coerceAtLeast(1_000) ?: 48_000

    fun buildSystemPrompt(
        config: AgentBrainConfig,
        availableTools: List<ToolDescriptor>,
        /**
         * The team roster, when delegation is on for this run.
         *
         * Stated exactly the way the tool list is stated, and enforced exactly the
         * way the tool grant is enforced — in runtime code, in
         * `AgentSafetyGuard.validateAgentAllowed` and again at the
         * `AgentCallExecutor` boundary. THE PROMPT IS NOT THE ENFORCEMENT. A model
         * that names an agent outside this list is stopped by the runtime, not
         * by having been told not to.
         *
         * Empty means the two delegation actions are not offered at all, which is
         * both the flag-off case and the no-roster case: an agent shown actions it
         * cannot use spends iterations discovering that.
         */
        roster: List<AgentDescriptor> = emptyList(),
    ): String {
        /*
         * ── WHAT THE MODEL IS TOLD ABOUT EACH TOOL ──────────────────────────
         *
         * A name, a sentence and an input schema tell it HOW to call a tool and
         * nothing about WHEN, or about what it will get back. So it picks by name,
         * calls to find out, reads forty opaque fields, and spends another
         * iteration working out which one it wanted. Two additions, both from the
         * tool's own result contract, both cheap because they are sent once here
         * rather than repeated in every observation:
         *
         *   `whenToUse` — the tool author's answer to "why this tool and not that
         *                 one". Tool-selection quality is bounded by what the
         *                 description says, and an endpoint path says nothing.
         *   `returns`   — the projected fields and what each means, so the model
         *                 knows the shape of the answer before it asks.
         *
         * Omitted entirely when absent rather than emitted as null: a key with no
         * value costs tokens on every iteration and teaches nothing.
         */
        val toolsJson = mapper.writerWithDefaultPrettyPrinter()
            .writeValueAsString(availableTools.map { t ->
                buildMap {
                    put("id", t.id)
                    put("name", t.name)
                    put("description", t.description)
                    t.usage?.let { put("whenToUse", it) }
                    t.resultLegend?.let { put("returns", it) }
                    put("inputSchema", t.inputSchema)
                }
            })
        val rosterJson = mapper.writerWithDefaultPrettyPrinter()
            .writeValueAsString(roster.map { mapOf("id" to it.id, "name" to it.name, "description" to it.description) })
        val outputSchemaSection = if (config.outputSchemaJson != "{}") "\n\nFINAL OUTPUT SCHEMA (your finalOutput MUST match this JSON Schema):\n${config.outputSchemaJson}" else ""

        /* Together or not at all: an agent offered DELEGATE with an empty roster
           spends an iteration discovering it has nobody to delegate to. */
        val delegationActions = if (roster.isEmpty()) "" else """
- DELEGATE: Hand a subtask to an agent on your team roster and wait for its result.
- HANDOFF: Transfer the whole task to an agent on your team roster. You will not run again."""
        val rosterSection = if (roster.isEmpty()) "" else
            "\n\nYOUR TEAM ROSTER (the ONLY agents you may DELEGATE or HANDOFF to):\n$rosterJson"

        return """You are ${config.agentName}. ${config.role ?: ""}

INSTRUCTIONS:
${config.instructions}

YOUR TASK will be given in each user message.

You MUST respond with a single JSON object representing your next action. No prose, no explanation outside JSON.

ALLOWED ACTIONS:
- THINK: Internal reasoning step. No external call. Use to update your understanding.
- CALL_TOOL: Call one of the allowed tools below.
- FINAL: You have enough information to produce the final answer. Stop here.
- ASK_APPROVAL: You need human approval before proceeding.
- FAIL: You cannot complete the task. Explain why in failReason.$delegationActions

ALLOWED TOOLS:
$toolsJson$rosterSection

ACTION JSON FORMAT:
{
  "type": "CALL_TOOL" | "THINK" | "FINAL" | "ASK_APPROVAL" | "FAIL",
  "reasoningSummary": "ONE SENTENCE explaining why you chose this action.",
  "toolId": "<tool UUID from allowed tools list, only for CALL_TOOL>",
  "toolInput": { ... },
  "finalOutput": { ... },
  "failReason": "<only for FAIL>",
  "targetAgentId": "<agent UUID from your team roster, only for DELEGATE or HANDOFF>",
  "contract": {
    "objective": "ONE SENTENCE, imperative — what you want that agent to do",
    "inputs": { },
    "outputSchema": { "required": ["field"] },
    "successCriteria": "how you will judge the result",
    "constraints": ["..."]
  },
  "confidence": 0.0-1.0
}$outputSchemaSection

SAFETY RULES:
- You CANNOT call tools not in the allowed tools list.
- You CANNOT delegate to agents not in your team roster.
- You CANNOT access secrets, credentials, or API keys directly.
- You MUST stop and return FINAL when you have enough information.
- You MUST NOT loop forever. If you cannot proceed, use FAIL.
- You MUST NOT include raw credentials or personal data in reasoningSummary.
- Budgets are enforced by the runtime. Do not try to bypass them.
- Return ONLY valid JSON. No markdown, no code blocks, no extra text."""
    }

    /**
     * The user prompt, and what had to be dropped to fit it.
     *
     * [ContextAssembler] owns the priority order and the bookkeeping; this owns
     * turning the loop's state into sections. Returns the assembly result as well
     * as the text so the caller can put the drops on the iteration span — a
     * truncation nobody records is the failure this whole path exists to remove.
     *
     * Returns null for [assembly] when the flag is off, which is how the caller
     * knows there is nothing to record rather than recording "nothing dropped".
     */
    data class BuiltPrompt(val text: String, val assembly: ContextAssembler.Assembled?)

    fun buildUserPromptDetailed(
        config: AgentBrainConfig,
        state: AgentLoopState,
        /** Blackboard entries the contract named. Empty until delegation lands. */
        blackboard: List<String> = emptyList(),
        /** Summarised handoffs for this subtree. Empty until delegation lands. */
        handoffs: List<String> = emptyList(),
        charBudget: Int = CONTEXT_CHAR_BUDGET,
        enabled: Boolean = CONTEXT_ASSEMBLY_ENABLED,
    ): BuiltPrompt {
        if (!enabled) return BuiltPrompt(buildUserPrompt(config, state), null)

        val parts = buildList {
            add(ContextAssembler.Part(ContextAssembler.Section.OBJECTIVE,
                config.taskInstruction ?: "Complete the task based on the provided inputs."))

            if (config.resolvedInput.isNotEmpty()) add(ContextAssembler.Part(
                ContextAssembler.Section.INPUTS,
                mapper.writerWithDefaultPrettyPrinter().writeValueAsString(config.resolvedInput)))

            if (state.memoryEntries.isNotEmpty()) add(ContextAssembler.Part(
                ContextAssembler.Section.MEMORY,
                state.memoryEntries.takeLast(5).joinToString("\n") { e -> "- ${e.key}: ${e.sanitizedSummary}" }))

            if (blackboard.isNotEmpty()) add(ContextAssembler.Part(
                ContextAssembler.Section.BLACKBOARD, blackboard.joinToString("\n")))

            if (handoffs.isNotEmpty()) add(ContextAssembler.Part(
                ContextAssembler.Section.HANDOFFS, handoffs.joinToString("\n")))

            if (state.observations.isNotEmpty()) add(ContextAssembler.Part(
                ContextAssembler.Section.OBSERVATIONS, renderObservations(state)))
        }

        val assembled = ContextAssembler.assemble(parts, charBudget)

        /* The footer is outside the budget on purpose: it is the iteration counter
           and the last-iteration warning, it is a few dozen characters, and an
           agent that is not told this is its final iteration burns the iteration
           discovering that. */
        val text = assembled.text + budgetFooter(state) + "\n\nReturn your next action as JSON:"
        return BuiltPrompt(text, assembled)
    }

    private fun renderObservations(state: AgentLoopState): String =
        state.observations.takeLast(10).joinToString("\n") { o ->
            val head = "- Iter ${o.iterationNumber} [${o.actionType}${if (o.toolId != null) " tool=${o.toolId}" else ""}]: ${o.sanitizedSummary}"
            if (o.payload != null) "$head\n  RESULT: ${o.payload}" else head
        }

    private fun budgetFooter(state: AgentLoopState): String {
        val warning = if (state.budget.iterationsUsed >= state.budget.maxIterations - 1)
            "\n\n\u26a0 BUDGET WARNING: This is your last iteration (${state.iteration + 1}/${state.budget.maxIterations}). You MUST return FINAL or FAIL now."
        else ""
        return warning + "\n\nIteration: ${state.iteration + 1}/${state.budget.maxIterations}. " +
            "Tool calls used: ${state.budget.toolCallsUsed}/${state.budget.maxToolCalls}."
    }

    fun buildUserPrompt(config: AgentBrainConfig, state: AgentLoopState): String {
        val task = config.taskInstruction ?: "Complete the task based on the provided inputs."
        val inputSection = if (config.resolvedInput.isNotEmpty())
            "\n\nINPUT DATA:\n${mapper.writerWithDefaultPrettyPrinter().writeValueAsString(config.resolvedInput)}"
        else ""

        val observationsSection = if (state.observations.isNotEmpty()) {
            val obs = state.observations.takeLast(10).joinToString("\n") { o ->
                val head = "- Iter ${o.iterationNumber} [${o.actionType}${if (o.toolId != null) " tool=${o.toolId}" else ""}]: ${o.sanitizedSummary}"
                /* The result itself, not just the fact that there was one. Without this
                   line the model is told a tool call succeeded and told the NAMES of the
                   fields it returned, and is then expected to answer from data it has
                   never been shown. It cannot, and it says so — after spending its whole
                   iteration budget discovering it. */
                if (o.payload != null) "$head\n  RESULT: ${o.payload}" else head
            }
            "\n\nPREVIOUS OBSERVATIONS:\n$obs"
        } else ""

        val memorySection = if (state.memoryEntries.isNotEmpty()) {
            val mem = state.memoryEntries.takeLast(5).joinToString("\n") { e -> "- ${e.key}: ${e.sanitizedSummary}" }
            "\n\nWORKING MEMORY:\n$mem"
        } else ""

        val budgetWarning = if (state.budget.iterationsUsed >= state.budget.maxIterations - 1)
            "\n\n⚠ BUDGET WARNING: This is your last iteration (${state.iteration + 1}/${state.budget.maxIterations}). You MUST return FINAL or FAIL now."
        else ""

        return """TASK: $task$inputSection$observationsSection$memorySection$budgetWarning

Iteration: ${state.iteration + 1}/${state.budget.maxIterations}. Tool calls used: ${state.budget.toolCallsUsed}/${state.budget.maxToolCalls}.

Return your next action as JSON:"""
    }

    /** One rostered peer, as the prompt states it. */
    data class AgentDescriptor(
        val id: String,
        val name: String,
        val description: String,
    )

    data class ToolDescriptor(
        val id: String,
        val name: String,
        val description: String,
        val inputSchema: Map<String, Any?> = emptyMap(),
        /**
         * What comes BACK, one line per field.
         *
         * A schema tells the model how to call the tool; nothing told it what it
         * would get. So it called a tool to find out, read forty opaque field
         * names, and spent another iteration deciding which was the one it wanted.
         * Sent once here rather than repeated in every observation.
         */
        val resultLegend: String? = null,
        /**
         * When to reach for THIS tool rather than another.
         *
         * The model's tool-selection quality is bounded by what the description
         * says, and a description generated from an endpoint path says nothing
         * about choosing. This is the tool author's answer to "when would I use
         * this", and it is the cheapest quality lever in the whole loop.
         */
        val usage: String? = null,
    )
}
