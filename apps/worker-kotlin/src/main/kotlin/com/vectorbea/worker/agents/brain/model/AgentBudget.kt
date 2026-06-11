package com.vectorbea.worker.agents.brain.model

import java.time.Instant

/** Mutable budget tracker for one agent brain run. */
data class AgentBudget(
    val maxIterations: Int,
    val maxToolCalls: Int,
    val maxTotalTokens: Int,
    val maxCostCents: Int,
    val timeoutMs: Long,
    val startedAt: Instant = Instant.now(),
) {
    var iterationsUsed: Int = 0
    var toolCallsUsed: Int = 0
    var tokensUsed: Int = 0
    var estimatedCostCents: Double = 0.0

    fun addTokens(count: Int, costCents: Double = 0.0) {
        tokensUsed += count
        estimatedCostCents += costCents
    }

    fun iterationStarted()  { iterationsUsed++ }
    fun toolCallUsed()       { toolCallsUsed++ }

    val elapsedMs: Long get() = Instant.now().toEpochMilli() - startedAt.toEpochMilli()

    enum class ExceededReason { ITERATIONS, TOOL_CALLS, TOKENS, COST, TIMEOUT }

    fun checkExceeded(): ExceededReason? = when {
        iterationsUsed > maxIterations -> ExceededReason.ITERATIONS
        toolCallsUsed  > maxToolCalls  -> ExceededReason.TOOL_CALLS
        tokensUsed     > maxTotalTokens -> ExceededReason.TOKENS
        estimatedCostCents > maxCostCents -> ExceededReason.COST
        elapsedMs      > timeoutMs     -> ExceededReason.TIMEOUT
        else -> null
    }
}
