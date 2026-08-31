package com.vectorbea.worker.events

import com.vectorbea.worker.testsupport.noOpPubSub
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.postgresql.ds.PGSimpleDataSource
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §12.2 — the event sequence lock, moved off the run row and taken N× less often.
 *
 * ── WHAT "TWO PROCESSES" MEANS IN A TEST ────────────────────────────────────
 * The property under test is that `run_events.sequence` is assigned correctly
 * when nothing in the JVM is coordinating the writers — because in production
 * the second writer is the API, in another JVM, appending on a cancel or an
 * approval decision.
 *
 * So every writer here gets its OWN `DataSource` (its own backend session) and
 * its OWN [RunEventStore] instance, which means its own `runLocks` map. The
 * in-process lock therefore excludes nothing between them: the only thing
 * standing between two concurrent writers is the database lock, which is
 * precisely the thing being changed. One test goes further and writes through a
 * literal transcription of the API's SQL, so the claim "both services agree" is
 * tested rather than asserted in a comment.
 *
 * ── WHAT IS ASSERTED ────────────────────────────────────────────────────────
 * 1. NO DUPLICATES. Two events sharing a number is the bug that breaks the
 *    timeline's `?afterSequence=` cursor: one of them is never delivered.
 * 2. NO GAPS. Not strictly required by the cursor, but a gap means a block was
 *    allocated and not written, which is how a rollback bug hides.
 * 3. ORDER. Each writer's own events come back in the order it emitted them.
 *    A batched allocation that assigned its block backwards would still pass (1)
 *    and (2).
 *
 * Skips when no database is reachable.
 */
class EventSequenceContentionTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    /** A fresh pool per writer — one session each, exactly as two services have. */
    private fun newDataSource(): DataSource = PGSimpleDataSource().apply {
        setURL(jdbcUrl); connectTimeout = 2; socketTimeout = 30
    }

    private fun available(): Boolean = try {
        newDataSource().connection.use { c ->
            c.prepareStatement("SELECT 1 FROM run_event_seq LIMIT 1").use { it.executeQuery() }
        }
        true
    } catch (_: Exception) {
        false
    }

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        val runId: UUID = UUID.randomUUID(),
    )

    private fun seed(ds: DataSource): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "seq-test")
                it.setString(3, "seq-test-" + w.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.environmentId); it.setObject(2, w.workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.workflowId); it.setObject(2, w.workspaceId)
                it.setObject(3, w.environmentId); it.setString(4, "wf-" + w.workflowId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.versionId); it.setObject(2, w.workflowId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id,status) " +
                "VALUES (?,?,?,?,?,'running')"
            ).use {
                it.setObject(1, w.runId); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId); it.executeUpdate()
            }
        }
        return w
    }

    private fun cleanup(ds: DataSource, w: World) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM run_event_seq WHERE run_id=?")
                    .use { it.setObject(1, w.runId); it.executeUpdate() }
                c.prepareStatement("DELETE FROM run_events WHERE run_id=?")
                    .use { it.setObject(1, w.runId); it.executeUpdate() }
                c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                    .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
            }
        }
    }

    private fun event(w: World, title: String) = RunEventStore.RunEvent(
        runId = w.runId,
        workspaceId = w.workspaceId,
        environmentId = w.environmentId,
        type = RunEventStore.EventType.STEP_STARTED,
        status = "running",
        title = title,
    )

    /** `(sequence, title)` for the run, in sequence order. */
    private fun readBack(ds: DataSource, w: World): List<Pair<Int, String>> =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT sequence, title FROM run_events WHERE run_id = ? ORDER BY sequence"
            ).use { st ->
                st.setObject(1, w.runId)
                st.executeQuery().use { rs ->
                    buildList { while (rs.next()) add(rs.getInt(1) to (rs.getString(2) ?: "")) }
                }
            }
        }

    /**
     * The three properties, over rows produced by writers named `A`/`B` with
     * titles `<writer>-<ordinal>`.
     */
    private fun assertWellOrdered(rows: List<Pair<Int, String>>, expected: Int) {
        val seqs = rows.map { it.first }
        assertEquals(expected, rows.size, "row count")
        assertEquals(expected, seqs.toSet().size, "DUPLICATE sequence assigned: $seqs")
        assertEquals((1..expected).toList(), seqs, "sequence is not 1..$expected without gaps")

        for (writer in setOf("A", "B")) {
            val mine = rows.filter { it.second.startsWith("$writer-") }
                .map { it.second.substringAfter('-').toInt() }
            assertEquals(mine.sorted(), mine,
                "writer $writer's events are not in emission order: $mine")
        }
    }

    /** Run two writers flat out against the same run, then read the result back. */
    private fun race(perWriter: Int, a: (Int) -> Unit, b: (Int) -> Unit) {
        val pool = Executors.newFixedThreadPool(2)
        val go = CountDownLatch(1)
        val done = CountDownLatch(2)
        val errors = java.util.Collections.synchronizedList(mutableListOf<Throwable>())
        listOf(a, b).forEach { writer ->
            pool.submit {
                try {
                    go.await()
                    repeat(perWriter) { i -> writer(i + 1) }
                } catch (t: Throwable) {
                    errors += t
                } finally {
                    done.countDown()
                }
            }
        }
        go.countDown()
        assertTrue(done.await(120, TimeUnit.SECONDS), "writers did not finish")
        pool.shutdownNow()
        assertTrue(errors.isEmpty(), "writer failed: ${errors.firstOrNull()}")
    }

    // ── 1. Two stores, no shared in-process lock, both modes ──────────────────

    private fun twoStores(source: RunEventStore.SequenceSource) {
        assumeTrue(available(), "no database")
        val dsA = newDataSource()
        val dsB = newDataSource()
        val w = seed(dsA)
        try {
            val a = RunEventStore(dsA, noOpPubSub(), sequenceSource = source)
            val b = RunEventStore(dsB, noOpPubSub(), sequenceSource = source)
            race(40, { i -> a.appendEvent(event(w, "A-$i")) }, { i -> b.appendEvent(event(w, "B-$i")) })
            assertWellOrdered(readBack(dsA, w), 80)
        } finally {
            cleanup(dsA, w)
        }
    }

    @Test
    fun `run-row lock keeps two independent writers ordered`() =
        twoStores(RunEventStore.SequenceSource.RUN_ROW)

    @Test
    fun `counter row keeps two independent writers ordered`() =
        twoStores(RunEventStore.SequenceSource.COUNTER)

    // ── 2. The worker against the API's actual SQL ────────────────────────────

    /**
     * Writer B is a transcription of `RunEventRepository.append` — the API's own
     * statement, not a paraphrase of it.
     *
     * This is the test that would have caught a half-rolled-out flag: run it with
     * the worker on COUNTER and this on the run-row path and it fails with
     * duplicates, which is exactly what production would do.
     */
    private fun apiStyleAppend(ds: DataSource, w: World, title: String, useCounter: Boolean) {
        ds.connection.use { c ->
            c.autoCommit = false
            try {
                val seq = if (useCounter) {
                    c.prepareStatement("SELECT run_events_allocate_seq(?, 1)").use { s ->
                        s.setObject(1, w.runId)
                        s.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
                    }
                } else {
                    c.prepareStatement("SELECT 1 FROM agent_runs WHERE id = ? FOR UPDATE").use { s ->
                        s.setObject(1, w.runId); s.executeQuery().use { }
                    }
                    c.prepareStatement(
                        "SELECT COALESCE(MAX(sequence), 0) + 1 FROM run_events WHERE run_id = ?"
                    ).use { s ->
                        s.setObject(1, w.runId)
                        s.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
                    }
                }
                c.prepareStatement(
                    "INSERT INTO run_events (run_id, workspace_id, environment_id, sequence, " +
                    "type, status, source, title, timestamp) VALUES (?,?,?,?,?,?,?,?, now())"
                ).use { s ->
                    s.setObject(1, w.runId); s.setObject(2, w.workspaceId)
                    s.setObject(3, w.environmentId); s.setInt(4, seq)
                    s.setString(5, "RUN_CANCELLATION_REQUESTED"); s.setString(6, "running")
                    s.setString(7, "api"); s.setString(8, title)
                    s.executeUpdate()
                }
                c.commit()
            } catch (e: Exception) {
                c.rollback(); throw e
            } finally {
                c.autoCommit = true
            }
        }
    }

    private fun workerAgainstApi(source: RunEventStore.SequenceSource) {
        assumeTrue(available(), "no database")
        val dsA = newDataSource()
        val dsB = newDataSource()
        val w = seed(dsA)
        try {
            val worker = RunEventStore(dsA, noOpPubSub(), sequenceSource = source)
            val counter = source == RunEventStore.SequenceSource.COUNTER
            race(30,
                { i -> worker.appendEvent(event(w, "A-$i")) },
                { i -> apiStyleAppend(dsB, w, "B-$i", counter) })
            assertWellOrdered(readBack(dsA, w), 60)
        } finally {
            cleanup(dsA, w)
        }
    }

    @Test
    fun `worker and the API's own statement agree on the run row`() =
        workerAgainstApi(RunEventStore.SequenceSource.RUN_ROW)

    @Test
    fun `worker and the API's own statement agree on the counter`() =
        workerAgainstApi(RunEventStore.SequenceSource.COUNTER)

    // ── 3. A batch gets a contiguous block even under a competing writer ──────

    /**
     * The point of item 1(a): one acquisition per flush, not per event. That is
     * only true if the block cannot be split — if another writer could take a
     * number out of the middle, the allocation is not being held for the insert
     * and the timeline would interleave two runs' worth of activity inside what
     * the reader sees as one flush.
     */
    @Test
    fun `a batched flush is contiguous even while another writer appends`() {
        assumeTrue(available(), "no database")
        val dsA = newDataSource()
        val dsB = newDataSource()
        val w = seed(dsA)
        try {
            val a = RunEventStore(dsA, noOpPubSub(),
                sequenceSource = RunEventStore.SequenceSource.COUNTER)
            val b = RunEventStore(dsB, noOpPubSub(),
                sequenceSource = RunEventStore.SequenceSource.COUNTER)
            val blocks = java.util.Collections.synchronizedList(mutableListOf<List<Int>>())

            race(8,
                { i -> blocks += a.appendEvents((1..10).map { event(w, "A-${i * 100 + it}") }) },
                { i -> b.appendEvent(event(w, "B-$i")) })

            assertEquals(8, blocks.size)
            blocks.forEach { block ->
                assertEquals(10, block.size)
                assertEquals((block.first() until block.first() + 10).toList(), block,
                    "a flush's block was not contiguous: $block")
            }
            val rows = readBack(dsA, w)
            assertEquals(88, rows.size)
            assertEquals((1..88).toList(), rows.map { it.first })
        } finally {
            cleanup(dsA, w)
        }
    }

    // ── 4. Buffering preserves emission order across the sync boundary ────────

    /**
     * With batching on, most events queue and a few (terminal states, approval
     * gates) go straight to disk. If a synchronous write could overtake the
     * queue, RUN_SUCCEEDED would be numbered before the events that explain it
     * and the timeline would end before it finished.
     */
    @Test
    fun `a never-buffered event lands after everything already queued`() {
        assumeTrue(available(), "no database")
        val ds = newDataSource()
        val w = seed(ds)
        try {
            val store = RunEventStore(ds, noOpPubSub(),
                sequenceSource = RunEventStore.SequenceSource.COUNTER,
                batchEnabled = true, batchSize = 50, flushEveryMs = 5_000L)

            repeat(10) { i ->
                assertEquals(RunEventStore.SEQ_BUFFERED, store.appendEvent(event(w, "A-${i + 1}")),
                    "an ordinary event should have been buffered, not written")
            }
            // Nothing on disk yet: 10 events, one flush's worth of nothing.
            assertEquals(0, readBack(ds, w).size)

            store.appendEvent(RunEventStore.RunEvent(
                runId = w.runId, workspaceId = w.workspaceId, environmentId = w.environmentId,
                type = RunEventStore.EventType.RUN_SUCCEEDED, status = "succeeded", title = "A-11"))

            val rows = readBack(ds, w)
            assertEquals(11, rows.size)
            assertEquals((1..11).toList(), rows.map { it.first })
            assertEquals("A-11", rows.last().second, "the terminal event must be last")
        } finally {
            cleanup(ds, w)
        }
    }

    /** A full buffer flushes rather than growing. Events are never dropped. */
    @Test
    fun `a full buffer flushes instead of growing`() {
        assumeTrue(available(), "no database")
        val ds = newDataSource()
        val w = seed(ds)
        try {
            val store = RunEventStore(ds, noOpPubSub(),
                sequenceSource = RunEventStore.SequenceSource.COUNTER,
                batchEnabled = true, batchSize = 4, flushEveryMs = 5_000L)
            repeat(9) { i -> store.appendEvent(event(w, "A-${i + 1}")) }
            // 9 emitted, batchSize 4 → two flushes of 4; one still queued.
            assertEquals(8, readBack(ds, w).size)
            store.forgetRun(w.runId)
            val rows = readBack(ds, w)
            assertEquals(9, rows.size, "forgetRun must flush what is still queued")
            assertEquals((1..9).toList(), rows.map { it.first })
            assertEquals((1..9).map { "A-$it" }, rows.map { it.second })
        } finally {
            cleanup(ds, w)
        }
    }
}
