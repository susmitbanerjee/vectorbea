package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.model.AgentBudget
import com.vectorbea.worker.logging.logger

class AgentBudgetGuard {
    private val log = logger()

    fun checkOrThrow(budget: AgentBudget, context: String = "") {
        val exceeded = budget.checkExceeded() ?: return
        val msg = when (exceeded) {
            AgentBudget.ExceededReason.ITERATIONS -> "Agent exceeded max iterations (${budget.maxIterations})"
            AgentBudget.ExceededReason.TOOL_CALLS -> "Agent exceeded max tool calls (${budget.maxToolCalls})"
            AgentBudget.ExceededReason.TOKENS     -> "Agent exceeded max token budget (${budget.maxTotalTokens})"
            AgentBudget.ExceededReason.COST       -> "Agent exceeded max cost (${budget.maxCostCents} cents)"
            AgentBudget.ExceededReason.TIMEOUT    -> "Agent exceeded timeout (${budget.timeoutMs}ms)"
        }
        log.warn("[brain] BUDGET_EXCEEDED $context: $msg [iter={}/{}]", budget.iterationsUsed, budget.maxIterations)
        throw BudgetExceededException(exceeded, msg)
    }
}

class BudgetExceededException(val reason: AgentBudget.ExceededReason, message: String) : RuntimeException(message)
