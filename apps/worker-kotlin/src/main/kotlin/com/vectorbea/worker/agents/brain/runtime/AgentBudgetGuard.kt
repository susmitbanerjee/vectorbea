package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.model.AgentBudget
import com.vectorbea.worker.logging.logger

class AgentBudgetGuard {
    private val log = logger()

    fun checkOrThrow(budget: AgentBudget, context: String = "") {
        val exceeded = budget.checkExceeded() ?: return
        val msg = when (exceeded) {
            /* Each names where the limit is raised. "Exceeded max token budget
               (16384)" was read as a bug, because the agent's own max reply length
               said 100,000 — a different setting, on a different screen. */
            AgentBudget.ExceededReason.ITERATIONS -> "Agent exceeded max iterations (${budget.maxIterations}). Raise Max iterations on the agent"
            AgentBudget.ExceededReason.TOOL_CALLS -> "Agent exceeded max tool calls (${budget.maxToolCalls}). Raise Tool calls under Step limits on this step"
            AgentBudget.ExceededReason.TOKENS     -> "Agent exceeded max token budget (${budget.maxTotalTokens}). Raise Total tokens under Step limits on this step"
            AgentBudget.ExceededReason.COST       -> "Agent exceeded max cost (${budget.maxCostCents} cents). Raise Cost under Step limits on this step"
            AgentBudget.ExceededReason.TIMEOUT    -> "Agent exceeded timeout (${budget.timeoutMs}ms)"
        }
        log.warn("[brain] BUDGET_EXCEEDED $context: $msg [iter={}/{}]", budget.iterationsUsed, budget.maxIterations)
        throw BudgetExceededException(exceeded, msg)
    }
}

class BudgetExceededException(val reason: AgentBudget.ExceededReason, message: String) : RuntimeException(message)
