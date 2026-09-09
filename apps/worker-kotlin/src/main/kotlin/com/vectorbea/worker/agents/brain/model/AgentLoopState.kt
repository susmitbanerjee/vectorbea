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

    /**
     * Add an entry read back from storage.
     *
     * Flagged so it is not written again on the way out. `agent_memory_entries` has no
     * unique key on (run_id, agent_id, key) — its `ON CONFLICT DO NOTHING` can never
     * fire — so re-persisting what was just loaded would double the rows on every
     * resume, and a run that resumes repeatedly would keep doubling them.
     */
    fun addRecalledMemory(key: String, value: Any?) {
        memoryEntries.add(MemoryEntry(key, value, value.toString(), recalled = true))
    }
    val isDone get() = stopReason != null

    data class MemoryEntry(
        val key: String,
        val value: Any?,
        val sanitizedSummary: String,
        /** True when this was loaded from a previous execution — already stored. */
        val recalled: Boolean = false,
    )

    /**
     * Every way the loop can stop.
     *
     * Adding one is a COMPILE ERROR in three places on purpose —
     * `StopReasonTaxonomy.classify`, `AgentBrainRunner.describeStop` and the
     * taxonomy test all exhaust this enum with no `else`. A stop reason with no
     * class and no sentence is a category with nothing behind it, and a category
     * tells nobody what happened to their run.
     */
    enum class StopReason {
        FINAL_OUTPUT, MAX_ITERATIONS, BUDGET_EXCEEDED, AGENT_FAILED,
        APPROVAL_REQUESTED, TOOL_NOT_ALLOWED, SCHEMA_INVALID, ERROR,

        /**
         * Parked on something that is not a person: an async tool still working,
         * or a signal the agent chose to wait for.
         *
         * SEPARATE from APPROVAL_REQUESTED, which parks the run as
         * `waiting_for_approval` and puts it on the Approvals screen. A six-minute
         * render carrying that reason would appear in a queue nobody can action.
         * Not retryable, for the same reason APPROVAL_REQUESTED is not: retrying
         * a step that is waiting is not waiting.
         */
        WAITING,

        // ── Orchestration (§5.3). All non-retryable, all ORCHESTRATION class. ──

        /** Delegated to an agent it was not granted. The roster analogue of TOOL_NOT_ALLOWED. */
        AGENT_NOT_IN_ROSTER,

        /** The delegation chain went deeper than the team's limit. */
        MAX_DEPTH_EXCEEDED,

        /** The same (from, to, contract-hash) triple has been seen too many times. */
        HANDOFF_LOOP,

        /**
         * A child failed and the join policy cannot proceed without it.
         *
         * DEFINED AND UNCONSTRUCTED until joins exist. A failed delegation is a
         * failed OBSERVATION and the parent's loop continues — exactly as a failed
         * tool call does, because an agent is a callable exactly like a tool. The
         * supervisor can try a different worker, reformulate, or produce a partial
         * FINAL that states what it could not get; all three beat a hard stop, and
         * the last is what the completion margin exists for. This reason is
         * reserved for `wait_all`, where the parent genuinely cannot proceed, and
         * lands with `onChildFailure` in P10.
         */
        CHILD_FAILED,

        /**
         * Waiting on children that can never resolve.
         *
         * DEFINED AND UNCONSTRUCTED until fan-out exists — there is nothing to
         * deadlock on with a single inline child.
         */
        JOIN_DEADLOCK,

        /** The SUBTREE ceiling, not this agent's own. See BudgetLedger. */
        TEAM_BUDGET_EXCEEDED,
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
