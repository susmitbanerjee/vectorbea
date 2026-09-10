package com.vectorbea.worker.runtime

import com.vectorbea.worker.durable.wait.RunWait
import com.vectorbea.worker.durable.wait.SignalStore
import com.vectorbea.worker.durable.wait.WaitKind
import com.vectorbea.worker.durable.wait.WaitStore
import com.vectorbea.worker.runtime.checkpoint.CheckpointStore
import com.vectorbea.worker.runtime.graph.RuntimeSnapshot
import org.junit.jupiter.api.Tag
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Fifty long runs at once, all doing the things that park them.
 *
 * ── WHY A SOAK AND NOT A UNIT TEST ──────────────────────────────────────────
 * Every mechanism here is correct on its own and has a test that says so. What
 * this asks is different: does the SET of them still hold when fifty runs are
 * signalling, approving, parking, delegating and checkpointing through the same
 * connection pool at the same time. Those are the failures that do not appear
 * in any single-run test — a pool exhausted by a path that takes two
 * connections, a lock ordering that only deadlocks under contention, a derived
 * key that collides only when two runs share a millisecond.
 *
 * ── WHAT IT DOES NOT CLAIM ──────────────────────────────────────────────────
 * It is not a load test and it does not measure throughput. The wall clock is
 * compressed and there is no model provider, so the numbers here say nothing
 * about how fast the platform is. What it establishes is that under real
 * concurrency the durable substrate stays CONSISTENT: no lost signal, no
 * duplicated wait, no run left parked, no key collision across runs, and no
 * connection held while another is taken.
 *
 * Reported as counts rather than asserted loosely, so a regression names itself.
 */
@Tag("integration")
class ConcurrentRunSoakTest {

    private val ds: DataSource get() = com.vectorbea.worker.testsupport.Infra.postgres

    /** Fifty concurrent runs, thirty ticks each. */
    private val runCount = 50
    private val ticksPerRun = 30

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
    )

    private fun seed(): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "soak")
                it.setString(3, "soak-" + w.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) " +
                    "VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.environmentId); it.setObject(2, w.workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                    "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.workflowId); it.setObject(2, w.workspaceId)
                it.setObject(3, w.environmentId); it.setString(4, "wf-" + w.workflowId)
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.versionId); it.setObject(2, w.workflowId); it.executeUpdate() }
        }
        return w
    }

    private fun newRun(w: World, parent: UUID? = null): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO agent_runs
                     (id,workspace_id,environment_id,workflow_id,workflow_version_id,
                      status,parent_run_id)
                   VALUES (?,?,?,?,?,'running',?)"""
            ).use {
                it.setObject(1, id); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId); it.setObject(6, parent)
                it.executeUpdate()
            }
        }
        return id
    }

    @Test
    fun `fifty concurrent long runs stay consistent under signals, approvals and delegation`() {
        val w = seed()
        val waits = WaitStore(ds)
        val signals = SignalStore(ds)
        val checkpoints = CheckpointStore(ds)
        val subtree = RunSubtree(ds)

        val roots = (1..runCount).map { newRun(w) }
        /* Every fifth run delegates, so cancellation and the parent/child join
           are exercised under the same contention as everything else. */
        val children = roots.filterIndexed { i, _ -> i % 5 == 0 }
            .associateWith { parent -> (1..3).map { newRun(w, parent) } }

        val signalsSent = AtomicInteger()
        val signalsResolved = AtomicInteger()
        val approvals = AtomicInteger()
        val failures = ConcurrentLinkedQueue<String>()

        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(minOf(runCount, 16))

        roots.forEachIndexed { index, runId ->
            pool.submit {
                start.await()
                try {
                    val nodeStatus = linkedMapOf<String, String>()
                    for (tick in 1..ticksPerRun) {
                        nodeStatus["node-$tick"] = "COMPLETED"
                        checkpoints.save(runId, w.workspaceId, w.environmentId, "node-$tick",
                            RuntimeSnapshot(
                                runId = runId, workspaceId = w.workspaceId,
                                environmentId = w.environmentId, workflowVersionId = w.versionId,
                                sequence = tick, nodeStatus = nodeStatus.toMap(),
                                stepOutputKeys = emptyMap(), selectedEdges = emptySet(),
                                completedNodeIds = nodeStatus.keys.toSet(),
                                pendingNodeIds = emptySet(),
                            ))

                        if (tick % 5 == 0) {
                            /*
                             * A park and a wake. The wait key is DERIVED from
                             * (run, node, attempt) — if that derivation ever
                             * collided across runs, this is where fifty runs
                             * using the same node ids at the same moment would
                             * find it.
                             */
                            val name = "alert-$tick"
                            val wait = waits.open(WaitStore.OpenRequest(
                                workspaceId = w.workspaceId, environmentId = w.environmentId,
                                runId = runId, workflowId = w.workflowId,
                                nodeId = "node-$tick", attemptGroup = 0,
                                kind = WaitKind.SIGNAL, label = "waiting",
                                signalName = name, timeoutMs = 600_000,
                            )).wait

                            val sent = signals.send(
                                runId = runId, workspaceId = w.workspaceId,
                                environmentId = w.environmentId, name = name,
                                payloadJson = """{"tick":$tick}""",
                                sentByUserId = null, sentByApiKeyId = null,
                                source = "api", dedupeKey = "alert-$runId-$tick",
                            )
                            if (sent !is SignalStore.SendResult.Accepted) {
                                failures += "run $runId tick $tick: signal refused ($sent)"
                                continue
                            }
                            signalsSent.incrementAndGet()

                            if (waits.resolve(wait.id, RunWait.Resolution.SIGNAL,
                                    """{"signal":"$name"}""", "signal:$name")) {
                                signals.consume(listOf(sent.signal.id), wait.id)
                                signalsResolved.incrementAndGet()
                            } else {
                                failures += "run $runId tick $tick: wait ${wait.id} refused resolution"
                            }
                        }

                        if (tick % 15 == 0) {
                            val wait = waits.open(WaitStore.OpenRequest(
                                workspaceId = w.workspaceId, environmentId = w.environmentId,
                                runId = runId, workflowId = w.workflowId,
                                nodeId = "approval-$tick", attemptGroup = 0,
                                kind = WaitKind.APPROVAL, label = "restart?",
                                timeoutMs = 600_000,
                            )).wait
                            if (waits.resolve(wait.id, RunWait.Resolution.COMPLETED,
                                    """{"decision":"approve"}""", "user:oncall")) {
                                approvals.incrementAndGet()
                            } else {
                                failures += "run $runId tick $tick: approval ${wait.id} refused"
                            }
                        }
                    }

                    /*
                     * Half finish; half are cancelled, so the terminal path and
                     * the subtree walk both run under contention.
                     *
                     * A parent that SUCCEEDS has already joined its children — it
                     * cannot have their results otherwise — so they finish first
                     * and the tree is never walked. A parent that is CANCELLED has
                     * nowhere to put their results, so the walk takes them with
                     * it. Only the second case is [RunSubtree]'s business, and
                     * conflating them is how a succeeded parent would end up
                     * killing children whose output it was about to read.
                     */
                    if (index % 2 == 0) {
                        subtree.cancelDescendants(runId) { c -> cancel(c) }
                        cancel(runId)
                    } else {
                        children[runId]?.forEach { finish(it) }
                        finish(runId)
                    }
                } catch (e: Exception) {
                    failures += "run $runId threw: ${e.javaClass.simpleName}: ${e.message}"
                }
            }
        }

        start.countDown()
        pool.shutdown()
        val settled = pool.awaitTermination(10, TimeUnit.MINUTES)

        // ── The report ──────────────────────────────────────────────────────
        val stillParked = scalar(
            "SELECT count(*) FROM run_waits w JOIN agent_runs r ON r.id = w.run_id " +
                "WHERE r.workspace_id = ? AND w.status = 'waiting'", w.workspaceId)
        val unconsumed = scalar(
            "SELECT count(*) FROM run_signals WHERE workspace_id = ? AND consumed_at IS NULL",
            w.workspaceId)
        val liveRuns = scalar(
            "SELECT count(*) FROM agent_runs WHERE workspace_id = ? AND status NOT IN " +
                "('succeeded','failed','cancelled','timed_out','ceiling_exceeded','enqueue_failed')",
            w.workspaceId)
        val checkpointRows = scalar(
            "SELECT count(*) FROM run_checkpoints WHERE workspace_id = ?", w.workspaceId)

        println(
            """
            |── SOAK RESULT ────────────────────────────────────────────────────
            |  runs            $runCount roots, ${children.values.sumOf { it.size }} delegated children
            |  ticks           ${runCount * ticksPerRun}
            |  checkpoints     $checkpointRows
            |  signals         ${signalsSent.get()} sent, ${signalsResolved.get()} resolved a wait
            |  approvals       ${approvals.get()}
            |  still parked    $stillParked
            |  unconsumed      $unconsumed
            |  still live      $liveRuns
            |  failures        ${failures.size}
            |${failures.take(20).joinToString("\n") { "|    $it" }}
            |───────────────────────────────────────────────────────────────────
            """.trimMargin()
        )

        assertTrue(settled, "the soak did not settle within ten minutes — something is blocked, " +
            "and under this load the first suspect is a path that holds one pooled connection " +
            "while taking another")

        assertTrue(failures.isEmpty(),
            "${failures.size} operations failed under concurrency. First: ${failures.firstOrNull()}")

        assertEquals(runCount * (ticksPerRun / 5), signalsSent.get(),
            "signals were lost between runs")
        assertEquals(signalsSent.get(), signalsResolved.get(),
            "a signal was accepted but resolved no wait. Under contention that means two runs " +
                "raced for one wait row, which the derived key is supposed to make impossible")
        assertEquals(runCount * (ticksPerRun / 15), approvals.get())
        assertEquals(runCount * ticksPerRun, checkpointRows)

        assertEquals(0, liveRuns,
            "$liveRuns runs are still live after every root reached a terminal state. Delegated " +
                "children left behind are the M3 leak, at scale")
        assertEquals(0, stillParked,
            "$stillParked waits are still open on terminal runs. Each is a sweeper polling " +
                "something nobody will collect")
        assertEquals(0, unconsumed,
            "$unconsumed signals were delivered and never read")
    }

    private fun cancel(runId: UUID): Boolean = ds.connection.use { c ->
        val won = c.prepareStatement(
            """UPDATE agent_runs SET status='cancelled', completed_at=now()
                WHERE id = ? AND status NOT IN
                  ('succeeded','failed','cancelled','timed_out','ceiling_exceeded','enqueue_failed')"""
        ).use { it.setObject(1, runId); it.executeUpdate() > 0 }
        won
    }.also { if (it) WaitStore(ds).cancelAllForRun(runId, "cancelled") }

    private fun finish(runId: UUID) {
        ds.connection.use { c ->
            c.prepareStatement(
                "UPDATE agent_runs SET status='succeeded', completed_at=now() WHERE id=?"
            ).use { it.setObject(1, runId); it.executeUpdate() }
        }
        WaitStore(ds).cancelAllForRun(runId, "the run reached succeeded")
    }

    private fun scalar(sql: String, id: UUID): Int = ds.connection.use { c ->
        c.prepareStatement(sql).use {
            it.setObject(1, id)
            it.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
        }
    }
}
