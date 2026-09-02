package com.vectorbea.api.routes

/**
 * What a reader may do to a run, and what it will cost them if they do.
 *
 * ── THE ONE RULE THIS FILE EXISTS FOR ───────────────────────────────────────
 * A user must never be unsure whether an action will email a customer. Every
 * option carries its side-effect profile BEFORE the confirmation, in words, and
 * an option that cannot be offered says why rather than being greyed out or —
 * worse — silently doing something adjacent.
 *
 * "Replay from iteration 4" that quietly replays from 1 because reconstruction
 * was unavailable is the specific failure this guards: the reader believes three
 * iterations were restored, the run makes three live model calls, and every
 * conclusion drawn from the result is wrong.
 */
object ReplayOptions {

    /**
     * What running this will actually do in the world.
     *
     * Three levels, and the middle one is the reason this is not a boolean: a
     * replay from iteration N is recorded up to N and LIVE after it, so "does it
     * have side effects" has no honest yes/no answer.
     */
    enum class SideEffects { NONE, LIVE_FROM_POINT, REAL }

    data class Option(
        val id: String,
        val label: String,
        val sideEffects: SideEffects,
        /** One sentence, in the reader's terms, shown before they confirm. */
        val effectSummary: String,
        val available: Boolean,
        /** Why not. Null when available — a disabled control with no reason is a bug. */
        val reason: String?,
    )

    /** The iteration facts the eligibility rules need. */
    data class LoopFacts(
        /** Settled iteration numbers, ascending. */
        val settledIterations: List<Int>,
        /** Iterations whose stored action could not be read. */
        val malformed: List<Int>,
        /** The highest `loop_schema_version` on any row. */
        val maxSchemaVersion: Int,
        /** What this API build can rebuild from. */
        val supportedSchemaVersion: Int,
    )

    /**
     * Why "replay from iteration" cannot be offered, or null when it can.
     *
     * ── THESE RULES MIRROR AgentLoopReconstructor.SkipReason ────────────────
     * Deliberately, and they are stated in the same order the worker applies
     * them, because a UI that offers an action the worker will refuse is worse
     * than one that never offered it: the reader spends a run to find out.
     *
     * The two live in different modules and cannot share a type today. The
     * safeguard is that each branch names the worker's enum constant, so a
     * change on one side has an obvious counterpart on the other.
     */
    fun loopReplayBlocker(f: LoopFacts): String? = when {
        // NO_ITERATIONS
        f.settledIterations.isEmpty() ->
            "This run has no recorded iterations, so there is no loop state to " +
            "restore. Only a run with an agent step produces them."

        // SCHEMA_VERSION_AHEAD
        f.maxSchemaVersion > f.supportedSchemaVersion ->
            "This run's loop state was written by a newer version of the worker " +
            "(format ${f.maxSchemaVersion}, this build reads ${f.supportedSchemaVersion}), " +
            "so it cannot be rebuilt here."

        // NON_CONTIGUOUS — a hole means a row was lost, and restoring around it
        // would remove a step from the model's account of what happened.
        f.settledIterations != (1..f.settledIterations.size).toList() ->
            "The recorded iterations have a gap (${f.settledIterations.joinToString(", ")}), " +
            "so restoring them would leave the agent with an incomplete account of " +
            "what it had already done."

        // MALFORMED_ROW
        f.malformed.isNotEmpty() ->
            "Iteration ${f.malformed.first()} has no readable action recorded, so the " +
            "loop cannot be continued from it."

        else -> null
    }

    /**
     * The four actions, in increasing order of consequence.
     *
     * Ordered that way on purpose: the safest is first and the one with real
     * side effects is last, so a reader scanning downward meets "this will
     * actually happen" at the end rather than in the middle.
     */
    fun optionsFor(
        runStatus: String,
        loopFacts: LoopFacts,
        highestIteration: Int?,
        retryable: Boolean,
    ): List<Option> {
        val loopBlocker = loopReplayBlocker(loopFacts)

        return listOf(
            Option(
                id = "replay_run",
                label = "Replay this run",
                sideEffects = SideEffects.NONE,
                effectSummary =
                    "Re-executes the whole run against the recorded provider responses. " +
                    "No model is called, no tool runs, nothing leaves this system.",
                available = true,
                reason = null,
            ),
            Option(
                id = "replay_from_iteration",
                label = "Replay from an iteration",
                sideEffects = SideEffects.LIVE_FROM_POINT,
                effectSummary =
                    if (highestIteration != null)
                        "Restores the agent's state up to the iteration you pick, then runs " +
                        "LIVE from there — real model calls and real tool calls, which can " +
                        "have real effects. Iterations 1 to ${(highestIteration - 1).coerceAtLeast(0)} " +
                        "can be restored."
                    else
                        "Restores the agent's state up to the iteration you pick, then runs " +
                        "LIVE from there — real model calls and real tool calls.",
                available = loopBlocker == null,
                reason = loopBlocker,
            ),
            Option(
                id = "replay_with_edit",
                label = "Replay with an edit",
                sideEffects = SideEffects.LIVE_FROM_POINT,
                effectSummary =
                    "Change a recorded tool result, then run live from that iteration. " +
                    "You see the edit next to the original before anything runs.",
                available = loopBlocker == null,
                reason = loopBlocker,
            ),
            Option(
                id = "retry_from_step",
                label = "Retry from a step",
                sideEffects = SideEffects.REAL,
                effectSummary =
                    "Runs the workflow again from the step you pick, for real. Every tool " +
                    "call happens, including anything that sends mail, charges a card or " +
                    "writes to another system.",
                available = retryable,
                reason = if (retryable) null
                    else "A run with status '$runStatus' cannot be retried.",
            ),
        )
    }
}
