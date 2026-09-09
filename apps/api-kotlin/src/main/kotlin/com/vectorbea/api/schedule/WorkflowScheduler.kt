package com.vectorbea.api.schedule

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.ingress.RunIngress
import com.vectorbea.api.ingress.TriggerActor
import com.vectorbea.api.ingress.TriggerSource
import com.vectorbea.observability.metrics.ScheduledJobHealth
import org.slf4j.LoggerFactory
import java.time.Duration
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Fires cron and interval schedules.
 *
 * Every [pollIntervalMs] it scans for due schedules and, for each, atomically
 * claims it — advancing `next_fire_at` past the threshold — before starting a
 * run. The claim is a guarded UPDATE, so with several API instances running this
 * loop each occurrence fires exactly once with no external lock.
 *
 * ── WHAT CHANGED, AND WHY IT MATTERED ───────────────────────────────────────
 * This class used to create runs itself: `runRepo.create`, two events, enqueue.
 * That is a subset of what the API path does, and the missing parts were every
 * plan check in the product — quota, workspace quota, member spend, admission,
 * rate limit and metering. An account with a spent quota kept running its crons,
 * for free, forever. Not because anybody decided that; because the admission
 * sequence lived inside a route handler and could not be called from here.
 *
 * It now calls [RunIngress] like every other ingress path, and a schedule that
 * is over quota is refused with the same message an API caller would get.
 *
 * ── AND THE MISSED-WINDOW QUESTION ──────────────────────────────────────────
 * `misfire_policy` has been on the table since V001 and nothing read it. After
 * an outage this loop advanced to the next occurrence after `now` and fired
 * once — correct for a health check, wrong for an hourly export, and not a
 * choice anybody could make. See [CatchupPolicy].
 */
class WorkflowScheduler(
    private val schedules: ScheduleRepository,
    private val ingress: RunIngress,
    private val pollIntervalMs: Long = 30_000L,
) {
    private val log = LoggerFactory.getLogger(WorkflowScheduler::class.java)
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "workflow-scheduler").also { it.isDaemon = true }
    }
    private var future: ScheduledFuture<*>? = null

    private companion object {
        const val JOB_NAME = "workflow-scheduler"

        /**
         * How far back a backfill will reach, whatever the cap says.
         *
         * A schedule disabled for a month and re-enabled should not fire a
         * month of history: the runs would all be answering questions nobody is
         * still asking, and the first thing an operator would do is cancel them.
         * The cap bounds the count; this bounds the age.
         */
        val MAX_BACKFILL_AGE: Duration = Duration.ofHours(24)
    }

    fun start() {
        if (running.compareAndSet(false, true)) {
            ScheduledJobHealth.register(JOB_NAME, pollIntervalMs)
            future = executor.scheduleWithFixedDelay(
                { ScheduledJobHealth.record(JOB_NAME) { tick() } },
                10_000L, pollIntervalMs, TimeUnit.MILLISECONDS)
            log.info("[scheduler] started (pollInterval={}ms)", pollIntervalMs)
        }
    }

    fun stop() {
        running.set(false)
        future?.cancel(false)
        executor.shutdown()
        log.info("[scheduler] stopped")
    }

    /** Exposed for tests: one pass, synchronously. Returns how many runs it started. */
    fun tick(): Int {
        if (!running.get() && future != null) return 0
        return try {
            val now = Instant.now()
            val due = schedules.listDue(now, limit = 100)
            if (due.isEmpty()) return 0
            log.info("[scheduler] {} schedule(s) due", due.size)
            due.sumOf { fireDue(it, now) }
        } catch (e: Exception) {
            log.error("[scheduler] tick failed: {}", e.message)
            ScheduledJobHealth.markPassFailed()
            0
        }
    }

    /**
     * Decide what this schedule owes, claim it, and start that many runs.
     *
     * The order is the same as it was and for the same reason: the overlap check
     * runs BEFORE the claim, so a skipped occurrence still advances
     * `next_fire_at`. Skipping without advancing would leave the schedule
     * permanently due and re-evaluated on every tick, forever.
     */
    private fun fireDue(s: Schedule, now: Instant): Int {
        val cadence = Cadence.of(s)
        if (cadence == null) {
            /*
             * An unparseable cron and no interval. Park it by claiming with a null
             * next fire — it stops being due, and the row keeps the expression so
             * somebody can see what is wrong. Firing it "just in case" would run a
             * workflow on a cadence nobody chose.
             */
            log.warn("[scheduler] schedule {} has no usable cadence (cron='{}', interval={}) — parking",
                s.id, s.cronExpression, s.intervalSeconds)
            schedules.claimAndAdvance(s.id, threshold = now, firedAt = now, nextFireAt = null)
            return 0
        }

        val policy = CatchupPolicy.of(s.misfirePolicy)
        val occurrences = owedOccurrences(s, cadence, policy, now)
        val nextFire = cadence.nextAfter(now)

        // The overlap policy, checked before the claim.
        //   skip             the previous run is still going; do not start another.
        //                    The default, and right for a sync job where two
        //                    concurrent copies corrupt each other.
        //   queue            fire anyway; admission and the per-tenant cap decide
        //                    when it actually runs.
        //   allow_concurrent fire, no check.
        val overlapping = s.overlapPolicy == "skip" &&
            runCatching { schedules.previousRunActive(s.id) }.getOrDefault(false)

        // Atomically claim. Only the winner advances and fires.
        val claimedOccurrence = occurrences.lastOrNull() ?: now
        if (!schedules.claimAndAdvance(
                s.id, threshold = now, firedAt = now,
                nextFireAt = nextFire, occurrenceAt = claimedOccurrence)) {
            return 0
        }

        if (overlapping) {
            log.info("[scheduler] schedule {} skipped — previous run still in flight " +
                "(overlap_policy=skip)", s.id)
            return 0
        }
        if (occurrences.isEmpty()) {
            log.info("[scheduler] schedule {} had {} missed occurrence(s) and policy '{}' — " +
                "nothing fired", s.id, "some", policy.wire)
            return 0
        }

        var started = 0
        for (occurrence in occurrences) {
            if (fire(s, occurrence, cadence, occurrences.size)) started++ else break
        }
        return started
    }

    /**
     * Which occurrences this schedule owes right now.
     *
     * One element in the ordinary case — the schedule is due, and it is due once.
     * The interesting case is a gap, and the three policies disagree about it in
     * ways only the person who wrote the workflow can settle.
     */
    private fun owedOccurrences(
        s: Schedule,
        cadence: Cadence,
        policy: CatchupPolicy,
        now: Instant,
    ): List<Instant> {
        val due = s.nextFireAt ?: return listOf(now)

        /* No gap: this is the normal tick, arriving on time. `last_occurrence_at`
           is irrelevant here — there is exactly one occurrence to fire and it is
           the one that came due. */
        val gapStart = s.lastOccurrenceAt ?: due
        val missedWindow = Duration.between(gapStart, now)
        val onTime = missedWindow <= Duration.ofSeconds(
            (s.intervalSeconds?.toLong() ?: 60L) + 60L)
        if (onTime) return listOf(due)

        return when (policy) {
            /* The window is gone. Nothing fires now; the next occurrence fires
               normally. A run for 03:15 executed at 09:00 is answering a question
               nobody is still asking. */
            CatchupPolicy.SKIP -> {
                log.info("[scheduler] schedule {} missed {} — policy 'skip', firing nothing",
                    s.id, humanize(missedWindow))
                emptyList()
            }

            /* One run, now. What this loop already did before the policy was read,
               so no existing schedule changes behaviour on deploy. */
            CatchupPolicy.FIRE_ONCE -> listOf(due)

            /* Every missed occurrence, oldest first — bounded twice, by count and
               by age, because the alternative is a schedule that ran every minute
               through a two-day outage enqueueing 2880 runs at the exact moment
               the platform is coming back up. */
            CatchupPolicy.BACKFILL -> {
                val floor = maxOf(gapStart, now.minus(MAX_BACKFILL_AGE))
                val cap = s.catchupMaxRuns.coerceIn(1, 1_000)
                val list = cadence.occurrencesBetween(floor, now, cap)
                log.info("[scheduler] schedule {} missed {} — backfilling {} occurrence(s) (cap {})",
                    s.id, humanize(missedWindow), list.size, cap)
                list.ifEmpty { listOf(due) }
            }
        }
    }

    /**
     * Start one run for one occurrence.
     *
     * @return false when the ingress refused, which stops a backfill rather than
     *   grinding through the remaining occurrences collecting the same refusal.
     *   A quota rejection is about the account, not about this occurrence, so the
     *   next one will be refused too — and 10 identical rejections in the log say
     *   nothing the first one did not.
     */
    private fun fire(s: Schedule, occurrence: Instant, cadence: Cadence, batchSize: Int): Boolean {
        return try {
            val started = ingress.start(RunIngress.Request(
                workspaceId = s.workspaceId,
                workflowId = s.workflowId,
                environmentId = s.environmentId,
                inputJson = "{}",
                source = TriggerSource.SCHEDULE,
                /* No user: an owner's 09:00 cron is not any member's spend. See
                   TriggerActor — the null is the decision, not a gap. */
                actor = TriggerActor(triggerRef = s.id),
                /*
                 * ── THE OCCURRENCE IS THE IDEMPOTENCY KEY ───────────────────
                 * Two API instances can both pass the claim if the first one's
                 * UPDATE has not committed when the second reads. The claim makes
                 * that vanishingly unlikely; the key makes it impossible. And it
                 * survives the case the claim cannot see at all: a backfill that
                 * is interrupted and retried, where the same occurrence is owed
                 * twice by two different ticks.
                 */
                idempotencyKey = "schedule:${s.id}:${occurrence.epochSecond}",
                reason = if (batchSize > 1)
                    "Backfilled occurrence ${occurrence} (${cadence.describe()})"
                else
                    "Triggered by schedule (${cadence.describe()})",
            ))
            runCatching { schedules.setActiveRun(s.id, started.runId) }
            log.info("[scheduler] fired schedule {} occurrence {} → run {}",
                s.id, occurrence, started.runId)
            true
        } catch (e: ApiError) {
            /*
             * A refusal, not a crash. Recorded on the schedule's own terms so an
             * operator looking at "why did my cron stop" sees the plan message
             * rather than an absence.
             */
            log.warn("[scheduler] schedule {} refused: {} ({})", s.id, e.message, e.code)
            false
        } catch (e: Exception) {
            log.error("[scheduler] firing schedule {} failed: {}", s.id, e.message)
            false
        }
    }

    private fun humanize(d: Duration): String = when {
        d.toDays() > 0 -> "${d.toDays()}d"
        d.toHours() > 0 -> "${d.toHours()}h"
        d.toMinutes() > 0 -> "${d.toMinutes()}m"
        else -> "${d.seconds}s"
    }
}
