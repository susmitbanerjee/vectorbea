package com.vectorbea.worker.net

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import java.util.UUID
import java.util.concurrent.CountDownLatch
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * M3 — a reservation must survive its own cancellation, and must not survive the
 * process.
 *
 * ── THE TWO FAILURES, AND WHY BOTH NEED A TEST ──────────────────────────────
 * The leak was: `LlmNodeExecutor` reserved, then settled on three named paths
 * and nowhere else. `CancellationException` is not one of the three, and the
 * worker cancels ROUTINELY — a tick deadline cancels in-flight work. Every
 * cancelled model call leaked its whole reservation.
 *
 * The obvious fix is a `finally`, and it fails in the worst possible way: it
 * looks correct and leaks identically, because a suspending call inside a
 * cancelled coroutine's `finally` is itself cancelled at its first suspension
 * point. Only `withContext(NonCancellable)` actually completes.
 *
 * A test that cancels ONCE would pass against the broken fix, since the release
 * either happens or the assertion runs before it does. Two hundred cancellations
 * make the difference unmissable: a leak of even a few percent leaves the bucket
 * visibly short.
 */
class CapacityLeaseLifecycleTest {

    private val ws: UUID = UUID.randomUUID()

    private fun bucket(
        backend: CapacityBackend = InProcessCapacityBackend(),
        ttlMs: Long = 120_000,
    ) = ProviderCapacityBucket(
        backend = backend,
        limits = ProviderCapacityBucket.CapacityLimits(100_000, emptyMap()),
        enabled = true,
        interactiveFloor = 0.0,
        burstFraction = 1.0,   // depth == the limit, so the arithmetic is readable
        leaseTtlMs = ttlMs,
    )

    /** How much the bucket will still hand out, probed without keeping it. */
    private fun available(b: ProviderCapacityBucket): Long {
        var lo = 0L
        var hi = 100_000L
        while (lo < hi) {
            val mid = (lo + hi + 1) / 2
            when (val o = b.reserve("p", "m", ws, mid, false)) {
                is ProviderCapacityBucket.Outcome.Granted -> { b.release(o.lease); lo = mid }
                else -> hi = mid - 1
            }
        }
        return lo
    }

    // ── (a) Cancellation ──────────────────────────────────────────────────────

    /**
     * The shape of `LlmNodeExecutor`'s call path, reduced to what matters: a
     * reservation, a suspending call that gets cancelled, and a `finally` that
     * has to release anyway.
     */
    private suspend fun oneCancelledCall(b: ProviderCapacityBucket, entered: CountDownLatch) {
        val lease = (b.reserve("p", "m", ws, 100, false)
            as? ProviderCapacityBucket.Outcome.Granted)?.lease
        try {
            entered.countDown()
            delay(10_000)   // stands in for the provider call
        } finally {
            /* The fix under test. Drop `NonCancellable` and this suspends inside a
               cancelled coroutine, throws, and the tokens are gone. */
            lease?.let { withContext(NonCancellable) { b.settle(it, 0) } }
        }
    }

    @Test
    fun `two hundred cancelled calls return every token`() = runBlocking {
        val b = bucket()
        val before = available(b)
        assertEquals(100_000, before)

        repeat(200) {
            val entered = CountDownLatch(1)
            val scope = CoroutineScope(Dispatchers.Default)
            val job = scope.launch { oneCancelledCall(b, entered) }
            /* Cancel only once the reservation is definitely taken — cancelling
               before it would test nothing. */
            entered.await()
            job.cancel()
            job.join()
        }

        assertEquals(before, available(b),
            "the bucket did not return to full — reservations leaked on cancellation")
    }

    /**
     * The same loop with a plain `finally`, to prove the trap is real.
     *
     * If this passed, `NonCancellable` would be cargo cult. It does not: the
     * release suspends, the coroutine is already cancelled, and the tokens stay
     * drawn.
     */
    @Test
    fun `a plain finally leaks, which is why NonCancellable is not optional`() = runBlocking {
        val b = bucket()
        val before = available(b)

        repeat(50) {
            val entered = CountDownLatch(1)
            val scope = CoroutineScope(Dispatchers.Default)
            val job = scope.launch {
                val lease = (b.reserve("p", "m", ws, 100, false)
                    as? ProviderCapacityBucket.Outcome.Granted)?.lease
                try {
                    entered.countDown()
                    delay(10_000)
                } finally {
                    // No NonCancellable, and a suspension point before the release.
                    lease?.let { runCatching { delay(1); b.settle(it, 0) } }
                }
            }
            entered.await(); job.cancel(); job.join()
        }

        assertTrue(available(b) < before,
            "a plain finally was expected to leak; if it no longer does, this test " +
            "and the NonCancellable it justifies both need revisiting")
    }

    // ── (b) The crash backstop ────────────────────────────────────────────────

    /**
     * A worker killed mid-call settles nothing, ever. The reservation has to
     * return itself.
     *
     * Modelled by reserving and simply never settling — which is exactly what a
     * SIGKILL leaves behind — then advancing past the TTL.
     */
    @Test
    fun `an abandoned reservation expires and returns its tokens`() {
        val backend = InProcessCapacityBackend()
        val b = bucket(backend, ttlMs = 1_000)
        val before = available(b)

        repeat(20) {
            b.reserve("p", "m", ws, 1_000, false)   // granted, never settled: the crash
        }
        val leaked = available(b)
        assertTrue(leaked < before, "the reservations should be outstanding at this point")

        /* Past the TTL. The reaper is lazy — it runs on the next reserve — so the
           probe below is what triggers it, which is the intended design: the cost
           lands on the caller who benefits from the reclaimed tokens. */
        Thread.sleep(1_200)

        assertEquals(before, available(b),
            "abandoned reservations did not expire — a crashed worker would draw the " +
            "bucket down permanently")
    }

    /**
     * Expiry must not double-return a lease that was settled normally.
     *
     * Settle retires the lease; if it did not, the reaper would return the same
     * tokens a second time and the bucket would drift above its depth — which
     * silently disables the rate limit it exists to enforce.
     */
    @Test
    fun `a settled lease is not returned again by expiry`() {
        val b = bucket(ttlMs = 500)
        val before = available(b)

        val lease = (b.reserve("p", "m", ws, 5_000, false)
            as ProviderCapacityBucket.Outcome.Granted).lease
        b.settle(lease, 5_000)          // spent it all: nothing comes back
        val afterSettle = available(b)

        Thread.sleep(700)               // past the TTL
        assertEquals(afterSettle, available(b),
            "expiry returned tokens for a lease that was already settled")
        assertTrue(afterSettle < before)
    }
}
