package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.model.AgentLoopState.StopReason
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.testsupport.AgentBrainFixture
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.BeforeAll
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import java.util.concurrent.TimeUnit
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The documented behaviour of the agent brain loop, against a scripted provider.
 *
 * Every test here asserts a specific [StopReason], because the stop reason is what
 * the runtime turns into a node result and therefore into a run outcome — it is the
 * loop's actual contract with everything above it. Several of these paths were
 * previously verified by reading.
 *
 * No network, no database, no sleeps: the provider is
 * [com.vectorbea.worker.testsupport.ScriptedLlmProvider], substituted at the
 * `HttpClient` seam, so everything from prompt assembly down to response parsing
 * runs for real.
 */
@Timeout(value = 10, unit = TimeUnit.SECONDS)   // a backstop against a hang, not a performance budget
class AgentBrainLoopTest {

    companion object {
        /**
         * Runs one whole loop before the timed tests start.
         *
         * Not a test and not a fixture — it exists so the one-time cost of class
         * loading, Jackson's Kotlin module, the logging backend and the JIT lands
         * here instead of on whichever test happens to run first. Without it the
         * first test measures ~2.7s and every other test measures under 0.1s, which
         * makes per-test timings unreadable and a tight @Timeout flaky.
         */
        @JvmStatic
        @BeforeAll
        fun warmUp() = runBlocking {
            val f = AgentBrainFixture()
            f.llm.thenAction("""{"type":"FINAL","finalOutput":{"warm":"up"}}""")
            f.runner().run(f.config(), f.runtimeContext())
            Unit
        }
    }

    // ── FINAL_OUTPUT ──────────────────────────────────────────────────────────

    @Test
    fun `a valid FINAL action stops with FINAL_OUTPUT and returns the output`() = runBlocking {
        val f = AgentBrainFixture()
        f.llm.thenAction("""{"type":"FINAL","reasoningSummary":"done","finalOutput":{"answer":"42"}}""")

        val result = f.runner().run(f.config(), f.runtimeContext())

        assertEquals(StopReason.FINAL_OUTPUT, result.stopReason)
        assertEquals("42", result.finalOutput["answer"])
        assertEquals(1, result.iterationsUsed)
        assertEquals(1, f.llm.callCount(), "one iteration should cost exactly one provider call")
        assertTrue(f.events.hasType(EventType.AGENT_FINAL_OUTPUT_CREATED))
    }

    @Test
    fun `the scripted provider receives the assembled system and user prompts`() = runBlocking {
        val f = AgentBrainFixture()
        f.llm.thenAction("""{"type":"FINAL","finalOutput":{"answer":"ok"}}""")

        f.runner().run(f.config(taskInstruction = "Summarise the invoice."), f.runtimeContext())

        val req = assertNotNull(f.llm.lastRequest())
        assertEquals("gpt-4o-mini", req.model)
        // The convention: baseUrl is stored without /v1; the executor appends the path.
        assertTrue(req.uri.endsWith("/v1/chat/completions"), "unexpected path: ${req.uri}")
        assertTrue(req.systemPrompt!!.isNotBlank(), "a system prompt should have been built")
        assertTrue(req.userPrompt!!.contains("Summarise the invoice."),
            "the task instruction should reach the model")
    }

    // ── MAX_ITERATIONS ────────────────────────────────────────────────────────

    @Test
    fun `a model that never converges stops with MAX_ITERATIONS`() = runBlocking {
        val f = AgentBrainFixture()
        // THINK forever: never sets a stop reason, so only the iteration ceiling ends it.
        f.llm.thenActionRepeated("""{"type":"THINK","reasoningSummary":"still thinking"}""", 3)

        val result = f.runner().run(f.config(maxIterations = 3), f.runtimeContext())

        assertEquals(StopReason.MAX_ITERATIONS, result.stopReason)
        assertEquals(3, result.iterationsUsed)
        assertEquals(3, f.llm.callCount(), "one provider call per iteration, no more")
        assertEquals(0, f.llm.remaining(), "the loop should have used its whole budget")
        assertTrue(f.events.hasType(EventType.AGENT_MAX_ITERATIONS_REACHED))
    }

    // ── TOOL_NOT_ALLOWED ──────────────────────────────────────────────────────

    @Test
    fun `calling an ungranted tool stops with TOOL_NOT_ALLOWED before any dispatch`() = runBlocking {
        val f = AgentBrainFixture()
        f.llm.thenAction(
            """{"type":"CALL_TOOL","toolId":"${f.ungrantedToolId}","toolInput":{"q":"x"}}""")

        val result = f.runner().run(
            f.config(allowedToolIds = setOf(f.grantedToolId)), f.runtimeContext())

        assertEquals(StopReason.TOOL_NOT_ALLOWED, result.stopReason)
        assertTrue(f.events.hasType(EventType.AGENT_TOOL_NOT_ALLOWED))
        // The grant is checked in runtime code, before the executor is reached: the
        // roster is enforcement, not prompt documentation.
        assertFalse(f.events.hasType(EventType.TOOL_CALL_STARTED),
            "an ungranted tool must never reach the executor")
        assertEquals(1, f.llm.callCount())
    }

    // ── SCHEMA_INVALID ────────────────────────────────────────────────────────

    @Test
    fun `a final output missing a required field stops with SCHEMA_INVALID`() = runBlocking {
        val f = AgentBrainFixture()
        f.llm.thenAction("""{"type":"FINAL","finalOutput":{"somethingElse":"x"}}""")

        val result = f.runner().run(
            f.config(outputSchemaJson = """{"type":"object","required":["answer"]}"""),
            f.runtimeContext())

        assertEquals(StopReason.SCHEMA_INVALID, result.stopReason)
        assertTrue(f.events.hasType(EventType.AGENT_OUTPUT_SCHEMA_INVALID))
    }

    @Test
    fun `a final output satisfying its schema stops with FINAL_OUTPUT`() = runBlocking {
        val f = AgentBrainFixture()
        f.llm.thenAction("""{"type":"FINAL","finalOutput":{"answer":"42","extra":"fine"}}""")

        val result = f.runner().run(
            f.config(outputSchemaJson = """{"type":"object","required":["answer"]}"""),
            f.runtimeContext())

        assertEquals(StopReason.FINAL_OUTPUT, result.stopReason)
    }

    // ── Repeated tool failure ─────────────────────────────────────────────────

    @Test
    fun `the same tool failing the same way twice stops the loop early`() = runBlocking {
        val f = AgentBrainFixture()
        val call = """{"type":"CALL_TOOL","toolId":"${f.grantedToolId}","toolInput":{"q":"x"}}"""
        // Scripted for the full iteration budget. If the stop does not fire, the loop
        // runs all five and the assertion on callCount catches it.
        f.llm.thenActionRepeated(call, 5)

        val result = f.runner().run(f.config(maxIterations = 5), f.runtimeContext())

        assertEquals(StopReason.ERROR, result.stopReason)
        assertFalse(result.retryable, "a proven-repeating failure must not be retried")
        assertEquals(2, result.iterationsUsed,
            "the stop should fire on the second identical failure, not later")
        assertEquals(2, f.llm.callCount(),
            "three more iterations were scripted and must not have been spent")
        assertEquals(3, f.llm.remaining())
        assertTrue(result.failureReason!!.contains("failed twice with the same error"),
            "the run should say why it stopped: ${result.failureReason}")
    }

    @Test
    fun `two different failures keep the loop going`() = runBlocking {
        val f = AgentBrainFixture()
        // Different tool ids produce different observations, so the repeat check must
        // not fire and the loop must spend its whole budget.
        f.llm.thenAction("""{"type":"CALL_TOOL","toolId":"${f.grantedToolId}","toolInput":{"q":"a"}}""")
            .thenAction("""{"type":"THINK","reasoningSummary":"that failed, reconsidering"}""")
            .thenAction("""{"type":"CALL_TOOL","toolId":"${f.grantedToolId}","toolInput":{"q":"b"}}""")

        val result = f.runner().run(f.config(maxIterations = 3), f.runtimeContext())

        // A THINK between the two failures breaks the adjacency the stop requires.
        assertEquals(StopReason.MAX_ITERATIONS, result.stopReason)
        assertEquals(3, f.llm.callCount())
    }

    // ── Unparseable response is repaired into a THINK ──────────────────────────

    @Test
    fun `an unparseable model response becomes a THINK and the loop continues`() = runBlocking {
        val f = AgentBrainFixture()
        f.llm.thenContent("I'm sorry, I can't do that.")   // not JSON at all
            .thenAction("""{"type":"FINAL","finalOutput":{"answer":"recovered"}}""")

        val result = f.runner().run(f.config(maxIterations = 3), f.runtimeContext())

        assertEquals(StopReason.FINAL_OUTPUT, result.stopReason)
        assertEquals("recovered", result.finalOutput["answer"])
        assertEquals(2, f.llm.callCount(), "the loop should have continued past the bad response")
        // The repair is observable: iteration 1 recorded a reflection, not a failure.
        assertTrue(f.events.hasType(EventType.AGENT_REFLECTION_CREATED))
    }

    @Test
    fun `a fenced json code block is unwrapped rather than repaired`() = runBlocking {
        val f = AgentBrainFixture()
        f.llm.thenContent("```json\n{\"type\":\"FINAL\",\"finalOutput\":{\"answer\":\"fenced\"}}\n```")

        val result = f.runner().run(f.config(), f.runtimeContext())

        assertEquals(StopReason.FINAL_OUTPUT, result.stopReason)
        assertEquals("fenced", result.finalOutput["answer"])
        assertEquals(1, f.llm.callCount())
    }

    // ── ASK_APPROVAL: pause, then resume under the same key ───────────────────

    @Test
    fun `ASK_APPROVAL creates a PENDING row and stops with APPROVAL_REQUESTED`() = runBlocking {
        val f = AgentBrainFixture()
        f.llm.thenAction("""{"type":"ASK_APPROVAL","reasoningSummary":"need a human"}""")

        val result = f.runner().run(f.config(), f.runtimeContext())

        assertEquals(StopReason.APPROVAL_REQUESTED, result.stopReason)
        assertFalse(result.retryable, "a run waiting on a person must not be retried")
        assertNotNull(result.approvalId, "the caller needs the id to park the run against")
        assertEquals(1, f.approvals.count())
        // Keyed on the step, which is what makes the resumed lookup find it.
        assertEquals("PENDING", f.approvals.statusOf(f.runId, f.stepId))
        assertEquals(listOf(f.stepId), f.approvals.createdKeys)
    }

    @Test
    fun `on resume with the row APPROVED the gate grants under the same key`() = runBlocking {
        val f = AgentBrainFixture()

        // ── First execution: asks, and parks.
        f.llm.thenAction("""{"type":"ASK_APPROVAL","reasoningSummary":"need a human"}""")
        val first = f.runner().run(f.config(), f.runtimeContext())
        assertEquals(StopReason.APPROVAL_REQUESTED, first.stopReason)

        // ── A human approves the row the API would have updated.
        f.approvals.decide(f.runId, f.stepId, "APPROVED", by = "alice")

        // ── Resume: the step re-executes from iteration 1, same runId and stepId.
        f.llm.reset()
        f.llm.thenAction("""{"type":"ASK_APPROVAL","reasoningSummary":"need a human"}""")
            .thenAction("""{"type":"FINAL","finalOutput":{"answer":"proceeded"}}""")

        val resumed = f.runner().run(f.config(), f.runtimeContext())

        assertEquals(StopReason.FINAL_OUTPUT, resumed.stopReason)
        assertEquals("proceeded", resumed.finalOutput["answer"])
        // THE POINT: no second gate. A key that moved between attempts would have
        // opened another PENDING row and deadlocked the run forever.
        assertEquals(1, f.approvals.count(), "the resume must not open a second gate")
        assertEquals(listOf(f.stepId), f.approvals.createdKeys)
        assertTrue(f.events.hasType(EventType.APPROVAL_APPROVED))
    }

    @Test
    fun `a REJECTED approval stops with AGENT_FAILED and is not retryable`() = runBlocking {
        val f = AgentBrainFixture()
        f.llm.thenAction("""{"type":"ASK_APPROVAL","reasoningSummary":"need a human"}""")
        f.runner().run(f.config(), f.runtimeContext())

        f.approvals.decide(f.runId, f.stepId, "REJECTED", by = "bob")

        f.llm.reset()
        f.llm.thenAction("""{"type":"ASK_APPROVAL","reasoningSummary":"need a human"}""")
        val resumed = f.runner().run(f.config(), f.runtimeContext())

        assertEquals(StopReason.AGENT_FAILED, resumed.stopReason)
        assertFalse(resumed.retryable, "a person said no; retrying asks them again")
    }

    // ── The retryable flag ────────────────────────────────────────────────────

    /**
     * Only ERROR is retryable. Every other stop is a decision the loop reached, and
     * repeating it costs a whole brain loop — several provider calls — to arrive at
     * the same place. This is what `WorkflowRuntime` reads to decide whether the
     * node's configured retries apply.
     */
    @Test
    fun `every decided stop reason returns non-retryable`() = runBlocking {
        // MAX_ITERATIONS
        AgentBrainFixture().let { f ->
            f.llm.thenActionRepeated("""{"type":"THINK","reasoningSummary":"x"}""", 2)
            val r = f.runner().run(f.config(maxIterations = 2), f.runtimeContext())
            assertEquals(StopReason.MAX_ITERATIONS, r.stopReason)
            assertFalse(r.retryable, "MAX_ITERATIONS should not be retried")
        }
        // TOOL_NOT_ALLOWED
        AgentBrainFixture().let { f ->
            f.llm.thenAction("""{"type":"CALL_TOOL","toolId":"${f.ungrantedToolId}"}""")
            val r = f.runner().run(f.config(), f.runtimeContext())
            assertEquals(StopReason.TOOL_NOT_ALLOWED, r.stopReason)
            assertFalse(r.retryable, "a grant does not change on retry")
        }
        // SCHEMA_INVALID
        AgentBrainFixture().let { f ->
            f.llm.thenAction("""{"type":"FINAL","finalOutput":{"wrong":"x"}}""")
            val r = f.runner().run(
                f.config(outputSchemaJson = """{"required":["answer"]}"""), f.runtimeContext())
            assertEquals(StopReason.SCHEMA_INVALID, r.stopReason)
            assertFalse(r.retryable, "SCHEMA_INVALID should not be retried")
        }
        // APPROVAL_REQUESTED
        AgentBrainFixture().let { f ->
            f.llm.thenAction("""{"type":"ASK_APPROVAL","reasoningSummary":"x"}""")
            val r = f.runner().run(f.config(), f.runtimeContext())
            assertEquals(StopReason.APPROVAL_REQUESTED, r.stopReason)
            assertFalse(r.retryable, "a waiting run is not a failed one")
        }
        // AGENT_FAILED — the model declining the task
        AgentBrainFixture().let { f ->
            f.llm.thenAction("""{"type":"FAIL","failReason":"cannot do this"}""")
            val r = f.runner().run(f.config(), f.runtimeContext())
            assertEquals(StopReason.AGENT_FAILED, r.stopReason)
            assertFalse(r.retryable, "the agent weighed it and declined; it will decline again")
        }
    }

    @Test
    fun `a provider failure stops with ERROR and stays retryable`() = runBlocking {
        val f = AgentBrainFixture()
        // A 500 is the transient case: another attempt genuinely could end differently.
        f.llm.thenHttpError(500)

        val result = f.runner().run(f.config(), f.runtimeContext())

        assertEquals(StopReason.ERROR, result.stopReason)
        assertTrue(result.retryable, "a provider 500 is exactly what a retry is for")
        assertEquals(1, f.llm.callCount())
    }

    // ── Resume cost: the P3 baseline ──────────────────────────────────────────

    /**
     * THE NUMBER P3 HAS TO DRIVE TO ZERO.
     *
     * A resumed agent step replays its loop from iteration 1. Loop state is in
     * memory, so the second pass re-derives every decision the first pass already
     * made, and each of those is a paid provider call. This test does not assert
     * that the behaviour is good — it pins the current cost so the durable-loop-state
     * work has a baseline to move.
     *
     * With durable loop state this test SHOULD fail, and the assertion that replaces
     * it is `assertEquals(1, secondPass)` — one call for the one new decision.
     */
    @Test
    fun `a resumed step replays every LLM call from iteration 1 — current cost baseline`() = runBlocking {
        val f = AgentBrainFixture()

        // First pass: three iterations of real work, then a pause for a human.
        f.llm.thenAction("""{"type":"THINK","reasoningSummary":"step one"}""")
            .thenAction("""{"type":"THINK","reasoningSummary":"step two"}""")
            .thenAction("""{"type":"ASK_APPROVAL","reasoningSummary":"need a human"}""")
        val first = f.runner().run(f.config(maxIterations = 6), f.runtimeContext())

        assertEquals(StopReason.APPROVAL_REQUESTED, first.stopReason)
        val firstPass = f.llm.callCount()
        assertEquals(3, firstPass)

        f.approvals.decide(f.runId, f.stepId, "APPROVED")

        // Resume. The model replays the same reasoning because it is asked the same
        // question with no restored observations.
        f.llm.reset()
        f.llm.thenAction("""{"type":"THINK","reasoningSummary":"step one"}""")
            .thenAction("""{"type":"THINK","reasoningSummary":"step two"}""")
            .thenAction("""{"type":"ASK_APPROVAL","reasoningSummary":"need a human"}""")
            .thenAction("""{"type":"FINAL","finalOutput":{"answer":"done"}}""")
        val resumed = f.runner().run(f.config(maxIterations = 6), f.runtimeContext())

        assertEquals(StopReason.FINAL_OUTPUT, resumed.stopReason)
        val secondPass = f.llm.callCount()

        // 4 calls to make 1 new decision: 3 replayed + 1 new.
        assertEquals(4, secondPass,
            "BASELINE: a resumed step replays all $firstPass earlier LLM calls before " +
            "making progress. Durable loop state (P3) should drive the replayed " +
            "portion to 0, leaving 1.")
        assertEquals(3, secondPass - 1,
            "3 of the 4 calls on resume were pure replay — this is the waste to remove")
    }
}
