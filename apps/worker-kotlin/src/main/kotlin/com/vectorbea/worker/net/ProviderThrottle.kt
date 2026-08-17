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
        val delay = fromHeader ?: exponentialWithJitter(attempt)
        val bounded = delay.coerceIn(0L, MAX_BACKOFF_MS)
        return Decision(
            delayMs = bounded,
            suspend = bounded >= SUSPEND_THRESHOLD_MS,
            fromHeader = fromHeader != null,
            fireAt = Instant.now().plusMillis(bounded),
        )
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
     * Exponential backoff with full jitter.
     *
     * Full jitter — a uniform draw from [0, cap] rather than cap ± a little — is
     * what actually decorrelates callers. Adding a small random delta to a
     * common base still leaves every caller in roughly the same window, which is
     * the thundering herd with extra steps.
     */
    private fun exponentialWithJitter(attempt: Int): Long {
        val cap = (BASE_BACKOFF_MS shl attempt.coerceIn(0, 10)).coerceAtMost(MAX_BACKOFF_MS)
        return Random.nextLong(BASE_BACKOFF_MS, cap.coerceAtLeast(BASE_BACKOFF_MS + 1))
    }
}
