package com.vectorbea.api.schedule

import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

/**
 * When a schedule is due, whether it is written as cron or as an interval.
 *
 * ── WHY BOTH, AND WHY ONE TYPE ──────────────────────────────────────────────
 * "Every 90 seconds" is not expressible in cron. The workaround people reach
 * for is a one-minute cron with a guard inside the workflow, which bills a run
 * to discover it should not have started — and puts the cadence somewhere the
 * schedules screen cannot show it.
 *
 * They are one type here rather than two branches at every call site because
 * the scheduler asks exactly two questions of a cadence, and both have an
 * answer in either form: when is the next one, and which ones did we miss.
 */
sealed interface Cadence {

    /** The next occurrence strictly after [from], or null if there will never be one. */
    fun nextAfter(from: Instant): Instant?

    /**
     * Occurrences in `(after, until]`, oldest first, at most [cap] of them.
     *
     * The list a catch-up decision is made from. Bounded by construction: an
     * unbounded version of this, called after a two-day outage on a
     * once-a-minute schedule, returns 2880 timestamps and the caller turns them
     * into 2880 runs at the moment the platform is least able to take them.
     */
    fun occurrencesBetween(after: Instant, until: Instant, cap: Int): List<Instant>

    /** For a log line and the schedules screen. */
    fun describe(): String

    /** Cron, in the schedule's own timezone — which is the point of a cron. */
    data class Cron(val expression: String, val zone: ZoneId) : Cadence {
        private val parsed = CronExpression.parse(expression)

        override fun nextAfter(from: Instant): Instant? = parsed.nextAfter(from, zone)

        override fun occurrencesBetween(after: Instant, until: Instant, cap: Int): List<Instant> {
            val out = mutableListOf<Instant>()
            var cursor = after
            while (out.size < cap) {
                val next = parsed.nextAfter(cursor, zone) ?: break
                if (next > until) break
                out += next
                cursor = next
            }
            return out
        }

        override fun describe(): String = "cron '$expression' in $zone"
    }

    /**
     * A fixed period.
     *
     * ── ANCHORED TO THE LAST OCCURRENCE, NOT TO NOW ─────────────────────────
     * `nextAfter(from) = from + period` looks obviously right and drifts: each
     * fire happens a little after its due time, and anchoring the next one to
     * that actual moment accumulates the lateness. Over a day a 60-second
     * schedule loses minutes. Stepping from a fixed origin instead keeps the
     * cadence honest — the same reason the cron jitter is applied in the due
     * predicate rather than baked into `next_fire_at`.
     */
    data class Every(val period: Duration, val origin: Instant) : Cadence {

        override fun nextAfter(from: Instant): Instant {
            val seconds = period.seconds.coerceAtLeast(1)
            val elapsed = Duration.between(origin, from).seconds
            /* +1 so the answer is strictly after `from` even when `from` lands
               exactly on an occurrence, which is what happens when the scheduler
               is running on time. */
            val steps = Math.floorDiv(elapsed, seconds) + 1
            return origin.plusSeconds(steps * seconds)
        }

        override fun occurrencesBetween(after: Instant, until: Instant, cap: Int): List<Instant> {
            val out = mutableListOf<Instant>()
            var cursor = nextAfter(after)
            while (out.size < cap && !cursor.isAfter(until)) {
                out += cursor
                cursor = cursor.plusSeconds(period.seconds.coerceAtLeast(1))
            }
            return out
        }

        override fun describe(): String = "every ${period.seconds}s"
    }

    companion object {
        /**
         * Read a schedule's cadence, or null if it has neither a usable cron nor
         * an interval.
         *
         * Null rather than a default: a schedule whose cron does not parse must
         * be parked and reported, not quietly turned into something that fires.
         */
        fun of(schedule: Schedule): Cadence? {
            schedule.intervalSeconds?.let { seconds ->
                if (seconds <= 0) return null
                /* The origin is the schedule's creation, so the phase of an
                   interval schedule is stable across restarts and across the
                   several API instances running this loop. Using `now` would give
                   every instance a different idea of when the next one is due. */
                return Every(Duration.ofSeconds(seconds.toLong()), schedule.createdAt)
            }
            val expr = schedule.cronExpression.takeIf { it.isNotBlank() } ?: return null
            val zone = runCatching { ZoneId.of(schedule.timezone) }.getOrDefault(ZoneOffset.UTC)
            return runCatching { Cron(expr, zone) }.getOrNull()
        }
    }
}

/**
 * What a schedule owes after downtime.
 *
 * The column has existed since V001 as `misfire_policy` and nothing ever read
 * it — a deployment could set it, see it in the database and watch it change
 * nothing. See V066.
 */
enum class CatchupPolicy(val wire: String) {
    /** Forget the missed window. Right for a health check: a run for 03:15 executed at 09:00 answers a stale question. */
    SKIP("skip"),

    /** One run now, then resume the cadence. The default, and what the scheduler already did. */
    FIRE_ONCE("fire_once"),

    /** Every missed occurrence, oldest first, capped. Right for a per-period export where a skipped hour is a hole in somebody's data. */
    BACKFILL("backfill");

    companion object {
        private val BY_WIRE = entries.associateBy { it.wire }

        /** Unknown values read as the default rather than throwing: a schedule with a bad policy should still fire. */
        fun of(value: String?): CatchupPolicy = BY_WIRE[value?.lowercase()] ?: FIRE_ONCE
    }
}
