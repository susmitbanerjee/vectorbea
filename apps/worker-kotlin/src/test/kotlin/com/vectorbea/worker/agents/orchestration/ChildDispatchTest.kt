package com.vectorbea.worker.agents.orchestration

import com.vectorbea.worker.agents.orchestration.ActivationPlacement.Placement
import com.vectorbea.worker.queue.WorkflowRunJob
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.postgresql.ds.PGSimpleDataSource
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §11's placement rule. Pure, so exhaustively.
 *
 * The rule's ORDER is its specification: a short-lived activation with a
 * deadline goes inline even inside a wide fan-out, because the queue round-trip
 * is what would miss the deadline. Reordering the first two clauses changes
 * which property wins, so each case here pins one clause against the ones below
 * it rather than testing them in isolation.
 */
class ActivationPlacementTest {

    private fun pending(
        joinGroupSize: Int = 1,
        depth: Int = 0,
        estimatedDurationMs: Long? = null,
        remainingTickBudgetMs: Long? = null,
        hasDeadline: Boolean = false,
        isShortLived: Boolean = false,
    ) = ActivationPlacement.Pending(
        joinGroupSize, depth, estimatedDurationMs, remainingTickBudgetMs,
        hasDeadline, isShortLived)

    @Test
    fun `inline is the default`() {
        /* The doc is explicit: start inline, it is strictly simpler, and the
           existing yield machinery already handles a tick running out. */
        assertEquals(Placement.INLINE, ActivationPlacement.placementOf(pending()))
        assertEquals(Placement.INLINE, ActivationPlacement.placementOf(pending(depth = 2)))
    }

    @Test
    fun `a wide fan-out dispatches`() {
        /* Above the threshold is what dispatch is FOR: N children under one
           permit are N coroutines on one worker, and the point of a fan-out is
           that they run on different ones. */
        assertEquals(Placement.INLINE, ActivationPlacement.placementOf(pending(joinGroupSize = 3)))
        assertEquals(Placement.DISPATCHED, ActivationPlacement.placementOf(pending(joinGroupSize = 4)))
    }

    @Test
    fun `a deadline on short work beats a wide fan-out`() {
        /*
         * THE ORDER IS THE SPECIFICATION. This activation is in a 10-wide
         * fan-out and still goes inline, because a caller is waiting and the
         * queue hop costs more than the work does. Swap the first two clauses
         * and this silently becomes DISPATCHED.
         */
        assertEquals(Placement.INLINE, ActivationPlacement.placementOf(
            pending(joinGroupSize = 10, hasDeadline = true, isShortLived = true)))

        /* A deadline on work that is NOT short does not buy inline: it would
           blow the deadline inside the tick instead of outside it. */
        assertEquals(Placement.DISPATCHED, ActivationPlacement.placementOf(
            pending(joinGroupSize = 10, hasDeadline = true, isShortLived = false)))
    }

    @Test
    fun `work that will not fit in the tick dispatches`() {
        assertEquals(Placement.DISPATCHED, ActivationPlacement.placementOf(
            pending(estimatedDurationMs = 30_000, remainingTickBudgetMs = 10_000)))
        assertEquals(Placement.INLINE, ActivationPlacement.placementOf(
            pending(estimatedDurationMs = 5_000, remainingTickBudgetMs = 10_000)))
    }

    @Test
    fun `a nearly-spent tick dispatches whatever the estimate says`() {
        /*
         * Without the floor, an activation that "fits" in the 40 ms remaining is
         * placed inline, overruns, and the tick yields anyway — paying the
         * dispatch latency AND the yield.
         */
        assertEquals(Placement.DISPATCHED, ActivationPlacement.placementOf(
            pending(estimatedDurationMs = 10, remainingTickBudgetMs = 40)))
    }

    @Test
    fun `an unknown duration counts as fitting`() {
        /* Dispatching everything nobody estimated would make dispatch the default
           by accident, and the doc is explicit that inline is the default. */
        assertEquals(Placement.INLINE, ActivationPlacement.placementOf(
            pending(estimatedDurationMs = null, remainingTickBudgetMs = 60_000)))
        assertEquals(Placement.INLINE, ActivationPlacement.placementOf(
            pending(remainingTickBudgetMs = null)))
    }

    @Test
    fun `the thresholds are configurable`() {
        val strict = ActivationPlacement.Thresholds(inlineFanoutThreshold = 1)
        assertEquals(Placement.DISPATCHED,
            ActivationPlacement.placementOf(pending(joinGroupSize = 2), strict))
        val loose = ActivationPlacement.Thresholds(inlineFanoutThreshold = 20)
        assertEquals(Placement.INLINE,
            ActivationPlacement.placementOf(pending(joinGroupSize = 10), loose))
    }
}

/**
 * Dispatched children against a real database — the transport, the caps and the
 * fair ordering.
 *
 * Skips when no database is reachable.
 */
class ChildRunDispatcherTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    private fun dataSourceOrNull(): DataSource? = try {
        val ds = PGSimpleDataSource().apply {
            setURL(jdbcUrl); connectTimeout = 2; socketTimeout = 15
        }
        ds.connection.use { c ->
            c.prepareStatement("SELECT parent_run_id FROM agent_runs LIMIT 1").use { it.executeQuery() }
            c.prepareStatement("SELECT child_vtime_penalty FROM workspace_usage_policies LIMIT 1")
                .use { it.executeQuery() }
        }
        ds
    } catch (_: Exception) {
        null
    }

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
    )

    private fun seed(ds: DataSource): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "child-test")
                it.setString(3, "child-test-" + w.workspaceId); it.executeUpdate()
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
        }
        return w
    }

    private fun policy(ds: DataSource, w: World, perRun: Int, perWorkspace: Int, penalty: Double) {
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO workspace_usage_policies (workspace_id, max_activations_per_run," +
                " max_activations_per_workspace, child_vtime_penalty) VALUES (?,?,?,?) " +
                "ON CONFLICT (workspace_id) DO UPDATE SET " +
                " max_activations_per_run=EXCLUDED.max_activations_per_run," +
                " max_activations_per_workspace=EXCLUDED.max_activations_per_workspace," +
                " child_vtime_penalty=EXCLUDED.child_vtime_penalty"
            ).use {
                it.setObject(1, w.workspaceId); it.setInt(2, perRun)
                it.setInt(3, perWorkspace); it.setDouble(4, penalty); it.executeUpdate()
            }
        }
    }

    private fun run(
        ds: DataSource, w: World, status: String = "running",
        fairVtime: Double = 1000.0, parentRunId: UUID? = null,
    ): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id," +
                " workflow_version_id,status,fair_vtime,parent_run_id) VALUES (?,?,?,?,?,?,?,?)"
            ).use {
                it.setObject(1, id); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId)
                it.setString(6, status); it.setDouble(7, fairVtime); it.setObject(8, parentRunId)
                it.executeUpdate()
            }
        }
        return id
    }

    private fun cleanup(ds: DataSource, w: World) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                    .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
            }
        }
    }

    private class Sink(val failWith: String? = null) : (WorkflowRunJob) -> Unit {
        val jobs = mutableListOf<WorkflowRunJob>()
        override fun invoke(job: WorkflowRunJob) {
            jobs += job
            failWith?.let { throw IllegalStateException(it) }
        }
    }

    private fun childRow(ds: DataSource, id: UUID): Triple<String, Double, UUID?> =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT execution_class, fair_vtime, parent_activation_id FROM agent_runs WHERE id=?"
            ).use { st ->
                st.setObject(1, id)
                st.executeQuery().use { rs ->
                    rs.next()
                    Triple(rs.getString(1), rs.getDouble(2), rs.getObject(3, UUID::class.java))
                }
            }
        }

    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a dispatched child gets its own run on the child lane`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            val parent = run(ds, w)
            val activation = UUID.randomUUID()
            val sink = Sink()
            val d = ChildRunDispatcher(ds, sink)

            val r = assertIs<ChildRunDispatcher.Result.Dispatched>(d.dispatch(
                parentRunId = parent, workspaceId = w.workspaceId, environmentId = w.environmentId,
                workflowId = w.workflowId, workflowVersionId = w.versionId,
                activationId = activation, depth = 1, inputJson = "{}"))

            val (cls, _, parentActivation) = childRow(ds, r.childRunId)
            assertEquals("agent.child", cls,
                "a child on the plain agent lane queues behind the backlog the lane split exists to avoid")
            /* The ACTIVATION is not duplicated: a dispatched child is the same
               activation an inline child would have been, on another transport. */
            assertEquals(activation, parentActivation)
            assertEquals(WorkflowRunJob.JobType.START_RUN, sink.jobs.single().jobType)
            assertEquals(r.childRunId, sink.jobs.single().runId)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a child inherits its parent's vtime plus a depth penalty`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            policy(ds, w, perRun = 20, perWorkspace = 50, penalty = 5.0)
            val parent = run(ds, w, fairVtime = 1000.0)
            val d = ChildRunDispatcher(ds, Sink())

            fun dispatchAt(depth: Int): Double {
                val r = assertIs<ChildRunDispatcher.Result.Dispatched>(d.dispatch(
                    parent, w.workspaceId, w.environmentId, w.workflowId, w.versionId,
                    UUID.randomUUID(), depth, "{}"))
                return childRow(ds, r.childRunId).second
            }

            /*
             * ── THE ARBITRAGE THIS CLOSES ────────────────────────────────────
             * A parent is at the HEAD of its tenant's queue — that is why it is
             * running. A child inheriting that vtime unmodified would enter at the
             * head too, so a 20-wide fan-out would place 20 runs ahead of the
             * tenant's other queued work and defeat weighted-fair ordering from
             * inside, using the tenant it is meant to bound.
             */
            assertEquals(1005.0, dispatchAt(1), 0.001)
            /* Multiplied by depth, not added once: nesting must sink as fast as
               fanning out, or the arbitrage just moves. */
            assertEquals(1010.0, dispatchAt(2), 0.001)
            assertEquals(1015.0, dispatchAt(3), 0.001)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a wide fan-out is capped per run and falls back to inline`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            policy(ds, w, perRun = 3, perWorkspace = 50, penalty = 1.0)
            val parent = run(ds, w)
            val d = ChildRunDispatcher(ds, Sink())

            val results = (1..20).map {
                d.dispatch(parent, w.workspaceId, w.environmentId, w.workflowId, w.versionId,
                    UUID.randomUUID(), 1, "{}")
            }

            /*
             * ── A 20-CHILD FAN-OUT DOES NOT SEIZE THE LANE ───────────────────
             * Three dispatch; the rest are CAPPED, and a cap is not a failure —
             * the caller runs those inline instead. The tenant's other queued work
             * therefore sees three child runs ahead of it, not twenty.
             */
            assertEquals(3, results.count { it is ChildRunDispatcher.Result.Dispatched })
            assertEquals(17, results.count { it is ChildRunDispatcher.Result.Capped })
            assertTrue(results.none { it is ChildRunDispatcher.Result.Failed })

            val capped = results.first { it is ChildRunDispatcher.Result.Capped }
                    as ChildRunDispatcher.Result.Capped
            assertTrue(capped.reason.contains("children in flight"), capped.reason)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `the workspace cap stops ten teams doing what one team may not`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            policy(ds, w, perRun = 10, perWorkspace = 4, penalty = 1.0)
            val d = ChildRunDispatcher(ds, Sink())

            /* Three separate parents, each well under the per-run cap. */
            val dispatched = (1..3).flatMap {
                val parent = run(ds, w)
                (1..3).map {
                    d.dispatch(parent, w.workspaceId, w.environmentId, w.workflowId, w.versionId,
                        UUID.randomUUID(), 1, "{}")
                }
            }
            assertEquals(4, dispatched.count { it is ChildRunDispatcher.Result.Dispatched })
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Waking the parent
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `the parent is resumed exactly once, after the last child terminates`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            val parent = run(ds, w, status = "waiting_for_child")
            val children = (1..5).map { run(ds, w, status = "running", parentRunId = parent) }
            val sink = Sink()
            val d = ChildRunDispatcher(ds, sink)

            /* Four of five finish. The parent must not be woken: it would resume
               into a fan-out that is still running. */
            children.take(4).forEach { child ->
                ds.connection.use { c ->
                    c.prepareStatement("UPDATE agent_runs SET status='succeeded' WHERE id=?")
                        .use { it.setObject(1, child); it.executeUpdate() }
                }
                assertNull(d.onChildTerminal(child), "the parent was woken early")
            }
            assertTrue(sink.jobs.isEmpty())

            // The fifth.
            ds.connection.use { c ->
                c.prepareStatement("UPDATE agent_runs SET status='failed' WHERE id=?")
                    .use { it.setObject(1, children[4]); it.executeUpdate() }
            }
            assertEquals(parent, d.onChildTerminal(children[4]))

            /* EXACTLY ONCE. Five children, one resume — the check and the decision
               are one statement, so two finishing concurrently cannot both believe
               they were last. */
            assertEquals(1, sink.jobs.size)
            assertEquals(parent, sink.jobs.single().runId)
            assertEquals(WorkflowRunJob.JobType.RESUME_RUN, sink.jobs.single().jobType)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a dropped parent resume leaves exactly what the reconciler looks for`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            val parent = run(ds, w, status = "waiting_for_child")
            val child = run(ds, w, status = "succeeded", parentRunId = parent)

            /*
             * ── THE MESSAGE IS DROPPED, NOT SIMULATED ───────────────────────
             * The enqueue throws, so nothing reaches the queue — which is the real
             * failure the P0 finding describes, not a stand-in for it.
             */
            val failing = Sink(failWith = "redis is down")
            val d = ChildRunDispatcher(ds, failing)
            assertNull(d.onChildTerminal(child), "a failed enqueue must not report success")

            /* The parent is parked with every child terminal — precisely the
               `children_terminal` arm's predicate. */
            ds.connection.use { c ->
                c.prepareStatement("UPDATE agent_runs SET updated_at = now() - interval '60 seconds' " +
                    "WHERE id=?").use { it.setObject(1, parent); it.executeUpdate() }
            }

            val rescued = Sink()
            com.vectorbea.worker.durable.ResumeReconciler(
                dataSource = ds, enqueue = rescued,
                pollIntervalMs = 30_000, minParkedMs = 20_000, batchSize = 25, maxAttempts = 6,
            ).tick()

            val mine = rescued.jobs.filter { it.workspaceId == w.workspaceId }
            assertEquals(1, mine.size, "the reconciler did not recover the dropped resume")
            assertEquals(parent, mine.single().runId)
            assertTrue(mine.single().triggeredBy.contains("children_terminal"))
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a run with no parent wakes nothing`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            val sink = Sink()
            assertNull(ChildRunDispatcher(ds, sink).onChildTerminal(run(ds, w, status = "succeeded")))
            assertTrue(sink.jobs.isEmpty())
        } finally { cleanup(ds!!, w) }
    }
}
