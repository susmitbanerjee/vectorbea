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
import io.lettuce.core.pubsub.RedisPubSubAdapter
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

private val log = LoggerFactory.getLogger(RunRoutes::class.java)

// ── Run status sets ───────────────────────────────────────────────────────────

private val TERMINAL_STATUSES    = setOf("succeeded", "failed", "cancelled", "timed_out", "enqueue_failed")
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
) {
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
        router.post("/api/runs/:id/cancel",     ::cancelRun)
        router.post("/api/runs/:id/retry",      ::retryRun)
        router.post("/api/runs/:id/retry-node", ::retryNode)
        router.post("/api/runs/:id/replay",     ::replayRun)
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

        // ── 2. Parse request body ─────────────────────────────────────────────
        data class TriggerBody(
            val input: Map<String, Any?> = emptyMap(),
            val idempotencyKey: String? = null,
            val triggerType: String = "manual",
        )

        val body = if (req.body.isBlank()) TriggerBody()
                   else req.bodyAs<TriggerBody>()

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

        // ── 5. Create run row with status=queued ──────────────────────────────
        val run = runRepo.create(CreateRunRequest(
            workspaceId = ctx.workspaceId,
            environmentId = environmentId,
            workflowId = workflowId,
            workflowVersionId = versionId,
            triggerType = body.triggerType,
            inputJson = inputJson,
            idempotencyKey = body.idempotencyKey,
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
        )

        val messageId = try {
            q.enqueue(job)
        } catch (e: WorkflowQueueException) {
            log.error("[run] enqueue failed for runId={}: {}", run.id, e.message)
            // Mark run as enqueue_failed so it doesn't stay in a zombie queued state
            runCatching { runRepo.updateStatus(run.id, ctx.workspaceId, "enqueue_failed") }
            throw ApiError.ServiceUnavailable("Failed to enqueue workflow job: queue unavailable")
        }

        log.info("[run] triggered runId={} workflowId={} messageId={}", run.id, workflowId, messageId)

        // ── 8. Record idempotency key ─────────────────────────────────────────
        if (body.idempotencyKey != null) {
            recordIdempotency(ctx.workspaceId, body.idempotencyKey, run.id.toString())
        }

        return Response.accepted(mapOf(
            "runId" to run.id.toString(),
            "status" to "QUEUED",
        ))
    }

    // ── GET /api/runs ─────────────────────────────────────────────────────────

    private fun list(req: Request): Response {
        val ctx = req.context()
        val params = req.pageParams()
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
        )
        try { q.enqueue(job) }
        catch (e: Exception) {
            runRepo.updateStatus(runId, ctx.workspaceId, "enqueue_failed")
            throw ApiError.ServiceUnavailable("Failed to enqueue retry-node job: ${e.message}")
        }

        log.info("[run] retry-node enqueued runId={} nodeId={}", runId, body.nodeId)
        return Response.accepted(mapOf("runId" to runId.toString(), "nodeId" to body.nodeId, "status" to "QUEUED"))
    }

    // ── POST /api/runs/:id/replay ─────────────────────────────────────────────

    /**
     * Replay a completed or failed run from the beginning.
     *
     * Creates a new run row (new ID) with the same workflow version, workspace,
     * and input JSON. Enqueues a START_RUN job for the new run.
     *
     * Replay is available even on succeeded runs (to re-run with the same input).
     */
    private fun replayRun(req: Request): Response {
        val ctx = req.context()
        val environmentId = ctx.requireEnvironmentId()
        val runId = req.pathUUID("id")
        val original = runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")

        val wfRepo = workflowRepo ?: throw ApiError.InternalError("Workflow repository not available")
        val q = queue ?: throw ApiError.ServiceUnavailable("Queue not available")

        // Validate the workflow still exists
        wfRepo.findById(original.workflowId, ctx.workspaceId)
            ?: throw ApiError.ValidationError("Original workflow no longer exists")

        // Create a fresh run row
        val newRun = runRepo.create(com.vectorbea.api.repository.CreateRunRequest(
            workspaceId       = ctx.workspaceId,
            environmentId     = environmentId,
            workflowId        = original.workflowId,
            workflowVersionId = original.workflowVersionId,
            triggerType       = "replay",
            inputJson         = original.inputJson,
        ))

        appendEvent(newRun, "REPLAY_CREATED", "queued", "api:replay",
            "Replay started", "Replaying run from scratch (original: $runId)")
        appendEvent(newRun, "RUN_QUEUED", "queued", "api:replay", "Run queued", "Replay job placed on queue")

        val job = WorkflowRunJob(
            runId             = newRun.id.toString(),
            workspaceId       = ctx.workspaceId.toString(),
            environmentId     = environmentId.toString(),
            workflowId        = original.workflowId.toString(),
            workflowVersionId = original.workflowVersionId.toString(),
            jobType           = JobType.START_RUN,
            inputJson         = original.inputJson,
        )
        try { q.enqueue(job) }
        catch (e: Exception) {
            runRepo.updateStatus(newRun.id, ctx.workspaceId, "enqueue_failed")
            throw ApiError.ServiceUnavailable("Failed to enqueue replay job: ${e.message}")
        }

        log.info("[run] replay enqueued originalRunId={} newRunId={}", runId, newRun.id)
        return Response.accepted(mapOf(
            "originalRunId" to runId.toString(),
            "runId"         to newRun.id.toString(),
            "status"        to "QUEUED",
        ))
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
