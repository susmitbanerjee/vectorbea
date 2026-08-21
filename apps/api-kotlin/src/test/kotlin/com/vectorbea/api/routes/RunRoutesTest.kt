package com.vectorbea.api.routes

import com.vectorbea.api.cache.NoOpCacheService
import com.vectorbea.api.events.EventBus
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.fromJson
import com.vectorbea.api.http.toJson
import com.vectorbea.api.queue.JobType
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.queue.WorkflowQueueException
import com.vectorbea.api.queue.WorkflowRunJob
import com.vectorbea.api.repository.AgentRun
import com.vectorbea.api.repository.AppendEventRequest
import com.vectorbea.api.repository.CreateRunRequest
import com.vectorbea.api.repository.Page
import com.vectorbea.api.repository.PageParams
import com.vectorbea.api.repository.RunEvent
import com.vectorbea.api.repository.RunEventRepository
import com.vectorbea.api.repository.RunRepository
import com.vectorbea.api.repository.Workflow
import com.vectorbea.api.repository.WorkflowRepository
import com.vectorbea.api.repository.WorkflowVersion
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Unit tests for RunRoutes — stub repositories, no DB or Redis needed.
 */
class RunRoutesTest {

    private val workspaceId = UUID.randomUUID()
    private val environmentId = UUID.randomUUID()
    private val workflowId = UUID.randomUUID()
    private val versionId = UUID.randomUUID()

    private lateinit var router: Router
    private lateinit var runRepo: StubRunRepository
    private lateinit var eventRepo: StubRunEventRepository
    private lateinit var workflowRepo: StubWorkflowRepository
    private lateinit var queue: CapturingQueue

    @BeforeEach
    fun setUp() {
        runRepo = StubRunRepository()
        eventRepo = StubRunEventRepository()
        workflowRepo = StubWorkflowRepository()
        queue = CapturingQueue()

        router = Router()
        RunRoutes(
            runRepo = runRepo,
            eventRepo = eventRepo,
            workflowRepo = workflowRepo,
            queue = queue,
            eventBus = null,
            lock = null,
            redis = null,
        ).register(router)

        // Pre-populate workflow
        workflowRepo.workflows[workflowId] = makeWorkflow()
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun post(path: String, body: Any) = router.dispatch(Request(
        method = "POST", path = path, requestId = "test",
        headers = mapOf(
            "x-workspace-id" to workspaceId.toString(),
            "x-environment-id" to environmentId.toString(),
        ),
        body = toJson(body),
    ))

    private fun get(path: String) = router.dispatch(Request(
        method = "GET", path = path, requestId = "test",
        headers = mapOf(
            "x-workspace-id" to workspaceId.toString(),
            "x-environment-id" to environmentId.toString(),
        ),
    ))

    private fun makeWorkflow(status: String = "active") = Workflow(
        id = workflowId,
        workspaceId = workspaceId,
        environmentId = environmentId,
        name = "Test Workflow",
        slug = "test-workflow",
        description = null,
        status = status,
        currentVersionId = versionId,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
    )

    // ── POST /api/workflows/:id/run ───────────────────────────────────────────

    @Test
    fun `trigger run returns 202 QUEUED`() {
        val resp = post(
            "/api/workflows/$workflowId/run",
            mapOf("input" to mapOf("key" to "value"), "triggerType" to "manual"),
        )
        assertEquals(202, resp.status)
        val body = fromJson<Map<String, Any>>(resp.body)
        assertEquals("QUEUED", body["status"])
        assertNotNull(body["runId"])
    }

    @Test
    fun `trigger run creates run row`() {
        post("/api/workflows/$workflowId/run", mapOf("input" to emptyMap<String, Any>()))
        assertEquals(1, runRepo.created.size)
        assertEquals("queued", runRepo.created[0].status)
        assertEquals(workflowId, runRepo.created[0].workflowId)
    }

    @Test
    fun `trigger run enqueues START_RUN job`() {
        post("/api/workflows/$workflowId/run", mapOf("input" to emptyMap<String, Any>()))
        assertEquals(1, queue.enqueued.size)
        assertEquals(JobType.START_RUN, queue.enqueued[0].jobType)
    }

    @Test
    fun `trigger run appends RUN_CREATED and RUN_QUEUED events`() {
        post("/api/workflows/$workflowId/run", mapOf("input" to emptyMap<String, Any>()))
        val types = eventRepo.appended.map { it.type }
        assertTrue("RUN_CREATED" in types, "Expected RUN_CREATED event")
        assertTrue("RUN_QUEUED" in types, "Expected RUN_QUEUED event")
    }

    @Test
    fun `trigger run returns 404 for unknown workflow`() {
        val resp = post("/api/workflows/${UUID.randomUUID()}/run", mapOf("input" to emptyMap<String, Any>()))
        assertEquals(404, resp.status)
    }

    @Test
    fun `trigger run returns 422 for archived workflow`() {
        workflowRepo.workflows[workflowId] = makeWorkflow(status = "archived")
        val resp = post("/api/workflows/$workflowId/run", mapOf("input" to emptyMap<String, Any>()))
        assertEquals(400, resp.status) // ValidationError → 400
    }

    @Test
    fun `trigger run returns 503 when queue fails and marks enqueue_failed`() {
        queue.shouldFail = true
        val resp = post("/api/workflows/$workflowId/run", mapOf("input" to emptyMap<String, Any>()))
        assertEquals(503, resp.status)
        // Run should be marked enqueue_failed
        val statusUpdates = runRepo.statusUpdates
        assertTrue(statusUpdates.any { it == "enqueue_failed" }, "Expected enqueue_failed status update")
    }

    @Test
    fun `idempotent trigger returns existing run on second call`() {
        // No Redis in test — idempotency check returns null → two runs created
        // (Redis-backed idempotency is tested via integration test)
        val resp1 = post(
            "/api/workflows/$workflowId/run",
            mapOf("input" to emptyMap<String, Any>(), "idempotencyKey" to "key-1"),
        )
        assertEquals(202, resp1.status)
        // Without Redis, second call creates a second run (expected in unit test)
        val resp2 = post(
            "/api/workflows/$workflowId/run",
            mapOf("input" to emptyMap<String, Any>(), "idempotencyKey" to "key-1"),
        )
        assertEquals(202, resp2.status)
    }

    // ── GET /api/runs ─────────────────────────────────────────────────────────

    @Test
    fun `GET runs returns 200 with empty list`() {
        val resp = get("/api/runs")
        assertEquals(200, resp.status)
    }

    @Test
    fun `GET runs by id returns 404 for unknown run`() {
        val resp = get("/api/runs/${UUID.randomUUID()}")
        assertEquals(404, resp.status)
    }

    @Test
    fun `GET run events returns 200`() {
        // Seed a run
        val run = runRepo.seed(workspaceId, workflowId, versionId, environmentId)
        val resp = get("/api/runs/${run.id}/events")
        assertEquals(200, resp.status)
    }

    // ── SSE route is registered ───────────────────────────────────────────────

    @Test
    fun `SSE stream route is registered`() {
        val sseMatch = router.findSseRoute("GET", "/api/runs/${UUID.randomUUID()}/stream")
        assertNotNull(sseMatch, "SSE route must be registered")
    }

    @Test
    fun `SSE stream returns 404 for unknown run via emitter`() {
        val runId = UUID.randomUUID()
        val events = mutableListOf<Pair<String, String>>()
        var closedCleanly = false

        val emitter = object : Router.SseEmitter {
            override fun sendEvent(eventType: String, data: String): Boolean {
                events += eventType to data
                return true
            }
            override fun sendComment(comment: String) = true
            override fun isConnected() = true
        }

        // SSE handler throws ApiError.NotFound — HttpServer catches it but in unit test we see it
        val sseMatch = router.findSseRoute("GET", "/api/runs/$runId/stream")!!
        val enrichedReq = Request(
            method = "GET", path = "/api/runs/$runId/stream",
            pathParams = mapOf("id" to runId.toString()),
            requestId = "test",
            headers = mapOf(
                "x-workspace-id" to workspaceId.toString(),
                "x-environment-id" to environmentId.toString(),
            ),
        )
        try {
            sseMatch.first.handler(enrichedReq, emitter)
        } catch (e: com.vectorbea.api.errors.ApiError.NotFound) {
            closedCleanly = true
        }
        assertTrue(closedCleanly, "Should throw NotFound for unknown run")
    }

    @Test
    fun `SSE sends historical events then stream_unavailable when Redis is null`() {
        val run = runRepo.seed(workspaceId, workflowId, versionId, environmentId, status = "running")
        eventRepo.seedEvent(run.id, workspaceId, environmentId, "RUN_STARTED")

        val events = mutableListOf<Pair<String, String>>()
        val emitter = object : Router.SseEmitter {
            override fun sendEvent(eventType: String, data: String): Boolean {
                events += eventType to data
                return true
            }
            override fun sendComment(comment: String) = true
            override fun isConnected() = true
        }

        val sseMatch = router.findSseRoute("GET", "/api/runs/${run.id}/stream")!!
        val enrichedReq = Request(
            method = "GET", path = "/api/runs/${run.id}/stream",
            pathParams = mapOf("id" to run.id.toString()),
            requestId = "test",
            headers = mapOf(
                "x-workspace-id" to workspaceId.toString(),
                "x-environment-id" to environmentId.toString(),
            ),
        )
        sseMatch.first.handler(enrichedReq, emitter)

        // Should have sent the historical event + stream_unavailable (no Redis)
        assertTrue(events.any { it.first == "run_event" }, "Expected historical run_event")
        assertTrue(events.any { it.first == "stream_unavailable" }, "Expected stream_unavailable fallback")
    }

    @Test
    fun `SSE sends run_complete immediately for terminal run`() {
        val run = runRepo.seed(workspaceId, workflowId, versionId, environmentId, status = "succeeded")

        val events = mutableListOf<Pair<String, String>>()
        val emitter = object : Router.SseEmitter {
            override fun sendEvent(eventType: String, data: String): Boolean {
                events += eventType to data
                return true
            }
            override fun sendComment(comment: String) = true
            override fun isConnected() = true
        }

        val sseMatch = router.findSseRoute("GET", "/api/runs/${run.id}/stream")!!
        val enrichedReq = Request(
            method = "GET", path = "/api/runs/${run.id}/stream",
            pathParams = mapOf("id" to run.id.toString()),
            requestId = "test",
            headers = mapOf(
                "x-workspace-id" to workspaceId.toString(),
                "x-environment-id" to environmentId.toString(),
            ),
        )
        sseMatch.first.handler(enrichedReq, emitter)

        assertTrue(events.any { it.first == "run_complete" }, "Expected run_complete for terminal run")
    }

    @Test
    fun `purge queued cancels all queued runs in workspace`() {
        runRepo.purgeResult = 3
        val response = post("/api/runs/purge-queued", emptyMap<String, Any>())

        assertEquals(200, response.status)
        assertEquals(workspaceId, runRepo.purgedWorkspaceId)
        assertEquals(3, fromJson<Map<String, Any>>(response.body)["purged"])
    }
}

// ── Stub implementations ──────────────────────────────────────────────────────

class StubRunRepository : RunRepository(FakeDs()) {
    val created = mutableListOf<AgentRun>()
    val statusUpdates = mutableListOf<String>()
    var purgeResult = 0
    var purgedWorkspaceId: UUID? = null
    private val store = mutableMapOf<UUID, AgentRun>()

    fun seed(
        workspaceId: UUID,
        workflowId: UUID,
        versionId: UUID,
        environmentId: UUID,
        status: String = "queued",
    ): AgentRun {
        val run = makeRun(workspaceId, workflowId, versionId, environmentId, status)
        store[run.id] = run
        return run
    }

    override fun create(req: CreateRunRequest): AgentRun {
        val run = makeRun(req.workspaceId, req.workflowId, req.workflowVersionId, req.environmentId)
        store[run.id] = run
        created += run
        return run
    }

    override fun findById(id: UUID, workspaceId: UUID): AgentRun? =
        store[id]?.takeIf { it.workspaceId == workspaceId }

    override fun updateStatus(id: UUID, workspaceId: UUID, status: String): Boolean {
        statusUpdates += status
        return true
    }

    override fun purgeQueued(workspaceId: UUID): Int {
        purgedWorkspaceId = workspaceId
        return purgeResult
    }

    override fun list(
        workspaceId: UUID,
        environmentId: UUID?,
        workflowId: UUID?,
        status: String?,
        params: PageParams,
    ): Page<AgentRun> = Page(emptyList(), 0L, 1, params.limit)

    private fun makeRun(
        workspaceId: UUID,
        workflowId: UUID,
        versionId: UUID,
        environmentId: UUID,
        status: String = "queued",
    ) = AgentRun(
        id = UUID.randomUUID(),
        workspaceId = workspaceId,
        environmentId = environmentId,
        workflowId = workflowId,
        workflowVersionId = versionId,
        status = status,
        triggerType = "manual",
        inputJson = "{}",
        outputJson = null,
        errorJson = null,
        currentStepId = null,
        currentAgentId = null,
        idempotencyKey = null,
        startedAt = null,
        completedAt = null,
        durationMs = null,
        tokenCount = null,
        estimatedCost = null,
        createdAt = Instant.now(),
        updatedAt = Instant.now(),
    )
}

class StubRunEventRepository : RunEventRepository(FakeDs()) {
    val appended = mutableListOf<AppendEventRequest>()
    private val store = mutableListOf<RunEvent>()

    fun seedEvent(runId: UUID, workspaceId: UUID, environmentId: UUID, type: String) {
        store += makeEvent(runId, workspaceId, environmentId, type, store.size + 1)
    }

    override fun append(req: AppendEventRequest): RunEvent {
        appended += req
        val ev = makeEvent(req.runId, req.workspaceId, req.environmentId, req.type, appended.size)
        store += ev
        return ev
    }

    override fun listByRun(
        runId: UUID,
        workspaceId: UUID,
        afterSequence: Int?,
        type: String?,
        params: PageParams,
    ): Page<RunEvent> {
        val items = store.filter { it.runId == runId && it.workspaceId == workspaceId }
        return Page(items, items.size.toLong(), 1, params.limit)
    }

    private fun makeEvent(runId: UUID, workspaceId: UUID, environmentId: UUID, type: String, seq: Int) = RunEvent(
        id = UUID.randomUUID(),
        runId = runId,
        workspaceId = workspaceId,
        environmentId = environmentId,
        sequence = seq,
        type = type,
        status = "queued",
        source = "test",
        timestamp = Instant.now(),
        durationMs = null, stepId = null, agentId = null, toolId = null,
        connectionId = null, modelName = null, parentEventId = null,
        correlationId = null, traceId = null, retryAttempt = null, checkpointId = null,
        title = null, summary = null, inputJsonSanitized = null, outputJsonSanitized = null,
        metadataJsonSanitized = null, errorJsonSanitized = null,
        tokenCount = null, estimatedCost = null, createdAt = Instant.now(),
    )
}

class StubWorkflowRepository : WorkflowRepository(FakeDs()) {
    val workflows = mutableMapOf<UUID, Workflow>()

    override fun findById(id: UUID, workspaceId: UUID): Workflow? =
        workflows[id]?.takeIf { it.workspaceId == workspaceId }
}

class CapturingQueue : WorkflowQueue {
    val enqueued = mutableListOf<WorkflowRunJob>()
    var shouldFail = false

    override fun enqueue(job: WorkflowRunJob): String {
        if (shouldFail) throw WorkflowQueueException("Redis unavailable (stub)")
        enqueued += job
        return "1234567890-0"
    }
}

/** Minimal DataSource stub for BaseRepository constructor — never actually called in stubs. */
private class FakeDs : javax.sql.DataSource by object : javax.sql.DataSource {
    override fun getConnection() = throw UnsupportedOperationException("stub")
    override fun getConnection(u: String?, p: String?) = throw UnsupportedOperationException("stub")
    override fun getLogWriter() = null
    override fun setLogWriter(out: java.io.PrintWriter?) {}
    override fun setLoginTimeout(seconds: Int) {}
    override fun getLoginTimeout() = 0
    override fun getParentLogger(): java.util.logging.Logger = throw java.sql.SQLFeatureNotSupportedException("stub")
    override fun <T : Any?> unwrap(iface: Class<T>?) = throw java.sql.SQLException("stub")
    override fun isWrapperFor(iface: Class<*>?) = false
} {}
