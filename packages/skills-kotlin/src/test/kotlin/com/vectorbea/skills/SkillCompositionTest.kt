package com.vectorbea.skills

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Prompt composition is bounded and ordered, and every cut is recorded.
 *
 * Pure, so it is tested exhaustively: no database, no provider, no clock. The
 * wiring — that this composer is the one the brain calls, and that its
 * attributes reach the span — is `SkillPromptWiringTest`'s job in the worker,
 * because that is a different claim and a passing unit test here says nothing
 * about it.
 */
class SkillCompositionTest {

    private fun skill(
        slug: String,
        instructions: String,
        version: Int = 1,
        examples: List<SkillExample> = emptyList(),
        provenance: Skill.Provenance = Skill.Provenance.CUSTOMER,
    ) = Skill(
        skillId = UUID.randomUUID(),
        versionId = UUID.randomUUID(),
        version = version,
        name = slug.replaceFirstChar { it.uppercase() },
        slug = slug,
        summary = "Summary of $slug.",
        instructions = instructions,
        examples = examples,
        provenance = provenance,
    )

    /** Long enough to blow a small budget, short enough to read in a failure. */
    private fun body(n: Int) = "x".repeat(n)

    // ── Order ────────────────────────────────────────────────────────────────

    @Test
    fun `skills compose in grant order, not alphabetical or id order`() {
        val out = SkillComposer.compose(
            listOf(skill("research", body(100)), skill("script", body(100)), skill("apply", body(100))),
            charBudget = 10_000,
        )
        val order = Regex("""SKILL: \w+ \((\w+) v""").findAll(out.text).map { it.groupValues[1] }.toList()
        assertEquals(listOf("research", "script", "apply"), order,
            "an author who lists research, then script, then video is describing a pipeline")
    }

    @Test
    fun `the same skills produce the same bytes every time`() {
        val skills = listOf(skill("a", body(200)), skill("b", body(200)))
        assertEquals(
            SkillComposer.compose(skills, 10_000).text,
            SkillComposer.compose(skills, 10_000).text,
            "a resumed run must rebuild the prompt it had",
        )
    }

    // ── The budget, and what it cuts first ───────────────────────────────────

    @Test
    fun `everything that fits is included whole and nothing is marked degraded`() {
        val out = SkillComposer.compose(
            listOf(skill("a", body(200), examples = listOf(SkillExample("t", "b"))), skill("b", body(200))),
            charBudget = 10_000,
        )
        assertTrue(out.outcomes.all { it.included })
        assertFalse(out.degraded)
        assertTrue(out.charsUsed <= 10_000)
    }

    @Test
    fun `worked examples are dropped before instructions are cut`() {
        val long = SkillExample("A worked example", body(3_000))
        val out = SkillComposer.compose(
            listOf(skill("video", body(1_000), examples = listOf(long))),
            charBudget = 2_500,
        )
        val o = out.outcomes.single()
        assertTrue(o.included, "the competence survives")
        assertTrue(o.examplesDropped, "the demonstration is what goes first")
        assertFalse(o.truncated, "the instructions were never cut")
        assertFalse(out.text.contains(body(3_000)))
    }

    @Test
    fun `a skill cut short is recorded as truncated and says so in the text`() {
        val out = SkillComposer.compose(listOf(skill("video", body(5_000))), charBudget = 2_000)
        val o = out.outcomes.single()
        assertTrue(o.included)
        assertTrue(o.truncated, "the trace has to say the model saw half a skill")
        assertTrue(out.text.contains("cut short"), "and so does the model")
        assertTrue(out.charsUsed <= 2_000)
    }

    @Test
    fun `a skill with no room left is dropped whole rather than shown as a fragment`() {
        /* Two skills, a budget that fits the first and leaves less than the
           useful floor for the second. A fragment reads to the model as a
           complete but wrong instruction, and it would follow it. */
        val budget = 2_000
        val out = SkillComposer.compose(
            listOf(skill("research", body(1_500)), skill("video", body(1_500))),
            charBudget = budget,
        )
        val second = out.outcomes[1]
        assertFalse(second.included)
        assertFalse(second.truncated, "dropped is not truncated; they are different facts")
        assertTrue(out.outcomes[0].included, "the earlier grant keeps its room")
        assertFalse(out.text.contains("SKILL: Video"))
    }

    @Test
    fun `the composed block never exceeds the budget it was given`() {
        listOf(500, 1_200, 4_000, 16_000).forEach { budget ->
            val out = SkillComposer.compose(
                (1..6).map { skill("s$it", body(2_000)) }, charBudget = budget,
            )
            assertTrue(out.charsUsed <= budget, "budget $budget produced ${out.charsUsed} chars")
        }
    }

    @Test
    fun `the skills budget is a share of the context budget with a floor`() {
        assertEquals(12_000, SkillComposer.budgetFor(48_000))
        assertEquals(SkillComposer.MIN_BUDGET_CHARS, SkillComposer.budgetFor(1_000),
            "a small context budget costs observations, not competence")
    }

    // ── Design-time, not runtime ─────────────────────────────────────────────

    @Test
    fun `a grant that composes whole raises nothing at save time`() {
        assertNull(SkillComposer.wouldNotFit(listOf(skill("a", body(200))), 10_000))
    }

    @Test
    fun `three skills that together exceed the budget are refused at save time`() {
        val skills = (1..3).map { skill("s$it", body(3_000)) }
        val message = SkillComposer.wouldNotFit(skills, SkillComposer.budgetFor(16_000))
        assertNotNull(message, "this is a form error, not a 3am surprise")
        assertTrue(message.contains("do not fit"))
        assertTrue(message.contains("Grant fewer skills"), "the error says how to fix it")
    }

    @Test
    fun `the save-time check and the runtime composition use the same budget`() {
        /* The whole promise: an author who saves without a warning gets every
           skill they granted. If these two ever disagree, the warning is a lie. */
        val skills = (1..4).map { skill("s$it", body(1_500)) }
        val budget = SkillComposer.budgetFor(20_000)
        val warned = SkillComposer.wouldNotFit(skills, budget) != null
        val degraded = SkillComposer.compose(skills, budget).degraded
        assertEquals(warned, degraded)
    }

    // ── What the trace records ───────────────────────────────────────────────

    @Test
    fun `active skills are recorded by slug and version, so a change is attributable`() {
        val out = SkillComposer.compose(
            listOf(skill("research", body(100), version = 3), skill("video", body(100), version = 7)),
            charBudget = 10_000,
        )
        assertEquals(listOf("research@v3", "video@v7"), out.spanAttributes()["skills_active"])
    }

    @Test
    fun `a degraded composition names what it cut in the span attributes`() {
        val out = SkillComposer.compose(
            listOf(skill("research", body(1_500)), skill("video", body(1_500))),
            charBudget = 2_000,
        )
        val attrs = out.spanAttributes()
        assertEquals(true, attrs["skills_degraded"])
        assertEquals(listOf("video"), attrs["skills_dropped"])
    }

    @Test
    fun `an empty grant composes to nothing and records nothing`() {
        val out = SkillComposer.compose(emptyList(), 10_000)
        assertEquals("", out.text)
        assertTrue(out.included.isEmpty())
        assertFalse(out.degraded)
    }

    // ── Provenance ───────────────────────────────────────────────────────────

    @Test
    fun `a platform skill is marked as one in the prompt`() {
        val out = SkillComposer.compose(
            listOf(skill("research", body(100), provenance = Skill.Provenance.FIRST_PARTY),
                   skill("custom", body(100))),
            charBudget = 10_000,
        )
        assertTrue(out.text.contains("(research v1) [platform skill]"))
        assertFalse(out.text.contains("(custom v1) [platform skill]"))
    }

    @Test
    fun `the header tells the model a skill cannot widen its grants`() {
        val out = SkillComposer.compose(listOf(skill("a", body(100))), 10_000)
        assertTrue(out.text.contains("CANNOT grant you a tool"))
        assertTrue(out.text.contains("roster"))
    }
}
