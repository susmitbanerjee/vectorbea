package com.vectorbea.worker.agents.orchestration

import com.vectorbea.worker.agents.budget.BudgetVector
import java.util.UUID

/**
 * An `agent_team` node's configuration, per §6.
 *
 * Parsed once, at the top of the node's execution, and never re-read — a config
 * that is re-parsed mid-run can change between two reads of the same map and
 * make a team behave differently at its start and its end.
 *
 * Everything here is untrusted: it comes off `graph_json`, which the builder
 * writes. Every field has a default, every list is bounded, and an unparseable
 * value degrades to the default rather than failing the node — except the two
 * that have no sensible default, [policy] and [entry], where a wrong guess would
 * run somebody's team as a shape they did not choose.
 */
data class TeamConfig(
    val policy: OrchestrationPolicy,
    val roster: List<Member>,
    val limits: TeamLimits,
    val budget: BudgetVector,
    val joinPolicy: JoinPolicy,
    val onChildFailure: OnChildFailure,
    /** Bounded rounds, for [OrchestrationPolicy.REVIEW]. */
    val maxRounds: Int,
) {
    /**
     * One member of the team.
     *
     * ── canDelegateTo IS PER-MEMBER, NOT GLOBAL ─────────────────────────────
     * A researcher that can re-delegate to the writer creates a cycle. The depth
     * limit will eventually catch it — but "you hit the depth limit" is a
     * sentence about the runtime, and "the researcher is not allowed to delegate
     * to the writer" is a sentence about the design. The second is cheaper to
     * detect and vastly easier to render on a canvas, where a per-member roster
     * is a set of arrows and a global one is a claim nobody can check by looking.
     */
    data class Member(
        val agentId: UUID,
        val role: String,
        /** Names, resolved to ids against the roster. Empty means no delegation. */
        val canDelegateTo: Set<UUID>,
        /** The builder's local name for this member. */
        val alias: String?,
    )

    /** The entry member — where the team starts. */
    val entry: Member get() = roster.first()

    fun memberOf(agentId: UUID): Member? = roster.firstOrNull { it.agentId == agentId }

    companion object {
        const val DEFAULT_MAX_ROUNDS = 4

        /**
         * Parse a node's config, or explain why it cannot run.
         *
         * Returns null for the two cases where a default would be a guess about
         * somebody's design rather than a fallback: no recognisable policy, and no
         * entry agent. Everything else degrades.
         */
        fun parse(config: Map<String, Any?>): Parsed {
            val policy = OrchestrationPolicy.fromWire(config["policy"] as? String)
                ?: return Parsed.Invalid(
                    "The team node's policy is missing or not one of " +
                    OrchestrationPolicy.entries.joinToString { it.wire } + ".")

            @Suppress("UNCHECKED_CAST")
            val rawRoster = (config["roster"] as? List<*>)
                ?.mapNotNull { it as? Map<String, Any?> }
                ?: emptyList()
            if (rawRoster.isEmpty()) return Parsed.Invalid("The team node has an empty roster.")

            /* Alias → id first, so a member's canDelegateTo may name peers the way
               the builder wrote them. A name that matches nobody is dropped rather
               than failing the node: the grant is a whitelist, so a dropped entry
               can only ever make the team MORE restricted. */
            val byAlias = mutableMapOf<String, UUID>()
            val members = mutableListOf<Pair<Map<String, Any?>, UUID>>()
            for (m in rawRoster) {
                val id = (m["agentId"] as? String)?.let {
                    runCatching { UUID.fromString(it) }.getOrNull()
                } ?: continue
                members += m to id
                (m["alias"] as? String)?.takeIf { it.isNotBlank() }?.let { byAlias[it] = id }
            }
            if (members.isEmpty()) return Parsed.Invalid("No roster member has a valid agentId.")

            fun resolve(name: String): UUID? =
                byAlias[name] ?: runCatching { UUID.fromString(name) }.getOrNull()

            val roster = members.map { (m, id) ->
                Member(
                    agentId = id,
                    role = (m["role"] as? String)?.takeIf { it.isNotBlank() } ?: "worker",
                    canDelegateTo = ((m["canDelegateTo"] as? List<*>) ?: emptyList<Any?>())
                        .mapNotNull { it?.toString()?.let(::resolve) }
                        .filter { it != id }   // self-delegation is a one-node loop
                        .toSet(),
                    alias = m["alias"] as? String,
                )
            }

            /* The entry: named explicitly, else the member whose role leads this
               policy, else the first. Ordered so `pipeline` — where the roster IS
               the order — starts at the front without needing an entryAgentId. */
            val entryId = (config["entryAgentId"] as? String)
                ?.let { resolve(it) }
            val entry = roster.firstOrNull { it.agentId == entryId }
                ?: roster.firstOrNull { it.role.equals(leadRole(policy), ignoreCase = true) }
                ?: roster.first()

            @Suppress("UNCHECKED_CAST")
            val budgetCfg = (config["budget"] as? Map<String, Any?>) ?: emptyMap()
            @Suppress("UNCHECKED_CAST")
            val limitsCfg = (config["limits"] as? Map<String, Any?>) ?: emptyMap()

            val maxRounds = (limitsCfg["maxRounds"] as? Number)?.toInt()?.coerceIn(1, 20)
                ?: DEFAULT_MAX_ROUNDS

            /*
             * ── maxRounds IS maxHandoffsPerPair, FOR THE ONE POLICY THAT HAS ──
             *
             * A review "round" is the worker delegating the same draft to the same
             * reviewer once more — which is exactly the (from, to, contract-hash)
             * triple the §9 repeated-handoff guard already counts. Resolving it to
             * that guard rather than adding a round counter is what invariant 9
             * asks for: a policy is configuration over the primitives, and a second
             * counter would be a second bound that could disagree with the first.
             *
             * Only for REVIEW. Every other policy leaves maxHandoffsPerPair alone,
             * because a supervisor asking two different questions of one worker is
             * not two rounds of anything.
             */
            val limits = TeamLimits.fromNodeConfig(limitsCfg).let { base ->
                if (policy.usesRounds && limitsCfg.containsKey("maxRounds"))
                    base.copy(maxHandoffsPerPair = maxRounds) else base
            }

            return Parsed.Valid(
                TeamConfig(
                    policy = policy,
                    /* Entry first, so `roster.first()` is always the entry and the
                       pipeline's order is the roster's order after it. */
                    roster = listOf(entry) + roster.filter { it.agentId != entry.agentId },
                    limits = limits,
                    budget = BudgetVector(
                        iterations = (limitsCfg["maxIterations"] as? Number)?.toInt() ?: 0,
                        toolCalls = (limitsCfg["maxToolCalls"] as? Number)?.toInt() ?: 0,
                        tokens = (budgetCfg["maxTotalTokens"] as? Number)?.toLong() ?: 0L,
                        costMicroCents = BudgetVector.ofCents(
                            (budgetCfg["maxCostCents"] as? Number)?.toDouble() ?: 0.0),
                    ),
                    joinPolicy = JoinPolicy.parse(config["joinPolicy"]),
                    onChildFailure = OnChildFailure.parse(config["onChildFailure"] as? String),
                    maxRounds = maxRounds,
                )
            )
        }

        /** Which role leads each policy, when no entry is named. */
        private fun leadRole(policy: OrchestrationPolicy): String = when (policy) {
            OrchestrationPolicy.SUPERVISOR -> "supervisor"
            OrchestrationPolicy.ROUTER -> "router"
            OrchestrationPolicy.REVIEW -> "worker"
            OrchestrationPolicy.PIPELINE, OrchestrationPolicy.BLACKBOARD -> "worker"
        }
    }

    /** Either a runnable team, or a sentence saying what is wrong with the node. */
    sealed class Parsed {
        data class Valid(val config: TeamConfig) : Parsed()
        data class Invalid(val reason: String) : Parsed()
    }
}

/**
 * When a fan-out is finished.
 *
 * `quorum(k)` carries its k, which is why this is a sealed class and not an
 * enum: "wait for 2 of 5" is a different policy from "wait for 3 of 5", and
 * putting k somewhere else would let the two drift apart.
 */
sealed class JoinPolicy {
    /** Every child must finish. The default, and the only one that is total. */
    object WaitAll : JoinPolicy()

    /**
     * The first success ends it.
     *
     * The remaining children are CANCELLED, not failed — they were not asked to
     * finish. Grading them failed would make a working race look like four
     * broken agents and one good one.
     */
    object WaitAny : JoinPolicy()

    /** k successes end it. */
    data class Quorum(val k: Int) : JoinPolicy()

    /** How many successes satisfy this join, given [childCount] children. */
    fun required(childCount: Int): Int = when (this) {
        WaitAll -> childCount
        WaitAny -> 1
        is Quorum -> k.coerceIn(1, childCount)
    }

    val wire: String get() = when (this) {
        WaitAll -> "wait_all"
        WaitAny -> "wait_any"
        is Quorum -> "quorum($k)"
    }

    companion object {
        /** Accepts `"wait_all"`, `"wait_any"`, `"quorum(2)"`, or `{quorum: 2}`. */
        fun parse(raw: Any?): JoinPolicy {
            if (raw is Map<*, *>) {
                (raw["quorum"] as? Number)?.let { return Quorum(it.toInt().coerceAtLeast(1)) }
            }
            val s = (raw as? String)?.trim()?.lowercase() ?: return WaitAll
            QUORUM.matchFor(s)?.let { return Quorum(it) }
            return when (s) {
                "wait_any", "any", "first" -> WaitAny
                else -> WaitAll
            }
        }

        private val QUORUM = Regex("""^quorum\s*\(\s*(\d+)\s*\)$""")
        private fun Regex.matchFor(s: String): Int? =
            find(s)?.groupValues?.getOrNull(1)?.toIntOrNull()?.coerceAtLeast(1)
    }
}

/**
 * What a failed child does to its parent.
 *
 * The default is [CONTINUE], which is the P9 rule: a failed delegation is a
 * failed OBSERVATION and the parent carries on, because an agent is a callable
 * exactly like a tool and a failed tool call does not fail the step.
 * [FAIL_PARENT] is the opt-in for a `wait_all` join that genuinely cannot
 * proceed — which is the one place `CHILD_FAILED` was reserved for.
 */
enum class OnChildFailure(val wire: String) {
    CONTINUE("continue"),
    FAIL_PARENT("fail_parent"),
    ;

    companion object {
        fun parse(s: String?): OnChildFailure =
            entries.firstOrNull { it.wire.equals(s?.trim(), ignoreCase = true) } ?: CONTINUE
    }
}
