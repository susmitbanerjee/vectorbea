package com.vectorbea.worker.durable.wait

import com.vectorbea.worker.durable.ResumeReconciler
import com.vectorbea.worker.queue.WorkflowRunJob
import org.junit.jupiter.api.Tag
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * "The reconciler recovers every wait kind. Enumerate them and test each."
 *
 * ── THE ENUMERATION IS `WaitKind.entries`, NOT A LIST IN THIS FILE ──────────
 * A hand-written list here would be a list somebody forgets to extend, and the
 * symptom of forgetting is runs of the new kind parked forever with nothing
 * sweeping them — which is invisible until a customer notices. Walking the enum
 * means adding a fifth kind without covering it fails THIS test at compile time
 * or at run time, rather than in production weeks later.
 *
 * ── AND WHY EACH CASE PARKS A REAL RUN ──────────────────────────────────────
 * Every arm of the sweep is a SQL predicate over rows that disagree with each
 * other: a wait resolved beside a run still `waiting_for_event`, a signal
 * unconsumed beside a parked run. Mocking the query would assert that the SQL I
 * wrote matches the SQL I wrote.
 *
 * The enqueue is a lambda, so "the resume was lost" is expressed by not calling
 * it — the actual failure, not a simulation.
 */
@Tag("integration")
class WaitReconciliationTest {

    private val ds: DataSource get() = com.vectorbea.worker.testsupport.Infra.postgres

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
                it.setObject(1, w.workspaceId); it.setString(2, "wait-recon")
                it.setString(3, "wait-recon-" + w.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
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

    /** Parked well past `minParkedMs`, so the sweep considers it. */
    private fun parkedRun(w: World, status: String): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id," +
                    " workflow_version_id,status,updated_at) " +
                    "VALUES (?,?,?,?,?,?, now() - interval '5 minutes')"
            ).use {
                it.setObject(1, id); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId); it.setString(6, status)
                it.executeUpdate()
            }
        }
        return id
    }

    private fun cleanup(w: World) = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
        }
    }

    private fun reconciler(sink: MutableCollection<WorkflowRunJob>) =
        ResumeReconciler(ds, enqueue = { sink += it }, minParkedMs = 1_000)

    private fun openWait(w: World, runId: UUID, kind: WaitKind, nodeId: String = "n-1") =
        WaitStore(ds).open(
            WaitStore.OpenRequest(
                workspaceId = w.workspaceId, environmentId = w.environmentId,
                runId = runId, workflowId = w.workflowId, nodeId = nodeId,
                attemptGroup = 0, kind = kind, label = "a wait of kind ${kind.wire}",
                signalName = if (kind == WaitKind.SIGNAL || kind == WaitKind.AGENT_WAIT)
                    "wake_up" else null,
            )
        ).wait

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: every wait kind is recovered
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a resolved wait of EVERY kind is recovered when its resume was lost`() {
        for (kind in WaitKind.entries) {
            val w = seed()
            try {
                val store = WaitStore(ds)
                val runId = parkedRun(w, kind.runStatus)
                val wait = openWait(w, runId, kind)

                /* The bug being reproduced: durable state changed, and the resume
                   that should have followed was never enqueued. */
                assertTrue(store.resolve(wait.id, RunWait.Resolution.COMPLETED, "{}", "test"))

                val enqueued = ConcurrentLinkedQueue<WorkflowRunJob>()
                reconciler(enqueued).tick()

                assertTrue(
                    enqueued.any { it.runId == runId },
                    "kind '${kind.wire}' parked as '${kind.runStatus}' was NOT recovered. " +
                        "Its wait resolved and nothing re-enqueued the resume, so the run " +
                        "is parked forever.",
                )
            } finally { cleanup(w) }
        }
    }

    @Test
    fun `an expired wait of EVERY kind is recovered when the sweeper did not run`() {
        for (kind in WaitKind.entries) {
            /*
             * Only the kinds that park as `waiting_for_event` have this arm.
             * Approvals park as `waiting_for_approval` and are covered by the
             * reconciler's original `approval_resolved` arm, which keys on the
             * decision row rather than on a deadline — deliberately, because an
             * approval with no decision is a person who has not answered yet, and
             * waking that run would achieve nothing.
             */
            if (kind.runStatus != "waiting_for_event") continue

            val w = seed()
            try {
                val runId = parkedRun(w, kind.runStatus)
                val wait = openWait(w, runId, kind)
                expire(wait.id)

                val enqueued = ConcurrentLinkedQueue<WorkflowRunJob>()
                reconciler(enqueued).tick()

                assertTrue(
                    enqueued.any { it.runId == runId },
                    "kind '${kind.wire}' has an expired wait and was not recovered. " +
                        "Disabling WaitSweeper would then make every timeout permanent, " +
                        "which is the parked-forever failure the timeout exists to prevent.",
                )
            } finally { cleanup(w) }
        }
    }

    @Test
    fun `a pending signal against a parked run is recovered`() {
        val w = seed()
        try {
            val runId = parkedRun(w, "waiting_for_event")
            openWait(w, runId, WaitKind.AGENT_WAIT)
            SignalStore(ds).send(runId, w.workspaceId, w.environmentId, "wake_up",
                "{}", null, null, "api", null)

            val enqueued = ConcurrentLinkedQueue<WorkflowRunJob>()
            reconciler(enqueued).tick()

            assertTrue(
                enqueued.any { it.runId == runId },
                "the answer had already arrived and was sitting unconsumed. Unlike a " +
                    "lost callback, waiting for the deadline here would be wrong.",
            )
        } finally { cleanup(w) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The sweep must be conservative: a healthy parked run is never touched
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a run still legitimately waiting is left alone`() {
        val w = seed()
        try {
            val runId = parkedRun(w, "waiting_for_event")
            openWait(w, runId, WaitKind.ASYNC_TOOL)

            val enqueued = ConcurrentLinkedQueue<WorkflowRunJob>()
            reconciler(enqueued).tick()

            assertEquals(0, enqueued.count { it.runId == runId },
                "a run whose six-minute render is still running was woken. It would " +
                    "re-execute the node, find the wait still open, and park again — " +
                    "a resume loop against a job that is going perfectly well.")
        } finally { cleanup(w) }
    }

    @Test
    fun `a run holding one resolved and one open wait is left alone`() {
        val w = seed()
        try {
            val store = WaitStore(ds)
            val runId = parkedRun(w, "waiting_for_event")
            val done = openWait(w, runId, WaitKind.ASYNC_TOOL, nodeId = "a")
            openWait(w, runId, WaitKind.ASYNC_TOOL, nodeId = "b")

            assertTrue(store.resolve(done.id, RunWait.Resolution.COMPLETED, "{}", "test"))

            val enqueued = ConcurrentLinkedQueue<WorkflowRunJob>()
            reconciler(enqueued).tick()

            assertEquals(0, enqueued.count { it.runId == runId },
                "a fan-out with one branch finished and one still rendering is CORRECTLY " +
                    "parked. `NOT EXISTS ... still waiting` is what expresses that; " +
                    "`EXISTS ... resolved` would have woken it.")
        } finally { cleanup(w) }
    }

    @Test
    fun `every wait kind declares a parked status the resume CAS accepts`() {
        /*
         * The state-machine check, as a unit assertion rather than a comment.
         *
         * A kind whose `runStatus` is not in `RunProcessor`'s resumable list would
         * park runs that no resume can ever move — the CAS would refuse every
         * attempt, silently, and the reconciler would re-enqueue forever.
         */
        val resumable = setOf(
            "waiting_for_approval", "waiting_for_event", "recovering",
            "waiting_for_timer", "yielded", "queued",
        )
        for (kind in WaitKind.entries) {
            assertTrue(
                kind.runStatus in resumable,
                "kind '${kind.wire}' parks runs as '${kind.runStatus}', which " +
                    "RunProcessor's resume CAS does not accept. Every resume would be " +
                    "refused and the run could never move.",
            )
        }
        assertEquals(
            setOf("waiting_for_approval", "waiting_for_event"),
            WaitKind.PARKED_STATUSES.toSet(),
            "the set of statuses a wait can park in changed. Check the reconciler's " +
                "`parked` CTE and RunProcessor's resume CAS before updating this.",
        )
    }

    private fun expire(waitId: UUID) = ds.connection.use { c ->
        c.prepareStatement(
            "UPDATE run_waits SET timeout_at = now() - interval '1 minute' WHERE id = ?"
        ).use { it.setObject(1, waitId); it.executeUpdate() }
    }
}
