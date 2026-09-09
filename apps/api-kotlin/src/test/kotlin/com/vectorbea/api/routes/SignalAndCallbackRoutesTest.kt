package com.vectorbea.api.routes

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Router
import com.vectorbea.api.rate.RateLimitResult
import com.vectorbea.api.rate.RateLimiter
import com.vectorbea.worker.durable.wait.RunWait
import com.vectorbea.worker.durable.wait.SignalStore
import com.vectorbea.worker.durable.wait.WaitKind
import com.vectorbea.worker.durable.wait.WaitStore
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Tag
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ConcurrentLinkedQueue
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The two HTTP surfaces of the wait primitive.
 *
 * ── WHAT THIS COVERS THAT `WaitPrimitiveTest` DOES NOT ──────────────────────
 * The worker's suite proves the STORE: a duplicated completion resolves once, a
 * signal to a terminal run is refused, a wait with no answer times out. It says
 * nothing about the routes in front of it, and the routes carry requirements of
 * their own that only exist at the HTTP boundary:
 *
 *   · a duplicate callback answers 200, not 4xx — a well-behaved provider
 *     retries a 4xx, so getting this wrong turns "we already have it" into a
 *     redelivery loop and eventually somebody's pager
 *   · an unrecognised status is progress, not completion — resuming a run on a
 *     `"processing"` ping projects a partial result AS A SUCCESS
 *   · the signal rate limit is per RUN as well as per workspace, because the
 *     run being flooded belongs to the flooder's own tenant
 *   · a run in another workspace does not exist to the caller (invariant 8)
 *
 * The callback endpoint is UNAUTHENTICATED, which is why several of these are
 * about what it refuses to tell an unauthenticated caller.
 */
@Tag("integration")
class SignalAndCallbackRoutesTest {

    private val mapper = ObjectMapper()
    private val ds: DataSource get() = com.vectorbea.api.testsupport.Infra.postgres

    private lateinit var router: Router
    private lateinit var waits: WaitStore
    private lateinit var signals: SignalStore
    private lateinit var limiter: CountingLimiter
    private lateinit var queue: CapturingQueue

    private lateinit var w: World

    @BeforeEach
    fun setUp() {
        waits = WaitStore(ds)
        signals = SignalStore(ds)
        limiter = CountingLimiter()
        queue = CapturingQueue()
        router = Router()
        SignalRoutes(ds, signals, waits, queue, limiter).register(router)
        ToolCallbackRoutes(ds, waits, queue, limiter).register(router)
        w = seed()
    }

    // ── Signals ──────────────────────────────────────────────────────────────

    @Test
    fun `a signal to a parked run is accepted and the run is resumed`() {
        val runId = run("waiting_for_event")
        openWait(runId, WaitKind.SIGNAL, signalName = "new_alert")

        val res = post("/api/runs/$runId/signals", mapOf(
            "name" to "new_alert",
            "payload" to mapOf("service" to "checkout", "severity" to "sev2"),
        ))

        /* 202, not 200: the signal is accepted here and acted on when the run
           picks it up. Asserting 200 would have been asserting a status nobody
           chose. */
        assertEquals(202, res.status, res.body)
        assertTrue(
            queue.enqueued.any { it.runId == runId.toString() },
            "the wait was resolved and nothing was enqueued, so the run stays parked " +
                "until the reconciler notices — correct eventually, wrong now.",
        )
    }

    @Test
    fun `a signal to a running run is stored rather than refused`() {
        val runId = run("running")

        val res = post("/api/runs/$runId/signals", mapOf("name" to "new_alert"))

        assertEquals(202, res.status, res.body)
        assertEquals(
            1, signals.pending(runId).size,
            "a running run takes delivery at its next step boundary. Refusing here " +
                "would mean information can only reach a run that happens to be parked.",
        )
        assertTrue(
            queue.enqueued.none { it.runId == runId.toString() },
            "a running run was re-enqueued. It already holds a worker; a second job " +
                "for the same run is a duplicate execution, not a delivery.",
        )
    }

    @Test
    fun `a signal to a finished run is refused, and says the run has finished`() {
        val runId = run("succeeded")

        val res = post("/api/runs/$runId/signals", mapOf("name" to "new_alert"))

        assertTrue(res.status in 400..499, "expected a client error, got ${res.status}")
        assertTrue(
            res.body.contains("finished", ignoreCase = true) ||
                res.body.contains("succeeded", ignoreCase = true),
            "the refusal does not say why. Accepting it silently would be worse — " +
                "the sender would believe a run that will never read it got the news. " +
                "Body was: ${res.body}",
        )
        assertEquals(0, signals.pending(runId).size, "the signal was stored anyway")
    }

    @Test
    fun `a run in another workspace does not exist to this caller`() {
        val other = seed()
        val runId = run("waiting_for_event", world = other)

        val res = post("/api/runs/$runId/signals", mapOf("name" to "new_alert"))

        assertEquals(
            404, res.status,
            "invariant 8. A 403 would confirm the run exists, which is the fact " +
                "being protected. Body was: ${res.body}",
        )
        assertEquals(0, signals.pending(runId).size)
    }

    @Test
    fun `the signal limit is per run, not only per workspace`() {
        /*
         * TWO CASES, because one cannot tell the limits apart.
         *
         * `enforceRateLimit` short-circuits on the first exhausted key, so
         * exhausting the run key proves the run limit exists but says nothing
         * about the workspace one — a route that checked ONLY the run key would
         * pass that half. Exhausting only the workspace key is what proves the
         * other, and it is the half a shared workspace needs: a hundred runs
         * each politely under their own cap is still a hundred times the load.
         */
        val flooded = run("running")
        limiter.exhaust("signal:run:$flooded")
        val perRun = post("/api/runs/$flooded/signals", mapOf("name" to "new_alert"))
        assertEquals(
            429, perRun.status,
            "an unbounded stream into ONE run is the denial of service a " +
                "workspace-wide limit does not catch — the run is the flooder's own. " +
                "Body was: ${perRun.body}",
        )
        assertEquals(0, signals.pending(flooded).size, "the refused signal was stored")

        val busy = run("running")
        limiter.exhaust("signal:ws:${w.workspaceId}")
        val perWorkspace = post("/api/runs/$busy/signals", mapOf("name" to "new_alert"))
        assertEquals(
            429, perWorkspace.status,
            "the workspace limit was not enforced, so a caller can spread a flood " +
                "across runs and stay under every per-run cap. Body was: ${perWorkspace.body}",
        )
    }

    @Test
    fun `an oversized payload is refused with a message that says what to do`() {
        val runId = run("running")

        val res = post("/api/runs/$runId/signals", mapOf(
            "name" to "new_alert",
            "payload" to mapOf("blob" to "x".repeat(70_000)),
        ))

        assertTrue(res.status in 400..499, "expected a client error, got ${res.status}")
        assertContains(res.body, "KB",
            message = "the error does not name the limit it broke")
    }

    // ── Waits ────────────────────────────────────────────────────────────────

    @Test
    fun `the waits endpoint reports what the run is parked on`() {
        val runId = run("waiting_for_event")
        val wait = openWait(runId, WaitKind.ASYNC_TOOL, label = "waiting for render_video")

        val body = mapper.readTree(get("/api/runs/$runId/waits").body)
        val item = assertNotNull(body.path("items").firstOrNull(), "no waits returned")

        assertEquals(wait.id.toString(), item.path("waitId").asText())
        assertEquals("async_tool", item.path("kind").asText())
        assertEquals("waiting for render_video", item.path("label").asText())
        assertTrue(
            item.path("expiresInMs").asLong() > 0,
            "no deadline reached the screen, so the page cannot tell an operator " +
                "whether this will ever end",
        )
    }

    @Test
    fun `the waits endpoint is workspace-scoped too`() {
        val other = seed()
        val runId = run("waiting_for_event", world = other)
        openWait(runId, WaitKind.ASYNC_TOOL, world = other)

        val body = mapper.readTree(get("/api/runs/$runId/waits").body)
        assertEquals(
            0, body.path("items").size(),
            "another workspace's wait was served. The label alone would leak what " +
                "somebody else's run is doing.",
        )
    }

    // ── Callbacks ────────────────────────────────────────────────────────────

    @Test
    fun `a completion callback resolves the wait and resumes the run`() {
        val runId = run("waiting_for_event")
        val wait = openWait(runId, WaitKind.ASYNC_TOOL, withCallback = true)
        val token = assertNotNull(wait.callbackToken, "no callback token was minted")

        val res = callback(token, """{"status":"succeeded","output":{"url":"https://cdn/x.mp4"}}""")

        assertEquals(200, res.status, res.body)
        assertTrue(mapper.readTree(res.body).path("resolved").asBoolean())
        assertTrue(queue.enqueued.any { it.runId == runId.toString() }, "the run was not resumed")

        val after = assertNotNull(waits.findByKey(runId, wait.waitKey))
        assertEquals(RunWait.Resolution.COMPLETED, after.resolution)
    }

    @Test
    fun `a redelivered callback answers 200 and changes nothing`() {
        val runId = run("waiting_for_event")
        val wait = openWait(runId, WaitKind.ASYNC_TOOL, withCallback = true)
        val token = assertNotNull(wait.callbackToken)

        callback(token, """{"status":"succeeded","output":{"url":"https://cdn/x.mp4"}}""")
        val before = queue.enqueued.size

        val second = callback(token, """{"status":"succeeded","output":{"url":"https://cdn/x.mp4"}}""")

        assertEquals(
            200, second.status,
            "a redelivery got ${second.status}. Providers retry 4xx, so this is a " +
                "redelivery loop over a completion that was received correctly the " +
                "first time. Body was: ${second.body}",
        )
        assertTrue(mapper.readTree(second.body).path("duplicate").asBoolean(),
            "the answer does not say it was a duplicate")
        assertEquals(before, queue.enqueued.size,
            "the run was resumed TWICE for one completion")
    }

    @Test
    fun `a progress ping leaves the run parked`() {
        val runId = run("waiting_for_event")
        val wait = openWait(runId, WaitKind.ASYNC_TOOL, withCallback = true)
        val token = assertNotNull(wait.callbackToken)

        val res = callback(token, """{"status":"processing","percent":40}""")

        assertEquals(200, res.status, res.body)
        assertEquals(false, mapper.readTree(res.body).path("resolved").asBoolean())
        assertTrue(
            assertNotNull(waits.findByKey(runId, wait.waitKey)).isWaiting,
            "a provider's invented in-progress status ended the wait. The run would " +
                "resume with a 40%-done render presented as the finished result.",
        )
        assertTrue(queue.enqueued.isEmpty(), "the run was resumed on a progress ping")
    }

    @Test
    fun `an unknown token is a plain 404 that confirms nothing`() {
        val res = callback("cb_" + "0".repeat(48), """{"status":"succeeded"}""")

        assertEquals(404, res.status)
        assertTrue(
            !res.body.contains("wait", ignoreCase = true) ||
                !res.body.contains("run", ignoreCase = true),
            "the 404 describes the thing that was not found. This endpoint is " +
                "unauthenticated, so its answers are a probing oracle. Body: ${res.body}",
        )
    }

    @Test
    fun `a token of the wrong shape is refused before it costs a lookup`() {
        val res = callback("nope", """{}""")

        assertEquals(404, res.status)
        assertTrue(
            limiter.keys.none { it == "callback:nope" },
            "a four-character token reached the rate limiter and therefore the " +
                "database. The length check exists so that probing costs the prober " +
                "and not us.",
        )
    }

    @Test
    fun `callbacks are rate limited per token`() {
        val runId = run("waiting_for_event")
        val wait = openWait(runId, WaitKind.ASYNC_TOOL, withCallback = true)
        val token = assertNotNull(wait.callbackToken)
        limiter.exhaust("callback:$token")

        val res = callback(token, """{"status":"succeeded"}""")

        assertEquals(
            429, res.status,
            "an unauthenticated endpoint with no limit is both a way to probe for " +
                "valid tokens and a way to hammer the database.",
        )
        assertTrue(
            assertNotNull(waits.findByKey(runId, wait.waitKey)).isWaiting,
            "the wait was resolved despite the request being refused",
        )
    }

    // ── Harness ──────────────────────────────────────────────────────────────

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
    )

    private fun seed(): World {
        val world = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, world.workspaceId); it.setString(2, "signal-routes")
                it.setString(3, "signal-routes-" + world.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, world.environmentId); it.setObject(2, world.workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                    "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, world.workflowId); it.setObject(2, world.workspaceId)
                it.setObject(3, world.environmentId); it.setString(4, "wf-" + world.workflowId)
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, world.versionId); it.setObject(2, world.workflowId); it.executeUpdate() }
        }
        return world
    }

    private fun run(status: String, world: World = w): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id," +
                    " workflow_version_id,status) VALUES (?,?,?,?,?,?)"
            ).use {
                it.setObject(1, id); it.setObject(2, world.workspaceId)
                it.setObject(3, world.environmentId); it.setObject(4, world.workflowId)
                it.setObject(5, world.versionId); it.setString(6, status)
                it.executeUpdate()
            }
        }
        return id
    }

    /**
     * A wait, shaped the way `AsyncToolProtocol.precheck` shapes one.
     *
     * The `callback` metadata is not decoration: the callback route has no access
     * to the tool's spec and reads its rules from here. Opening a wait without it
     * would test the no-rules fallback — where any delivery is a completion —
     * rather than the path production takes.
     */
    private fun openWait(
        runId: UUID,
        kind: WaitKind,
        signalName: String? = null,
        label: String = "a six-minute render",
        withCallback: Boolean = false,
        world: World = w,
        nodeId: String = "n-1",
    ): RunWait = waits.open(
        WaitStore.OpenRequest(
            workspaceId = world.workspaceId, environmentId = world.environmentId,
            runId = runId, workflowId = world.workflowId, nodeId = nodeId,
            attemptGroup = 0, kind = kind, label = label,
            signalName = signalName, withCallback = withCallback,
            metadata = buildMap {
                put("tool", "render_video")
                put("protocol", "async")
                if (withCallback) put("callback", mapOf(
                    "statusPath" to "status",
                    "completedValues" to listOf("succeeded"),
                    "failedValues" to listOf("failed"),
                ))
            },
        )
    ).wait

    /** The caller's workspace, on every authenticated request. */
    private fun post(path: String, body: Any) = router.dispatch(Request(
        method = "POST", path = path, requestId = "test",
        headers = mapOf(
            "x-workspace-id" to w.workspaceId.toString(),
            "x-environment-id" to w.environmentId.toString(),
        ),
        body = mapper.writeValueAsString(body),
    ))

    private fun get(path: String) = router.dispatch(Request(
        method = "GET", path = path, requestId = "test",
        headers = mapOf(
            "x-workspace-id" to w.workspaceId.toString(),
            "x-environment-id" to w.environmentId.toString(),
        ),
    ))

    /** No workspace header: this endpoint is public, and that is the point. */
    private fun callback(token: String, body: String) = router.dispatch(Request(
        method = "POST", path = "/api/tool-callbacks/$token", requestId = "test",
        headers = emptyMap(), body = body,
    ))

    /**
     * A limiter that records what was asked and can be told to refuse one key.
     *
     * Refusing by key rather than by a global counter is what lets the per-run
     * and per-workspace limits be told apart — a limiter that refuses everything
     * would pass the per-run test while the route checked only the workspace.
     */
    private class CountingLimiter : RateLimiter {
        val keys = ConcurrentLinkedQueue<String>()
        private val exhausted = ConcurrentHashMap.newKeySet<String>()

        fun exhaust(key: String) { exhausted += key }

        override fun check(key: String, maxRequests: Long, windowSeconds: Long): RateLimitResult {
            keys += key
            return if (key in exhausted)
                RateLimitResult.Exceeded(maxRequests, maxRequests, windowSeconds, 42)
            else
                RateLimitResult.Allowed(1, maxRequests, windowSeconds, windowSeconds)
        }
    }
}
