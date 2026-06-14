package com.vectorbea.worker.runtime.budget

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class ExecutionBudgetTrackerTest {

    private fun budget(
        nodes: Int = 0, wallMs: Long = 0, agentIters: Int = 0, tools: Int = 0, llm: Int = 0,
    ) = ExecutionBudget(nodes, wallMs, agentIters, tools, llm)

    /** Phase 10 / scenario 6: node budget exhaustion triggers a yield. */
    @Test
    fun `node budget exhausts after maxNodes`() {
        val t = ExecutionBudgetTracker(budget(nodes = 3))
        assertTrue(t.canContinue())
        t.recordNode(); t.recordNode()
        assertTrue(t.canContinue())
        t.recordNode()
        assertFalse(t.canContinue())
        assertEquals("MAX_NODES_PER_TICK_EXCEEDED", t.exhaustedReason())
    }

    /** Phase 10 / scenario 7: wall-clock budget triggers a yield. */
    @Test
    fun `wall clock budget exhausts after elapsed time`() {
        val t = ExecutionBudgetTracker(budget(wallMs = 1))
        Thread.sleep(5)
        assertFalse(t.canContinue())
        assertEquals("MAX_WALL_CLOCK_MS_EXCEEDED", t.exhaustedReason())
    }

    @Test
    fun `disabled dimensions never exhaust`() {
        val t = ExecutionBudgetTracker(budget()) // all zero = unbounded
        repeat(1000) { t.recordNode(); t.recordLlmCall(); t.recordToolCall() }
        assertTrue(t.canContinue())
        assertNull(t.exhaustedReason())
    }

    /**
     * BETA default: MAX_NODES_PER_TICK=0 disables node-count yielding, while
     * wall-clock yielding still fires. Mirrors the production ExecutionBudget.fromEnv.
     */
    @Test
    fun `node count disabled but wall clock still yields`() {
        val t = ExecutionBudgetTracker(budget(nodes = 0, wallMs = 1))
        repeat(500) { t.recordNode() }
        assertNull(t.exhaustedReason(), "nodes=0 must never trigger a node-count yield")
        Thread.sleep(5)
        assertEquals("MAX_WALL_CLOCK_MS_EXCEEDED", t.exhaustedReason(), "wall-clock yield must still fire")
    }

    @Test
    fun `llm budget exhausts independently`() {
        val t = ExecutionBudgetTracker(budget(llm = 2))
        t.recordLlmCall()
        assertTrue(t.canContinue())
        t.recordLlmCall()
        assertEquals("MAX_LLM_CALLS_PER_TICK_EXCEEDED", t.exhaustedReason())
    }
}
