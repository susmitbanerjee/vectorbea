package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.model.AgentAction.ActionType
import com.vectorbea.worker.runtime.executor.stepBudget
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Shapes models really return, each of which used to cost an iteration. */
class ActionParsingTest {

    @Test
    fun `explicit nulls for defaulted fields are the defaults`() {
        val a = ActionParsing.parse("""{"type":"FINAL","toolId":null,"toolInput":null,"finalOutput":null,"reasoningSummary":"No changes."}""")
        assertEquals(ActionType.FINAL, a.type)
        assertTrue(a.toolInput.isEmpty() && a.finalOutput.isEmpty())
    }

    @Test
    fun `a missing type is inferred from what the action carries`() {
        assertEquals(ActionType.CALL_TOOL, ActionParsing.parse("""{"toolId":"t1","toolInput":{"sha":"abc"}}""").type)
        assertEquals(ActionType.FINAL, ActionParsing.parse("""{"finalOutput":{"content":"done"}}""").type)
        assertEquals(ActionType.FAIL, ActionParsing.parse("""{"failReason":"no access"}""").type)
    }

    @Test
    fun `a wrapped or lower-case action still parses, and nonsense still does not`() {
        assertEquals(ActionType.FINAL, ActionParsing.parse("""{"action":{"type":"final","finalOutput":{"content":"x"}}}""").type)
        assertFailsWith<Exception> { ActionParsing.parse("""{"thoughts":"hmm"}""") }
    }
}

/** The budget on an agent step, which used to be ignored. */
class StepBudgetTest {
    @Test
    fun `a step budget is read and clamped, and an absent one leaves the defaults`() {
        val b = stepBudget(mapOf("budget" to mapOf("maxTotalTokens" to 120_000, "maxToolCalls" to 999, "maxCostCents" to 200)))
        assertEquals(120_000, b.maxTotalTokens)
        assertEquals(200, b.maxToolCalls)
        assertEquals(200, b.maxCostCents)
        assertNull(stepBudget(emptyMap()).maxTotalTokens)
        assertNull(stepBudget(mapOf("budget" to mapOf("maxTotalTokens" to -5))).maxTotalTokens)
    }
}
