package com.vectorbea.api.ingress

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.queue.WorkflowRunJob
import com.vectorbea.api.repository.RunEventRepository
import com.vectorbea.api.repository.RunRepository
import com.vectorbea.api.repository.WorkflowRepository
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Tag
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Run singletons and run priority, against a real database.
 *
 * ── WHY THIS NEEDS POSTGRES AND NOT A STUB ──────────────────────────────────
 * The whole feature IS a database property. `agent_runs_dedup_live_unique` is
 * what makes "two alerts, one run" true — the lookup in the ingress is
 * advisory, and a test against a stubbed store would assert that the advisory
 * check I wrote matches the advisory check I wrote, and would pass identically
 * with the index missing. The case that matters is the one a stub cannot
 * produce: two alerts for one service arriving in the same millisecond, which
 * is what a flapping check does.
 */
@Tag("integration")
class RunSingletonAcceptanceTest {

    private val ds: DataSource get() = com.vectorbea.api.testsupport.Infra.postgres

    private lateinit var w: World
    private lateinit var queue: CapturingQueue
    private lateinit var joins: RecordingJoins

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
    )

    private class CapturingQueue : WorkflowQueue {
        val enqueued = ConcurrentLinkedQueue<WorkflowRunJob>()
        override fun enqueue(job: WorkflowRunJob): String { enqueued += job; return "1-0" }
    }

    /** Stands in for `SignalDelivery`, which lives on the other side of the wiring. */
    private class RecordingJoins(@Volatile var accept: Boolean = true) : RunIngress.JoinSignalSender {
        val sent = ConcurrentLinkedQueue<Triple<UUID, String, String>>()
        override fun send(
            runId: UUID, workspaceId: UUID, environmentId: UUID,
            name: String, payloadJson: String, dedupeKey: String?,
        ): Boolean {
            sent += Triple(runId, name, payloadJson)
            return accept
        }
    }

    @BeforeEach
    fun setUp() {
        w = seed()
        queue = CapturingQueue()
        joins = RecordingJoins()
    }

    private fun ingress() = RunIngress(
        runRepo = RunRepository(ds),
        eventRepo = RunEventRepository(ds),
        workflowRepo = WorkflowRepository(ds),
        queue = queue,
        dataSource = ds,
        idempotency = IdempotencyStore(ds),
        dedup = RunDedup(ds),
        joinSignal = joins,
    )

    private fun seed(): World {
        val world = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, world.workspaceId); it.setString(2, "dedup")
                it.setString(3, "dedup-" + world.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) " +
                    "VALUES (?,?,'t','t','development')"
            ).use {
                it.setObject(1, world.environmentId); it.setObject(2, world.workspaceId)
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                    "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, world.workflowId); it.setObject(2, world.workspaceId)
                it.setObject(3, world.environmentId); it.setString(4, "wf-" + world.workflowId)
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) " +
                    "VALUES (?,?,1,'{}')"
            ).use {
                it.setObject(1, world.versionId); it.setObject(2, world.workflowId)
                it.executeUpdate()
            }
            c.prepareStatement("UPDATE workflows SET current_version_id = ? WHERE id = ?").use {
                it.setObject(1, world.versionId); it.setObject(2, world.workflowId)
                it.executeUpdate()
            }
        }
        return world
    }

    private fun policy(p: String) = ds.connection.use { c ->
        c.prepareStatement("UPDATE workflows SET dedup_policy = ? WHERE id = ?").use {
            it.setString(1, p); it.setObject(2, w.workflowId); it.executeUpdate()
        }
    }

    private fun defaultPriority(p: Int) = ds.connection.use { c ->
        c.prepareStatement("UPDATE workflows SET default_priority = ? WHERE id = ?").use {
            it.setShort(1, p.toShort()); it.setObject(2, w.workflowId); it.executeUpdate()
        }
    }

    private fun alert(
        key: String? = "checkout-api",
        priority: Short? = null,
        idempotencyKey: String? = null,
        input: String = """{"alert":1}""",
    ) = RunIngress.Request(
        workspaceId = w.workspaceId,
        workflowId = w.workflowId,
        environmentId = w.environmentId,
        inputJson = input,
        source = TriggerSource.WEBHOOK,
        actor = TriggerActor(),
        idempotencyKey = idempotencyKey,
        dedupKey = key,
        priority = priority,
    )

    private fun statusOf(runId: UUID): String = ds.connection.use { c ->
        c.prepareStatement("SELECT status FROM agent_runs WHERE id = ?").use {
            it.setObject(1, runId)
            it.executeQuery().use { rs -> rs.next(); rs.getString(1) }
        }
    }

    private fun liveRunsFor(key: String): Int = ds.connection.use { c ->
        c.prepareStatement(
            "SELECT count(*) FROM agent_runs WHERE workflow_id = ? AND dedup_key = ? " +
                "AND status IN (" + RunDedup.LIVE_STATUSES.joinToString(",") { "'$it'" } + ")"
        ).use {
            it.setObject(1, w.workflowId); it.setString(2, key)
            it.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: two alerts with the same dedup key produce one run
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a second alert for a service being worked is refused, and names the run`() {
        policy("reject")
        val first = ingress().start(alert())

        val e = kotlin.runCatching { ingress().start(alert()) }.exceptionOrNull()
        assertTrue(e is ApiError.Conflict, "expected a 409, got: $e")
        assertTrue(e.message!!.contains(first.runId.toString()),
            message = "the refusal must name the run already working the key, so the caller " +
                "can go and look at it. Got: ${e.message}")

        assertEquals(1, liveRunsFor("checkout-api"),
            "one alert, one run — the whole point of the feature")
    }

    @Test
    fun `a second alert joins the live run as a signal when the workflow says join`() {
        policy("join")
        val first = ingress().start(alert())

        val second = ingress().start(alert(input = """{"alert":2}"""))

        assertEquals(first.runId, second.runId,
            "the caller is told which run is working their alert, and it is the live one")
        assertTrue(second.joinedExisting, "and told that no second run was started")
        assertFalse(second.idempotentHit,
            "which is a DIFFERENT thing from 'you already asked for this'")

        val (target, name, payload) = joins.sent.single()
        assertEquals(first.runId, target)
        assertEquals("dedup_join", name, "the workflow's configured join signal")
        assertTrue(payload.contains("\"alert\":2"), "the second alert's own input travels with it")

        assertEquals(1, liveRunsFor("checkout-api"))
    }

    @Test
    fun `a join that the live run refuses falls through and starts a fresh run`() {
        policy("join")
        val first = ingress().start(alert())
        /* The holder finished between the lookup and the send. The key is free
           now, and the alert still needs working — so a new run is correct. */
        joins.accept = false
        finish(first.runId)

        val second = ingress().start(alert())

        assertNotEquals(first.runId, second.runId)
        assertFalse(second.joinedExisting)
    }

    @Test
    fun `supersede cancels the run holding the key and starts a replacement`() {
        policy("supersede")
        val first = ingress().start(alert(key = "deploy-abc123"))

        val second = ingress().start(alert(key = "deploy-abc123"))

        assertNotEquals(first.runId, second.runId, "only the latest deploy matters")
        assertEquals("cancellation_requested", statusOf(first.runId),
            "the holder is asked to cancel through the normal path, so its own terminal " +
                "transition settles its budget, closes its waits and cancels its children")
        assertEquals("queued", statusOf(second.runId))

        /*
         * And the key is free the moment the holder is asked to cancel, not when
         * it finishes. If `cancellation_requested` were a live status, this
         * insert would have lost the race to the run it had just cancelled —
         * every time.
         */
        assertEquals(1, liveRunsFor("deploy-abc123"))
    }

    @Test
    fun `a run that finishes frees its key for the next alert`() {
        policy("reject")
        val first = ingress().start(alert())
        finish(first.runId)

        val second = ingress().start(alert())

        assertNotEquals(first.runId, second.runId,
            "an incident that closed does not stop the next one being opened — which is " +
                "exactly what makes this different from an idempotency key, whose window " +
                "is a clock rather than a run")
    }

    @Test
    fun `two alerts arriving in the same instant still produce one run`() {
        /*
         * ── THE CASE THE ADVISORY LOOKUP CANNOT CATCH ───────────────────────
         * A flapping check produces exactly this, and a read-then-write loses
         * here and nowhere else. The index is what makes the outcome right, so
         * this is the test that fails if it is ever dropped.
         */
        policy("reject")
        val threads = 8
        val start = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(threads)
        val started = ConcurrentLinkedQueue<UUID>()
        val refused = ConcurrentLinkedQueue<Throwable>()

        repeat(threads) {
            pool.submit {
                start.await()
                runCatching { ingress().start(alert(key = "flapping-check")) }
                    .onSuccess { started += it.runId }
                    .onFailure { refused += it }
            }
        }
        start.countDown()
        pool.shutdown()
        assertTrue(pool.awaitTermination(60, TimeUnit.SECONDS), "the burst did not settle")

        assertEquals(1, started.size,
            "exactly one of $threads simultaneous alerts started a run; the rest were " +
                "refused. Started: ${started.toList()}")
        assertEquals(threads - 1, refused.size)
        refused.forEach {
            assertTrue(it is ApiError.Conflict,
                "a lost race is a 409, not a 500 with a constraint name in it. Got: $it")
        }
        assertEquals(1, liveRunsFor("flapping-check"))
    }

    @Test
    fun `a run without a dedup key is never deduplicated`() {
        policy("reject")
        val a = ingress().start(alert(key = null))
        val b = ingress().start(alert(key = null))
        assertNotEquals(a.runId, b.runId,
            "the partial index is over `dedup_key IS NOT NULL`, so nothing about ordinary " +
                "runs changes")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: a Sev1 preempts queued batch work
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a Sev1 is claimed before batch work the same workspace queued first`() {
        defaultPriority(0)

        /* Ten batch runs first, so the workspace's virtual clock is already well
           into the future when the incident arrives. */
        val batch = (1..10).map { ingress().start(alert(key = "batch-$it")).runId }
        val sev1 = ingress().start(alert(key = "sev1", priority = 100)).runId

        val order = claimOrder()
        val sev1Position = order.indexOf(sev1)
        assertTrue(sev1Position == 0,
            "the Sev1 arrived last and must be claimed first. Order: $order")

        /*
         * And the batch work is not starved — it is all still there, behind it,
         * in its original order. A strict priority lane would be indistinguishable
         * from this on one run; it differs under a stream of them, which is what
         * `run_priority_weight` exists for.
         */
        assertEquals(batch.toSet(), order.drop(1).toSet())
    }

    @Test
    fun `priority is clamped to what the workspace may ask for`() {
        defaultPriority(0)
        val run = ingress().start(alert(key = "self-granted", priority = 100)).runId

        val priority = ds.connection.use { c ->
            c.prepareStatement("SELECT priority FROM agent_runs WHERE id = ?").use {
                it.setObject(1, run)
                it.executeQuery().use { rs -> rs.next(); rs.getShort(1) }
            }
        }
        assertEquals(RunIngress.DEFAULT_PRIORITY_CEILING, priority,
            "a workspace without the priority-lane entitlement tops out below it. Otherwise " +
                "`priority` is a field any caller sets to 100 a minute after reading the " +
                "API docs, and it orders nothing")
    }

    @Test
    fun `a workflow's declared priority applies without the trigger asking`() {
        defaultPriority(60)
        val run = ingress().start(alert(key = "declared")).runId
        assertEquals(60.toShort(), priorityOf(run))
    }

    @Test
    fun `a trigger may raise one run above the workflow's default`() {
        defaultPriority(40)
        val ordinary = ingress().start(alert(key = "ordinary")).runId
        val sev1 = ingress().start(alert(key = "sev1", priority = 90)).runId

        assertEquals(40.toShort(), priorityOf(ordinary))
        assertEquals(90.toShort(), priorityOf(sev1))
    }

    @Test
    fun `a high priority run advances its workspace clock by less than a batch run`() {
        /*
         * ── THIS IS THE HALF THAT PREVENTS STARVATION ───────────────────────
         * `priority DESC` alone is a strict lane: a steady trickle of Sev1s would
         * stop batch work entirely. The weight makes priority a DISCOUNT on the
         * fair-queue clock instead, so an incident jumps the queue repeatedly and
         * cheaply while the work behind it still eventually has the lowest vtime.
         */
        defaultPriority(0)
        val before = vclock()
        ingress().start(alert(key = "batch-cost"))
        val afterBatch = vclock() - before

        val mid = vclock()
        ingress().start(alert(key = "sev1-cost", priority = 100))
        val afterSev1 = vclock() - mid

        assertTrue(afterSev1 < afterBatch,
            "a priority run must cost the workspace clock less than a batch one. " +
                "batch=$afterBatch sev1=$afterSev1")
        /* 8x at priority 100, per `run_priority_weight`. Compared loosely because
           the clamp to `now` moves the baseline between the two reads. */
        assertTrue(afterSev1 < afterBatch / 2,
            "and materially less, not marginally. batch=$afterBatch sev1=$afterSev1")
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun priorityOf(runId: UUID): Short = ds.connection.use { c ->
        c.prepareStatement("SELECT priority FROM agent_runs WHERE id = ?").use {
            it.setObject(1, runId)
            it.executeQuery().use { rs -> rs.next(); rs.getShort(1) }
        }
    }

    private fun vclock(): Double = ds.connection.use { c ->
        c.prepareStatement("SELECT vclock FROM workspaces WHERE id = ?").use {
            it.setObject(1, w.workspaceId)
            it.executeQuery().use { rs -> rs.next(); rs.getDouble(1) }
        }
    }

    /** The order the claim would take these runs in. Mirrors `PostgresClaim`. */
    private fun claimOrder(): List<UUID> = ds.connection.use { c ->
        c.prepareStatement(
            "SELECT id FROM agent_runs WHERE workspace_id = ? AND status = 'queued' " +
                "ORDER BY priority DESC, fair_vtime"
        ).use {
            it.setObject(1, w.workspaceId)
            it.executeQuery().use { rs ->
                buildList { while (rs.next()) add(rs.getObject(1, UUID::class.java)) }
            }
        }
    }

    private fun finish(runId: UUID) = ds.connection.use { c ->
        c.prepareStatement(
            "UPDATE agent_runs SET status = 'succeeded', completed_at = now() WHERE id = ?"
        ).use { it.setObject(1, runId); it.executeUpdate() }
    }
}
