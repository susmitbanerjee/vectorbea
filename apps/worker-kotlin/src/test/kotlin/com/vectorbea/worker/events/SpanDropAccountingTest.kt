package com.vectorbea.worker.events

import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.testsupport.Infra
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The drop counters are real, exposed, and survive the process.
 *
 * ── WHAT WENT WRONG ─────────────────────────────────────────────────────────
 * The Debug tab showed an amber banner saying spans "were dropped while the
 * writer was under pressure". It had no signal for that claim: `droppedCount()`
 * was read by nothing, `spansDropped` was declared but never rendered to
 * `/metrics`, and `RunEventStore` had no counter at all. The page was asserting a
 * cause from a boolean that meant something else entirely — on a run it
 * simultaneously called complete and successful.
 *
 * So this test asserts the whole chain, because each link failed independently:
 *   1. Pressure really produces drops.
 *   2. The drop is attributed to the RUN that lost it, in Postgres, so the
 *      answer outlives the worker that knew it.
 *   3. The counters appear in the Prometheus exposition.
 */
@Tag("integration")
class SpanDropAccountingTest {

    private val ds = Infra.postgres

    private fun seedRun(): Triple<UUID, UUID, UUID> {
        val ws = UUID.randomUUID(); val env = UUID.randomUUID(); val run = UUID.randomUUID()
        val wf = UUID.randomUUID(); val ver = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, ws); it.setString(2, "drops"); it.setString(3, "drops-$ws"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, env); it.setObject(2, ws); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, wf); it.setObject(2, ws); it.setObject(3, env)
                it.setString(4, "wf-$wf"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, ver); it.setObject(2, wf); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id,status) " +
                "VALUES (?,?,?,?,?,'succeeded')"
            ).use {
                it.setObject(1, run); it.setObject(2, ws); it.setObject(3, env)
                it.setObject(4, wf); it.setObject(5, ver); it.executeUpdate()
            }
        }
        return Triple(ws, env, run)
    }

    private fun cleanup(ws: UUID, run: UUID) = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM run_spans WHERE run_id=?").use { it.setObject(1, run); it.executeUpdate() }
            c.prepareStatement("DELETE FROM workspaces WHERE id=?").use { it.setObject(1, ws); it.executeUpdate() }
        }
    }

    private fun droppedSpansOf(run: UUID): Int = ds.connection.use { c ->
        c.prepareStatement("SELECT dropped_spans FROM agent_runs WHERE id=?").use { st ->
            st.setObject(1, run)
            st.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else -1 }
        }
    }

    private fun span(run: UUID, ws: UUID) = SpanWriter.SpanRecord(
        spanId = UUID.randomUUID(), traceId = run, runId = run, parentSpanId = null,
        workspaceId = ws, kind = "step", name = "n", status = "ok",
        startedAt = Instant.now(), endedAt = Instant.now(),
    )

    /**
     * Forced buffer pressure produces a count on the run, not just in a heap.
     *
     * The writer is never started, so nothing drains: capacity 4 means spans 5..20
     * hit a full queue. That is the same code path as a real overload — `emit`
     * cannot tell the difference between "the drainer is behind" and "there is no
     * drainer".
     */
    @Test
    fun `spans dropped under pressure are counted against the run`() {
        val (ws, _, run) = seedRun()
        try {
            val w = SpanWriter(ds, null, enabled = true, capacity = 4)
            repeat(20) { w.emit(span(run, ws)) }

            assertEquals(0, droppedSpansOf(run),
                "nothing is written until a flush — drops accumulate in memory first")

            w.flush()

            assertEquals(16, droppedSpansOf(run),
                "20 emitted, 4 queued, 16 refused — and every one attributed to this run")
        } finally { cleanup(ws, run) }
    }

    /**
     * Shutdown is the likeliest cause of a partial trace and used to be the one
     * that vanished: `stop()` counted abandoned spans to a process-wide metric and
     * then the process ended. A deploy rolling a worker mid-run is precisely when
     * somebody later asks "is this trace all of it".
     */
    @Test
    fun `spans abandoned at shutdown are attributed before the process dies`() {
        val (ws, _, run) = seedRun()
        try {
            /* A dead datasource would make writeBatch fail; instead give it a real
               one and no drainer, so `stop` finds a full queue it cannot clear in
               time. Deadline 0: everything queued is abandoned. */
            val w = SpanWriter(ds, null, enabled = true, capacity = 8)
            w.start()
            repeat(8) { w.emit(span(run, ws)) }
            w.stop(timeoutMs = 0)

            assertTrue(droppedSpansOf(run) > 0,
                "spans abandoned at shutdown must land on the run, got ${droppedSpansOf(run)}")
        } finally { cleanup(ws, run) }
    }

    /**
     * All three counters reach Prometheus.
     *
     * `spansDropped` and `spansWritten` were declared and never added to the
     * exposition list, so they existed only to a debugger. This asserts the
     * rendered text, which is the only place the claim can be checked.
     */
    @Test
    fun `all three drop counters appear in the exposition`() {
        WorkerMetrics.spansDropped.inc("buffer_full")
        WorkerMetrics.eventsDropped.inc("write_failed")
        WorkerMetrics.traceExportsDropped.inc("queue_full")

        val text = WorkerMetrics.scrape()
        listOf(
            "worker_trace_spans_dropped",
            "worker_run_events_dropped",
            "worker_trace_exports_dropped",
            "worker_trace_spans_written",
        ).forEach {
            assertTrue(text.contains(it), "$it is missing from /metrics — a counter nothing can read")
        }
        /* Labelled by reason: an alert for "the database refused writes" must be
           distinguishable from "we were briefly busy". */
        assertTrue(Regex("""worker_run_events_dropped_total\{[^}]*cause="write_failed"""").containsMatchIn(text),
            "the cause label must be exposed, not folded into one series:\n$text")
    }
}
