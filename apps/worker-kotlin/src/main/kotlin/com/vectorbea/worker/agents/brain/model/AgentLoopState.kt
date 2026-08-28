package com.vectorbea.worker.agents.brain.model

import java.util.UUID

/** Mutable state threaded through the agent brain loop. */
data class AgentLoopState(
    val config: AgentBrainConfig,
    val budget: AgentBudget,
    var iteration: Int = 0,
    val observations: MutableList<AgentObservation> = mutableListOf(),
    val memoryEntries: MutableList<MemoryEntry> = mutableListOf(),
    var finalOutput: Map<String, Any?> = emptyMap(),
    var stopReason: StopReason? = null,
    var lastAction: AgentAction? = null,
) {
    fun addObservation(obs: AgentObservation) { observations.add(obs) }
    fun addMemory(key: String, value: Any?, sanitized: String? = null) {
        memoryEntries.add(MemoryEntry(key, value, sanitized ?: value.toString()))
    }
    val isDone get() = stopReason != null

    data class MemoryEntry(val key: String, val value: Any?, val sanitizedSummary: String)

    enum class StopReason {
        FINAL_OUTPUT, MAX_ITERATIONS, BUDGET_EXCEEDED, AGENT_FAILED,
        APPROVAL_REQUESTED, TOOL_NOT_ALLOWED, SCHEMA_INVALID, ERROR
    }
}

data class AgentObservation(
    val iterationNumber: Int,
    val actionType: String,
    val toolId: String? = null,
    /** Sanitized one-sentence summary — no raw secrets or credentials */
    val sanitizedSummary: String,
    val success: Boolean = true,
    val tokensUsed: Int = 0,
    /**
     * WHAT THE TOOL ACTUALLY RETURNED, for the model to read on the next iteration.
     *
     * [sanitizedSummary] is a description OF a result ("Tool returned 3 field(s):
     * status, body, headers") and it is what the timeline and the iteration record
     * show. For a while it was also the only thing fed back into the prompt, which
     * meant an agent could call a tool, be told the call succeeded and be told the
     * names of the fields it returned — and never see a single value. Agents ran
     * their whole iteration budget and then reported the data was missing, which it
     * was: the runtime had fetched it and thrown it away.
     *
     * Sanitized and length-capped like the summary, and null for actions that
     * produce no payload (THINK) and for calls that returned nothing.
     */
    val payload: String? = null,
)
