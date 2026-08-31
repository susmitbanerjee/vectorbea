package com.vectorbea.worker.events

import com.vectorbea.worker.testsupport.noOpPubSub
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import org.junit.jupiter.api.Assumptions.assumeTrue
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.sql.DataSource
import kotlin.test.Test

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
 * Opt-in — it writes ~15k rows and takes tens of seconds. Run it with:
 *
 *     EVENT_LOAD_TEST=true ./gradlew :worker-kotlin:test --tests '*EventWriteLoadTest'
 */
class EventWriteLoadTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

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

    private fun enabled(): Boolean =
        System.getenv("EVENT_LOAD_TEST")?.lowercase() == "true"

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
        repeat(8) {
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
    fun `event write throughput before and after`() {
        assumeTrue(enabled(), "set EVENT_LOAD_TEST=true to run the load test")

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
    }
}
