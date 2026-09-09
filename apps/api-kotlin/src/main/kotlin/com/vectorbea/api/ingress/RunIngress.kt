package com.vectorbea.api.ingress

import com.vectorbea.api.admission.AdmissionControl
import com.vectorbea.api.entitlements.EntitlementGuard
import com.vectorbea.api.entitlements.UsageMeter
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.queue.ExecutionClass
import com.vectorbea.api.queue.ExecutionClassResolver
import com.vectorbea.api.queue.FairOrdering
import com.vectorbea.api.queue.JobType
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.queue.WorkflowQueueException
import com.vectorbea.api.queue.WorkflowRunJob
import com.vectorbea.api.rate.TokenBucket
import com.vectorbea.api.repository.AppendEventRequest
import com.vectorbea.api.repository.CreateRunRequest
import com.vectorbea.api.repository.RunEventRepository
import com.vectorbea.api.repository.RunRepository
import com.vectorbea.api.repository.WorkflowRepository
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * The one way a run starts.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * There were two run-creation paths and they had already diverged. The API's
 * `RunRoutes.triggerRun` did: rate limit → quota → workspace quota → member
 * spend → admission → create → attribute → meter → events → enqueue.
 * `WorkflowScheduler.fire` did: create → events → enqueue. So a scheduled run
 * skipped every plan check in the product — an account with a spent quota kept
 * running its crons, and nothing metered them.
 *
 * That is not a bug in the scheduler. It is what happens when the admission
 * sequence lives inside a route handler: the second caller cannot reuse it, so
 * it reimplements the parts it remembers. Adding webhook, event and MCP ingress
 * to that shape would have produced five copies and five subsets of the checks.
 *
 * So the sequence moved here, and the routes became adapters that say WHO is
 * asking and WHAT for. Invariant 9's argument, applied to ingress: a new way to
 * start a run is a caller of this, never a second copy of it.
 *
 * ── THE ORDER IS LOAD-BEARING ───────────────────────────────────────────────
 * Each step is cheaper than the next and each answer is more specific than the
 * one after it:
 *
 *   1. IDEMPOTENCY first, so the entire rest of the sequence is inside the
 *      guarded window. The old code recorded the key last, which left quota,
 *      placement and insert unguarded — precisely the slow part a client times
 *      out on and retries into.
 *   2. RATE LIMIT before quota: "you are asking too fast" is a better answer
 *      than "you are out of runs" when both are true, because only one of them
 *      is fixable in the next second.
 *   3. QUOTA before admission, because a plan refusal is about the account and
 *      an admission refusal is about right now — and being told the queue is
 *      busy when the real problem is a spent quota sends somebody to wait.
 *   4. ADMISSION last, because it is the only check whose answer changes between
 *      one millisecond and the next.
 *
 * ── AND EVERY REFUSAL RELEASES THE CLAIM ────────────────────────────────────
 * A run that was refused did not happen, so its idempotency key must be usable
 * again. Otherwise a client refused for quota upgrades their plan, retries with
 * the same key, and is told it is a duplicate of a run that never existed.
 */
class RunIngress(
    private val runRepo: RunRepository,
    private val eventRepo: RunEventRepository,
    private val workflowRepo: WorkflowRepository,
    private val queue: WorkflowQueue?,
    private val dataSource: DataSource?,
    private val idempotency: IdempotencyStore?,
    private val classResolver: ExecutionClassResolver? = null,
    private val admission: AdmissionControl? = null,
    private val rateLimiter: TokenBucket? = null,
    private val entitlements: EntitlementGuard? = null,
    private val usageMeter: UsageMeter? = null,
    /** Per-workspace run-creation rate, as (perMinute, burst). */
    private val rateFor: (UUID) -> Pair<Int, Int> = { DEFAULT_RATE },
) {

    private val log = LoggerFactory.getLogger(RunIngress::class.java)

    companion object {
        /** Generous enough that no legitimate client notices; tight enough to stop a loop. */
        val DEFAULT_RATE = 60 to 120
    }

    /**
     * What a caller wants started.
     *
     * `environmentId` is nullable and resolved from the workflow when absent —
     * a webhook and a schedule know a workflow, not an environment, and making
     * each of them look it up would be three copies of one join.
     */
    data class Request(
        val workspaceId: UUID,
        val workflowId: UUID,
        val environmentId: UUID? = null,
        val inputJson: String = "{}",
        val source: TriggerSource,
        val actor: TriggerActor = TriggerActor(),
        val idempotencyKey: String? = null,
        /** Where the run came from, for the event summary. Written for a person. */
        val reason: String? = null,
        val debugMode: Boolean = false,
    )

    /** A run that exists and is queued. */
    data class Started(
        val runId: UUID,
        val workflowVersionId: UUID,
        val environmentId: UUID,
        val executionClass: ExecutionClass,
        val admitted: AdmissionControl.Admitted?,
        /** True when an existing run was returned instead of a new one being made. */
        val idempotentHit: Boolean = false,
    )

    /**
     * Admit and start, or throw the refusal.
     *
     * Throws rather than returning a result type because every caller's response
     * to a refusal is the same — abandon and report — and [ApiError] already
     * renders each refusal with the right status, message and remedy. A sealed
     * result would make five callers each re-derive that.
     */
    fun start(request: Request): Started {
        val wf = workflowRepo.findById(request.workflowId, request.workspaceId)
            ?: throw ApiError.NotFound("Workflow")
        if (wf.status == "archived") {
            throw ApiError.ValidationError(
                "This workflow is archived, so it cannot be run. Restore it first."
            )
        }
        val versionId = wf.currentVersionId ?: throw ApiError.ValidationError(
            "This workflow has no published version yet. Publish it, then run it."
        )
        val environmentId = request.environmentId ?: wf.environmentId

        // ── 1. Claim the key, before anything that can be retried into ────────
        var claimed: String? = null
        if (request.idempotencyKey != null && idempotency != null) {
            val fingerprint = IdempotencyStore.fingerprint(
                request.workflowId, environmentId, request.inputJson)
            when (val claim = idempotency.claim(
                request.workspaceId, request.idempotencyKey, fingerprint, request.source.wire)) {
                is IdempotencyStore.Claim.AlreadyRan -> {
                    log.info("[ingress] idempotency hit source={} run={}",
                        request.source.wire, claim.runId)
                    val existing = runRepo.findById(claim.runId, request.workspaceId)
                    if (existing != null) {
                        return Started(
                            runId = existing.id,
                            workflowVersionId = existing.workflowVersionId,
                            environmentId = existing.environmentId,
                            /* Read from the row, never re-derived: a run's class is
                               decided once at admission and everything downstream
                               reads the stored answer. */
                            executionClass = ExecutionClass.fromWire(
                                runCatching { runRepo.findExecutionClass(existing.id) }.getOrNull()),
                            admitted = null,
                            idempotentHit = true,
                        )
                    }
                    /* Claimed and attached to a run that has since been deleted —
                       retention, or a purge. Treat the key as free rather than
                       failing: there is nothing to be a duplicate of. */
                    idempotency.release(request.workspaceId, request.idempotencyKey)
                    claimed = request.idempotencyKey
                }
                is IdempotencyStore.Claim.InFlight -> throw ApiError.Conflict(
                    "A run with this idempotency key is being created right now. " +
                        "Retry in a moment to get its id."
                )
                is IdempotencyStore.Claim.Won -> claimed = claim.key
            }
        }

        // From here on, every exit that is not a started run gives the key back.
        try {
            return admitAndCreate(request, wf.id, versionId, environmentId, claimed)
        } catch (e: Throwable) {
            claimed?.let { idempotency?.release(request.workspaceId, it) }
            throw e
        }
    }

    private fun admitAndCreate(
        request: Request,
        workflowId: UUID,
        versionId: UUID,
        environmentId: UUID,
        claimedKey: String?,
    ): Started {
        val workspaceId = request.workspaceId

        // ── 2. Rate limit ────────────────────────────────────────────────────
        rateLimiter?.let { bucket ->
            val (perMinute, burst) = rateFor(workspaceId)
            val verdict = bucket.tryConsume("run-create:$workspaceId", perMinute, burst)
            if (!verdict.allowed) {
                throw ApiError.TooManyRequests(
                    "Too many runs created. You may create ${verdict.refillPerMinute} runs per " +
                        "minute; retry in ${verdict.retryAfterSeconds}s.",
                    mapOf(
                        "limitPerMinute" to verdict.refillPerMinute,
                        "burst" to verdict.burst,
                        "retryAfterSeconds" to verdict.retryAfterSeconds,
                        "retryable" to true,
                    ),
                )
            }
        }

        // ── 3. Plan quota ────────────────────────────────────────────────────
        //
        // Invariant 11: resolved from the WORKSPACE's billing account, never from
        // the caller. A Pro member triggering a run in a Free workspace gets Free
        // limits, and so does their API key, and so does their webhook.
        //
        // THE GRACE MODEL, unchanged from the API path: this is the only place a
        // quota is checked. A run that gets past this line finishes however far
        // past the quota the account travels — killing a run at 90% throws away
        // every provider call already paid for and gives the customer nothing.
        // The NEXT trigger is refused instead, which costs nobody anything.
        val effective = entitlements?.resolve(workspaceId)
        if (effective != null && entitlements != null) {
            entitlements.requireQuota(effective)
            entitlements.requireWorkspaceQuota(effective)
            /* Null for a schedule, a webhook or an event — charged to the
               workspace and to nobody's cap. See TriggerActor. */
            entitlements.requireMemberSpend(effective, request.actor.userId)
        }

        // ── 4. Class and place, before the row exists ────────────────────────
        val executionClass = classResolver?.resolve(versionId) ?: ExecutionClass.SHORT
        val placement = dataSource?.let { FairOrdering.placeAndAdvance(it, workspaceId, executionClass) }
            ?: FairOrdering.Placement(System.currentTimeMillis() / 1000.0, 0)

        // ── 5. Admission ─────────────────────────────────────────────────────
        val admitted = admission?.admit(workspaceId, executionClass, placement.priority, effective?.plan)

        // ── 6. The run ───────────────────────────────────────────────────────
        val run = runRepo.create(CreateRunRequest(
            workspaceId = workspaceId,
            environmentId = environmentId,
            workflowId = workflowId,
            workflowVersionId = versionId,
            triggerType = request.source.wire,
            inputJson = request.inputJson,
            idempotencyKey = request.idempotencyKey,
            debugMode = request.debugMode,
            executionClass = executionClass.wire,
            fairVtime = placement.fairVtime,
            priority = placement.priority,
        ))

        claimedKey?.let { idempotency?.complete(workspaceId, it, run.id) }
        attribute(run.id, request.actor)
        usageMeter?.meterRunAdmitted(run.id, effective?.accountId)

        val source = "ingress:${request.source.wire}"
        appendEvent(run.id, workspaceId, environmentId, "RUN_CREATED", "queued", source,
            "Run created", request.reason ?: "Triggered via ${request.source.wire}")
        appendEvent(run.id, workspaceId, environmentId, "RUN_QUEUED", "queued", source,
            "Run queued", "Job placed on workflow queue")

        // ── 7. Enqueue ───────────────────────────────────────────────────────
        val q = queue ?: run {
            runCatching { runRepo.updateStatus(run.id, workspaceId, "enqueue_failed") }
            throw ApiError.ServiceUnavailable("The run queue is not available.")
        }
        try {
            q.enqueue(WorkflowRunJob(
                runId = run.id.toString(),
                workspaceId = workspaceId.toString(),
                environmentId = environmentId.toString(),
                workflowId = workflowId.toString(),
                workflowVersionId = versionId.toString(),
                jobType = JobType.START_RUN,
                inputJson = request.inputJson,
                reason = request.source.wire,
                requestedByUserId = request.actor.userId?.toString(),
                executionClass = executionClass,
            ))
        } catch (e: WorkflowQueueException) {
            /* The row exists and nothing will ever claim it. `enqueue_failed` is a
               distinct terminal state rather than `failed`, because the workflow
               did not fail — the platform did, and a retry is free. */
            log.error("[ingress] enqueue failed run={} source={}: {}",
                run.id, request.source.wire, e.message)
            runCatching { runRepo.updateStatus(run.id, workspaceId, "enqueue_failed") }
            throw ApiError.ServiceUnavailable("Failed to enqueue the run: the queue is unavailable.")
        }

        log.info("[ingress] started run={} workflow={} source={} class={}",
            run.id, workflowId, request.source.wire, executionClass.wire)

        return Started(
            runId = run.id,
            workflowVersionId = versionId,
            environmentId = environmentId,
            executionClass = executionClass,
            admitted = admitted,
        )
    }

    /**
     * Record who is accountable, and what produced the run.
     *
     * Written after the insert rather than passed into `create`, so attribution
     * cannot change the run-creation contract the worker and the resume path both
     * depend on. A failure here loses one run's attribution; it must never lose
     * the run.
     */
    private fun attribute(runId: UUID, actor: TriggerActor) {
        val ds = dataSource ?: return
        if (actor.userId == null && actor.apiKeyId == null && actor.triggerRef == null) return
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement(
                    "UPDATE agent_runs SET triggered_by_user_id = ?, triggered_by_api_key_id = ?, " +
                        "trigger_ref = ? WHERE id = ?"
                ).use { st ->
                    st.setObject(1, actor.userId)
                    st.setObject(2, actor.apiKeyId)
                    st.setObject(3, actor.triggerRef)
                    st.setObject(4, runId)
                    st.executeUpdate()
                }
            }
        }.onFailure { log.warn("[ingress] attribution failed for run {}: {}", runId, it.message) }
    }

    private fun appendEvent(
        runId: UUID, workspaceId: UUID, environmentId: UUID,
        type: String, status: String, source: String, title: String, summary: String,
    ) {
        runCatching {
            eventRepo.append(AppendEventRequest(
                runId, workspaceId, environmentId, type, status, source, title, summary))
        }.onFailure { log.warn("[ingress] event {} failed for run {}: {}", type, runId, it.message) }
    }
}
