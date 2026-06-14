package com.vectorbea.worker.runtime.budget

/**
 * Tracks consumption of an [ExecutionBudget] during a single worker tick.
 *
 * The DAG loop calls [recordNode] / [recordLlmCall] / [recordToolCall] /
 * [recordAgentIteration] as it makes progress and checks [canContinue] before
 * starting the next unit of work. When a dimension is exhausted the run
 * checkpoints and yields; a re-enqueued RESUME_RUN resumes with a fresh tracker.
 *
 * Not thread-safe by design: one tracker belongs to one run tick on one thread.
 * Parallel branches run within the same wall-clock budget; node/llm/tool counts
 * are recorded on the main loop so the bound stays meaningful.
 */
class ExecutionBudgetTracker(private val budget: ExecutionBudget) {
    private val startedAtMs = System.currentTimeMillis()

    private var nodes = 0
    private var agentIterations = 0
    private var toolCalls = 0
    private var llmCalls = 0

    fun recordNode() { nodes++ }
    fun recordAgentIteration() { agentIterations++ }
    fun recordToolCall() { toolCalls++ }
    fun recordLlmCall() { llmCalls++ }

    fun elapsedMs(): Long = System.currentTimeMillis() - startedAtMs

    /** True while every enabled budget dimension still has headroom. */
    fun canContinue(): Boolean = exhaustedReason() == null

    /**
     * The first exhausted dimension, or null if all still have headroom.
     * Returned as a stable machine string suitable for the RUN_YIELDED event.
     */
    fun exhaustedReason(): String? = when {
        budget.maxNodes > 0 && nodes >= budget.maxNodes -> "MAX_NODES_PER_TICK_EXCEEDED"
        budget.maxWallClockMs > 0 && elapsedMs() >= budget.maxWallClockMs -> "MAX_WALL_CLOCK_MS_EXCEEDED"
        budget.maxAgentIterations > 0 && agentIterations >= budget.maxAgentIterations -> "MAX_AGENT_ITERATIONS_PER_TICK_EXCEEDED"
        budget.maxToolCalls > 0 && toolCalls >= budget.maxToolCalls -> "MAX_TOOL_CALLS_PER_TICK_EXCEEDED"
        budget.maxLlmCalls > 0 && llmCalls >= budget.maxLlmCalls -> "MAX_LLM_CALLS_PER_TICK_EXCEEDED"
        else -> null
    }

    /** Compact snapshot for the RUN_YIELDED event metadata. */
    fun snapshotJson(): String =
        """{"nodes":$nodes,"agentIterations":$agentIterations,"toolCalls":$toolCalls,""" +
        """"llmCalls":$llmCalls,"elapsedMs":${elapsedMs()},""" +
        """"maxNodes":${budget.maxNodes},"maxWallClockMs":${budget.maxWallClockMs}}"""
}
