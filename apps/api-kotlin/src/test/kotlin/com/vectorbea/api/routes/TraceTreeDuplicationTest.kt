package com.vectorbea.api.routes

import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Debug tab rendered every step twice.
 *
 * ── THE REPORT, AND WHAT IT RULED OUT ───────────────────────────────────────
 * "Manual 13ms, Agent 1m05s, Agent 1.7s, End 1ms" appeared twice, with
 * durations identical to the millisecond. Two ticks cannot produce identical
 * durations, so these were not two executions — they were the same spans
 * returned twice.
 *
 * ── THE CAUSE ───────────────────────────────────────────────────────────────
 * NOT the recursive CTE over `parent_run_id`: `loadSpans` is a flat
 * `WHERE run_id = ? AND workspace_id = ?` with no CTE at all.
 *
 * `run_spans` is partitioned by `created_at`, so its primary key must include
 * the partition key: `(span_id, created_at)`. `ON CONFLICT (span_id, created_at)
 * DO NOTHING` therefore only deduplicates when `created_at` matches exactly.
 *
 * `WorkflowRuntime` opened the run span with `Instant.ofEpochMilli(dagStartedAtMs)`
 * and closed it with `Instant.ofEpochMilli(startedAtMs)` — two separate
 * `System.currentTimeMillis()` calls, milliseconds apart, on EVERY run. Two rows,
 * one span id, no conflict.
 *
 * Both rows carry `parent_span_id IS NULL`, so both were roots; `childrenOf` is
 * keyed on span id, so both roots got the same children. The entire subtree was
 * emitted under each — every step, twice, with the durations it really had.
 *
 * This test reproduces the row shape the old writer produced, so it stays honest
 * about the reader even after the writer was fixed: rows written by the old code
 * are already in production.
 */
@Tag("integration")
class TraceTreeDuplicationTest {

    private val ds = com.vectorbea.api.testsupport.Infra.postgres

    /** Exactly the screenshot: run → tick → four steps. */
    private data class World(
        val ws: UUID = UUID.randomUUID(),
        val env: UUID = UUID.randomUUID(),
        val wf: UUID = UUID.randomUUID(),
        val ver: UUID = UUID.randomUUID(),
        val run: UUID = UUID.randomUUID(),
        val runSpan: UUID = UUID.randomUUID(),
    )

    private fun seed(w: World, duplicateRunSpan: Boolean) {
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.ws); it.setString(2, "dup"); it.setString(3, "dup-${w.ws}")
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.env); it.setObject(2, w.ws); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.wf); it.setObject(2, w.ws); it.setObject(3, w.env)
                it.setString(4, "wf-${w.wf}"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.ver); it.setObject(2, w.wf); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id,status) " +
                "VALUES (?,?,?,?,?,'succeeded')"
            ).use {
                it.setObject(1, w.run); it.setObject(2, w.ws); it.setObject(3, w.env)
                it.setObject(4, w.wf); it.setObject(5, w.ver); it.executeUpdate()
            }

            val insert = """INSERT INTO run_spans (span_id, trace_id, run_id, parent_span_id,
                   workspace_id, kind, name, status, step_id, started_at, ended_at,
                   duration_ms, self_ms, created_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"""
            val t0 = Instant.parse("2026-08-31T10:00:00Z")

            c.prepareStatement(insert).use { st ->
                fun add(
                    id: UUID, parent: UUID?, kind: String, name: String,
                    stepId: String?, ms: Int, createdAt: Instant,
                ) {
                    st.setObject(1, id); st.setObject(2, w.run); st.setObject(3, w.run)
                    st.setObject(4, parent); st.setObject(5, w.ws)
                    st.setString(6, kind); st.setString(7, name); st.setString(8, "ok")
                    st.setString(9, stepId)
                    st.setTimestamp(10, java.sql.Timestamp.from(t0))
                    st.setTimestamp(11, java.sql.Timestamp.from(t0.plusMillis(ms.toLong())))
                    st.setInt(12, ms); st.setInt(13, ms)
                    st.setTimestamp(14, java.sql.Timestamp.from(createdAt))
                    st.addBatch()
                }

                /* THE RUN SPAN, WRITTEN TWICE.
                   Same span id, `created_at` one millisecond apart — precisely what
                   `openRunSpan(dagStartedAtMs)` and `closeRunSpan(startedAtMs)`
                   produced. The PK includes created_at, so both rows persist. */
                add(w.runSpan, null, "run", "run", null, 66_000, t0)
                if (duplicateRunSpan) {
                    add(w.runSpan, null, "run", "run", null, 66_000, t0.plusMillis(1))
                }

                val tick = UUID.randomUUID()
                add(tick, w.runSpan, "tick", "tick", null, 66_000, t0)
                add(UUID.randomUUID(), tick, "step", "Manual", "n-manual", 13, t0)
                add(UUID.randomUUID(), tick, "step", "Agent", "n-agent-1", 65_000, t0)
                add(UUID.randomUUID(), tick, "step", "Agent", "n-agent-2", 1_700, t0)
                add(UUID.randomUUID(), tick, "step", "End", "n-end", 1, t0)
                st.executeBatch()
            }
        }
    }

    private fun cleanup(w: World) = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM run_spans WHERE run_id=?")
                .use { it.setObject(1, w.run); it.executeUpdate() }
            c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
        }
    }

    /** The rows as the endpoint loads them: flat, workspace-scoped, ordered. */
    private data class Row(val id: UUID, val parent: UUID?, val name: String, val endedAt: Instant?)

    private fun load(w: World): List<Row> = ds.connection.use { c ->
        c.prepareStatement(
            "SELECT span_id, parent_span_id, name, ended_at FROM run_spans " +
            "WHERE run_id = ? AND workspace_id = ? ORDER BY started_at"
        ).use { st ->
            st.setObject(1, w.run); st.setObject(2, w.ws)
            st.executeQuery().use { rs ->
                buildList {
                    while (rs.next()) add(Row(
                        rs.getObject(1, UUID::class.java),
                        rs.getObject(2, UUID::class.java),
                        rs.getString(3),
                        rs.getTimestamp(4)?.toInstant()))
                }
            }
        }
    }

    /** The tree walk, exactly as `TraceRoutes.tree` does it, counting emissions. */
    private fun emittedNames(rows: List<Row>): List<String> {
        val deduped = TraceRoutes.dedupeBySpanId(rows, { it.id }, { it.endedAt })
        val childrenOf = deduped.groupBy { it.parent }
        val byId = deduped.associateBy { it.id }
        val out = mutableListOf<String>()
        fun build(n: Row) {
            out += n.name
            childrenOf[n.id].orEmpty().forEach { build(it) }
        }
        deduped.filter { it.parent == null || it.parent !in byId }.forEach { build(it) }
        return out
    }

    /**
     * The bug, reproduced and then absent.
     *
     * Without the fix this emits every step twice — assert on the exact shape
     * from the screenshot, four steps, each exactly once.
     */
    @Test
    fun `a duplicated run span does not duplicate the whole subtree`() {
        val w = World()
        try {
            seed(w, duplicateRunSpan = true)

            /* The rows really are duplicated — if this ever stops being true the
               test below would pass for the wrong reason. */
            assertEquals(2, load(w).count { it.parent == null },
                "the fixture must reproduce the two-root shape the writer produced")

            val names = emittedNames(load(w))
            listOf("Manual", "Agent", "Agent", "End").let {
                assertEquals(1, names.count { n -> n == "Manual" }, "Manual rendered ${names.count { n -> n == "Manual" }} times")
                assertEquals(2, names.count { n -> n == "Agent" }, "two DISTINCT agent nodes, not four")
                assertEquals(1, names.count { n -> n == "End" })
                assertEquals(1, names.count { n -> n == "run" }, "the run span itself must appear once")
                assertEquals(1, names.count { n -> n == "tick" })
            }
            assertEquals(6, names.size, "run + tick + 4 steps, once each: $names")
        } finally { cleanup(w) }
    }

    /** The ordinary case is unchanged — the fix must not eat real spans. */
    @Test
    fun `a clean trace is unaffected`() {
        val w = World()
        try {
            seed(w, duplicateRunSpan = false)
            val names = emittedNames(load(w))
            assertEquals(6, names.size, names.toString())
            assertEquals(1, names.count { it == "run" })
        } finally { cleanup(w) }
    }

    /** Given an open row and a closed row for one span, keep the one that ended. */
    @Test
    fun `dedupe keeps the row that has an end time`() {
        val id = UUID.randomUUID()
        val open = Row(id, null, "run", null)
        val closed = Row(id, null, "run", Instant.parse("2026-08-31T10:01:00Z"))
        assertTrue(TraceRoutes.dedupeBySpanId(listOf(open, closed), { it.id }, { it.endedAt })
            .single().endedAt != null)
        assertTrue(TraceRoutes.dedupeBySpanId(listOf(closed, open), { it.id }, { it.endedAt })
            .single().endedAt != null)
    }
}
