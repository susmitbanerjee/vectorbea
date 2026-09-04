package com.vectorbea.worker.agents.brain.prompts

import com.vectorbea.worker.agents.brain.model.AgentBudget
import com.vectorbea.worker.agents.brain.model.AgentLoopState
import com.vectorbea.worker.agents.brain.model.AgentObservation
import com.vectorbea.worker.testsupport.AgentBrainFixture
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The seam between the loop and [com.vectorbea.worker.agents.context.ContextAssembler].
 *
 * The assembler is tested exhaustively on its own; what is tested here is the
 * one thing that cannot be: that turning the flag OFF leaves the prompt exactly
 * as it has always been. A context change is invisible in every artefact except
 * the model's answer, so "we did not change the prompt" is a claim that has to
 * be an assertion rather than an intention.
 */
class AssembledPromptTest {

    private fun state(
        cfg: com.vectorbea.worker.agents.brain.model.AgentBrainConfig,
        observations: Int = 0,
        memory: Int = 0,
    ): AgentLoopState {
        val s = AgentLoopState(
            config = cfg,
            budget = AgentBudget(
                maxIterations = cfg.maxIterations,
                maxToolCalls = cfg.maxToolCalls,
                maxTotalTokens = 100_000,
                maxCostCents = 50,
                timeoutMs = 60_000,
            )
        )
        repeat(observations) { n ->
            s.addObservation(AgentObservation(n + 1, "THINK", sanitizedSummary = "thought $n"))
        }
        repeat(memory) { n -> s.addMemory("key$n", "value $n") }
        return s
    }

    // ── The flag off ─────────────────────────────────────────────────────────

    @Test
    fun `the flag off produces byte-identical output to the prompt that shipped`() {
        val f = AgentBrainFixture()
        val cfg = f.config()
        val st = state(cfg, observations = 3, memory = 2)

        val legacy = AgentPromptBuilder.buildUserPrompt(cfg, st)
        val built = AgentPromptBuilder.buildUserPromptDetailed(cfg, st, enabled = false)

        assertEquals(legacy, built.text,
            "a context change is invisible in every artefact except the model's " +
            "answer, so the unchanged path has to be asserted, not assumed")
        assertNull(built.assembly,
            "null is how the caller knows there is nothing to record, as opposed to " +
            "recording 'nothing was dropped'")
    }

    // ── The flag on ──────────────────────────────────────────────────────────

    @Test
    fun `the flag on carries the same information in the documented order`() {
        val f = AgentBrainFixture()
        val cfg = f.config(taskInstruction = "Summarise the ticket.")
        val st = state(cfg, observations = 2, memory = 1)

        val built = AgentPromptBuilder.buildUserPromptDetailed(cfg, st, enabled = true)
        val text = built.text

        assertContains(text, "Summarise the ticket.")
        assertContains(text, "value 0")
        assertContains(text, "thought 1")

        /* §7's priority order, which is also the drop order. */
        assertTrue(text.indexOf("TASK:") < text.indexOf("WORKING MEMORY:"))
        assertTrue(text.indexOf("WORKING MEMORY:") < text.indexOf("PREVIOUS OBSERVATIONS:"))
        assertContains(text, "Return your next action as JSON:")

        val a = assertNotNull(built.assembly)
        assertFalse(a.truncated)
    }

    @Test
    fun `an oversized context drops observations and says so, keeping the task`() {
        val f = AgentBrainFixture()
        val cfg = f.config(taskInstruction = "Summarise the ticket.")
        val st = state(cfg)
        /* One enormous observation — a tool that returned a page of JSON. */
        st.addObservation(AgentObservation(1, "CALL_TOOL", sanitizedSummary = "y".repeat(20_000)))

        val built = AgentPromptBuilder.buildUserPromptDetailed(cfg, st, charBudget = 500, enabled = true)

        assertTrue(built.text.contains("Summarise the ticket."),
            "the objective is never dropped — an agent without it is not a degraded " +
            "agent, it is a different one")
        assertTrue(!built.text.contains("yyyy"))

        val a = assertNotNull(built.assembly)
        assertTrue(a.truncated)
        assertEquals(listOf("OBSERVATIONS"), a.droppedSections)
        assertTrue(a.attributesJson().contains("context_dropped_sections"))
    }

    @Test
    fun `the last-iteration warning survives truncation`() {
        val f = AgentBrainFixture()
        val cfg = f.config(maxIterations = 2)
        val st = state(cfg)
        st.budget.iterationStarted(); st.budget.iterationStarted()
        st.addObservation(AgentObservation(1, "THINK", sanitizedSummary = "z".repeat(20_000)))

        val built = AgentPromptBuilder.buildUserPromptDetailed(cfg, st, charBudget = 200, enabled = true)

        /* The footer sits outside the budget deliberately. It is a few dozen
           characters, and an agent that is not told this is its final iteration
           burns that iteration discovering it. */
        assertContains(built.text, "BUDGET WARNING")
        assertContains(built.text, "Tool calls used:")
    }

    @Test
    fun `blackboard and handoff sections appear only when supplied`() {
        val f = AgentBrainFixture()
        val cfg = f.config()
        val st = state(cfg)

        val without = AgentPromptBuilder.buildUserPromptDetailed(cfg, st, enabled = true)
        assertTrue(!without.text.contains("SHARED CONTEXT"))
        assertTrue(!without.text.contains("RECENT HANDOFFS"))

        val with = AgentPromptBuilder.buildUserPromptDetailed(
            cfg, st,
            blackboard = listOf("findings.pricing: competitor is cheaper"),
            handoffs = listOf("researcher -> writer: gathered 4 sources"),
            enabled = true,
        )
        assertContains(with.text, "SHARED CONTEXT:")
        assertContains(with.text, "competitor is cheaper")
        assertContains(with.text, "RECENT HANDOFFS:")
        /* Blackboard outranks handoffs, which outrank observations. */
        assertTrue(with.text.indexOf("SHARED CONTEXT:") < with.text.indexOf("RECENT HANDOFFS:"))
    }
}
