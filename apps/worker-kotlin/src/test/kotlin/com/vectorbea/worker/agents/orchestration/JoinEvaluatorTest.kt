package com.vectorbea.worker.agents.orchestration

import com.vectorbea.worker.agents.orchestration.JoinEvaluator.Outcome
import com.vectorbea.worker.agents.orchestration.JoinEvaluator.Verdict
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * The join arithmetic, exhaustively — it is pure, so there is no excuse not to be.
 *
 * Everything interesting about a fan-out is here: when it is finished, when it
 * can no longer finish, and whether a failure is fatal. Testing it through a
 * database and three agent loops would cover a third of the cases and take a
 * hundred times as long.
 */
class JoinEvaluatorTest {

    private fun judge(
        outcomes: List<Outcome>,
        total: Int = 3,
        join: JoinPolicy = JoinPolicy.WaitAll,
        onFail: OnChildFailure = OnChildFailure.CONTINUE,
    ) = JoinEvaluator.judge(outcomes, total, join, onFail)

    private val S = Outcome.SUCCEEDED
    private val F = Outcome.FAILED

    // ── wait_all ─────────────────────────────────────────────────────────────

    @Test
    fun `wait_all needs every child`() {
        assertIs<Verdict.Continue>(judge(listOf(S)))
        assertIs<Verdict.Continue>(judge(listOf(S, S)))
        assertEquals(3, assertIs<Verdict.Satisfied>(judge(listOf(S, S, S))).successes)
    }

    @Test
    fun `wait_all gives up as soon as the arithmetic says it must`() {
        /* One failure of three makes three-of-three unreachable. Running the
           remaining child costs a whole agent loop to reach a conclusion already
           known — on a team that is not a rounding error, it is most of the
           budget. */
        val v = assertIs<Verdict.Impossible>(judge(listOf(S, F)))
        assertEquals(1, v.successes)
        assertEquals(1, v.failures)
    }

    // ── wait_any ─────────────────────────────────────────────────────────────

    @Test
    fun `wait_any returns on the first success`() {
        assertEquals(1, assertIs<Verdict.Satisfied>(
            judge(listOf(S), join = JoinPolicy.WaitAny)).successes)
    }

    @Test
    fun `wait_any keeps going while children fail`() {
        assertIs<Verdict.Continue>(judge(listOf(F), join = JoinPolicy.WaitAny))
        assertIs<Verdict.Continue>(judge(listOf(F, F), join = JoinPolicy.WaitAny))
        /* Only when nothing is left can it no longer be met. */
        assertIs<Verdict.Impossible>(judge(listOf(F, F, F), join = JoinPolicy.WaitAny))
    }

    // ── quorum(k) ────────────────────────────────────────────────────────────

    @Test
    fun `quorum of 2 returns when the second succeeds`() {
        val join = JoinPolicy.Quorum(2)
        assertIs<Verdict.Continue>(judge(listOf(S), join = join))
        assertEquals(2, assertIs<Verdict.Satisfied>(judge(listOf(S, S), join = join)).successes)
    }

    @Test
    fun `a quorum survives a failure it can still make up`() {
        val join = JoinPolicy.Quorum(2)
        assertIs<Verdict.Continue>(judge(listOf(F), join = join))
        assertIs<Verdict.Continue>(judge(listOf(F, S), join = join))
        assertEquals(2, assertIs<Verdict.Satisfied>(judge(listOf(F, S, S), total = 4, join = join)).successes)
    }

    @Test
    fun `a quorum larger than the fan-out is clamped, not impossible`() {
        /* quorum(5) of 3 children means "all of them" rather than "never". A
           builder who typed the wrong number gets a strict join, not a team that
           can only ever fail. */
        assertEquals(3, JoinPolicy.Quorum(5).required(3))
        assertIs<Verdict.Satisfied>(judge(listOf(S, S, S), join = JoinPolicy.Quorum(5)))
    }

    // ── onChildFailure ───────────────────────────────────────────────────────

    @Test
    fun `the default carries on past a failure`() {
        /* P9's rule applied to a set: a failed child is a failed OBSERVATION, and
           only an arithmetic shortfall ends the join. */
        assertIs<Verdict.Continue>(judge(listOf(F), total = 5, join = JoinPolicy.Quorum(2)))
    }

    @Test
    fun `fail_parent ends it on the first failure, whatever the arithmetic says`() {
        val v = assertIs<Verdict.Impossible>(
            judge(listOf(F), total = 5, join = JoinPolicy.Quorum(2),
                onFail = OnChildFailure.FAIL_PARENT))
        assertEquals(0, v.successes)
        assertEquals(1, v.failures)
    }

    // ── Pausing ──────────────────────────────────────────────────────────────

    @Test
    fun `a paused child ends the tick, whatever else has happened`() {
        /* Checked first: a child on a human means the whole tick stops, and
           deciding the join around it would either cancel work a person is about
           to approve or declare a result the team has not got yet. */
        assertIs<Verdict.Paused>(judge(listOf(S, S, Outcome.PAUSED)))
        assertIs<Verdict.Paused>(judge(listOf(F, Outcome.PAUSED), join = JoinPolicy.WaitAny))
    }

    // ── Parsing ──────────────────────────────────────────────────────────────

    @Test
    fun `join policies parse from the shapes a builder writes`() {
        assertEquals(JoinPolicy.WaitAll, JoinPolicy.parse("wait_all"))
        assertEquals(JoinPolicy.WaitAny, JoinPolicy.parse("wait_any"))
        assertEquals(JoinPolicy.Quorum(2), JoinPolicy.parse("quorum(2)"))
        assertEquals(JoinPolicy.Quorum(3), JoinPolicy.parse("quorum( 3 )"))
        assertEquals(JoinPolicy.Quorum(2), JoinPolicy.parse(mapOf("quorum" to 2)))
        /* Unrecognised is wait_all, the strict one. A typo must not silently turn
           a five-agent consensus into "whichever answers first". */
        assertEquals(JoinPolicy.WaitAll, JoinPolicy.parse("qorum(2)"))
        assertEquals(JoinPolicy.WaitAll, JoinPolicy.parse(null))
    }

    @Test
    fun `onChildFailure defaults to carrying on`() {
        assertEquals(OnChildFailure.CONTINUE, OnChildFailure.parse(null))
        assertEquals(OnChildFailure.CONTINUE, OnChildFailure.parse("nonsense"))
        assertEquals(OnChildFailure.FAIL_PARENT, OnChildFailure.parse("fail_parent"))
    }
}

/**
 * The team config, parsed — the untrusted half of §6.
 *
 * Pure, so it is tested here rather than through a database and three agent
 * loops. What matters is that a malformed config degrades where degrading is
 * safe and refuses where a default would be a guess about somebody's design.
 */
class TeamConfigTest {

    private val a = UUID.randomUUID()
    private val b = UUID.randomUUID()

    private fun member(id: UUID, role: String, alias: String, vararg to: String) = mapOf(
        "agentId" to id.toString(), "role" to role, "alias" to alias,
        "canDelegateTo" to to.toList(),
    )

    private fun parse(vararg pairs: Pair<String, Any?>) =
        TeamConfig.parse(mapOf(*pairs))

    @Test
    fun `a valid supervisor team parses, entry first`() {
        val p = assertIs<TeamConfig.Parsed.Valid>(parse(
            "policy" to "supervisor",
            "roster" to listOf(member(b, "worker", "w"), member(a, "supervisor", "s", "w")),
        )).config

        /* The entry leads the roster whatever order the builder wrote it in, so
           `roster.first()` is always the entry and a pipeline's order is the rest. */
        assertEquals(a, p.entry.agentId)
        assertEquals(setOf(b), p.entry.canDelegateTo, "the alias did not resolve to an id")
        assertEquals(OrchestrationPolicy.SUPERVISOR, p.policy)
    }

    @Test
    fun `a missing policy is refused rather than defaulted`() {
        /* Defaulting would run somebody's team as a shape they did not choose,
           which is worse than refusing to run it. */
        assertIs<TeamConfig.Parsed.Invalid>(parse("roster" to listOf(member(a, "worker", "w"))))
        assertIs<TeamConfig.Parsed.Invalid>(parse("policy" to "committee",
            "roster" to listOf(member(a, "worker", "w"))))
        assertIs<TeamConfig.Parsed.Invalid>(parse("policy" to "supervisor", "roster" to emptyList<Any>()))
    }

    @Test
    fun `an unresolvable roster name is dropped, not fatal`() {
        val p = assertIs<TeamConfig.Parsed.Valid>(parse(
            "policy" to "supervisor",
            "roster" to listOf(member(a, "supervisor", "s", "nobody"), member(b, "worker", "w")),
        )).config
        /* A whitelist can only get more restrictive by dropping an entry, so a
           typo costs a permission rather than the whole node. */
        assertEquals(emptySet(), p.entry.canDelegateTo)
    }

    @Test
    fun `self-delegation is stripped from a roster`() {
        val p = assertIs<TeamConfig.Parsed.Valid>(parse(
            "policy" to "supervisor",
            "roster" to listOf(member(a, "supervisor", "s", "s", "w"), member(b, "worker", "w")),
        )).config
        assertEquals(setOf(b), p.entry.canDelegateTo)
    }

    @Test
    fun `maxRounds becomes the repeated-handoff bound, for review only`() {
        /*
         * A review round IS the worker sending the same draft to the same reviewer
         * again — the exact triple the §9 guard counts. Resolving it to that guard
         * rather than adding a round counter is invariant 9: a second counter
         * would be a second bound that could disagree with the first.
         */
        val review = assertIs<TeamConfig.Parsed.Valid>(parse(
            "policy" to "review",
            "roster" to listOf(member(a, "worker", "w", "r"), member(b, "reviewer", "r")),
            "limits" to mapOf("maxRounds" to 2),
        )).config
        assertEquals(2, review.limits.maxHandoffsPerPair)

        /* Not for the others: a supervisor asking two different questions of one
           worker is not two rounds of anything. */
        val supervisor = assertIs<TeamConfig.Parsed.Valid>(parse(
            "policy" to "supervisor",
            "roster" to listOf(member(a, "supervisor", "s", "w"), member(b, "worker", "w")),
            "limits" to mapOf("maxRounds" to 2),
        )).config
        assertEquals(TeamLimits.DEFAULT_MAX_HANDOFFS_PER_PAIR, supervisor.limits.maxHandoffsPerPair)
    }

    @Test
    fun `every policy permits exactly the kinds the table says`() {
        assertEquals(setOf(HandoffStore.Kind.TRANSFER), OrchestrationPolicy.ROUTER.permittedKinds)
        assertTrue(OrchestrationPolicy.SUPERVISOR.permits(HandoffStore.Kind.DELEGATE))
        assertTrue(OrchestrationPolicy.SUPERVISOR.permits(HandoffStore.Kind.BROADCAST))
        /* A router that could also delegate would be a supervisor wearing a
           router's name, and the run's shape would stop matching the canvas. */
        assertTrue(!OrchestrationPolicy.ROUTER.permits(HandoffStore.Kind.DELEGATE))
        assertTrue(!OrchestrationPolicy.PIPELINE.permits(HandoffStore.Kind.BROADCAST))
    }
}
