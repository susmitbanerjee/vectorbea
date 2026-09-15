package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pageParams
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.events.EventBus
import com.vectorbea.api.http.mapper
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
import com.vectorbea.api.ingress.RunIngress
import com.vectorbea.api.ingress.RunResponseMode
import com.vectorbea.api.ingress.SyncRunWaiter
import com.vectorbea.api.ingress.TriggerActor
import com.vectorbea.api.ingress.TriggerSource
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
 * Values of `mode` that are asking about the RESPONSE rather than about what the
 * run may touch. Anything else in that field is a simulation/real answer.
 */
private val RESPONSE_MODE_WORDS = setOf("async", "sync", "stream")

/** Body of `POST /api/runs/:id/replay`. Every field optional. */
data class ReplayRequest(
    /**
     * Partial replay boundary. Nodes up to and including this one are served from
     * the recording; nodes after it execute live with real calls and real cost.
     */
    val untilNode: String? = null,
)
/** Long enough for a service name plus a region plus a check id; short enough to index. */
private const val MAX_DEDUP_KEY_LENGTH = 200

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
    /* The live-singleton key, beside the idempotency key it is constantly
       confused with. Shown so "why did my second alert not start a run" has an
       answer on the run itself. */
    "dedupKey" to dedupKey,
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
    // Whether the result got where it was going. On the LIST response, not only
    // the detail one, because "which of my runs did not deliver" is a question
    // asked of a list — and a list that needs a per-row join to answer it will
    // not answer it.
    "deliveryStatus" to deliveryStatus,
    /*
     * On the LIST response as well as the detail one, deliberately.
     *
     * Somebody scanning a list of runs needs to know which of them they can
     * expect to inspect. Finding out only after opening one, and finding an
     * empty panel, is the experience this flag exists to replace.
     */
    "payloadsWithheld" to payloadsWithheld,
    "runnerPoolId" to runnerPoolId?.toString(),
    "incidentId" to incidentId?.toString(),
)

private fun AgentRun.toDetailResponse(): Map<String, Any?> = toResponse() + mapOf(
    "outputJson" to decodeJsonColumn(outputJson),
    "errorJson" to decodeJsonColumn(errorJson),
)

/**
 * Render a `jsonb` column as JSON, not as a string containing JSON.
 *
 * The repository reads `output_json` / `error_json` with `getJsonbStringOrNull`, so
 * what reaches here is the column's raw TEXT. Passing that straight into the response
 * map made Jackson escape it, and the run detail arrived as
 * `"errorJson": "{\"code\":\"WORKER_ERROR\"}"` — a string where every consumer
 * expects an object. The web client validates this endpoint against its contract and
 * rejected the whole response with "Expected object, received string", so a failed run
 * could not be opened at all: the one screen whose entire purpose is showing why a run
 * failed was the screen the failure made unreadable.
 *
 * Every other route already does this (`AgentRoutes`, `ToolRoutes`, `WorkflowRoutes`
 * all parse their jsonb columns before responding); this was the outlier.
 *
 * Returns null when the column is null, and falls back to the raw string when it does
 * not parse. The fallback is deliberate: a row written by something that did not store
 * valid JSON is still worth showing to whoever is debugging it, and dropping it would
 * hide the very evidence the screen exists for.
 */
private fun decodeJsonColumn(raw: String?): Any? {
    if (raw == null) return null
    return runCatching { mapper.readValue(raw, Any::class.java) }.getOrDefault(raw)
}

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
    /**
     * Plan enforcement. Null skips every plan check — the behaviour before S3,
     * kept so the unit tests that build a router by hand keep working.
     */
    private val entitlements: com.vectorbea.api.entitlements.EntitlementGuard? = null,
    /**
     * The billing ledger. Null skips metering; the run still executes, because a
     * ledger write is never worth a customer's run.
     */
    private val usageMeter: com.vectorbea.api.entitlements.UsageMeter? = null,
    /**
     * The one admission path. Null makes every trigger fail loudly rather than
     * quietly falling back to a second copy of the sequence — a second copy is
     * exactly what this replaced.
     */
    private val runIngress: com.vectorbea.api.ingress.RunIngress? = null,
    /** Injectable so a test can wait without sleeping. */
    private val syncWaiter: com.vectorbea.api.ingress.SyncRunWaiter? = null,
    /**
     * The governance trail, for the two destructive run operations.
     *
     * `AuditLog.Action` has named `run.cancel` and `run.rerun` since it was
     * written and nothing called either. Both are worth recording for the same
     * reason: they are the operations where a PERSON overrides what the platform
     * was going to do — stopping work that was in flight, or paying to run
     * something a second time with its side effects. "Who cancelled the payment
     * run" has exactly one correct answer and nothing recorded it.
     */
    private val audit: com.vectorbea.api.audit.AuditLog? = null,
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
        /* Same endpoint, streamed. The router picks this one only when the caller
           asks with `Accept: text/event-stream` or `?mode=stream`, so a plain POST
           is unaffected — see Router.findSseRoute. */
        router.ssePost("/api/workflows/:workflowId/run", ::triggerRunStreaming)

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

    /**
     * Start a run.
     *
     * ── THIS USED TO BE THE ADMISSION SEQUENCE, AND NOW IT IS AN ADAPTER ────
     * Rate limit, quota, placement, admission, create, meter, events, enqueue —
     * all of that lived here, which is why `WorkflowScheduler` could not reuse
     * it and reimplemented a subset instead, and why scheduled runs skipped
     * every plan check in the product. It moved to [RunIngress]; what stays is
     * what is genuinely specific to an HTTP caller: the beta gates, the request
     * body, and which of the three response modes to answer in.
     */
    private fun triggerRun(req: Request): Response {
        val ctx = req.context()
        val workflowId = req.pathUUID("workflowId")
        val body = parseTriggerBody(req)
        val mode = RunResponseMode.parse(body.responseModeWire)

        if (mode == RunResponseMode.STREAM) {
            /*
             * Reachable only when the caller asked for stream in the BODY and not
             * in the Accept header or query string — the router chooses the SSE
             * handler from those two, before the body has been read. Rather than
             * pretend, say exactly what to change.
             */
            throw ApiError.ValidationError(
                "To stream, send `Accept: text/event-stream` or add `?mode=stream` to the URL. " +
                    "The response format is chosen before the body is read, so a mode in the " +
                    "body cannot select it."
            )
        }

        val started = startFromRequest(req, workflowId, body)

        return when (mode) {
            RunResponseMode.SYNC -> respondSync(started, ctx.workspaceId, body.timeoutMs)
            else -> Response.accepted(buildMap {
                put("runId", started.runId.toString())
                put("status", "QUEUED")
                if (started.idempotentHit) put("idempotencyHit", true)
                if (started.joinedExisting) {
                    put("joinedExisting", true)
                    put("message", "A run is already working on this deduplication key. " +
                        "Your input was delivered to it as a signal; no second run was started.")
                }
                // Queue position and ETA when there is a queue. Absent when the run
                // is expected to start immediately — an ETA of zero seconds reads
                // as a system under strain when it is not.
                started.admitted?.toResponseFields()?.let { putAll(it) }
            })
        }
    }

    /**
     * `POST /api/workflows/:workflowId/run` with `Accept: text/event-stream`.
     *
     * Start and watch on one request. Split into POST-then-GET the caller loses
     * whatever happened in between — including, for a fast workflow, the whole
     * run.
     */
    private fun triggerRunStreaming(req: Request, emitter: Router.SseEmitter) {
        val ctx = req.context()
        val workflowId = req.pathUUID("workflowId")

        /*
         * A refusal has to reach the client as a stream event, not as a status
         * code: the response headers went out when the stream opened, so there is
         * no code left to set. An SSE client that gets a silent close cannot tell
         * "refused" from "the network died".
         */
        val started = try {
            startFromRequest(req, workflowId, parseTriggerBody(req))
        } catch (e: ApiError) {
            emitter.sendEvent("error", toJson(mapOf(
                "code" to e.code, "message" to e.message, "status" to e.httpStatus)))
            return
        }

        emitter.sendEvent("run_started", toJson(buildMap {
            put("runId", started.runId.toString())
            put("status", "QUEUED")
            if (started.idempotentHit) put("idempotencyHit", true)
            if (started.joinedExisting) put("joinedExisting", true)
        }))

        streamRun(started.runId, ctx.workspaceId, emitter)
    }

    /**
     * Body of a trigger request. Every field optional.
     *
     * `mode` has meant "simulation | real" since long before response modes
     * existed and clients send it, so the response mode gets its own field and
     * `mode` keeps the meaning it had. `mode: "sync"` is still read as a
     * response mode, because it is what somebody will type first and silently
     * ignoring it would leave them waiting for a result that never comes.
     */
    private data class TriggerBody(
        val input: Map<String, Any?> = emptyMap(),
        val idempotencyKey: String? = null,
        /**
         * At most one LIVE run per (workspace, workflow, key).
         *
         * The caller decides what "the same thing" is — a service name, a commit
         * sha. What happens when the key is taken is the WORKFLOW's choice, not
         * theirs: see `workflows.dedup_policy`.
         */
        val dedupKey: String? = null,
        /**
         * 0–100, or absent to take the workflow's default.
         *
         * Clamped to the workspace's plan ceiling. A Sev1 raised above the
         * workflow's normal priority is the case this exists for.
         */
        val priority: Int? = null,
        val triggerType: String = "manual",
        val mode: String? = null,
        val responseMode: String? = null,
        /** How long a sync caller will wait. Clamped, not rejected. */
        val timeoutMs: Long? = null,
    ) {
        val executionMode: String get() = if (mode == "real") "real" else "simulation"
        val responseModeWire: String? get() =
            responseMode ?: mode?.takeIf { it in RESPONSE_MODE_WORDS }
    }

    private fun parseTriggerBody(req: Request): TriggerBody {
        val body = if (req.body.isBlank()) TriggerBody() else req.bodyAs<TriggerBody>()
        if (TriggerSource.fromWire(body.triggerType) == null) {
            throw ApiError.ValidationError(
                "`triggerType` must be one of ${TriggerSource.wireNames().joinToString(", ")}."
            )
        }
        if (body.priority != null && body.priority !in 0..100) {
            throw ApiError.ValidationError(
                "`priority` must be between 0 and 100. 0 is batch, 50 is normal, 100 is the " +
                    "priority lane; a workspace without that entitlement is clamped below it."
            )
        }
        if (body.dedupKey != null && body.dedupKey.length > MAX_DEDUP_KEY_LENGTH) {
            throw ApiError.ValidationError(
                "`dedupKey` is over $MAX_DEDUP_KEY_LENGTH characters. It names the thing being " +
                    "worked — a service, a deploy — not the payload."
            )
        }
        return body
    }

    /**
     * The gates specific to an HTTP caller, then [RunIngress].
     *
     * The beta controls stay here rather than moving into the ingress because
     * they are about a WORKSPACE's onboarding state, not about a run: a schedule
     * a beta workspace already owns keeps firing while an interactive trigger is
     * refused, which is the intended behaviour and would be lost if this check
     * sat behind every ingress path.
     */
    private fun startFromRequest(
        req: Request,
        workflowId: UUID,
        body: TriggerBody,
    ): RunIngress.Started {
        val ctx = req.context()
        val ingress = runIngress
            ?: throw ApiError.InternalError("Run ingress is not configured")

        applyBetaGates(ctx.workspaceId, req, body)

        val inputJson = try {
            toJson(body.input)
        } catch (e: Exception) {
            throw ApiError.ValidationError("The `input` field is not valid JSON: ${e.message}")
        }

        val started = ingress.start(RunIngress.Request(
            workspaceId = ctx.workspaceId,
            workflowId = workflowId,
            environmentId = ctx.requireEnvironmentId(),
            inputJson = inputJson,
            source = TriggerSource.fromWire(body.triggerType) ?: TriggerSource.MANUAL,
            actor = TriggerActor(
                userId = req.principal?.appUserId,
                apiKeyId = req.apiKeyId,
            ),
            idempotencyKey = body.idempotencyKey,
            dedupKey = body.dedupKey,
            priority = body.priority?.toShort(),
            reason = "Triggered via ${body.triggerType}",
        ))

        // Nothing here fires for an idempotency hit: no run was created, so
        // counting one would inflate the daily cap and the funnel with a
        // duplicate that never executed.
        if (!started.idempotentHit && !started.joinedExisting) {
            runCatching {
                betaRepo?.incrementDailyRuns(ctx.workspaceId,
                    isSimulation = body.executionMode == "simulation")
            }
            telemetry?.track("workflow_run_queued", "run",
                workspaceId = ctx.workspaceId.toString(),
                runId = started.runId.toString(),
                workflowId = workflowId.toString(),
                appUserId = req.principal?.appUserId?.toString(),
                properties = mapOf("mode" to body.executionMode, "triggerType" to body.triggerType))
            telemetry?.track(
                if (body.executionMode == "simulation") "simulation_run_started" else "real_execution_started",
                if (body.executionMode == "simulation") "simulation" else "real_execution",
                workspaceId = ctx.workspaceId.toString(),
                runId = started.runId.toString(),
                workflowId = workflowId.toString(),
                appUserId = req.principal?.appUserId?.toString())
        }
        return started
    }

    /** Workspace onboarding state: approved, not disabled, and under its daily cap. */
    private fun applyBetaGates(workspaceId: UUID, req: Request, body: TriggerBody) {
        val beta = betaRepo ?: return

        val controls = beta.getWorkspaceBetaControls(workspaceId)
        if (controls != null) {
            if (controls.accessStatus == "disabled") {
                throw ApiError.Forbidden(
                    "WORKSPACE_DISABLED: This workspace has been disabled. Contact support.")
            }
            if (!controls.simulationEnabled && !controls.realExecutionEnabled) {
                throw ApiError.Forbidden(
                    "WORKSPACE_DISABLED: Execution is disabled for this workspace.")
            }
        }

        val policy = beta.getUsagePolicy(workspaceId)
        val maxRuns = policy?.maxRunsPerDay ?: (appConfig?.betaDefaultMaxRunsPerDay ?: 20)
        if (beta.getDailyRunCount(workspaceId) >= maxRuns) {
            telemetry?.track("usage_limit_blocked", "usage_limit",
                workspaceId = workspaceId.toString(),
                appUserId = req.principal?.appUserId?.toString(),
                properties = mapOf("limit" to "runs_per_day", "max" to maxRuns))
            throw ApiError.TooManyRequests(
                "BETA_USAGE_LIMIT_EXCEEDED: Daily run limit of $maxRuns reached. " +
                    "Resets at midnight UTC.")
        }

        if (body.executionMode == "real") {
            // No controls row means nobody has made a decision about this
            // workspace, so the deployment's default applies.
            val realEnabled = controls?.realExecutionEnabled
                ?: (appConfig?.defaultExecutionMode == "real_execution_enabled")
            if (!realEnabled) {
                throw ApiError.Forbidden(
                    "REAL_EXECUTION_NOT_ENABLED: Real execution is switched off for this " +
                        "workspace. Ask a Vectorbea admin to enable it, or run in simulation mode.")
            }
        }
    }

    /**
     * Wait for the run, then answer with the result — or with the id, on time.
     *
     * The 202 on timeout is the contract, not a fallback: a sync caller who
     * waited and did not get an answer holds exactly what an async caller would
     * have held immediately, and every other endpoint works on it.
     */
    private fun respondSync(
        started: RunIngress.Started,
        workspaceId: UUID,
        timeoutMs: Long?,
    ): Response {
        val waiter = syncWaiter ?: SyncRunWaiter(runRepo)
        val requested = timeoutMs?.let { java.time.Duration.ofMillis(it) }

        return when (val outcome = waiter.await(started.runId, workspaceId, requested)) {
            is SyncRunWaiter.Outcome.Finished -> {
                val run = outcome.run
                val succeeded = run.status == "succeeded" || run.status == "completed"
                Response.ok(buildMap {
                    put("runId", run.id.toString())
                    put("status", run.status.uppercase())
                    put("completed", true)
                    put("succeeded", succeeded)
                    put("durationMs", run.durationMs)
                    put("output", decodeJsonColumn(run.outputJson))
                    if (!succeeded) put("error", decodeJsonColumn(run.errorJson))
                })
            }

            is SyncRunWaiter.Outcome.StillRunning -> Response.accepted(buildMap {
                put("runId", started.runId.toString())
                put("status", (outcome.run?.status ?: "queued").uppercase())
                put("completed", false)
                put("waitedMs", outcome.waitedMs)
                // Says what to do next, per the copy rules, rather than leaving a
                // caller who asked for a result holding a bare id.
                put("message",
                    "The run is still going after ${outcome.waitedMs / 1000}s. " +
                        "Poll GET /api/runs/${started.runId}, or stream " +
                        "GET /api/runs/${started.runId}/stream, for the result.")
                started.admitted?.toResponseFields()?.let { putAll(it) }
            })
        }
    }

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
        // Authorize here, so `streamRun` can be called from a path that has
        // already done it without paying for the lookup twice.
        runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")
        streamRun(runId, ctx.workspaceId, emitter)
    }

    /**
     * Relay a run to an open stream, from wherever it has got to.
     *
     * Extracted from [streamEvents] so that starting a run and watching it is
     * the same code as watching one that already exists. Two copies would drift,
     * and the copy that drifts is always the newer one — which here is the one a
     * caller reaches at the moment they most want to see what is happening.
     */
    private fun streamRun(runId: UUID, workspaceId: UUID, emitter: Router.SseEmitter) {
        val run = runRepo.findById(runId, workspaceId) ?: throw ApiError.NotFound("Run")

        // ── Phase 1: send persisted events ───────────────────────────────────
        val existingPage = eventRepo.listByRun(
            runId = runId,
            workspaceId = workspaceId,
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
        /* The end-of-stream signal is the string POISON, not null. It used to be
           `offer(null)`, and LinkedBlockingQueue refuses null with an NPE — thrown
           inside Lettuce's callback ("Unexpected error occurred in
           RedisPubSubListener callback"). The terminal event itself was queued
           first, but the stop signal never was, so the stream stayed open on
           heartbeats until the periodic status re-check noticed the run had ended. */
        val messageQueue = LinkedBlockingQueue<String>()

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
                    messageQueue.offer(POISON)
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
                    msg == POISON -> break
                    else -> {
                        if (!emitter.sendEvent("run_event", msg)) break
                        // If the poison pill follows, we'll pick it up next iteration
                    }
                }

                // Safety: re-check DB status every ~10 heartbeats
                if (heartbeatCounter > 0 && heartbeatCounter % 10 == 0) {
                    val fresh = runRepo.findById(runId, workspaceId)
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
        val finalRun = runCatching { runRepo.findById(runId, workspaceId) }.getOrNull()
        if (finalRun?.status in TERMINAL_STATUSES) {
            emitter.sendEvent("run_complete", """{"status":"${finalRun?.status}","final":true}""")
        }
    }

    private companion object {
        /** End-of-stream marker on the SSE relay queue, which cannot hold null. */
        const val POISON = "__poison__"
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
        audit?.recordUserAction(
            req, ctx.workspaceId, com.vectorbea.api.audit.AuditLog.Action.RUN_CANCEL,
            targetType = "run", targetId = runId, environmentId = run.environmentId,
            before = mapOf("status" to run.status),
            after = mapOf("status" to "cancellation_requested"),
        )
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

        // Replay is a paid feature, gated on the WORKSPACE's plan. Before the
        // quota check below, because "your plan does not include replay" and
        // "you are out of runs" are different answers and the first is the one
        // that is true here.
        //
        // Note what is NOT checked: the monthly run quota. A replay makes no
        // provider calls and `meter_run_usage` refuses to write a row for it, so
        // charging it against a quota would bill a debugging session — which is
        // the same rule the dashboards already apply to replays, and the reason
        // an engineer can investigate a failure without it costing them.
        entitlements?.requireFeature(ctx.workspaceId, com.vectorbea.api.entitlements.EntitlementKeys.REPLAY)

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
        /* Targeted at the ORIGINAL run, because that is the id somebody has in
           front of them when they ask "why did this run twice"; the new run's id
           is in `after`, so the trail leads forward as well as back. */
        audit?.recordUserAction(
            req, ctx.workspaceId, com.vectorbea.api.audit.AuditLog.Action.RUN_RERUN,
            targetType = "run", targetId = runId, environmentId = environmentId,
            before = mapOf("status" to original.status, "workflowId" to original.workflowId.toString()),
            after = mapOf("runId" to newRun.id.toString(), "callsProvider" to true),
        )
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

}

private fun <T, R> Page<T>.mapItems(transform: (T) -> R) =
    Page(items = items.map(transform), total = total, page = page, pageSize = pageSize)
