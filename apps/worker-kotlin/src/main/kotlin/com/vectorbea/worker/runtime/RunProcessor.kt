package com.vectorbea.worker.runtime

import com.vectorbea.worker.durable.RunLeaseManager
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.heartbeat.WorkerHeartbeat
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.observability.MdcKeys
import com.vectorbea.worker.observability.mdcClearAll
import com.vectorbea.worker.queue.WorkflowRunJob
import com.vectorbea.worker.recovery.WorkerRecoveryService
import com.vectorbea.worker.runtime.checkpoint.CheckpointStore
import com.vectorbea.worker.telemetry.TelemetryClient
import com.vectorbea.graph.WorkflowGraph
import org.slf4j.MDC
import java.sql.PreparedStatement
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import javax.sql.DataSource

/**
 * Processes a [WorkflowRunJob] claimed from the Redis Stream.
 *
 * Delegates to [WorkflowRuntime] for actual DAG execution.
 *
 * SECURITY:
 *   - inputJson is treated as untrusted and NOT logged.
 *   - Error messages stored to run_events are sanitized (no stack traces,
 *     no connection strings, no API keys).
 *   - Worker ID / job metadata are safe to log.
 */
class RunProcessor(
    private val dataSource: DataSource,
    private val eventStore: RunEventStore,
    private val heartbeat: WorkerHeartbeat,
    private val workerId: String,
    private val runtime: WorkflowRuntime,
    private val checkpointStore: CheckpointStore = CheckpointStore(dataSource),
    private val recoveryService: WorkerRecoveryService? = try { WorkerRecoveryService(dataSource) } catch (_: Exception) { null },
    private val telemetry: TelemetryClient? = null,
    /**
     * Wakes a dispatched child's parent when the child reaches a terminal state.
     *
     * Null where dispatch is not wired, in which case nothing has a parent and
     * there is nothing to wake.
     */
    private val childDispatcher: com.vectorbea.worker.agents.orchestration.ChildRunDispatcher? = null,
    private val leaseManager: RunLeaseManager = RunLeaseManager(dataSource),
    /**
     * Durably re-enqueue a continuation job after a cooperative yield. Default is
     * a no-op (safe for tests); production wires this to a Redis XADD so the
     * RESUME_RUN survives a worker crash. If this fails, crash-recovery backstops
     * the orphaned 'yielded' run.
     */
    private val reEnqueue: (WorkflowRunJob) -> Unit = {},
    /**
     * Enforces per-tenant limits at lease-claim time. Null in tests that do not
     * exercise fairness; production always supplies it.
     */
    private val tenantAdmission: com.vectorbea.worker.fairness.SharedTenantAdmission? = null,
    /** Reads a run's stored execution class for the claim-time class check. */
    private val runClassLookup: com.vectorbea.worker.queue.RunClassLookup? = null,
    /** Poison-job protection. Null in tests that do not exercise it. */
    private val deadLetters: com.vectorbea.worker.durable.DeadLetterStore? = null,
    /**
     * Durable timers, for suspending a run across a provider's rate-limit backoff.
     *
     * A supplier rather than the instance: the scheduler needs a way to enqueue
     * system jobs, which needs the consumers, which need this processor. Deferring
     * the lookup to call time breaks that cycle without anyone holding a
     * half-built object.
     *
     * Returning null falls back to leaving the run `yielded` for crash recovery to
     * pick up — correct but slower, so production always supplies it.
     */
    private val timerScheduler: () -> com.vectorbea.worker.durable.TimerScheduler? = { null },
    /**
     * Builds a runtime wired for replay against a given recording.
     *
     * A factory rather than a second injected runtime: the replay context is per
     * run — it holds that run's cursors — so a shared instance would let two
     * concurrent replays consume each other's recorded responses. Null disables
     * replay, and a run marked `replay` then fails closed rather than executing
     * live, which is the safe direction.
     */
    private val replayRuntimeFactory: ((com.vectorbea.worker.replay.ReplayContext) -> WorkflowRuntime)? = null,
    /**
     * Trace span writer, needed here only to flush before root-cause attribution.
     * Null disables both.
     */
    private val spanWriter: com.vectorbea.worker.events.SpanWriter? = null,
    /** Computes is_root_cause once, at terminalisation. Null disables attribution. */
    private val rootCause: com.vectorbea.worker.events.RootCauseAttribution? = null,
    /**
     * Ships the finished trace to the workspace's own OTLP endpoint. §9.
     *
     * Null disables it, which is the shape every test uses and the shape of any
     * deployment with OTEL_TRACE_EXPORT_ENABLED unset.
     */
    private val traceExporter: com.vectorbea.worker.events.otel.RunTraceExporter? = null,
) {

    /**
     * The runtime to execute this run with.
     *
     * A run whose row says `replay` must never reach a provider. If the factory is
     * absent we refuse rather than silently falling back to the live runtime —
     * executing live under a replay label is the original bug, and it must not be
     * reachable by misconfiguration either.
     */
    private fun runtimeFor(run: RunRow): WorkflowRuntime {
        if (run.executionModeKind != "replay") return runtime
        val source = run.sourceRunId
            ?: error("Run ${run.id} is marked replay but has no source_run_id")
        val factory = replayRuntimeFactory
            ?: error("Run ${run.id} is a replay but no replay runtime is configured — " +
                "refusing to execute live under a replay label")
        return factory(com.vectorbea.worker.replay.ReplayContext(
            dataSource = dataSource,
            sourceRunId = source,
            replayUntilNode = run.replayUntilNode,
        ))
    }

    /**
     * Export the finished trace, if a workspace asked for it.
     *
     * The workspace id is read here rather than threaded down, because this runs
     * once per terminal run and the row is already hot from the update above.
     */
    private fun exportTrace(runId: java.util.UUID) {
        val exporter = traceExporter ?: return
        val workspaceId = runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement("SELECT workspace_id FROM agent_runs WHERE id = ?").use { st ->
                    st.setObject(1, runId)
                    st.executeQuery().use { rs ->
                        if (rs.next()) rs.getObject(1) as java.util.UUID else null
                    }
                }
            }
        }.getOrNull() ?: return
        exporter.exportAsync(runId, workspaceId)
    }

    /** The run's class, for per-class limit checks at claim time. */
    private fun executionClassOf(workspaceId: java.util.UUID, runId: java.util.UUID) =
        runClassLookup?.classOf(runId) ?: com.vectorbea.worker.queue.WorkerJobType.SHORT
    private val log = logger()

    companion object {
        /**
         * `triggeredBy` on a job the Postgres claim produced.
         *
         * The one place downstream code needs to know which transport delivered a
         * run — admission is folded into the claim, so re-checking it is both
         * redundant and, in claim mode, unrunnable.
         */
        const val PG_CLAIM_SOURCE = "pg-claim"

        /**
         * Lease heartbeat interval. Fixed rather than derived from the TTL so the
         * margin does not silently shrink if someone lowers
         * WORKER_LEASE_TTL_SECONDS.
         */
        private val LEASE_HEARTBEAT_MS =
            System.getenv("LEASE_HEARTBEAT_MS")?.toLongOrNull() ?: 10_000L
    }

    /**
     * Cancellation handles for in-flight runs, so a lost lease can stop the work
     * immediately instead of waiting for it to finish and be fenced at the write.
     */
    private val runCancellation = java.util.concurrent.ConcurrentHashMap<UUID, kotlinx.coroutines.Job>()

    /** Shared scheduler for periodic lease renewal — one tick per in-flight run. */
    private val leaseRenewer = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "lease-renewer").also { it.isDaemon = true }
    }

    /**
     * Entry point — called from the consumer thread pool for each job.
     * Must not throw; all exceptions are caught and turned into RUN_FAILED events.
     */
    suspend fun process(job: WorkflowRunJob) {
        // Rejoin the trace the API started.
        //
        // The parent context comes out of the job payload rather than from anything
        // ambient, because the enqueuing request finished long ago in a different
        // process. Parent-child rather than a span link: the claim genuinely IS caused
        // by the enqueue and belongs in the same trace. Links are for fan-in.
        //
        // When the job carries no traceparent — tracing off, or a job enqueued before
        // the field existed — `extractContext` returns null and this becomes a new root
        // span rather than a failure.
        val parent = com.vectorbea.observability.tracing.Tracing.extractContext(job.traceCarrier())
        com.vectorbea.observability.tracing.Tracing.spanSuspending(
            name = "run.${job.jobType.name.lowercase()}",
            kind = io.opentelemetry.api.trace.SpanKind.CONSUMER,
            attributes = mapOf(
                "vectorbea.run_id" to job.runId.toString(),
                "vectorbea.workflow_id" to job.workflowId.toString(),
                "vectorbea.job_type" to job.jobType.name,
                "vectorbea.worker_id" to workerId,
            ),
            parent = parent,
        ) { processInSpan(job) }
    }

    private suspend fun processInSpan(job: WorkflowRunJob) {
        heartbeat.taskStarted()
        WorkerMetrics.activeTasks.inc(workerId)
        WorkerMetrics.runsQueued.inc()
        val start = Instant.now()

        // ── Set MDC for the duration of this job ──────────────────────────────
        MDC.put(MdcKeys.SERVICE, "worker")
        MDC.put(MdcKeys.WORKER_ID, workerId)
        MDC.put(MdcKeys.RUN_ID, job.runId.toString())
        MDC.put(MdcKeys.JOB_TYPE, job.jobType.name)
        job.streamMessageId?.let { MDC.put(MdcKeys.CORRELATION_ID, it) }

        log.info("[processor] claimed job [type={}, runId={}, retry={}]",
            job.jobType, job.runId, job.retryCount)

        // ── Run lease: exclusive execution ownership ──────────────────────────
        // Acquire BEFORE any status transition so a redelivered/duplicate job
        // for a run another worker is actively executing is dropped here.
        // If we can't determine the workspace (run missing), skip the lease and
        // let the handler log the missing run.
        val leaseRun = runCatching { loadRun(job.runId) }.getOrNull()
        var lease: RunLeaseManager.Lease? = null
        var renewal: ScheduledFuture<*>? = null
        if (leaseRun != null) {
            val acquired = leaseManager.acquire(job.runId, leaseRun.workspaceId, workerId)
            if (acquired == null) {
                log.warn("[processor] lease held by another worker — skipping job [runId={}, type={}]",
                    job.runId, job.jobType)
                WorkerMetrics.activeTasks.dec(workerId)
                heartbeat.taskFinished()
                mdcClearAll()
                return
            }
            // ── The hard per-tenant gate ──────────────────────────────────
            // Admission at poll time is advisory: it reads a short-TTL cache of
            // shared state, so several replicas can admit against the same stale
            // view. Measured, that was worth 2xN concurrency — the original
            // multiply-by-replicas bug, intact.
            //
            // The lease row is where the shared state actually changes, so this
            // is where the limit is enforced. We now hold a lease; if older
            // leases for this workspace already fill its quota, we are the excess
            // one, and we release rather than run. Ordering by (created_at,
            // run_id) means the first N acquirers always win and no two replicas
            // can both decide to yield.
            //
            // Skipped entirely for jobs that arrived via the Postgres claim. The
            // claim's `tenant_load` CTE applies the identical limits inside the
            // same `FOR UPDATE SKIP LOCKED` statement that takes the row, so a
            // claimed run has already passed this check — atomically, rather than
            // against a cache. Re-running it here would be a second round trip to
            // reach the same answer, and its refusal path re-enqueues onto a Redis
            // stream that claim mode does not have.
            val admitted = if (job.triggeredBy == PG_CLAIM_SOURCE) true else
                tenantAdmission?.admitAtClaim(
                    workspaceId = leaseRun.workspaceId,
                    runId = job.runId,
                    type = executionClassOf(leaseRun.workspaceId, job.runId),
                ) ?: true
            if (!admitted) {
                leaseManager.release(job.runId, workerId)
                // Re-enqueue rather than park.
                //
                // Leaving the message unacked would be correct but slow: with
                // typed streams a worker only reads what it can start, so nothing
                // re-reads a parked message until the XAUTOCLAIM idle threshold
                // (60 s). Measured, that turned every refused claim into a
                // minute-long stall and collapsed throughput as replicas were
                // added — limits held, but the platform crawled.
                //
                // A fresh XADD puts the run at the tail of its own class stream,
                // where it is retried in seconds. The run row stays 'queued' and
                // the original message is acked by the caller, so exactly one
                // copy remains outstanding.
                runCatching { reEnqueue(job) }.onFailure {
                    log.warn("[processor] re-enqueue after claim refusal failed [runId={}]: {}",
                        job.runId, it.message)
                }
                log.debug("[processor] over per-tenant limit at claim — released lease, re-queued " +
                    "[runId={}, ws={}]", job.runId, leaseRun.workspaceId)
                WorkerMetrics.activeTasks.dec(workerId)
                heartbeat.taskFinished()
                mdcClearAll()
                return
            }

            // ── Poison-job protection ─────────────────────────────────────────
            //
            // Counted at CLAIM, before execution, which is the whole point: a job
            // that has already killed four workers must not be given a fifth. A
            // job that crashes the process never reaches any post-execution
            // bookkeeping, so counting afterwards would never fire.
            val attempts = deadLetters?.recordDelivery(job.runId)
            if (deadLetters != null && deadLetters.isExhausted(attempts)) {
                deadLetters.deadLetter(
                    job = job,
                    attempts = attempts ?: deadLetters.maxAttempts + 1,
                    reason = "max_delivery_attempts_exceeded",
                    lastError = "Exceeded ${deadLetters.maxAttempts} delivery attempts — " +
                        "likely a poison job that crashes its worker before completing.",
                )
                leaseManager.release(job.runId, workerId)
                WorkerMetrics.activeTasks.dec(workerId)
                heartbeat.taskFinished()
                mdcClearAll()
                return
            }

            lease = acquired

            // ── Lease heartbeat ───────────────────────────────────────────────
            //
            // Fixed 10s, not TTL/3. A step that outlives its lease gets stolen
            // mid-flight, and the old TTL/3 schedule (20s at a 60s TTL) left only
            // three beats of margin — one GC pause or one slow query and the
            // lease is gone while the step is still running.
            //
            // The important half is what happens when extension FAILS. Zero rows
            // updated means the lease was reassigned: another worker is now
            // legitimately executing this run. Continuing would be two workers
            // running the same run, so the coroutine is cancelled immediately
            // rather than allowed to finish and write.
            val heartbeatScope = job
            renewal = leaseRenewer.scheduleWithFixedDelay({
                val ok = leaseManager.renew(job.runId, workerId, acquired.token)
                if (!ok) {
                    WorkerMetrics.leaseExpiryTotal.inc("renew_failed")
                    WorkerMetrics.leaseStolenTotal.inc()
                    log.warn("[processor] LEASE LOST mid-flight [runId={}] — another worker has taken " +
                        "over. Cancelling this execution so the run is not executed twice.",
                        heartbeatScope.runId)
                    // Cancelling the job's scope unwinds the suspended execution
                    // at its next suspension point. Any write it attempts after
                    // this is fenced anyway (see Fence), so this is defence in
                    // depth rather than the only guard.
                    runCancellation[job.runId]?.cancel(
                        java.util.concurrent.CancellationException("lease reassigned"))
                }
            }, LEASE_HEARTBEAT_MS, LEASE_HEARTBEAT_MS, TimeUnit.MILLISECONDS)
        }

        // Publish this coroutine's Job so the lease heartbeat can cancel it the
        // moment the lease is reassigned.
        kotlinx.coroutines.currentCoroutineContext()[kotlinx.coroutines.Job]?.let {
            runCancellation[job.runId] = it
        }

        try {
            when (job.jobType) {
                WorkflowRunJob.JobType.START_RUN  -> processStartRun(job, start)
                WorkflowRunJob.JobType.RESUME_RUN -> processResumeRun(job, start)
                WorkflowRunJob.JobType.RETRY_NODE -> processRetryNode(job, start)
                WorkflowRunJob.JobType.REPLAY_RUN -> processReplayRun(job, start)
                WorkflowRunJob.JobType.UNKNOWN    -> {
                    log.warn("[processor] unknown job type — marking failed [runId={}]", job.runId)
                    markRunFailed(job, "Unknown job type: ${job.jobType}", start)
                }
            }
        } catch (e: Exception) {
            val durationMs = Instant.now().toEpochMilli() - start.toEpochMilli()
            log.error("[processor] unhandled error processing job [runId={}] after {}ms",
                job.runId, durationMs, e)
            runCatching { markRunFailed(job, sanitizeError(e), start) }
        } finally {
            runCancellation.remove(job.runId)
            renewal?.cancel(false)
            if (lease != null) leaseManager.release(job.runId, workerId)
            eventStore.forgetRun(job.runId)
            WorkerMetrics.activeTasks.dec(workerId)
            heartbeat.taskFinished()
            mdcClearAll()
        }
    }

    /**
     * Record XADD → RUN_STARTED, the latency the user actually feels.
     *
     * No extra field is needed on the message: a Redis Stream ID is
     * `<millisecondsSinceEpoch>-<sequence>`, assigned by Redis at XADD. Parsing
     * the left half gives the enqueue instant exactly, for free, and for every
     * message ever written to the stream — including ones enqueued before this
     * metric existed.
     *
     * Synthesized jobs (crash recovery, timers) carry no stream ID and are
     * skipped: their "wait" is a scheduling decision, not queue latency, and
     * mixing them in would flatter the percentiles.
     */
    private fun recordWaitBeforeStart(job: WorkflowRunJob) {
        val msgId = job.streamMessageId ?: return
        val enqueuedMs = msgId.substringBefore('-').toLongOrNull() ?: return
        val waitedMs = System.currentTimeMillis() - enqueuedMs
        // Guard against clock skew between the Redis host and this worker.
        if (waitedMs < 0 || waitedMs > TimeUnit.HOURS.toMillis(24)) return
        WorkerMetrics.jobWaitBeforeStartSeconds.observeMs(waitedMs, job.jobType.name.lowercase())
    }

    // ── Job type handlers ─────────────────────────────────────────────────────

    private suspend fun processStartRun(job: WorkflowRunJob, start: Instant) {
        // 1. Load the run to get workspace/environment context
        val run = loadRun(job.runId)
            ?: run {
                log.error("[processor] run not found in DB [runId={}] — XACK will still happen",
                    job.runId)
                return
            }

        // 1b. SECURITY: verify job workspace matches run workspace
        if (!verifyWorkspaceMatch(job, run)) return

        // 1c. BETA GATE: re-check workspace controls before any execution.
        // This ensures a workspace disabled AFTER the job was queued cannot execute.
        val byokRequired = System.getenv("BYOK_REQUIRED_FOR_REAL_EXECUTION")?.lowercase() != "false"
        val allowPlatformLlm = System.getenv("ALLOW_PLATFORM_LLM_FOR_WORKFLOW_EXECUTION")?.lowercase() == "true"
        try {
            val controlsResult = dataSource.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT access_status, real_execution_enabled, simulation_enabled FROM workspace_beta_controls WHERE workspace_id = ?"
                ).use { stmt ->
                    stmt.setObject(1, run.workspaceId)
                    val rs = stmt.executeQuery()
                    if (rs.next()) Triple(rs.getString("access_status"), rs.getBoolean("real_execution_enabled"), rs.getBoolean("simulation_enabled"))
                    else null
                }
            }
            if (controlsResult != null) {
                val (accessStatus, realEnabled, simEnabled) = controlsResult
                if (accessStatus == "disabled") {
                    log.warn("[processor] workspace {} is DISABLED — aborting run {}", run.workspaceId, job.runId)
                    markRunFailed(job, "WORKSPACE_DISABLED: This workspace has been disabled.", start)
                    return
                }
                // For real-execution runs, re-verify permission hasn't been revoked
                if (!realEnabled && !simEnabled) {
                    log.warn("[processor] workspace {} has execution disabled — aborting run {}", run.workspaceId, job.runId)
                    markRunFailed(job, "EXECUTION_DISABLED: Execution has been disabled for this workspace.", start)
                    return
                }
            }
        } catch (e: Exception) {
            // Fail closed: if we can't check controls, abort to prevent unauthorized execution
            log.error("[processor] failed to check workspace beta controls for run {} — aborting: {}", job.runId, e.message)
            markRunFailed(job, "SECURITY_CHECK_FAILED: Could not verify workspace execution permission.", start)
            return
        }

        // 2. Transition: queued|claimed → running. The CAS is authoritative: if it
        // fails, the run was already taken (duplicate/redelivered message) or
        // reached a terminal state. Executing anyway would double-run side
        // effects — bail out.
        //
        // `claimed` is accepted because that is the state the Postgres claim left
        // the row in, milliseconds earlier and in the same `FOR UPDATE SKIP
        // LOCKED` statement that made it ours. It is not a weaker check: only one
        // worker can move a row `queued → claimed`, so `claimed` here means "this
        // worker holds it", and the CAS still rejects every terminal state and
        // every run another worker has already started.
        val updated = updateRunStatus(
            runId      = job.runId,
            status     = "running",
            startedAt  = start,
            workerId   = workerId,
            fromStatuses = listOf("queued", "claimed"),
        )
        if (!updated) {
            log.warn("[processor] START_RUN skipped — run not in 'queued' or 'claimed' state " +
                "(current={}) [runId={}]. Likely a duplicate or redelivered message.",
                loadRun(job.runId)?.status, job.runId)
            return
        }

        // 3. Emit RUN_STARTED
        recordWaitBeforeStart(job)
        eventStore.appendEvent(RunEvent(
            runId = job.runId,
            workspaceId = run.workspaceId,
            environmentId = run.environmentId,
            type = EventType.RUN_STARTED,
            status = "running",
            source = "worker:$workerId",
            title = "Run started",
            summary = "Worker $workerId began executing the run",
            correlationId = job.streamMessageId,
        ))

        // ── Load workflow graph ───────────────────────────────────────────────
        val graphJson = loadWorkflowGraphJson(run.workflowVersionId)
        if (graphJson == null) {
            log.error("[processor] no graph_json for workflowVersionId={} [runId={}]",
                run.workflowVersionId, job.runId)
            markRunFailed(job, "Workflow version has no graph defined", start)
            return
        }

        val graph = try {
            WorkflowGraph.parse(graphJson)
        } catch (e: Exception) {
            log.error("[processor] failed to parse graph_json [runId={}]: {}", job.runId, e.message)
            markRunFailed(job, "Failed to parse workflow graph: ${e.message?.take(200)}", start)
            return
        }

        log.info("[processor] executing workflow graph [runId={}, nodes={}, edges={}]",
            job.runId, graph.nodes.size, graph.edges.size)

        // The Ribbon's denominator, set once the graph is known. Without it the
        // Runs page shows "3 of 3 committed" for a run that failed at node 3 of 12
        // — technically true of what it observed, and the opposite of what the
        // reader needs to know.
        runCatching {
            dataSource.connection.use {
                RibbonWriter.setNodeTotal(it, job.runId, graph.nodes.size)
            }
        }

        // ── Execute via WorkflowRuntime ────────────────────────────────────
        val execResult = runtimeFor(run).execute(
            runId             = job.runId,
            workspaceId       = run.workspaceId,
            environmentId     = run.environmentId,
            workflowVersionId = run.workflowVersionId,
            graph             = graph,
            inputJson         = effectiveInput(run, job),
            source            = "worker:$workerId",
            cancellationCheck = { isCancellationRequested(job.runId) },
            debugMode         = job.debugMode,
            workflowId        = run.workflowId,
        )

        val durationMs = Instant.now().toEpochMilli() - start.toEpochMilli()
        handleExecResult(job, run, execResult, start, durationMs)
        log.info("[processor] job complete [runId={}, durationMs={}]", job.runId, durationMs)
    }

    /**
     * Resume a paused run from its latest (or specified) checkpoint.
     *
     * Typical trigger: an APPROVAL node was approved or rejected via the API.
     * The approval node is placed back in PENDING state so [ApprovalNodeExecutor]
     * re-runs and reads the decision from the DB (APPROVED → Completed, REJECTED → Failed).
     */
    private suspend fun processResumeRun(job: WorkflowRunJob, start: Instant) {
        val run = loadRun(job.runId) ?: run {
            log.error("[processor] RESUME_RUN — run not found [runId={}]", job.runId)
            return
        }
        if (!verifyWorkspaceMatch(job, run)) return

        // Load the checkpoint to resume from
        val snapshot = if (job.checkpointId != null) {
            checkpointStore.loadById(job.checkpointId, run.workspaceId)
        } else {
            checkpointStore.loadLatest(job.runId, run.workspaceId)
        }

        if (snapshot == null) {
            log.error("[processor] RESUME_RUN — no checkpoint found [runId={}]", job.runId)
            markRunFailed(job, "Cannot resume: no checkpoint found for run", start)
            return
        }

        // Transition → running from any resumable state. The CAS is authoritative:
        // if the run is already 'running' another worker owns it; if terminal, the
        // resume is stale. Either way, executing would duplicate side effects.
        val resumed = updateRunStatus(
            runId        = job.runId,
            status       = "running",
            startedAt    = start,
            workerId     = workerId,
            fromStatuses = listOf("waiting_for_approval", "recovering", "waiting_for_timer", "yielded", "queued"),
        )
        if (!resumed) {
            log.warn("[processor] RESUME_RUN skipped — run not in a resumable state (current={}) [runId={}]",
                loadRun(job.runId)?.status, job.runId)
            return
        }

        eventStore.appendEvent(RunEvent(
            runId         = job.runId,
            workspaceId   = run.workspaceId,
            environmentId = run.environmentId,
            /* A resume is not a retry — see EventType.RUN_RESUMED. */
            type          = EventType.RUN_RESUMED,
            status        = "running",
            source        = "worker:$workerId",
            title         = "Run resumed from checkpoint",
            summary       = "Resuming from checkpoint sequence ${snapshot.sequence}" +
                            /* The API sends `reason` and the worker parses it into
                               triggeredBy — "approval", "timer". Worth naming: it is the
                               difference between "someone approved it" and "a timer
                               fired" on an otherwise identical line. */
                            job.triggeredBy.takeIf { it.isNotBlank() && it != "unknown" }
                                ?.let { " (resumed by: $it)" }.orEmpty(),
            retryAttempt  = job.retryCount,
            correlationId = job.streamMessageId,
        ))

        val graphJson = loadWorkflowGraphJson(run.workflowVersionId)
        if (graphJson == null) {
            markRunFailed(job, "No workflow graph found for resume", start)
            return
        }
        val graph = try {
            WorkflowGraph.parse(graphJson)
        } catch (e: Exception) {
            markRunFailed(job, "Failed to parse workflow graph on resume: ${e.message?.take(200)}", start)
            return
        }

        // The node to resume at (e.g. the approval node) is placed back to PENDING
        // so its executor re-reads the approval decision from DB.
        val pendingOverrides = if (job.nodeId != null) setOf(job.nodeId) else emptySet()

        val execResult = runtimeFor(run).resume(
            runId             = job.runId,
            workspaceId       = run.workspaceId,
            environmentId     = run.environmentId,
            workflowVersionId = run.workflowVersionId,
            graph             = graph,
            inputJson         = effectiveInput(run, job),
            snapshot          = snapshot,
            pendingNodeIds    = pendingOverrides,
            source            = "worker:$workerId",
            cancellationCheck = { isCancellationRequested(job.runId) },
            debugMode         = job.debugMode,
            workflowId        = run.workflowId,
            /* A RESUME_RUN is the same logical execution continuing — after an
               approval, a timer, a yield, or a crash-recovery re-enqueue. An agent
               step in it may rebuild its loop from what it already did rather than
               replaying, and paying for, every LLM call a second time. */
            allowLoopReconstruction = true,
        )

        val durationMs = Instant.now().toEpochMilli() - start.toEpochMilli()
        handleExecResult(job, run, execResult, start, durationMs)
        log.info("[processor] RESUME_RUN complete [runId={}, durationMs={}]", job.runId, durationMs)
    }

    /**
     * Retry a single failed node within an existing run.
     *
     * Loads the latest checkpoint, resets the target node to PENDING, and
     * resumes the DAG. Other completed nodes are not re-executed.
     */
    private suspend fun processRetryNode(job: WorkflowRunJob, start: Instant) {
        val run = loadRun(job.runId) ?: run {
            log.error("[processor] RETRY_NODE — run not found [runId={}]", job.runId)
            return
        }
        if (!verifyWorkspaceMatch(job, run)) return

        val nodeId = job.nodeId
        if (nodeId == null) {
            log.error("[processor] RETRY_NODE — missing nodeId [runId={}]", job.runId)
            markRunFailed(job, "RETRY_NODE requires a nodeId", start)
            return
        }

        val snapshot = checkpointStore.loadLatest(job.runId, run.workspaceId)
        if (snapshot == null) {
            log.error("[processor] RETRY_NODE — no checkpoint found [runId={}]", job.runId)
            markRunFailed(job, "Cannot retry node: no checkpoint found", start)
            return
        }

        val claimed = updateRunStatus(
            runId      = job.runId,
            status     = "running",
            startedAt  = start,
            workerId   = workerId,
            fromStatus = run.status,
        )
        if (!claimed) {
            log.warn("[processor] RETRY_NODE skipped — run status changed concurrently (expected={}, current={}) [runId={}]",
                run.status, loadRun(job.runId)?.status, job.runId)
            return
        }

        eventStore.appendEvent(RunEvent(
            runId         = job.runId,
            workspaceId   = run.workspaceId,
            environmentId = run.environmentId,
            type          = EventType.RETRY_STARTED,
            status        = "running",
            source        = "worker:$workerId",
            title         = "Retrying node: $nodeId",
            summary       = "Retry attempt ${job.retryCount + 1} for node $nodeId",
            stepId        = nodeId,
            retryAttempt  = job.retryCount + 1,
            correlationId = job.streamMessageId,
        ))

        val graphJson = loadWorkflowGraphJson(run.workflowVersionId)
        if (graphJson == null) {
            markRunFailed(job, "No workflow graph found for retry", start)
            return
        }
        val graph = try {
            WorkflowGraph.parse(graphJson)
        } catch (e: Exception) {
            markRunFailed(job, "Failed to parse workflow graph on retry: ${e.message?.take(200)}", start)
            return
        }

        val execResult = runtimeFor(run).resume(
            runId             = job.runId,
            workspaceId       = run.workspaceId,
            environmentId     = run.environmentId,
            workflowVersionId = run.workflowVersionId,
            graph             = graph,
            inputJson         = effectiveInput(run, job),
            snapshot          = snapshot,
            pendingNodeIds    = setOf(nodeId),
            source            = "worker:$workerId",
            cancellationCheck = { isCancellationRequested(job.runId) },
            debugMode         = job.debugMode,
            workflowId        = run.workflowId,
            /* Explicit, though false is the default: somebody asked for this node to
               run AGAIN. Reconstructing its previous loop would hand them the
               previous answer, which is the opposite of a retry. */
            allowLoopReconstruction = false,
        )

        val durationMs = Instant.now().toEpochMilli() - start.toEpochMilli()
        handleExecResult(job, run, execResult, start, durationMs)
        log.info("[processor] RETRY_NODE complete [runId={}, nodeId={}, durationMs={}]",
            job.runId, nodeId, durationMs)
    }

    /**
     * Replay a run from scratch (full re-execution with the same graph and input).
     *
     * No checkpoint is consulted — the run starts clean from the trigger node.
     * The existing run row is reused (status reset to running).
     */
    private suspend fun processReplayRun(job: WorkflowRunJob, start: Instant) {
        val run = loadRun(job.runId) ?: run {
            log.error("[processor] REPLAY_RUN — run not found [runId={}]", job.runId)
            return
        }
        if (!verifyWorkspaceMatch(job, run)) return

        val claimed = updateRunStatus(
            runId      = job.runId,
            status     = "running",
            startedAt  = start,
            workerId   = workerId,
            fromStatus = run.status,
        )
        if (!claimed) {
            log.warn("[processor] REPLAY_RUN skipped — run status changed concurrently (expected={}, current={}) [runId={}]",
                run.status, loadRun(job.runId)?.status, job.runId)
            return
        }

        eventStore.appendEvent(RunEvent(
            runId         = job.runId,
            workspaceId   = run.workspaceId,
            environmentId = run.environmentId,
            type          = EventType.REPLAY_STARTED,
            status        = "running",
            source        = "worker:$workerId",
            title         = "Run replay started",
            summary       = "Full replay — executing workflow from the beginning",
            retryAttempt  = job.retryCount,
            correlationId = job.streamMessageId,
        ))

        val graphJson = loadWorkflowGraphJson(run.workflowVersionId)
        if (graphJson == null) {
            markRunFailed(job, "No workflow graph found for replay", start)
            return
        }
        val graph = try {
            WorkflowGraph.parse(graphJson)
        } catch (e: Exception) {
            markRunFailed(job, "Failed to parse workflow graph on replay: ${e.message?.take(200)}", start)
            return
        }

        val execResult = runtimeFor(run).execute(
            runId             = job.runId,
            workspaceId       = run.workspaceId,
            environmentId     = run.environmentId,
            workflowVersionId = run.workflowVersionId,
            graph             = graph,
            inputJson         = effectiveInput(run, job),
            source            = "worker:$workerId",
            cancellationCheck = { isCancellationRequested(job.runId) },
            debugMode         = job.debugMode,
            workflowId        = run.workflowId,
        )

        val durationMs = Instant.now().toEpochMilli() - start.toEpochMilli()
        handleExecResult(job, run, execResult, start, durationMs)
        log.info("[processor] REPLAY_RUN complete [runId={}, durationMs={}]", job.runId, durationMs)
    }

    // ── Workspace isolation guard ─────────────────────────────────────────────

    /**
     * Verify that [job.workspaceId] (from the Redis job payload) matches
     * [run.workspaceId] (loaded from the database).
     *
     * A mismatch indicates a corrupted or forged job message.  The job is
     * rejected immediately — no workflow code runs, and a SECURITY_CONTEXT_MISMATCH
     * event is emitted so the incident is visible in the run timeline.
     *
     * Returns true if validation passed (or if job.workspaceId is null, which
     * means the job was enqueued before this field existed — allow with warning).
     * Returns false if there is a mismatch (caller must return without executing).
     */
    private fun verifyWorkspaceMatch(job: WorkflowRunJob, run: RunRow): Boolean {
        val jobWs = job.workspaceId
        if (jobWs == null) {
            // Job pre-dates workspaceId field — warn but allow (backward compat)
            log.warn(
                "[processor] SECURITY: job has no workspaceId field — cannot verify workspace " +
                "match [runId={}, run.workspaceId={}]. Consider re-enqueueing the job.",
                job.runId, run.workspaceId,
            )
            return true
        }

        if (jobWs != run.workspaceId) {
            // SECURITY MISMATCH — do not execute
            log.error(
                "[processor] SECURITY_CONTEXT_MISMATCH: job.workspaceId={} != run.workspaceId={} " +
                "[runId={}] — refusing to execute. Job may be corrupted or forged.",
                jobWs, run.workspaceId, job.runId,
            )
            // Emit a security event so it appears in the run timeline
            runCatching {
                eventStore.appendEvent(RunEventStore.RunEvent(
                    runId         = job.runId,
                    workspaceId   = run.workspaceId,  // use DB value — the authoritative one
                    environmentId = run.environmentId,
                    type          = RunEventStore.EventType.RUN_FAILED,
                    status        = "failed",
                    source        = "worker:$workerId",
                    title         = "SECURITY_CONTEXT_MISMATCH",
                    summary       = "Job workspace (${jobWs}) does not match run workspace (${run.workspaceId}). Execution refused.",
                    errorJsonSanitized = """{"code":"SECURITY_CONTEXT_MISMATCH","message":"job.workspaceId does not match run.workspaceId"}""",
                ))
                updateRunCompleted(
                    runId       = job.runId,
                    status      = "failed",
                    completedAt = java.time.Instant.now(),
                    durationMs  = 0,
                    outputJson  = null,
                    errorJson   = """{"code":"SECURITY_CONTEXT_MISMATCH","message":"Workspace mismatch — execution refused"}""",
                )
            }.onFailure { e ->
                log.error("[processor] could not persist security mismatch event [runId={}]: {}", job.runId, e.message)
            }
            return false
        }

        return true
    }

    // ── Shared execution result handler ──────────────────────────────────────

    /**
     * Translate a [WorkflowRuntime.ExecutionResult] into DB status updates and events.
     * Shared across processStartRun, processResumeRun, processRetryNode, processReplayRun.
     */
    private fun handleExecResult(
        job: WorkflowRunJob,
        run: RunRow,
        execResult: WorkflowRuntime.ExecutionResult,
        start: Instant,
        durationMs: Long = Instant.now().toEpochMilli() - start.toEpochMilli(),
    ) {
        when (execResult) {
            is WorkflowRuntime.ExecutionResult.Succeeded -> {
                val outputJson = try {
                    com.fasterxml.jackson.module.kotlin.jacksonObjectMapper()
                        .writeValueAsString(execResult.output)
                } catch (_: Exception) { "{}" }

                updateRunCompleted(
                    runId = job.runId, status = "succeeded",
                    completedAt = Instant.now(), durationMs = durationMs, outputJson = outputJson,
                )
                eventStore.appendEvent(RunEvent(
                    runId = job.runId, workspaceId = run.workspaceId, environmentId = run.environmentId,
                    type = EventType.RUN_SUCCEEDED, status = "succeeded",
                    source = "worker:$workerId", title = "Run succeeded", durationMs = durationMs,
                ))
                WorkerMetrics.runsSucceeded.inc()
                WorkerMetrics.runDuration.observe(durationMs, job.jobType.name)
                telemetry?.track("workflow_run_succeeded", "run",
                    workspaceId = run.workspaceId.toString(),
                    runId = job.runId.toString(),
                    workflowId = run.workflowId.toString(),
                    properties = mapOf("durationMs" to durationMs))
                log.info("[processor] run succeeded [runId={}, durationMs={}]", job.runId, durationMs)
            }

            is WorkflowRuntime.ExecutionResult.WaitingForApproval -> {
                updateRunStatus(
                    runId = job.runId, status = "waiting_for_approval",
                    startedAt = start, workerId = workerId, fromStatus = "running",
                )
                // §5.4: `run_suspended_total` "should be free; confirm it isn't holding
                // slots". The confirmation is reading this against `worker_in_flight` -
                // this climbing while in-flight does not is suspension working.
                WorkerMetrics.runSuspendedTotal.inc("approval")
                log.info("[processor] run paused for approval [runId={}, approvalId={}]",
                    job.runId, execResult.approvalId)
            }

            is WorkflowRuntime.ExecutionResult.Yielded -> {
                WorkerMetrics.runSuspendedTotal.inc("budget")
                // The run consumed its per-tick budget. Progress is already
                // checkpointed by the runtime. Move running → yielded and durably
                // re-enqueue a RESUME_RUN so another (bounded) tick continues.
                // The thread is released as soon as this returns.
                val moved = updateRunStatus(
                    runId = job.runId, status = "yielded",
                    startedAt = start, workerId = workerId, fromStatus = "running",
                )
                if (!moved) {
                    log.warn("[processor] yield skipped status transition — run no longer 'running' [runId={}]", job.runId)
                }
                val resumeJob = job.copy(
                    streamMessageId = "",
                    jobType = WorkflowRunJob.JobType.RESUME_RUN,
                    triggeredBy = "yielded",
                    nodeId = null,
                    checkpointId = null,
                    retryCount = 0,
                )
                runCatching { reEnqueue(resumeJob) }.onFailure { e ->
                    // Not fatal: the run sits in 'yielded' and crash-recovery will
                    // re-enqueue it once the lease-quiet window elapses.
                    log.error("[processor] yield re-enqueue failed [runId={}] — crash-recovery will backstop: {}",
                        job.runId, e.message)
                }
                eventStore.appendEvent(RunEvent(
                    runId = job.runId, workspaceId = run.workspaceId, environmentId = run.environmentId,
                    type = EventType.RUN_REENQUEUED, status = "yielded", source = "worker:$workerId",
                    title = "Run re-enqueued after yield",
                    summary = "Budget exhausted (${execResult.reason}); continuation queued as RESUME_RUN.",
                ))
                WorkerMetrics.runYields.inc(execResult.reason)
                WorkerMetrics.runReenqueued.inc()
                log.info("[processor] run yielded and re-enqueued [runId={}, reason={}]", job.runId, execResult.reason)
            }

            is WorkflowRuntime.ExecutionResult.Failed -> {
                markRunFailed(job, execResult.reason, start)
            }

            is WorkflowRuntime.ExecutionResult.Throttled -> {
                WorkerMetrics.runSuspendedTotal.inc("provider_429")
                // The permit is released the moment this returns, and the run is
                // parked on a durable timer instead. That is the whole guard:
                // twenty runs throttled by one provider release twenty permits
                // rather than holding them through the provider's backoff.
                //
                // Status is `yielded`, the same state a cooperative yield uses, so
                // crash recovery already understands it — a worker that dies
                // between the status change and the timer write leaves a `yielded`
                // run the recovery sweep re-enqueues. The timer is the fast path,
                // not the only path.
                /*
                 * ── PARKED AT `waiting_for_timer`, NOT `yielded` ─────────────
                 *
                 * This was `yielded`, and the timer scheduled below could
                 * therefore never fire: `TimerScheduler.findDueTimers` selects
                 * `ar.status = 'waiting_for_timer'`, and nothing in the codebase
                 * wrote that status. The row was created, the sweep never matched
                 * it, and the only thing that ever resumed a throttled run was
                 * `CrashRecoveryLoop` — 60-second ticks, batches of ten, ordered
                 * by `updated_at`.
                 *
                 * Two consequences, and both are the reported symptom:
                 *
                 *   1. `Retry-After` was computed, logged, written to the timer
                 *      row and then ignored. A 60-second instruction and a
                 *      1000ms fallback behaved identically.
                 *   2. Runs throttled together came back together, in
                 *      `updated_at` order — the recovery sweep reconstructed the
                 *      burst that caused the throttling.
                 *
                 * `waiting_for_timer` is the status the timer path was written
                 * for, and `RunProcessor` already accepts it as resumable. The
                 * run is now genuinely parked until `fireAt`.
                 *
                 * ── WHAT THIS GIVES UP, AND WHY IT IS SAFE ──────────────────
                 * `CrashRecoveryLoop` scans ('running','yielded'), so it no
                 * longer sees these runs. That is correct — a run deliberately
                 * parked for 60 seconds is not a crashed run, and treating it as
                 * one is what produced the batching. The backstop is
                 * `ResumeReconciler`, which already sweeps `waiting_for_timer`
                 * for exactly this case: a durable status change followed by a
                 * best-effort enqueue.
                 */
                val moved = updateRunStatus(
                    runId = job.runId, status = "waiting_for_timer",
                    startedAt = start, workerId = workerId, fromStatus = "running",
                )
                if (!moved) {
                    log.warn("[processor] throttle skipped status transition — run no longer 'running' [runId={}]",
                        job.runId)
                }
                val fireAt = Instant.now().plusMillis(execResult.retryAfterMs)
                val scheduled = runCatching {
                    timerScheduler()?.scheduleTimer(
                        runId = job.runId,
                        workspaceId = run.workspaceId,
                        environmentId = run.environmentId,
                        workflowId = job.workflowId,
                        nodeId = execResult.nodeId,
                        fireAt = fireAt,
                        payloadJson = """{"reason":"provider_throttle","provider":"${execResult.provider}"}""",
                    )
                }.onFailure {
                    log.warn("[processor] could not schedule throttle timer [runId={}]: {} — " +
                        "crash recovery will re-enqueue the yielded run", job.runId, it.message)
                }.getOrNull()

                eventStore.appendEvent(RunEvent(
                    runId = job.runId, workspaceId = run.workspaceId, environmentId = run.environmentId,
                    type = EventType.RUN_YIELDED, status = "waiting_for_timer",
                    source = "worker:$workerId",
                    title = "Paused by ${execResult.provider} rate limit",
                    summary = execResult.message,
                    stepId = execResult.nodeId,
                ))
                WorkerMetrics.runYields.inc("provider_throttle")
                log.info("[processor] run suspended by {} rate limit [runId={}, resumeAt={}, timer={}]",
                    execResult.provider, job.runId, fireAt, scheduled ?: "none")
            }

            is WorkflowRuntime.ExecutionResult.CeilingExceeded -> {
                // A ceiling is a terminal state of its own, not a failure.
                //
                // `status` names the dimension (`cost_limit_exceeded`,
                // `step_limit_exceeded`, …) so the Runs list can group them, filter
                // them, and offer the right next action — raise the plan, fix the
                // loop, split the workflow. Folding all five into `failed` would
                // make every one of those a support ticket.
                //
                // Not retryable, and the error json says so: retrying a run that
                // hit its cost ceiling spends the money again to reach the same
                // place.
                val breach = execResult.breach
                updateRunCompleted(
                    runId = job.runId, status = breach.status,
                    completedAt = Instant.now(), durationMs = durationMs, outputJson = null,
                    errorJson = breach.toErrorJson(),
                )
                eventStore.appendEvent(RunEvent(
                    runId = job.runId, workspaceId = run.workspaceId, environmentId = run.environmentId,
                    type = EventType.RUN_FAILED, status = breach.status,
                    source = "worker:$workerId",
                    title = "Run stopped at its ${breach.dimension} limit",
                    summary = breach.message,
                    durationMs = durationMs,
                ))
                WorkerMetrics.runDuration.observe(durationMs, job.jobType.name)
                log.warn("[processor] run stopped by {} ceiling [runId={}, used={}, limit={}]",
                    breach.dimension, job.runId, breach.used, breach.limit)
                telemetry?.track("workflow_run_ceiling", "run",
                    workspaceId = run.workspaceId.toString(),
                    runId = job.runId.toString(),
                    workflowId = job.workflowId.toString(),
                    properties = mapOf(
                        "dimension" to breach.dimension,
                        "used" to breach.used,
                        "limit" to breach.limit,
                    ))
            }

            is WorkflowRuntime.ExecutionResult.Cancelled -> {
                // A cancel lands between two node transitions, so the node that was
                // in flight keeps its `executing` entry. `skipped` rather than
                // `failed`: it did not fail, it was stopped — and the ribbon's
                // dashed outline is what says so.
                RibbonWriter.sealExecuting(dataSource, job.runId, RibbonWriter.State.SKIPPED)
                updateRunCompleted(
                    runId = job.runId, status = "cancelled",
                    completedAt = Instant.now(), durationMs = durationMs, outputJson = null,
                    errorJson = """{"code":"CANCELLED","message":"Run cancelled by request"}""",
                )
                eventStore.appendEvent(RunEvent(
                    runId = job.runId, workspaceId = run.workspaceId, environmentId = run.environmentId,
                    type = EventType.RUN_CANCELLED, status = "cancelled",
                    source = "worker:$workerId", title = "Run cancelled", durationMs = durationMs,
                ))
                WorkerMetrics.runsCancelled.inc()
                WorkerMetrics.runDuration.observe(durationMs, job.jobType.name)
                telemetry?.track("workflow_run_cancelled", "run",
                    workspaceId = run.workspaceId.toString(),
                    runId = job.runId.toString(),
                    workflowId = run.workflowId.toString(),
                    properties = mapOf("durationMs" to durationMs))
                log.info("[processor] run cancelled cleanly [runId={}, durationMs={}]", job.runId, durationMs)
            }
        }
    }

    // ── Cancellation check ────────────────────────────────────────────────────

    /**
     * Returns true if the run has been marked 'cancellation_requested' in the DB.
     * Called every few DAG iterations — intentionally light-weight.
     */
    private fun isCancellationRequested(runId: UUID): Boolean =
        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT status FROM agent_runs WHERE id = ?"
                ).use { stmt ->
                    stmt.setObject(1, runId)
                    stmt.executeQuery().use { rs ->
                        rs.next() && rs.getString("status") == "cancellation_requested"
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[processor] cancellation check failed [runId={}]: {}", runId, e.message)
            false
        }

    // ── DB operations ─────────────────────────────────────────────────────────

    data class RunRow(
        val id: UUID,
        val workspaceId: UUID,
        val environmentId: UUID,
        val workflowId: UUID,
        val workflowVersionId: UUID,
        val status: String,
        /** Authoritative run input — the DB is the source of truth, not the Redis message. */
        val inputJson: String?,
        /**
         * Which operation produced this run: live | replay | retry | rerun.
         *
         * Read from the row rather than from the job payload so it survives a
         * redelivery and cannot be forged by a stale message. A replay that
         * executed live because its message lost a flag would be the exact bug
         * this change exists to fix.
         */
        val executionModeKind: String = "live",
        /** The run being replayed from. Null unless this is a replay. */
        val sourceRunId: UUID? = null,
        /** Partial-replay boundary: replayed up to and including this node. */
        val replayUntilNode: String? = null,
    )

    private fun loadRun(runId: UUID): RunRow? =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT id, workspace_id, environment_id, workflow_id,
                   workflow_version_id, status, input_json::text AS input_json,
                   execution_mode_kind, source_run_id, replay_until_node
                   FROM agent_runs WHERE id = ?"""
            ).use { stmt ->
                stmt.setObject(1, runId)
                stmt.executeQuery().use { rs ->
                    if (!rs.next()) return@use null
                    RunRow(
                        id = UUID.fromString(rs.getString("id")),
                        workspaceId = UUID.fromString(rs.getString("workspace_id")),
                        environmentId = UUID.fromString(rs.getString("environment_id")),
                        workflowId = UUID.fromString(rs.getString("workflow_id")),
                        workflowVersionId = UUID.fromString(rs.getString("workflow_version_id")),
                        status = rs.getString("status"),
                        inputJson = rs.getString("input_json"),
                        executionModeKind = rs.getString("execution_mode_kind") ?: "live",
                        sourceRunId = rs.getString("source_run_id")?.let { UUID.fromString(it) },
                        replayUntilNode = rs.getString("replay_until_node"),
                    )
                }
            }
        }

    /**
     * Authoritative run input.
     *
     * If the message carried an inputJson (legacy messages, current START_RUN,
     * continue-as-new), we use it verbatim — byte-identical to the previous
     * behavior, so no run's input semantics change. Only when the message OMITS
     * input (slim RESUME_RUN re-enqueues, oversized-omitted START_RUN) do we read
     * the authoritative value from agent_runs.input_json (the source of truth).
     */
    private fun effectiveInput(run: RunRow, job: WorkflowRunJob): String =
        if (job.inputProvided) job.inputJson
        else run.inputJson?.takeIf { it.isNotBlank() } ?: job.inputJson

    /** Load graph_json from workflow_versions for the given version UUID. */
    private fun loadWorkflowGraphJson(workflowVersionId: UUID): String? =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "SELECT graph_json FROM workflow_versions WHERE id = ?"
            ).use { stmt ->
                stmt.setObject(1, workflowVersionId)
                stmt.executeQuery().use { rs ->
                    if (!rs.next()) null else rs.getString("graph_json")
                }
            }
        }

    /** CAS-style update: only transitions from one of [fromStatuses]→[status] to prevent double-claiming. */
    private fun updateRunStatus(
        runId: UUID,
        status: String,
        startedAt: Instant,
        workerId: String,
        fromStatus: String = "queued",
        fromStatuses: List<String> = listOf(fromStatus),
    ): Boolean =
        dataSource.connection.use { conn ->
            val placeholders = fromStatuses.joinToString(",") { "?" }
            conn.prepareStatement(
                """UPDATE agent_runs SET
                   status = ?, started_at = ?, current_step_id = ?, updated_at = now()
                   WHERE id = ? AND status IN ($placeholders)"""
            ).use { stmt ->
                stmt.setString(1, status)
                stmt.setTimestamp(2, Timestamp.from(startedAt))
                stmt.setString(3, "worker:$workerId")
                stmt.setObject(4, runId)
                fromStatuses.forEachIndexed { i, s -> stmt.setString(5 + i, s) }
                stmt.executeUpdate() > 0
            }
        }

    /**
     * Attribute the failure once, here, because this is the one funnel every
     * terminal state passes through.
     *
     * Ordering matters and is not obvious: the span buffer is flushed FIRST. Spans
     * are written with up to 250ms of latency, so at the moment a run goes terminal
     * the span that actually failed is frequently still in the queue. Attributing
     * before the flush would walk an incomplete tree and blame a propagation span,
     * or find no error spans at all and give up.
     *
     * Never throws. A run that has already finished must not be affected by our
     * inability to explain it.
     */
    private fun attributeRootCause(runId: UUID, status: String) {
        if (status != "failed") return
        runCatching {
            spanWriter?.flush()
            rootCause?.attribute(runId)
            recordFailureClass(runId)
        }.onFailure { log.debug("[root-cause] skipped for {}: {}", runId, it.message) }
    }

    /**
     * Stamp the run with the class of the failure that ended it.
     *
     * ── WHY THE RUN CARRIES THIS AND NOT JUST THE SPAN ──────────────────────
     * "How did this workspace fail last week" is a group-by over a time window.
     * With the class only on the root-cause span it is a join into a partitioned
     * `run_spans` with no index on `is_root_cause`, once per run — which does not
     * come close to the second the failures page is allowed.
     *
     * And it is not only speed. Only ACTIVATION spans carry a class, so a run
     * that failed in an HTTP node has no classified span at all. "Every failed
     * run appears in exactly one class" cannot hold while the class is a property
     * of a span that may not exist.
     *
     * ── WHY UNCLASSIFIED IS WRITTEN RATHER THAN LEFT NULL ───────────────────
     * A failed run with no class would vanish from a page whose whole job is to
     * account for failures — the counts would look tidy and be wrong. An explicit
     * UNCLASSIFIED is a row somebody can see and go and fix, and its size is the
     * measure of how good the taxonomy currently is.
     *
     * Best-effort: this runs after the terminal CAS has already won, so a failure
     * here loses a roll-up row and never a run's outcome.
     */
    private fun recordFailureClass(runId: UUID) {
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE agent_runs r SET failure_class = COALESCE(
                           (SELECT s.failure_class
                              FROM run_spans s
                             WHERE s.run_id = r.id
                               AND s.workspace_id = r.workspace_id
                               AND s.is_root_cause
                               AND s.failure_class IS NOT NULL
                             ORDER BY s.started_at DESC
                             LIMIT 1),
                           'UNCLASSIFIED')
                       WHERE r.id = ? AND r.failure_class IS NULL"""
                ).use { st ->
                    st.setObject(1, runId)
                    st.executeUpdate()
                }
            }
        }.onFailure { log.debug("[root-cause] failure class not recorded for {}: {}", runId, it.message) }
    }

    private fun updateRunCompleted(
        runId: UUID,
        status: String,
        completedAt: Instant,
        durationMs: Long,
        outputJson: String?,
        errorJson: String? = null,
    ): Boolean {
        /* The CAS, and NOTHING else, inside the connection. Everything that
           follows a won transition is in [onTerminalTransition], which explains
           why that separation is load-bearing. */
        val won = dataSource.connection.use { conn ->
            // Aggregate token_count and estimated_cost from run_events so the
            // agent_runs row reflects total usage for the entire run.
            // run_events stores per-LLM-call tokens; SUM collapses them here.
            //
            // Terminal-state guard: a run that already reached succeeded/failed/
            // cancelled must never be overwritten — the loser of a duplicate
            // execution would otherwise clobber the winner's result.
            conn.prepareStatement(
                """UPDATE agent_runs SET
                   status = ?, completed_at = ?, duration_ms = ?,
                   output_json = ?::jsonb, error_json = ?::jsonb, updated_at = now(),
                   token_count = (
                       SELECT COALESCE(SUM(token_count), 0)
                       FROM run_events WHERE run_id = ? AND token_count IS NOT NULL
                   ),
                   estimated_cost = (
                       SELECT COALESCE(SUM(estimated_cost), 0.0)
                       FROM run_events WHERE run_id = ? AND estimated_cost IS NOT NULL
                   )
                   WHERE id = ?
                     AND status NOT IN ('succeeded', 'failed', 'cancelled')"""
            ).use { stmt ->
                stmt.setString(1, status)
                stmt.setTimestamp(2, Timestamp.from(completedAt))
                stmt.setLong(3, durationMs)
                stmt.setString(4, outputJson)
                stmt.setString(5, errorJson)
                stmt.setObject(6, runId)   // token_count subquery
                stmt.setObject(7, runId)   // estimated_cost subquery
                stmt.setObject(8, runId)   // WHERE id
                val updated = stmt.executeUpdate() > 0
                if (!updated) {
                    log.warn("[processor] terminal update skipped — run already terminal [runId={}, attemptedStatus={}]",
                        runId, status)
                }
                updated
            }
        }
        if (won) onTerminalTransition(runId, status)
        return won
    }

    /**
     * Everything that must happen exactly once when a run becomes terminal.
     *
     * ── WHY THIS IS ITS OWN FUNCTION, OUTSIDE THE CAS'S CONNECTION ──────────
     * Each step below acquires connections of its own: root-cause attribution
     * takes several in sequence, the parent wake takes two or three, the trace
     * export takes one. It all used to run inside `updateRunCompleted`'s
     * `dataSource.connection.use { ... }`, which meant a thread HELD one pooled
     * connection while WAITING for another.
     *
     * That is hold-and-wait. With a pool of P it deadlocks at P concurrently
     * terminalising runs: every thread owns its outer connection, every thread
     * needs an inner one, and none can release until it gets one. Nothing surfaces
     * a useful error either — Hikari's `connectionTimeout` fires on every thread at
     * once — so the symptom is a fleet-wide stall at exactly the moment a burst of
     * runs finishes together, which is a normal thing for a fan-out to do.
     *
     * The nesting was two deep before P13; the trace export added a third call
     * site under the same held connection, which is what took a latent shape and
     * made it reachable at ordinary concurrency.
     *
     * `TerminalCompletionPoolTest` holds the line from both sides: it runs this at
     * concurrency well above the pool size, and it fails the build if this call
     * ever moves back inside a `use` block.
     *
     * ── WHAT DID NOT CHANGE ─────────────────────────────────────────────────
     * The CAS, its guard, and the rule that every step here is gated on having WON
     * it. The UPDATE has already committed (autoCommit), so none of this was ever
     * inside its transaction and releasing the connection first reorders nothing
     * observable.
     */
    internal fun onTerminalTransition(runId: UUID, status: String) {
        /* The CAS is what makes attribution run exactly once even under
           redelivery. */
        attributeRootCause(runId, status)
        /*
         * ── WAKE THE PARENT, IF THIS RUN HAS ONE ────────────────────────────
         *
         * Behind the same CAS, and for the same reason: the transition is what
         * makes "this child just became terminal" true exactly once, so a
         * redelivered message cannot wake the parent twice.
         *
         * `onChildTerminal` itself only enqueues when NO sibling is still live, so
         * a five-child fan-out wakes its parent once rather than five times — and
         * if that enqueue is lost, the parent is left `waiting_for_child` with
         * every child terminal, which is exactly what the reconciler's
         * `children_terminal` arm looks for.
         */
        runCatching { childDispatcher?.onChildTerminal(runId) }
        /*
         * ── SHIP THE TRACE, ONCE, AFTER THE TREE IS COMPLETE ────────────────
         *
         * Behind the same CAS as everything else here, so a redelivered message
         * cannot export the same trace twice. The exporter itself returns
         * immediately for a run that has a parent — a child is shipped as part of
         * its parent's tree, and by the time the parent reaches this line every
         * child is already terminal.
         *
         * `exportAsync`, not `exportRun`: the HTTP round trip goes to somebody
         * else's collector, and putting it on the completion of every run would let
         * a slow collector slow the fleet. The queue behind it is bounded and drops
         * rather than blocking.
         *
         * `runCatching` is still not defensive habit: invariant 7 says
         * observability never blocks execution, and a customer's OTLP endpoint
         * being down must not turn a succeeded run into a failed one. The exporter
         * swallows its own errors too; this is the second wall, because the first
         * one is in code that a customer's config can reach.
         */
        runCatching { exportTrace(runId) }
}

    private fun markRunFailed(job: WorkflowRunJob, sanitizedMessage: String, start: Instant) {
        val durationMs = Instant.now().toEpochMilli() - start.toEpochMilli()
        WorkerMetrics.runsFailed.inc()
        WorkerMetrics.runDuration.observe(durationMs, job.jobType.name)
        runCatching {
            val failedRun = loadRun(job.runId)
            telemetry?.track("workflow_run_failed", "run",
                workspaceId = failedRun?.workspaceId?.toString(),
                runId = job.runId.toString(),
                workflowId = failedRun?.workflowId?.toString(),
                properties = mapOf("durationMs" to durationMs))
        }

        // A node that started and never reported still says `executing` on the
        // ribbon. The run is over; the cell must stop breathing.
        RibbonWriter.sealExecuting(dataSource, job.runId)

        runCatching {
            val run = loadRun(job.runId)
            updateRunCompleted(
                runId = job.runId, status = "failed",
                completedAt = Instant.now(), durationMs = durationMs, outputJson = null,
                errorJson = """{"code":"WORKER_ERROR","message":${jsonString(sanitizedMessage)}}""",
            )
            if (run != null) {
                eventStore.appendEvent(RunEvent(
                    runId = job.runId, workspaceId = run.workspaceId, environmentId = run.environmentId,
                    type = EventType.RUN_FAILED, status = "failed", source = "worker:$workerId",
                    title = "Run failed", summary = sanitizedMessage.take(200), durationMs = durationMs,
                    errorJsonSanitized = """{"message":${jsonString(sanitizedMessage)}}""",
                ))

                /*
                 * ── THE INCIDENT WAS RAISED WITHOUT ITS EVIDENCE ─────────────
                 *
                 * This used to pass the run ids, the sanitized message and the
                 * literal code "WORKER_ERROR", and nothing else. Three
                 * consequences, all visible on the Incidents page:
                 *
                 *  1. FailureClassifier had no HTTP status, no SQLSTATE, no node
                 *     type and no event type to work with, so almost everything
                 *     fell through the chain to UNKNOWN/UNKNOWN.
                 *  2. failed_node_id, failed_tool_id and failed_connection_id were
                 *     always NULL, so the UI's "failing component" fell back to the
                 *     code — and every incident in the workspace collapsed into one
                 *     signature row reading UNKNOWN · UNKNOWN.
                 *  3. RecoveryPolicyEngine never learned a checkpoint existed, so it
                 *     could not recommend resuming from one.
                 *
                 * The evidence has been in run_events all along — the STEP_FAILED
                 * event carries the step, the ids and the sanitized error object.
                 * [collectFailureEvidence] reads it.
                 */
                val evidence = collectFailureEvidence(job.runId)
                val incidentId = recoveryService?.classifyAndPersist(
                    WorkerRecoveryService.TerminalFailureContext(
                        runId = job.runId, workspaceId = run.workspaceId, environmentId = run.environmentId,
                        workflowId = run.workflowId, workflowVersionId = run.workflowVersionId,
                        failedNodeId = evidence.nodeId,
                        failedNodeType = evidence.nodeType,
                        failedStepId = evidence.nodeId,
                        failedAgentId = evidence.agentId,
                        failedToolId = evidence.toolId,
                        failedConnectionId = evidence.connectionId,
                        errorMessage = sanitizedMessage,
                        // Null rather than "WORKER_ERROR" when the node reported a
                        // real one: an invented code shadows the message the
                        // classifier chain actually reads.
                        errorCode = evidence.errorCode,
                        errorType = evidence.errorType,
                        httpStatus = evidence.httpStatus,
                        eventType = evidence.eventType,
                        retryAttempt = evidence.retryAttempt ?: job.retryCount,
                        checkpointAvailable = evidence.checkpointAvailable,
                        checkpointId = evidence.checkpointId,
                        recentEventTypes = evidence.recentEventTypes,
                    )
                )
                if (incidentId != null) {
                    eventStore.appendEvent(RunEvent(
                        runId = job.runId, workspaceId = run.workspaceId, environmentId = run.environmentId,
                        type = EventType.RUN_FAILED, status = "failed", source = "worker:$workerId",
                        title = "Failure incident created",
                        summary = "Recovery Engine diagnosed the failure. incident_id=$incidentId",
                        correlationId = incidentId.toString(),
                    ))
                }
            }
        }.onFailure { e ->
            log.error("[processor] could not write failure event [runId={}]: {}", job.runId, e.message)
        }
    }

    /** What the run's own event log says about how it died. */
    private data class FailureEvidence(
        val nodeId: String? = null,
        val nodeType: String? = null,
        val agentId: UUID? = null,
        val toolId: UUID? = null,
        val connectionId: UUID? = null,
        val errorCode: String? = null,
        val errorType: String? = null,
        val httpStatus: Int? = null,
        val eventType: String? = null,
        val retryAttempt: Int? = null,
        val checkpointAvailable: Boolean = false,
        val checkpointId: UUID? = null,
        val recentEventTypes: List<String> = emptyList(),
    )

    /**
     * Read the failure evidence the run already recorded.
     *
     * Three cheap queries rather than one join: the last failing event, the last
     * ten event types (which is what tells the classifier "this run was retrying
     * a tool call" rather than merely "it failed"), and whether a checkpoint
     * exists — the single fact that decides whether the recommendation can be
     * "resume" instead of "start again".
     *
     * Entirely best-effort. An incident with partial evidence is far better than
     * no incident, and this runs on the failure path where the run is already
     * lost — nothing here may throw.
     */
    private fun collectFailureEvidence(runId: UUID): FailureEvidence = try {
        dataSource.connection.use { conn ->
            var evidence = FailureEvidence()

            conn.prepareStatement(
                """SELECT type, step_id, agent_id, tool_id, connection_id, retry_attempt,
                          error_json_sanitized::text AS error_json
                     FROM run_events
                    WHERE run_id = ?
                      AND (status = 'failed' OR type LIKE '%FAILED%' OR type LIKE '%ERROR%')
                    ORDER BY sequence DESC
                    LIMIT 1"""
            ).use { stmt ->
                stmt.setObject(1, runId)
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        val error = parseErrorJson(rs.getString("error_json"))
                        evidence = evidence.copy(
                            eventType = rs.getString("type"),
                            nodeId = rs.getString("step_id"),
                            nodeType = error["nodeType"] as? String,
                            agentId = rs.getString("agent_id")?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                            toolId = rs.getString("tool_id")?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                            connectionId = rs.getString("connection_id")?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                            errorCode = (error["code"] ?: error["errorCode"])?.toString(),
                            errorType = (error["errorType"] ?: error["type"])?.toString(),
                            httpStatus = intOrNull(error["httpStatus"] ?: error["status"]),
                            retryAttempt = (rs.getObject("retry_attempt") as? Number)?.toInt(),
                        )
                    }
                }
            }

            val recent = mutableListOf<String>()
            conn.prepareStatement(
                "SELECT type FROM run_events WHERE run_id = ? ORDER BY sequence DESC LIMIT 10"
            ).use { stmt ->
                stmt.setObject(1, runId)
                stmt.executeQuery().use { rs -> while (rs.next()) recent += rs.getString("type") }
            }

            conn.prepareStatement(
                "SELECT id FROM run_checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 1"
            ).use { stmt ->
                stmt.setObject(1, runId)
                stmt.executeQuery().use { rs ->
                    if (rs.next()) {
                        val id = rs.getString("id")?.let { runCatching { UUID.fromString(it) }.getOrNull() }
                        evidence = evidence.copy(checkpointAvailable = true, checkpointId = id)
                    }
                }
            }

            evidence.copy(recentEventTypes = recent)
        }
    } catch (e: Exception) {
        log.warn("[processor] could not collect failure evidence [runId={}]: {}", runId, e.message)
        FailureEvidence()
    }

    private fun intOrNull(value: Any?): Int? = when (value) {
        is Number -> value.toInt()
        is String -> value.toIntOrNull()
        else -> null
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseErrorJson(raw: String?): Map<String, Any?> = try {
        if (raw.isNullOrBlank()) emptyMap()
        else com.fasterxml.jackson.module.kotlin.jacksonObjectMapper()
            .readValue(raw, Map::class.java) as Map<String, Any?>
    } catch (_: Exception) { emptyMap() }

    /** Sanitize an exception message for storage — no stack traces, no secrets. */
    private fun sanitizeError(e: Exception): String {
        val raw = e.message ?: e.javaClass.simpleName
        // Truncate and strip anything that looks like a connection string or key
        return raw.take(300)
            .replace(Regex("""[A-Za-z0-9+/]{40,}"""), "[REDACTED]")  // long base64-like tokens
            .replace(Regex("""://[^@]*@"""), "://[REDACTED]@")        // connection string creds
    }

    private fun jsonString(s: String): String =
        "\"${s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ")}\""
}
