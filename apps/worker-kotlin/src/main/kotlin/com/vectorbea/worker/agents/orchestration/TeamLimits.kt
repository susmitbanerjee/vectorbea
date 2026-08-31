package com.vectorbea.worker.agents.orchestration

/**
 * The bounds on a team, per §9.
 *
 * Multi-agent's characteristic failure is not a wrong answer; it is a system
 * that never stops. Every value here is a bound on that, and every one is
 * checked in runtime code before an activation is created — never suggested in a
 * prompt, because a prompt is documentation and not enforcement.
 *
 * Defaults come from the environment so an operator can tighten them without a
 * deploy, and are overridable per node. There is no `agent_team` node until P10,
 * so node config is the only per-team source that exists today.
 */
data class TeamLimits(
    /** Depth of the delegation chain. A root activation is depth 0. */
    val maxDepth: Int = DEFAULT_MAX_DEPTH,
    /** Activations in one run, across the whole tree. */
    val maxActivations: Int = DEFAULT_MAX_ACTIVATIONS,
    /**
     * How many times one `(from, to, contract-hash)` triple may repeat.
     *
     * The direct analogue of the existing repeated-tool-failure stop: if the same
     * request has already been made twice and come back the same, spending the
     * remaining budget reproving it helps nobody.
     */
    val maxHandoffsPerPair: Int = DEFAULT_MAX_HANDOFFS_PER_PAIR,
    /**
     * Wall clock for the whole team, EXCLUDING approval parking.
     *
     * Excluding it matters: a team parked three days on a human has not been
     * running for three days, and charging it wall clock would make "max 10
     * minutes" mean "no team may wait for a person".
     */
    val maxDurationMs: Long = DEFAULT_MAX_DURATION_MS,
) {
    companion object {
        val DEFAULT_MAX_DEPTH: Int =
            System.getenv("AGENT_TEAM_MAX_DEPTH")?.toIntOrNull()?.coerceIn(1, 10) ?: 3
        val DEFAULT_MAX_ACTIVATIONS: Int =
            System.getenv("AGENT_TEAM_MAX_ACTIVATIONS")?.toIntOrNull()?.coerceIn(1, 200) ?: 12
        val DEFAULT_MAX_HANDOFFS_PER_PAIR: Int =
            System.getenv("AGENT_TEAM_MAX_HANDOFFS_PER_PAIR")?.toIntOrNull()?.coerceIn(1, 50) ?: 2
        val DEFAULT_MAX_DURATION_MS: Long =
            System.getenv("AGENT_TEAM_MAX_DURATION_MS")?.toLongOrNull() ?: 600_000L

        /** Read overrides off a node's config, falling back to the defaults. */
        fun fromNodeConfig(config: Map<String, Any?>): TeamLimits = TeamLimits(
            maxDepth = (config["maxDepth"] as? Number)?.toInt()?.coerceIn(1, 10) ?: DEFAULT_MAX_DEPTH,
            maxActivations = (config["maxActivations"] as? Number)?.toInt()?.coerceIn(1, 200)
                ?: DEFAULT_MAX_ACTIVATIONS,
            maxHandoffsPerPair = (config["maxHandoffsPerPair"] as? Number)?.toInt()?.coerceIn(1, 50)
                ?: DEFAULT_MAX_HANDOFFS_PER_PAIR,
            maxDurationMs = (config["maxTeamDurationMs"] as? Number)?.toLong() ?: DEFAULT_MAX_DURATION_MS,
        )
    }
}
