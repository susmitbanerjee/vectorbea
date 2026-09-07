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
 * deploy, and are overridable per node.
 *
 * The `agent_team` node now exists on the canvas (P10), and the builder writes
 * these keys directly — see `apps/web/src/lib/workflows/team.ts`, which mirrors
 * [TeamConfig.parse] field for field. The canvas ALSO checks the statically
 * checkable §9 guards at design time: a delegation cycle, a chain deeper than
 * [maxDepth], a member the entry cannot reach, and a roster larger than the
 * plan allows. None of that replaces anything here — a graph can be saved under
 * one plan and run under another, so these ceilings remain the enforcement and
 * the canvas is only the chance to say no while the author is still in the room.
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
    /**
     * Hard character budget on the assembled context, per §12.5.
     *
     * ── WHY THIS BELONGS TO THE TEAM AND NOT THE AGENT ──────────────────────
     * Context growth is a property of the CHAIN, not of any member of it. Left
     * alone, a five-hop handoff carries five accumulated contexts, and every
     * agent in that chain is individually behaving reasonably — each one only
     * added its own summary. The place where the total can be bounded is the
     * team, which is the only thing that knows there is a chain.
     *
     * Breaching it is a BUDGET EVENT, not a failure: [ContextAssembler] drops
     * the lowest-priority sections to fit and records what it dropped, and the
     * run continues with a smaller context. What must never happen is that it
     * happens quietly — an agent silently working from half its context is the
     * failure mode this whole section exists to make visible.
     */
    val maxContextChars: Int = DEFAULT_MAX_CONTEXT_CHARS,
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

        /**
         * Falls back to the single-agent budget, so a team with no override
         * behaves exactly as one agent does today. A team-wide default that
         * differed from the agent default would change every existing team's
         * prompt the moment this shipped.
         */
        val DEFAULT_MAX_CONTEXT_CHARS: Int =
            System.getenv("AGENT_TEAM_MAX_CONTEXT_CHARS")?.toIntOrNull()?.coerceAtLeast(1_000)
                ?: com.vectorbea.worker.agents.brain.prompts.AgentPromptBuilder.CONTEXT_CHAR_BUDGET

        /** Read overrides off a node's config, falling back to the defaults. */
        fun fromNodeConfig(config: Map<String, Any?>): TeamLimits = TeamLimits(
            maxDepth = (config["maxDepth"] as? Number)?.toInt()?.coerceIn(1, 10) ?: DEFAULT_MAX_DEPTH,
            maxActivations = (config["maxActivations"] as? Number)?.toInt()?.coerceIn(1, 200)
                ?: DEFAULT_MAX_ACTIVATIONS,
            maxHandoffsPerPair = (config["maxHandoffsPerPair"] as? Number)?.toInt()?.coerceIn(1, 50)
                ?: DEFAULT_MAX_HANDOFFS_PER_PAIR,
            maxDurationMs = (config["maxTeamDurationMs"] as? Number)?.toLong() ?: DEFAULT_MAX_DURATION_MS,
            maxContextChars = (config["maxContextChars"] as? Number)?.toInt()?.coerceAtLeast(1_000)
                ?: DEFAULT_MAX_CONTEXT_CHARS,
        )
    }
}
