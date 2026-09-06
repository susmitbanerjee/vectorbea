package com.vectorbea.observability

import com.vectorbea.observability.metrics.MetricsRegistry
import com.vectorbea.observability.metrics.ScheduledJobHealth
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/**
 * The staleness alert is only as good as this class, and its two most important
 * behaviours are both invisible in normal operation:
 *
 *  - a job that has NEVER succeeded must still publish a series, or the alert has
 *    nothing to evaluate and the worst failure alerts least;
 *  - a job that catches its own exception must NOT be scored a success, or the alert
 *    is armed against something that reports perfect health while failing every pass.
 *
 * Neither shows up in a passing deployment. Both are asserted here.
 */
class ScheduledJobHealthTest {

    private fun scrape() = MetricsRegistry.scrape()

    private fun sampleValue(family: String, jobName: String): Double? =
        scrape().lineSequence()
            .firstOrNull { it.startsWith("$family{") && it.contains("job_name=\"$jobName\"") }
            ?.substringAfterLast(' ')
            ?.toDoubleOrNull()

    @Test
    fun `registration publishes a timestamp before the job has ever run`() {
        ScheduledJobHealth.register("test-never-ran", 60_000)

        // The whole point. Without a series here, `time() - job_last_success_...`
        // returns no result, an alert on no result does not fire, and a job that never
        // started once is the one thing that never pages anyone.
        val ts = sampleValue("job_last_success_timestamp_seconds", "test-never-ran")
        assertNotNull(ts, "a registered job must publish a timestamp immediately")
        assertTrue(ts!! > 1_700_000_000.0, "timestamp should be a plausible epoch second, was $ts")

        // And the interval, which is what lets one alert serve jobs whose cadences
        // differ by three orders of magnitude.
        assertEquals(60.0, sampleValue("job_expected_interval_seconds", "test-never-ran"))
    }

    @Test
    fun `a successful pass advances the timestamp`() {
        ScheduledJobHealth.register("test-success", 1_000)
        val before = sampleValue("job_last_success_timestamp_seconds", "test-success")!!
        Thread.sleep(1_100)

        ScheduledJobHealth.record("test-success") { "done" }

        val after = sampleValue("job_last_success_timestamp_seconds", "test-success")!!
        assertTrue(after > before, "success must move the timestamp forward ($before -> $after)")
        assertEquals(1.0, sampleValue("job_runs_total", "test-success"))
    }

    @Test
    fun `a throwing pass rethrows and does not advance the timestamp`() {
        ScheduledJobHealth.register("test-throws", 1_000)
        val before = sampleValue("job_last_success_timestamp_seconds", "test-throws")!!
        Thread.sleep(1_100)

        // Rethrown, not swallowed. These loops each have their own catch and their own
        // logging; absorbing an exception here would change behaviour while claiming
        // only to observe it.
        assertThrows(IllegalStateException::class.java) {
            ScheduledJobHealth.record<Unit>("test-throws") { throw IllegalStateException("boom") }
        }

        assertEquals(before, sampleValue("job_last_success_timestamp_seconds", "test-throws"),
            "a failed pass must not advance the freshness timestamp")
    }

    @Test
    fun `a pass that handled its own error is not scored a success`() {
        ScheduledJobHealth.register("test-swallows", 1_000)
        val before = sampleValue("job_last_success_timestamp_seconds", "test-swallows")!!
        Thread.sleep(1_100)

        // This is what every real loop looks like: `scheduleWithFixedDelay` cancels a
        // task permanently the first time it throws, so they all catch. The pass then
        // returns normally, and without markPassFailed the timestamp would advance on
        // a total failure.
        ScheduledJobHealth.record("test-swallows") {
            try {
                throw IllegalStateException("caught internally, as the real loops do")
            } catch (e: Exception) {
                ScheduledJobHealth.markPassFailed()
            }
        }

        assertEquals(before, sampleValue("job_last_success_timestamp_seconds", "test-swallows"),
            "a caught-and-logged failure must not read as a success")
    }

    @Test
    fun `the failed flag does not leak into the next job on the same thread`() {
        ScheduledJobHealth.register("test-leak-a", 1_000)
        ScheduledJobHealth.register("test-leak-b", 1_000)
        val before = sampleValue("job_last_success_timestamp_seconds", "test-leak-b")!!
        Thread.sleep(1_100)

        // Schedulers reuse threads. A flag left set by one job would mark the next
        // job's pass failed — a cross-job false alarm that is very hard to explain
        // from the outside, because the job it names is genuinely fine.
        ScheduledJobHealth.record("test-leak-a") { ScheduledJobHealth.markPassFailed() }
        ScheduledJobHealth.record("test-leak-b") { "fine" }

        assertTrue(sampleValue("job_last_success_timestamp_seconds", "test-leak-b")!! > before,
            "job B succeeded and must be recorded as such")
    }

    @Test
    fun `re-registering does not reset an existing job`() {
        ScheduledJobHealth.register("test-reregister", 1_000)
        Thread.sleep(1_100)
        ScheduledJobHealth.record("test-reregister") { }
        val afterSuccess = sampleValue("job_last_success_timestamp_seconds", "test-reregister")!!

        // Two workers in one process, or a restarted loop, must not roll the timestamp
        // back to registration time and manufacture staleness.
        ScheduledJobHealth.register("test-reregister", 1_000)

        assertEquals(afterSuccess, sampleValue("job_last_success_timestamp_seconds", "test-reregister"),
            "re-registration must be a no-op, not a reset")
    }

    @Test
    fun `metrics reach the scrape output`() {
        ScheduledJobHealth.register("test-exposed", 30_000)
        val body = scrape()

        // The failure this guards against is specific and has happened in this repo:
        // a metric declared, incremented at a real call site, and never added to the
        // list that renders. It is correct in the debugger and absent on the wire.
        for (family in listOf(
            "job_last_success_timestamp_seconds",
            "job_expected_interval_seconds",
            "job_runs_total",
            "job_duration_seconds",
        )) {
            assertTrue(body.contains("# TYPE $family"),
                "$family must appear in the scrape output, not just in the registry")
        }
    }
}
