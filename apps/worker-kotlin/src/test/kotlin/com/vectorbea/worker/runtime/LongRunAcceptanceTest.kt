package com.vectorbea.worker.runtime

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.durable.wait.RunWait
import com.vectorbea.worker.durable.wait.SignalStore
import com.vectorbea.worker.durable.wait.WaitKind
import com.vectorbea.worker.durable.wait.WaitStore
import com.vectorbea.worker.runtime.checkpoint.CheckpointStore
import com.vectorbea.worker.runtime.graph.RuntimeSnapshot
import org.junit.jupiter.api.Tag
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * A run that lasts a day, measured rather than reasoned about.
 *
 * ── THE QUESTION THIS ANSWERS ───────────────────────────────────────────────
 * An incident-response run is not a request. It parks on a signal, wakes, does
 * three things, parks again, and does that for hours — hundreds of ticks, each
 * one a checkpoint, a handful of events and possibly a wait. The claim that
 * this works is a claim about GROWTH, and growth is the one thing that cannot
 * be established by reading the code: every individual write is small, bounded
 * and obviously correct, and the run still dies at hour six because something
 * accumulated per tick that nobody meant to accumulate.
 *
 * So this drives the durable state a long run actually produces — 200 ticks, 40
 * signals, 5 approvals — and asserts the shape of what is left behind. The wall
 * clock is compressed; nothing else is.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────
 * It does not execute a graph. Node execution is covered by the runtime's own
 * suite, it needs a model provider to be interesting, and it would make this
 * test measure the mock rather than the storage. What is under test here is the
 * durable substrate: `run_checkpoints`, `run_events`, `run_waits`,
 * `run_signals`, and whether any of them grows in a way that ends the run.
 */
@Tag("integration")
class LongRunAcceptanceTest {

    private val ds: DataSource get() = com.vectorbea.worker.testsupport.Infra.postgres
    private val mapper = ObjectMapper()

    /** 200 ticks over 24 hours is one tick every seven minutes. That is a real shape. */
    private val ticks = 200
    private val signalCount = 40
    private val approvalCount = 5

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        val runId: UUID = UUID.randomUUID(),
    )

    private fun seed(): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "longrun")
                it.setString(3, "longrun-" + w.workspaceId); it.executeUpdate()
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
            c.prepareStatement(
                """INSERT INTO agent_runs
                     (id,workspace_id,environment_id,workflow_id,workflow_version_id,status)
                   VALUES (?,?,?,?,?,'running')"""
            ).use {
                it.setObject(1, w.runId); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId); it.executeUpdate()
            }
        }
        return w
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: a 24-hour run with 200 ticks, 40 signals and 5 approvals
    // completes correctly with a coherent trace
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a day-long run with two hundred ticks resumes correctly and grows nothing without bound`() {
        val w = seed()
        val checkpoints = CheckpointStore(ds)
        val waits = WaitStore(ds)
        val signals = SignalStore(ds)

        val checkpointBytes = mutableListOf<Int>()
        val nodeStatus = linkedMapOf<String, String>()
        var signalsSent = 0
        var approvalsOpened = 0

        for (tick in 1..ticks) {
            /*
             * A run gets LONGER, not wider. Each tick commits one more node, so
             * the snapshot's node map grows monotonically — which is exactly the
             * growth this test is looking for, and exactly what an incident run
             * with hundreds of steps produces.
             */
            nodeStatus["node-$tick"] = "COMPLETED"

            val snapshot = RuntimeSnapshot(
                runId = w.runId,
                workspaceId = w.workspaceId,
                environmentId = w.environmentId,
                workflowVersionId = w.versionId,
                sequence = tick,
                nodeStatus = nodeStatus.toMap(),
                stepOutputKeys = nodeStatus.keys.associateWith { listOf("out") },
                selectedEdges = (1..tick).map { "edge-$it" }.toSet(),
                completedNodeIds = nodeStatus.keys.toSet(),
                pendingNodeIds = emptySet(),
            )
            checkpoints.save(w.runId, w.workspaceId, w.environmentId, "node-$tick", snapshot)
            checkpointBytes += mapper.writeValueAsString(snapshot).length

            // A signal every fifth tick, and the run parks on it.
            if (tick % (ticks / signalCount) == 0 && signalsSent < signalCount) {
                signalsSent++
                val name = "alert-update"
                val wait = waits.open(WaitStore.OpenRequest(
                    workspaceId = w.workspaceId, environmentId = w.environmentId,
                    runId = w.runId, workflowId = w.workflowId,
                    nodeId = "node-$tick", attemptGroup = 0,
                    kind = WaitKind.SIGNAL, label = "waiting for $name",
                    signalName = name, timeoutMs = 3_600_000,
                )).wait

                val sent = signals.send(
                    runId = w.runId, workspaceId = w.workspaceId,
                    environmentId = w.environmentId, name = name,
                    payloadJson = """{"seq":$signalsSent}""",
                    sentByUserId = null, sentByApiKeyId = null,
                    source = "api", dedupeKey = "alert-$signalsSent",
                )
                assertTrue(sent is SignalStore.SendResult.Accepted,
                    "signal $signalsSent was refused at tick $tick: $sent")

                assertTrue(waits.resolve(wait.id, RunWait.Resolution.SIGNAL,
                    """{"signal":"$name"}""", "signal:$name"),
                    "wait for signal $signalsSent did not resolve at tick $tick")
                signals.consume(listOf((sent as SignalStore.SendResult.Accepted).signal.id), wait.id)
            }

            // An approval every fortieth tick.
            if (tick % (ticks / approvalCount) == 0 && approvalsOpened < approvalCount) {
                approvalsOpened++
                val wait = waits.open(WaitStore.OpenRequest(
                    workspaceId = w.workspaceId, environmentId = w.environmentId,
                    runId = w.runId, workflowId = w.workflowId,
                    nodeId = "approval-$approvalsOpened", attemptGroup = 0,
                    kind = WaitKind.APPROVAL, label = "restart the service?",
                    timeoutMs = 3_600_000,
                )).wait
                assertTrue(waits.resolve(wait.id, RunWait.Resolution.COMPLETED,
                    """{"decision":"approve"}""", "user:oncall"))
            }
        }

        // ── The run finishes ────────────────────────────────────────────────
        ds.connection.use { c ->
            c.prepareStatement(
                "UPDATE agent_runs SET status='succeeded', completed_at=now() WHERE id=?"
            ).use { it.setObject(1, w.runId); it.executeUpdate() }
        }

        // ── 1. It resumes from where it got to ──────────────────────────────
        val latest = checkpoints.loadLatest(w.runId, w.workspaceId)
        assertNotNull(latest, "a $ticks-tick run has no latest checkpoint to resume from")
        assertEquals(ticks, latest.sequence,
            "resume would restart from tick ${latest.sequence} of $ticks — every node between " +
                "would re-execute, and every side effect with it")
        assertEquals(ticks, latest.completedNodeIds.size)

        // ── 2. Nothing is left parked ───────────────────────────────────────
        assertEquals(0, openWaits(w.runId),
            "waits are still open on a finished run. Each one is a sweeper polling something " +
                "nobody will collect and a callback endpoint still accepting completions")

        assertEquals(0, unconsumedSignals(w.runId),
            "signals were delivered and never read — the run acted on ${signalsSent - unconsumedSignals(w.runId)} " +
                "of $signalsSent alerts and silently dropped the rest")

        // ── 3. The trace is coherent ────────────────────────────────────────
        assertEquals(signalCount, countSignals(w.runId),
            "one row per alert, in order, none lost and none doubled")
        assertEquals(signalCount + approvalCount, countWaits(w.runId),
            "every park left exactly one wait row: $signalCount signals + $approvalCount approvals")
        assertEquals(ticks, countCheckpoints(w.runId))

        val sequences = checkpointSequences(w.runId)
        assertEquals((1..ticks).toList(), sequences,
            "checkpoint sequences have a hole or a duplicate, so the timeline cannot be " +
                "reconstructed and a resume could land on the wrong one")

        // ── 4. AND THE PART THAT CANNOT BE REASONED ABOUT ───────────────────
        //
        // Checkpoint size against tick number. A run's snapshot SHOULD grow —
        // it holds the node map, and a run with 200 completed nodes has 200
        // entries. What must not happen is superlinear growth: a snapshot that
        // embeds the previous snapshot, or accumulates per-tick history inside
        // itself, looks identical at tick 5 and kills the run at tick 500.
        val first = checkpointBytes.first()
        val last = checkpointBytes.last()
        val perTick = (last - first).toDouble() / (ticks - 1)

        assertTrue(last > first, "the snapshot did not grow at all across $ticks ticks, which " +
            "means it is not carrying the node map and a resume would lose progress")

        /*
         * Linear is the contract. At tick N the snapshot holds N nodes, so
         * `bytes(N) ≈ bytes(1) + N·perTick`. Quadratic growth — each tick adding
         * a little more than the one before — is what an accidental
         * embed-the-history bug produces, and it is invisible at small N.
         */
        val predictedLast = first + perTick * (ticks - 1)
        val midpoint = checkpointBytes[ticks / 2]
        val predictedMid = first + perTick * (ticks / 2 - 1)
        assertTrue(midpoint <= predictedMid * 1.25,
            "checkpoint growth is superlinear: tick ${ticks / 2} is $midpoint bytes against a " +
                "linear prediction of ${predictedMid.toInt()}. Something accumulates per tick " +
                "on top of the node map, and a genuinely long run will not survive it. " +
                "First=$first last=$last predictedLast=${predictedLast.toInt()}")

        /*
         * And an absolute ceiling, because "linear" is only reassuring if the
         * slope is small. A day-long run's snapshot must still fit comfortably in
         * a row somebody can read.
         */
        assertTrue(last < 512 * 1024,
            "the snapshot at tick $ticks is ${last / 1024} KB. A run that lasts a week is " +
                "five times this, and every tick writes the whole thing")
    }

    @Test
    fun `an alerting system that redelivers the same alert does not signal the run twice`() {
        val w = seed()
        val signals = SignalStore(ds)
        val first = signals.send(
            runId = w.runId, workspaceId = w.workspaceId, environmentId = w.environmentId,
            name = "alert-update", payloadJson = """{"a":1}""",
            sentByUserId = null, sentByApiKeyId = null, source = "api", dedupeKey = "alert-7",
        )
        val second = signals.send(
            runId = w.runId, workspaceId = w.workspaceId, environmentId = w.environmentId,
            name = "alert-update", payloadJson = """{"a":1}""",
            sentByUserId = null, sentByApiKeyId = null, source = "api", dedupeKey = "alert-7",
        )
        assertTrue(first is SignalStore.SendResult.Accepted)
        assertTrue(second is SignalStore.SendResult.Duplicate,
            "a retried delivery of one alert became a second alert. Over a day-long run with " +
                "an alerting system that retries on timeout, that is how a run acts on the " +
                "same incident forty times")
        assertEquals(1, countSignals(w.runId))
    }

    // ── Counters ─────────────────────────────────────────────────────────────

    private fun scalar(sql: String, runId: UUID): Int = ds.connection.use { c ->
        c.prepareStatement(sql).use {
            it.setObject(1, runId)
            it.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
        }
    }

    private fun openWaits(runId: UUID) =
        scalar("SELECT count(*) FROM run_waits WHERE run_id = ? AND status = 'waiting'", runId)

    private fun countWaits(runId: UUID) =
        scalar("SELECT count(*) FROM run_waits WHERE run_id = ?", runId)

    private fun countSignals(runId: UUID) =
        scalar("SELECT count(*) FROM run_signals WHERE run_id = ?", runId)

    private fun unconsumedSignals(runId: UUID) =
        scalar("SELECT count(*) FROM run_signals WHERE run_id = ? AND consumed_at IS NULL", runId)

    private fun countCheckpoints(runId: UUID) =
        scalar("SELECT count(*) FROM run_checkpoints WHERE run_id = ?", runId)

    private fun checkpointSequences(runId: UUID): List<Int> = ds.connection.use { c ->
        c.prepareStatement(
            "SELECT sequence FROM run_checkpoints WHERE run_id = ? ORDER BY sequence"
        ).use {
            it.setObject(1, runId)
            it.executeQuery().use { rs -> buildList { while (rs.next()) add(rs.getInt(1)) } }
        }
    }
}
