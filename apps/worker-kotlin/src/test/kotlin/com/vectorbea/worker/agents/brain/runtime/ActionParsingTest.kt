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

    @Test
    fun `the type under another name, snake_case fields and a string finalOutput all parse`() {
        val call = ActionParsing.parse("""{"action":"tool_call","tool_id":"t1","tool_input":{"page":2}}""")
        assertEquals(ActionType.CALL_TOOL, call.type)
        assertEquals("t1", call.toolId)
        assertEquals(2, call.toolInput["page"])

        val final = ActionParsing.parse("""{"actionType":"FINAL","final_output":"LGTM"}""")
        assertEquals(ActionType.FINAL, final.type)
        assertEquals("LGTM", final.finalOutput["content"])
    }

    @Test
    fun `a bare answer carrying the step's output fields is its final output`() {
        val fields = setOf("summary", "verdict", "findings")
        val a = ActionParsing.parse(
            """{"summary":"Two issues.","verdict":"FAIL","findings":["a","b"],"reasoningSummary":"done"}""", fields)
        assertEquals(ActionType.FINAL, a.type)
        assertEquals("FAIL", a.finalOutput["verdict"])
        assertTrue("reasoningSummary" !in a.finalOutput)
        // Without declared fields the same object is still not guessed at.
        assertFailsWith<Exception> { ActionParsing.parse("""{"summary":"Two issues."}""") }
    }
}

/** Memory rows must stay valid JSON however long the observation. */
class MemoryValueBoundTest {
    @Test
    fun `a long escaped observation is shortened before encoding, not cut mid-string`() {
        val store = AgentMemoryStore(null)
        val patch = "RESULT: " + """{"patch":"+    String c = opt(\"darkColor\\\", \"000000\");\n"}""".repeat(200)
        val json = store.boundedJson(patch)
        assertTrue(json.length <= 4096, "length ${json.length}")
        val back = com.fasterxml.jackson.module.kotlin.jacksonObjectMapper().readValue(json, String::class.java)
        assertTrue(back.endsWith("… [truncated]"), back.takeLast(40))
        assertEquals("\"short\"", store.boundedJson("short"))
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
