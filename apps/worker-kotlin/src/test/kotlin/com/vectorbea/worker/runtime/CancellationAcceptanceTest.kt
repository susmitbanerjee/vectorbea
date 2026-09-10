package com.vectorbea.worker.runtime

import com.vectorbea.worker.durable.wait.RunWait
import com.vectorbea.worker.durable.wait.WaitKind
import com.vectorbea.worker.durable.wait.WaitStore
import org.junit.jupiter.api.Tag
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Cancelling a run has to reach everything the run was holding.
 *
 * ── WHY THIS IS THE TEST THAT WAS MISSING ───────────────────────────────────
 * Cancellation paths are consistently the least tested part of a runtime: the
 * happy path exercises none of them, and a cancelled run produces no output
 * anybody inspects. M3's capacity leak lived here — the cancellation was
 * recorded, the run stopped, and three delegated children carried on calling
 * models against a parent that had stopped caring, each holding a provider
 * capacity reservation and an unsettled budget reservation, with no upper bound
 * and nothing that would ever notice.
 *
 * `parent_run_id` points UP. Nothing walked it down until [RunSubtree].
 *
 * ── WHAT THIS COVERS, AND WHAT IT DOES NOT ──────────────────────────────────
 * The WALK: every descendant, at every depth, exactly once, terminating on a
 * cycle, and leaving already-finished runs alone. The per-child terminal
 * transition itself — settling budget, closing waits, queueing deliveries — is
 * `RunProcessor.updateRunCompleted`, which every other terminal path in the
 * suite already exercises; here it is stood in for by the same status CAS and
 * the same wait cancellation, so "leaks no reservations" is asserted against
 * real rows rather than against a recorded call.
 */
@Tag("integration")
class CancellationAcceptanceTest {

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
                it.setObject(1, w.workspaceId); it.setString(2, "cancel")
                it.setString(3, "cancel-" + w.workspaceId); it.executeUpdate()
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

    private fun run(w: World, parent: UUID? = null, status: String = "running"): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO agent_runs
                     (id,workspace_id,environment_id,workflow_id,workflow_version_id,
                      status,parent_run_id)
                   VALUES (?,?,?,?,?,?,?)"""
            ).use {
                it.setObject(1, id); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId)
                it.setString(6, status); it.setObject(7, parent)
                it.executeUpdate()
            }
        }
        return id
    }

    /**
     * The terminal transition, standing in for `RunProcessor.updateRunCompleted`.
     *
     * The two things that matter for this test are its two properties: it is a
     * COMPARE-AND-SET that refuses a run already terminal, and it closes the
     * run's waits. Everything the real one adds — metering, deliveries, waking
     * the parent — sits behind the same CAS and is covered where it lives.
     */
    private fun terminate(w: World, childId: UUID, calls: MutableList<UUID>): Boolean {
        calls += childId
        val won = ds.connection.use { c ->
            c.prepareStatement(
                """UPDATE agent_runs SET status = 'cancelled', completed_at = now()
                    WHERE id = ? AND status NOT IN
                      ('succeeded','failed','cancelled','timed_out',
                       'ceiling_exceeded','enqueue_failed')"""
            ).use { it.setObject(1, childId); it.executeUpdate() > 0 }
        }
        if (won) WaitStore(ds).cancelAllForRun(childId, "the parent run was cancelled")
        return won
    }

    private fun statusOf(runId: UUID): String = ds.connection.use { c ->
        c.prepareStatement("SELECT status FROM agent_runs WHERE id = ?").use {
            it.setObject(1, runId)
            it.executeQuery().use { rs -> rs.next(); rs.getString(1) }
        }
    }

    /** A wait the run is holding, so "leaks nothing" has something to be true of. */
    private fun park(w: World, runId: UUID, node: String): RunWait =
        WaitStore(ds).open(WaitStore.OpenRequest(
            workspaceId = w.workspaceId,
            environmentId = w.environmentId,
            runId = runId,
            workflowId = w.workflowId,
            nodeId = node,
            attemptGroup = 0,
            kind = WaitKind.ASYNC_TOOL,
            label = "rendering",
            externalRef = "job-$node",
            timeoutMs = 3_600_000,
        )).wait

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: cancelling a run with three active delegated children
    // terminates all of them and leaks no capacity reservations
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `cancelling a parent terminates all three delegated children and leaks nothing`() {
        val w = seed()
        val parent = run(w)
        val children = (1..3).map { run(w, parent = parent) }
        /* Each child mid-flight on an async tool. These are the rows the sweeper
           keeps polling and the callback endpoint keeps accepting — the leak. */
        val parked = children.mapIndexed { i, child -> park(w, child, "render-$i") }

        val calls = mutableListOf<UUID>()
        val cancelled = RunSubtree(ds).cancelDescendants(parent) { terminate(w, it, calls) }

        assertEquals(3, cancelled)
        children.forEach { child ->
            assertEquals("cancelled", statusOf(child),
                "child $child was still executing after its parent was cancelled — it would " +
                    "keep calling models for a result nobody will ever read")
        }
        parked.forEach { wait ->
            val after = WaitStore(ds).findById(wait.id, w.workspaceId)
            assertTrue(after != null && after.status != RunWait.Status.WAITING,
                "a cancelled child's wait is still `waiting`, so the sweeper keeps polling a " +
                    "provider for a job nobody will collect and the callback endpoint keeps " +
                    "accepting completions for it. Status was: ${after?.status}")
        }
    }

    @Test
    fun `cancellation reaches grandchildren, not just the first generation`() {
        val w = seed()
        val parent = run(w)
        val child = run(w, parent = parent)
        val grandchild = run(w, parent = child)
        val greatGrandchild = run(w, parent = grandchild)

        val calls = mutableListOf<UUID>()
        RunSubtree(ds).cancelDescendants(parent) { terminate(w, it, calls) }

        listOf(child, grandchild, greatGrandchild).forEach {
            assertEquals("cancelled", statusOf(it),
                "a delegation tree is a tree; stopping at depth one leaves the deepest and " +
                    "most expensive work running")
        }
    }

    @Test
    fun `a child parked on an approval is still live, and is still cancelled`() {
        val w = seed()
        val parent = run(w)
        /*
         * The live set is a DENY-list of terminal statuses, not `= 'running'`. A
         * child waiting on a person, a timer or a sibling is very much still
         * holding its reservations, and an allow-list of "running" would have
         * left every one of them behind.
         */
        val parked = listOf("waiting_for_approval", "waiting_for_timer", "yielded", "queued")
            .map { run(w, parent = parent, status = it) }

        val calls = mutableListOf<UUID>()
        RunSubtree(ds).cancelDescendants(parent) { terminate(w, it, calls) }

        parked.forEach { assertEquals("cancelled", statusOf(it)) }
    }

    @Test
    fun `a child that already finished is not disturbed`() {
        val w = seed()
        val parent = run(w)
        val live = run(w, parent = parent)
        val done = run(w, parent = parent, status = "succeeded")

        val calls = mutableListOf<UUID>()
        val cancelled = RunSubtree(ds).cancelDescendants(parent) { terminate(w, it, calls) }

        assertEquals(1, cancelled, "only the live child counts")
        assertEquals("cancelled", statusOf(live))
        assertEquals("succeeded", statusOf(done),
            "a completed child keeps its result rather than being overwritten by the " +
                "cancellation — it is not in the live set, and the CAS would refuse it anyway")
    }

    @Test
    fun `cancelling twice cancels each descendant exactly once`() {
        val w = seed()
        val parent = run(w)
        val child = run(w, parent = parent)
        val grandchild = run(w, parent = child)

        val calls = mutableListOf<UUID>()
        val subtree = RunSubtree(ds)
        val first = subtree.cancelDescendants(parent) { terminate(w, it, calls) }
        /* A redelivered queue message. Every descendant is terminal now, so the
           second pass finds an empty frontier and does nothing. */
        val second = subtree.cancelDescendants(parent) { terminate(w, it, calls) }

        assertEquals(2, first)
        assertEquals(0, second,
            "the second cancellation cancelled something again, which means a redelivered " +
                "message could clobber a winner's terminal row")
        assertEquals(listOf(child, grandchild), calls,
            "and it did not even attempt them a second time")
    }

    @Test
    fun `a cycle in parent_run_id cannot loop forever`() {
        val w = seed()
        val a = run(w)
        val b = run(w, parent = a)
        /* The schema cannot express this; a bug could still write it. Without the
           depth bound this is an infinite loop holding a connection. */
        ds.connection.use { c ->
            c.prepareStatement("UPDATE agent_runs SET parent_run_id = ? WHERE id = ?").use {
                it.setObject(1, b); it.setObject(2, a); it.executeUpdate()
            }
        }

        val calls = mutableListOf<UUID>()
        val cancelled = RunSubtree(ds).cancelDescendants(a) { terminate(w, it, calls) }

        assertTrue(cancelled >= 1, "it should still cancel what it reached")
        assertEquals("cancelled", statusOf(b))
        assertTrue(calls.size <= RunSubtree.MAX_DEPTH * 4,
            "the walk did not terminate promptly on a cycle: ${calls.size} attempts")
    }

    @Test
    fun `a run with no children cancels nothing and reads the tree once`() {
        val w = seed()
        val lonely = run(w)
        val calls = mutableListOf<UUID>()
        assertEquals(0, RunSubtree(ds).cancelDescendants(lonely) { terminate(w, it, calls) })
        assertTrue(calls.isEmpty())
    }
}
