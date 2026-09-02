package com.vectorbea.worker.events

import com.vectorbea.worker.testsupport.noOpPubSub
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import org.junit.jupiter.api.Tag

/**
 * §12.2 — the before/after measurement for the event sequence change.
 *
 * ── WHAT THIS MEASURES, AND WHAT IT HONESTLY CANNOT ─────────────────────────
 * The acceptance criterion is "100 concurrent 5-agent team runs; report p50/p99
 * run latency, event write latency and lock wait time before and after".
 *
 * END-TO-END RUN LATENCY IS NOT MEASURED HERE and this test does not pretend to.
 * A real run needs Redis Streams, a claimed lease, a provider socket and a
 * scheduler; a number produced without them would be a number about this test.
 *
 * What is measured is the layer the change actually touches, at the volume a
 * hundred five-agent teams produce:
 *
 *   • EVENT WRITE LATENCY — p50/p99/max, per append, from the caller's side.
 *   • LOCK WAIT — sampled from `pg_locks` (`NOT granted`) every 10ms while the
 *     load runs. That is the contention itself, read from Postgres rather than
 *     inferred from wall clock.
 *   • ROW CHURN on `agent_runs` — `n_tup_upd`, because the history counters made
 *     one dead tuple per event on the same row the lease and status live on.
 *
 * The competing writer matters as much as the volume: a thread per run renews
 * the lease and updates status throughout, which is what makes the run-row lock
 * expensive in production and is invisible in a benchmark that only writes
 * events.
 *
 * ── TWO TESTS: A MEASUREMENT, AND A GUARD ───────────────────────────────────
 * `event write throughput before and after` is the four-pass measurement that
 * produced §12.2.1's table. It writes ~60k rows and takes minutes, so it keeps
 * the `benchmark` tag and stays out of both ordinary tiers:
 *
 *     ./gradlew :worker-kotlin:benchmark
 *
 * `the sequence change still beats the run-row lock` is the REGRESSION, and it
 * runs on merge. A measured 6x that nothing asserts is a number in a document:
 * the change can be reverted, mis-flagged or undone by an innocent refactor of
 * `allocateSequences`, and every existing test still passes because all of them
 * are about correctness at a concurrency of one.
 *
 * ── WHAT THE REGRESSION ASSERTS, AND WHY THAT AND NOT WALL CLOCK ────────────
 * Primarily ROW CHURN on `agent_runs`, which is structural rather than timed.
 * Run-row sequencing takes `FOR UPDATE` on the run row per flush and leaves a
 * dead tuple behind; the counter row does not touch `agent_runs` at all. The
 * measured separation is 14 297 versus 239 — two orders of magnitude, on a
 * number that does not move with CPU speed, CI load or a noisy neighbour. If
 * sequencing goes back to the run row, this cannot pass.
 *
 * Wall clock is asserted too, because the headline claim is throughput, but with
 * a deliberately loose ratio. The measurement says 6x; the guard demands 1.5x.
 * The gap is not timidity — it is the difference between a test that fails when
 * the change is undone and a test that fails when CI is busy, and only one of
 * those is worth having on every merge.
 *
 * At the regression tier's volume this takes seconds, not minutes.
 */
@Tag("integration")
class EventWriteLoadTest {

    /* From [Infra], not a hard-coded port: this class opens SEVERAL DataSources
       on purpose — one per simulated process — and they all have to point at the
       same database Infra migrated. */
    private val jdbcUrl = com.vectorbea.worker.testsupport.Infra.postgresUrl

    /** A five-agent team: five members, six iterations each, five events per iteration. */
    private val runs = System.getenv("LOAD_RUNS")?.toIntOrNull() ?: 100
    private val eventsPerRun = System.getenv("LOAD_EVENTS_PER_RUN")?.toIntOrNull() ?: 150

    /**
     * Bounded, like a worker's. An unbounded pool would hide the pathology this
     * whole change is about: blocking on the run-row lock holds a connection, so
     * contention converts directly into pool starvation.
     */
    private fun pool(size: Int): HikariDataSource = HikariDataSource(HikariConfig().apply {
        jdbcUrl = this@EventWriteLoadTest.jdbcUrl
        maximumPoolSize = size
        connectionTimeout = 30_000
        poolName = "load-$size-${UUID.randomUUID().toString().take(6)}"
    })

    // ── Fixture ───────────────────────────────────────────────────────────────

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        val runIds: MutableList<UUID> = mutableListOf(),
    )

    private fun seed(ds: DataSource, n: Int): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "load")
                it.setString(3, "load-" + w.workspaceId); it.executeUpdate()
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
            ).use { st ->
                repeat(n) {
                    val id = UUID.randomUUID()
                    w.runIds += id
                    st.setObject(1, id); st.setObject(2, w.workspaceId); st.setObject(3, w.environmentId)
                    st.setObject(4, w.workflowId); st.setObject(5, w.versionId)
                    st.addBatch()
                }
                st.executeBatch()
            }
        }
        return w
    }

    private fun cleanup(ds: DataSource, w: World) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement(
                    "DELETE FROM run_event_seq WHERE run_id IN " +
                    "(SELECT id FROM agent_runs WHERE workspace_id = ?)"
                ).use { it.setObject(1, w.workspaceId); it.executeUpdate() }
                c.prepareStatement("DELETE FROM run_events WHERE workspace_id = ?")
                    .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
                c.prepareStatement("DELETE FROM workspaces WHERE id = ?")
                    .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
            }
        }
    }

    // ── Measurement ───────────────────────────────────────────────────────────

    private class Sampler(private val ds: DataSource) {
        private val stop = AtomicBoolean(false)
        val ungranted = java.util.Collections.synchronizedList(mutableListOf<Int>())
        private val thread = Thread {
            while (!stop.get()) {
                runCatching {
                    ds.connection.use { c ->
                        /* Two views of the same thing, unioned: an ungranted lock
                           request, and a backend parked in a Lock wait event. The
                           second catches tuple-level waits that pg_locks reports as
                           granted on the transaction id rather than the row. */
                        c.prepareStatement(
                            "SELECT (SELECT count(*) FROM pg_locks WHERE NOT granted) " +
                            "     + (SELECT count(*) FROM pg_stat_activity " +
                            "         WHERE wait_event_type = 'Lock' AND pid <> pg_backend_pid())"
                        ).use { it.executeQuery().use { rs -> rs.next(); ungranted += rs.getInt(1) } }
                    }
                }
                Thread.sleep(2)
            }
        }.apply { isDaemon = true }

        fun start() = thread.start()
        fun stop() { stop.set(true); thread.join(2_000) }
        fun mean(): Double = ungranted.toList().let { if (it.isEmpty()) 0.0 else it.average() }
        fun peak(): Int = ungranted.toList().maxOrNull() ?: 0
    }

    /**
     * Cumulative row updates on `agent_runs`.
     *
     * `pg_stat_clear_snapshot()` first, and a pause before the second read: the
     * statistics collector is asynchronous and a session caches its snapshot for
     * the whole transaction, so reading it naively reports the value from before
     * the load ran — which looks like "the change eliminated all row churn" and
     * is simply a stale number.
     */
    private fun tupUpd(ds: DataSource, settle: Boolean = false): Long {
        if (settle) Thread.sleep(1_200)
        return ds.connection.use { c ->
            c.prepareStatement("SELECT pg_stat_clear_snapshot()").use { it.executeQuery().use { } }
            c.prepareStatement("SELECT COALESCE(n_tup_upd,0) FROM pg_stat_all_tables WHERE relname='agent_runs'")
                .use { it.executeQuery().use { rs -> if (rs.next()) rs.getLong(1) else 0L } }
        }
    }

    private class Result(
        val label: String,
        val wallMs: Long,
        val latenciesNs: LongArray,
        val meanUngranted: Double,
        val peakUngranted: Int,
        val agentRunsUpdates: Long,
        val eventsWritten: Int,
    ) {
        private fun pct(p: Double): Double {
            if (latenciesNs.isEmpty()) return 0.0
            val sorted = latenciesNs.clone().also { it.sort() }
            val i = ((sorted.size - 1) * p).toInt()
            return sorted[i] / 1_000_000.0
        }

        fun render(): String = buildString {
            append(String.format("%-34s", label))
            append(String.format(" wall=%6dms", wallMs))
            append(String.format(" events=%6d", eventsWritten))
            append(String.format(" p50=%7.2fms", pct(0.50)))
            append(String.format(" p99=%8.2fms", pct(0.99)))
            append(String.format(" max=%8.2fms", pct(1.0)))
            append(String.format(" lockWait(mean/peak ungranted)=%5.2f/%3d", meanUngranted, peakUngranted))
            append(String.format(" agent_runs n_tup_upd=%6d", agentRunsUpdates))
        }
    }

    /**
     * One pass of the workload.
     *
     * [concurrentStatusUpdates] is the competing writer: a thread per run doing
     * what a lease renewal and a status transition do. Without it the run-row
     * lock looks cheap, because the only thing contending for it is other event
     * writes from the same run — which the in-process lock already serialized.
     */
    private fun pass(
        label: String,
        w: World,
        ds: HikariDataSource,
        source: RunEventStore.SequenceSource,
        batching: Boolean,
        eventsPerRun: Int = this.eventsPerRun,
        /**
         * Threads doing what a lease renewal and a status transition do.
         *
         * Eight for the MEASUREMENT, because that is what makes the run-row lock
         * expensive in production and a benchmark without it flatters the old path.
         *
         * ZERO for the REGRESSION, and that is not a simplification. The regression
         * asserts on `agent_runs` row churn, and eight threads updating that row
         * every 5ms contribute thousands of updates of their own — a number that
         * depends on how long the pass happened to take, which would bury a signal
         * that is otherwise two orders of magnitude wide. With no competing writer,
         * every update counted came from the event path, which is exactly the thing
         * under test.
         */
        competingWriters: Int = 8,
    ): Result {
        val store = RunEventStore(ds, noOpPubSub(),
            sequenceSource = source, batchEnabled = batching, batchSize = 50, flushEveryMs = 250L)
        store.start()

        val latencies = java.util.Collections.synchronizedList(mutableListOf<Long>())
        val sampler = Sampler(ds).also { it.start() }
        val before = tupUpd(ds)

        val writers = Executors.newFixedThreadPool(minOf(runs, 64))
        val statusPool = Executors.newFixedThreadPool(8)
        val stopStatus = AtomicBoolean(false)
        val done = CountDownLatch(w.runIds.size)

        // The competing writer: lease/status churn on agent_runs, throughout.
        repeat(competingWriters) {
            statusPool.submit {
                while (!stopStatus.get()) {
                    runCatching {
                        ds.connection.use { c ->
                            c.prepareStatement(
                                "UPDATE agent_runs SET updated_at = now(), lease_expires_at = now() + interval '30 seconds' " +
                                "WHERE id = ?"
                            ).use { st ->
                                st.setObject(1, w.runIds.random()); st.executeUpdate()
                            }
                        }
                    }
                    Thread.sleep(5)
                }
            }
        }

        val started = System.currentTimeMillis()
        w.runIds.forEach { runId ->
            writers.submit {
                try {
                    repeat(eventsPerRun) { i ->
                        val e = RunEventStore.RunEvent(
                            runId = runId, workspaceId = w.workspaceId, environmentId = w.environmentId,
                            type = RunEventStore.EventType.AGENT_ITERATION_STARTED,
                            status = "running", title = "i$i",
                            summary = "agent ${i % 5} iteration ${i / 5}")
                        val t0 = System.nanoTime()
                        runCatching { store.appendEvent(e) }
                        latencies += System.nanoTime() - t0
                    }
                } finally {
                    done.countDown()
                }
            }
        }
        done.await(10, TimeUnit.MINUTES)
        store.flushAll()
        val wall = System.currentTimeMillis() - started

        stopStatus.set(true)
        writers.shutdownNow(); statusPool.shutdownNow()
        sampler.stop()
        store.stop()

        val written = ds.connection.use { c ->
            c.prepareStatement("SELECT count(*) FROM run_events WHERE workspace_id = ?").use { st ->
                st.setObject(1, w.workspaceId)
                st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
            }
        }
        return Result(label, wall, latencies.toLongArray(), sampler.mean(), sampler.peak(),
            tupUpd(ds, settle = true) - before, written)
    }

    @Test
    @Tag("benchmark")
    fun `event write throughput before and after`() {

        val results = mutableListOf<Result>()
        listOf(
            Triple("BEFORE  run-row lock, no batch", RunEventStore.SequenceSource.RUN_ROW, false),
            Triple("AFTER   run-row lock + batch",   RunEventStore.SequenceSource.RUN_ROW, true),
            Triple("AFTER   counter row, no batch",  RunEventStore.SequenceSource.COUNTER, false),
            Triple("AFTER   counter row + batch",    RunEventStore.SequenceSource.COUNTER, true),
        ).forEach { (label, source, batching) ->
            /* A FRESH WORLD PER PASS. Reusing one would let the second pass write
               into a table the first already filled, and `MAX(sequence)` gets more
               expensive as a run's event count grows — the run-row mode would be
               charged for the counter mode's rows. */
            val ds = pool(32)
            val w = seed(ds, runs)
            try {
                results += pass(label, w, ds, source, batching)
            } finally {
                cleanup(ds, w); ds.close()
            }
        }

        println()
        println("═══ §12.2 event write load: $runs runs × $eventsPerRun events, pool=32, " +
                "8 competing agent_runs writers ═══")
        results.forEach { println(it.render()) }
        println()

        /* The measurement asserts too, loosely. It exists to produce the table,
           but a pass that printed a 6x regression and went green would be worse
           than useless — somebody would paste the numbers into the doc. */
        val before = results.first()
        val after = results.last()
        assertTrue(after.wallMs < before.wallMs,
            "counter+batch (${after.wallMs}ms) was not faster than run-row+no-batch " +
            "(${before.wallMs}ms) — §12.2.1's table no longer describes this code")
        results.forEach { r ->
            assertEquals(runs * eventsPerRun, r.eventsWritten,
                "${r.label}: wrote ${r.eventsWritten} of ${runs * eventsPerRun} events")
        }
    }

    /**
     * The regression. Runs on merge.
     *
     * Two passes, not four: the claim being protected is that the counter row plus
     * batching beats the run-row lock, and the two intermediate configurations are
     * there to attribute the improvement, not to establish it.
     */
    @Test
    fun `the sequence change still beats the run-row lock`() {
        /* A tenth of the measurement's volume. Enough that batching engages
           (batchSize is 50) and that row churn separates by two orders of
           magnitude; small enough to belong on every merge. */
        val regressionRuns = 20
        val regressionEvents = 100
        val expected = regressionRuns * regressionEvents

        fun measure(label: String, source: RunEventStore.SequenceSource, batching: Boolean): Result {
            val ds = pool(16)
            val w = seed(ds, regressionRuns)
            return try {
                pass(label, w, ds, source, batching,
                    eventsPerRun = regressionEvents, competingWriters = 0)
            } finally {
                cleanup(ds, w); ds.close()
            }
        }

        val before = measure("BEFORE run-row, no batch", RunEventStore.SequenceSource.RUN_ROW, false)
        val after  = measure("AFTER  counter + batch",   RunEventStore.SequenceSource.COUNTER, true)

        println()
        println("═══ regression: $regressionRuns runs × $regressionEvents events, no competing writers ═══")
        println(before.render())
        println(after.render())
        println()

        /* Correctness first. A configuration that is fast because it dropped
           events is not an improvement, and asserting throughput without this
           would rank it as one. */
        assertEquals(expected, before.eventsWritten,
            "run-row pass wrote ${before.eventsWritten} of $expected events")
        assertEquals(expected, after.eventsWritten,
            "counter+batch pass wrote ${after.eventsWritten} of $expected events")

        /*
         * ── THE STRUCTURAL ASSERTION ────────────────────────────────────────
         *
         * With no competing writer, every `agent_runs` update in a pass came from
         * event sequencing. Run-row mode takes the row per flush; counter mode
         * never touches it. Measured 14 297 vs 239 at ten times this volume.
         *
         * The bound is a tenth of the run-row pass's own churn — relative, so it
         * cannot rot as volumes change, and still an enormous margin against a
         * real separation of ~60x. Nothing about it depends on how fast the
         * machine is.
         */
        assertTrue(before.agentRunsUpdates > 0,
            "the run-row pass updated agent_runs ${before.agentRunsUpdates} times — expected " +
            "roughly one per flush. Either sequencing changed or the pg_stat read is stale, " +
            "and the churn assertion below is meaningless either way")
        assertTrue(after.agentRunsUpdates < before.agentRunsUpdates / 10,
            "counter mode updated agent_runs ${after.agentRunsUpdates} times against the " +
            "run-row mode's ${before.agentRunsUpdates}. The counter row exists so event " +
            "writes stop contending with the row that also carries status, the lease and " +
            "the fair-queueing vtime — this says they are contending again")

        /*
         * ── THE THROUGHPUT ASSERTION ────────────────────────────────────────
         *
         * Loose on purpose. Measured 6x (9192ms → 1537ms); demanded 1.5x. A tight
         * bound here would fail on a busy CI box and be disabled within a month,
         * which is how a suite ends up with no throughput coverage at all. 1.5x
         * cannot be reached by accident if the change has been reverted, and is
         * not reachable by noise if it has not.
         */
        val ratio = before.wallMs.toDouble() / maxOf(after.wallMs, 1L)
        assertTrue(ratio >= 1.5,
            "counter+batch was only ${"%.2f".format(ratio)}x faster than the run-row lock " +
            "(${before.wallMs}ms → ${after.wallMs}ms). §12.2.1 measured 6x; the guard allows " +
            "anything above 1.5x, so this is a regression rather than a slow machine")
    }
}
