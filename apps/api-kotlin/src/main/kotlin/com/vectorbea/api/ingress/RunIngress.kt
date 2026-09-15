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
    /**
     * One live run per dedup key.
     *
     * Null disables singleton handling entirely, which is the pre-V068
     * behaviour — kept so a test that builds an ingress by hand does not have to
     * care, and so a deployment mid-migration degrades to "no deduplication"
     * rather than to "every run refused".
     */
    private val dedup: RunDedup? = null,
    /**
     * Delivers a joined input to the run that already holds the key.
     *
     * Injected because signalling lives in the worker's `SignalStore`, which the
     * API shares but the ingress should not reach into directly — a null one
     * makes `join` degrade to `reject` with a message saying so, rather than
     * silently dropping the second alert.
     */
    private val joinSignal: JoinSignalSender? = null,
    /** Per-workspace run-creation rate, as (perMinute, burst). */
    private val rateFor: (UUID) -> Pair<Int, Int> = { DEFAULT_RATE },
) {

    private val log = LoggerFactory.getLogger(RunIngress::class.java)

    companion object {
        /** Generous enough that no legitimate client notices; tight enough to stop a loop. */
        val DEFAULT_RATE = 60 to 120

        /**
         * The highest priority a workspace without the priority-lane entitlement
         * may reach.
         *
         * Below 100 on purpose: an ordinary workspace's Sev1 must outrank ITS OWN
         * batch work — which 99 does — without outranking a workspace that pays
         * for the lane. Priority orders within the platform, and a field any
         * caller can set to the maximum orders nothing.
         */
        const val DEFAULT_PRIORITY_CEILING: Short = 99
    }

    /**
     * Delivers a joined input into a run that already exists.
     *
     * A one-method interface so the ingress does not grow a second copy of
     * signal delivery — the semantics (durable, ordered, deduplicated, delivered
     * at a step boundary) are `SignalStore`'s and belong there.
     */
    fun interface JoinSignalSender {
        /** @return true when the signal was accepted by the live run. */
        fun send(runId: UUID, workspaceId: UUID, environmentId: UUID,
                 name: String, payloadJson: String, dedupeKey: String?): Boolean
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
        /**
         * At most one LIVE run per (workspace, workflow, key).
         *
         * The caller supplies it — an alert's service name, a deploy's commit sha
         * — because only the caller knows what "the same thing" means. What
         * happens on a collision is the WORKFLOW's choice, not theirs.
         */
        val dedupKey: String? = null,
        /**
         * 0–100, or null to take the workflow's default.
         *
         * A Sev1 alert into a workflow whose default is 50. Clamped to the
         * workspace's plan ceiling, so priority cannot be self-granted by a
         * caller who has read the API docs.
         */
        val priority: Short? = null,
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
        /**
         * True when this input was delivered to a run that already held the
         * dedup key, rather than starting a run of its own.
         *
         * The caller gets the LIVE run's id, which is the right answer: their
         * alert is being worked, by that run. Distinguished from
         * [idempotentHit] because the two mean different things — one says "you
         * already asked for this", the other says "something is already on it".
         */
        val joinedExisting: Boolean = false,
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

        /*
         * ── 0. IS SOMETHING ALREADY WORKING ON THIS? ────────────────────
         *
         * BEFORE the idempotency claim, deliberately. They answer different
         * questions — "is this the same request" versus "is something already on
         * this thing" — and the singleton one has to come first, because a
         * `join` does not create a run at all and burning an idempotency key on
         * a request that started nothing would make the caller's own retry look
         * like a duplicate.
         *
         * The check here is ADVISORY. Two alerts for one service in the same
         * second is the normal case, so the authority is the partial unique
         * index, and the losing INSERT below is handled the same way.
         */
        if (request.dedupKey != null && dedup != null) {
            val policy = RunDedup.Policy.of(wf.dedupPolicy)
            val holder = dedup.holderOf(request.workspaceId, wf.id, request.dedupKey)
            if (holder != null) {
                resolveCollision(request, wf, environmentId, policy, holder.runId)
                    ?.let { return it }
            }
        }

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
            return admitAndCreate(request, wf, versionId, environmentId, claimed)
        } catch (e: Throwable) {
            claimed?.let { idempotency?.release(request.workspaceId, it) }
            throw e
        }
    }

    private fun admitAndCreate(
        request: Request,
        workflow: com.vectorbea.api.repository.Workflow,
        versionId: UUID,
        environmentId: UUID,
        claimedKey: String?,
    ): Started {
        val workspaceId = request.workspaceId
        val workflowId = workflow.id

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
        /* Priority weights the fair-queue clock as well as ordering the claim: a
           Sev1 advances its workspace's vclock by a fraction of what a batch run
           does, so it goes to the front repeatedly and cheaply WITHOUT starving
           the work behind it. See `run_priority_weight` in V068. */
        val priority = priorityFor(request, workflow)
        val placement = dataSource
            ?.let { FairOrdering.placeAndAdvance(it, workspaceId, executionClass, priority) }
            ?: FairOrdering.Placement(System.currentTimeMillis() / 1000.0, priority)

        // ── 5. Admission ─────────────────────────────────────────────────────
        val admitted = admission?.admit(workspaceId, executionClass, placement.priority, effective?.plan)

        // ── 6. The run — and the only AUTHORITATIVE dedup check ────────
        /*
         * The lookup in step 0 is advisory and can be beaten. Two alerts for one
         * service in the same second is the NORMAL case, which is precisely when
         * a read-then-write loses, so `agent_runs_dedup_live_unique` is what
         * actually holds the invariant. Its refusal is translated into the same
         * answer step 0 would have given, rather than reaching the caller as a
         * 500 reading `duplicate key value violates unique constraint`.
         */
        val run = try {
            runRepo.create(CreateRunRequest(
                workspaceId = workspaceId,
                environmentId = environmentId,
                workflowId = workflowId,
                workflowVersionId = versionId,
                triggerType = request.source.wire,
                inputJson = request.inputJson,
                idempotencyKey = request.idempotencyKey,
                dedupKey = request.dedupKey,
                /* Copied from the workflow, not asked of the caller: "this
                   workflow executes inside our network" is a property of the
                   work, and a trigger must not be able to move a run out of a
                   customer's perimeter by asking nicely. */
                runnerPoolId = workflow.runnerPoolId,
                debugMode = request.debugMode,
                executionClass = executionClass.wire,
                fairVtime = placement.fairVtime,
                priority = placement.priority,
            ))
        } catch (e: Exception) {
            if (dedup != null && request.dedupKey != null && dedup.isDedupCollision(e)) {
                throw dedup.onCollision(
                    RunDedup.Policy.of(workflow.dedupPolicy),
                    workspaceId, workflowId, request.dedupKey)
            }
            throw e
        }

        claimedKey?.let { idempotency?.complete(workspaceId, it, run.id) }
        attribute(run.id, request.actor)
        usageMeter?.meterRunAdmitted(run.id, effective?.accountId)

        val source = "ingress:${request.source.wire}"
        appendEvent(run.id, workspaceId, environmentId, "RUN_CREATED", "queued", source,
            "Run created", request.reason ?: "Triggered via ${request.source.wire}")
        appendEvent(run.id, workspaceId, environmentId, "RUN_QUEUED", "queued", source,
            "Run queued", "Job placed on workflow queue")

        /*
         * ── 7. Enqueue — UNLESS THE RUN BELONGS TO SOMEBODY ELSE'S NETWORK ──
         *
         * A run pinned to a self-hosted pool is left `queued` in Postgres and
         * put on no stream. Its runner leases it over HTTPS from inside the
         * customer's perimeter (`POST /api/runner/lease`).
         *
         * This is the second of two doors and the easier one to miss.
         * `PostgresClaim` skips pinned runs, but the Redis path never reads
         * `agent_runs` at all — it reads a job off a stream — so enqueueing one
         * would hand it to a platform worker through the side the claim
         * predicate cannot see, and the customer's prompts would execute on our
         * infrastructure with nothing anywhere saying so.
         */
        if (workflow.runnerPoolId != null) {
            appendEvent(run.id, workspaceId, environmentId, "RUN_QUEUED", "queued", source,
                "Waiting for a self-hosted runner",
                "This workflow runs inside your own network. A runner in the pool will pick " +
                    "it up; if nothing does, check that a runner is alive and can reach us.")
            log.info("[ingress] run {} pinned to runner pool {} — not enqueued",
                run.id, workflow.runnerPoolId)
            return Started(
                runId = run.id,
                workflowVersionId = versionId,
                environmentId = environmentId,
                executionClass = executionClass,
                admitted = admitted,
            )
        }

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

        log.info("[ingress] started run={} workflow={} source={} class={} priority={}",
            run.id, workflowId, request.source.wire, executionClass.wire, placement.priority)

        return Started(
            runId = run.id,
            workflowVersionId = versionId,
            environmentId = environmentId,
            executionClass = executionClass,
            admitted = admitted,
        )
    }

    /**
     * Act on a dedup collision, or fall through to starting a run.
     *
     * Returns non-null when the caller's answer is the EXISTING run — which is
     * every case except `supersede`, whose whole point is that a new run follows.
     */
    private fun resolveCollision(
        request: Request,
        wf: com.vectorbea.api.repository.Workflow,
        environmentId: UUID,
        policy: RunDedup.Policy,
        holderId: UUID,
    ): Started? = when (policy) {

        RunDedup.Policy.REJECT -> throw ApiError.Conflict(
            "A run is already working on '${request.dedupKey}' ($holderId). This " +
                "workflow's deduplication policy is `reject`, so no second run was " +
                "started — set it to `join` to deliver this input to that run instead.")

        RunDedup.Policy.JOIN -> {
            /*
             * The second alert becomes more information about the incident
             * already being worked. This is the case the whole feature exists
             * for: an SRE watching one incident channel, not forty.
             */
            val sender = joinSignal ?: throw ApiError.ServiceUnavailable(
                "This workflow deduplicates by joining, but signal delivery is not " +
                    "configured on this deployment, so the input would have been lost.")

            val accepted = try {
                sender.send(
                    runId = holderId,
                    workspaceId = request.workspaceId,
                    environmentId = environmentId,
                    name = wf.dedupJoinSignal,
                    payloadJson = request.inputJson,
                    /* The idempotency key when there is one, so an alerting
                       system retrying a delivery does not signal the run twice
                       with the same alert. */
                    dedupeKey = request.idempotencyKey,
                )
            } catch (e: ApiError) {
                /*
                 * An answer, not a failure. The signal rate limiter refusing a
                 * flood is the one that matters: falling through here would
                 * answer an alert storm by starting a run per alert, which is
                 * the exact failure this feature exists to prevent.
                 */
                throw e
            } catch (e: Exception) {
                log.warn("[ingress] join to {} failed: {}", holderId, e.message)
                false
            }

            if (!accepted) {
                /*
                 * The holder finished, or is terminal, between the lookup and
                 * the send. Falling through to start a fresh run is correct —
                 * the key is free now, and the alert still needs working.
                 */
                log.info("[ingress] join to {} was refused; starting a new run for key '{}'",
                    holderId, request.dedupKey)
                null
            } else {
                log.info("[ingress] joined key '{}' into live run {} as signal '{}'",
                    request.dedupKey, holderId, wf.dedupJoinSignal)
                val existing = runRepo.findById(holderId, request.workspaceId)
                Started(
                    runId = holderId,
                    workflowVersionId = existing?.workflowVersionId ?: wf.currentVersionId!!,
                    environmentId = existing?.environmentId ?: environmentId,
                    executionClass = ExecutionClass.fromWire(
                        runCatching { runRepo.findExecutionClass(holderId) }.getOrNull()),
                    admitted = null,
                    joinedExisting = true,
                )
            }
        }

        RunDedup.Policy.SUPERSEDE -> {
            /*
             * Cancel and continue. `cancellation_requested` rather than a
             * straight terminal write, because the holder may be mid-tick on a
             * worker: that flag is what the worker (and, since T5, the agent
             * loop inside it) checks, and its own terminal transition is what
             * closes its waits, settles its budget and cancels its delegated
             * children.
             *
             * The key is NOT free until it does. So the new run's insert may
             * still lose the index race, and that is handled where every other
             * collision is — the caller is told to retry rather than being given
             * a second live run.
             */
            runCatching { runRepo.updateStatus(holderId, request.workspaceId, "cancellation_requested") }
                .onFailure { log.warn("[ingress] could not supersede {}: {}", holderId, it.message) }
            log.info("[ingress] superseding run {} for key '{}'", holderId, request.dedupKey)
            null
        }
    }

    /**
     * The run's priority: the caller's, the workflow's, or none — clamped.
     *
     * ── CLAMPED TO THE WORKSPACE, SO IT CANNOT BE SELF-GRANTED ──────────
     * A trigger may raise ONE run above the workflow's default — a Sev1 into a
     * workflow whose normal priority is 50 — but never above what the workspace
     * is entitled to. Without the ceiling, "priority" is a field any caller can
     * set to 100, which makes it meaningless within a minute of somebody reading
     * the API documentation.
     */
    private fun priorityFor(request: Request, wf: com.vectorbea.api.repository.Workflow): Short {
        val requested = request.priority ?: wf.defaultPriority
        val ceiling = workspaceCeiling(request.workspaceId)
        return requested.toInt().coerceIn(0, ceiling.toInt()).toShort()
    }

    /**
     * The highest priority this workspace may use.
     *
     * The priority lane is a plan feature, so a workspace without it tops out
     * below it — a Sev1 still preempts that workspace's own batch work, which is
     * the requirement, without preempting a paying tenant's interactive runs.
     */
    private fun workspaceCeiling(workspaceId: UUID): Short = dataSource?.let { ds ->
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement(
                    "SELECT COALESCE(bool_or(priority_lane), false) AS lane " +
                        "FROM workspace_usage_policies WHERE workspace_id = ?"
                ).use { st ->
                    st.setObject(1, workspaceId)
                    st.executeQuery().use { rs ->
                        if (rs.next() && rs.getBoolean("lane")) 100.toShort()
                        else DEFAULT_PRIORITY_CEILING
                    }
                }
            }
        }.getOrDefault(DEFAULT_PRIORITY_CEILING)
    } ?: DEFAULT_PRIORITY_CEILING

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
