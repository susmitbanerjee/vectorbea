package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.net.ConnectionCircuit
import java.io.File
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * A 429 must never open the circuit breaker.
 *
 * ── WHY THESE ARE DIFFERENT THINGS ──────────────────────────────────────────
 * The breaker exists for a provider that is UNAVAILABLE: connection refused,
 * 5xx, timeouts. Its remedy is to stop calling for a cooldown, because calls will
 * fail anyway and each one costs a timeout.
 *
 * A 429 says the opposite. The provider is healthy, it is answering in
 * milliseconds, and it is telling us precisely when to come back. The remedy is
 * to wait exactly that long and then continue.
 *
 * Conflating them is a strictly worse failure than the one being handled. Five
 * throttled calls would open the breaker for the whole CONNECTION, so every run
 * in the workspace — including the ones with capacity to spare, and the
 * interactive one somebody is watching — fails fast with "connection
 * unavailable" for the cooldown. And the breaker's cooldown has nothing to do
 * with the provider's rate window, so it outlives the condition that caused it.
 *
 * ── TWO TESTS, BECAUSE ONE OF THEM CANNOT SEE THE REGRESSION ────────────────
 * The behavioural test proves the breaker's own arithmetic treats throttles as
 * irrelevant. It cannot prove the EXECUTOR does not report one — that lives in a
 * `catch` branch, and the reintroducing edit is adding one line to it. The
 * structural test covers that, in the same shape as
 * `RunProcessorStructureTest` next door.
 */
class ThrottleDoesNotOpenBreakerTest {

    private val connectionId: UUID = UUID.randomUUID()

    /** No datasource: the breaker is in-process here, which is all this needs. */
    private fun circuit(threshold: Int = 5) =
        ConnectionCircuit(dataSource = null, failureThreshold = threshold, cooldownMs = 30_000)

    /**
     * ACCEPTANCE: a run of throttles leaves the breaker closed.
     *
     * Fifty, well past the five-failure threshold. The breaker is only ever told
     * about real failures, so a throttle storm is invisible to it — which is the
     * property, stated as a test.
     */
    @Test
    fun `fifty throttles do not open the breaker`() {
        val c = circuit()
        repeat(50) {
            /* What the executor does on a 429: settle the lease, record the call,
               decide the delay. Note what is absent — `c.onFailure(...)`. */
            c.beforeCall(connectionId)
        }
        assertEquals(ConnectionCircuit.State.CLOSED, c.stateOf(connectionId),
            "the breaker opened on throttles alone — a rate limit is being treated as " +
            "a provider outage, and the whole connection is now failing fast")
    }

    /**
     * And the breaker still works for what it IS for.
     *
     * The other half of the claim: if the first test passed because the breaker
     * never opens at all, it would be worthless.
     */
    @Test
    fun `real failures still open the breaker`() {
        val c = circuit(threshold = 3)
        repeat(3) { c.onFailure(connectionId, "connection refused") }
        assertEquals(ConnectionCircuit.State.OPEN, c.stateOf(connectionId),
            "three consecutive real failures did not open the breaker, so the first " +
            "test proves nothing")
    }

    /**
     * A throttle in the middle of a run of failures does not COUNT toward the
     * threshold.
     *
     * The subtle version of the bug: not "throttles open the breaker" but
     * "throttles get the breaker there faster". Four real failures and a throttle
     * must not trip a threshold of five.
     */
    @Test
    fun `a throttle does not advance the failure count`() {
        val c = circuit(threshold = 5)
        repeat(4) { c.onFailure(connectionId, "connection refused") }
        c.beforeCall(connectionId)          // the throttle: no onFailure
        assertEquals(ConnectionCircuit.State.CLOSED, c.stateOf(connectionId),
            "four failures plus a throttle opened a breaker with a threshold of five")
    }

    // ── The structural half ──────────────────────────────────────────────────

    private fun executorSource(): String {
        var d: File? = File("").absoluteFile
        while (d != null) {
            val f = File(d, "apps/worker-kotlin/src/main/kotlin/com/vectorbea/worker/" +
                "runtime/executor/LlmNodeExecutor.kt")
            if (f.isFile) return f.readText()
            d = d.parentFile
        }
        error("could not find LlmNodeExecutor.kt from ${File("").absolutePath}")
    }

    /**
     * The 429 branch must not report a failure to the breaker.
     *
     * ── WHY THIS IS WORTH A SOURCE CHECK ────────────────────────────────────
     * The reintroducing edit is one line — `circuit?.onFailure(connectionId, …)`
     * added to the `ProviderThrottledException` catch, which is a natural thing
     * to do while making the two error paths "consistent". It would pass every
     * behavioural test in this file, because they exercise the breaker directly
     * rather than through the executor, and constructing the executor to reach
     * that branch needs a provider, a connection and a secret.
     *
     * So the branch is read. Brace-matched from the `catch` to its close, with
     * strings and comments blanked first so a `{` inside a SQL literal or a KDoc
     * example cannot shift the range — a structural test that has quietly stopped
     * testing anything still reports a pass.
     */
    @Test
    fun `the throttle catch block does not call the circuit breaker`() {
        val src = executorSource()
        val stripped = stripLiteralsAndComments(src)

        val at = stripped.indexOf("catch (e: ProviderThrottledException)")
        assertTrue(at > 0,
            "the ProviderThrottledException catch was renamed or removed — this guard " +
            "is now testing nothing. Re-point it rather than deleting it.")

        val open = stripped.indexOf('{', at)
        var depth = 0
        var end = open
        while (end < stripped.length) {
            when (stripped[end]) {
                '{' -> depth++
                '}' -> { depth--; if (depth == 0) break }
            }
            end++
        }
        val branch = stripped.substring(open, minOf(end + 1, stripped.length))

        if (Regex("""circuit\??\.on(Failure|Success)""").containsMatchIn(branch)) {
            val line = src.take(at).count { it == '\n' } + 1
            fail(
                "LlmNodeExecutor.kt:$line — the 429 branch reports to the circuit breaker.\n\n" +
                "A 429 means the provider is HEALTHY and we are asking too fast. The breaker " +
                "exists for a provider that is unavailable, and its cooldown is unrelated to " +
                "the provider's rate window. Opening it on a throttle storm fails every run " +
                "on the connection — including ones with capacity to spare — for longer than " +
                "the rate limit lasts.\n\n" +
                "The 429 path is: settle the lease whole, decide a jittered delay, return " +
                "NodeResult.Throttled. Nothing else."
            )
        }
    }

    /** Blank strings and comments, preserving offsets so ranges stay valid. */
    private fun stripLiteralsAndComments(src: String): String {
        val b = StringBuilder(src)
        var i = 0
        fun blankTo(end: Int) { while (i < end && i < b.length) { if (b[i] != '\n') b[i] = ' '; i++ } }
        while (i < b.length) {
            when {
                b.startsWith("\"\"\"", i) -> {
                    val e = b.indexOf("\"\"\"", i + 3).let { if (it < 0) b.length else it + 3 }
                    blankTo(e)
                }
                b[i] == '"' -> {
                    var j = i + 1
                    while (j < b.length && b[j] != '"') { if (b[j] == '\\') j++; j++ }
                    blankTo(minOf(j + 1, b.length))
                }
                b.startsWith("/*", i) -> {
                    val e = b.indexOf("*/", i + 2).let { if (it < 0) b.length else it + 2 }
                    blankTo(e)
                }
                b.startsWith("//", i) -> {
                    val e = b.indexOf("\n", i).let { if (it < 0) b.length else it }
                    blankTo(e)
                }
                else -> i++
            }
        }
        return b.toString()
    }
}
