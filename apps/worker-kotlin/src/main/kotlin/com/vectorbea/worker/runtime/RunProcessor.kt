package com.vectorbea.worker.runtime

import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.heartbeat.WorkerHeartbeat
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.observability.MdcKeys
import com.vectorbea.worker.observability.mdcClearAll
import com.vectorbea.worker.queue.WorkflowRunJob
import com.vectorbea.worker.runtime.checkpoint.CheckpointStore
import com.vectorbea.worker.runtime.graph.WorkflowGraph
import org.slf4j.MDC
import java.sql.PreparedStatement
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
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
) {
    private val log = logger()

    /**
     * Entry point — called from the consumer thread pool for each job.
     * Must not throw; all exceptions are caught and turned into RUN_FAILED events.
     */
    fun process(job: WorkflowRunJob) {
        heartbeat.taskStarted()
        WorkerMetrics.activeTasks.inc()
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
            WorkerMetrics.activeTasks.dec()
            heartbeat.taskFinished()
            mdcClearAll()
        }
    }

    // ── Job type handlers ─────────────────────────────────────────────────────

    private fun processStartRun(job: WorkflowRunJob, start: Instant) {
        // 1. Load the run to get workspace/environment context
        val run = loadRun(job.runId)
            ?: run {
                log.error("[processor] run not found in DB [runId={}] — XACK will still happen",
                    job.runId)
                return
            }

        // 2. Transition: queued → running
        val updated = updateRunStatus(
            runId      = job.runId,
            status     = "running",
            startedAt  = start,
            workerId   = workerId,
            fromStatus = "queued",
        )
        if (!updated) {
            log.warn("[processor] could not transition run to RUNNING (already running or not found?) [runId={}]",
                job.runId)
            // Still continue — another worker may have grabbed it; emit a started event cautiously
        }

        // 3. Emit RUN_STARTED
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

        // ── Execute via WorkflowRuntime ────────────────────────────────────
        val execResult = runtime.execute(
            runId             = job.runId,
            workspaceId       = run.workspaceId,
            environmentId     = run.environmentId,
            workflowVersionId = run.workflowVersionId,
            graph             = graph,
            inputJson         = job.inputJson,
            source            = "worker:$workerId",
            cancellationCheck = { isCancellationRequested(job.runId) },
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
    private fun processResumeRun(job: WorkflowRunJob, start: Instant) {
        val run = loadRun(job.runId) ?: run {
            log.error("[processor] RESUME_RUN — run not found [runId={}]", job.runId)
            return
        }

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

        // Transition from waiting_for_approval → running (best-effort CAS)
        updateRunStatus(
            runId      = job.runId,
            status     = "running",
            startedAt  = start,
            workerId   = workerId,
            fromStatus = "waiting_for_approval",
        )

        eventStore.appendEvent(RunEvent(
            runId         = job.runId,
            workspaceId   = run.workspaceId,
            environmentId = run.environmentId,
            type          = EventType.RETRY_STARTED,
            status        = "running",
            source        = "worker:$workerId",
            title         = "Run resumed from checkpoint",
            summary       = "Resuming from checkpoint sequence ${snapshot.sequence}",
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

        val execResult = runtime.resume(
            runId             = job.runId,
            workspaceId       = run.workspaceId,
            environmentId     = run.environmentId,
            workflowVersionId = run.workflowVersionId,
            graph             = graph,
            inputJson         = job.inputJson,
            snapshot          = snapshot,
            pendingNodeIds    = pendingOverrides,
            source            = "worker:$workerId",
            cancellationCheck = { isCancellationRequested(job.runId) },
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
    private fun processRetryNode(job: WorkflowRunJob, start: Instant) {
        val run = loadRun(job.runId) ?: run {
            log.error("[processor] RETRY_NODE — run not found [runId={}]", job.runId)
            return
        }

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

        updateRunStatus(
            runId      = job.runId,
            status     = "running",
            startedAt  = start,
            workerId   = workerId,
            fromStatus = run.status,
        )

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

        val execResult = runtime.resume(
            runId             = job.runId,
            workspaceId       = run.workspaceId,
            environmentId     = run.environmentId,
            workflowVersionId = run.workflowVersionId,
            graph             = graph,
            inputJson         = job.inputJson,
            snapshot          = snapshot,
            pendingNodeIds    = setOf(nodeId),
            source            = "worker:$workerId",
            cancellationCheck = { isCancellationRequested(job.runId) },
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
    private fun processReplayRun(job: WorkflowRunJob, start: Instant) {
        val run = loadRun(job.runId) ?: run {
            log.error("[processor] REPLAY_RUN — run not found [runId={}]", job.runId)
            return
        }

        updateRunStatus(
            runId      = job.runId,
            status     = "running",
            startedAt  = start,
            workerId   = workerId,
            fromStatus = run.status,
        )

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

        val execResult = runtime.execute(
            runId             = job.runId,
            workspaceId       = run.workspaceId,
            environmentId     = run.environmentId,
            workflowVersionId = run.workflowVersionId,
            graph             = graph,
            inputJson         = job.inputJson,
            source            = "worker:$workerId",
            cancellationCheck = { isCancellationRequested(job.runId) },
        )

        val durationMs = Instant.now().toEpochMilli() - start.toEpochMilli()
        handleExecResult(job, run, execResult, start, durationMs)
        log.info("[processor] REPLAY_RUN complete [runId={}, durationMs={}]", job.runId, durationMs)
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
                log.info("[processor] run succeeded [runId={}, durationMs={}]", job.runId, durationMs)
            }

            is WorkflowRuntime.ExecutionResult.WaitingForApproval -> {
                updateRunStatus(
                    runId = job.runId, status = "waiting_for_approval",
                    startedAt = start, workerId = workerId, fromStatus = "running",
                )
                log.info("[processor] run paused for approval [runId={}, approvalId={}]",
                    job.runId, execResult.approvalId)
            }

            is WorkflowRuntime.ExecutionResult.Failed -> {
                markRunFailed(job, execResult.reason, start)
            }

            is WorkflowRuntime.ExecutionResult.Cancelled -> {
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
    )

    private fun loadRun(runId: UUID): RunRow? =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT id, workspace_id, environment_id, workflow_id,
                   workflow_version_id, status
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
                    )
                }
            }
        }

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

    /** CAS-style update: only transitions from [fromStatus]→[status] to prevent double-claiming. */
    private fun updateRunStatus(
        runId: UUID,
        status: String,
        startedAt: Instant,
        workerId: String,
        fromStatus: String = "queued",
    ): Boolean =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """UPDATE agent_runs SET
                   status = ?, started_at = ?, current_step_id = ?, updated_at = now()
                   WHERE id = ? AND status = ?"""
            ).use { stmt ->
                stmt.setString(1, status)
                stmt.setTimestamp(2, Timestamp.from(startedAt))
                stmt.setString(3, "worker:$workerId")
                stmt.setObject(4, runId)
                stmt.setString(5, fromStatus)
                stmt.executeUpdate() > 0
            }
        }

    private fun updateRunCompleted(
        runId: UUID,
        status: String,
        completedAt: Instant,
        durationMs: Long,
        outputJson: String?,
        errorJson: String? = null,
    ) {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """UPDATE agent_runs SET
                   status = ?, completed_at = ?, duration_ms = ?,
                   output_json = ?::jsonb, error_json = ?::jsonb, updated_at = now()
                   WHERE id = ?"""
            ).use { stmt ->
                stmt.setString(1, status)
                stmt.setTimestamp(2, Timestamp.from(completedAt))
                stmt.setLong(3, durationMs)
                stmt.setString(4, outputJson)
                stmt.setString(5, errorJson)
                stmt.setObject(6, runId)
                stmt.executeUpdate()
            }
        }
    }

    private fun markRunFailed(job: WorkflowRunJob, sanitizedMessage: String, start: Instant) {
        val durationMs = Instant.now().toEpochMilli() - start.toEpochMilli()
        WorkerMetrics.runsFailed.inc()
        WorkerMetrics.runDuration.observe(durationMs, job.jobType.name)

        runCatching {
            val run = loadRun(job.runId)
            updateRunCompleted(
                runId = job.runId,
                status = "failed",
                completedAt = Instant.now(),
                durationMs = durationMs,
                outputJson = null,
                errorJson = """{"code":"WORKER_ERROR","message":${jsonString(sanitizedMessage)}}""",
            )
            if (run != null) {
                eventStore.appendEvent(RunEvent(
                    runId = job.runId,
                    workspaceId = run.workspaceId,
                    environmentId = run.environmentId,
                    type = EventType.RUN_FAILED,
                    status = "failed",
                    source = "worker:$workerId",
                    title = "Run failed",
                    summary = sanitizedMessage.take(200),
                    durationMs = durationMs,
                    errorJsonSanitized = """{"message":${jsonString(sanitizedMessage)}}""",
                ))
            }
        }.onFailure { e ->
            log.error("[processor] could not write failure event [runId={}]: {}", job.runId, e.message)
        }
    }

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
