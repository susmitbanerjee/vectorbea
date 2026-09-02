package com.vectorbea.worker.events

import com.vectorbea.worker.testsupport.noOpDataSource
import com.vectorbea.worker.testsupport.noOpPubSub
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import org.postgresql.ds.PGSimpleDataSource
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import org.junit.jupiter.api.Tag

/**
 * The shape of the trace, and the promise that producing it can never hurt a run.
 *
 * Two things are asserted here that nothing else can catch:
 *
 *  1. The exact parent/child relationships. A trace whose spans are all present but
 *     wrongly parented renders as a flat list or a wrong nesting, and every "why did
 *     this take 40 seconds" question it exists to answer becomes unanswerable.
 *  2. That an unwritable span table degrades to a counter rather than an exception.
 *     This is the property the whole buffered design exists for, and it is only
 *     provable by breaking the table.
 */
@Timeout(value = 20, unit = TimeUnit.SECONDS)
@Tag("integration")
class SpanTreeTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    /**
     * The database, or a thrown exception naming what is missing.
     *
     * This used to probe a hard-coded localhost port and return null, which
     * turned every test in this class into a silent pass on any machine
     * without it. See [Infra].
     */
    private fun dsOrNull(): DataSource? = com.vectorbea.worker.testsupport.Infra.postgres

    private fun seed(ds: DataSource): Pair<UUID, UUID> {
        val ws = UUID.randomUUID(); val run = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, ws); it.setString(2, "span-test")
                it.setString(3, "span-test-$ws"); it.executeUpdate()
            }
        }
        return ws to run
    }

    private fun cleanup(ds: DataSource, ws: UUID, run: UUID) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM run_spans WHERE run_id=?").use {
                    it.setObject(1, run); it.executeUpdate() }
                c.prepareStatement("DELETE FROM workspaces WHERE id=?").use {
                    it.setObject(1, ws); it.executeUpdate() }
            }
        }
    }

    /** span_id -> (kind, name, parent_span_id, self_ms) */
    private fun readTree(ds: DataSource, run: UUID): Map<UUID, Quad> =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT span_id, kind, name, parent_span_id, self_ms FROM run_spans WHERE run_id=?"
            ).use { st ->
                st.setObject(1, run)
                st.executeQuery().use { rs ->
                    buildMap {
                        while (rs.next()) put(
                            rs.getObject("span_id", UUID::class.java),
                            Quad(rs.getString("kind"), rs.getString("name"),
                                 rs.getObject("parent_span_id", UUID::class.java),
                                 rs.getObject("self_ms") as? Int))
                    }
                }
            }
        }

    data class Quad(val kind: String, val name: String, val parent: UUID?, val selfMs: Int?)

    // ── The tree shape ────────────────────────────────────────────────────────

    @Test
    fun `a single-agent run with two tool calls produces the documented tree`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, run) = seed(ds!!)
        val writer = SpanWriter(ds, null, enabled = true, flushEveryMs = 50)
        writer.start()
        try {
            val tracer = RunTracer(writer, traceId = run, runId = run, workspaceId = ws)

            // run → tick → step → { llm_call, tool_call, tool_call }
            tracer.openRunSpan("run", Instant.now())
            tracer.openTick("tick")
            val step = tracer.open("step", "agent-1", tracer.tickSpanId, nodeId = "n-agent-1")

            val llm = tracer.open("llm_call", "gpt-4o-mini", tracer.spanForNode("n-agent-1"))
            tracer.close(llm, "llm_call", "gpt-4o-mini", "ok")

            listOf("crm.search", "crm.update").forEach { toolName ->
                val t = tracer.open("tool_call", toolName, tracer.spanForNode("n-agent-1"))
                tracer.close(t, "tool_call", toolName, "ok")
            }

            tracer.close(step, "step", "agent-1", "ok", nodeId = "n-agent-1")
            tracer.closeTick("ok")
            tracer.closeRunSpan("run", "ok", Instant.now())

            writer.stop()

            val tree = readTree(ds, run)
            val byKind = tree.values.groupBy { it.kind }

            assertEquals(1, byKind["run"]?.size, "one run span")
            assertEquals(1, byKind["tick"]?.size, "one tick span")
            assertEquals(1, byKind["step"]?.size, "one step span")
            assertEquals(1, byKind["llm_call"]?.size, "one llm_call")
            assertEquals(2, byKind["tool_call"]?.size, "two tool_calls")

            // ── EXACT parentage, which is the point of this test ──────────────
            val runSpanId = SpanWriter.runSpanId(run)
            val runSpan = assertNotNull(tree[runSpanId], "run span filed under its derived id")
            assertNull(runSpan.parent, "the run span is the root")

            val tickEntry = tree.entries.single { it.value.kind == "tick" }
            assertEquals(runSpanId, tickEntry.value.parent, "tick's parent is the run")

            val stepEntry = tree.entries.single { it.value.kind == "step" }
            assertEquals(tickEntry.key, stepEntry.value.parent, "step's parent is the tick")

            tree.values.filter { it.kind == "llm_call" || it.kind == "tool_call" }.forEach {
                assertEquals(stepEntry.key, it.parent,
                    "${it.kind} '${it.name}' must hang off the step, not the tick")
            }
        } finally { writer.stop(); cleanup(ds, ws, run) }
    }

    @Test
    fun `the run span has no self_ms because its children tile it`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, run) = seed(ds!!)
        val writer = SpanWriter(ds, null, enabled = true, flushEveryMs = 50)
        writer.start()
        try {
            val tracer = RunTracer(writer, run, run, ws)
            tracer.openRunSpan("run", Instant.now())
            tracer.openTick("tick")
            tracer.closeTick("ok")
            tracer.closeRunSpan("run", "ok", Instant.now())
            writer.stop()

            val runSpan = assertNotNull(readTree(ds, run)[SpanWriter.runSpanId(run)])
            assertNull(runSpan.selfMs,
                "self time is meaningless for a root whose tick and wait children " +
                "cover its whole timeline — it would always be ~0")
        } finally { writer.stop(); cleanup(ds, ws, run) }
    }

    /**
     * The run span must record that it ENDED.
     *
     * ── THE BUG THIS PINS ───────────────────────────────────────────────────
     * The run span is the one span written twice: `openRunSpan` emits it
     * `running` the moment the run starts, because the worker that opens it is
     * frequently not the one that closes it — a yield, an approval or a crash
     * hands the run on. `closeRunSpan` then emits the same span id again with
     * the outcome.
     *
     * Both writes pin `created_at` to the run's start so the partition key is
     * stable, which is what stopped the tab rendering every step twice. But the
     * insert was `ON CONFLICT (span_id, created_at) DO NOTHING`, so the second
     * write — the CLOSE — was silently discarded. Every run span in the database
     * says `running`, with no `ended_at` and no `duration_ms`, forever.
     *
     * It reads as a cosmetic trace issue and is not: the waterfall's axis is the
     * run's duration, so the view had nothing to scale against; `traceComplete`
     * asks "is any run span still running" and was therefore false on every
     * healthy finished run; and the run bar quietly fell back to guessing from
     * the longest child span.
     *
     * Found by the coverage assertion below, which is exactly what it is for.
     */
    @Test
    fun `closing the run span records its end rather than being discarded`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, run) = seed(ds!!)
        val writer = SpanWriter(ds, null, enabled = true, flushEveryMs = 50)
        writer.start()
        try {
            val t0 = Instant.now().minusMillis(5_000)
            val tracer = RunTracer(writer, traceId = run, runId = run, workspaceId = ws)
            tracer.openRunSpan("run", t0)
            tracer.closeRunSpan("run", "ok", t0)
            writer.stop()

            ds.connection.use { c ->
                c.prepareStatement(
                    "SELECT status, ended_at, duration_ms FROM run_spans " +
                    "WHERE run_id=? AND kind='run'"
                ).use { st ->
                    st.setObject(1, run)
                    st.executeQuery().use { rs ->
                        assertTrue(rs.next(), "the run span must exist")
                        assertEquals("ok", rs.getString("status"),
                            "the close must land: a run span stuck at 'running' makes every " +
                            "finished run look unfinished")
                        assertNotNull(rs.getTimestamp("ended_at"), "ended_at must be recorded")
                        assertTrue((rs.getObject("duration_ms") as? Int ?: 0) >= 5_000,
                            "duration_ms must span from the run start to the close")
                        assertTrue(!rs.next(), "still exactly ONE row — the close updates, never duplicates")
                    }
                }
            }
        } finally { writer.stop(); cleanup(ds, ws, run) }
    }

    /**
     * A redelivered OPEN must not reopen a run that already finished.
     *
     * The queue can hand the same job to a second worker after the first closed
     * the run. If that open overwrote the close, a succeeded run would flip back
     * to `running` and stay there.
     */
    @Test
    fun `a redelivered open does not reopen a closed run span`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, run) = seed(ds!!)
        val writer = SpanWriter(ds, null, enabled = true, flushEveryMs = 50)
        writer.start()
        try {
            val t0 = Instant.now().minusMillis(3_000)
            val tracer = RunTracer(writer, traceId = run, runId = run, workspaceId = ws)
            tracer.openRunSpan("run", t0)
            tracer.closeRunSpan("run", "ok", t0)
            tracer.openRunSpan("run", t0)          // the redelivery
            writer.stop()

            ds.connection.use { c ->
                c.prepareStatement(
                    "SELECT status, ended_at FROM run_spans WHERE run_id=? AND kind='run'"
                ).use { st ->
                    st.setObject(1, run)
                    st.executeQuery().use { rs ->
                        assertTrue(rs.next())
                        assertEquals("ok", rs.getString("status"), "the finished outcome stands")
                        assertNotNull(rs.getTimestamp("ended_at"))
                    }
                }
            }
        } finally { writer.stop(); cleanup(ds, ws, run) }
    }

    /**
     * ACCEPTANCE: the run's wall clock is fully accounted for, ±1%.
     *
     * ── WHAT THIS CATCHES, AND WHAT IT DOES NOT ─────────────────────────────
     * It asserts the arithmetic CONTRACT on a correctly-driven tracer: given a
     * run whose ticks and waits were all recorded, the timestamps those calls
     * produce must tile the run span. That is a real check — it is how the
     * discarded `closeRunSpan` above was found, because a run span with no
     * `ended_at` has no wall clock to account for at all.
     *
     * It does NOT catch a caller that forgets to emit a wait: this fixture drives
     * the tracer itself, so it can only be as complete as it is written to be.
     * The equivalent check over REAL runs lives in the waterfall, which computes
     * the same union and draws whatever is left over as `Unaccounted` — visible
     * on every trace, on the screen people already open when a run looks wrong.
     *
     * UNION, not sum: two overlapping top-level spans would sum PAST the run
     * duration and let a broken trace through.
     */
    @Test
    fun `top-level spans and waits account for the whole run`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, run) = seed(ds!!)
        val writer = SpanWriter(ds, null, enabled = true, flushEveryMs = 50)
        writer.start()
        try {
            /* A run that was queued, then parked on an approval, then worked —
               the ticks are stamped `now` by the tracer, so the historical
               stretch is covered by waits, which is exactly how a real yielding
               run records the time it was not running. */
            val t0 = Instant.now().minusMillis(240_000)
            val tracer = RunTracer(writer, traceId = run, runId = run, workspaceId = ws)
            tracer.openRunSpan("run", t0)

            val queueEnd = t0.plusMillis(2_000)
            tracer.emitWait("queue", t0, queueEnd)
            val approvalEnd = Instant.now()
            tracer.emitWait("approval", queueEnd, approvalEnd)

            tracer.openTick("tick")
            val step = tracer.open("step", "work", tracer.tickSpanId, nodeId = "n1")
            tracer.close(step, "step", "work", "ok", nodeId = "n1")
            tracer.closeTick("ok")

            tracer.closeRunSpan("run", "ok", t0)
            writer.stop()

            val rows = readTimes(ds, run)
            val runSpanId = SpanWriter.runSpanId(run)
            val runRow = assertNotNull(rows[runSpanId], "the run span")
            val totalMs = runRow.endMs - runRow.startMs
            assertTrue(totalMs > 0,
                "the run span must record its end — a run stuck at 'running' has no " +
                "wall clock to account for, and the waterfall has no axis")

            /* Union of everything whose parent is the run: ticks and waits. */
            val top = rows.values
                .filter { it.parent == runSpanId }
                .map { maxOf(it.startMs, runRow.startMs) to minOf(it.endMs, runRow.endMs) }
                .filter { it.second > it.first }
                .sortedBy { it.first }
            assertTrue(top.isNotEmpty(), "the run must have top-level children to account for it")

            var accounted = 0L
            var cursor = runRow.startMs
            for ((from, to) in top) {
                if (to <= cursor) continue
                accounted += to - maxOf(from, cursor)
                cursor = maxOf(cursor, to)
            }

            val unaccounted = totalMs - accounted
            assertTrue(
                unaccounted <= totalMs / 100,
                "unaccounted ${unaccounted}ms of ${totalMs}ms " +
                "(${"%.1f".format(unaccounted * 100.0 / totalMs)}%) exceeds the 1% budget — " +
                "a top-level span or a wait is missing, and the waterfall will draw " +
                "that stretch as though the run were idle",
            )
        } finally { writer.stop(); cleanup(ds, ws, run) }
    }

    /** span_id -> (parent, start, end) in epoch millis, for the coverage check. */
    private fun readTimes(ds: DataSource, run: UUID): Map<UUID, Times> =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT span_id, parent_span_id, started_at, ended_at, duration_ms " +
                "FROM run_spans WHERE run_id=?"
            ).use { st ->
                st.setObject(1, run)
                st.executeQuery().use { rs ->
                    buildMap {
                        while (rs.next()) {
                            val start = rs.getTimestamp("started_at").time
                            val end = rs.getTimestamp("ended_at")?.time
                                ?: (start + (rs.getObject("duration_ms") as? Int ?: 0))
                            put(rs.getObject("span_id", UUID::class.java),
                                Times(rs.getObject("parent_span_id", UUID::class.java), start, end))
                        }
                    }
                }
            }
        }

    data class Times(val parent: UUID?, val startMs: Long, val endMs: Long)

    @Test
    fun `a redelivered wait span collides with itself instead of drawing the gap twice`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, run) = seed(ds!!)
        val writer = SpanWriter(ds, null, enabled = true, flushEveryMs = 50)
        writer.start()
        try {
            val tracer = RunTracer(writer, run, run, ws)
            val from = Instant.now().minusSeconds(30)
            val to = Instant.now()

            // The same gap written twice, as a redelivered RESUME_RUN would.
            tracer.emitWait("approval", from, to)
            tracer.emitWait("approval", from, to)
            writer.stop()

            val waits = readTree(ds, run).values.filter { it.kind == "wait" }
            assertEquals(1, waits.size,
                "two hatched bars over one gap reads as the product having stalled twice")
        } finally { writer.stop(); cleanup(ds, ws, run) }
    }

    // ── The promise: tracing cannot hurt a run ────────────────────────────────

    @Test
    fun `an unwritable span table drops spans and never throws`() {
        // No database at all: every write fails. The caller must not notice.
        val unwritable = noOpDataSource()   // getConnection() throws
        val writer = SpanWriter(unwritable, noOpPubSub(), enabled = true, flushEveryMs = 20)
        writer.start()

        val before = writer.droppedCount()
        val tracer = RunTracer(writer, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID())

        // Drive a whole trace's worth of spans. None of this may throw.
        tracer.openRunSpan("run", Instant.now())
        tracer.openTick("tick")
        val step = tracer.open("step", "n1", tracer.tickSpanId, nodeId = "n1")
        val tool = tracer.open("tool_call", "crm.search", tracer.spanForNode("n1"))
        tracer.close(tool, "tool_call", "crm.search", "ok")
        tracer.close(step, "step", "n1", "ok", nodeId = "n1")
        tracer.closeTick("ok")
        tracer.closeRunSpan("run", "ok", Instant.now())

        // Force the flush and let the writer thread fail against the dead source.
        writer.stop()

        assertTrue(writer.droppedCount() > before,
            "spans that could not be written must be counted, so a trace can be " +
            "labelled incomplete rather than silently truncated")
    }

    @Test
    fun `a full buffer drops rather than blocking the caller`() {
        // Capacity 1 and no writer started, so nothing ever drains it.
        val writer = SpanWriter(noOpDataSource(), null, enabled = true, capacity = 1)
        val before = writer.droppedCount()

        val elapsed = kotlin.system.measureTimeMillis {
            repeat(500) {
                writer.emit(SpanWriter.SpanRecord(
                    spanId = UUID.randomUUID(), traceId = UUID.randomUUID(),
                    runId = UUID.randomUUID(), parentSpanId = null,
                    workspaceId = UUID.randomUUID(),
                    kind = "step", name = "n", status = "ok",
                    startedAt = Instant.now()))
            }
        }

        assertTrue(writer.droppedCount() >= before + 499, "the overflow must be counted")
        assertTrue(elapsed < 1_000,
            "499 rejected offers took ${elapsed}ms — emit must be constant-time and " +
            "must never wait for capacity")
    }

    @Test
    fun `with tracing disabled nothing is emitted and nothing is dropped`() {
        val writer = SpanWriter(noOpDataSource(), null, enabled = false)
        val before = writer.droppedCount()
        val tracer = RunTracer(writer, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID())

        // `open` returns null with tracing off, and every close is then a no-op.
        assertNull(tracer.open("step", "n1", null))
        tracer.openRunSpan("run", Instant.now())

        assertEquals(before, writer.droppedCount(),
            "disabled means not emitted, not emitted-and-dropped")
        assertEquals(0, writer.queueDepth())
    }
}
