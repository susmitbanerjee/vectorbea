package com.vectorbea.worker.durable.archive

import java.time.Duration
import java.time.Instant
import java.util.UUID
import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §12.1 sampling.
 *
 * The headline is the PROPERTY test: over ten thousand randomised runs at the
 * most aggressive rate the system allows, a run that had a failed step, an
 * approval or a budget clamp is never sampled out. That is stated as an absolute
 * in §12.1, and an absolute is exactly the kind of claim that a handful of
 * hand-picked examples fails to test — the interesting cases are the ones where
 * a disqualifier coincides with a run that is otherwise a perfect sampling
 * candidate.
 */
class TraceSamplerTest {

    private fun sampler(rate: Double) = TraceSampler(
        rateFor = { rate },
        graceWindow = Duration.ofSeconds(60),
        longRun = Duration.ofSeconds(60),
    )

    private val now: Instant = Instant.parse("2026-08-31T12:00:00Z")

    private fun facts(
        status: String = "succeeded",
        ageSeconds: Long = 3_600,
        durationMs: Long? = 600_000,
        failed: Boolean = false,
        approval: Boolean = false,
        clamp: Boolean = false,
        runId: UUID = UUID.randomUUID(),
    ) = TraceSampler.RunFacts(
        runId = runId,
        workspaceId = UUID.randomUUID(),
        status = status,
        createdAt = now.minusSeconds(ageSeconds),
        durationMs = durationMs,
        hadFailedStep = failed,
        hadApproval = approval,
        hadBudgetClamp = clamp,
    )

    // ── The property ──────────────────────────────────────────────────────────

    /**
     * Rate 0.0 is the harshest setting the column allows: sample out everything
     * eligible. Anything still kept is kept because a rule said so, which is what
     * makes this a test of the rules rather than of the hash.
     */
    @Test
    fun `sampling never drops a run that had a failure, approval or clamp`() {
        val s = sampler(0.0)
        val rnd = Random(20260831)
        var notable = 0

        repeat(10_000) {
            val failed = rnd.nextBoolean()
            val approval = rnd.nextBoolean()
            val clamp = rnd.nextBoolean()
            val status = if (rnd.nextInt(4) == 0)
                listOf("failed", "cancelled", "timeout", "ceiling_exceeded").random(rnd)
            else "succeeded"

            val f = facts(
                status = status,
                // Deliberately spans both sides of the grace window and both sides
                // of the long-run threshold, so the disqualifier is sometimes the
                // ONLY thing keeping the run.
                ageSeconds = rnd.nextLong(0, 100_000),
                durationMs = if (rnd.nextInt(10) == 0) null else rnd.nextLong(0, 3_600_000),
                failed = failed, approval = approval, clamp = clamp,
            )
            val d = s.decide(f, now)

            if (failed || approval || clamp) {
                notable++
                assertTrue(d.kept,
                    "a run with failed=$failed approval=$approval clamp=$clamp was sampled out")
            }
            if (status != "succeeded") {
                assertTrue(d.kept, "a run with status=$status was sampled out")
            }
            if (Duration.between(f.createdAt, now) < Duration.ofSeconds(60)) {
                assertTrue(d.kept, "a run under 60s old was sampled out")
            }
        }
        assertTrue(notable > 5_000, "the generator produced too few notable runs to prove anything")
    }

    // ── The individual rules, each isolated ───────────────────────────────────

    @Test
    fun `a run under the grace window is always kept`() {
        val d = sampler(0.0).decide(facts(ageSeconds = 59), now)
        assertEquals("recent", (d as TraceSampler.Decision.Keep).reason)
    }

    @Test
    fun `a short successful run is kept even at rate zero`() {
        val d = sampler(0.0).decide(facts(durationMs = 59_999), now)
        assertEquals("short run", (d as TraceSampler.Decision.Keep).reason)
    }

    /**
     * A missing duration is kept, not sampled.
     *
     * `duration_ms` is null on a run whose completion never wrote it — a crash, a
     * lease loss, a row updated by an older worker. Treating unknown as "short"
     * keeps it; treating it as "long" would sample out exactly the runs whose
     * bookkeeping already went wrong.
     */
    @Test
    fun `an unknown duration is kept`() {
        assertTrue(sampler(0.0).decide(facts(durationMs = null), now).kept)
    }

    @Test
    fun `an eligible run is sampled out at rate zero`() {
        val d = sampler(0.0).decide(facts(), now)
        assertTrue(d is TraceSampler.Decision.SampledOut)
    }

    @Test
    fun `rate one keeps everything`() {
        repeat(500) { assertTrue(sampler(1.0).decide(facts(), now).kept) }
    }

    /** A status this code has never heard of is kept, not discarded. */
    @Test
    fun `an unrecognised status is kept`() {
        val d = sampler(0.0).decide(facts(status = "quantum_superposition"), now)
        assertEquals("status=quantum_superposition", (d as TraceSampler.Decision.Keep).reason)
    }

    // ── The hash ──────────────────────────────────────────────────────────────

    /**
     * The same run decides the same way every time.
     *
     * The export is retried on failure. A sampler that flipped a coin would write
     * a different file on the retry than the row count recorded beside it claims,
     * and nothing downstream could tell which was right.
     */
    @Test
    fun `the decision is stable for a given run`() {
        val s = sampler(0.5)
        repeat(200) {
            val f = facts()
            val first = s.decide(f, now).kept
            repeat(5) { assertEquals(first, s.decide(f, now).kept) }
        }
    }

    /**
     * The kept fraction tracks the configured rate.
     *
     * Loose bounds on purpose — this is asserting that the hash is not degenerate,
     * not that it passes a chi-squared test. A bucket function that returned a
     * constant, or that correlated with UUID version bits, would miss by miles.
     */
    @Test
    fun `the kept fraction approximates the rate`() {
        listOf(0.1, 0.25, 0.5, 0.9).forEach { rate ->
            val s = sampler(rate)
            val kept = (1..20_000).count { s.decide(facts(), now).kept }
            val observed = kept / 20_000.0
            assertTrue(kotlin.math.abs(observed - rate) < 0.02,
                "rate $rate produced a kept fraction of $observed")
        }
    }
}
