package com.vectorbea.worker.runtime

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.NoOpConnectionResolver
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.durable.HistoryLimitChecker
import com.vectorbea.worker.durable.StepExecutionGuard
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.mapping.InMemoryStepOutputView
import com.vectorbea.worker.mapping.MappingResolver
import com.vectorbea.worker.runtime.debug.DebugSnapshotWriter
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.checkpoint.CheckpointStore
import com.vectorbea.worker.runtime.executor.NodeExecutor
import com.vectorbea.worker.runtime.executor.NodeExecutorRegistry
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.executor.TransformNodeExecutor
import com.vectorbea.worker.runtime.graph.*
import org.slf4j.MDC
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import javax.sql.DataSource

/**
 * Core workflow execution engine.
 *
 * Responsibilities:
 *  - Validate and traverse the workflow DAG.
 *  - Execute each node via [NodeExecutorRegistry].
 *  - Emit durable run events via [RunEventStore].
 *  - Write checkpoints after each completed node.
 *  - Handle parallel branches via forked [RuntimeContext]s.
 *  - Pause on APPROVAL nodes without blocking the thread pool.
 *  - Handle unsupported node types via failure policy.
 *
 * Thread model: sequential nodes run on the calling thread.
 * Parallel branches run on [branchExecutor] (bounded thread pool).
 *
 * SECURITY:
 *  - workflowInput is never logged raw.
 *  - Node outputs are never logged raw.
 *  - Only sanitized titles/summaries reach [RunEventStore].
 */
class WorkflowRuntime(
    private val dataSource: DataSource,
    private val eventStore: RunEventStore,
    private val checkpointStore: CheckpointStore,
    private val approvalStore: ApprovalStore,
    private val stepOutputStore: StepOutputStore,
    private val workerId: String,
    connectionResolver: ConnectionResolver? = null,
    dbPoolManager: ClientDbPoolManager? = null,
    private val debugWriter: DebugSnapshotWriter? = null,
    /** Idempotency guard — prevents duplicate side effects on redelivery/recovery. */
    private val stepGuard: StepExecutionGuard = StepExecutionGuard(dataSource),
    /** Optional history-size watchdog — warns, then stops runaway runs. */
    private val historyChecker: HistoryLimitChecker? = null,
    /** Default per-node timeout when the node doesn't set its own (0 disables). */
    private val defaultNodeTimeoutMs: Long =
        (System.getenv("WORKER_DEFAULT_NODE_TIMEOUT_MS") ?: "120000").toLong(),
    /** Hard wall-clock budget for a single run (0 disables). */
    private val maxRunDurationMs: Long =
        (System.getenv("WORKER_MAX_RUN_DURATION_MS") ?: "600000").toLong(),
) {
    private val log      = logger()
    private val registry = NodeExecutorRegistry(
        approvalStore      = approvalStore,
        connectionResolver = connectionResolver ?: NoOpConnectionResolver,
        dbPoolManager      = dbPoolManager ?: ClientDbPoolManager(),
        eventStore         = eventStore,
        dataSource         = dataSource,
    )
    private val scheduler get() = GraphScheduler(WorkflowGraph(emptyList(), emptyList())) // created per-run

    companion object {
        /** Safety cap on configured per-node retries. */
        private const val MAX_NODE_RETRIES = 5
        /** Cap on a single backoff sleep between node retries. */
        private const val MAX_BACKOFF_MS = 30_000L

        /** Node types with external side effects — guarded for idempotency. */
        private val GUARDED_NODE_TYPES = setOf(
            NodeType.LLM, NodeType.HTTP, NodeType.DB_QUERY,
            NodeType.DB_WRITE, NodeType.TOOL, NodeType.AGENT,
        )
    }

    // Dedicated pool for parallel branch execution.
    // Threads are created on demand (so N parallel branches actually run N-wide)
    // but BOUNDED: under saturation CallerRunsPolicy degrades gracefully to
    // executing the branch on the submitting thread instead of growing without
    // limit or deadlocking.
    private val maxBranchThreads =
        (System.getenv("WORKER_MAX_BRANCH_THREADS") ?: "16").toInt().coerceIn(2, 128)
    private val branchExecutor: ExecutorService = ThreadPoolExecutor(
        0, maxBranchThreads, 60L, TimeUnit.SECONDS,
        SynchronousQueue(),
        { r -> Thread(r).also { it.name = "wf-branch-${it.id}"; it.isDaemon = false } },
        ThreadPoolExecutor.CallerRunsPolicy(),
    )

    // Pool used to enforce per-node execution timeouts. Thread count is naturally
    // bounded by (worker concurrency × branch threads) since each caller blocks
    // on its own future.
    private val nodeTimeoutExecutor: ExecutorService = Executors.newCachedThreadPool { r ->
        Thread(r).also { it.name = "wf-node-${it.id}"; it.isDaemon = true }
    }

    sealed class ExecutionResult {
        data class Succeeded(val output: Map<String, Any>) : ExecutionResult()
        data class Failed(val reason: String) : ExecutionResult()
        data class WaitingForApproval(val approvalId: String, val nodeId: String) : ExecutionResult()
        data class Cancelled(val reason: String = "Run cancelled by request") : ExecutionResult()
    }

    /**
     * Execute the workflow described by [graph], starting from the trigger node.
     *
     * @param runId       UUID of the agent_run row
     * @param workspaceId workspace context
     * @param environmentId environment context
     * @param workflowVersionId version this graph was loaded from
     * @param graph       the parsed workflow graph
     * @param inputJson   raw JSON input (treat as untrusted)
     * @param source      event source tag (e.g. "worker:abc123")
     */
    fun execute(
        runId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        workflowVersionId: UUID,
        graph: WorkflowGraph,
        inputJson: String,
        source: String = "worker:$workerId",
        cancellationCheck: () -> Boolean = { false },
        debugMode: Boolean = false,
        workflowId: UUID = workflowVersionId,
    ): ExecutionResult {
        // 1. Validate graph
        val graphScheduler = GraphScheduler(graph)
        val validationErrors = graphScheduler.validateGraph()
        if (validationErrors.isNotEmpty()) {
            val msg = "Invalid workflow graph: ${validationErrors.joinToString("; ")}"
            log.error("[runtime] {} [runId={}]", msg, runId)
            return ExecutionResult.Failed(msg)
        }

        // 2. Parse input
        val workflowInput: Map<String, Any> = try {
            @Suppress("UNCHECKED_CAST")
            jacksonObjectMapper().readValue(inputJson, Map::class.java) as Map<String, Any>
        } catch (_: Exception) {
            emptyMap()
        }

        // 3. Build context
        val ctx = RuntimeContext(
            runId = runId,
            workspaceId = workspaceId,
            environmentId = environmentId,
            workflowVersionId = workflowVersionId,
            workflowId = workflowId,
            workflowInput = workflowInput,
            graph = graph,
            debugMode = debugMode,
        )

        // 4. Build per-run output view for cross-step template resolution
        val stepOutputView = InMemoryStepOutputView()

        // 5. Run the DAG
        return runDag(graph, graphScheduler, ctx, source, stepOutputView, cancellationCheck)
    }

    /**
     * Resume a previously paused run from a [snapshot].
     *
     * Used for:
     *   - Approval resume: mark the approval node back to PENDING so [ApprovalNodeExecutor]
     *     re-evaluates the approval decision (it checks [ApprovalStore.findApproval] first).
     *   - Retry-node: mark a failed node back to PENDING and re-run it.
     *
     * Outputs for already-completed nodes are loaded from [StepOutputStore] so that
     * downstream nodes can still resolve `steps.nodeId.key` expressions correctly.
     *
     * @param snapshot      the checkpoint to restore from
     * @param pendingNodeIds nodes to force back to PENDING (e.g. approval node, failed node)
     */
    fun resume(
        runId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        workflowVersionId: UUID,
        graph: WorkflowGraph,
        inputJson: String,
        snapshot: RuntimeSnapshot,
        pendingNodeIds: Set<String> = emptySet(),
        source: String = "worker:$workerId",
        cancellationCheck: () -> Boolean = { false },
        debugMode: Boolean = false,
        workflowId: UUID = workflowVersionId,
    ): ExecutionResult {
        val graphScheduler = GraphScheduler(graph)

        val workflowInput: Map<String, Any> = try {
            @Suppress("UNCHECKED_CAST")
            jacksonObjectMapper().readValue(inputJson, Map::class.java) as Map<String, Any>
        } catch (_: Exception) { emptyMap() }

        val ctx = RuntimeContext(
            runId                 = runId,
            workspaceId           = workspaceId,
            environmentId         = environmentId,
            workflowVersionId     = workflowVersionId,
            workflowId            = workflowId,
            workflowInput         = workflowInput,
            graph                 = graph,
            debugMode             = debugMode,
            forceReexecuteNodeIds = pendingNodeIds,
        )

        // Restore node statuses from snapshot (nodes in pendingNodeIds stay PENDING for re-run)
        for ((nodeId, statusName) in snapshot.nodeStatus) {
            if (nodeId in pendingNodeIds) continue // leave as PENDING
            when (statusName) {
                "COMPLETED" -> ctx.markCompleted(nodeId)
                "FAILED"    -> ctx.markFailed(nodeId)
                "SKIPPED"   -> ctx.markSkipped(nodeId)
                // RUNNING or PENDING → leave as PENDING so the node re-runs
            }
        }

        // Restore selected edges
        for (edgeId in snapshot.selectedEdges) ctx.selectEdge(edgeId)

        // Restore step outputs for completed nodes so cross-step references resolve
        val stepOutputView = InMemoryStepOutputView()
        for (nodeId in snapshot.completedNodeIds) {
            if (nodeId in pendingNodeIds) continue
            val output = stepOutputStore.loadRaw(runId, nodeId) ?: continue
            ctx.setOutput(nodeId, output)
            stepOutputView.putRaw(nodeId, output)
            stepOutputView.putExtracted(nodeId, output)
            stepOutputView.putValidated(nodeId, output)
        }

        ctx.restoreSequence(snapshot.sequence)

        log.info("[runtime] resuming run from checkpoint [runId={}, seq={}, pendingOverrides={}]",
            runId, snapshot.sequence, pendingNodeIds)

        return runDag(graph, graphScheduler, ctx, source, stepOutputView, cancellationCheck)
    }

    // ── DAG execution loop ────────────────────────────────────────────────────

    private fun runDag(
        graph: WorkflowGraph,
        scheduler: GraphScheduler,
        ctx: RuntimeContext,
        source: String,
        stepOutputView: InMemoryStepOutputView,
        cancellationCheck: () -> Boolean = { false },
    ): ExecutionResult {
        val maxIterations = graph.nodes.size * 10 + 100 // safety cap
        val dagStartedAtMs = System.currentTimeMillis()

        for (iteration in 0..maxIterations) {
            // Hard wall-clock budget — a hung node or pathological graph must
            // not occupy a worker thread indefinitely.
            if (maxRunDurationMs > 0 && System.currentTimeMillis() - dagStartedAtMs > maxRunDurationMs) {
                val msg = "Run exceeded maximum duration (${maxRunDurationMs}ms) — aborting"
                log.error("[runtime] {} [runId={}]", msg, ctx.runId)
                return ExecutionResult.Failed(msg)
            }

            // Check for cancellation (every 5 iterations to avoid excessive DB reads)
            if (iteration % 5 == 0 && cancellationCheck()) {
                log.info("[runtime] run cancelled by external request [runId={}]", ctx.runId)
                return ExecutionResult.Cancelled()
            }

            // Check for completion
            if (scheduler.isRunComplete(ctx)) {
                val endNode  = graph.nodes.firstOrNull { it.nodeType == NodeType.END && ctx.isCompleted(it.id) }
                val output   = endNode?.let { ctx.getOutput(it.id) } ?: buildFinalOutput(ctx, graph)
                return ExecutionResult.Succeeded(output)
            }

            // Check for deadlock
            val deadlocked = scheduler.detectDeadlock(ctx)
            if (deadlocked.isNotEmpty() && scheduler.findRunnableNodes(ctx).isEmpty()) {
                val msg = "Workflow deadlocked — nodes blocked with no progress: ${deadlocked.take(5).joinToString()}"
                log.error("[runtime] {} [runId={}]", msg, ctx.runId)
                return ExecutionResult.Failed(msg)
            }

            // Find and execute runnable nodes
            val runnableNodes = scheduler.findRunnableNodes(ctx)
            if (runnableNodes.isEmpty()) {
                // Nothing runnable but run isn't complete — detect stall
                if (!hasRunningBranches(ctx, graph)) {
                    log.warn("[runtime] no runnable nodes and no running branches [runId={}]", ctx.runId)
                    break
                }
                continue
            }

            // Group by parallel vs sequential
            val parallelNodes = runnableNodes.filter { it.nodeType == NodeType.PARALLEL }
            val sequential    = runnableNodes.filter { it.nodeType != NodeType.PARALLEL }

            // Execute parallel nodes (they fan out their branches)
            for (parallelNode in parallelNodes) {
                val result = executeParallelNode(parallelNode, scheduler, ctx, source, stepOutputView, cancellationCheck)
                if (result != null) return result
            }

            // Execute sequential nodes one by one
            for (node in sequential) {
                if (!ctx.isPending(node.id)) continue // may have been marked during parallel
                val result = executeSingleNode(node, scheduler, ctx, source, stepOutputView)
                if (result != null) return result
            }
        }

        return ExecutionResult.Failed("Workflow execution exceeded iteration limit (possible cycle)")
    }

    // ── Single-node execution ─────────────────────────────────────────────────

    private fun executeSingleNode(
        node: WorkflowNode,
        scheduler: GraphScheduler,
        ctx: RuntimeContext,
        source: String,
        stepOutputView: InMemoryStepOutputView,
    ): ExecutionResult? {
        val nodeStartedAt = java.time.Instant.now()
        ctx.markRunning(node.id)

        // Emit STEP_SCHEDULED then STEP_STARTED
        emitEvent(ctx, EventType.STEP_SCHEDULED, "running", source,
            title   = "Scheduled: ${nodeLabel(node)}",
            summary = "Node ${node.id} scheduled for execution",
            stepId  = node.id)
        emitEvent(ctx, EventType.STEP_STARTED, "running", source,
            title  = "Started: ${nodeLabel(node)}",
            stepId = node.id)

        // For TRANSFORM nodes — emit INPUT_MAPPING_STARTED before resolution
        val isTransform = node.nodeType == NodeType.TRANSFORM
        if (isTransform) {
            emitEvent(ctx, EventType.INPUT_MAPPING_STARTED, "running", source,
                title  = "Resolving input mapping",
                stepId = node.id)
        }

        // Resolve inputs — use MappingResolver for template expressions when inputMapping has {{ }}
        val resolvedInputs = resolveNodeInputs(node, ctx, stepOutputView, source)
            ?: run {
                // Input mapping failed — mark the node as FAILED and emit both
                // INPUT_MAPPING_FAILED (for diagnostics) and STEP_FAILED (so the run
                // knows the step definitively failed and the UI shows it as "failed").
                // Return ExecutionResult.Failed so the branch properly fails instead of
                // silently completing as Succeeded with a failed node inside.
                ctx.markFailed(node.id)
                emitEvent(ctx, EventType.INPUT_MAPPING_FAILED, "running", source,
                    title  = "Input mapping failed: ${nodeLabel(node)}",
                    stepId = node.id)
                emitEvent(ctx, EventType.STEP_FAILED, "running", source,
                    title  = "Failed: ${nodeLabel(node)}",
                    stepId = node.id,
                    error  = """{"reason":"input_mapping_failed","nodeType":"${node.type}"}""")
                val reason = "Input mapping failed for node '${node.id}' (${node.label.ifBlank { node.type }}). " +
                    "Check that all step references use the correct node ID or label and that the referenced steps are completed."
                captureDebugSnapshot(
                    node = node, ctx = ctx, status = "failed",
                    resolvedInput = null, output = null,
                    errorType = "input_mapping_failed", errorMessage = reason,
                    humanFailureReason = "The node could not start because one or more of its input variables could not be resolved.",
                    suggestedFix = "Check that every {{...}} reference in this node's inputs points to a node ID/label and field path that actually exists upstream.",
                    startedAt = nodeStartedAt,
                )
                return ExecutionResult.Failed(reason)
            }

        if (isTransform) {
            emitEvent(ctx, EventType.INPUT_MAPPING_COMPLETED, "running", source,
                title  = "Input mapping resolved",
                stepId = node.id,
                meta   = """{"fieldCount":${resolvedInputs.size}}""")
            emitEvent(ctx, EventType.TRANSFORM_STARTED, "running", source,
                title  = "Transform started",
                stepId = node.id)
        } else {
            emitEvent(ctx, EventType.STEP_INPUT_RESOLVED, "running", source,
                title  = "Inputs resolved",
                stepId = node.id)
        }

        // Execute — for TRANSFORM nodes, pass a view that has the latest step outputs
        val executor = if (isTransform)
            TransformNodeExecutor(stepOutputView)
        else
            registry.executorFor(node)

        val result = executeGuardedWithRetry(node, executor, resolvedInputs, ctx, source)

        captureNodeResultSnapshot(node, ctx, resolvedInputs, result, nodeStartedAt)

        return applyNodeResult(node, result, scheduler, ctx, source, stepOutputView)
    }

    // ── Guarded execution: idempotency + retry policy + timeout ──────────────

    /**
     * Execute [node] with three layers of protection:
     *
     *  1. Idempotency (side-effecting node types only): before each attempt the
     *     [StepExecutionGuard] is consulted. If a previous worker already
     *     completed this node (crash recovery, redelivered message), the cached
     *     output from [StepOutputStore] is reused and the node is NOT re-executed
     *     — no duplicate HTTP calls, emails, or DB writes.
     *     Nodes in [RuntimeContext.forceReexecuteNodeIds] (explicit RETRY_NODE)
     *     bypass the guard so deliberate retries always run.
     *
     *  2. Retry policy: when the node declares retryPolicy.maxAttempts > 0,
     *     transient failures are retried in-place with exponential backoff
     *     (capped at [MAX_BACKOFF_MS] per sleep, [MAX_NODE_RETRIES] attempts).
     *
     *  3. Timeout: each attempt runs under the node's timeoutPolicy.timeoutMs
     *     (falling back to [defaultNodeTimeoutMs]) so a hung executor cannot
     *     occupy a worker thread forever.
     */
    private fun executeGuardedWithRetry(
        node: WorkflowNode,
        executor: NodeExecutor,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
        source: String,
    ): NodeResult {
        val guarded = node.nodeType in GUARDED_NODE_TYPES && node.id !in ctx.forceReexecuteNodeIds
        val maxAttempts = 1 + node.retryPolicy.maxAttempts.coerceIn(0, MAX_NODE_RETRIES)

        var attempt = 0
        var result: NodeResult = NodeResult.Failed("not executed")

        while (attempt < maxAttempts) {
            attempt++

            // ── Idempotency check ─────────────────────────────────────────────
            if (guarded) {
                val acq = stepGuard.tryAcquire(
                    ctx.runId, ctx.workspaceId, ctx.environmentId, node.id, attempt)
                if (acq.alreadyCompleted) {
                    val cached = runCatching { stepOutputStore.loadRaw(ctx.runId, node.id) }.getOrNull()
                    if (cached != null) {
                        log.info("[runtime] node already completed in a previous attempt — using cached output " +
                            "[nodeId={}, runId={}, attempt={}]", node.id, ctx.runId, attempt)
                        emitEvent(ctx, EventType.STEP_SKIPPED, "running", source,
                            title   = "Skipped re-execution: ${nodeLabel(node)}",
                            summary = "Node completed in a previous attempt — cached output reused (idempotency guard)",
                            stepId  = node.id)
                        return NodeResult.Completed(cached)
                    }
                    // Completed but no cached output (persist failed earlier) — fall through and re-execute.
                    log.warn("[runtime] guard says completed but no cached output — re-executing [nodeId={}, runId={}]",
                        node.id, ctx.runId)
                }
                // ALREADY_RUNNING: with run leases another live executor should not exist;
                // a stale 'running' row is from a crashed attempt — proceed (fail-open).
            }

            // ── Execute with timeout ──────────────────────────────────────────
            result = executeWithTimeout(node, executor, resolvedInputs, ctx)

            when (result) {
                is NodeResult.Completed -> {
                    if (guarded) stepGuard.markCompleted(ctx.runId, node.id, attempt)
                    return result
                }
                is NodeResult.ApprovalPaused, is NodeResult.Unsupported -> return result
                is NodeResult.Failed -> {
                    if (guarded) stepGuard.markFailed(ctx.runId, node.id, attempt,
                        """{"reason":${jsonStr(result.reason.take(300))}}""")
                    if (attempt < maxAttempts) {
                        val backoff = (node.retryPolicy.backoffMs *
                            Math.pow(node.retryPolicy.backoffMultiplier, (attempt - 1).toDouble()))
                            .toLong().coerceIn(100L, MAX_BACKOFF_MS)
                        log.warn("[runtime] node failed — retrying {}/{} after {}ms [nodeId={}, runId={}]: {}",
                            attempt, maxAttempts - 1, backoff, node.id, ctx.runId, result.reason.take(120))
                        emitEvent(ctx, EventType.RETRY_STARTED, "running", source,
                            title   = "Retrying: ${nodeLabel(node)} (attempt ${attempt + 1}/$maxAttempts)",
                            summary = "Previous attempt failed: ${result.reason.take(150)}. Backing off ${backoff}ms.",
                            stepId  = node.id)
                        try { Thread.sleep(backoff) } catch (e: InterruptedException) {
                            Thread.currentThread().interrupt()
                            return NodeResult.Failed("Retry interrupted for node '${node.id}'")
                        }
                    }
                }
            }
        }
        return result
    }

    /** Run a single executor attempt under a wall-clock timeout. */
    private fun executeWithTimeout(
        node: WorkflowNode,
        executor: NodeExecutor,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult {
        val timeoutMs = node.timeoutPolicy.timeoutMs.takeIf { it > 0 } ?: defaultNodeTimeoutMs
        if (timeoutMs <= 0) {
            // Timeouts disabled — execute inline
            return try { executor.execute(node, resolvedInputs, ctx) }
            catch (e: Exception) { NodeResult.Failed(sanitizeError(e)) }
        }

        val mdc = MDC.getCopyOfContextMap()
        val future = nodeTimeoutExecutor.submit<NodeResult> {
            val previous = MDC.getCopyOfContextMap()
            if (mdc != null) MDC.setContextMap(mdc)
            try {
                executor.execute(node, resolvedInputs, ctx)
            } finally {
                if (previous != null) MDC.setContextMap(previous) else MDC.clear()
            }
        }
        return try {
            future.get(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            future.cancel(true)
            log.error("[runtime] node timed out after {}ms [nodeId={}, runId={}]", timeoutMs, node.id, ctx.runId)
            NodeResult.Failed("Node '${node.id}' timed out after ${timeoutMs}ms")
        } catch (e: java.util.concurrent.ExecutionException) {
            val cause = e.cause
            NodeResult.Failed(sanitizeError(if (cause is Exception) cause else Exception(e.message)))
        } catch (e: InterruptedException) {
            Thread.currentThread().interrupt()
            future.cancel(true)
            NodeResult.Failed("Node '${node.id}' execution interrupted")
        }
    }

    // ── Debug snapshot capture (Debug Run only) ──────────────────────────────

    private fun captureNodeResultSnapshot(
        node: WorkflowNode,
        ctx: RuntimeContext,
        resolvedInputs: Map<String, Any>,
        result: NodeResult,
        startedAt: java.time.Instant,
    ) {
        if (!ctx.debugMode || debugWriter == null) return
        when (result) {
            is NodeResult.Completed -> captureDebugSnapshot(
                node = node, ctx = ctx, status = "success",
                resolvedInput = resolvedInputs, output = result.output,
                startedAt = startedAt,
            )
            is NodeResult.Failed -> captureDebugSnapshot(
                node = node, ctx = ctx, status = "failed",
                resolvedInput = resolvedInputs, output = null,
                errorType = "execution_failed",
                errorMessage = result.reason,
                humanFailureReason = humanizeFailure(node, result.reason),
                suggestedFix = suggestFixFor(node, result.reason),
                startedAt = startedAt,
            )
            is NodeResult.Unsupported -> captureDebugSnapshot(
                node = node, ctx = ctx, status = "failed",
                resolvedInput = resolvedInputs, output = null,
                errorType = "unsupported_node_type",
                errorMessage = "Unsupported node type '${result.nodeType}'",
                humanFailureReason = "This node type ('${result.nodeType}') is not supported by the execution engine.",
                suggestedFix = "Replace this node with a supported node type, or check for a platform update.",
                startedAt = startedAt,
            )
            is NodeResult.ApprovalPaused -> captureDebugSnapshot(
                node = node, ctx = ctx, status = "running",
                resolvedInput = resolvedInputs, output = null,
                startedAt = startedAt,
            )
        }
    }

    private fun humanizeFailure(node: WorkflowNode, reason: String): String {
        val lower = reason.lowercase()
        return when {
            "json" in lower && ("parse" in lower || "valid" in lower || "schema" in lower) ->
                "The node failed because its output could not be parsed as valid JSON matching the expected schema. " +
                "The model or upstream service likely returned plain text or malformed JSON instead of the structured shape this workflow expects."
            "timeout" in lower || "timed out" in lower ->
                "The node failed because the call did not complete within the allowed time. The downstream service may be slow, unreachable, or rate-limiting requests."
            "401" in reason || "unauthorized" in lower || "forbidden" in lower || "403" in reason ->
                "The node failed because the request was rejected for authentication/authorization reasons — the connection's credentials are likely invalid, expired, or missing required scopes."
            "404" in reason || "not found" in lower ->
                "The node failed because the target resource could not be found — check the URL, ID, or path used by this node."
            "rate limit" in lower || "429" in reason ->
                "The node failed because the upstream service rate-limited the request. Retrying later or reducing concurrency may help."
            else ->
                "The node (${node.label.ifBlank { node.id }}) failed during execution: $reason"
        }
    }

    private fun suggestFixFor(node: WorkflowNode, reason: String): String {
        val lower = reason.lowercase()
        return when {
            "json" in lower && ("parse" in lower || "valid" in lower || "schema" in lower) ->
                "Tighten the prompt/response-format instructions so the model always returns JSON matching the schema, or add a transformation/validation step before this node consumes the output."
            "timeout" in lower || "timed out" in lower ->
                "Increase the node's timeout, check the target service's health, or add a retry policy."
            "401" in reason || "unauthorized" in lower || "forbidden" in lower || "403" in reason ->
                "Reconnect or refresh the connection's credentials in Settings → Connections, and verify it has the required scopes."
            "404" in reason || "not found" in lower ->
                "Verify the resolved URL/ID in the Resolved Inputs tab — it may be using a stale or incorrectly mapped variable."
            "rate limit" in lower || "429" in reason ->
                "Add a delay/backoff before this node, or reduce how often this workflow runs."
            else ->
                "Open the Resolved Inputs and Raw JSON tabs to inspect exactly what this node received, and compare it against what it expects."
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun captureDebugSnapshot(
        node: WorkflowNode,
        ctx: RuntimeContext,
        status: String,
        resolvedInput: Map<String, Any?>?,
        output: Map<String, Any?>?,
        errorType: String? = null,
        errorMessage: String? = null,
        humanFailureReason: String? = null,
        suggestedFix: String? = null,
        startedAt: java.time.Instant,
    ) {
        val writer = debugWriter ?: return
        if (!ctx.debugMode) return
        try {
            val finishedAt = java.time.Instant.now()
            val attempt = ctx.nextAttempt(node.id)

            // Best-effort variable mapping: pair each {{template}} expression in inputMapping
            // with its resolved value and a guess at its source node.
            val variableSources = mutableListOf<Map<String, Any?>>()
            for ((field, template) in node.inputMapping) {
                if (!template.contains("{{")) continue
                val refs = Regex("\\{\\{\\s*([^}]+?)\\s*\\}\\}").findAll(template).map { it.groupValues[1] }.toList()
                for (ref in refs) {
                    val sourceNodeId = ref.substringBefore('.').removePrefix("steps.").trim()
                    val path = ref.substringAfter('.', "")
                    variableSources.add(mapOf(
                        "variable" to "{{$ref}}",
                        "field" to field,
                        "resolvedValue" to resolvedInput?.get(field),
                        "sourceNode" to (ctx.graph.nodes.firstOrNull { it.id == sourceNodeId || it.label == sourceNodeId }?.label ?: sourceNodeId),
                        "sourcePath" to path,
                        "missing" to (resolvedInput?.get(field) == null),
                    ))
                }
            }

            writer.record(DebugSnapshotWriter.NodeDebugCapture(
                workflowRunId = ctx.runId,
                workflowId = ctx.workflowId,
                workspaceId = ctx.workspaceId,
                environmentId = ctx.environmentId,
                nodeId = node.id,
                nodeType = node.type,
                nodeName = DebugSnapshotWriter.nodeName(node),
                attempt = attempt,
                status = status,
                inputTemplate = node.inputMapping,
                resolvedInput = resolvedInput,
                resolvedVariables = variableSources,
                variableSources = variableSources,
                output = output,
                parsedOutput = output,
                errorType = errorType,
                errorMessage = errorMessage,
                humanFailureReason = humanFailureReason,
                suggestedFix = suggestedFix,
                startedAt = startedAt,
                finishedAt = finishedAt,
                durationMs = finishedAt.toEpochMilli() - startedAt.toEpochMilli(),
            ))
        } catch (e: Exception) {
            log.warn("[runtime] debug snapshot capture failed [nodeId={}, runId={}]: {}", node.id, ctx.runId, e.message)
        }
    }

    /**
     * Resolve node inputs using [MappingResolver] for template expressions,
     * falling back to [RuntimeContext.resolveInputMapping] for legacy expressions.
     * Returns null if resolution fails (caller should mark node as failed).
     */
    private fun resolveNodeInputs(
        node: WorkflowNode,
        ctx: RuntimeContext,
        stepOutputView: InMemoryStepOutputView,
        source: String,
    ): Map<String, Any>? {
        val mapping = node.inputMapping
        if (mapping.isEmpty()) return ctx.resolveInputMapping(node)

        // Check if any mapping value contains {{ template }} syntax
        val hasTemplates = mapping.values.any { it.contains("{{") }
        return if (hasTemplates) {
            try {
                MappingResolver.resolveMapping(mapping, ctx, stepOutputView)
            } catch (e: com.vectorbea.worker.mapping.MappingException) {
                log.warn("[runtime] input mapping failed [nodeId={}, runId={}]: {}", node.id, ctx.runId, e.message)
                emitEvent(ctx, EventType.INPUT_MAPPING_FAILED, "running", source,
                    title  = "Input mapping failed: ${e.message?.take(100)}",
                    stepId = node.id,
                    error  = """{"reason":${jsonStr(e.message ?: "unknown")}}""")
                null
            }
        } else {
            ctx.resolveInputMapping(node)
        }
    }

    private fun applyNodeResult(
        node: WorkflowNode,
        result: NodeResult,
        scheduler: GraphScheduler,
        ctx: RuntimeContext,
        source: String,
        stepOutputView: InMemoryStepOutputView,
    ): ExecutionResult? = when (result) {
        is NodeResult.Completed -> {
            ctx.setOutput(node.id, result.output)
            ctx.markCompleted(node.id)

            // Persist step outputs (raw = validated = output for now; transform populates tiers separately)
            stepOutputView.putRaw(node.id, result.output)
            stepOutputView.putExtracted(node.id, result.output)
            stepOutputView.putValidated(node.id, result.output)

            // Persist to DB (non-fatal if fails)
            persistStepOutput(node, result, ctx)

            // Select outgoing edges based on output
            val selectedEdges = scheduler.selectEdgesAfterNode(node, result.output, ctx)

            val isTransform = node.nodeType == NodeType.TRANSFORM
            if (isTransform) {
                emitEvent(ctx, EventType.TRANSFORM_COMPLETED, "running", source,
                    title  = "Transform completed",
                    stepId = node.id,
                    meta   = buildMetaJson(result.metadata + mapOf("edgesSelected" to selectedEdges.size)))
            }

            emitEvent(ctx, EventType.STEP_COMPLETED, "running", source,
                title  = "Completed: ${nodeLabel(node)}",
                stepId = node.id,
                meta   = """{"edgesSelected":${selectedEdges.size},"nodeType":"${node.type}"}""")

            // Branch event for BRANCH nodes
            if (node.nodeType == NodeType.BRANCH) {
                emitEvent(ctx, EventType.BRANCH_EVALUATED, "running", source,
                    title   = "Branch evaluated",
                    summary = "Selected ${selectedEdges.size} edge(s)",
                    stepId  = node.id)
            }

            // Checkpoint after each completed node (when policy allows)
            if (node.checkpointPolicy.enabled) {
                writeCheckpoint(node.id, ctx, source)
            }

            // History watchdog — warn early, stop runaway runs before they
            // bloat run_events beyond operability. Null → continue the DAG.
            enforceHistoryLimits(ctx, source)
        }

        is NodeResult.Failed -> {
            ctx.markFailed(node.id)
            val failEdges = scheduler.selectEdgesAfterFailure(node, ctx)

            emitEvent(ctx, EventType.STEP_FAILED, "running", source,
                title  = "Failed: ${nodeLabel(node)}",
                stepId = node.id,
                error  = """{"reason":${jsonStr(result.reason)},"nodeType":"${node.type}"}""")

            when {
                node.failurePolicy.onFailure == "continue" -> {
                    null // keep going, ignore this failure
                }
                failEdges.isNotEmpty() -> {
                    null // follow failure edge, continue
                }
                else -> {
                    ExecutionResult.Failed("Node ${node.id} (${node.type}) failed: ${result.reason}")
                }
            }
        }

        is NodeResult.Unsupported -> {
            ctx.markFailed(node.id)
            val failEdges = scheduler.selectEdgesAfterFailure(node, ctx)

            emitEvent(ctx, EventType.NODE_TYPE_UNSUPPORTED, "running", source,
                title  = "Unsupported node type: ${result.nodeType}",
                stepId = node.id,
                error  = """{"nodeType":"${result.nodeType}","nodeId":"${node.id}"}""")

            when {
                node.failurePolicy.onFailure == "continue" -> null
                failEdges.isNotEmpty()                     -> null
                else -> ExecutionResult.Failed("Unsupported node type '${result.nodeType}' for node ${node.id}")
            }
        }

        is NodeResult.ApprovalPaused -> {
            emitEvent(ctx, EventType.APPROVAL_REQUESTED, "waiting_for_approval", source,
                title   = "Approval required: ${nodeLabel(node)}",
                summary = result.message,
                stepId  = node.id,
                meta    = """{"approvalId":${jsonStr(result.approvalId)},"nodeId":"${node.id}"}""")

            if (node.checkpointPolicy.enabled) {
                writeCheckpoint(node.id, ctx, source)
            }

            ExecutionResult.WaitingForApproval(result.approvalId, node.id)
        }
    }

    // ── Parallel node execution ───────────────────────────────────────────────

    private fun executeParallelNode(
        parallelNode: WorkflowNode,
        scheduler: GraphScheduler,
        ctx: RuntimeContext,
        source: String,
        stepOutputView: InMemoryStepOutputView,
        cancellationCheck: () -> Boolean = { false },
    ): ExecutionResult? {
        ctx.markRunning(parallelNode.id)

        // Find the corresponding JOIN node
        val joinNode = scheduler.findJoinForParallel(parallelNode, ctx.graph)

        // Find branch nodes between PARALLEL and JOIN
        val branchNodeIds = if (joinNode != null)
            scheduler.branchNodesBetween(parallelNode, joinNode)
        else
            ctx.graph.edgesFrom(parallelNode.id).map { it.target }.toSet()

        emitEvent(ctx, EventType.PARALLEL_STARTED, "running", source,
            title   = "Parallel execution started",
            summary = "Fanout to ${branchNodeIds.size} branch(es)",
            stepId  = parallelNode.id)

        // Execute the parallel node itself (passes through inputs)
        val executor       = registry.executorFor(parallelNode)
        val parallelResult = try { executor.execute(parallelNode, ctx.resolveInputMapping(parallelNode), ctx) }
                             catch (e: Exception) { NodeResult.Failed(sanitizeError(e)) }

        when (parallelResult) {
            is NodeResult.Failed -> {
                ctx.markFailed(parallelNode.id)
                return ExecutionResult.Failed("PARALLEL node ${parallelNode.id} failed: ${parallelResult.reason}")
            }
            is NodeResult.Completed -> {
                ctx.setOutput(parallelNode.id, parallelResult.output)
                ctx.markCompleted(parallelNode.id)
                // DO NOT call selectEdgesAfterNode here — that would mark ALL outgoing edges as
                // selected in the parent context.  ctx.fork() copies selectedEdges, so every
                // branch context would inherit all 4 PARALLEL→agent edges and each branch would
                // run ALL 4 agents instead of just its own.
                // Each branch selects only its own entry edge via branchCtx.selectEdge(edge.id).
            }
            else -> {}
        }

        // Get ALL outgoing edges of the PARALLEL node — every edge is a branch entry.
        // Previously filtered to PARALLEL/DEFAULT only, which silently dropped edges
        // whose type resolved to SUCCESS, APPROVED, or any other non-default value,
        // causing some branches to never be created.
        val allOutEdges    = ctx.graph.edgesFrom(parallelNode.id)
        val branchEntryEdges = allOutEdges  // no type filter — all edges are branches

        log.info("[runtime] parallel fan-out [nodeId={}, totalEdges={}, edgeTypes={}]",
            parallelNode.id, allOutEdges.size,
            allOutEdges.joinToString { "${it.id}:${it.type}→${it.target}" })

        // Fork contexts and execute each branch concurrently
        val futures = branchEntryEdges.map { edge ->
            val entryNodeId = edge.target
            val branchCtx   = ctx.fork(branchNodeIds)
            branchCtx.selectEdge(edge.id)

            val branchScheduler = GraphScheduler(ctx.graph)

            log.info("[runtime] creating branch for node={} edge={} type={} [parallelId={}]",
                entryNodeId, edge.id, edge.type, parallelNode.id)
            emitEvent(ctx, EventType.PARALLEL_BRANCH_STARTED, "running", source,
                title  = "Branch started: $entryNodeId",
                stepId = entryNodeId)

            CompletableFuture.supplyAsync({
                val branchView   = InMemoryStepOutputView()
                // Copy parent step outputs into branch view so cross-step refs work
                ctx.completedNodeIds().forEach { id ->
                    stepOutputView.getRaw(id)?.let       { branchView.putRaw(id, it) }
                    stepOutputView.getExtracted(id)?.let { branchView.putExtracted(id, it) }
                    stepOutputView.getValidated(id)?.let { branchView.putValidated(id, it) }
                }
                val branchResult = runDag(ctx.graph, branchScheduler, branchCtx, source, branchView, cancellationCheck)
                Triple(entryNodeId, branchCtx, branchResult)
            }, branchExecutor)
        }

        // Wait for ALL branches — collect results even if some fail so we get full diagnostic info
        val branchResults = futures.map { future ->
            try {
                future.get()
            } catch (e: Exception) {
                // Branch threw unexpectedly — treat as failed result with a sanitized reason
                val reason = sanitizeError(e)
                log.warn("[runtime] branch future threw [parallelId={}]: {}", parallelNode.id, reason)
                Triple("unknown", ctx, ExecutionResult.Failed(reason) as ExecutionResult)
            }
        }

        // Log per-branch outcome so failures are always visible
        branchResults.forEach { (entryNodeId, _, result) ->
            val status = when (result) {
                is ExecutionResult.Succeeded          -> "succeeded"
                is ExecutionResult.Failed             -> "failed: ${result.reason.take(120)}"
                is ExecutionResult.WaitingForApproval -> "waiting_for_approval"
                is ExecutionResult.Cancelled          -> "cancelled"
            }
            log.info("[runtime] branch {} → {} [parallelId={}]", entryNodeId, status, parallelNode.id)
        }

        // If ALL branches failed, the parallel itself fails
        val allFailed = branchResults.all { it.third is ExecutionResult.Failed }
        if (allFailed) {
            val firstReason = (branchResults.first().third as ExecutionResult.Failed).reason
            log.error("[runtime] all {} branches failed for parallel node {} — aborting",
                branchResults.size, parallelNode.id)
            return ExecutionResult.Failed(
                "All parallel branches failed for node ${parallelNode.id}. First reason: $firstReason"
            )
        }

        // If any branch is waiting for approval, propagate that
        val waitingBranch = branchResults.firstOrNull { it.third is ExecutionResult.WaitingForApproval }
        if (waitingBranch != null) {
            return waitingBranch.third
        }

        // Partial failures are tolerated — succeeded branches contribute their outputs;
        // failed branches contribute nothing but don't block the JOIN.
        val succeededBranches = branchResults.filter { it.third is ExecutionResult.Succeeded }
        val failedCount = branchResults.size - succeededBranches.size
        if (failedCount > 0) {
            log.warn("[runtime] {}/{} branches failed for parallel node {} — continuing with partial results",
                failedCount, branchResults.size, parallelNode.id)
            emitEvent(ctx, EventType.PARALLEL_BRANCH_COMPLETED, "running", source,
                title   = "$failedCount of ${branchResults.size} branches failed",
                summary = "Parallel execution continuing with partial results",
                stepId  = parallelNode.id)
        }

        // Merge ALL branch contexts (including failed ones — their completed sub-nodes matter)
        val branchContexts = branchResults.map { it.second }
        ctx.merge(branchContexts, branchNodeIds)

        branchResults.forEach { (entryNodeId, _, result) ->
            val statusLabel = if (result is ExecutionResult.Succeeded) "completed" else "failed"
            emitEvent(ctx, EventType.PARALLEL_BRANCH_COMPLETED, "running", source,
                title  = "Branch $statusLabel: $entryNodeId",
                stepId = entryNodeId)
        }

        // Handle JOIN node if present — select inbound edges for branches that contributed
        if (joinNode != null) {
            ctx.graph.edgesTo(joinNode.id).forEach { ctx.selectEdge(it.id) }
        }

        // Emit STEP_COMPLETED for the PARALLEL node itself.
        // executeParallelNode bypasses executeSingleNode/applyNodeResult so no event was
        // emitted yet. Without this, the canvas keeps showing the PARALLEL node as "running"
        // forever — making it look like the parallel never finished when it actually did.
        emitEvent(ctx, EventType.STEP_COMPLETED, "running", source,
            title  = "Completed: ${parallelNode.label.ifBlank { parallelNode.id }}",
            stepId = parallelNode.id,
            meta   = """{"branches":${branchResults.size},"succeeded":${succeededBranches.size}}""")

        return null // continue main loop
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun emitEvent(
        ctx: RuntimeContext,
        type: EventType,
        status: String,
        source: String,
        title: String? = null,
        summary: String? = null,
        stepId: String? = null,
        meta: String? = null,
        error: String? = null,
    ) {
        runCatching {
            eventStore.appendEvent(RunEvent(
                runId                = ctx.runId,
                workspaceId          = ctx.workspaceId,
                environmentId        = ctx.environmentId,
                type                 = type,
                status               = status,
                source               = source,
                title                = title,
                summary              = summary,
                stepId               = stepId,
                metadataJsonSanitized = meta,
                errorJsonSanitized   = error,
            ))
        }.onFailure { e ->
            log.warn("[runtime] failed to emit event [type={}, runId={}]: {}", type, ctx.runId, e.message)
        }
    }

    private fun persistStepOutput(node: WorkflowNode, result: NodeResult.Completed, ctx: RuntimeContext) {
        runCatching {
            stepOutputStore.save(
                runId           = ctx.runId,
                workspaceId     = ctx.workspaceId,
                environmentId   = ctx.environmentId,
                nodeId          = node.id,
                nodeType        = node.type,
                rawOutput       = result.output,
                extractedOutput = result.output,
                validatedOutput = result.output,
            )
        }.onFailure { e ->
            log.warn("[runtime] step output persist failed [nodeId={}, runId={}]: {}", node.id, ctx.runId, e.message)
        }
    }

    private fun buildMetaJson(meta: Map<String, Any>): String {
        val sb = StringBuilder("{")
        meta.entries.forEachIndexed { i, (k, v) ->
            if (i > 0) sb.append(",")
            sb.append("\"$k\":")
            when (v) {
                is String  -> sb.append("\"${v.take(200).replace("\"", "\\\"")}\"")
                is Number  -> sb.append(v)
                is Boolean -> sb.append(v)
                is List<*> -> sb.append("[${v.take(10).joinToString(",") { "\"${it?.toString()?.take(100)}\"" }}]")
                else       -> sb.append("\"${v.toString().take(100)}\"")
            }
        }
        sb.append("}")
        return sb.toString()
    }

    private fun writeCheckpoint(nodeId: String, ctx: RuntimeContext, source: String) {
        runCatching {
            val snap = ctx.snapshot()
            val cpId = checkpointStore.save(ctx.runId, ctx.workspaceId, ctx.environmentId, nodeId, snap)
            emitEvent(ctx, EventType.CHECKPOINT_CREATED, "running", source,
                title  = "Checkpoint saved after node $nodeId",
                stepId = nodeId,
                meta   = """{"checkpointId":"$cpId","sequence":${snap.sequence}}""")
        }.onFailure { e ->
            log.warn("[runtime] checkpoint write failed [nodeId={}, runId={}]: {}", nodeId, ctx.runId, e.message)
        }
    }

    /**
     * Check run-history growth against configured limits.
     * Returns a Failed result when the run MUST stop, null to continue.
     */
    private fun enforceHistoryLimits(ctx: RuntimeContext, source: String): ExecutionResult.Failed? {
        val checker = historyChecker ?: return null
        val res = runCatching { checker.check(ctx.runId) }.getOrNull() ?: return null

        if (res.warningTriggered) {
            emitEvent(ctx, EventType.HISTORY_LIMIT_WARNING, "running", source,
                title   = "Run history approaching limit",
                summary = "events=${res.eventCount}, size=${res.sizeBytes / 1024}KB — consider splitting this workflow")
            emitEvent(ctx, EventType.CONTINUE_AS_NEW_RECOMMENDED, "running", source,
                title   = "Continue-as-new recommended",
                summary = "Run history is large; restarting the run with carried-over state is recommended.")
        }

        if (res.status == HistoryLimitChecker.LimitStatus.REQUIRED) {
            val msg = "Run history exceeded the maximum allowed size " +
                "(events=${res.eventCount}, size=${res.sizeBytes / 1024}KB). " +
                "Execution stopped to protect the platform — split the workflow into smaller runs."
            log.error("[runtime] {} [runId={}]", msg, ctx.runId)
            return ExecutionResult.Failed(msg)
        }
        return null
    }

    private fun hasRunningBranches(ctx: RuntimeContext, graph: WorkflowGraph): Boolean =
        graph.nodes.any { ctx.statusOf(it.id) == RuntimeContext.NodeStatus.RUNNING }

    private fun buildFinalOutput(ctx: RuntimeContext, graph: WorkflowGraph): Map<String, Any> {
        // Collect outputs from all terminal nodes with no outgoing edges
        val terminals = graph.nodes.filter { ctx.isCompleted(it.id) && graph.edgesFrom(it.id).isEmpty() }
        return terminals.fold(mutableMapOf()) { acc, node ->
            acc.putAll(ctx.getOutput(node.id))
            acc
        }
    }

    private fun nodeLabel(node: WorkflowNode): String =
        node.label.ifBlank { node.type + ":" + node.id.take(8) }

    private fun sanitizeError(e: Exception): String =
        (e.message ?: e.javaClass.simpleName)
            .take(300)
            .replace(Regex("""[A-Za-z0-9+/]{40,}"""), "[REDACTED]")
            .replace(Regex("""://[^@]*@"""), "://[REDACTED]@")

    private fun jsonStr(s: String): String =
        "\"${s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ")}\""
}

/** Extension to find the join node for a given parallel node. */
private fun GraphScheduler.findJoinForParallel(parallelNode: WorkflowNode, graph: WorkflowGraph): WorkflowNode? {
    // BFS forward from the parallel node's successors to find a JOIN node
    val visited = mutableSetOf<String>()
    val queue   = ArrayDeque(graph.edgesFrom(parallelNode.id).map { it.target })
    while (queue.isNotEmpty()) {
        val id = queue.removeFirst()
        if (id in visited) continue
        visited.add(id)
        val n = graph.nodeById(id) ?: continue
        if (n.nodeType == NodeType.JOIN) return n
        graph.edgesFrom(id).map { it.target }.forEach { queue.add(it) }
    }
    return null
}
