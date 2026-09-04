package com.vectorbea.worker.net

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Throttled callers must not come back at the same instant.
 *
 * ── WHY THE 429s CLUSTERED ──────────────────────────────────────────────────
 * This is the mechanism the investigation identified, and it had three separate
 * causes, all of which produced the same shape:
 *
 *   1. `decide(header, attempt = 0)` was called with a HARDCODED zero. The
 *      exponential cap is `BASE shl attempt`, so `BASE shl 0` is `BASE`, and
 *      `Random.nextLong(1000, 1001)` returns exactly 1000 — every time, for every
 *      caller, however many times it had already been refused. The jitter was
 *      arithmetically eliminated while looking present in the source.
 *   2. `Retry-After` was honoured EXACTLY. Every caller refused in the same
 *      second receives the same header value, so parking all of them at
 *      `now + 60s` schedules a rendezvous. The header is a floor, not an
 *      appointment.
 *   3. The capacity bucket's own refusal returns `ceil(deficit × 60000 /
 *      refill)`, which is deterministic — N callers with equal deficits get
 *      equal answers.
 *
 * Each is asserted separately, because a fix for one leaves the other two.
 */
class ThrottleResynchronisationTest {

    /** How the acceptance criterion is measured: distinct delays, and the range. */
    private data class Spread(val distinct: Int, val min: Long, val max: Long) {
        val width: Long get() = max - min
    }

    private fun spreadOf(delays: List<Long>) =
        Spread(delays.toSet().size, delays.min(), delays.max())

    // ── ACCEPTANCE ───────────────────────────────────────────────────────────

    /**
     * ACCEPTANCE: 50 callers throttled at the same instant do not resynchronise.
     *
     * The provider supplies the same `Retry-After: 30` to all of them, which is
     * what really happens — a rate limit window is a property of the account, not
     * of the caller, so every 429 in that second carries the same number.
     *
     * Asserted on the SPREAD rather than on "the delays differ": two clusters of
     * twenty-five would have fifty distinct values and still be a thundering herd.
     * The window has to be wide relative to the delay itself.
     */
    @Test
    fun `fifty callers given the same Retry-After do not retry together`() {
        val header = "30"
        val delays = (1..50).map { ProviderThrottle.decide(header, attempt = 0).delayMs }
        val s = spreadOf(delays)

        assertTrue(s.distinct >= 45,
            "only ${s.distinct} of 50 retry delays were distinct — throttled callers are " +
            "still landing on the same instants")
        /* Never before the provider said. Coming back early is a guaranteed
           second 429 and is the one direction jitter must not go. */
        assertTrue(s.min >= 30_000,
            "a caller was scheduled to return after ${s.min}ms, before the 30s the " +
            "provider asked for — jitter must spread upward from the header, never below it")
        assertTrue(s.width >= 10_000,
            "50 callers landed inside a ${s.width}ms window on a 30s Retry-After. That is " +
            "still a rendezvous; the spread is too narrow to decorrelate them")
    }

    /**
     * ACCEPTANCE: the same, when the provider sends no header at all.
     *
     * The path that was a constant 1000ms with zero jitter.
     */
    @Test
    fun `fifty callers with no Retry-After do not retry together`() {
        val delays = (1..50).map { ProviderThrottle.decide(null, attempt = 0).delayMs }
        val s = spreadOf(delays)
        assertTrue(s.distinct >= 40,
            "only ${s.distinct} of 50 fallback delays were distinct — this is the " +
            "`attempt = 0` collapse: BASE shl 0 leaves Random.nextLong(base, base+1)")
        assertTrue(s.width > 0,
            "every fallback delay was identical (${s.min}ms) — the exponential curve has " +
            "collapsed to a constant and the jitter does nothing")
    }

    /**
     * ACCEPTANCE: the bucket's own refusal is jittered too.
     *
     * The bucket computes its retry from a deficit, which is deterministic. Fifty
     * callers refused with the same deficit would otherwise return together —
     * the capacity control reproducing, from its own arithmetic, the
     * synchronisation it exists to prevent.
     */
    @Test
    fun `fifty callers refused by the bucket do not retry together`() {
        val computed = 4_000L      // what the bucket's deficit arithmetic returns
        val delays = (1..50).map { ProviderThrottle.jitter(computed) }
        val s = spreadOf(delays)
        assertTrue(s.distinct >= 45,
            "only ${s.distinct} of 50 bucket refusals were distinct")
        assertTrue(s.min >= computed,
            "a caller was scheduled to return after ${s.min}ms, before the bucket will " +
            "have refilled at ${computed}ms — it would simply be refused again")
        assertTrue(s.width >= 500,
            "50 refusals landed inside a ${s.width}ms window")
    }

    // ── The properties the spread depends on ─────────────────────────────────

    /**
     * The curve escalates with the attempt, which is what `attempt = 0` prevented.
     *
     * A run refused ten times in a row must not keep asking on the same cadence.
     */
    @Test
    fun `the fallback curve grows with the attempt count`() {
        fun median(attempt: Int) =
            (1..200).map { ProviderThrottle.decide(null, attempt).delayMs }.sorted()[100]
        val early = median(0)
        val late = median(5)
        assertTrue(late > early * 2,
            "attempt 5 backs off to ${late}ms against attempt 0's ${early}ms — the curve " +
            "is not escalating, so a repeatedly-throttled run keeps the same cadence")
    }

    /** `Retry-After` is honoured, in both documented forms. */
    @Test
    fun `Retry-After is read and used as the floor`() {
        assertTrue(ProviderThrottle.decide("12", attempt = 0).fromHeader,
            "delta-seconds Retry-After was not recognised")
        assertTrue(ProviderThrottle.decide("12", attempt = 0).delayMs >= 12_000)

        val http = java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME
            .withZone(java.time.ZoneOffset.UTC)
            .format(java.time.Instant.now().plusSeconds(45))
        val d = ProviderThrottle.decide(http, attempt = 0)
        assertTrue(d.fromHeader, "HTTP-date Retry-After was not recognised")
        assertTrue(d.delayMs >= 40_000, "HTTP-date parsed to only ${d.delayMs}ms")
    }

    /**
     * A delay long enough to matter suspends the run rather than sleeping.
     *
     * The permit has to go back: a provider asking for sixty seconds must not
     * cost a worker slot for sixty seconds, twenty times over.
     */
    @Test
    fun `a long delay suspends and a short one does not`() {
        assertTrue(ProviderThrottle.decide("60", attempt = 0).suspend,
            "a 60s throttle did not suspend — the run would hold its permit throughout")
        assertEquals(false, ProviderThrottle.decide("0", attempt = 0).suspend,
            "a zero-length throttle suspended, paying a full park/resume round trip " +
            "through Postgres for nothing")
    }
}
