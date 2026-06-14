package com.vectorbea.api.schedule

import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.temporal.ChronoUnit

/**
 * Minimal standard 5-field cron parser: "minute hour day-of-month month day-of-week".
 *
 * Supports '*', step '*\/n', ranges 'a-b', lists 'a,b', and 'a-b/n'. It does NOT
 * support seconds, named months/days, or the special tokens '?'/'L'/'W'/'#'.
 *
 * Day-of-month and day-of-week follow standard cron OR semantics: when BOTH are
 * restricted (neither is '*'), a row fires if EITHER matches.
 */
class CronExpression private constructor(
    private val minutes: Set<Int>,
    private val hours: Set<Int>,
    private val daysOfMonth: Set<Int>,
    private val months: Set<Int>,
    private val daysOfWeek: Set<Int>,
    private val domRestricted: Boolean,
    private val dowRestricted: Boolean,
) {
    fun matches(t: ZonedDateTime): Boolean {
        if (t.minute !in minutes) return false
        if (t.hour !in hours) return false
        if (t.monthValue !in months) return false
        val domMatch = t.dayOfMonth in daysOfMonth
        // java.time: Monday=1 … Sunday=7; cron wants Sunday=0.
        val dowMatch = (t.dayOfWeek.value % 7) in daysOfWeek
        return when {
            domRestricted && dowRestricted -> domMatch || dowMatch
            domRestricted                  -> domMatch
            dowRestricted                  -> dowMatch
            else                           -> true
        }
    }

    /**
     * The next fire time strictly after [from], evaluated in [zone].
     * Returns null if no match occurs within ~5 years (e.g. an impossible expression).
     */
    fun nextAfter(from: Instant, zone: ZoneId): Instant? {
        var t = from.atZone(zone).truncatedTo(ChronoUnit.MINUTES).plusMinutes(1)
        val limit = t.plusYears(5)
        while (t.isBefore(limit)) {
            if (matches(t)) return t.toInstant()
            t = t.plusMinutes(1)
        }
        return null
    }

    companion object {
        fun parse(expr: String): CronExpression {
            val parts = expr.trim().split(Regex("\\s+"))
            require(parts.size == 5) { "Cron must have 5 fields (got ${parts.size}): '$expr'" }
            return CronExpression(
                minutes     = field(parts[0], 0, 59),
                hours       = field(parts[1], 0, 23),
                daysOfMonth = field(parts[2], 1, 31),
                months      = field(parts[3], 1, 12),
                // Accept 7 as Sunday and normalise to 0.
                daysOfWeek  = field(parts[4], 0, 7).map { it % 7 }.toSortedSet(),
                domRestricted = parts[2].trim() != "*",
                dowRestricted = parts[4].trim() != "*",
            )
        }

        fun isValid(expr: String): Boolean = runCatching { parse(expr) }.isSuccess

        private fun field(spec: String, min: Int, max: Int): Set<Int> {
            val out = sortedSetOf<Int>()
            for (token in spec.split(",")) {
                val (rangePart, step) = if ("/" in token) {
                    val (r, s) = token.split("/", limit = 2)
                    r to (s.toIntOrNull() ?: throw IllegalArgumentException("Bad step in '$token'"))
                } else token to 1
                require(step >= 1) { "Step must be >= 1 in '$token'" }
                val (lo, hi) = when {
                    rangePart == "*" -> min to max
                    "-" in rangePart -> {
                        val (a, b) = rangePart.split("-", limit = 2)
                        a.trim().toInt() to b.trim().toInt()
                    }
                    else -> { val v = rangePart.trim().toInt(); v to v }
                }
                require(lo in min..max && hi in min..max && lo <= hi) {
                    "Value out of range in '$token' (allowed $min-$max)"
                }
                var v = lo
                while (v <= hi) { out.add(v); v += step }
            }
            require(out.isNotEmpty()) { "Empty cron field '$spec'" }
            return out
        }
    }
}
