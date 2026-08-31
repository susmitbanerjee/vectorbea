package com.vectorbea.worker.agents.orchestration

/**
 * The five §6 policies, as a TABLE.
 *
 * ── INVARIANT 9: THERE IS ONE ENGINE ────────────────────────────────────────
 * Supervisor/worker, router, pipeline, review and blackboard are not five
 * orchestrators. They are five rows here, and [OrchestrationLoop] is the single
 * thing that reads them. Every row says the same two things — which handoff
 * kinds it permits, and when it is finished — because that is the whole of what
 * distinguishes them.
 *
 * The test of whether that is honestly true: adding a sixth policy must be a
 * sixth row and nothing else. If it needs a branch in the loop, the loop has
 * grown a second scheduler and the design has failed.
 *
 * ── THE PERMITTED KINDS ARE ENFORCEMENT, NOT DOCUMENTATION ──────────────────
 * A router whose specialists start DELEGATE-ing to each other is no longer a
 * router, and the run that results is one nobody designed. The kinds are checked
 * in runtime code at the same boundary the roster grant is checked, for the same
 * reason: a policy stated only in a prompt is a suggestion.
 */
enum class OrchestrationPolicy(
    val wire: String,
    /** Handoff kinds a member of this team may perform. */
    val permittedKinds: Set<HandoffStore.Kind>,
    val terminatesOn: Termination,
    /** Whether the team's `maxRounds` limit means anything here. */
    val usesRounds: Boolean = false,
) {
    /** One supervisor + N workers. The supervisor aggregates. */
    SUPERVISOR(
        "supervisor",
        setOf(HandoffStore.Kind.DELEGATE, HandoffStore.Kind.BROADCAST, HandoffStore.Kind.ESCALATE),
        Termination.ENTRY_FINAL,
    ),

    /**
     * One router + N specialists. A tail call, and only a tail call.
     *
     * TRANSFER only. A router that could also DELEGATE would be a supervisor
     * wearing a router's name, and the run's shape would stop matching what the
     * builder chose on the canvas.
     */
    ROUTER(
        "router",
        setOf(HandoffStore.Kind.TRANSFER),
        Termination.TRANSFER_TARGET_FINAL,
    ),

    /**
     * An ordered list. Each stage's output is the next stage's input.
     *
     * The one policy where the RUNTIME chooses the next agent rather than a model
     * doing it — the order is the configuration. It is still not a scheduler: the
     * loop calls the same `delegate` primitive once per stage, in a `for`.
     */
    PIPELINE(
        "pipeline",
        setOf(HandoffStore.Kind.TRANSFER),
        Termination.LAST_STAGE_FINAL,
    ),

    /** Worker + reviewer, bounded rounds. */
    REVIEW(
        "review",
        setOf(HandoffStore.Kind.DELEGATE),
        Termination.REVIEWER_APPROVES_OR_ROUNDS,
        usesRounds = true,
    ),

    /** N peers, no hierarchy, sharing a blackboard. */
    BLACKBOARD(
        "blackboard",
        setOf(HandoffStore.Kind.BROADCAST, HandoffStore.Kind.DELEGATE),
        Termination.QUORUM_OR_PEER_FINAL,
    ),
    ;

    fun permits(kind: HandoffStore.Kind): Boolean = kind in permittedKinds

    companion object {
        fun fromWire(s: String?): OrchestrationPolicy? =
            entries.firstOrNull { it.wire.equals(s?.trim(), ignoreCase = true) }
    }
}

/**
 * When a team is finished.
 *
 * Read by [OrchestrationLoop] and by nothing else. Five values, one per policy —
 * they are not combinable, and an enum rather than a lambda so a policy's
 * termination is a thing you can look at in a table rather than a closure you
 * have to go and read.
 */
enum class Termination {
    /** The entry agent returned FINAL. Its output is the team's output. */
    ENTRY_FINAL,

    /** The agent transferred TO returned FINAL. The entry agent is `handed_off`. */
    TRANSFER_TARGET_FINAL,

    /** The last stage returned FINAL. */
    LAST_STAGE_FINAL,

    /** The reviewer approved, or the rounds ran out. */
    REVIEWER_APPROVES_OR_ROUNDS,

    /** A peer returned FINAL, or the join quorum was met. */
    QUORUM_OR_PEER_FINAL,
}
