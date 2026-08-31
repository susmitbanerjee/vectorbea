package com.vectorbea.worker.agents.context

import com.vectorbea.worker.agents.orchestration.TeamLimits
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.testsupport.AgentBrainFixture
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * §12.5 — a team's `maxContextChars`, and a breach as a budget event in the trace.
 *
 * ── WHY THIS IS TESTED THROUGH THE LOOP AND NOT THE ASSEMBLER ───────────────
 * `ContextAssemblerTest` already covers the dropping rules exhaustively, and it
 * would be easy to "test" this by calling the assembler with a small budget and
 * asserting it drops things — which would prove nothing new. What is new here is
 * the WIRING: that the number reaching the assembler is the TEAM's, not the
 * global default, and that a breach becomes something visible rather than a
 * quietly shorter prompt. Both of those are only true if the runner passes the
 * right value and emits the right event, so the test goes through the runner.
 */
class TeamContextBudgetTest {

    /** Enough text to blow any sane budget, in a droppable section. */
    private fun bigInput() = mapOf("document" to "lorem ipsum ".repeat(4_000))

    @Test
    fun `the team's budget is the one that applies, not the global default`() = runBlocking {
        val f = AgentBrainFixture(
            contextAssemblyEnabled = true,
            // Far below AgentPromptBuilder.CONTEXT_CHAR_BUDGET (48k). If the global
            // default were used, nothing would be dropped and no event would fire.
            teamLimits = TeamLimits(maxContextChars = 2_000),
        )
        f.llm.thenAction("""{"type":"FINAL","finalOutput":{"answer":"ok"}}""")

        f.runner().run(
            f.config().copy(resolvedInput = bigInput(),
                taskInstruction = "Summarise the document."),
            f.runtimeContext())

        val breach = f.events.events.filter { it.type == EventType.AGENT_CONTEXT_BUDGET_EXCEEDED }
        assertEquals(1, breach.size,
            "one breach event per iteration that has one; got ${breach.size}")

        /* The INPUTS section is protected, so a document that big cannot be
           dropped — the assembler goes over budget rather than cutting the task.
           That is the `overBudget` half of a breach, and it is the half an
           operator most needs told: the limit they configured is not being
           honoured, and the reason is that honouring it would mutilate the task. */
        val summary = breach.single().summary ?: ""
        assertTrue(summary.contains("over the 2000-character team budget"),
            "the event must name the budget that was breached; said: $summary")
    }

    /**
     * Dropping is a warning, not a stop. The run finishes normally.
     *
     * A context budget that failed the run would be strictly worse than no budget
     * at all: the whole point is to keep a five-hop chain running under a bound,
     * not to give it a new way to die.
     */
    @Test
    fun `a breach does not fail the run`() = runBlocking {
        val f = AgentBrainFixture(
            contextAssemblyEnabled = true,
            teamLimits = TeamLimits(maxContextChars = 1_000),
        )
        f.llm.thenAction("""{"type":"FINAL","finalOutput":{"answer":"still fine"}}""")

        val result = f.runner().run(
            f.config().copy(resolvedInput = bigInput()), f.runtimeContext())

        assertEquals("still fine", result.finalOutput["answer"])
        assertTrue(f.events.events.any { it.type == EventType.AGENT_CONTEXT_BUDGET_EXCEEDED })
        assertFalse(f.events.events.any { it.type == EventType.AGENT_FAILED },
            "a context budget must not be a new way for a run to die")
    }

    /** A context that fits produces no event at all. */
    @Test
    fun `a context within budget is silent`() = runBlocking {
        val f = AgentBrainFixture(
            contextAssemblyEnabled = true,
            teamLimits = TeamLimits(maxContextChars = 100_000),
        )
        f.llm.thenAction("""{"type":"FINAL","finalOutput":{"answer":"ok"}}""")

        f.runner().run(f.config().copy(resolvedInput = mapOf("q" to "short")), f.runtimeContext())

        assertTrue(f.events.events.none { it.type == EventType.AGENT_CONTEXT_BUDGET_EXCEEDED },
            "a budget nobody hit must not be mentioned")
    }

    /**
     * With assembly off, behaviour is exactly what it was.
     *
     * The flag policy says a new runtime behaviour ships off, and "off" has to
     * mean the previous prompt byte-for-byte — not the previous prompt plus a
     * warning nobody asked for.
     */
    @Test
    fun `assembly off means no budget and no event`() = runBlocking {
        val f = AgentBrainFixture(
            contextAssemblyEnabled = false,
            teamLimits = TeamLimits(maxContextChars = 100),
        )
        f.llm.thenAction("""{"type":"FINAL","finalOutput":{"answer":"ok"}}""")

        f.runner().run(f.config().copy(resolvedInput = bigInput()), f.runtimeContext())

        assertTrue(f.events.events.none { it.type == EventType.AGENT_CONTEXT_BUDGET_EXCEEDED })
        assertTrue(f.llm.requests().first().userPrompt?.contains("lorem ipsum") == true,
            "with assembly off the whole input must still reach the model")
    }

    /** The node-config path, since that is how a builder actually sets it. */
    @Test
    fun `maxContextChars is read off node config`() {
        assertEquals(12_345,
            TeamLimits.fromNodeConfig(mapOf("maxContextChars" to 12_345)).maxContextChars)
        assertEquals(TeamLimits.DEFAULT_MAX_CONTEXT_CHARS,
            TeamLimits.fromNodeConfig(emptyMap()).maxContextChars)
        assertEquals(1_000,
            TeamLimits.fromNodeConfig(mapOf("maxContextChars" to 5)).maxContextChars,
            "an absurdly small budget is clamped, not honoured — it would drop everything")
    }
}
