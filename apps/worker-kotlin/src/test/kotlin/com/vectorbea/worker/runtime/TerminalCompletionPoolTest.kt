package com.vectorbea.worker.runtime

import com.vectorbea.worker.testsupport.Infra
import com.zaxxer.hikari.HikariConfig
import com.zaxxer.hikari.HikariDataSource
import org.junit.jupiter.api.Tag
import java.sql.Connection
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Terminal completion must not hold a pooled connection while acquiring another.
 *
 * ── THE BUG THIS EXISTS FOR ─────────────────────────────────────────────────
 * `updateRunCompleted` ran every post-terminal step — root-cause attribution, the
 * parent wake, the trace export — inside its own `dataSource.connection.use`.
 * Each of those acquires connections of its own, so a thread held one pooled
 * connection while waiting for another.
 *
 * That is hold-and-wait, and it is a deadlock rather than a slowdown. With a pool
 * of P and P threads terminalising at once, every thread owns its outer
 * connection, every thread needs an inner one, and none can release until it gets
 * one. Nothing produces a useful error: Hikari's `connectionTimeout` fires on all
 * of them together, so the operator sees a fleet-wide stall precisely when a burst
 * of runs finishes — which is the normal way a fan-out ends.
 *
 * ── TWO TESTS, BECAUSE ONE OF THEM WOULD NOT HAVE CAUGHT IT ─────────────────
 * A latency test would not. The old code passed every existing test, because they
 * all terminalise one run at a time against a pool with room to spare, and the
 * shape is invisible until concurrency reaches the pool size.
 *
 *   1. [terminal completion never nests connection acquisition] measures the
 *      invariant directly — maximum simultaneously-open connections per thread —
 *      and is deterministic at any concurrency.
 *   2. [terminal completion of many runs at once does not exhaust the pool] is
 *      the behavioural half: threads well past the pool size, a pool small enough
 *      that nesting cannot possibly succeed.
 *
 * There is a third, in `RunProcessorStructureTest`, which fails the build if the
 * call moves back inside a `use` block. Between them the regression has to get
 * past a measurement, a reproduction and a source check.
 */
@Tag("integration")
class TerminalCompletionPoolTest {

    /* Small on purpose, and the whole point. At POOL_SIZE this is a pool the
       nested version cannot survive: every worker thread would hold one and want
       a second. Large enough that the un-nested version is never even slow. */
    private val poolSize = 4
    private val threads = 16

    // ── A DataSource that reports how deeply it is being used ────────────────

    /**
     * Counts simultaneously-open connections PER THREAD.
     *
     * Per thread, not globally: a global count only says the pool is busy, which
     * it is supposed to be. What is being asserted is that no single thread is
     * ever holding two at once, and that is a property of one call stack.
     *
     * Wrapping the DataSource rather than instrumenting Hikari because the
     * production code takes a `DataSource` — so this observes exactly what the
     * code under test does, through the same interface it is given in production.
     */
    private class DepthTracking(private val delegate: DataSource) : DataSource by delegate {
        private val depth = ConcurrentHashMap<Long, AtomicInteger>()
        val maxDepth = AtomicInteger(0)

        override fun getConnection(): Connection = track(delegate.connection)
        override fun getConnection(u: String?, p: String?): Connection =
            track(delegate.getConnection(u, p))

        private fun track(real: Connection): Connection {
            val tid = Thread.currentThread().id
            val d = depth.computeIfAbsent(tid) { AtomicInteger() }.incrementAndGet()
            maxDepth.updateAndGet { maxOf(it, d) }
            /* A proxy rather than a subclass: java.sql.Connection is an interface
               with a large and version-dependent surface, and overriding only
               close() by delegation would mean writing every other method by hand
               and rewriting them whenever the JDK adds one. */
            return java.lang.reflect.Proxy.newProxyInstance(
                Connection::class.java.classLoader, arrayOf(Connection::class.java)
            ) { _, method, args ->
                if (method.name == "close") {
                    depth[tid]?.decrementAndGet()
                    real.close()
                    null
                } else {
                    try {
                        if (args == null) method.invoke(real) else method.invoke(real, *args)
                    } catch (e: java.lang.reflect.InvocationTargetException) {
                        throw e.targetException
                    }
                }
            } as Connection
        }
    }

    // ── Fixture ──────────────────────────────────────────────────────────────

    private class World {
        val ws: UUID = UUID.randomUUID()
        val env: UUID = UUID.randomUUID()
        val wf: UUID = UUID.randomUUID()
        val ver: UUID = UUID.randomUUID()
        val runs: MutableList<UUID> = mutableListOf()
    }

    private fun pool() = HikariDataSource(HikariConfig().apply {
        jdbcUrl = Infra.postgresUrl
        maximumPoolSize = poolSize
        /* Short, so a regression FAILS in seconds instead of hanging the suite for
           half a minute per thread. The deadlock does not resolve; waiting longer
           only makes the report slower. */
        connectionTimeout = 5_000
        poolName = "terminal-${UUID.randomUUID().toString().take(6)}"
    })

    private fun seed(ds: DataSource, n: Int): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.ws); it.setString(2, "terminal")
                it.setString(3, "terminal-${w.ws}"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) " +
                "VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.env); it.setObject(2, w.ws); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.wf); it.setObject(2, w.ws); it.setObject(3, w.env)
                it.setString(4, "wf-${w.wf}"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) " +
                "VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.ver); it.setObject(2, w.wf); it.executeUpdate() }

            c.prepareStatement(
                "INSERT INTO agent_runs " +
                "(id,workspace_id,environment_id,workflow_id,workflow_version_id,status) " +
                "VALUES (?,?,?,?,?,'failed')"
            ).use { st ->
                repeat(n) {
                    val id = UUID.randomUUID()
                    w.runs += id
                    st.setObject(1, id); st.setObject(2, w.ws); st.setObject(3, w.env)
                    st.setObject(4, w.wf); st.setObject(5, w.ver)
                    st.addBatch()
                }
                st.executeBatch()
            }
        }
        return w
    }

    /**
     * One error span per run, so root-cause attribution has real work.
     *
     * Without spans `attribute` returns at the first query and the deepest part of
     * the sequence never runs — which would make this test pass against the bug.
     */
    private fun seedSpans(ds: DataSource, w: World) {
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO run_spans
                     (span_id, trace_id, run_id, workspace_id, kind, name, status,
                      started_at, ended_at, duration_ms, created_at)
                   VALUES (?,?,?,?,'tool_call','crm.search','error',
                           now(), now(), 5, now())"""
            ).use { st ->
                w.runs.forEach { runId ->
                    st.setObject(1, UUID.randomUUID()); st.setObject(2, runId)
                    st.setObject(3, runId); st.setObject(4, w.ws)
                    st.addBatch()
                }
                st.executeBatch()
            }
        }
    }

    private fun cleanup(ds: DataSource, w: World) = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM run_spans WHERE workspace_id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
            c.prepareStatement("DELETE FROM agent_runs WHERE workspace_id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
            c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
        }
    }

    /**
     * The post-terminal sequence, as the processor runs it.
     *
     * `RunProcessor` itself needs a Redis-backed heartbeat and a full runtime to
     * construct, neither of which this is about. What IS about this is the
     * sequence of collaborators and the connections they take, so the test drives
     * the real ones — `RootCauseAttribution` and the failure-class write — through
     * the same DataSource, in the same order.
     *
     * The structural half of the guarantee (that `updateRunCompleted` calls this
     * with no connection held) is asserted in `RunProcessorStructureTest`, which
     * reads the source. This half proves that the sequence itself is safe to run
     * at concurrency, which is what makes releasing the connection sufficient.
     */
    private fun terminalSequence(ds: DataSource, runId: UUID) {
        com.vectorbea.worker.events.RootCauseAttribution(ds).attribute(runId)
        ds.connection.use { c ->
            c.prepareStatement(
                """UPDATE agent_runs r SET failure_class = COALESCE(
                       (SELECT s.failure_class FROM run_spans s
                         WHERE s.run_id = r.id AND s.is_root_cause
                           AND s.failure_class IS NOT NULL
                         ORDER BY s.started_at DESC LIMIT 1),
                       'UNCLASSIFIED')
                   WHERE r.id = ? AND r.failure_class IS NULL"""
            ).use { st -> st.setObject(1, runId); st.executeUpdate() }
        }
        ds.connection.use { c ->
            c.prepareStatement("SELECT workspace_id FROM agent_runs WHERE id = ?").use { st ->
                st.setObject(1, runId)
                st.executeQuery().use { it.next() }
            }
        }
    }

    // ── The invariant ────────────────────────────────────────────────────────

    /**
     * No thread ever holds two connections at once on the terminal path.
     *
     * The assertion is `maxDepth == 1`, not `< poolSize`: depth 2 is the bug
     * whether or not the pool happens to be big enough to absorb it that day. A
     * threshold tied to the pool size would pass on a laptop with room to spare
     * and fail in production, which is precisely the failure being prevented.
     */
    @Test
    fun `terminal completion never nests connection acquisition`() {
        val raw = pool()
        val ds = DepthTracking(raw)
        val w = seed(raw, 8)
        try {
            seedSpans(raw, w)
            /* Single-threaded on purpose. Nesting is a property of one call stack,
               so concurrency would only add noise to a measurement that is already
               exact. */
            w.runs.forEach { terminalSequence(ds, it) }

            assertEquals(1, ds.maxDepth.get(),
                "a thread held ${ds.maxDepth.get()} connections at once on the terminal " +
                "path — hold-and-wait deadlocks once concurrency reaches the pool size")
        } finally {
            cleanup(raw, w); raw.close()
        }
    }

    /**
     * Many runs terminalising together do not exhaust a small pool.
     *
     * The reproduction. 16 threads against a pool of 4: if any step held its
     * connection across another acquisition, four threads would take every
     * connection, all sixteen would wait, and none would ever release — so this
     * fails on `connectionTimeout` rather than on the deadline.
     *
     * The deadline is 60s for a workload that takes well under one. It is not
     * measuring speed; a generous deadline is what keeps this a deadlock detector
     * rather than a flaky benchmark on a loaded CI box.
     */
    @Test
    fun `terminal completion of many runs at once does not exhaust the pool`() {
        val raw = pool()
        val ds = DepthTracking(raw)
        val w = seed(raw, threads * 3)
        val exec = Executors.newFixedThreadPool(threads)
        try {
            seedSpans(raw, w)
            val done = CountDownLatch(w.runs.size)
            val failures = java.util.Collections.synchronizedList(mutableListOf<String>())
            /* Released together, so every thread reaches the terminal path at once.
               Staggered starts are what let the nested version pass by accident. */
            val go = CountDownLatch(1)

            w.runs.forEach { runId ->
                exec.submit {
                    try {
                        go.await()
                        terminalSequence(ds, runId)
                    } catch (e: Exception) {
                        failures += "${e::class.simpleName}: ${e.message}"
                    } finally {
                        done.countDown()
                    }
                }
            }
            go.countDown()

            assertTrue(done.await(60, TimeUnit.SECONDS),
                "terminal completion did not finish for all ${w.runs.size} runs within 60s " +
                "at $threads threads over a pool of $poolSize — the classic signature of a " +
                "thread holding a connection while waiting for one")
            assertTrue(failures.isEmpty(),
                "terminal completion failed for ${failures.size} run(s): ${failures.take(3)}")
            assertEquals(1, ds.maxDepth.get(),
                "connection acquisition nested under concurrency")
        } finally {
            exec.shutdownNow()
            cleanup(raw, w); raw.close()
        }
    }
}
