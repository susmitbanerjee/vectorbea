package com.vectorbea.worker.durable.wait

import com.vectorbea.worker.queue.WorkflowRunJob
import org.junit.jupiter.api.Tag
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The wait primitive, against a real database.
 *
 * ── WHY EVERY CASE USES A REAL ROW ──────────────────────────────────────────
 * Every property that matters here IS a database property. "A duplicated
 * callback resolves the wait exactly once" is a compare-and-set on
 * `status = 'waiting'`; "a re-executed step finds its own wait" is a unique
 * constraint on `(run_id, wait_key)`. A test that mocked the store would be
 * asserting that the code I wrote matches the code I wrote, and would pass just
 * as happily if the constraint were missing.
 *
 * The resume enqueue is a lambda, so "the message was dropped" is expressed by
 * not calling it — which is the actual failure rather than a simulation of it.
 */
@Tag("integration")
class WaitPrimitiveTest {

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
                it.setObject(1, w.workspaceId); it.setString(2, "wait-test")
                it.setString(3, "wait-test-" + w.workspaceId); it.executeUpdate()
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

    private fun run(w: World, status: String, parkedSecondsAgo: Long = 60): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id," +
                    " workflow_version_id,status,updated_at) " +
                    "VALUES (?,?,?,?,?,?, now() - make_interval(secs => ?))"
            ).use {
                it.setObject(1, id); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId)
                it.setString(6, status); it.setDouble(7, parkedSecondsAgo.toDouble())
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

    private fun openRequest(
        w: World, runId: UUID, nodeId: String = "n-1", attemptGroup: Int = 0,
        kind: WaitKind = WaitKind.ASYNC_TOOL, signalName: String? = null,
        timeoutMs: Long? = null, withCallback: Boolean = false,
    ) = WaitStore.OpenRequest(
        workspaceId = w.workspaceId, environmentId = w.environmentId,
        runId = runId, workflowId = w.workflowId, nodeId = nodeId,
        attemptGroup = attemptGroup, kind = kind, label = "a six-minute render",
        signalName = signalName, timeoutMs = timeoutMs, withCallback = withCallback,
    )

    // ─────────────────────────────────────────────────────────────────────────
    // The durable key: one wait per (run, node, attempt group)
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a re-executed step finds its own wait instead of opening a second`() {
        val w = seed()
        try {
            val store = WaitStore(ds)
            val runId = run(w, "running")

            val first = store.open(openRequest(w, runId))
            /* The resume: same run, same node, same attempt group. A step
               re-executes from iteration 1, so this is the ordinary path. */
            val second = store.open(openRequest(w, runId))

            assertEquals(first.wait.id, second.wait.id,
                "a resumed step opened a SECOND wait. It would park forever: the " +
                    "provider's callback carries the first wait's token.")
            assertEquals(1, countWaits(runId))
        } finally { cleanup(w) }
    }

    @Test
    fun `a deliberate re-run gets a new wait, because attempt group changed`() {
        val w = seed()
        try {
            val store = WaitStore(ds)
            val runId = run(w, "running")

            val first = store.open(openRequest(w, runId, attemptGroup = 0))
            val rerun = store.open(openRequest(w, runId, attemptGroup = 1))

            assertTrue(first.wait.id != rerun.wait.id,
                "a re-run must wait again — that is what asking for a re-run means")
            assertEquals(2, countWaits(runId))
        } finally { cleanup(w) }
    }

    @Test
    fun `the key contains no iteration, timestamp or random component`() {
        val runId = UUID.randomUUID()
        val a = RunWait.keyFor(runId, "node-1", 0)
        Thread.sleep(5)
        val b = RunWait.keyFor(runId, "node-1", 0)
        assertEquals(a, b,
            "the key changed between two computations, so a resumed step would open " +
                "a second wait — invariant 2")
        assertTrue(a != RunWait.keyFor(runId, "node-2", 0))
        assertTrue(a != RunWait.keyFor(runId, "node-1", 1))
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: a duplicated completion callback resolves the wait exactly once
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a duplicated completion resolves exactly once`() {
        val w = seed()
        try {
            val store = WaitStore(ds)
            val runId = run(w, "waiting_for_event")
            val wait = store.open(openRequest(w, runId, withCallback = true)).wait

            val first = store.resolve(wait.id, RunWait.Resolution.COMPLETED,
                """{"url":"https://cdn/render.mp4"}""", "callback")
            val second = store.resolve(wait.id, RunWait.Resolution.COMPLETED,
                """{"url":"https://cdn/render.mp4"}""", "callback")

            assertTrue(first, "the first delivery must win")
            assertFalse(second,
                "the second delivery resolved the wait again. Every caller treats a " +
                    "true here as 'enqueue a resume', so this is a run resumed twice " +
                    "from one webhook retry.")

            val reloaded = assertNotNull(store.findById(wait.id, w.workspaceId))
            assertEquals(RunWait.Status.RESOLVED, reloaded.status)
            assertEquals(RunWait.Resolution.COMPLETED, reloaded.resolution)
        } finally { cleanup(w) }
    }

    @Test
    fun `a poll racing a callback resolves once, and the loser is a no-op`() {
        val w = seed()
        try {
            val store = WaitStore(ds)
            val runId = run(w, "waiting_for_event")
            val wait = store.open(openRequest(w, runId)).wait

            val byPoll = store.resolve(wait.id, RunWait.Resolution.COMPLETED, "{}", "poll")
            val byCallback = store.resolve(wait.id, RunWait.Resolution.COMPLETED, "{}", "callback")

            assertEquals(1, listOf(byPoll, byCallback).count { it },
                "exactly one of a racing poll and callback may win")
            assertEquals("poll", store.findById(wait.id, w.workspaceId)?.resolvedBy)
        } finally { cleanup(w) }
    }

    @Test
    fun `a callback token is derived, so a re-executed step recomputes the same URL`() {
        val secret = "a-test-callback-secret".toByteArray()
        val key = RunWait.keyFor(UUID.randomUUID(), "n-1", 0)

        val first = RunWait.callbackTokenFor(key, secret)
        val second = RunWait.callbackTokenFor(key, secret)

        assertNotNull(first)
        assertEquals(first, second,
            "a random token cannot be recomputed on resume, so the provider's callback " +
                "would arrive at a token nothing recognises")
        assertTrue(first.startsWith("cb_"))
        assertTrue(
            RunWait.callbackTokenFor(key, "a-different-secret".toByteArray()) != first,
            "the token must depend on the server key, or it is guessable")
        assertNull(RunWait.callbackTokenFor(key, null),
            "with no secret there must be NO token — publishing a guessable callback " +
                "URL is worse than refusing the call")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: a callback that never arrives times out with a legible reason
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a wait that nobody answers times out, and says why`() {
        val w = seed()
        try {
            val store = WaitStore(ds)
            val enqueued = ConcurrentLinkedQueue<WorkflowRunJob>()
            val sweeper = WaitSweeper(ds, store, enqueue = { enqueued += it })

            val runId = run(w, "waiting_for_event")
            val wait = store.open(openRequest(w, runId, withCallback = true)).wait
            expire(wait.id)

            /*
             * `tick()` returns how many waits the WHOLE sweep handled, and the
             * suite shares one database — so asserting on that number couples this
             * test to whatever else has run. The claim is about THIS wait, and it
             * is made below against the row.
             */
            sweeper.tick()

            val reloaded = assertNotNull(store.findById(wait.id, w.workspaceId))
            assertEquals(RunWait.Status.TIMED_OUT, reloaded.status)
            assertEquals(RunWait.Resolution.TIMEOUT, reloaded.resolution)

            val reason = assertNotNull(reloaded.resolutionJson)
            assertContains(reason, "callback",
                message = "the reason must name what was expected and did not arrive; " +
                    "'the run timed out' is not actionable. Got: $reason")

            assertTrue(
                enqueued.any { it.runId == runId },
                "a timed-out run must be RESUMED so the node can fail with the reason — " +
                    "leaving it parked is the permanently-parked run this prevents")
        } finally { cleanup(w) }
    }

    @Test
    fun `a wait cannot be created without a deadline`() {
        val w = seed()
        try {
            val store = WaitStore(ds)
            val runId = run(w, "running")

            val noTimeout = store.open(openRequest(w, runId, nodeId = "a", timeoutMs = null)).wait
            assertNotNull(noTimeout.timeoutAt,
                "a wait with no deadline is a run parked forever — the failure the " +
                    "timeout exists to prevent")

            val absurd = store.open(
                openRequest(w, runId, nodeId = "b", timeoutMs = 365L * 24 * 3600 * 1000)
            ).wait
            val deadline = assertNotNull(absurd.timeoutAt)
            assertTrue(
                deadline.isBefore(java.time.Instant.now().plusMillis(WaitStore.MAX_WAIT_MS + 60_000)),
                "an unbounded wait must be CLAMPED, not accepted. A clamp cannot be " +
                    "forgotten by the next caller; a validation can.")
        } finally { cleanup(w) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: signals — parked, running, terminal
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a signal to a parked run resolves its wait`() {
        val w = seed()
        try {
            val waits = WaitStore(ds)
            val signals = SignalStore(ds)
            val runId = run(w, "waiting_for_event")
            val wait = waits.open(
                openRequest(w, runId, kind = WaitKind.AGENT_WAIT, signalName = "sre_replied")
            ).wait

            val sent = signals.send(runId, w.workspaceId, w.environmentId, "sre_replied",
                """{"action":"roll back"}""", null, null, "api", null)
            assertTrue(sent is SignalStore.SendResult.Accepted)

            val matching = waits.waitsForSignal(runId, "sre_replied")
            assertEquals(listOf(wait.id), matching.map { it.id },
                "the wait was not found by its signal name, so nothing would wake the run")

            assertTrue(waits.resolve(matching.first().id, RunWait.Resolution.SIGNAL,
                """{"action":"roll back"}""", "signal:sre_replied"))
        } finally { cleanup(w) }
    }

    @Test
    fun `a signal to a running run is stored for its next step boundary`() {
        val w = seed()
        try {
            val signals = SignalStore(ds)
            val runId = run(w, "running")

            val sent = signals.send(runId, w.workspaceId, w.environmentId, "second_alert",
                """{"severity":"critical"}""", null, null, "api", null)
            assertTrue(sent is SignalStore.SendResult.Accepted)

            val pending = signals.pending(runId)
            assertEquals(1, pending.size,
                "a signal to a running run must survive until the run reaches a step " +
                    "boundary — there is no wait to resolve, so storing it is the delivery")
            assertEquals("second_alert", pending.first().name)
            assertNull(pending.first().consumedAt)
        } finally { cleanup(w) }
    }

    @Test
    fun `a signal to a terminal run is rejected, not stored`() {
        val w = seed()
        try {
            val signals = SignalStore(ds)
            for (status in listOf("succeeded", "failed", "cancelled", "cost_limit_exceeded")) {
                val runId = run(w, status)
                val result = signals.send(runId, w.workspaceId, w.environmentId, "late",
                    "{}", null, null, "api", null)

                assertTrue(result is SignalStore.SendResult.RunTerminal,
                    "a signal to a '$status' run was accepted. Nothing will ever read it, " +
                        "and the caller was told their alert reached something.")
                assertEquals(status, (result as SignalStore.SendResult.RunTerminal).status)
                assertEquals(0, signals.pending(runId).size)
            }
        } finally { cleanup(w) }
    }

    @Test
    fun `signals are ordered by a per-run sequence, not by time`() {
        val w = seed()
        try {
            val signals = SignalStore(ds)
            val runId = run(w, "running")
            repeat(5) { i ->
                signals.send(runId, w.workspaceId, w.environmentId, "alert",
                    """{"n":$i}""", null, null, "api", null)
            }
            val sequences = signals.pending(runId).map { it.sequence }
            assertEquals(listOf(1, 2, 3, 4, 5), sequences,
                "two alerts in the same millisecond must still have an order, and the " +
                    "same order on every read")
        } finally { cleanup(w) }
    }

    @Test
    fun `a retried delivery with the same dedupe key is one signal`() {
        val w = seed()
        try {
            val signals = SignalStore(ds)
            val runId = run(w, "running")

            val first = signals.send(runId, w.workspaceId, w.environmentId, "alert",
                "{}", null, null, "api", dedupeKey = "pagerduty-incident-42")
            val retry = signals.send(runId, w.workspaceId, w.environmentId, "alert",
                "{}", null, null, "api", dedupeKey = "pagerduty-incident-42")

            assertTrue(first is SignalStore.SendResult.Accepted)
            assertTrue(retry is SignalStore.SendResult.Duplicate,
                "an alerting system retrying on a timeout delivered one alert twice")
            assertEquals(1, signals.pending(runId).size)
        } finally { cleanup(w) }
    }

    @Test
    fun `a signal is consumed exactly once`() {
        val w = seed()
        try {
            val signals = SignalStore(ds)
            val runId = run(w, "running")
            signals.send(runId, w.workspaceId, w.environmentId, "alert",
                "{}", null, null, "api", null)

            val ids = signals.pending(runId).map { it.id }
            assertEquals(1, signals.consume(ids, null))
            assertEquals(0, signals.consume(ids, null),
                "a second delivery of the same signal — two parallel branches reading " +
                    "at the same boundary would each act on it")
            assertEquals(0, signals.pending(runId).size)
        } finally { cleanup(w) }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Terminal runs release their waits
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a run reaching a terminal state cancels every wait it held`() {
        val w = seed()
        try {
            val store = WaitStore(ds)
            val runId = run(w, "waiting_for_event")
            val a = store.open(openRequest(w, runId, nodeId = "a")).wait
            val b = store.open(openRequest(w, runId, nodeId = "b")).wait

            assertEquals(2, store.cancelAllForRun(runId, "the run reached cancelled"))

            listOf(a, b).forEach {
                val reloaded = assertNotNull(store.findById(it.id, w.workspaceId))
                assertEquals(RunWait.Status.CANCELLED, reloaded.status,
                    "a cancelled run left a live wait: the sweeper keeps polling the " +
                        "provider and the callback endpoint keeps accepting completions")
            }
            assertEquals(0, store.activeWaits(runId).size)
        } finally { cleanup(w) }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun countWaits(runId: UUID): Int = ds.connection.use { c ->
        c.prepareStatement("SELECT count(*) FROM run_waits WHERE run_id = ?").use {
            it.setObject(1, runId)
            it.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else 0 }
        }
    }

    /** Move a wait's deadline into the past, so the sweep sees it as expired. */
    private fun expire(waitId: UUID) = ds.connection.use { c ->
        c.prepareStatement(
            "UPDATE run_waits SET timeout_at = now() - interval '1 minute' WHERE id = ?"
        ).use { it.setObject(1, waitId); it.executeUpdate() }
    }
}
