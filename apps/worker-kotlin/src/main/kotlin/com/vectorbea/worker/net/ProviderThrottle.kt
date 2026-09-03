package com.vectorbea.worker.net

import com.vectorbea.worker.logging.logger
import java.time.Duration
import java.time.Instant
import java.time.format.DateTimeParseException
import kotlin.random.Random

/**
 * What to do when a provider says 429.
 *
 * THE MISTAKE THIS EXISTS TO PREVENT
 * ----------------------------------
 * The obvious handling is `sleep(retryAfter); retry`. It is wrong in the specific
 * way that matters here: the run keeps its permit for the whole backoff. A
 * provider asking for a 60-second pause therefore removes a worker slot for 60
 * seconds — and when twenty runs hit the same rate limit at once, twenty slots
 * disappear and the platform stalls on a condition that is not even an error.
 *
 * The run is not doing anything during that minute. It should not be holding
 * anything either. So a 429 **suspends** the run into `workflow_timers` — the
 * same durable mechanism an approval or a sleep node uses. The permit is
 * released, the run resumes when the timer fires, and the fleet keeps working.
 *
 * That is also why this returns a decision rather than performing one: whether to
 * suspend is a scheduling question the executor cannot answer alone, and making
 * it explicit stops anyone re-adding the sleep.
 *
 * RESPECTING Retry-After
 * ----------------------
 * Both forms are parsed: delta-seconds (`Retry-After: 60`) and HTTP-date
 * (`Retry-After: Wed, 21 Oct 2026 07:28:00 GMT`). A provider that tells us
 * exactly when to come back is doing us a favour and second-guessing it with our
 * own backoff curve is how you get rate-limited twice.
 *
 * Only when the header is absent or unparseable does the exponential curve
 * apply — and with jitter, because N runs throttled by the same provider at the
 * same instant will otherwise all retry at the same instant and re-trigger the
 * limit together. Deterministic backoff synchronises exactly the callers it is
 * meant to spread.
 *
 * JITTER APPLIES TO THE HEADER TOO
 * --------------------------------
 * This is the part that was missing, and it is counter-intuitive enough to state
 * plainly: honouring `Retry-After` EXACTLY is itself a synchronisation mechanism.
 * Every caller refused in the same second receives the same value, so parking all
 * of them at `now + 60s` schedules a rendezvous. The header is a FLOOR — "not
 * before this" — not an appointment.
 *
 * So the header is honoured as a minimum and spread over a window above it:
 * `[retryAfter, retryAfter × (1 + JITTER_SPREAD)]`. Never below, because coming
 * back early is what the provider explicitly asked us not to do.
 *
 * The fallback curve uses EQUAL jitter — `cap/2 + random(0, cap/2)` — which
 * spreads callers across a window half the cap wide while keeping a floor. Full
 * jitter from zero would decorrelate slightly better and would also send some
 * callers straight back into a limit the provider has just refused them on.
 */
object ProviderThrottle {

    private val log = logger("ProviderThrottle")

    /** Base for the exponential curve when the provider gives no guidance. */
    private val BASE_BACKOFF_MS =
        System.getenv("PROVIDER_BACKOFF_BASE_MS")?.toLongOrNull() ?: 1_000L

    /**
     * Cap on a single backoff.
     *
     * Five minutes: long enough to outlast most provider rate windows, short
     * enough that a run is not parked past the point where its user has given up
     * and retriggered it by hand.
     */
    private val MAX_BACKOFF_MS =
        System.getenv("PROVIDER_BACKOFF_MAX_MS")?.toLongOrNull() ?: 300_000L

    /**
     * Below this, backing off in place costs less than a suspend/resume round
     * trip through Postgres and the claim.
     *
     * Suspending is not free — it writes a timer row, releases the permit,
     * re-queues, re-claims, and reloads the checkpoint. For a 200ms pause that is
     * far more expensive than simply waiting, and it churns the queue for nothing.
     */
    private val SUSPEND_THRESHOLD_MS =
        System.getenv("PROVIDER_SUSPEND_THRESHOLD_MS")?.toLongOrNull() ?: 2_000L

    /**
     * How far above a computed delay the jitter window extends.
     *
     * 0.5 — a 60-second `Retry-After` becomes a uniform draw across 60-90s. Wide
     * enough that fifty callers refused together land across thirty seconds
     * instead of one instant; narrow enough that nobody waits half again as long
     * as the provider asked without reason.
     */
    private val JITTER_SPREAD =
        System.getenv("PROVIDER_JITTER_SPREAD")?.toDoubleOrNull()?.coerceIn(0.05, 2.0) ?: 0.5

    /**
     * The decision.
     *
     * [suspend] false means "wait here, it is quicker"; true means "release the
     * permit and come back when the timer fires".
     */
    data class Decision(
        val delayMs: Long,
        val suspend: Boolean,
        val fromHeader: Boolean,
        val fireAt: Instant,
    ) {
        /** Copy for the run's event stream — states what happened and what happens next. */
        fun userMessage(provider: String): String = buildString {
            append("$provider is rate limiting this workspace. ")
            append(if (fromHeader) "It asked us to wait " else "Retrying after ")
            append(humanize(delayMs))
            append(if (suspend) ", so this run is paused and will resume automatically."
                   else " before retrying.")
        }

        private fun humanize(ms: Long) = when {
            ms < 1_000 -> "${ms}ms"
            ms < 60_000 -> "${ms / 1000}s"
            else -> "${ms / 60_000} minute${if (ms / 60_000 == 1L) "" else "s"}"
        }
    }

    /**
     * Decide how long to wait and whether to give the permit back.
     *
     * @param retryAfterHeader raw `Retry-After` value, if the provider sent one.
     * @param attempt          0-based retry count, for the exponential curve.
     */
    fun decide(retryAfterHeader: String?, attempt: Int): Decision {
        val fromHeader = parseRetryAfter(retryAfterHeader)
        /* The header is a floor, spread upward; the fallback is full jitter from
           zero. Both end up jittered, which is the property that matters — the
           difference is only whether the provider supplied the base. */
        val delay = fromHeader?.let { spreadAbove(it) } ?: exponentialWithJitter(attempt)
        val bounded = delay.coerceIn(0L, MAX_BACKOFF_MS)
        return Decision(
            delayMs = bounded,
            suspend = bounded >= SUSPEND_THRESHOLD_MS,
            fromHeader = fromHeader != null,
            fireAt = Instant.now().plusMillis(bounded),
        )
    }

    /**
     * Spread a delay over a window ABOVE it, never below.
     *
     * Used for `Retry-After`, where the provider has named the earliest moment we
     * may return and coming back sooner is a guaranteed second 429.
     */
    private fun spreadAbove(baseMs: Long): Long {
        if (baseMs <= 0) return jitter(0)
        val extra = (baseMs * JITTER_SPREAD).toLong().coerceAtLeast(1L)
        return baseMs + Random.nextLong(0, extra + 1)
    }

    /**
     * Full jitter on an arbitrary delay, for callers that computed their own.
     *
     * The capacity bucket's refusal needs this: its `retryAfterMs` is
     * `ceil(deficit × 60000 / refill)`, which is fully deterministic, so N callers
     * refused at one instant with equal deficits would all come back together —
     * the bucket reproducing, from its own arithmetic, the resynchronisation it
     * exists to prevent.
     *
     * A uniform draw from [delay, delay × (1 + spread)]. Above the computed delay
     * rather than around it, because below it the capacity genuinely is not there
     * yet and the caller would simply be refused again.
     */
    fun jitter(delayMs: Long): Long {
        if (delayMs <= 0) return 0
        val extra = (delayMs * JITTER_SPREAD).toLong().coerceAtLeast(1L)
        return (delayMs + Random.nextLong(0, extra + 1)).coerceAtMost(MAX_BACKOFF_MS)
    }

    /**
     * `Retry-After` in either documented form.
     *
     * Returns null rather than throwing on anything unrecognised: a malformed
     * header from a provider is their bug, and falling back to our own curve is
     * strictly better than failing the call over it.
     */
    private fun parseRetryAfter(header: String?): Long? {
        val raw = header?.trim()?.takeIf { it.isNotEmpty() } ?: return null

        // delta-seconds — the common form.
        raw.toLongOrNull()?.let { return (it * 1000).coerceAtLeast(0) }

        // HTTP-date.
        return try {
            val at = java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME
                .parse(raw, Instant::from)
            Duration.between(Instant.now(), at).toMillis().coerceAtLeast(0)
        } catch (_: DateTimeParseException) {
            log.debug("[throttle] unparseable Retry-After '{}' — using backoff curve", raw)
            null
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Exponential backoff with EQUAL jitter: `cap/2 + random(0, cap/2)`.
     *
     * ── WHAT THIS REPLACED, AND WHY IT LOOKED CORRECT ───────────────────────
     * It was `Random.nextLong(BASE, cap)` with `cap = BASE shl attempt`. At
     * attempt 0 — which is what every caller passed, because the call site
     * hardcoded it — that is `Random.nextLong(1000, 1001)`, and the upper bound is
     * exclusive. It returned exactly 1000, always, for every caller. The jitter
     * was arithmetically eliminated while reading as present, and the class
     * comment above it explained why jitter mattered.
     *
     * `ThrottleResynchronisationTest` asserts the spread rather than the presence
     * of a `Random` call, which is the only way that defect surfaces.
     *
     * ── WHY EQUAL JITTER AND NOT FULL ───────────────────────────────────────
     * Full jitter draws from [0, cap], which is the better choice when the
     * contended resource might be free again immediately. A rate limit is not
     * that: the provider has just said "too fast", and a caller that draws near
     * zero is guaranteed a second 429 and has spent a request finding out. Equal
     * jitter keeps a floor of half the cap and still spreads callers across a
     * window half the cap wide, which is decorrelation without the wasted
     * attempts.
     */
    private fun exponentialWithJitter(attempt: Int): Long {
        val cap = (BASE_BACKOFF_MS shl attempt.coerceIn(0, 10)).coerceAtMost(MAX_BACKOFF_MS)
        val half = (cap / 2).coerceAtLeast(1L)
        return half + Random.nextLong(0, half + 1)
    }
}
