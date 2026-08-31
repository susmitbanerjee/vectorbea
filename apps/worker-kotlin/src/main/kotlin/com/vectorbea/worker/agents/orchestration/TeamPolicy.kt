package com.vectorbea.worker.agents.orchestration

/**
 * What a team's §6 policy means to the agent loop underneath it.
 *
 * Three settings, all configuration over primitives that already exist. It is
 * deliberately a small value object rather than a reference to [TeamConfig]: the
 * brain has no business reading a roster or an entry agent, and handing it the
 * whole config would let it start.
 */
data class TeamPolicy(
    val policy: OrchestrationPolicy,
    val joinPolicy: JoinPolicy,
    val onChildFailure: OnChildFailure,
    /**
     * This team's roster for a given agent — §6's per-member `canDelegateTo`.
     *
     * A function rather than a map so a caller cannot accidentally hand out the
     * whole roster: the only question anyone may ask is "what may THIS member
     * delegate to", which is the question the grant is about.
     */
    val rosterFor: (java.util.UUID) -> Set<java.util.UUID>?,
) {
    /** Which handoff kinds a member may perform. Enforced at the boundary. */
    val permittedKinds: Set<HandoffStore.Kind> get() = policy.permittedKinds

    companion object {
        fun of(team: TeamConfig) = TeamPolicy(
            team.policy, team.joinPolicy, team.onChildFailure,
            rosterFor = { agentId -> team.memberOf(agentId)?.canDelegateTo },
        )
    }
}
