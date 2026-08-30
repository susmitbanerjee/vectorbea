package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner.Companion.canonicalJson
import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner.Companion.toolApprovalNodeId
import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner.Companion.toolGuardNodeId
import org.junit.jupiter.api.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * The two keys a tool call inside an agent step is filed under.
 *
 * THE BUG THIS PINS
 * ─────────────────
 * One id, `<stepId>:tool:<toolId>`, was doing two jobs. It has to be stable across
 * iterations because it is the APPROVAL key: the step replays from iteration 1 on
 * resume, and a key carrying the iteration number filed the decision under
 * `:tool-4` and then looked it up under `:tool-2`, opening a fresh gate every time.
 *
 * But the same shape as an IDEMPOTENCY key says `search(a)` and `search(b)` are the
 * same operation, so the second call is skipped and handed the first one's result.
 *
 * So: two keys. The approval key stays keyed on the tool; the guard key adds a hash
 * of the arguments.
 *
 * WHY SO MUCH OF THIS FILE IS ABOUT NUMBER AND KEY ORDER
 * ─────────────────────────────────────────────────────
 * The guard key has to survive re-execution, or it deduplicates nothing and does it
 * silently. A resumed step does not reuse the first pass's argument map — it reparses
 * the model's JSON. Jackson gives back `Int` or `Double` depending on the literal's
 * form, and map order follows the document. `{"n":1}` and `{"n":1.0}` are the same
 * call and must hash the same; `{"a":1,"b":2}` and `{"b":2,"a":1}` likewise. Every
 * one of these tests is a way the hash could have moved between two attempts at the
 * same call.
 */
class AgentToolGuardKeyTest {

    private val toolId = UUID.fromString("11111111-2222-3333-4444-555555555555")
    private val stepId = "n-agent-1"

    // ── The two keys are different, and only one carries the arguments ────────

    @Test
    fun `the approval key ignores arguments entirely`() {
        // One gate per (step, tool). This is the behaviour the resume fix depends on
        // and it must not change.
        assertEquals(
            toolApprovalNodeId(stepId, toolId),
            "n-agent-1:tool:11111111-2222-3333-4444-555555555555",
        )
    }

    @Test
    fun `the guard key separates two calls to one tool with different arguments`() {
        // The acceptance case: search(a) then search(b) must be two operations.
        val a = toolGuardNodeId(stepId, toolId, mapOf("q" to "a"))
        val b = toolGuardNodeId(stepId, toolId, mapOf("q" to "b"))

        assertNotEquals(a, b)
    }

    @Test
    fun `the guard key is identical for the same arguments`() {
        // The other acceptance case: the second identical call is the same operation.
        val first  = toolGuardNodeId(stepId, toolId, mapOf("q" to "a"))
        val second = toolGuardNodeId(stepId, toolId, mapOf("q" to "a"))

        assertEquals(first, second)
    }

    @Test
    fun `the guard key is prefixed by the approval key`() {
        // Not cosmetic: it keeps a guard row greppable back to the gate it belongs to
        // during an incident, and makes the relationship visible in the table.
        val approval = toolApprovalNodeId(stepId, toolId)
        val guard    = toolGuardNodeId(stepId, toolId, mapOf("q" to "a"))

        assertTrue(guard.startsWith("$approval:"), "guard key '$guard' should extend '$approval'")
    }

    @Test
    fun `different tools in one step never share a guard key`() {
        val other = UUID.fromString("99999999-8888-7777-6666-555555555555")

        assertNotEquals(
            toolGuardNodeId(stepId, toolId, mapOf("q" to "a")),
            toolGuardNodeId(stepId, other,  mapOf("q" to "a")),
        )
    }

    @Test
    fun `different steps never share a guard key`() {
        assertNotEquals(
            toolGuardNodeId("n-agent-1", toolId, mapOf("q" to "a")),
            toolGuardNodeId("n-agent-2", toolId, mapOf("q" to "a")),
        )
    }

    // ── Survives re-execution: the same call must hash the same on resume ─────

    @Test
    fun `key order does not change the hash`() {
        // Jackson preserves document order, which follows whatever the model emitted.
        // The same call written two ways is one call.
        assertEquals(
            toolGuardNodeId(stepId, toolId, mapOf("a" to 1, "b" to 2)),
            toolGuardNodeId(stepId, toolId, mapOf("b" to 2, "a" to 1)),
        )
    }

    @Test
    fun `a whole number hashes the same however it was parsed`() {
        // `1` parses to Int, `1.0` to Double, and a large literal to Long. All three
        // are the same argument, and on resume the same literal can come back as a
        // different Kotlin type.
        val asInt    = toolGuardNodeId(stepId, toolId, mapOf("n" to 1))
        val asLong   = toolGuardNodeId(stepId, toolId, mapOf("n" to 1L))
        val asDouble = toolGuardNodeId(stepId, toolId, mapOf("n" to 1.0))
        val asBigDec = toolGuardNodeId(stepId, toolId, mapOf("n" to java.math.BigDecimal("1.00")))

        assertEquals(asInt, asLong)
        assertEquals(asInt, asDouble)
        assertEquals(asInt, asBigDec)
    }

    @Test
    fun `trailing zeros on a fractional number do not change the hash`() {
        assertEquals(
            toolGuardNodeId(stepId, toolId, mapOf("amount" to java.math.BigDecimal("1.50"))),
            toolGuardNodeId(stepId, toolId, mapOf("amount" to 1.5)),
        )
    }

    @Test
    fun `an explicit null and an absent key are the same call`() {
        // executeTool filters nulls before dispatch, so the tool cannot tell them
        // apart; the key must not either.
        assertEquals(
            toolGuardNodeId(stepId, toolId, mapOf("q" to "a", "limit" to null)),
            toolGuardNodeId(stepId, toolId, mapOf("q" to "a")),
        )
    }

    @Test
    fun `nested maps are canonicalised too`() {
        assertEquals(
            toolGuardNodeId(stepId, toolId, mapOf("f" to mapOf("x" to 1, "y" to 2))),
            toolGuardNodeId(stepId, toolId, mapOf("f" to mapOf("y" to 2.0, "x" to 1L))),
        )
    }

    // ── …but genuinely different arguments must stay different ────────────────

    @Test
    fun `a different number is a different call`() {
        assertNotEquals(
            toolGuardNodeId(stepId, toolId, mapOf("n" to 1)),
            toolGuardNodeId(stepId, toolId, mapOf("n" to 2)),
        )
    }

    @Test
    fun `list order is significant`() {
        // [a,b] and [b,a] are different arguments to every tool that takes a list —
        // an ordering fix here would be a correctness bug there.
        assertNotEquals(
            toolGuardNodeId(stepId, toolId, mapOf("ids" to listOf("a", "b"))),
            toolGuardNodeId(stepId, toolId, mapOf("ids" to listOf("b", "a"))),
        )
    }

    @Test
    fun `a number and its string form are different calls`() {
        assertNotEquals(
            toolGuardNodeId(stepId, toolId, mapOf("id" to 1)),
            toolGuardNodeId(stepId, toolId, mapOf("id" to "1")),
        )
    }

    @Test
    fun `values that differ only past a long common prefix are different calls`() {
        // Nothing truncates before hashing. A tool taking a long body must not have
        // two different bodies collide.
        val base = "x".repeat(5_000)

        assertNotEquals(
            toolGuardNodeId(stepId, toolId, mapOf("body" to base + "a")),
            toolGuardNodeId(stepId, toolId, mapOf("body" to base + "b")),
        )
    }

    @Test
    fun `key and value boundaries cannot be confused`() {
        // A naive "concatenate the entries" scheme collides these two. Quoting is what
        // stops one call impersonating another.
        assertNotEquals(
            toolGuardNodeId(stepId, toolId, mapOf("a" to "bc")),
            toolGuardNodeId(stepId, toolId, mapOf("ab" to "c")),
        )
    }

    @Test
    fun `a quote in a value cannot forge a different call`() {
        assertNotEquals(
            toolGuardNodeId(stepId, toolId, mapOf("q" to """a","z":"b""")),
            toolGuardNodeId(stepId, toolId, mapOf("q" to "a", "z" to "b")),
        )
    }

    @Test
    fun `empty arguments are stable and distinct from any argument`() {
        assertEquals(
            toolGuardNodeId(stepId, toolId, emptyMap()),
            toolGuardNodeId(stepId, toolId, emptyMap()),
        )
        assertNotEquals(
            toolGuardNodeId(stepId, toolId, emptyMap()),
            toolGuardNodeId(stepId, toolId, mapOf("q" to "a")),
        )
    }

    // ── The canonical form itself ─────────────────────────────────────────────

    @Test
    fun `canonical json is sorted, null-free and number-normalised`() {
        assertEquals(
            """{"a":1,"b":"two","c":[1,2.5]}""",
            canonicalJson(mapOf(
                "c" to listOf(1.0, 2.50),
                "a" to 1L,
                "b" to "two",
                "d" to null,
            )),
        )
    }

    @Test
    fun `the hash is a fixed-width lowercase hex suffix`() {
        // The id goes into step_executions.node_id, so its length must not depend on
        // how large the arguments were.
        val short = toolGuardNodeId(stepId, toolId, mapOf("q" to "a"))
        val long  = toolGuardNodeId(stepId, toolId, mapOf("q" to "x".repeat(10_000)))

        val shortHash = short.substringAfterLast(':')
        val longHash  = long.substringAfterLast(':')

        assertEquals(32, shortHash.length)
        assertEquals(32, longHash.length)
        assertTrue(shortHash.all { it in "0123456789abcdef" }, "not lowercase hex: $shortHash")
    }
}
