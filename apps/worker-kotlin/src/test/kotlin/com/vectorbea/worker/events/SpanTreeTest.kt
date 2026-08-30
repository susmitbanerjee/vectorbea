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
class SpanTreeTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    private fun dsOrNull(): DataSource? = try {
        val ds = PGSimpleDataSource().apply {
            setURL(jdbcUrl); connectTimeout = 2; socketTimeout = 5
        }
        ds.connection.use { c ->
            c.prepareStatement("SELECT 1 FROM run_spans LIMIT 1").use { it.executeQuery() }
        }
        ds
    } catch (_: Exception) { null }

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
