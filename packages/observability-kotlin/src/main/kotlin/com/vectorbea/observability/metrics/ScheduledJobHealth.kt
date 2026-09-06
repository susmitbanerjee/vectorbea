package com.vectorbea.observability.metrics

import java.util.concurrent.ConcurrentHashMap

/**
 * Liveness for every background loop, in one place.
 *
 * ── THE FAILURE THIS EXISTS TO PREVENT ───────────────────────────────────────
 * Eight loops run on fixed delays across the API and the worker. Until this existed,
 * a loop that stopped was INVISIBLE. Not "hard to notice" — invisible: no metric, no
 * log after the last successful pass, nothing that changes when a scheduler thread
 * dies. The consequence surfaced weeks or months later as something else entirely.
 * Partitions that were never created show up as a query that suddenly scans the
 * default partition. Retention that never ran shows up as a bill, or as data that
 * should have been deleted and was not.
 *
 * That is the pattern behind the uncalled functions in V028 and V046, and it is not a
 * bug in those migrations — it is a missing sense. A system with no way to notice a
 * job stopping will keep producing them.
 *
 * ── WHY ONE PRIMITIVE AND NOT EIGHT BESPOKE CHECKS ───────────────────────────
 * A per-job check has to be written per job, which means the next job written is the
 * next one unmonitored. Registering here is one line at the call site, the alert is
 * written once against the label, and a job added next year is covered the day it
 * ships without anyone editing an alert file.
 *
 * ── WHY REGISTRATION SEEDS A TIMESTAMP ───────────────────────────────────────
 * The subtle case, and the one worth getting right: a job that has NEVER succeeded.
 *
 * If `job_last_success_timestamp_seconds` only appeared after the first success, then
 * a loop that was registered and never started — or that threw on every single pass
 * since boot — would have no series at all. `time() - <nothing>` is not a large
 * number, it is no result, and an alert that evaluates to nothing does not fire. The
 * worst failure would be the one that alerts least.
 *
 * So [register] publishes the series immediately, seeded with the registration time.
 * A job that never succeeds therefore goes stale exactly like one that stops, which
 * is the correct behaviour: from the outside those two are the same problem.
 */
object ScheduledJobHealth {

    /**
     * Seconds since the epoch of the last successful completion.
     *
     * A gauge and not a counter because it is a point in time, and because the alert
     * is `time() - this`, which is only meaningful against an absolute timestamp.
     */
    private val lastSuccess = gauge(
        "job_last_success_timestamp_seconds",
        "Unix timestamp of the last successful completion of a scheduled job",
        "job_name",
    )

    /**
     * The job's own expected interval, published as a series.
     *
     * This is what lets ONE alert cover jobs whose cadences differ by three orders of
     * magnitude. `TimerScheduler` polls every few seconds; `BillingScheduler` runs on
     * the order of minutes. A single hard-coded staleness threshold is necessarily
     * wrong for one of them — too slow to catch the fast job, too fast for the slow
     * one — and picking the slowest makes the alert useless for everything else.
     *
     * Publishing the interval as data moves the threshold into the rule as a ratio:
     * `> 3 * job_expected_interval_seconds`. Three missed passes, whatever a pass is
     * for that job.
     */
    private val expectedInterval = gauge(
        "job_expected_interval_seconds",
        "The scheduled interval a job expects to run at, used as the staleness baseline",
        "job_name",
    )

    /** Passes attempted, by outcome. Separates "not running" from "running and failing". */
    private val runs = counter(
        "job_runs",
        "Scheduled job passes, by outcome",
        "job_name", "outcome",
    )

    /**
     * How long a pass takes.
     *
     * Matters more than it looks: a job whose duration approaches its interval is one
     * slow pass away from overlapping itself, and `scheduleWithFixedDelay` will hide
     * that by simply running less often — which reads as a healthy job running at
     * half its cadence.
     */
    private val duration = secondsHistogram(
        "job_duration_seconds",
        "Duration of a scheduled job pass",
        "job_name",
    )

    /** Registered jobs, so a double registration is a no-op rather than a reset. */
    private val registered = ConcurrentHashMap<String, Long>()

    /**
     * Declare a job before it starts running.
     *
     * Call this from `start()`, not from the first tick — the whole point is that a
     * job which never ticks is still visible.
     */
    fun register(jobName: String, intervalMs: Long) {
        if (registered.putIfAbsent(jobName, intervalMs) != null) return
        expectedInterval.set(intervalMs / 1000.0, jobName)
        lastSuccess.set(System.currentTimeMillis() / 1000.0, jobName)
    }

    /** Every job that has registered — read by the acceptance test, not by the runtime. */
    fun registeredJobs(): Set<String> = registered.keys.toSet()

    /**
     * Run one pass, recording outcome, duration and — on success only — the timestamp.
     *
     * NOTHING IS SWALLOWED. A throwing job still throws; this records the failure and
     * rethrows, because the existing loops each have their own catch and their own
     * logging, and quietly absorbing an exception here would change their behaviour
     * while claiming only to observe it.
     *
     * The timestamp advances on success ONLY. A job that runs every pass and fails
     * every pass must go stale — it is not doing its work, and "it is definitely
     * running" is no comfort when partitions are not being created.
     */
    fun <T> record(jobName: String, block: () -> T): T {
        val startedAt = System.nanoTime()
        passFailed.set(false)
        try {
            val result = block()
            duration.observeSeconds((System.nanoTime() - startedAt) / 1_000_000_000.0, jobName)
            if (passFailed.get()) {
                runs.inc(jobName, "failed")
            } else {
                runs.inc(jobName, "succeeded")
                lastSuccess.set(System.currentTimeMillis() / 1000.0, jobName)
            }
            return result
        } catch (t: Throwable) {
            duration.observeSeconds((System.nanoTime() - startedAt) / 1_000_000_000.0, jobName)
            runs.inc(jobName, "failed")
            throw t
        } finally {
            // The scheduler reuses its threads across jobs. A flag left set here would
            // mark the NEXT job's pass failed — a cross-job false alarm that would be
            // very hard to explain from the outside.
            passFailed.remove()
        }
    }

    /**
     * Set when a pass has already handled its own error and must not be scored a
     * success. See [markPassFailed].
     */
    private val passFailed = ThreadLocal.withInitial { false }

    /**
     * Declare the pass currently running on this thread a failure.
     *
     * ── WHY THIS IS NEEDED AT ALL ────────────────────────────────────────────
     * Every one of these loops is wrapped in its own `try { … } catch (e: Exception)
     * { log.error(…) }`, deliberately: `scheduleWithFixedDelay` CANCELS a task
     * permanently the first time it throws, so a loop that let an exception escape
     * would silently stop forever after one bad pass. Swallowing is the correct
     * behaviour and must not change.
     *
     * But it means the pass returns normally, and [record] — which can only observe
     * the return — would score a caught, logged, total failure as a success and
     * advance the freshness timestamp. The staleness alert would then be armed
     * against a job that fails every single pass while reporting perfect health.
     * That is worse than having no metric at all, because it would be believed.
     *
     * So the catch blocks say so explicitly. One line, next to the log line that is
     * already there.
     */
    fun markPassFailed() = passFailed.set(true)

    /** Test seam. Not for runtime use. */
    internal fun reset() = registered.clear()
}
