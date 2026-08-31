package com.vectorbea.worker.agents.context

import com.vectorbea.worker.agents.context.ContextAssembler.Part
import com.vectorbea.worker.agents.context.ContextAssembler.Section
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The assembler, exhaustively — it is pure, so there is no excuse not to be.
 *
 * The assertions that matter are the two the design turns on: the objective and
 * the inputs are never dropped, and every drop is named. Everything else is
 * arithmetic.
 */
class ContextAssemblerTest {

    private fun part(section: Section, size: Int, fill: Char = 'x') =
        Part(section, fill.toString().repeat(size))

    // ── Priority order ───────────────────────────────────────────────────────

    @Test
    fun `sections are emitted in priority order regardless of input order`() {
        val out = ContextAssembler.assemble(
            listOf(
                Part(Section.OBSERVATIONS, "obs"),
                Part(Section.OBJECTIVE, "do the thing"),
                Part(Section.BLACKBOARD, "bb"),
                Part(Section.INPUTS, "in"),
            ),
            charBudget = 10_000,
        )

        assertEquals(
            listOf("OBJECTIVE", "INPUTS", "BLACKBOARD", "OBSERVATIONS"),
            out.includedSections,
            "a prompt whose section order depends on the caller's map iteration is a " +
            "prompt that changes between attempts for no reason",
        )
        assertTrue(out.text.indexOf("TASK:") < out.text.indexOf("INPUT DATA:"))
        assertTrue(out.text.indexOf("INPUT DATA:") < out.text.indexOf("SHARED CONTEXT:"))
    }

    @Test
    fun `several parts may share a section and keep caller order`() {
        val out = ContextAssembler.assemble(
            listOf(
                Part(Section.OBSERVATIONS, "first"),
                Part(Section.OBSERVATIONS, "second"),
            ),
            charBudget = 10_000,
        )
        assertTrue(out.text.indexOf("first") < out.text.indexOf("second"),
            "observations are chronological — reordering them changes their meaning")
    }

    @Test
    fun `empty and blank parts contribute nothing`() {
        val out = ContextAssembler.assemble(
            listOf(
                Part(Section.OBJECTIVE, "task"),
                Part(Section.MEMORY, "   "),
                Part(Section.BLACKBOARD, ""),
            ),
            charBudget = 10_000,
        )
        assertEquals(listOf("OBJECTIVE"), out.includedSections,
            "an empty section heading tells the model there is a section and then " +
            "shows it nothing, which is worse than its absence")
    }

    @Test
    fun `the same input assembles to the same bytes`() {
        val parts = listOf(
            Part(Section.OBJECTIVE, "task"), Part(Section.MEMORY, "m"),
            Part(Section.OBSERVATIONS, "o"), Part(Section.INPUTS, "i"),
        )
        assertEquals(
            ContextAssembler.assemble(parts, 10_000).text,
            ContextAssembler.assemble(parts.shuffled(), 10_000).text,
            "a resumed tick must rebuild the same prompt, or 'the prompt changed' " +
            "stops being a signal",
        )
    }

    // ── Dropping ─────────────────────────────────────────────────────────────

    @Test
    fun `an oversized context drops the lowest-priority section first`() {
        val out = ContextAssembler.assemble(
            listOf(
                part(Section.OBJECTIVE, 100),
                part(Section.INPUTS, 100),
                part(Section.MEMORY, 100),
                part(Section.OBSERVATIONS, 100),
            ),
            /* Room for three of the four, plus headings and separators. */
            charBudget = 380,
        )

        assertTrue(out.truncated)
        assertEquals(listOf("OBSERVATIONS"), out.droppedSections,
            "dropping must start at the BOTTOM — the priority order is the whole design")
        assertContains(out.includedSections, "MEMORY")
        assertFalse(out.overBudget)
        assertTrue(out.charsUsed <= 380)
    }

    @Test
    fun `it keeps dropping upward until it fits`() {
        val out = ContextAssembler.assemble(
            listOf(
                part(Section.OBJECTIVE, 50),
                part(Section.INPUTS, 50),
                part(Section.MEMORY, 500),
                part(Section.BLACKBOARD, 500),
                part(Section.HANDOFFS, 500),
                part(Section.OBSERVATIONS, 500),
            ),
            charBudget = 200,
        )

        assertEquals(
            listOf("OBSERVATIONS", "HANDOFFS", "BLACKBOARD", "MEMORY"),
            out.droppedSections,
            "the order of the drops is itself the diagnosis — it says how far the " +
            "budget was from covering the context",
        )
        assertEquals(listOf("OBJECTIVE", "INPUTS"), out.includedSections)
    }

    @Test
    fun `the objective and the inputs are never dropped`() {
        val out = ContextAssembler.assemble(
            listOf(
                part(Section.OBJECTIVE, 5_000),
                part(Section.INPUTS, 5_000),
                part(Section.OBSERVATIONS, 5_000),
            ),
            charBudget = 100,
        )

        assertContains(out.includedSections, "OBJECTIVE")
        assertContains(out.includedSections, "INPUTS")
        assertTrue(out.overBudget,
            "going over is the correct outcome here: an agent given half its task " +
            "answers confidently and wrongly, while an oversized prompt fails at the " +
            "provider with a message that names the real problem")
        assertTrue(out.charsUsed > out.charBudget)
    }

    @Test
    fun `nothing is dropped when it already fits`() {
        val out = ContextAssembler.assemble(
            listOf(part(Section.OBJECTIVE, 10), part(Section.OBSERVATIONS, 10)),
            charBudget = 10_000,
        )
        assertFalse(out.truncated)
        assertFalse(out.overBudget)
        assertTrue(out.droppedSections.isEmpty())
    }

    @Test
    fun `an empty context is not truncated`() {
        val out = ContextAssembler.assemble(emptyList(), charBudget = 100)
        assertEquals("", out.text)
        assertEquals(0, out.charsUsed)
        assertFalse(out.truncated)
        assertFalse(out.overBudget)
    }

    // ── The bookkeeping, which is the point ──────────────────────────────────

    @Test
    fun `a truncation names what it dropped in the span attributes`() {
        val out = ContextAssembler.assemble(
            listOf(part(Section.OBJECTIVE, 50), part(Section.OBSERVATIONS, 5_000)),
            charBudget = 200,
        )
        val attrs = out.spanAttributes()

        assertEquals(true, attrs["context_truncated"])
        assertEquals(listOf("OBSERVATIONS"), attrs["context_dropped_sections"])
        assertEquals(out.charsUsed, attrs["context_chars"])
        assertEquals(200, attrs["context_char_budget"])
        /* An agent that "ignored" an instruction it was never shown is the hardest
           agent failure to diagnose. This attribute is the entire fix. */
        assertTrue(out.attributesJson().contains("context_dropped_sections"))
    }

    @Test
    fun `an untruncated context says so without listing an empty drop list`() {
        val attrs = ContextAssembler
            .assemble(listOf(part(Section.OBJECTIVE, 10)), charBudget = 10_000)
            .spanAttributes()

        assertEquals(false, attrs["context_truncated"])
        assertFalse(attrs.containsKey("context_dropped_sections"),
            "an empty list on every span is noise on every span")
        assertFalse(attrs.containsKey("context_over_budget"))
    }

    @Test
    fun `going over budget is recorded separately from truncating`() {
        val attrs = ContextAssembler
            .assemble(listOf(part(Section.OBJECTIVE, 5_000)), charBudget = 100)
            .spanAttributes()

        /* Nothing was dropped — there was nothing droppable — but the budget was
           still blown. Two different situations, two different attributes: one
           says "the model did not see everything", the other says "the provider
           may refuse this". */
        assertEquals(false, attrs["context_truncated"])
        assertEquals(true, attrs["context_over_budget"])
    }
}
