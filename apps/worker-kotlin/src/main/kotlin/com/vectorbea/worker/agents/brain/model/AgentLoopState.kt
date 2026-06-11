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
)
