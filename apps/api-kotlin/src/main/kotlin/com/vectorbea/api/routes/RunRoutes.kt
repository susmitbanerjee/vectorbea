package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pageParams
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.events.EventBus
import com.vectorbea.api.http.toJson
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.locks.DistributedLock
import com.vectorbea.api.queue.JobType
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.queue.WorkflowQueueException
import com.vectorbea.api.queue.WorkflowRunJob
import com.vectorbea.api.redis.RedisProvider
import com.vectorbea.api.repository.AgentRun
import com.vectorbea.api.repository.AppendEventRequest
import com.vectorbea.api.repository.CreateRunRequest
import com.vectorbea.api.repository.Page
import com.vectorbea.api.repository.RunEvent
import com.vectorbea.api.repository.RunEventRepository
import com.vectorbea.api.repository.RunRepository
import com.vectorbea.api.repository.WorkflowRepository
import com.vectorbea.api.telemetry.TelemetryClient
import io.lettuce.core.pubsub.RedisPubSubAdapter
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

private val log = LoggerFactory.getLogger(RunRoutes::class.java)

// ── Run status sets ───────────────────────────────────────────────────────────

private val TERMINAL_STATUSES    = setOf("succeeded", "failed", "cancelled", "timed_out", "enqueue_failed")

/**
 * Run-creation rate when a workspace has no policy row.
 *
 * 60/minute sustained with a burst of 120 — generous enough that no legitimate
 * client notices, tight enough that a runaway loop is stopped in a second rather
 * than after it has filled the queue.
 */
private val DEFAULT_RUN_RATE = 60 to 120

/** Body of `POST /api/runs/:id/replay`. Every field optional. */
data class ReplayRequest(
    /**
     * Partial replay boundary. Nodes up to and including this one are served from
     * the recording; nodes after it execute live with real calls and real cost.
     */
    val untilNode: String? = null,
)
private val CANCELLABLE_STATUSES = setOf("queued", "running", "waiting_for_approval")
private val RETRYABLE_STATUSES   = setOf("failed", "enqueue_failed", "timed_out")

// ── Response shapes ───────────────────────────────────────────────────────────

private fun AgentRun.toResponse(): Map<String, Any?> = mapOf(
    "id" to id.toString(),
    "workspaceId" to workspaceId.toString(),
    "environmentId" to environmentId.toString(),
    "workflowId" to workflowId.toString(),
    "workflowVersionId" to workflowVersionId.toString(),
    "status" to status,
    "triggerType" to triggerType,
    "currentStepId" to currentStepId,
    "currentAgentId" to currentAgentId?.toString(),
    "idempotencyKey" to idempotencyKey,
    "startedAt" to startedAt?.toString(),
    "completedAt" to completedAt?.toString(),
    "durationMs" to durationMs,
    // Field names match the TypeScript AgentRun interface (totalTokens / estimatedCostUsd)
    "totalTokens" to tokenCount,
    "estimatedCostUsd" to estimatedCost,
    "createdAt" to createdAt.toString(),
    "updatedAt" to updatedAt.toString(),
    "hasOutput" to (outputJson != null),
    "hasError" to (errorJson != null),
    "workflowName" to workflowName,
    "environment" to environmentName,
    "nodeTotal" to nodeTotal,
    "nodeCommitted" to nodeCommitted,
    "ribbonJson" to ribbonJson,
    "incidentId" to incidentId?.toString(),
)

private fun AgentRun.toDetailResponse(): Map<String, Any?> = toResponse() + mapOf(
    "outputJson" to outputJson,
    "errorJson" to errorJson,
)

private fun RunEvent.toResponse(): Map<String, Any?> = mapOf(
    "id" to id.toString(),
    "runId" to runId.toString(),
    "workspaceId" to workspaceId.toString(),
    "environmentId" to environmentId.toString(),
    "sequence" to sequence,
    "type" to type,
    "status" to status,
    "source" to source,
    "timestamp" to timestamp.toString(),
    "durationMs" to durationMs,
    "stepId" to stepId,
    "agentId" to agentId?.toString(),
    "toolId" to toolId?.toString(),
    "connectionId" to connectionId?.toString(),
    "modelName" to modelName,
    "parentEventId" to parentEventId?.toString(),
    "correlationId" to correlationId,
    "traceId" to traceId,
    "retryAttempt" to retryAttempt,
    "checkpointId" to checkpointId?.toString(),
    "title" to title,
    "summary" to summary,
    "inputJsonSanitized" to inputJsonSanitized,
    "outputJsonSanitized" to outputJsonSanitized,
    "metadataJsonSanitized" to metadataJsonSanitized,
    "errorJsonSanitized" to errorJsonSanitized,
    "tokenCount" to tokenCount,
    "estimatedCost" to estimatedCost,
    "createdAt" to createdAt.toString(),
)

// ── Route handler ─────────────────────────────────────────────────────────────

class RunRoutes(
    private val runRepo: RunRepository,
    private val eventRepo: RunEventRepository,
    private val workflowRepo: WorkflowRepository? = null,
    private val queue: WorkflowQueue? = null,
    private val eventBus: EventBus? = null,
    private val lock: DistributedLock? = null,
    private val redis: RedisProvider? = null,
    private val betaRepo: com.vectorbea.api.beta.BetaAccessRepository? = null,
    private val appConfig: com.vectorbea.api.config.AppConfig? = null,
    private val telemetry: TelemetryClient? = null,
    /**
     * Decides which typed stream a run goes to, before the message exists.
     * Null keeps every enqueue on the SHORT stream, which is the safe default
     * for a deployment mid-migration and for tests that do not exercise routing.
     */
    private val classResolver: com.vectorbea.api.queue.ExecutionClassResolver? = null,
    /** For fair-queue placement. Null falls back to FIFO ordering. */
    private val dataSource: javax.sql.DataSource? = null,
    /**
     * Decides whether a run is accepted at all, and what the caller is told when
     * it is. Null admits everything — the behaviour before load shedding existed,
     * kept for tests that do not exercise it.
     */
    private val admission: com.vectorbea.api.admission.AdmissionControl? = null,
    /**
     * Token bucket for run creation, per workspace. Null disables the check.
     */
    private val runRateLimiter: com.vectorbea.api.rate.TokenBucket? = null,
) {

    /**
     * Class for a fresh run: derived from the workflow version's graph, memoised
     * per version. This is the one place a graph is inspected — everything
     * downstream reads the stored answer.
     */
    private fun classifyVersion(versionId: UUID) =
        classResolver?.resolve(versionId) ?: com.vectorbea.api.queue.ExecutionClass.SHORT

    /**
     * Place a run in the weighted fair queue and advance the workspace clock.
     *
     * Done at trigger, in one atomic statement, because the ordering decision has
     * to happen exactly once per run — computing it later, or twice, would let
     * concurrent submissions from one tenant share a vtime and bypass the
     * weighting. Degrades to `now` (FIFO) if the DB is unavailable rather than
     * failing the trigger.
     */
    private fun placeInFairQueue(workspaceId: UUID, cls: com.vectorbea.api.queue.ExecutionClass) =
        dataSource?.let { com.vectorbea.api.queue.FairOrdering.placeAndAdvance(it, workspaceId, cls) }
            ?: com.vectorbea.api.queue.FairOrdering.Placement(
                System.currentTimeMillis() / 1000.0, 0)

    /**
     * Class for a continuation: read from the run row, never re-derived.
     *
     * A RESUME_RUN must land on the same stream as the run it continues. Re-
     * deriving would risk a continuation drifting to a different pool if the
     * classifier ever changed, and would reintroduce the graph probe that typing
     * the queue exists to remove.
     */
    private fun classifyExistingRun(runId: UUID) =
        com.vectorbea.api.queue.ExecutionClass.fromWire(
            runCatching { runRepo.findExecutionClass(runId) }.getOrNull())
    fun register(router: Router) {
        // Workflow-scoped trigger
        router.post("/api/workflows/:workflowId/run", ::triggerRun)

        // Run reads
        router.get("/api/runs", ::list)
        router.get("/api/runs/:id", ::getById)
        router.get("/api/runs/:id/events", ::listEvents)

        // SSE live stream
        router.sseGet("/api/runs/:id/stream", ::streamEvents)

        // Durable control operations
        router.post("/api/runs/purge-queued",     ::purgeQueuedRuns)
        router.post("/api/runs/:id/cancel",     ::cancelRun)
        router.post("/api/runs/:id/retry",      ::retryRun)
        router.post("/api/runs/:id/retry-node", ::retryNode)
        // Three operations, three costs, three guarantees. See section 2 of
        // 07-AGENT-RELIABILITY.md and docs/architecture/REPLAY-AUDIT.md - until
        // this change, /replay did what /rerun now does, which is the bug.
        router.post("/api/runs/:id/replay",     ::replayRun)
        router.post("/api/runs/:id/rerun",      ::rerunRun)
    }

    // ── POST /api/workflows/:workflowId/run ────────────────────────────────────

    private fun triggerRun(req: Request): Response {
        val ctx = req.context()
        val environmentId = ctx.requireEnvironmentId()
        val workflowId = req.pathUUID("workflowId")

        val wfRepo = workflowRepo
            ?: throw ApiError.InternalError("Workflow repository not available")
        val q = queue
            ?: throw ApiError.ServiceUnavailable("Queue not available — Redis required")

        // ── 1. Load and validate workflow ─────────────────────────────────────
        val workflow = wfRepo.findById(workflowId, ctx.workspaceId)
            ?: throw ApiError.NotFound("Workflow")

        if (workflow.status == "archived") {
            throw ApiError.ValidationError("Workflow '${workflow.name}' is archived and cannot be triggered")
        }

        val versionId = workflow.currentVersionId
            ?: throw ApiError.ValidationError("Workflow '${workflow.name}' has no current version — publish a version first")

        // ── 1b. Beta controls + usage limit gate ──────────────────────────────
        val beta = betaRepo
        if (beta != null) {
            // Workspace must be approved and not disabled
            val controls = beta.getWorkspaceBetaControls(ctx.workspaceId)
            if (controls != null) {
                if (controls.accessStatus == "disabled") {
                    throw ApiError.Forbidden("WORKSPACE_DISABLED: This workspace has been disabled. Contact support.")
                }
                if (!controls.simulationEnabled && !controls.realExecutionEnabled) {
                    throw ApiError.Forbidden("WORKSPACE_DISABLED: Execution is disabled for this workspace.")
                }
            }

            // Daily run limit
            val policy = beta.getUsagePolicy(ctx.workspaceId)
            val maxRuns = policy?.maxRunsPerDay ?: (appConfig?.betaDefaultMaxRunsPerDay ?: 20)
            val todayRuns = beta.getDailyRunCount(ctx.workspaceId)
            if (todayRuns >= maxRuns) {
                telemetry?.track("usage_limit_blocked", "usage_limit",
                    workspaceId = ctx.workspaceId.toString(),
                    appUserId = req.principal?.appUserId?.toString(),
                    properties = mapOf("limit" to "runs_per_day", "max" to maxRuns))
                throw ApiError.TooManyRequests("BETA_USAGE_LIMIT_EXCEEDED: Daily run limit of $maxRuns reached. Resets at midnight UTC.")
            }
        }

        // ── 2. Parse request body ─────────────────────────────────────────────
        data class TriggerBody(
            val input: Map<String, Any?> = emptyMap(),
            val idempotencyKey: String? = null,
            val triggerType: String = "manual",
            val mode: String = "simulation",  // "simulation" | "real"
        )

        val body = if (req.body.isBlank()) TriggerBody()
                   else req.bodyAs<TriggerBody>()

        // ── 2b. Real execution gate ───────────────────────────────────────────
        val requestedMode = if (body.mode == "real") "real" else "simulation"
        if (requestedMode == "real" && beta != null) {
            val controls = beta.getWorkspaceBetaControls(ctx.workspaceId)
            // No controls row means nobody has made a decision about this
            // workspace, so the deployment's default applies. This read
            // `?: false` regardless of DEFAULT_EXECUTION_MODE, which made that
            // setting inert: it existed, was documented, and changed nothing.
            // An explicit row still wins in both directions.
            val realEnabled = controls?.realExecutionEnabled
                ?: (appConfig?.defaultExecutionMode == "real_execution_enabled")
            if (!realEnabled) {
                throw ApiError.Forbidden("REAL_EXECUTION_NOT_ENABLED: Real execution is switched off for this " +
                    "workspace. Ask a Vectorbea admin to enable it, or run in simulation mode.")
            }
        }

        // Validate triggerType
        if (body.triggerType !in setOf("manual", "api", "schedule")) {
            throw ApiError.ValidationError("triggerType must be 'manual', 'api', or 'schedule'")
        }

        // ── 3. Idempotency check ──────────────────────────────────────────────
        if (body.idempotencyKey != null) {
            val cached = checkIdempotency(ctx.workspaceId, body.idempotencyKey)
            if (cached != null) {
                log.info("[run] idempotency hit key={} existingRunId={}", body.idempotencyKey, cached)
                val existingRun = runRepo.findById(UUID.fromString(cached), ctx.workspaceId)
                if (existingRun != null) {
                    return Response.ok(mapOf(
                        "runId" to existingRun.id.toString(),
                        "status" to existingRun.status.uppercase(),
                        "idempotencyHit" to true,
                    ))
                }
            }
        }

        // ── 4. Serialize input (strip any secret-like values) ─────────────────
        val inputJson = try {
            toJson(body.input)
        } catch (e: Exception) {
            throw ApiError.ValidationError("Invalid input JSON: ${e.message}")
        }

        // ── 4b. Classify BEFORE the run row exists ────────────────────────────
        // The API already holds workflow_version_id here, and therefore
        // graph_json, so the class costs one memoised lookup. Doing it now means
        // the class is committed atomically with the run and the message can be
        // routed without any worker-side probe.
        val executionClass = classifyVersion(versionId)

        // ── 4c. Place in the weighted fair queue ──────────────────────────────
        // A tenant submitting 500 runs pushes their own clock forward; a tenant
        // submitting one lands near `now` and is served next. This is what stops
        // a flood starving everyone else, and it replaces FIFO ordering entirely.
        val placement = placeInFairQueue(ctx.workspaceId, executionClass)

        // ── 4d. Rate limit ────────────────────────────────────────────────────
        // Before admission, because "you are asking too fast" is a cheaper and
        // more specific answer than "the queue is deep" — and a client hammering
        // the endpoint should be told to slow down rather than shown a queue
        // position that will be stale by the time they read it.
        runRateLimiter?.let { bucket ->
            val verdict = bucket.tryConsume(
                key = "run-create:${ctx.workspaceId}",
                refillPerMinute = workspaceRunRate(ctx.workspaceId).first,
                burst = workspaceRunRate(ctx.workspaceId).second,
            )
            if (!verdict.allowed) {
                throw ApiError.TooManyRequests(
                    "Too many runs created. You may create ${verdict.refillPerMinute} runs per minute; " +
                        "retry in ${verdict.retryAfterSeconds}s.",
                    mapOf(
                        "limitPerMinute" to verdict.refillPerMinute,
                        "burst" to verdict.burst,
                        "retryAfterSeconds" to verdict.retryAfterSeconds,
                        "retryable" to true,
                    ),
                )
            }
        }

        // ── 4e. Admission control ─────────────────────────────────────────────
        // The decision to accept, and — under load — what accepting means. A run
        // accepted silently into a deep queue is the failure this prevents: the
        // caller gets a position and an ETA in the same response, not twenty
        // minutes of nothing.
        val admitted = admission?.admit(ctx.workspaceId, executionClass, placement.priority)

        // ── 5. Create run row with status=queued ──────────────────────────────
        val run = runRepo.create(CreateRunRequest(
            workspaceId = ctx.workspaceId,
            environmentId = environmentId,
            workflowId = workflowId,
            workflowVersionId = versionId,
            triggerType = body.triggerType,
            inputJson = inputJson,
            idempotencyKey = body.idempotencyKey,
            executionClass = executionClass.wire,
            fairVtime = placement.fairVtime,
            priority = placement.priority,
        ))

        // ── 6. Append lifecycle events ────────────────────────────────────────
        val source = "api:trigger"
        appendEvent(run, "RUN_CREATED", "queued", source, "Run created", "Run triggered via ${body.triggerType}")
        appendEvent(run, "RUN_QUEUED",  "queued", source, "Run queued",  "Job placed on workflow queue")

        // ── 7. Enqueue Redis job ──────────────────────────────────────────────
        val job = WorkflowRunJob(
            runId = run.id.toString(),
            workspaceId = ctx.workspaceId.toString(),
            environmentId = environmentId.toString(),
            workflowId = workflowId.toString(),
            workflowVersionId = versionId.toString(),
            jobType = JobType.START_RUN,
            inputJson = inputJson,
            // Audit trail: identity derived from verified JWT, never from user-supplied headers
            requestedByUserId = req.principal?.appUserId?.toString(),
            executionClass = executionClass,
        )

        val messageId = try {
            q.enqueue(job)
        } catch (e: WorkflowQueueException) {
            log.error("[run] enqueue failed for runId={}: {}", run.id, e.message)
            // Mark run as enqueue_failed so it doesn't stay in a zombie queued state
            runCatching { runRepo.updateStatus(run.id, ctx.workspaceId, "enqueue_failed") }
            throw ApiError.ServiceUnavailable("Failed to enqueue workflow job: queue unavailable")
        }

        log.info("[run] triggered runId={} workflowId={} mode={} messageId={}", run.id, workflowId, requestedMode, messageId)

        // ── 8. Increment daily usage counter ─────────────────────────────────
        runCatching { beta?.incrementDailyRuns(ctx.workspaceId, isSimulation = requestedMode == "simulation") }

        // ── 9. Record idempotency key ─────────────────────────────────────────
        if (body.idempotencyKey != null) {
            recordIdempotency(ctx.workspaceId, body.idempotencyKey, run.id.toString())
        }

        telemetry?.track("workflow_run_queued", "run",
            workspaceId = ctx.workspaceId.toString(),
            runId = run.id.toString(),
            workflowId = workflowId.toString(),
            appUserId = req.principal?.appUserId?.toString(),
            properties = mapOf("mode" to requestedMode, "triggerType" to body.triggerType))

        // Mode-specific start events feed the business dashboard (simulation vs real)
        if (requestedMode == "simulation") {
            telemetry?.track("simulation_run_started", "simulation",
                workspaceId = ctx.workspaceId.toString(),
                runId = run.id.toString(),
                workflowId = workflowId.toString(),
                appUserId = req.principal?.appUserId?.toString())
        } else {
            telemetry?.track("real_execution_started", "real_execution",
                workspaceId = ctx.workspaceId.toString(),
                runId = run.id.toString(),
                workflowId = workflowId.toString(),
                appUserId = req.principal?.appUserId?.toString())
        }

        return Response.accepted(buildMap {
            put("runId", run.id.toString())
            put("status", "QUEUED")
            // Queue position and ETA when there is a queue. Absent when the run is
            // expected to start immediately — an ETA of zero seconds reads as a
            // system under strain when it is not.
            admitted?.toResponseFields()?.let { putAll(it) }
        })
    }

    /**
     * Per-workspace run-creation rate, from plan policy.
     *
     * Read per call rather than cached: a plan upgrade must take effect
     * immediately, and this is one indexed lookup on a table already in the
     * connection's working set from the fair-queue placement two statements
     * earlier. Falls back to the platform default if there is no policy row.
     */
    private fun workspaceRunRate(workspaceId: UUID): Pair<Int, Int> = dataSource?.let { ds ->
        runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT max_runs_per_minute, runs_per_minute_burst
                         FROM workspace_usage_policies WHERE workspace_id = ?"""
                ).use { stmt ->
                    stmt.setObject(1, workspaceId)
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) rs.getInt(1) to rs.getInt(2) else DEFAULT_RUN_RATE
                    }
                }
            }
        }.getOrDefault(DEFAULT_RUN_RATE)
    } ?: DEFAULT_RUN_RATE

    // ── GET /api/runs ─────────────────────────────────────────────────────────

    private fun list(req: Request): Response {
        val ctx = req.context()
        // Frontend sends page/pageSize; req.pageParams() reads limit/offset → mismatch.
        // Read page/pageSize directly so pagination works correctly.
        val params = com.vectorbea.api.repository.PageParams(
            page     = req.query("page")?.toIntOrNull()?.coerceAtLeast(1) ?: 1,
            pageSize = req.query("pageSize")?.toIntOrNull()?.coerceIn(1, 100) ?: 15,
        )
        val statusFilter = req.query("status")
        val workflowIdStr = req.query("workflowId")
        val workflowId = workflowIdStr?.let {
            try { UUID.fromString(it) }
            catch (_: IllegalArgumentException) { throw ApiError.ValidationError("workflowId must be a valid UUID") }
        }

        val page = runRepo.list(
            workspaceId = ctx.workspaceId,
            environmentId = ctx.environmentId,
            workflowId = workflowId,
            status = statusFilter,
            params = params,
        )
        return Response.ok(page.mapItems { it.toResponse() })
    }

    // ── GET /api/runs/:id ─────────────────────────────────────────────────────

    private fun getById(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val run = runRepo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Run")
        return Response.ok(run.toDetailResponse())
    }

    // ── GET /api/runs/:id/events ──────────────────────────────────────────────

    private fun listEvents(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("id")
        runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")

        // Allow up to 500 events per page for the monitoring/live-run endpoint.
        // The generic pageParams() caps at 100 which truncates parallel runs that
        // emit 100+ events, causing the frontend to miss STEP_COMPLETED events.
        val requestedSize = req.query("pageSize")?.toIntOrNull()?.coerceIn(1, 500) ?: 20
        val params = com.vectorbea.api.repository.PageParams(
            page     = req.query("page")?.toIntOrNull()?.coerceAtLeast(1) ?: 1,
            pageSize = requestedSize,
        )
        val afterSequence = req.query("afterSequence")?.toIntOrNull()
        val typeFilter = req.query("type")

        val page = eventRepo.listByRun(
            runId = runId,
            workspaceId = ctx.workspaceId,
            afterSequence = afterSequence,
            type = typeFilter,
            params = params,
        )
        return Response.ok(page.mapItems { it.toResponse() })
    }

    // ── GET /api/runs/:id/stream  (SSE) ────────────────────────────────────────

    /**
     * Server-Sent Events stream for a single run.
     *
     * Protocol:
     *   1. Authorize — run must belong to the caller's workspace.
     *   2. Send historical events from DB (event: run_event).
     *   3. If run already terminal → send run_complete and close.
     *   4. Subscribe to Redis pub/sub channel run-events:{runId}.
     *   5. Relay new events as they arrive.
     *   6. Send heartbeat comments every ~20 s.
     *   7. Close when: client disconnects | run reaches terminal state | Redis unavailable (fallback).
     */
    private fun streamEvents(req: Request, emitter: Router.SseEmitter) {
        val ctx = req.context()
        val runId = req.pathUUID("id")
        val run = runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")

        // ── Phase 1: send persisted events ───────────────────────────────────
        val existingPage = eventRepo.listByRun(
            runId = runId,
            workspaceId = ctx.workspaceId,
            params = com.vectorbea.api.repository.PageParams(pageSize = 500),
        )
        for (ev in existingPage.items) {
            if (!emitter.sendEvent("run_event", toJson(ev.toResponse()))) return
        }

        // ── Phase 2: close immediately if terminal ────────────────────────────
        if (run.status in TERMINAL_STATUSES) {
            emitter.sendEvent("run_complete", """{"status":"${run.status}","final":true}""")
            return
        }

        // ── Phase 3: subscribe to Redis pub/sub ───────────────────────────────
        val r = redis
        if (r == null) {
            // Degraded: no Redis — send a fallback message so the client knows to poll
            emitter.sendEvent("stream_unavailable", """{"message":"Real-time streaming requires Redis","fallback":"polling"}""")
            return
        }

        val channel = eventBus?.channelFor(runId.toString()) ?: "run-events:$runId"
        val messageQueue = LinkedBlockingQueue<String?>() // null = poison pill (terminal / close)

        val pubSub = r.newPubSubConnection()
        pubSub.addListener(object : RedisPubSubAdapter<String, String>() {
            override fun message(ch: String, message: String) {
                messageQueue.offer(message)
                // Detect terminal event to unblock the loop
                if (message.contains("\"RUN_SUCCEEDED\"") ||
                    message.contains("\"RUN_FAILED\"") ||
                    message.contains("\"RUN_CANCELLED\"") ||
                    message.contains("\"RUN_TIMED_OUT\"")
                ) {
                    messageQueue.offer(null) // signal end
                }
            }
        })
        pubSub.sync().subscribe(channel)
        log.debug("[stream] subscribed runId={} channel={}", runId, channel)

        try {
            var heartbeatCounter = 0
            while (emitter.isConnected()) {
                // Block up to 20 s then send a heartbeat
                val msg = messageQueue.poll(20, TimeUnit.SECONDS)

                when {
                    msg == null -> {
                        // Timeout — send heartbeat
                        heartbeatCounter++
                        if (!emitter.sendComment("heartbeat t=${Instant.now()}")) break
                    }
                    msg == "__poison__" -> break
                    else -> {
                        if (!emitter.sendEvent("run_event", msg)) break
                        // If the poison pill follows, we'll pick it up next iteration
                    }
                }

                // Safety: re-check DB status every ~10 heartbeats
                if (heartbeatCounter > 0 && heartbeatCounter % 10 == 0) {
                    val fresh = runRepo.findById(runId, ctx.workspaceId)
                    if (fresh?.status in TERMINAL_STATUSES) {
                        emitter.sendEvent("run_complete", """{"status":"${fresh?.status}","final":true}""")
                        break
                    }
                }
            }
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
        } finally {
            runCatching { pubSub.sync().unsubscribe(channel) }
            runCatching { pubSub.close() }
            log.debug("[stream] closed runId={}", runId)
        }

        // Send run_complete if we exited because of a terminal event
        val finalRun = runCatching { runRepo.findById(runId, ctx.workspaceId) }.getOrNull()
        if (finalRun?.status in TERMINAL_STATUSES) {
            emitter.sendEvent("run_complete", """{"status":"${finalRun?.status}","final":true}""")
        }
    }

    // ── POST /api/runs/:id/cancel ─────────────────────────────────────────────

    private fun purgeQueuedRuns(req: Request): Response {
        val ctx = req.context()
        val purged = runRepo.purgeQueued(ctx.workspaceId)
        log.info("[run] queued runs purged workspaceId={} count={}", ctx.workspaceId, purged)
        return Response.ok(mapOf("purged" to purged, "status" to "cancelled"))
    }

    /**
     * Request cancellation of an in-progress run.
     *
     * Sets the run status to 'cancellation_requested'. The worker polls for this
     * flag between DAG iterations and exits cleanly when it detects it.
     * The status transitions to 'cancelled' once the worker acknowledges.
     *
     * Only runs in [CANCELLABLE_STATUSES] can be cancelled.
     */
    private fun cancelRun(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("id")
        val run = runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")

        if (run.status !in CANCELLABLE_STATUSES) {
            throw ApiError.ValidationError(
                "Run '${run.status}' cannot be cancelled — only ${CANCELLABLE_STATUSES.joinToString(", ")} runs can"
            )
        }

        val updated = runRepo.updateStatus(runId, ctx.workspaceId, "cancellation_requested")
        if (!updated) {
            throw ApiError.ValidationError("Run could not be marked for cancellation (status changed?)")
        }

        appendEvent(run.copy(status = "cancellation_requested"),
            "RUN_CANCELLATION_REQUESTED", "cancellation_requested",
            "api:cancel", "Cancellation requested", "Run cancellation requested via API")

        log.info("[run] cancellation requested runId={}", runId)
        return Response.ok(mapOf("runId" to runId.toString(), "status" to "cancellation_requested"))
    }

    // ── POST /api/runs/:id/retry ──────────────────────────────────────────────

    /**
     * Retry a failed run from scratch (REPLAY_RUN job on the same run ID).
     *
     * Enqueues a REPLAY_RUN job — the worker re-executes the full workflow
     * from the trigger node using the same input JSON and workflow version.
     */
    private fun retryRun(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("id")
        val run = runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")

        if (run.status !in RETRYABLE_STATUSES) {
            throw ApiError.ValidationError(
                "Run '${run.status}' cannot be retried — only ${RETRYABLE_STATUSES.joinToString(", ")} runs can"
            )
        }

        val q = queue ?: throw ApiError.ServiceUnavailable("Queue not available")

        runRepo.updateStatus(runId, ctx.workspaceId, "queued")
        appendEvent(run, "RETRY_REQUESTED", "queued", "api:retry",
            "Retry requested", "Full run retry enqueued")

        val job = WorkflowRunJob(
            runId             = runId.toString(),
            workspaceId       = ctx.workspaceId.toString(),
            environmentId     = run.environmentId.toString(),
            workflowId        = run.workflowId.toString(),
            workflowVersionId = run.workflowVersionId.toString(),
            jobType           = JobType.REPLAY_RUN,
            inputJson         = run.inputJson,
            executionClass    = classifyExistingRun(runId),
        )
        try { q.enqueue(job) }
        catch (e: Exception) {
            runRepo.updateStatus(runId, ctx.workspaceId, "enqueue_failed")
            throw ApiError.ServiceUnavailable("Failed to enqueue retry job: ${e.message}")
        }

        log.info("[run] retry enqueued runId={}", runId)
        return Response.accepted(mapOf("runId" to runId.toString(), "status" to "QUEUED"))
    }

    // ── POST /api/runs/:id/retry-node ─────────────────────────────────────────

    /**
     * Retry a single failed node in an existing run.
     *
     * Enqueues a RETRY_NODE job. The worker loads the latest checkpoint,
     * resets the specified node to PENDING, and resumes execution from there.
     */
    private fun retryNode(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("id")
        val run = runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")

        if (run.status !in RETRYABLE_STATUSES) {
            throw ApiError.ValidationError(
                "Run '${run.status}' cannot have a node retried — only ${RETRYABLE_STATUSES.joinToString(", ")} runs can"
            )
        }

        data class RetryNodeBody(val nodeId: String)
        if (req.body.isBlank()) throw ApiError.ValidationError("Request body with 'nodeId' is required")
        val body = req.bodyAs<RetryNodeBody>()
        if (body.nodeId.isBlank()) throw ApiError.ValidationError("'nodeId' must not be blank")

        val q = queue ?: throw ApiError.ServiceUnavailable("Queue not available")

        runRepo.updateStatus(runId, ctx.workspaceId, "queued")
        appendEvent(run, "RETRY_REQUESTED", "queued", "api:retry-node",
            "Node retry requested", "Node '${body.nodeId}' retry enqueued")

        val job = WorkflowRunJob(
            runId             = runId.toString(),
            workspaceId       = ctx.workspaceId.toString(),
            environmentId     = run.environmentId.toString(),
            workflowId        = run.workflowId.toString(),
            workflowVersionId = run.workflowVersionId.toString(),
            jobType           = JobType.RETRY_NODE,
            resumeFromNodeId  = body.nodeId,
            inputJson         = run.inputJson,
            executionClass    = classifyExistingRun(runId),
        )
        try { q.enqueue(job) }
        catch (e: Exception) {
            runRepo.updateStatus(runId, ctx.workspaceId, "enqueue_failed")
            throw ApiError.ServiceUnavailable("Failed to enqueue retry-node job: ${e.message}")
        }

        log.info("[run] retry-node enqueued runId={} nodeId={}", runId, body.nodeId)
        return Response.accepted(mapOf("runId" to runId.toString(), "nodeId" to body.nodeId, "status" to "QUEUED"))
    }

    // ---- POST /api/runs/:id/replay -------------------------------------------

    /**
     * REPLAY - a pure read from the recording.
     *
     * Never calls a provider. Never fires a side effect. Costs nothing. Produces
     * byte-identical output to the original run, or fails loudly saying which node
     * it could not reproduce.
     *
     * This is for debugging and audit: "show me exactly what happened, again".
     *
     * Before this change the endpoint of this name started a fresh execution that
     * called every provider and re-sent every email. That behaviour still exists -
     * it is a legitimate thing to want - and now lives at `/rerun`, where its cost
     * is in its name.
     *
     * Body (optional): `{ "untilNode": "classify-1" }` for a partial replay -
     * recorded up to and including that node, live after it.
     */
    private fun replayRun(req: Request): Response {
        val ctx = req.context()
        val environmentId = ctx.requireEnvironmentId()
        val runId = req.pathUUID("id")
        val original = runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")
        val q = queue ?: throw ApiError.ServiceUnavailable("Queue not available")

        // An absent or malformed body means "replay everything", which is the
        // safe default: a partial replay the user did not ask for would make live
        // calls they were told would not happen.
        val untilNode = runCatching {
            req.body.takeIf { it.isNotBlank() }?.let { req.bodyAs<ReplayRequest>().untilNode }
        }.getOrNull()

        // Refuse rather than silently degrade. A run recorded before complete
        // model-call capture cannot be replayed, and the honest answer is to say so
        // and name the alternative - not to quietly execute it live and hand back a
        // bill for an operation advertised as free.
        val recorded = countRecordedCalls(runId)
        if (recorded == 0) {
            throw ApiError.UnprocessableEntity(
                "This run has no recorded model calls, so it cannot be replayed. Runs " +
                    "executed before call recording was enabled are not replayable. Use " +
                    "Re-run to execute it again with current data - that calls providers " +
                    "and incurs cost."
            )
        }

        val replayClass = classifyVersion(original.workflowVersionId)
        val placement = placeInFairQueue(ctx.workspaceId, replayClass)

        val newRun = runRepo.create(com.vectorbea.api.repository.CreateRunRequest(
            workspaceId       = ctx.workspaceId,
            environmentId     = environmentId,
            workflowId        = original.workflowId,
            workflowVersionId = original.workflowVersionId,
            triggerType       = "replay",
            inputJson         = original.inputJson,
            executionClass    = replayClass.wire,
            fairVtime         = placement.fairVtime,
            priority          = placement.priority,
            executionModeKind = "replay",
            sourceRunId       = runId,
            replayUntilNode   = untilNode,
        ))

        appendEvent(newRun, "REPLAY_CREATED", "queued", "api:replay",
            "Replay started",
            if (untilNode != null)
                "Replaying run " + runId + " from the recording up to node '" + untilNode + "', live after"
            else
                "Replaying run " + runId + " from the recording - no provider calls, no cost")
        appendEvent(newRun, "RUN_QUEUED", "queued", "api:replay",
            "Run queued", "Replay placed on queue")

        enqueueOrFail(q, newRun, original, replayClass, ctx, environmentId)

        log.info("[run] replay enqueued sourceRunId={} replayRunId={} untilNode={}",
            runId, newRun.id, untilNode)
        return Response.accepted(mapOf(
            "operation"     to "replay",
            "sourceRunId"   to runId.toString(),
            "runId"         to newRun.id.toString(),
            "status"        to "QUEUED",
            "untilNode"     to untilNode,
            "recordedCalls" to recorded,
            "callsProvider" to (untilNode != null),
            "estimatedCost" to if (untilNode != null) "partial" else "none",
            "message"       to if (untilNode != null)
                "Replaying from the recording up to '" + untilNode + "', then executing live. " +
                    "Nodes after the boundary call providers and incur cost."
            else
                "Replaying from the recording. No provider calls, no side effects, no cost.",
        ))
    }

    // ---- POST /api/runs/:id/rerun --------------------------------------------

    /**
     * RE-RUN - a fresh execution from the trigger, with current data.
     *
     * New run id. Every provider called for real. Every side effect fires again.
     * Full cost.
     *
     * This is exactly what the endpoint named `/replay` used to do. Same
     * behaviour, honest name: "do it again with today's data".
     */
    private fun rerunRun(req: Request): Response {
        val ctx = req.context()
        val environmentId = ctx.requireEnvironmentId()
        val runId = req.pathUUID("id")
        val original = runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")

        val wfRepo = workflowRepo ?: throw ApiError.InternalError("Workflow repository not available")
        val q = queue ?: throw ApiError.ServiceUnavailable("Queue not available")

        wfRepo.findById(original.workflowId, ctx.workspaceId)
            ?: throw ApiError.ValidationError("Original workflow no longer exists")

        // Classified from the version rather than copied from the original run,
        // whose class may predate a classifier change.
        val rerunClass = classifyVersion(original.workflowVersionId)
        val placement = placeInFairQueue(ctx.workspaceId, rerunClass)

        val newRun = runRepo.create(com.vectorbea.api.repository.CreateRunRequest(
            workspaceId       = ctx.workspaceId,
            environmentId     = environmentId,
            workflowId        = original.workflowId,
            workflowVersionId = original.workflowVersionId,
            triggerType       = "rerun",
            inputJson         = original.inputJson,
            executionClass    = rerunClass.wire,
            fairVtime         = placement.fairVtime,
            priority          = placement.priority,
            executionModeKind = "rerun",
            sourceRunId       = runId,
        ))

        appendEvent(newRun, "RERUN_CREATED", "queued", "api:rerun",
            "Re-run started",
            "Fresh execution of run " + runId + " - providers called, side effects fire, cost incurred")
        appendEvent(newRun, "RUN_QUEUED", "queued", "api:rerun", "Run queued", "Re-run placed on queue")

        enqueueOrFail(q, newRun, original, rerunClass, ctx, environmentId)

        log.info("[run] rerun enqueued sourceRunId={} newRunId={}", runId, newRun.id)
        return Response.accepted(mapOf(
            "operation"     to "rerun",
            "sourceRunId"   to runId.toString(),
            "runId"         to newRun.id.toString(),
            "status"        to "QUEUED",
            "callsProvider" to true,
            "estimatedCost" to "full",
            "message"       to "Executing fresh from the trigger with current data. " +
                "Providers are called and side effects fire again.",
        ))
    }

    /**
     * How many provider calls the recording holds for this run.
     *
     * Zero means the run predates complete recording and is not replayable. The
     * replay endpoint checks this up front so the refusal happens at the API with
     * an explanation, rather than deep in a worker with a stack trace.
     */
    private fun countRecordedCalls(runId: UUID): Int = dataSource?.let { ds ->
        runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement("SELECT count(*)::int FROM model_calls WHERE run_id = ?").use { stmt ->
                    stmt.setObject(1, runId)
                    stmt.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else 0 }
                }
            }
        }.getOrDefault(0)
    } ?: 0

    /** Shared enqueue-and-mark-failed path for replay and re-run. */
    private fun enqueueOrFail(
        q: com.vectorbea.api.queue.WorkflowQueue,
        newRun: AgentRun,
        original: AgentRun,
        cls: com.vectorbea.api.queue.ExecutionClass,
        ctx: com.vectorbea.api.api.RequestContext,
        environmentId: UUID,
    ) {
        val job = WorkflowRunJob(
            runId             = newRun.id.toString(),
            workspaceId       = ctx.workspaceId.toString(),
            environmentId     = environmentId.toString(),
            workflowId        = original.workflowId.toString(),
            workflowVersionId = original.workflowVersionId.toString(),
            jobType           = JobType.START_RUN,
            inputJson         = original.inputJson,
            executionClass    = cls,
        )
        try { q.enqueue(job) }
        catch (e: Exception) {
            runRepo.updateStatus(newRun.id, ctx.workspaceId, "enqueue_failed")
            throw ApiError.ServiceUnavailable("Failed to enqueue job: " + e.message)
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun appendEvent(
        run: AgentRun,
        type: String,
        status: String,
        source: String,
        title: String,
        summary: String,
    ) {
        runCatching {
            val ev = eventRepo.append(AppendEventRequest(
                runId = run.id,
                workspaceId = run.workspaceId,
                environmentId = run.environmentId,
                type = type,
                status = status,
                source = source,
                title = title,
                summary = summary,
            ))
            // Publish to pub/sub so any SSE subscriber gets it immediately
            eventBus?.publishRunEvent(run.id.toString(), toJson(ev.toResponse()))
        }.onFailure { e ->
            log.warn("[run] failed to append event type={} runId={}: {}", type, run.id, e.message)
        }
    }

    /** Check idempotency key in Redis — returns existing runId or null. */
    private fun checkIdempotency(workspaceId: UUID, key: String): String? {
        return runCatching {
            redis?.commands?.get("idempotency:$workspaceId:$key")
        }.getOrNull()
    }

    /** Record idempotency key → runId in Redis with 24-hour TTL. */
    private fun recordIdempotency(workspaceId: UUID, key: String, runId: String) {
        runCatching {
            redis?.commands?.setex("idempotency:$workspaceId:$key", 86_400L, runId)
        }.onFailure { e ->
            log.warn("[run] failed to record idempotency key={}: {}", key, e.message)
        }
    }
}

private fun <T, R> Page<T>.mapItems(transform: (T) -> R) =
    Page(items = items.map(transform), total = total, page = page, pageSize = pageSize)
