package com.vectorbea.worker.events

import org.junit.jupiter.api.Assumptions.assumeTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import org.postgresql.ds.PGSimpleDataSource
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.jupiter.api.Tag

/**
 * Which of a failed run's error spans is the one that actually broke.
 *
 * A failed run produces a column of red rows — the tool failed, so the step failed,
 * so the tick failed, so the run failed. Four errors, one cause. Getting this wrong
 * means the failure panel names a propagation span, and the user is told their run
 * broke because "the tick failed", which is true and worthless.
 */
@Timeout(value = 20, unit = TimeUnit.SECONDS)
@Tag("integration")
class RootCauseAttributionTest {

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

    private fun workspace(ds: DataSource): UUID {
        val ws = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, ws); it.setString(2, "rc-test")
                it.setString(3, "rc-test-$ws"); it.executeUpdate()
            }
        }
        return ws
    }

    private fun cleanup(ds: DataSource, ws: UUID, run: UUID) = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM run_spans WHERE run_id=?").use {
                it.setObject(1, run); it.executeUpdate() }
            c.prepareStatement("DELETE FROM workspaces WHERE id=?").use {
                it.setObject(1, ws); it.executeUpdate() }
        }
    }

    /** Insert a span directly — this test is about the walk, not the writer. */
    private fun span(
        ds: DataSource, ws: UUID, run: UUID, id: UUID, parent: UUID?,
        kind: String, name: String, status: String,
    ) {
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO run_spans (span_id, trace_id, run_id, parent_span_id,
                       workspace_id, kind, name, status, started_at, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)"""
            ).use {
                val now = java.sql.Timestamp.from(Instant.now())
                it.setObject(1, id); it.setObject(2, run); it.setObject(3, run)
                it.setObject(4, parent); it.setObject(5, ws)
                it.setString(6, kind); it.setString(7, name); it.setString(8, status)
                it.setTimestamp(9, now); it.setTimestamp(10, now)
                it.executeUpdate()
            }
        }
    }

    private fun flagged(ds: DataSource, run: UUID): List<String> =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT name FROM run_spans WHERE run_id=? AND is_root_cause ORDER BY name"
            ).use { st ->
                st.setObject(1, run)
                st.executeQuery().use { rs -> buildList { while (rs.next()) add(rs.getString(1)) } }
            }
        }

    // ── The acceptance case ───────────────────────────────────────────────────

    @Test
    fun `with 5 error spans across 3 levels exactly one is the root cause`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val ws = workspace(ds!!); val run = UUID.randomUUID()
        try {
            //  run(err) → tick(err) → step(err) → tool_call(err) → http(err)
            //                      ↘ step_ok(ok)
            // Five errors, three-plus levels. Only the deepest with no error child
            // originated anything; the four above it are propagation.
            val runS = UUID.randomUUID(); val tick = UUID.randomUUID()
            val step = UUID.randomUUID(); val tool = UUID.randomUUID()
            val http = UUID.randomUUID(); val ok = UUID.randomUUID()

            span(ds, ws, run, runS, null,  "run",       "run",        "error")
            span(ds, ws, run, tick, runS,  "tick",      "tick",       "error")
            span(ds, ws, run, step, tick,  "step",      "triage",     "error")
            span(ds, ws, run, ok,   tick,  "step",      "notify",     "ok")
            span(ds, ws, run, tool, step,  "tool_call", "crm.search", "error")
            span(ds, ws, run, http, tool,  "llm_call",  "http-leaf",  "error")

            val result = RootCauseAttribution(ds).attribute(run)

            assertEquals(listOf("http-leaf"), flagged(ds, run),
                "only the deepest error span with no error child is the cause; " +
                "the four above it are propagation")
            assertEquals(1, result!!.rootCauseSpanIds.size)
            assertEquals(1, result.concurrentGroupSize)
            assertEquals(null, result.label, "a single cause gets no group label")
        } finally { cleanup(ds, ws, run) }
    }

    @Test
    fun `error siblings under one parent are flagged together as a concurrent group`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val ws = workspace(ds!!); val run = UUID.randomUUID()
        try {
            // A parallel branch where two workers failed. That is ONE event with two
            // symptoms, not two causes to triage separately.
            val runS = UUID.randomUUID(); val par = UUID.randomUUID()
            val a = UUID.randomUUID(); val b = UUID.randomUUID()

            span(ds, ws, run, runS, null, "run",       "run",     "error")
            span(ds, ws, run, par,  runS, "step",      "fan-out", "error")
            span(ds, ws, run, a,    par,  "tool_call", "branch-a", "error")
            span(ds, ws, run, b,    par,  "tool_call", "branch-b", "error")

            val result = RootCauseAttribution(ds).attribute(run)!!

            assertEquals(listOf("branch-a", "branch-b"), flagged(ds, run))
            assertEquals(2, result.concurrentGroupSize)
            assertEquals("2 concurrent failures", result.label)
        } finally { cleanup(ds, ws, run) }
    }

    @Test
    fun `an error span with only healthy children is still the cause`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val ws = workspace(ds!!); val run = UUID.randomUUID()
        try {
            // The step failed after two SUCCESSFUL tool calls — the failure originated
            // at the step. Walking "down through children" naively would find nothing.
            val runS = UUID.randomUUID(); val step = UUID.randomUUID()
            span(ds, ws, run, runS, null, "run",  "run",      "error")
            span(ds, ws, run, step, runS, "step", "validate", "error")
            repeat(2) {
                span(ds, ws, run, UUID.randomUUID(), step, "tool_call", "ok-call-$it", "ok")
            }

            RootCauseAttribution(ds).attribute(run)
            assertEquals(listOf("validate"), flagged(ds, run))
        } finally { cleanup(ds, ws, run) }
    }

    @Test
    fun `re-attribution clears the previous flag rather than adding a second`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val ws = workspace(ds!!); val run = UUID.randomUUID()
        try {
            val runS = UUID.randomUUID(); val first = UUID.randomUUID()
            span(ds, ws, run, runS,  null, "run",       "run",   "error")
            span(ds, ws, run, first, runS, "tool_call", "first", "error")
            RootCauseAttribution(ds).attribute(run)
            assertEquals(listOf("first"), flagged(ds, run))

            // A deeper error arrives (a retry produced more spans) and re-attribution
            // runs. The old flag must not survive beside the new one.
            val deeper = UUID.randomUUID()
            span(ds, ws, run, deeper, first, "llm_call", "deeper", "error")
            RootCauseAttribution(ds).attribute(run)

            assertEquals(listOf("deeper"), flagged(ds, run),
                "two root causes on one run means the panel has to pick, which is the " +
                "triage this exists to remove")
        } finally { cleanup(ds, ws, run) }
    }

    @Test
    fun `a successful run has nothing to attribute`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping")
        val ws = workspace(ds!!); val run = UUID.randomUUID()
        try {
            span(ds, ws, run, UUID.randomUUID(), null, "run", "run", "ok")
            assertEquals(null, RootCauseAttribution(ds).attribute(run))
            assertTrue(flagged(ds, run).isEmpty())
        } finally { cleanup(ds, ws, run) }
    }

    @Test
    fun `attribution never throws when the span table is unreachable`() {
        // Attribution is observability. A run that has already finished must not be
        // affected by our inability to explain it.
        val dead = com.vectorbea.worker.testsupport.noOpDataSource()
        assertEquals(null, RootCauseAttribution(dead).attribute(UUID.randomUUID()))
        assertEquals(null, RootCauseAttribution(null).attribute(UUID.randomUUID()))
    }
}
