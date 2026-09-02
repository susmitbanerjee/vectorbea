package com.vectorbea.api.routes

import com.vectorbea.api.routes.TraceRoutes.Companion.RunFacts
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Four states, and the one that used to be wrong.
 *
 * ── THE BUG ─────────────────────────────────────────────────────────────────
 * The Debug tab showed an amber banner reading, roughly, "spans were dropped
 * while the writer was under pressure" — on a run the same page called complete
 * and successful. It came from one boolean, `traceComplete`, computed as "no run
 * span is still running". That answers "has the run finished". It carries no
 * information about drops at all, and it was false on healthy finished runs
 * because the run span was written twice and the open row never went away.
 *
 * A warning that fires on healthy runs is worse than no warning: it teaches
 * people that amber means nothing, so the next one is ignored too.
 *
 * These are the four acceptance criteria, one test each.
 */
class TraceCompletenessTest {

    private fun state(m: Map<String, Any?>) = m["state"] as String
    private fun dropped(m: Map<String, Any?>) = m["droppedSpans"] as Int
    private fun reason(m: Map<String, Any?>) = m["reason"] as String?

    /** ACCEPTANCE 1: a healthy completed run shows no banner at all. */
    @Test
    fun `a healthy completed run is complete and says nothing`() {
        val c = TraceRoutes.completeness(RunFacts("succeeded", 0), droppedSpans = 0, spanCount = 42)
        assertEquals("complete", state(c))
        assertNull(reason(c), "complete must carry no message — the UI renders nothing for it")
    }

    /** ACCEPTANCE 2: forced buffer pressure shows partial, with the REAL count. */
    @Test
    fun `dropped spans make it partial and name the number`() {
        val c = TraceRoutes.completeness(RunFacts("succeeded", 16), droppedSpans = 16, spanCount = 42)
        assertEquals("partial", state(c))
        assertEquals(16, dropped(c))
        assertTrue(reason(c)!!.contains("16"),
            "the count is the whole point — 'some spans are missing' is unactionable")
    }

    /** ACCEPTANCE 3: an in-progress run is `live`, and live is not a warning. */
    @Test
    fun `a running run is live, not a warning`() {
        val c = TraceRoutes.completeness(RunFacts("running", 0), droppedSpans = 0, spanCount = 7)
        assertEquals("live", state(c))
        assertEquals(0, dropped(c), "a live run has lost nothing; it has simply not finished")
    }

    /**
     * A trace that could not be read is NOT a trace with nothing in it.
     *
     * Rendering an empty tree as the answer says "this run did nothing", which is
     * a different and much more misleading claim than "we could not load this".
     */
    @Test
    fun `an unreadable run is unavailable, not empty`() {
        val c = TraceRoutes.completeness(null, droppedSpans = 0, spanCount = 0)
        assertEquals("unavailable", state(c))
        assertTrue(reason(c)!!.isNotBlank())
    }

    /**
     * Drops outrank everything, including still-running.
     *
     * A live run that has already lost spans must not be reported as merely live:
     * the loss is permanent and the reader is looking at a hole right now.
     */
    @Test
    fun `drops on a still-running run are reported, not deferred`() {
        val c = TraceRoutes.completeness(RunFacts("running", 3), droppedSpans = 3, spanCount = 7)
        assertEquals("partial", state(c))
    }

    /** A finished run with no spans at all is partial, never complete. */
    @Test
    fun `a finished run with no spans is partial`() {
        val c = TraceRoutes.completeness(RunFacts("succeeded", 0), droppedSpans = 0, spanCount = 0)
        assertEquals("partial", state(c),
            "an empty tree presented as complete asserts that nothing happened")
    }

    /**
     * Every terminal status is terminal — and an unknown one is not.
     *
     * `ceiling_exceeded` is the one that matters here: invariant 6 says a ceiling
     * breach is not a failure, and its trace is as complete as any success. If it
     * were missing from the set it would read `live` forever.
     *
     * Failing OPEN on an unknown status is deliberate. A status added later shows
     * "still going" until this set is updated, which is wrong but harmless; the
     * other default would claim a trace is complete when more spans are coming.
     */
    @Test
    fun `every terminal status settles, and an unknown one does not`() {
        listOf("succeeded", "failed", "cancelled", "timeout",
               "ceiling_exceeded", "continued_as_new", "handed_off").forEach {
            assertEquals("complete", state(TraceRoutes.completeness(RunFacts(it, 0), 0, 5)),
                "'$it' is terminal — its trace is finished")
        }
        listOf("running", "queued", "suspended", "some_status_invented_in_2027").forEach {
            assertEquals("live", state(TraceRoutes.completeness(RunFacts(it, 0), 0, 5)),
                "'$it' must fail open to live rather than claim completeness")
        }
    }

    /**
     * The old boolean, on the old data, produced the banner. Kept as the
     * regression: this is the exact input that was showing amber on a good run.
     */
    @Test
    fun `the shape that used to show a false warning now shows nothing`() {
        /* Successful run, 42 spans, zero drops — a duplicated open run span made
           `traceComplete` false and the page blamed buffer pressure. */
        assertEquals("complete",
            state(TraceRoutes.completeness(RunFacts("succeeded", 0), 0, 42)))
    }
}
