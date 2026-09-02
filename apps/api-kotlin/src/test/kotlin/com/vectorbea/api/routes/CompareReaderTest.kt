package com.vectorbea.api.routes

import com.vectorbea.api.routes.CompareReader.Span
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * "It worked yesterday", answered.
 *
 * ── WHY THE DIVERGENCE POINT IS THE ONLY OUTPUT THAT MATTERS ────────────────
 * Two runs of one workflow part company ONCE and then differ in everything
 * downstream. A view that lists twelve deltas equally has buried its answer in
 * its own symptoms; the reply is the first node that differs.
 *
 * Which makes the definition of "differs" the whole design. Too loose — tokens,
 * every duration — and the answer lands on the first span of every comparison
 * and the feature is useless. Too tight, and the commonest cause of all, a tool
 * returning something else, is invisible.
 */
class CompareReaderTest {

    private fun span(
        step: String,
        kind: String = "tool_call",
        name: String = step,
        status: String = "ok",
        ms: Int? = 100,
        tokens: Long = 0,
        cost: Double = 0.0,
        model: String? = null,
        outputRef: String? = null,
        inputRef: String? = null,
        contextChars: Int? = null,
        iteration: Int? = null,
    ) = Span(step, kind, name, status, ms, tokens, cost, model, iteration,
             inputRef, outputRef, contextChars)

    private fun compare(a: List<Span>, b: List<Span>, sameRun: Boolean = false) =
        CompareReader.compare(a, b, "v1", "v1", sameRun)

    // ── ACCEPTANCE: a different tool response is the divergence ──────────────

    /**
     * ACCEPTANCE: two runs differing only in a tool response identify that tool
     * call as the divergence point.
     *
     * The signal is `output_ref` — a SHA-256 of the content — so a different ref
     * is a different RESULT, established without moving a byte of payload. The
     * first implementation compared only presence and could not see this at all,
     * which left the commonest cause of "it worked yesterday" invisible.
     */
    @Test
    fun `a tool that returned something else is the divergence point`() {
        val a = listOf(
            span("fetch", outputRef = "aaa111"),
            span("crm.search", outputRef = "OLD-CONTENT-HASH"),
            span("notify", outputRef = "ccc333"),
        )
        val b = listOf(
            span("fetch", outputRef = "aaa111"),
            span("crm.search", outputRef = "NEW-CONTENT-HASH"),
            span("notify", outputRef = "ccc333"),
        )

        val c = compare(a, b)
        assertNotNull(c.divergenceKey)
        assertTrue(c.divergenceKey!!.startsWith("crm.search|"),
            "the divergence is the tool call, not the node after it: ${c.divergenceKey}")

        val node = c.nodes.single { it.key == c.divergenceKey }
        val d = node.deltas.single { it.field == "outputRef" }
        assertTrue(d.note!!.contains("returned different content"))
        /* Everything else matched, so nothing else is divergent. */
        assertEquals(1, c.nodes.count { it.divergent })
    }

    /** Different INPUT points upstream, and says so. */
    @Test
    fun `a node called with different input says the cause is upstream`() {
        val c = compare(
            listOf(span("summarise", kind = "llm_call", inputRef = "prompt-a")),
            listOf(span("summarise", kind = "llm_call", inputRef = "prompt-b")),
        )
        val d = c.nodes.single().deltas.single { it.field == "inputRef" }
        assertTrue(d.note!!.contains("upstream"))
        assertTrue(c.nodes.single().divergent)
    }

    // ── ACCEPTANCE: across versions, refuse ──────────────────────────────────

    /**
     * ACCEPTANCE: comparing across versions refuses and explains.
     *
     * Not "diffs with a warning on top". Across versions every difference has
     * two possible causes — the workflow changed, or the run behaved differently
     * — and the diff cannot tell them apart. Shown anyway it reads as a
     * behaviour change and sends somebody hunting a flaky tool when a colleague
     * edited a prompt.
     */
    @Test
    fun `comparing across versions refuses, explains, and offers the version diff`() {
        val c = CompareReader.compare(
            a = listOf(span("fetch", status = "ok")),
            b = listOf(span("fetch", status = "error")),
            versionA = "v1", versionB = "v2", sameRun = false,
        )

        val r = assertNotNull(c.refusal, "an across-version comparison must refuse")
        assertEquals("different workflow versions", r.reason)
        assertTrue(r.explanation.contains("two possible causes"))
        assertTrue(r.offer.contains("workflow versions"))

        /* And produces NO diff — a refusal that still shows the deltas has
           refused nothing. */
        assertTrue(c.nodes.isEmpty())
        assertNull(c.divergenceKey)
        assertFalse(c.sameVersion)
    }

    /** A null version on either side is not the same version. */
    @Test
    fun `an unknown version refuses rather than assuming a match`() {
        val c = CompareReader.compare(
            listOf(span("a")), listOf(span("a")), null, null, sameRun = false)
        assertNotNull(c.refusal)
    }

    // ── ACCEPTANCE: a run against itself ─────────────────────────────────────

    /**
     * ACCEPTANCE: comparing a run to itself shows no divergence.
     *
     * A degenerate case worth pinning, because "no divergence" and "could not
     * compare" render very differently and the reader has to be able to trust
     * the first.
     */
    @Test
    fun `a run compared with itself has no divergence`() {
        val spans = listOf(
            span("fetch", ms = 120, outputRef = "x"),
            span("crm.search", ms = 2_400, status = "error", outputRef = "y"),
            span("notify", ms = 40),
        )
        val c = compare(spans, spans, sameRun = true)

        assertNull(c.divergenceKey, "a run is identical to itself")
        assertEquals(0, c.onlyInA)
        assertEquals(0, c.onlyInB)
        assertTrue(c.nodes.none { it.divergent })
        assertTrue(c.nodes.all { it.deltas.isEmpty() })
    }

    /** Self-comparison is allowed even when the version lookup returns one row. */
    @Test
    fun `a self comparison is never refused`() {
        val c = CompareReader.compare(
            listOf(span("a")), listOf(span("a")), "v1", null, sameRun = true)
        assertNull(c.refusal)
    }

    // ── What counts as a divergence ──────────────────────────────────────────

    /** A status change is the clearest divergence there is. */
    @Test
    fun `a status change is a divergence`() {
        val c = compare(
            listOf(span("a"), span("boom", status = "error")),
            listOf(span("a"), span("boom", status = "ok")),
        )
        assertTrue(c.divergenceKey!!.startsWith("boom|"))
    }

    /**
     * Tokens alone are NOT a divergence.
     *
     * They wobble between two identical runs. Treating them as divergent puts
     * the answer on the first model call of every comparison, which is the same
     * as having no answer.
     */
    @Test
    fun `token and cost wobble is reported but never divergent`() {
        val c = compare(
            listOf(span("llm", kind = "llm_call", tokens = 1_000, cost = 2.0)),
            listOf(span("llm", kind = "llm_call", tokens = 1_040, cost = 2.1)),
        )
        assertNull(c.divergenceKey, "a 4% token difference is not why it worked yesterday")
        val fields = c.nodes.single().deltas.map { it.field }
        assertTrue(fields.containsAll(listOf("tokens", "costCents")), "still reported: $fields")
    }

    /**
     * A duration change needs to clear BOTH floors.
     *
     * Absolute alone flags every 300ms wobble on a four-minute span; relative
     * alone flags a 2ms span that took 6ms.
     */
    @Test
    fun `a duration change needs both an absolute and a relative move`() {
        /* 300ms on a 40s span: big in isolation, 0.75% in context. */
        assertFalse(CompareReader.movedEnough(40_000, 40_300))
        /* 4ms on a 2ms span: 200%, but nobody cares. */
        assertFalse(CompareReader.movedEnough(2, 6))
        /* 200ms to 2s: both floors cleared. */
        assertTrue(CompareReader.movedEnough(200, 2_000))
    }

    /** A model swap is a divergence whatever else matches. */
    @Test
    fun `a different model is a divergence`() {
        val c = compare(
            listOf(span("llm", kind = "llm_call", model = "gpt-4o")),
            listOf(span("llm", kind = "llm_call", model = "gpt-4o-mini")),
        )
        assertNotNull(c.divergenceKey)
        assertTrue(c.nodes.single().deltas.single { it.field == "model" }
            .note!!.contains("different model"))
    }

    /** A longer prompt is reported with its direction, and is not itself divergent. */
    @Test
    fun `a longer context is reported with its direction`() {
        val c = compare(
            listOf(span("llm", kind = "llm_call", contextChars = 12_400)),
            listOf(span("llm", kind = "llm_call", contextChars = 8_100)),
        )
        val d = c.nodes.single().deltas.single { it.field == "contextChars" }
        assertTrue(d.note!!.contains("longer"))
        assertNull(c.divergenceKey, "a longer prompt is evidence, not the parting point")
    }

    // ── Presence ────────────────────────────────────────────────────────────

    /** A node in one run and not the other is a divergence, and it is counted. */
    @Test
    fun `a node present in only one run diverges`() {
        val c = compare(
            listOf(span("a"), span("escalate"), span("z")),
            listOf(span("a"), span("z")),
        )
        assertTrue(c.divergenceKey!!.startsWith("escalate|"))
        assertEquals(1, c.onlyInA)
        assertEquals(0, c.onlyInB)
        assertEquals("onlyA", c.nodes.single { it.key.startsWith("escalate|") }.presence)
    }

    /** Extras in B are found too, so the comparison is symmetric. */
    @Test
    fun `a node only in the other run is also reported`() {
        val c = compare(listOf(span("a")), listOf(span("a"), span("extra")))
        assertEquals(1, c.onlyInB)
        assertEquals("onlyB", c.nodes.single { it.key.startsWith("extra|") }.presence)
    }

    /**
     * A node that ran three times is matched occurrence by occurrence.
     *
     * Keying on the step alone would match attempt 1 against attempt 1 and drop
     * the rest, so "the retry loop got longer" would read as "nothing changed".
     */
    @Test
    fun `repeated executions are matched one for one`() {
        val c = compare(
            listOf(span("flaky"), span("flaky"), span("flaky")),
            listOf(span("flaky")),
        )
        assertEquals(2, c.onlyInA, "two extra attempts, not zero")
    }

    // ── The order of the answer ─────────────────────────────────────────────

    /**
     * The divergence is the FIRST difference in execution order, not the worst.
     *
     * Everything after it is downstream of it; leading with a later, louder
     * delta points at a symptom.
     */
    @Test
    fun `the divergence is the earliest difference, not the largest`() {
        val c = compare(
            listOf(
                span("one", outputRef = "a"),
                span("two", status = "error", ms = 60_000),
            ),
            listOf(
                span("one", outputRef = "b"),
                span("two", status = "ok", ms = 100),
            ),
        )
        assertTrue(c.divergenceKey!!.startsWith("one|"),
            "the loud failure at 'two' is downstream of the quiet change at 'one'")
    }

    /** Two identical runs of the same version have nothing to report. */
    @Test
    fun `identical runs report no divergence and no deltas`() {
        val spans = listOf(span("a", ms = 10), span("b", ms = 20))
        val c = compare(spans, spans.map { it.copy() })
        assertNull(c.divergenceKey)
        assertTrue(c.nodes.all { it.deltas.isEmpty() })
    }

    /** An empty run against a full one is all-presence, and does not throw. */
    @Test
    fun `an empty run compares without failing`() {
        val c = compare(emptyList(), listOf(span("a")))
        assertEquals(1, c.onlyInB)
        assertNotNull(c.divergenceKey)
    }
}
