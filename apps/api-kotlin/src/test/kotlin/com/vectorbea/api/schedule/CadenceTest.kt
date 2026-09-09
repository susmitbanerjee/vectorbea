package com.vectorbea.api.schedule

import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * When a schedule is due, and what it owes after downtime.
 *
 * These are pure functions over a clock, so they are tested without a database —
 * and they are the two questions the scheduler asks, so getting them wrong is
 * either a missed run or a flood of them.
 */
class CadenceTest {

    private val utc = ZoneId.of("UTC")
    private val origin = Instant.parse("2026-01-01T00:00:00Z")

    private fun schedule(
        cron: String = "",
        intervalSeconds: Int? = null,
        timezone: String = "UTC",
        misfire: String = "fire_once",
        createdAt: Instant = origin,
    ) = Schedule(
        id = UUID.randomUUID(),
        workspaceId = UUID.randomUUID(),
        environmentId = UUID.randomUUID(),
        workflowId = UUID.randomUUID(),
        cronExpression = cron,
        timezone = timezone,
        enabled = true,
        nextFireAt = null,
        lastFireAt = null,
        intervalSeconds = intervalSeconds,
        misfirePolicy = misfire,
        createdAt = createdAt,
    )

    // ── Interval ─────────────────────────────────────────────────────────────

    @Test
    fun `an interval steps from a fixed origin, so it does not drift`() {
        /*
         * ── THE BUG THIS RULES OUT ──────────────────────────────────────────
         * `next = from + period` looks obviously right and drifts: each fire
         * happens a little after its due time, and anchoring the next one to that
         * actual moment accumulates the lateness. Over a day a 60-second schedule
         * loses minutes, and the 09:00 report arrives at 09:04.
         */
        val cadence = assertNotNull(Cadence.of(schedule(intervalSeconds = 60)))

        // Ten seconds LATE, as a real tick is.
        val late = origin.plusSeconds(300 + 10)
        assertEquals(
            origin.plusSeconds(360), cadence.nextAfter(late),
            "the next occurrence was anchored to when the last one actually fired, " +
                "not to the cadence — which is how a schedule walks away from the " +
                "time somebody set.",
        )
    }

    @Test
    fun `an interval occurrence is strictly after the instant asked about`() {
        val cadence = assertNotNull(Cadence.of(schedule(intervalSeconds = 60)))
        val onTheDot = origin.plusSeconds(120)
        assertEquals(
            origin.plusSeconds(180), cadence.nextAfter(onTheDot),
            "asking at exactly an occurrence returned that occurrence, so a scheduler " +
                "running on time would fire the same one forever",
        )
    }

    @Test
    fun `an interval schedule with a zero or negative period has no cadence`() {
        assertNull(Cadence.of(schedule(intervalSeconds = 0)))
        assertNull(Cadence.of(schedule(intervalSeconds = -30)))
    }

    // ── Cron ─────────────────────────────────────────────────────────────────

    @Test
    fun `a cron is evaluated in the schedule's own timezone`() {
        val ist = assertNotNull(Cadence.of(
            schedule(cron = "0 9 * * *", timezone = "Asia/Kolkata")))
        val next = assertNotNull(ist.nextAfter(Instant.parse("2026-03-01T00:00:00Z")))

        assertEquals(
            9, next.atZone(ZoneId.of("Asia/Kolkata")).hour,
            "09:00 in the schedule's timezone is the whole point of storing one",
        )
        assertEquals(3, next.atZone(utc).hour,
            "which is 03:30 UTC — if this reads 09:00 UTC the timezone was ignored")
    }

    @Test
    fun `an unparseable cron has no cadence, so the scheduler can park it`() {
        assertNull(Cadence.of(schedule(cron = "not a cron")),
            "a schedule with a broken expression must be parked and reported, not " +
                "quietly turned into something that fires")
    }

    @Test
    fun `a blank cron and no interval is not a cadence`() {
        assertNull(Cadence.of(schedule()))
    }

    // ── What a gap owes ──────────────────────────────────────────────────────

    @Test
    fun `occurrences in a gap come back oldest first`() {
        val cadence = assertNotNull(Cadence.of(schedule(intervalSeconds = 3_600)))
        val missed = cadence.occurrencesBetween(
            after = origin,
            until = origin.plus(Duration.ofHours(5)),
            cap = 10,
        )

        assertEquals(5, missed.size)
        assertEquals(missed.sorted(), missed,
            "a backfill that runs newest-first processes a period's data before the " +
                "period before it, which is wrong for exactly the export case " +
                "backfill exists for")
        assertEquals(origin.plusSeconds(3_600), missed.first())
    }

    @Test
    fun `the cap is the whole reason a backfill is safe`() {
        /*
         * A once-a-minute schedule through a two-day outage owes 2,880
         * occurrences. Firing them is a self-inflicted denial of service at the
         * exact moment the platform is coming back up.
         */
        val cadence = assertNotNull(Cadence.of(schedule(intervalSeconds = 60)))
        val missed = cadence.occurrencesBetween(
            after = origin,
            until = origin.plus(Duration.ofDays(2)),
            cap = 10,
        )
        assertEquals(10, missed.size, "the cap did not bound the backfill")
    }

    @Test
    fun `a cron backfill is bounded the same way`() {
        val cadence = assertNotNull(Cadence.of(schedule(cron = "*/5 * * * *")))
        val missed = cadence.occurrencesBetween(
            after = origin,
            until = origin.plus(Duration.ofDays(1)),
            cap = 6,
        )
        assertEquals(6, missed.size)
        assertTrue(missed.all { it > origin }, "an occurrence at or before the floor was included")
    }

    @Test
    fun `a window with no occurrences in it is empty, not an invented one`() {
        val cadence = assertNotNull(Cadence.of(schedule(intervalSeconds = 3_600)))
        val none = cadence.occurrencesBetween(
            after = origin, until = origin.plusSeconds(30), cap = 10)
        assertTrue(none.isEmpty(),
            "an occurrence was invented inside a window that contained none")
    }

    // ── The policy ───────────────────────────────────────────────────────────

    @Test
    fun `the default policy is what the scheduler already did`() {
        /*
         * `misfire_policy` has been on the table since V001 with a default of
         * `fire_once`, and nothing read it. Reading it now must not change what
         * any existing schedule does — which is only true because the default
         * matches the old hard-coded behaviour.
         */
        assertEquals(CatchupPolicy.FIRE_ONCE, CatchupPolicy.of("fire_once"))
        assertEquals(CatchupPolicy.FIRE_ONCE, CatchupPolicy.of(null),
            "a schedule with no policy changed meaning on deploy")
        assertEquals(CatchupPolicy.FIRE_ONCE, CatchupPolicy.of("nonsense"),
            "an unrecognised policy stopped a schedule firing at all; a bad value " +
                "should degrade to the default, not to silence")
    }

    @Test
    fun `every policy has a wire name that round-trips`() {
        CatchupPolicy.entries.forEach {
            assertEquals(it, CatchupPolicy.of(it.wire),
                "${it.name} does not survive a round trip through the column")
        }
    }
}
