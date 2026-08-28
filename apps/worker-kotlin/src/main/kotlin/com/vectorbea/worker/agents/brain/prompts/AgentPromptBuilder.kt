package com.vectorbea.worker.agents.brain.prompts

import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import com.vectorbea.worker.agents.brain.model.AgentLoopState
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

    fun buildSystemPrompt(config: AgentBrainConfig, availableTools: List<ToolDescriptor>): String {
        val toolsJson = mapper.writerWithDefaultPrettyPrinter()
            .writeValueAsString(availableTools.map { mapOf("id" to it.id, "name" to it.name, "description" to it.description, "inputSchema" to it.inputSchema) })
        val outputSchemaSection = if (config.outputSchemaJson != "{}") "\n\nFINAL OUTPUT SCHEMA (your finalOutput MUST match this JSON Schema):\n${config.outputSchemaJson}" else ""

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
- FAIL: You cannot complete the task. Explain why in failReason.

ALLOWED TOOLS:
$toolsJson

ACTION JSON FORMAT:
{
  "type": "CALL_TOOL" | "THINK" | "FINAL" | "ASK_APPROVAL" | "FAIL",
  "reasoningSummary": "ONE SENTENCE explaining why you chose this action.",
  "toolId": "<tool UUID from allowed tools list, only for CALL_TOOL>",
  "toolInput": { ... },
  "finalOutput": { ... },
  "failReason": "<only for FAIL>",
  "confidence": 0.0-1.0
}$outputSchemaSection

SAFETY RULES:
- You CANNOT call tools not in the allowed tools list.
- You CANNOT access secrets, credentials, or API keys directly.
- You MUST stop and return FINAL when you have enough information.
- You MUST NOT loop forever. If you cannot proceed, use FAIL.
- You MUST NOT include raw credentials or personal data in reasoningSummary.
- Budgets are enforced by the runtime. Do not try to bypass them.
- Return ONLY valid JSON. No markdown, no code blocks, no extra text."""
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

    data class ToolDescriptor(
        val id: String,
        val name: String,
        val description: String,
        val inputSchema: Map<String, Any?> = emptyMap(),
    )
}
