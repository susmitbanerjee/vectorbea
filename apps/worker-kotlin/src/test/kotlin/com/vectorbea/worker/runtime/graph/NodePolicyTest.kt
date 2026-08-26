package com.vectorbea.worker.runtime.graph

import org.junit.jupiter.api.Test
import java.util.concurrent.ThreadLocalRandom
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Node policies: read from the graph, and the backoff curve they describe.
 *
 * THE BUG THESE PIN
 * ─────────────────
 * `WorkflowNode` has carried `retryPolicy`, `timeoutPolicy` and `failurePolicy` since
 * it was written, and `WorkflowRuntime` has always honoured them — but `convertNode`
 * never populated any of them. Every node in every workflow ran with the defaults, and
 * `RetryPolicy().maxAttempts` is 0, so the retry loop executed exactly once.
 *
 * The builder drew a retry timeline, offered fixed / linear / exponential / exponential
 * -with-jitter and a max delay, and NONE of it reached execution. The canvas was
 * describing behaviour the worker did not have.
 */
class NodePolicyTest {

    private fun parseOne(json: String) = WorkflowGraph.parse(json).nodes.first()

    // ── Reading the current builder's shape ───────────────────────────────────

    @Test
    fun `reads retry config the builder writes`() {
        val node = parseOne(
            """
            {"nodes":[{
              "id":"n1","type":"agent","label":"A",
              "config":{"agentId":"a1",
                        "retry":{"attempts":3,"backoff":"exponential","baseDelayMs":2000,"maxDelayMs":8000}},
              "data":{"label":"A","nodeType":"agent",
                      "config":{"agentId":"a1",
                                "retry":{"attempts":3,"backoff":"exponential","baseDelayMs":2000,"maxDelayMs":8000}}}
            }],"edges":[]}
            """.trimIndent()
        )

        assertEquals(3, node.retryPolicy.maxAttempts)
        assertEquals(2_000L, node.retryPolicy.backoffMs)
        assertEquals(8_000L, node.retryPolicy.maxBackoffMs)
        assertEquals("exponential", node.retryPolicy.strategy)
        assertFalse(node.retryPolicy.jitter)
    }

    @Test
    fun `reads jitter encoded in the strategy name`() {
        // The builder's Select writes "exponential-jitter" as one value rather than
        // setting a separate flag, so reading only a `jitter` key would miss it.
        val node = parseOne(
            """
            {"nodes":[{"id":"n1","type":"agent","label":"A",
              "config":{"retry":{"attempts":2,"backoff":"exponential-jitter"}}}],"edges":[]}
            """.trimIndent()
        )

        assertTrue(node.retryPolicy.jitter)
        assertEquals("exponential", node.retryPolicy.strategy)
    }

    @Test
    fun `reads the legacy retryPolicyJson block`() {
        val node = parseOne(
            """
            {"nodes":[{"id":"n1","type":"agent",
              "data":{"label":"A","agentConfig":{"agentId":"a1"},
                      "retryPolicyJson":{"maxAttempts":5,"backoffType":"fixed","backoffMs":500}}}],"edges":[]}
            """.trimIndent()
        )

        assertEquals(5, node.retryPolicy.maxAttempts)
        assertEquals("fixed", node.retryPolicy.strategy)
        assertEquals(500L, node.retryPolicy.backoffMs)
    }

    @Test
    fun `a node with no retry config keeps the default`() {
        val node = parseOne("""{"nodes":[{"id":"n1","type":"agent","config":{}}],"edges":[]}""")
        assertEquals(0, node.retryPolicy.maxAttempts)
    }

    // ── Timeout and failure policy ────────────────────────────────────────────

    @Test
    fun `reads the step timeout`() {
        val node = parseOne(
            """{"nodes":[{"id":"n1","type":"agent","config":{"timeoutMs":45000}}],"edges":[]}"""
        )
        assertEquals(45_000L, node.timeoutPolicy.timeoutMs)
    }

    @Test
    fun `normalises the builder's hyphenated error policy`() {
        // The builder writes "fail-run"; the runtime's vocabulary is "fail_run".
        // Left unnormalised every value would fall through to the default and the
        // setting would appear to work while doing nothing.
        val node = parseOne(
            """{"nodes":[{"id":"n1","type":"agent","config":{"errorPolicy":"continue"}}],"edges":[]}"""
        )
        assertEquals("continue", node.failurePolicy.onFailure)
    }

    @Test
    fun `an unknown error policy falls back to failing the run`() {
        val node = parseOne(
            """{"nodes":[{"id":"n1","type":"agent","config":{"errorPolicy":"nonsense"}}],"edges":[]}"""
        )
        assertEquals("fail_run", node.failurePolicy.onFailure)
    }

    // ── The backoff curve ─────────────────────────────────────────────────────

    private val rng = ThreadLocalRandom.current()

    @Test
    fun `exponential doubles`() {
        val p = RetryPolicy(backoffMs = 1_000, backoffMultiplier = 2.0, strategy = "exponential")
        assertEquals(1_000L, p.delayForAttempt(1, rng))
        assertEquals(2_000L, p.delayForAttempt(2, rng))
        assertEquals(4_000L, p.delayForAttempt(3, rng))
    }

    @Test
    fun `fixed stays flat`() {
        val p = RetryPolicy(backoffMs = 1_500, strategy = "fixed")
        assertEquals(1_500L, p.delayForAttempt(1, rng))
        assertEquals(1_500L, p.delayForAttempt(4, rng))
    }

    @Test
    fun `linear grows by the base each attempt`() {
        val p = RetryPolicy(backoffMs = 1_000, strategy = "linear")
        assertEquals(1_000L, p.delayForAttempt(1, rng))
        assertEquals(3_000L, p.delayForAttempt(3, rng))
    }

    @Test
    fun `the cap is honoured`() {
        val p = RetryPolicy(backoffMs = 1_000, backoffMultiplier = 2.0, maxBackoffMs = 3_000)
        assertEquals(3_000L, p.delayForAttempt(5, rng), "2^4 * 1000 must be capped")
    }

    @Test
    fun `jitter stays within the computed delay and varies`() {
        val p = RetryPolicy(backoffMs = 4_000, strategy = "fixed", jitter = true)
        val draws = (1..200).map { p.delayForAttempt(1, rng) }

        assertTrue(draws.all { it in 0..4_000 }, "full jitter draws from [0, delay]")
        assertTrue(draws.distinct().size > 1, "jitter that never varies is not jitter")
    }

    @Test
    fun `without jitter the delay is deterministic`() {
        val p = RetryPolicy(backoffMs = 4_000, strategy = "fixed", jitter = false)
        assertEquals(1, (1..50).map { p.delayForAttempt(1, rng) }.distinct().size)
    }
}
