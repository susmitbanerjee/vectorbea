package com.vectorbea.worker.durable

import com.vectorbea.worker.queue.WorkflowRunJob
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.postgresql.ds.PGSimpleDataSource
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The reconciler, against the four ways a run gets stranded.
 *
 * ── WHY EVERY CASE PARKS A REAL RUN ─────────────────────────────────────────
 * Each of the four bugs is "a durable state change followed by a best-effort
 * enqueue". The interesting thing is therefore a ROW: an approval marked
 * APPROVED beside a run still `waiting_for_approval`, a timer marked `fired`
 * beside a run still `waiting_for_timer`. A test that mocked the query would be
 * asserting that the SQL I wrote matches the SQL I wrote.
 *
 * The enqueue is a lambda, so "the message was dropped" is expressed by not
 * calling it — which is the actual failure, not a simulation of it.
 *
 * Skips when no database is reachable.
 */
class ResumeReconcilerTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    private fun dataSourceOrNull(): DataSource? = try {
        val ds = PGSimpleDataSource().apply {
            setURL(jdbcUrl); connectTimeout = 2; socketTimeout = 15
        }
        ds.connection.use { c ->
            c.prepareStatement("SELECT 1 FROM run_resume_attempts LIMIT 1").use { it.executeQuery() }
            c.prepareStatement("SELECT parent_run_id FROM agent_runs LIMIT 1").use { it.executeQuery() }
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
                it.setObject(1, w.workspaceId); it.setString(2, "recon-test")
                it.setString(3, "recon-test-" + w.workspaceId); it.executeUpdate()
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

    /** A run in [status], parked [parkedSecondsAgo] ago so the sweep can see it. */
    private fun run(
        ds: DataSource, w: World, status: String,
        parkedSecondsAgo: Long = 60,
        parentRunId: UUID? = null,
    ): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id," +
                " workflow_version_id,status,parent_run_id,updated_at) " +
                "VALUES (?,?,?,?,?,?,?, now() - make_interval(secs => ?))"
            ).use {
                it.setObject(1, id); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId)
                it.setString(6, status); it.setObject(7, parentRunId)
                it.setDouble(8, parkedSecondsAgo.toDouble())
                it.executeUpdate()
            }
        }
        return id
    }

    private fun approval(ds: DataSource, w: World, runId: UUID, status: String) {
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO run_approvals (run_id,workspace_id,environment_id,node_id,status) " +
                "VALUES (?,?,?,'n-1',?)"
            ).use {
                it.setObject(1, runId); it.setObject(2, w.workspaceId)
                it.setObject(3, w.environmentId); it.setString(4, status); it.executeUpdate()
            }
        }
    }

    private fun timer(ds: DataSource, w: World, runId: UUID, status: String) {
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO workflow_timers (id,workspace_id,environment_id,run_id,workflow_id," +
                " node_id,fire_at,status) VALUES (?,?,?,?,?,'n-1', now(), ?)"
            ).use {
                it.setObject(1, UUID.randomUUID()); it.setObject(2, w.workspaceId)
                it.setObject(3, w.environmentId); it.setObject(4, runId)
                it.setObject(5, w.workflowId); it.setString(6, status); it.executeUpdate()
            }
        }
    }

    private fun cleanup(ds: DataSource, w: World) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                    .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
            }
        }
    }

    /**
     * Collects what the reconciler tried to enqueue.
     *
     * -- WHY EVERY ASSERTION IS SCOPED TO ONE WORKSPACE ----------------------
     * The sweep is deliberately GLOBAL: it is the platform's backstop, so it
     * looks at every parked run there is. Against a shared test database that
     * means it also finds runs other test classes parked and left behind, which
     * is the reconciler working correctly and an absolute count being the wrong
     * assertion. Each case therefore asserts on its own workspace's jobs.
     */
    private class Sink(val failWith: String? = null) : (WorkflowRunJob) -> Unit {
        val jobs = mutableListOf<WorkflowRunJob>()
        override fun invoke(job: WorkflowRunJob) {
            jobs += job
            failWith?.let { throw IllegalStateException(it) }
        }
        fun of(w: World): List<WorkflowRunJob> = jobs.filter { it.workspaceId == w.workspaceId }
    }

    private fun reconciler(
        ds: DataSource, sink: Sink,
        maxAttempts: Int = 6,
        minParkedMs: Long = 20_000,
    ) = ResumeReconciler(
        dataSource = ds, enqueue = sink,
        pollIntervalMs = 30_000, minParkedMs = minParkedMs,
        batchSize = 25, maxAttempts = maxAttempts,
    )

    // ═════════════════════════════════════════════════════════════════════════
    // The four gaps
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a decided approval on a still-parked run is recovered`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            val runId = run(ds, w, "waiting_for_approval")
            approval(ds, w, runId, "APPROVED")

            /*
             * THE CONFIRMED P0 BUG. ApprovalRoutes stores the decision, enqueues
             * inside a runCatching that swallows, and returns 200 saying "Run will
             * resume shortly". Nothing else in the system looks at this run:
             * findStaleRuns scans ('running','yielded') only.
             */
            val sink = Sink()
            reconciler(ds, sink).tick()

            val job = sink.of(w).single()
            assertEquals(runId, job.runId)
            assertEquals(WorkflowRunJob.JobType.RESUME_RUN, job.jobType)
            assertTrue(job.triggeredBy.contains("approval_resolved"), job.triggeredBy)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a run still waiting on an undecided approval is left alone`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            approval(ds, w, run(ds, w, "waiting_for_approval"), "PENDING")
            /* The whole value of this sweep is that it touches ONLY runs whose
               reason to wait has demonstrably gone. Waking a run whose approver
               has not decided would resume it into the gate it is parked on. */
            val sink = Sink()
            reconciler(ds, sink).tick()
            assertTrue(sink.of(w).isEmpty(), sink.of(w).toString())
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a parent whose children are all terminal is recovered`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            val parent = run(ds, w, "waiting_for_child")
            run(ds, w, "succeeded", parentRunId = parent)
            run(ds, w, "failed", parentRunId = parent)
            run(ds, w, "cancelled", parentRunId = parent)

            val sink = Sink()
            reconciler(ds, sink).tick()
            assertEquals(parent, sink.of(w).single().runId)
            assertTrue(sink.of(w).single().triggeredBy.contains("children_terminal"))
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a parent with one live child is left alone`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            val parent = run(ds, w, "waiting_for_child")
            run(ds, w, "succeeded", parentRunId = parent)
            run(ds, w, "running", parentRunId = parent)
            val sink = Sink()
            reconciler(ds, sink).tick()
            assertTrue(sink.of(w).isEmpty(), sink.of(w).toString())
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a parent with no children at all is left alone`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            run(ds, w, "waiting_for_child")
            /* Waiting for children it has not created is a DIFFERENT bug, and one
               a resume does not fix — resuming would replay the step that was
               about to create them, which may be right, but it is not this
               sweep's call to make on evidence it does not have. */
            val sink = Sink()
            reconciler(ds, sink).tick()
            assertTrue(sink.of(w).isEmpty(), sink.of(w).toString())
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a run stranded in recovering is recovered`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            /*
             * P0's new finding: CrashRecoveryLoop sets status='recovering' and THEN
             * enqueues, with the whole body in a catch. A failed enqueue leaves the
             * run in a status findStaleRuns does not scan — so the recovery loop
             * permanently strands the run it was rescuing.
             */
            val runId = run(ds, w, "recovering")
            val sink = Sink()
            reconciler(ds, sink).tick()
            assertEquals(runId, sink.of(w).single().runId)
            assertTrue(sink.of(w).single().triggeredBy.contains("recovering_stranded"))
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a fired timer on a still-parked run is recovered`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            /* TimerScheduler marks the timer 'fired' BEFORE enqueueing, and
               findDueTimers requires 'scheduled' — so once marked, a failed
               enqueue is never retried by anything. */
            val runId = run(ds, w, "waiting_for_timer")
            timer(ds, w, runId, "fired")

            val sink = Sink()
            reconciler(ds, sink).tick()
            assertEquals(runId, sink.of(w).single().runId)
            assertTrue(sink.of(w).single().triggeredBy.contains("timer_fired"))
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a timer still scheduled leaves its run alone`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            timer(ds, w, run(ds, w, "waiting_for_timer"), "scheduled")
            val sink = Sink()
            reconciler(ds, sink).tick()
            assertTrue(sink.of(w).isEmpty(), sink.of(w).toString())
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // The grace window
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a freshly parked run is not swept`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            val runId = run(ds, w, "waiting_for_approval", parkedSecondsAgo = 0)
            approval(ds, w, runId, "APPROVED")
            /* The ordinary enqueue is in flight for a moment after the status
               change. Sweeping immediately would race every healthy resume and do
               the work twice for no reason. */
            val sink = Sink()
            reconciler(ds, sink).tick()
            assertTrue(sink.of(w).isEmpty(), sink.of(w).toString())
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Retry, dead-letter, idempotence
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `the retry is bounded and ends in a dead letter, and the run stays parked`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            val runId = run(ds, w, "waiting_for_approval")
            approval(ds, w, runId, "APPROVED")

            /* Redis is down, persistently. */
            val sink = Sink(failWith = "redis is down")
            val r = reconciler(ds, sink, maxAttempts = 3)

            repeat(5) { r.tick() }

            /* Three attempts, then it stops — and the count is DURABLE, because
               the reconciler runs on every worker and an in-heap counter would give
               a failing run N fresh attempts per worker. */
            assertEquals(3, sink.of(w).size, "the retry budget was not honoured")

            val row = attemptRow(ds, runId)
            assertNotNull(row, "no attempt row was written")
            assertNotNull(row.deadLetteredAt, "the run was never dead-lettered")
            assertTrue(row.lastError!!.contains("redis is down") ||
                       row.lastError.contains("attempts"), row.lastError)

            /*
             * ── THE RUN IS STILL PARKED, NOT FAILED ─────────────────────────
             * A run that could not be RESUMED has not necessarily failed. Marking
             * it failed would tell a user their work was lost when it is sitting
             * there, recoverable by hand.
             */
            assertEquals("waiting_for_approval", statusOf(ds, runId))

            /* And it is not swept again — the row stays and is what stops the
               cycle restarting on the next tick. */
            val after = sink.of(w).size
            r.tick()
            assertEquals(after, sink.of(w).size)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a recovered run stops being a candidate once it is no longer parked`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            val runId = run(ds, w, "waiting_for_approval")
            approval(ds, w, runId, "APPROVED")
            val sink = Sink()
            val r = reconciler(ds, sink)
            r.tick()
            assertEquals(1, sink.of(w).size)

            /* The processor picked it up and the status CAS moved it. */
            ds.connection.use { c ->
                c.prepareStatement("UPDATE agent_runs SET status='running' WHERE id=?")
                    .use { it.setObject(1, runId); it.executeUpdate() }
            }

            r.tick()
            assertEquals(1, sink.of(w).size, "a run no longer parked was swept again")
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `re-enqueueing a run that is already resuming is harmless`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            val runId = run(ds, w, "waiting_for_approval")
            approval(ds, w, runId, "APPROVED")
            val sink = Sink()
            val r = reconciler(ds, sink)

            /*
             * Duplicate resumes are the EXPECTED steady state, not an error: this
             * runs on every worker, and it deliberately races the real enqueue it
             * is backing up. What makes that safe is the processor's status CAS,
             * which refuses a resume for a run no longer in a resumable status —
             * so the reconciler needs no coordination and no lock of its own.
             */
            r.tick(); r.tick(); r.tick()
            assertEquals(3, sink.of(w).size)
            assertTrue(sink.of(w).all { it.runId == runId })
            assertEquals(3, attemptRow(ds, runId)!!.attempts)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `one sweep covers all four reasons together`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            val a = run(ds, w, "waiting_for_approval"); approval(ds, w, a, "REJECTED")
            val p = run(ds, w, "waiting_for_child"); run(ds, w, "succeeded", parentRunId = p)
            val c = run(ds, w, "recovering")
            val t = run(ds, w, "waiting_for_timer"); timer(ds, w, t, "fired")

            val sink = Sink()
            /* ONE sweep, not four. Four queries would let one noisy reason starve
               the others out of every batch, and four loops would drift. */
            reconciler(ds, sink).tick()
            assertEquals(setOf(a, p, c, t), sink.of(w).map { it.runId }.toSet())
        } finally { cleanup(ds!!, w) }
    }

    // ── Reads ────────────────────────────────────────────────────────────────

    private data class AttemptRow(
        val attempts: Int, val lastError: String?, val deadLetteredAt: java.sql.Timestamp?)

    private fun attemptRow(ds: DataSource, runId: UUID): AttemptRow? = ds.connection.use { c ->
        c.prepareStatement(
            "SELECT attempts, last_error, dead_lettered_at FROM run_resume_attempts WHERE run_id=?"
        ).use { st ->
            st.setObject(1, runId)
            st.executeQuery().use { rs ->
                if (!rs.next()) null
                else AttemptRow(rs.getInt(1), rs.getString(2), rs.getTimestamp(3))
            }
        }
    }

    private fun statusOf(ds: DataSource, runId: UUID): String? = ds.connection.use { c ->
        c.prepareStatement("SELECT status FROM agent_runs WHERE id=?").use { st ->
            st.setObject(1, runId)
            st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
        }
    }
}
