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
import com.vectorbea.worker.runtime.budget.ExecutionBudget
import com.vectorbea.worker.runtime.budget.ExecutionBudgetTracker
import com.vectorbea.worker.runtime.debug.DebugSnapshotWriter
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.checkpoint.CheckpointStore
import com.vectorbea.worker.runtime.executor.NodeExecutor
import com.vectorbea.worker.runtime.executor.NodeExecutorRegistry
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.executor.TransformNodeExecutor
import com.vectorbea.worker.runtime.graph.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withTimeoutOrNull
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
        (System.getenv("DEFAULT_NODE_TIMEOUT_MS") ?: System.getenv("WORKER_DEFAULT_NODE_TIMEOUT_MS") ?: "60000").toLong(),
    /** Per-class default timeouts for external calls (used when the node sets none). */
    private val httpNodeTimeoutMs: Long  = (System.getenv("HTTP_NODE_TIMEOUT_MS")  ?: "30000").toLong(),
    private val llmNodeTimeoutMs: Long   = (System.getenv("LLM_NODE_TIMEOUT_MS")   ?: "90000").toLong(),
    private val agentNodeTimeoutMs: Long = (System.getenv("AGENT_NODE_TIMEOUT_MS") ?: "120000").toLong(),
    /**
     * Hard wall-clock budget for a single run (0 disables).
     * UNLIMITED by default — long-running durable workflows are the product's
     * core proposition; runs may legitimately wait hours or days at approval
     * gates and timers. Set WORKER_MAX_RUN_DURATION_MS only as an emergency brake.
     */
    private val maxRunDurationMs: Long =
        (System.getenv("WORKER_MAX_RUN_DURATION_MS") ?: "0").toLong(),
    /**
     * Per-tick execution budget for cooperative yielding. When non-null, a run
     * executes only a bounded slice (nodes + wall-clock) per worker thread, then
     * checkpoints and yields so the thread is released and the run is re-enqueued
     * as RESUME_RUN. Null = unbounded (historical behavior — used by unit tests).
     */
    private val executionBudget: ExecutionBudget? = null,
    /**
     * Isolated dispatcher for `db_read` / `db_write` nodes. Null means "run them
     * on the shared node executor", which is the pre-isolation behaviour and is
     * retained only for unit tests that construct a runtime directly.
     */
    private val tenantDbDispatcher: TenantDbDispatcher? = null,
    /** Exactly-once guard, handed to the executors that perform side effects. */
    private val sideEffects: com.vectorbea.worker.durable.SideEffectGuard? = null,
    /** Per-connection breaker, so a failing provider stops costing worker permits. */
    private val circuit: com.vectorbea.worker.net.ConnectionCircuit? = null,
    /** Records every provider call so the run can later be replayed. */
    private val recorder: com.vectorbea.worker.replay.ModelCallRecorder? = null,
    /**
     * Non-null when this execution is a replay.
     *
     * Held on the runtime rather than passed per-execute because it must reach
     * every executor, and a replay is a property of the whole execution rather
     * than of one node.
     */
    private val replay: com.vectorbea.worker.replay.ReplayContext? = null,
    /**
     * Output contracts - Layers 0 and 1.
     *
     * Null disables contract validation entirely, which is the pre-contract
     * behaviour and is retained for the unit tests that construct a runtime
     * directly. Production always supplies it.
     */
    private val contracts: com.vectorbea.worker.contract.ContractValidator? = null,
) {
    private val log      = logger()
    private val registry = NodeExecutorRegistry(
        approvalStore      = approvalStore,
        connectionResolver = connectionResolver ?: NoOpConnectionResolver,
        dbPoolManager      = dbPoolManager ?: ClientDbPoolManager(),
        eventStore         = eventStore,
        dataSource         = dataSource,
        sideEffects        = sideEffects,
        circuit            = circuit,
        recorder           = recorder,
        replay             = replay,
        contracts          = contracts,
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

    // Pool used to enforce per-node execution timeouts.
    //
    // THE THREAD-COUNT ASSUMPTION HERE WAS WRONG, AND IT MATTERED.
    //
    // The old comment claimed the count was "naturally bounded by (worker
    // concurrency × branch threads) since each caller blocks on its own future".
    // That holds only while every submitted task eventually finishes. It does
    // not hold on timeout: `future.get(timeout)` returns and `future.cancel(true)`
    // *interrupts* the worker thread — but a thread blocked in a classic
    // java.net.Socket read (which is what the Postgres JDBC driver uses) does not
    // respond to interrupts. The caller is released and its execution slot is
    // correctly freed, while the node thread stays parked on the socket.
    //
    // With an unbounded cached pool that is a permanent thread leak: one leaked
    // thread per hung tenant-DB query, never reclaimed, ending in
    // OutOfMemoryError: unable to create native thread.
    //
    // Two things fix it, and both are needed:
    //   1. Driver-level socketTimeout (see JdbcTimeouts) so the read actually
    //      returns and the thread comes back. This is the real fix.
    //   2. A ceiling here, so a burst cannot outrun (1). Bounded exactly like
    //      [branchExecutor] above: CallerRunsPolicy degrades to inline execution
    //      rather than growing without limit. Inline execution is safe now
    //      precisely because (1) bounds it — before the socket timeouts existed,
    //      it would not have been.
    private val maxNodeThreads =
        (System.getenv("WORKER_MAX_NODE_THREADS") ?: "64").toInt().coerceIn(4, 512)
    private val nodeTimeoutExecutor: ExecutorService = ThreadPoolExecutor(
        0, maxNodeThreads, 60L, TimeUnit.SECONDS,
        SynchronousQueue(),
        { r ->
            Thread(r).also { it.name = "wf-node-${it.id}"; it.isDaemon = true }
        },
        ThreadPoolExecutor.CallerRunsPolicy(),
    )

    sealed class ExecutionResult {
        data class Succeeded(val output: Map<String, Any>) : ExecutionResult()
        data class Failed(val reason: String) : ExecutionResult()
        data class WaitingForApproval(val approvalId: String, val nodeId: String) : ExecutionResult()
        data class Cancelled(val reason: String = "Run cancelled by request") : ExecutionResult()
        /**
         * The per-tick budget was exhausted mid-run. Progress is checkpointed;
         * the caller must re-enqueue a RESUME_RUN to continue. [checkpointNodeId]
         * is the label the yield checkpoint was saved under.
         */
        data class Yielded(val reason: String, val checkpointNodeId: String?) : ExecutionResult()

        /**
         * A per-run ceiling was reached — steps, cost, tokens, active duration, or
         * node payload.
         *
         * Distinct from [Failed] because nothing went wrong. The run did exactly
         * what it was asked to do, for longer or more expensively than it was
         * allowed to, and the user needs to be told which limit and what to do
         * about it — not "your run failed".
         */
        /**
         * A provider rate-limited the run. Progress is checkpointed and a durable
         * timer is scheduled; the worker permit is released in between.
         *
         * Distinct from [Yielded] because the resume is time-gated rather than
         * immediate — re-enqueueing straight away would hit the same rate limit.
         */
        data class Throttled(
            val provider: String,
            val retryAfterMs: Long,
            val nodeId: String,
            val message: String,
        ) : ExecutionResult()

        data class CeilingExceeded(
            val breach: com.vectorbea.worker.runtime.budget.RunCeilings.Breach,
        ) : ExecutionResult()
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
    suspend fun execute(
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
    suspend fun resume(
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
                "SKIPPED"   -> { ctx.markSkipped(nodeId); recordRibbon(ctx, nodeId, RibbonWriter.State.SKIPPED) }
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

    private suspend fun runDag(
        graph: WorkflowGraph,
        scheduler: GraphScheduler,
        ctx: RuntimeContext,
        source: String,
        stepOutputView: InMemoryStepOutputView,
        cancellationCheck: () -> Boolean = { false },
        /**
         * Whether to enforce the per-tick yield budget at this level. Only the
         * top-level run yields; parallel branch sub-DAGs run unbounded (they are
         * still bounded by per-node timeouts) so the parallel merge never has to
         * reason about a partially-yielded branch.
         */
        enforceBudget: Boolean = true,
    ): ExecutionResult {
        val maxIterations = graph.nodes.size * 10 + 100 // safety cap
        val dagStartedAtMs = System.currentTimeMillis()

        // Per-tick cooperative-yield budget (null = unbounded / historical behavior).
        val tracker = if (enforceBudget) executionBudget?.let { ExecutionBudgetTracker(it) } else null

        // Per-RUN ceilings. Different thing from the tracker above and checked in
        // the same places: the tracker decides when to yield, this decides when to
        // stop. An agent looping forever satisfies the tracker on every tick and
        // only this ever ends it.
        //
        // Top-level only, like the yield budget. A parallel branch shares the run's
        // ceiling — counting a branch's steps against a private tracker would let a
        // fan-out multiply the limit by its width.
        val ceilings = if (enforceBudget && dataSource != null) {
            val limits = com.vectorbea.worker.runtime.budget.RunCeilings
                .forWorkspace(dataSource, ctx.workspaceId)
            com.vectorbea.worker.runtime.budget.RunCeilingTracker
                .forRun(dataSource, ctx.runId, limits)
        } else null

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

            // Cooperative yield (wall-clock dimension) — checked before doing more
            // work so a single slow-but-not-timed-out node still yields promptly.
            if (tracker != null && !tracker.canContinue()) {
                ceilings?.persist(dataSource!!)
                return yieldRun(ctx, source, tracker)
            }

            // Run ceilings — checked every iteration, which is what "continuously"
            // has to mean. Checking only at start would let a run that was inside
            // its limits when it began exceed them by any margin before finishing.
            ceilings?.check(dataSource)?.let { breach ->
                ceilings.persist(dataSource!!)
                return ExecutionResult.CeilingExceeded(breach)
            }

            // Check for completion
            if (scheduler.isRunComplete(ctx)) {
                val endNode  = graph.nodes.firstOrNull { it.nodeType == NodeType.END && ctx.isCompleted(it.id) }
                val output   = endNode?.let { ctx.getOutput(it.id) } ?: buildFinalOutput(ctx, graph)
                // Flush on success too: the totals are what the run detail page
                // shows as "47 steps, $0.31", and a successful run that reports
                // zero of everything is worse than no figure at all.
                ceilings?.persist(dataSource!!)
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
                tracker?.recordNode()
                ceilings?.recordStep()
                ceilings?.check(dataSource)?.let { breach ->
                    ceilings.persist(dataSource!!)
                    return ExecutionResult.CeilingExceeded(breach)
                }
                if (tracker != null && !tracker.canContinue()) {
                    ceilings?.persist(dataSource!!)
                    return yieldRun(ctx, source, tracker)
                }
            }

            // Execute sequential nodes one by one
            for (node in sequential) {
                if (!ctx.isPending(node.id)) continue // may have been marked during parallel
                val result = executeSingleNode(node, scheduler, ctx, source, stepOutputView)
                if (result != null) return result
                // Count this node against the per-tick budget; yield (checkpoint +
                // RESUME_RUN) when exhausted so we never pin the worker thread.
                tracker?.recordNode()

                // …and against the run's own ceilings, which persist across ticks.
                ceilings?.recordStep()
                ceilings?.let { c ->
                    // Payload is per node, so it is checked here rather than at the
                    // top of the loop where the node's identity is no longer known.
                    val bytes = ctx.getOutput(node.id)?.toString()?.toByteArray(Charsets.UTF_8)?.size ?: 0
                    (c.checkPayload(node.id, bytes) ?: c.check(dataSource))?.let { breach ->
                        c.persist(dataSource!!)
                        return ExecutionResult.CeilingExceeded(breach)
                    }
                }
                if (tracker != null && !tracker.canContinue()) {
                    ceilings?.persist(dataSource!!)
                    return yieldRun(ctx, source, tracker)
                }
            }
        }

        return ExecutionResult.Failed("Workflow execution exceeded iteration limit (possible cycle)")
    }

    // ── Single-node execution ─────────────────────────────────────────────────

    private suspend fun executeSingleNode(
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
            recordRibbon(ctx, node.id, RibbonWriter.State.FAILED)
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
    private suspend fun executeGuardedWithRetry(
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
                // Throttled goes straight up without consuming a node retry. The
                // provider told us when to come back; burning attempts against
                // that clock just fails the node faster.
                is NodeResult.ApprovalPaused, is NodeResult.Unsupported,
                is NodeResult.Throttled -> return result
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

    /**
     * Run a single executor attempt under a wall-clock timeout.
     *
     * THIS IS WHERE WAITING STOPPED COSTING A THREAD.
     *
     * Previously: submit a `Callable` to a thread pool, then `future.get(timeout)`
     * on the caller. Two threads per node — one running it, one parked waiting —
     * and the parked one was the execution slot. An agent node waiting 6 s on a
     * provider held both for 6 s.
     *
     * Now: `withTimeoutOrNull` around a suspending call. While the node awaits
     * I/O it holds a continuation on the heap and no thread at all, and the
     * timeout is cooperative cancellation rather than an abandoned future.
     *
     * Tenant-database nodes are the exception, and deliberately so. JDBC is
     * blocking and cannot be converted, so those run in `withContext` on the
     * bounded tenant-DB dispatcher: the coroutine suspends, one dispatcher thread
     * blocks, and a hanging tenant database exhausts that dispatcher and nothing
     * else (§2.3).
     */
    private suspend fun executeWithTimeout(
        node: WorkflowNode,
        executor: NodeExecutor,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult {
        val timeoutMs = node.timeoutPolicy.timeoutMs.takeIf { it > 0 } ?: defaultTimeoutFor(node.nodeType)
        val isTenantDbNode = node.nodeType == NodeType.DB_QUERY || node.nodeType == NodeType.DB_WRITE

        // MDC is thread-local, so it does not follow a coroutine across
        // suspension points. Captured here and reinstated inside the block.
        val mdc = MDC.getCopyOfContextMap()

        suspend fun runIt(): NodeResult {
            val previous = MDC.getCopyOfContextMap()
            if (mdc != null) MDC.setContextMap(mdc)
            return try {
                if (isTenantDbNode && tenantDbDispatcher != null) {
                    // Blocking JDBC, contained. The coroutine suspends; only a
                    // dispatcher thread blocks.
                    tenantDbDispatcher.withTenantDbContext(ctx.workspaceId) {
                        executor.execute(node, resolvedInputs, ctx)
                    }
                } else {
                    executor.execute(node, resolvedInputs, ctx)
                }
            } finally {
                if (previous != null) MDC.setContextMap(previous) else MDC.clear()
            }
        }

        if (timeoutMs <= 0) {
            return try { runIt() }
            catch (e: TenantDbDispatcher.DispatcherFullException) {
                NodeResult.Failed(e.message ?: "Tenant database capacity is exhausted")
            }
            catch (e: Exception) { NodeResult.Failed(sanitizeError(e)) }
        }

        return try {
            withTimeoutOrNull(timeoutMs) { runIt() }
                ?: run {
                    log.error("[runtime] node timed out after {}ms [nodeId={}, runId={}]",
                        timeoutMs, node.id, ctx.runId)
                    NodeResult.Failed("Node '${node.id}' timed out after ${timeoutMs}ms")
                }
        } catch (e: TenantDbDispatcher.DispatcherFullException) {
            log.warn("[runtime] tenant-db capacity exhausted — failing node fast [nodeId={}, runId={}]",
                node.id, ctx.runId)
            NodeResult.Failed(e.message ?: "Tenant database capacity is exhausted")
        } catch (e: CancellationException) {
            throw e   // run cancellation must propagate, never become a node failure
        } catch (e: Exception) {
            NodeResult.Failed(sanitizeError(e))
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
            // No snapshot: the node did not execute. A debug entry showing an
            // empty output would read as "the provider returned nothing".
            is NodeResult.Throttled -> Unit
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

    private suspend fun applyNodeResult(
        node: WorkflowNode,
        result: NodeResult,
        scheduler: GraphScheduler,
        ctx: RuntimeContext,
        source: String,
        stepOutputView: InMemoryStepOutputView,
    ): ExecutionResult? = run { when (result) {
        is NodeResult.Throttled -> {
            // The node stays PENDING, so the resume re-executes it. Safe because
            // a 429 means the provider did no work — there is nothing to
            // duplicate by trying again.
            emitEvent(ctx, EventType.RUN_YIELDED, "throttled", source,
                title = "Paused — ${result.provider} rate limit",
                summary = result.message, stepId = node.id)
            ExecutionResult.Throttled(
                provider = result.provider,
                retryAfterMs = result.retryAfterMs,
                nodeId = node.id,
                message = result.message,
            )
        }
        is NodeResult.Completed -> {
            // ---- THE CHECKPOINT BOUNDARY ------------------------------------
            //
            // Everything below this line makes the output durable: ctx.setOutput
            // puts it in scope for downstream nodes, stepOutputView persists it, and
            // the checkpoint captures it. So validation happens HERE, before any of
            // it.
            //
            // Failure mode #6 in the reliability taxonomy is context poisoning - a
            // bad upstream output compounding downstream - and its defence is not a
            // cleverer check, it is this ordering:
            //
            //   "Validate before commit, and a bad output never becomes durable.
            //    Validate after, and you've made it permanent."
            //
            // Moving these lines below the writes would compile, pass every unit
            // test, and silently break the guarantee. Hence the volume of comment on
            // three lines of code.
            val verdict = validateContract(node, ctx, result)
            if (verdict != null && !verdict.committable) {
                recordRibbon(ctx, node.id, RibbonWriter.State.FAILED)
                // Re-dispatched as a node FAILURE so the ordinary failure policy
                // applies — but carrying the contract's specific message rather than
                // a generic "validation error". Recursion into this same function
                // rather than duplicating the failure path, so the two can never
                // diverge.
                //
                // Note what has NOT happened at this point: setOutput, the step
                // output view, persistStepOutput, the checkpoint. The bad value does
                // not exist anywhere durable.
                return@run applyNodeResult(
                    node, NodeResult.Failed(verdict.failureMessage()),
                    scheduler, ctx, source, stepOutputView)
            }

            ctx.setOutput(node.id, result.output)
            ctx.markCompleted(node.id)
            recordRibbon(ctx, node.id,
                // A gated node is not plainly committed: the Ribbon shows it as
                // gated so a reader can see the run is waiting on a human.
                if (verdict?.outcome == com.vectorbea.worker.contract.ContractValidator.Outcome.GATE)
                    RibbonWriter.State.GATED else RibbonWriter.State.COMMITTED,
                (result.metadata["durationMs"] as? Number)?.toLong())

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
            recordRibbon(ctx, node.id, RibbonWriter.State.FAILED)
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
            recordRibbon(ctx, node.id, RibbonWriter.State.FAILED)
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
    } }

    // ── Parallel node execution ───────────────────────────────────────────────

    private suspend fun executeParallelNode(
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
        val branchResults = coroutineScope {
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

            // A branch is now a coroutine, not a pooled thread.
            //
            // Eight parallel HTTP branches used to mean eight threads parked on
            // eight sockets. As `async` they are eight continuations sharing the
            // execution dispatcher, so fan-out width stops being a thread budget.
            async {
                val branchView   = InMemoryStepOutputView()
                // Copy parent step outputs into branch view so cross-step refs work
                ctx.completedNodeIds().forEach { id ->
                    stepOutputView.getRaw(id)?.let       { branchView.putRaw(id, it) }
                    stepOutputView.getExtracted(id)?.let { branchView.putExtracted(id, it) }
                    stepOutputView.getValidated(id)?.let { branchView.putValidated(id, it) }
                }
                val branchResult = runDag(ctx.graph, branchScheduler, branchCtx, source, branchView,
                    cancellationCheck, enforceBudget = false)
                Triple(entryNodeId, branchCtx, branchResult)
            }
        }

        // Wait for ALL branches — collect results even if some fail so we get full diagnostic info
        futures.map { deferred ->
            try {
                deferred.await()
            } catch (e: CancellationException) {
                throw e   // run cancellation propagates; it is not a branch failure
            } catch (e: Exception) {
                // Branch threw unexpectedly — treat as failed result with a sanitized reason
                val reason = sanitizeError(e)
                log.warn("[runtime] branch threw [parallelId={}]: {}", parallelNode.id, reason)
                Triple("unknown", ctx, ExecutionResult.Failed(reason) as ExecutionResult)
            }
        }
        }

        // Log per-branch outcome so failures are always visible
        branchResults.forEach { (entryNodeId, _, result) ->
            val status = when (result) {
                is ExecutionResult.Succeeded          -> "succeeded"
                is ExecutionResult.Failed             -> "failed: ${result.reason.take(120)}"
                is ExecutionResult.WaitingForApproval -> "waiting_for_approval"
                is ExecutionResult.Cancelled          -> "cancelled"
                is ExecutionResult.Yielded            -> "yielded" // branches run unbounded; defensive
                // Also defensive: ceilings are enforced at the top level only, so
                // a branch cannot produce this. Named rather than swallowed by an
                // `else` so that if branches ever do enforce ceilings, this stops
                // compiling instead of silently logging the wrong thing.
                is ExecutionResult.CeilingExceeded    -> "ceiling: ${result.breach.dimension}"
                is ExecutionResult.Throttled          -> "throttled by ${result.provider}"
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

    /**
     * Cooperative yield: persist a checkpoint of current progress, emit
     * RUN_YIELDED, and return [ExecutionResult.Yielded]. The processor turns this
     * into a re-enqueued RESUME_RUN. A checkpoint is ALWAYS written here
     * (regardless of node checkpoint policy) so resume continues exactly here
     * without re-executing completed nodes.
     */
    private fun yieldRun(
        ctx: RuntimeContext,
        source: String,
        tracker: ExecutionBudgetTracker,
    ): ExecutionResult.Yielded {
        val reason = tracker.exhaustedReason() ?: "BUDGET_EXHAUSTED"
        val lastNode = ctx.completedNodeIds().lastOrNull() ?: "__yield__"
        writeCheckpoint(lastNode, ctx, source)
        emitEvent(ctx, EventType.RUN_YIELDED, "yielded", source,
            title   = "Run yielded after a bounded execution tick",
            summary = "Budget exhausted ($reason) — progress checkpointed; the run will resume.",
            meta    = tracker.snapshotJson())
        log.info("[runtime] run yielded [runId={}, reason={}, lastNode={}]", ctx.runId, reason, lastNode)
        return ExecutionResult.Yielded(reason, lastNode)
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

    /** Per-class default timeout for external-call nodes; falls back to the global default. */
    private fun defaultTimeoutFor(nodeType: NodeType): Long = when (nodeType) {
        NodeType.HTTP                 -> httpNodeTimeoutMs
        NodeType.LLM                  -> llmNodeTimeoutMs
        NodeType.AGENT                -> agentNodeTimeoutMs
        else                          -> defaultNodeTimeoutMs
    }

    private fun nodeLabel(node: WorkflowNode): String =
        node.label.ifBlank { node.type + ":" + node.id.take(8) }

    /**
     * Run the node's output contract, before anything is committed.
     *
     * Returns null when the node has no contract - which is the common case today
     * and must stay working. A node without a contract behaves exactly as it did
     * before contracts existed; it is merely flagged in the publish readiness check.
     *
     * Never throws. A validator that itself fails must not fail the run: that would
     * make enabling a contract riskier than not having one, which is the opposite of
     * the intent. A validation that cannot run is logged and treated as absent
     * (recorded as D26).
     */
    private fun validateContract(
        node: com.vectorbea.worker.runtime.graph.WorkflowNode,
        ctx: RuntimeContext,
        result: NodeResult.Completed,
    ): com.vectorbea.worker.contract.ContractValidator.Verdict? {
        val validator = contracts ?: return null
        return try {
            val contract = validator.contractFor(ctx.workflowId, node.id) ?: return null

            val verdict = validator.validate(
                contract = contract,
                input = ctx.workflowInput,
                output = result.output,
                // Historical stats, so `stats.p50` and `stats.stddev` resolve.
                stats = validator.statsFor(ctx.workflowId, node.id),
                context = mapOf(
                    "runId" to ctx.runId.toString(),
                    "nodeId" to node.id,
                    "attempt" to ctx.attemptGroup,
                ),
            )

            validator.recordValidation(ctx.runId, ctx.workspaceId, node.id, verdict)

            when (verdict.outcome) {
                com.vectorbea.worker.contract.ContractValidator.Outcome.FAIL -> {
                    log.warn("[contract] node {} FAILED its contract v{}: {}",
                        node.id, contract.version, verdict.failureMessage())
                    emitEvent(ctx, EventType.NODE_FAILED, "failed", "worker:$workerId",
                        title = "Contract violation",
                        summary = verdict.failureMessage(), stepId = node.id)
                }
                com.vectorbea.worker.contract.ContractValidator.Outcome.WARN -> {
                    // Commits, but the run is flagged and surfaces on Control.
                    val notes = verdict.results.filter { !it.passed }.map { it.message }
                    validator.markLowConfidence(ctx.runId, notes)
                    log.info("[contract] node {} committed with warnings: {}", node.id, notes)
                    emitEvent(ctx, EventType.NODE_SUCCEEDED, "warning", "worker:$workerId",
                        title = "Committed with warnings",
                        summary = notes.joinToString(" "), stepId = node.id)
                }
                com.vectorbea.worker.contract.ContractValidator.Outcome.GATE -> {
                    // Commits, and forces a human approval before any downstream side
                    // effect. The gate is created here rather than at the next
                    // side-effecting node because the decision the human is making is
                    // about THIS output, and it is this output they need to see.
                    val reasons = verdict.results.filter { !it.passed }.map { it.message }
                    createContractGate(ctx, node.id, reasons)
                    log.info("[contract] node {} gated for approval: {}", node.id, reasons)
                }
                com.vectorbea.worker.contract.ContractValidator.Outcome.PASS -> Unit
            }
            verdict
        } catch (e: Exception) {
            log.error("[contract] validation failed for node {} - treating as absent: {}",
                node.id, e.message)
            null
        }
    }

    /**
     * Create the approval gate a `gate` assertion demands.
     *
     * Written straight to `run_approvals` rather than through the approval node
     * executor: this gate was not authored in the graph, it was demanded by a
     * contract, and it must exist even though no approval node is present.
     *
     * `decision_context_json` carries the assertion messages and the output, because
     * an approver asked to sign off on "the contract flagged this" needs to see what
     * was flagged and why.
     */
    private fun createContractGate(ctx: RuntimeContext, nodeId: String, reasons: List<String>) {
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO run_approvals
                        (run_id, workspace_id, environment_id, node_id, status, message,
                         metadata_json, title, risk_level, requested_by,
                         decision_context_json)
                       VALUES (?, ?, ?, ?, 'PENDING', ?, ?::jsonb, ?, 'high', 'contract',
                               ?::jsonb)"""
                ).use { stmt ->
                    stmt.setObject(1, ctx.runId)
                    stmt.setObject(2, ctx.workspaceId)
                    stmt.setObject(3, ctx.environmentId)
                    stmt.setString(4, nodeId)
                    stmt.setString(5, reasons.joinToString(" "))
                    stmt.setString(6, """{"source":"contract_gate"}""")
                    stmt.setString(7, "Contract gate on '\$nodeId'")
                    stmt.setString(8, """{"reasons":[${reasons.joinToString(",") { jsonStr(it) }}]}""")
                    stmt.executeUpdate()
                }
            }
        }.onFailure {
            // A gate that could not be created is a side effect that will now proceed
            // unapproved. Loud, because the whole point of `gate` was to stop that.
            log.error("[contract] COULD NOT CREATE the approval gate for node {} - " +
                "downstream side effects are NOT gated: {}", nodeId, it.message)
        }
    }

    /**
     * Write one ribbon transition.
     *
     * Shares the run's connection so the ribbon lands with the transition it
     * describes rather than after it — see RibbonWriter for why that is the whole
     * design. Never throws onward: the ribbon is a render optimisation, and a run
     * that executed correctly must not be failed because its summary could not be
     * written. The rethrow inside RibbonWriter still aborts the enclosing
     * transaction when there is one, which is where it matters.
     */
    private fun recordRibbon(
        ctx: RuntimeContext,
        nodeId: String,
        state: RibbonWriter.State,
        durationMs: Long? = null,
    ) {
        runCatching { RibbonWriter.recordTransition(dataSource, ctx.runId, nodeId, state, durationMs) }
            .onFailure { log.warn("[ribbon] {} for node {} not recorded: {}", state.wire, nodeId, it.message) }
    }

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
