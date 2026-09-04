package com.vectorbea.api.routes

import com.vectorbea.api.routes.ReplayOptions.LoopFacts
import com.vectorbea.api.routes.ReplayOptions.SideEffects
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * What a reader may do to a run, and what it will cost them.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * A user must never be unsure whether an action will email a customer. Which
 * makes two things testable: every option states its side effects before the
 * confirmation, and an option that cannot be offered says WHY.
 *
 * The failure this guards against is specific. "Replay from iteration 4" that
 * quietly replays from 1 because reconstruction was unavailable leaves the
 * reader believing three iterations were restored while the run makes three live
 * model calls — and every conclusion drawn from the result is wrong.
 */
class ReplayOptionsTest {

    private fun facts(
        settled: List<Int> = listOf(1, 2, 3, 4),
        malformed: List<Int> = emptyList(),
        schema: Int = 1,
    ) = LoopFacts(settled, malformed, schema, supportedSchemaVersion = 1)

    private fun options(
        status: String = "failed",
        f: LoopFacts = facts(),
        retryable: Boolean = true,
    ) = ReplayOptions.optionsFor(status, f, f.settledIterations.maxOrNull(), retryable)

    // ── Side-effect profiles ────────────────────────────────────────────────

    /**
     * All four actions, each carrying its profile in words before anything runs.
     *
     * The middle level is why this is not a boolean: a replay from iteration N is
     * recorded up to N and LIVE after it, so "does this have side effects" has no
     * honest yes or no.
     */
    @Test
    fun `every action states what it will do in the world`() {
        val o = options().associateBy { it.id }
        assertEquals(4, o.size)

        assertEquals(SideEffects.NONE, o["replay_run"]!!.sideEffects)
        assertEquals(SideEffects.LIVE_FROM_POINT, o["replay_from_iteration"]!!.sideEffects)
        assertEquals(SideEffects.LIVE_FROM_POINT, o["replay_with_edit"]!!.sideEffects)
        assertEquals(SideEffects.REAL, o["retry_from_step"]!!.sideEffects)

        /* And every one of them says so in a sentence, not just a level. */
        o.values.forEach {
            assertTrue(it.effectSummary.length > 40,
                "${it.id} needs a sentence a reader can act on, not a label")
        }
    }

    /** The safest first, the one with real effects last. */
    @Test
    fun `actions are ordered by increasing consequence`() {
        assertEquals(
            listOf("replay_run", "replay_from_iteration", "replay_with_edit", "retry_from_step"),
            options().map { it.id },
        )
    }

    /** A recorded replay promises, in words, that nothing leaves the system. */
    @Test
    fun `the recorded replay says nothing leaves the system`() {
        val o = options().first { it.id == "replay_run" }
        assertTrue(o.effectSummary.contains("No model is called"))
        assertTrue(o.effectSummary.contains("nothing leaves this system"))
        assertTrue(o.available, "a recorded replay is always available")
    }

    /**
     * The one with real effects names them concretely.
     *
     * "Has side effects" is a category; "sends mail, charges a card" is a
     * sentence somebody stops and reads.
     */
    @Test
    fun `the real retry names what could actually happen`() {
        val o = options().first { it.id == "retry_from_step" }
        assertTrue(o.effectSummary.contains("for real"))
        assertTrue(o.effectSummary.contains("sends mail"))
    }

    // ── ACCEPTANCE: no reconstruction data disables and explains ─────────────

    /**
     * ACCEPTANCE: a run without reconstruction data disables the action and names
     * the reason.
     */
    @Test
    fun `a run with no iterations disables the iteration replay and says why`() {
        val o = options(f = facts(settled = emptyList()))
            .first { it.id == "replay_from_iteration" }

        assertFalse(o.available)
        val why = assertNotNull(o.reason, "a disabled control with no reason is a bug")
        assertTrue(why.contains("no recorded iterations"))
        assertTrue(why.contains("agent step"), "say what WOULD produce them")
    }

    /** A gap in the numbering means a row was lost, and restoring around it lies. */
    @Test
    fun `a gap in the iterations disables the replay and shows the gap`() {
        val o = options(f = facts(settled = listOf(1, 2, 4)))
            .first { it.id == "replay_from_iteration" }
        assertFalse(o.available)
        assertTrue(o.reason!!.contains("gap"))
        assertTrue(o.reason!!.contains("1, 2, 4"), "name the iterations, not just the fault")
    }

    /** Loop state from a newer worker cannot be rebuilt by this build. */
    @Test
    fun `a newer loop format disables the replay and names both versions`() {
        val o = options(f = facts(schema = 2)).first { it.id == "replay_from_iteration" }
        assertFalse(o.available)
        assertTrue(o.reason!!.contains("format 2"))
        assertTrue(o.reason!!.contains("this build reads 1"))
    }

    /** An unreadable action means the loop cannot be continued from that point. */
    @Test
    fun `a malformed iteration disables the replay and names the iteration`() {
        val o = options(f = facts(malformed = listOf(3)))
            .first { it.id == "replay_from_iteration" }
        assertFalse(o.available)
        assertTrue(o.reason!!.contains("Iteration 3"))
    }

    /** With a clean transcript it is offered, with no reason attached. */
    @Test
    fun `a clean transcript offers the replay with no reason`() {
        val o = options().first { it.id == "replay_from_iteration" }
        assertTrue(o.available)
        assertNull(o.reason, "an available action must not carry an excuse")
        assertTrue(o.effectSummary.contains("1 to 3"),
            "say which iterations can be restored, since 4 is the last settled one")
    }

    /**
     * The edit replay shares the loop's eligibility, because it is the same path.
     *
     * Offering one and not the other would imply they use different machinery.
     */
    @Test
    fun `the edit replay is available exactly when the iteration replay is`() {
        for (f in listOf(facts(), facts(settled = emptyList()), facts(schema = 9))) {
            val o = ReplayOptions.optionsFor("failed", f, f.settledIterations.maxOrNull(), true)
                .associateBy { it.id }
            assertEquals(
                o["replay_from_iteration"]!!.available,
                o["replay_with_edit"]!!.available,
                "they run the same reconstruction, so they cannot disagree",
            )
        }
    }

    // ── Retry eligibility ───────────────────────────────────────────────────

    /** A running run cannot be retried, and the reason names its status. */
    @Test
    fun `a non-retryable run disables the retry and names the status`() {
        val o = options(status = "running", retryable = false)
            .first { it.id == "retry_from_step" }
        assertFalse(o.available)
        assertTrue(o.reason!!.contains("'running'"))
    }

    /** The recorded replay stays available even when nothing else is. */
    @Test
    fun `the safest action survives every blocker`() {
        val o = options(status = "running", f = facts(settled = emptyList()), retryable = false)
            .first { it.id == "replay_run" }
        assertTrue(o.available)
    }

    // ── The blocker rules in isolation ──────────────────────────────────────

    /**
     * Order matters: a run with NO iterations and an unreadable one should report
     * the absence, not the corruption. The worker applies them in this order too,
     * and a UI that offers an action the worker refuses is worse than one that
     * never offered it — the reader spends a run to find out.
     */
    @Test
    fun `the blockers are reported in the worker's own order`() {
        assertTrue(ReplayOptions.loopReplayBlocker(
            facts(settled = emptyList(), malformed = listOf(1)))!!
            .contains("no recorded iterations"))

        assertTrue(ReplayOptions.loopReplayBlocker(
            facts(settled = listOf(1, 3), schema = 5))!!
            .contains("newer version"), "the version check precedes the gap check")
    }

    @Test
    fun `a clean transcript has no blocker`() {
        assertNull(ReplayOptions.loopReplayBlocker(facts()))
    }
}
