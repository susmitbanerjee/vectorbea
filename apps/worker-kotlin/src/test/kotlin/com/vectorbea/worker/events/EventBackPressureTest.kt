package com.vectorbea.worker.events

import com.vectorbea.worker.testsupport.Infra
import com.vectorbea.worker.testsupport.noOpPubSub
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * S1 — events block, spans drop, and the block is bounded.
 *
 * ── THE INVARIANT, RECONCILED WITH THE CODE ─────────────────────────────────
 * Invariant 7 read "observability never blocks execution: bounded buffers, drop
 * to a counter under pressure". `RunEventStore` visibly does not do that — a full
 * buffer is flushed on the emitting thread. That is not a violation, it is the
 * correct behaviour written down wrongly:
 *
 *   A dropped SPAN is a degraded trace. Nothing depends on span N existing.
 *   A dropped EVENT is a hole in a timeline that pages on `?afterSequence=`.
 *   The reader sees a gap it cannot explain, an open stream never receives that
 *   event, and a lost RUN_FAILED is an outage reported as a success.
 *
 * So the invariant now says spans may drop and events may not — and, because
 * "never drop" cannot mean "block forever", the block is bounded. Past the
 * deadline events are dropped LOUDLY and counted, because a worker with every
 * thread parked on a database that is not answering is the outage the invariant
 * exists to prevent, reached from the other side.
 */
@Tag("integration")
class EventBackPressureTest {

    private val ds = Infra.postgres

    private data class W(val ws: UUID, val env: UUID, val run: UUID)

    private fun seedRun(): W {
        val ws = UUID.randomUUID(); val env = UUID.randomUUID()
        val run = UUID.randomUUID(); val wf = UUID.randomUUID(); val ver = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, ws); it.setString(2, "bp"); it.setString(3, "bp-$ws"); it.executeUpdate()
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
                "VALUES (?,?,?,?,?,'running')"
            ).use {
                it.setObject(1, run); it.setObject(2, ws); it.setObject(3, env)
                it.setObject(4, wf); it.setObject(5, ver); it.executeUpdate()
            }
        }
        return W(ws, env, run)
    }

    private fun cleanup(ws: UUID, run: UUID) = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM run_events WHERE run_id=?").use { it.setObject(1, run); it.executeUpdate() }
            c.prepareStatement("DELETE FROM workspaces WHERE id=?").use { it.setObject(1, ws); it.executeUpdate() }
        }
    }

    private fun sequences(run: UUID): List<Long> = ds.connection.use { c ->
        c.prepareStatement("SELECT sequence FROM run_events WHERE run_id=? ORDER BY sequence").use { st ->
            st.setObject(1, run)
            st.executeQuery().use { rs -> buildList { while (rs.next()) add(rs.getLong(1)) } }
        }
    }

    /**
     * The healthy case: pressure produces a WAIT, not a hole.
     *
     * 300 events through a 50-deep buffer means the buffer fills six times, and
     * every fill flushes on the caller's thread. All 300 must be in Postgres with
     * a contiguous sequence — the gap is the thing that would break paging.
     */
    @Test
    fun `a full buffer blocks and loses nothing`() {
        val w = seedRun()
        val store = RunEventStore(ds, noOpPubSub(),
            sequenceSource = RunEventStore.SequenceSource.COUNTER,
            batchEnabled = true, batchSize = 50, flushEveryMs = 60_000L)
        try {
            repeat(300) {
                store.appendEvent(RunEventStore.RunEvent(
                    runId = w.run, workspaceId = w.ws, environmentId = w.env,
                    type = RunEventStore.EventType.STEP_STARTED, status = "running",
                    summary = "e$it",
                ))
            }
            store.flush(w.run)

            val seqs = sequences(w.run)
            assertEquals(300, seqs.size, "back-pressure must not lose events; got ${seqs.size}")
            assertEquals(0, store.droppedCount(), "nothing should have been dropped on a healthy database")
            assertEquals((1L..300L).toList(), seqs,
                "sequence must be contiguous — a gap is a hole `?afterSequence=` paging cannot cross")
        } finally { cleanup(w.ws, w.run) }
    }

    /**
     * A write that FAILS drops loudly and counts, rather than silently.
     *
     * The datasource points at a port nothing listens on, so every flush throws on
     * connect. Before this, the only trace of the loss was one `log.error` nobody
     * aggregates — while the Debug tab was separately claiming drops it had no
     * signal for. Now the gap is attributable.
     */
    @Test
    fun `a failing write is counted, not just logged`() {
        val w = seedRun()
        val broken = org.postgresql.ds.PGSimpleDataSource().apply {
            setURL("jdbc:postgresql://127.0.0.1:1/nothing?connectTimeout=1&socketTimeout=1")
            user = "nobody"; password = "nobody"
        }
        val store = RunEventStore(broken, noOpPubSub(),
            sequenceSource = RunEventStore.SequenceSource.COUNTER,
            batchEnabled = true, batchSize = 50, flushEveryMs = 60_000L,
            backPressureTimeoutMs = 300)
        try {
            val before = store.droppedCount()
            repeat(50) {
                store.appendEvent(RunEventStore.RunEvent(
                    runId = w.run, workspaceId = w.ws, environmentId = w.env,
                    type = RunEventStore.EventType.STEP_STARTED, status = "running",
                    summary = "e$it",
                ))
            }
            assertEquals(50, store.droppedCount() - before,
                "every event in the failed batch must be counted; a silent gap is the failure mode this replaces")
        } finally { cleanup(w.ws, w.run) }
    }

    /**
     * The bound itself: a buffer that never drains gives up and drops.
     *
     * `flush` is overridden to do nothing, which is the shape of a database that
     * accepts the call and never completes it — the queue stays at or above
     * `batchSize` no matter how many times the loop retries. Without the deadline
     * this spins until the process is killed, and with every emitting thread in
     * the worker parked here the fleet stops executing runs. That is the outage
     * invariant 7 exists to prevent, reached from the other direction: "never
     * blocks" means never blocks INDEFINITELY, not never waits.
     */
    @Test
    fun `a buffer that never drains gives up at the deadline`() {
        val w = seedRun()
        val store = object : RunEventStore(ds, noOpPubSub(),
            sequenceSource = RunEventStore.SequenceSource.COUNTER,
            batchEnabled = true, batchSize = 10, flushEveryMs = 60_000L,
            backPressureTimeoutMs = 250) {
            /* Accepts the flush, completes nothing. */
            override fun flush(runId: UUID) = Unit
        }
        try {
            val before = store.droppedCount()
            val startedAt = System.currentTimeMillis()
            repeat(10) {
                store.appendEvent(RunEventStore.RunEvent(
                    runId = w.run, workspaceId = w.ws, environmentId = w.env,
                    type = RunEventStore.EventType.STEP_STARTED, status = "running",
                    summary = "e$it",
                ))
            }
            val elapsed = System.currentTimeMillis() - startedAt

            assertTrue(elapsed in 200..5_000,
                "must wait for the deadline and then stop; waited ${elapsed}ms")
            assertEquals(10, store.droppedCount() - before,
                "the abandoned buffer must be counted, so the timeline gap is explainable")
            assertEquals(0, sequences(w.run).size,
                "nothing reached Postgres — this is a real loss, and it says so")
        } finally { cleanup(w.ws, w.run) }
    }
}
