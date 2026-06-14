package com.vectorbea.worker.runtime.budget

/**
 * Bounds on how much work a single worker tick may perform before it must
 * checkpoint and yield. A run is executed as a sequence of bounded ticks so it
 * never owns a worker thread indefinitely.
 *
 * A value <= 0 disables that dimension. A null [ExecutionBudget] (not used by a
 * caller) means unbounded — the historical behavior, preserved for tests.
 */
data class ExecutionBudget(
    val maxNodes: Int,
    val maxWallClockMs: Long,
    val maxAgentIterations: Int,
    val maxToolCalls: Int,
    val maxLlmCalls: Int,
) {
    companion object {
        /**
         * Build from environment with the documented beta defaults.
         * `WORKER_*` overrides are honored; absent ones fall back to defaults.
         *
         * BETA POLICY: node-count yielding is DISABLED by default
         * (MAX_NODES_PER_TICK=0). Yielding a 6-node workflow would enqueue an
         * extra RESUME_RUN and amplify Redis traffic for medium workflows. We
         * yield only on the wall-clock budget; approvals, timers, and retry
         * backoff already release the thread via their own durable paths.
         * Set MAX_NODES_PER_TICK>0 to opt back into node-count yielding.
         */
        fun fromEnv(): ExecutionBudget = ExecutionBudget(
            maxNodes           = env("MAX_NODES_PER_TICK", 0),
            maxWallClockMs     = envL("MAX_WALL_CLOCK_MS_PER_TICK", 30_000L),
            maxAgentIterations = env("MAX_AGENT_ITERATIONS_PER_TICK", 0),
            maxToolCalls       = env("MAX_TOOL_CALLS_PER_TICK", 0),
            maxLlmCalls        = env("MAX_LLM_CALLS_PER_TICK", 0),
        )

        private fun env(name: String, default: Int): Int =
            System.getenv(name)?.toIntOrNull() ?: default

        private fun envL(name: String, default: Long): Long =
            System.getenv(name)?.toLongOrNull() ?: default
    }
}
