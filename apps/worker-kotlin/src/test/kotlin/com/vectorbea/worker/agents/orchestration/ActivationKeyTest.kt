package com.vectorbea.worker.agents.orchestration

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

/**
 * The activation's idempotency key, at the layer where it can be wrong silently.
 *
 * A wrong key here does not throw. It produces a SECOND activation row for work
 * that already has one — a duplicated subtree in the trace, doubled budget
 * accounting, and a resumed run that reports the agent ran twice. Nothing fails,
 * so nothing tells you. That is why the key gets its own suite and why every
 * assertion below is about two derivations agreeing or deliberately disagreeing.
 *
 * No database: the key is a pure function of its inputs, and [ActivationStore]
 * accepts a null DataSource for exactly this shape.
 */
class ActivationKeyTest {

    private val store = ActivationStore(null)

    private val agentA = UUID.fromString("00000000-0000-4000-8000-00000000000a")
    private val agentB = UUID.fromString("00000000-0000-4000-8000-00000000000b")

    private fun key(
        parent: UUID? = null,
        stepId: String = "n-agent-1",
        agentId: UUID = agentA,
        contract: Map<String, Any?> = mapOf("taskInstruction" to "Summarise the ticket."),
    ) = store.idempotencyKey(parent, stepId, agentId, contract)

    // ── Stability: the same work must derive the same key, always ────────────

    @Test
    fun `the same inputs derive the same key`() {
        assertEquals(key(), key(),
            "the key carries a timestamp or a random component — nothing else can make " +
            "two derivations from identical inputs differ")
    }

    @Test
    fun `contract key order does not change the key`() {
        /*
         * THE FAILURE THIS CATCHES. The contract is serialised from a Map. Jackson
         * preserves document order, and document order follows whatever built the
         * map — which on a resume is a DIFFERENT code path from the one that built
         * it on the first tick. A naive `writeValueAsString` hash would move, no
         * row would match, and a second activation would be created for the same
         * work. CanonicalJson sorts; this asserts that it does.
         */
        val first  = linkedMapOf<String, Any?>(
            "taskInstruction" to "Summarise the ticket.", "locale" to "en", "attempt" to 1)
        val second = linkedMapOf<String, Any?>(
            "attempt" to 1, "locale" to "en", "taskInstruction" to "Summarise the ticket.")

        assertNotEquals(first.keys.toList(), second.keys.toList(), "the fixture must differ in order")
        assertEquals(key(contract = first), key(contract = second))
    }

    @Test
    fun `an absent key and an explicit null are the same request`() {
        assertEquals(
            key(contract = mapOf("taskInstruction" to "Do it.")),
            key(contract = mapOf("taskInstruction" to "Do it.", "locale" to null)),
        )
    }

    @Test
    fun `a whole number derives the same key however it was parsed`() {
        /* Jackson gives Int for `1` and Double for `1.0`; both mean one retry. */
        assertEquals(
            key(contract = mapOf("taskInstruction" to "Do it.", "attempt" to 1)),
            key(contract = mapOf("taskInstruction" to "Do it.", "attempt" to 1.0)),
        )
    }

    // ── Separation: different work must derive different keys ────────────────

    @Test
    fun `two agent nodes given the same instruction do not collide`() {
        /*
         * WHY step_id IS IN THE HASH AND NOT MERELY ALONGSIDE IT. With the contract
         * reduced to a task instruction, the step is the only thing separating two
         * agent nodes in one graph that were handed the same words. Drop it and both
         * nodes reattach to one activation, and the second agent's work is recorded
         * as the first's.
         */
        assertNotEquals(key(stepId = "n-agent-1"), key(stepId = "n-agent-2"))
    }

    @Test
    fun `two agents at the same step do not collide`() {
        assertNotEquals(key(agentId = agentA), key(agentId = agentB))
    }

    @Test
    fun `a different instruction is different work`() {
        assertNotEquals(
            key(contract = mapOf("taskInstruction" to "Summarise the ticket.")),
            key(contract = mapOf("taskInstruction" to "Close the ticket.")),
        )
    }

    @Test
    fun `a child keys off its parent activation, not the step`() {
        /* P7's shape, asserted now so the P6 key cannot be changed in a way that
           breaks it later: a delegated child keys off the parent activation, so two
           children delegated from different parents at the same step are distinct. */
        val p1 = UUID.randomUUID()
        val p2 = UUID.randomUUID()
        assertNotEquals(key(parent = p1), key(parent = p2))
        assertNotEquals(key(parent = p1), key(parent = null))
    }

    @Test
    fun `component boundaries cannot be smeared`() {
        /*
         * The classic concatenation bug: joining components without a separator lets
         * ("ab","c") and ("a","bc") produce one string. Here the step id absorbs a
         * character the agent id would otherwise start with.
         */
        assertNotEquals(
            key(stepId = "n-agent-1", agentId = agentA),
            key(stepId = "n-agent-1" + agentA.toString().first(), agentId = agentA),
        )
    }

    @Test
    fun `list order is part of the contract`() {
        /* Lists stay order-sensitive on purpose — [a,b] and [b,a] are different
           arguments to every caller that takes a list. */
        assertNotEquals(
            key(contract = mapOf("taskInstruction" to "x", "steps" to listOf("a", "b"))),
            key(contract = mapOf("taskInstruction" to "x", "steps" to listOf("b", "a"))),
        )
    }
}
