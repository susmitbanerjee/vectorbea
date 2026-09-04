package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner.Companion.failureSignature
import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals

/**
 * When the agent loop decides a tool is not going to start working.
 *
 * THE BUG THIS PINS
 * ─────────────────
 * A tool that fails deterministically — bad SQL, a missing column, a revoked
 * credential — fails identically however many times it is asked. The loop had no
 * notion of that: it fed the failure back as an observation and let the model try
 * again until max iterations. One reported run spent ten iterations and ten LLM
 * calls on ten identical errors before giving up, and every one was paid for.
 *
 * The first attempt at stopping this compared the observation summaries directly and
 * NEVER FIRED, because the synthetic tool node is named `<stepId>:tool-<iteration>`
 * and the executors put that id into their error text. Two identical failures read as
 *
 *     DB_WRITE node 'n-new-agent-2:tool-1': ... column "x" does not exist
 *     DB_WRITE node 'n-new-agent-2:tool-2': ... column "x" does not exist
 *
 * which differ. Hence a signature rather than the raw string — and hence this test,
 * because the failure mode of the fix was silence.
 */
class AgentFailureSignatureTest {

    @Test
    fun `the same failure on different attempts has the same signature`() {
        val first = "Tool abc failed: DB_WRITE node 'n-new-agent-2:tool-1': statement execution " +
            "failed: [42703] ERROR: column \"nosuchcolumn\" does not exist"
        val second = first.replace(":tool-1", ":tool-2")

        assertEquals(failureSignature(first), failureSignature(second))
    }

    @Test
    fun `a double-digit attempt normalises too`() {
        // The reported run reached iteration 10.
        val a = "DB_WRITE node 'step:tool-9': boom"
        val b = "DB_WRITE node 'step:tool-10': boom"

        assertEquals(failureSignature(a), failureSignature(b))
    }

    @Test
    fun `a different error keeps a different signature`() {
        // The model changed its arguments and drew a different error: that is progress,
        // and it must keep its remaining iterations.
        val missingColumn = "DB_WRITE node 'step:tool-1': [42703] ERROR: column \"a\" does not exist"
        val syntaxError = "DB_WRITE node 'step:tool-2': [42601] ERROR: syntax error at or near \")\""

        assertNotEquals(failureSignature(missingColumn), failureSignature(syntaxError))
    }

    @Test
    fun `a different column keeps a different signature`() {
        val a = "DB_WRITE node 'step:tool-1': [42703] ERROR: column \"names\" does not exist"
        val b = "DB_WRITE node 'step:tool-2': [42703] ERROR: column \"cities\" does not exist"

        assertNotEquals(failureSignature(a), failureSignature(b))
    }

    @Test
    fun `a different tool keeps a different signature`() {
        val a = "Tool aaa failed: HTTP node 'step:tool-1': 500"
        val b = "Tool bbb failed: HTTP node 'step:tool-2': 500"

        assertNotEquals(failureSignature(a), failureSignature(b))
    }

    @Test
    fun `text with no attempt counter is left alone`() {
        val summary = "Tool abc failed: connection refused"
        assertEquals(summary, failureSignature(summary))
    }

    @Test
    fun `only the counter is normalised, not other numbers`() {
        // A number that happens to sit elsewhere in the message is data, not an
        // attempt counter, and normalising it would merge genuinely different errors.
        val a = "DB_WRITE node 'step:tool-1': [42601] ERROR: syntax error at Position: 25"
        val b = "DB_WRITE node 'step:tool-2': [42601] ERROR: syntax error at Position: 41"

        assertNotEquals(failureSignature(a), failureSignature(b))
    }
}
