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
import com.vectorbea.graph.*
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
    /**
     * Streams partial results as nodes commit, for targets that ask.
     *
     * Defaulted from [dataSource] rather than injected: the only configuration
     * is the DataSource this class already holds, and a null one would silently
     * turn streaming off for every workspace that enabled it — a feature that
     * appears configured and does nothing.
     */
    private val deliveries: com.vectorbea.worker.delivery.DeliveryStore? =
        com.vectorbea.worker.delivery.DeliveryStore(dataSource),
    /**
     * The one parking mechanism, for `onFailure: escalate`.
     *
     * Defaulted from [dataSource] for the same reason [deliveries] is: a null one
     * would turn a declared escalation into a silent `fail_run`, which is exactly
     * the outcome the policy exists to avoid.
     */
    private val waits: com.vectorbea.worker.durable.wait.WaitStore =
        com.vectorbea.worker.durable.wait.WaitStore(dataSource),
    /**
     * Whether `onFailure: escalate` actually parks.
     *
     * Off by default, per the feature-flag convention. With it off a node that
     * declares `escalate` fails the run and says so in the log — the pre-T5
     * behaviour, loudly, rather than a run parked on a question nobody knows to
     * answer on a deployment whose operators have not been told about it.
     */
    private val escalationEnabled: Boolean =
        System.getenv("WORKER_FAILURE_ESCALATION")?.lowercase() in setOf("1", "true", "on", "yes"),
    /**
     * How many times one node may be escalated before the run fails.
     *
     * A person answering "retry" ten times is not a workflow that will ever
     * succeed, and each escalation is a durable wait row — unbounded, this is a
     * way to accumulate them forever on one node.
     */
    private val maxEscalations: Int =
        (System.getenv("WORKER_maxEscalations")?.toIntOrNull() ?: 10).coerceIn(1, 100),
    private val checkpointStore: CheckpointStore,
    private val approvalStore: ApprovalStore,
    private val stepOutputStore: StepOutputStore,
    private val workerId: String,
    connectionResolver: ConnectionResolver? = null,
    /**
     * Reads a connection's secret as a named BUNDLE, for the spec-driven HTTP
     * resolver's auth strategies (`secret.clientSecret`, `secret.accessToken`),
     * and seals refreshed OAuth2 tokens. [ConnectionResolver] already holds one
     * privately and hands out a single opaque value; this is the same service,
     * passed explicitly because a strategy needs to ask for a FIELD.
     *
     * Null degrades the spec path to unauthenticated calls, and says so.
     */
    secretService: com.vectorbea.worker.connector.SecretService? = null,
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
    /**
     * Trace span writer. Null disables tracing entirely — every `ctx.tracer?.` call
     * becomes a no-op and no run behaves differently.
     */
    private val spanWriter: com.vectorbea.worker.events.SpanWriter? = null,
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
    /**
     * Layer 3 - confidence routing.
     *
     * Null disables scoring and every output commits on its contract verdict alone,
     * which is the pre-Layer-3 behaviour the unit tests rely on. Production supplies it.
     */
    private val confidence: com.vectorbea.worker.confidence.ConfidenceGating? = null,
    /**
     * Shared provider token bucket. §12.4. Null disables it, which is what every
     * unit test that constructs this runtime directly wants.
     */
    private val capacity: com.vectorbea.worker.net.ProviderCapacityBucket? = null,
    /**
     * The run's queue lane, so a node can tell interactive work from batch.
     *
     * Only the capacity bucket reads it, and only to decide whether this run may
     * draw below the reserved floor. A null lookup means every run is treated as
     * batch — the conservative default.
     */
    private val runClassLookup: com.vectorbea.worker.queue.RunClassLookup? = null,
    /**
     * Delivers signals into a live run at its step boundaries.
     *
     * Null disables delivery entirely, which is what every unit test that builds
     * this runtime directly wants — and is safe, because an undelivered signal
     * stays unconsumed and the reconciler's `signal_pending` arm still finds it.
     * A signal is never lost by this being absent, only delayed.
     */
    private val signals: com.vectorbea.worker.durable.wait.SignalStore? = null,
) {
    private val log      = logger()
    private val registry = NodeExecutorRegistry(
        approvalStore      = approvalStore,
        connectionResolver = connectionResolver ?: NoOpConnectionResolver,
        dbPoolManager      = dbPoolManager ?: ClientDbPoolManager(),
        eventStore         = eventStore,
        dataSource         = dataSource,
        secretService      = secretService,
        sideEffects        = sideEffects,
        circuit            = circuit,
        recorder           = recorder,
        replay             = replay,
        contracts          = contracts,
        capacity           = capacity,
    )

    /**
     * The lane a run was claimed on. Looked up once per run, not per node: it is
     * a property of the claim and cannot change mid-execution.
     */
    private fun laneOf(runId: java.util.UUID): com.vectorbea.worker.queue.WorkerJobType? =
        runCatching { runClassLookup?.classOf(runId) }.getOrNull()
    private val scheduler get() = GraphScheduler(WorkflowGraph(emptyList(), emptyList())) // created per-run

    companion object {
        /** Safety cap on configured per-node retries. */
        private const val MAX_NODE_RETRIES = 5

        /**
         * The step output delivered signals accumulate under.
         *
         * A reserved id rather than a node in the graph: signals arrive from
         * outside and belong to no node, but they must be addressable from the
         * expression language — `steps.__signals__.latest.payload` — and must
         * survive a checkpoint. Being a step output gets both for free. The
         * double underscore keeps it out of the space a user's node id can
         * occupy, which is checked at publish time.
         */
        const val SIGNALS_STEP_ID = "__signals__"

        private val mapper = com.fasterxml.jackson.databind.ObjectMapper()

        /**
         * Node types that reach outside Vectorbea and cannot be undone.
         *
         * Used only to word the gate warning. TOOL and AGENT are included because both
         * resolve at runtime to something that may well send or write, and a warning
         * that over-includes costs a reviewer a moment's caution, while one that
         * under-includes costs them the thing they were trying to prevent.
         */
        private val SIDE_EFFECTING = setOf(
            NodeType.HTTP, NodeType.DB_WRITE, NodeType.TOOL, NodeType.AGENT)
        /** Cap on a single backoff sleep between node retries. */
        private const val MAX_BACKOFF_MS = 30_000L

        /** The operators `ConditionEvaluator` can actually evaluate. See [shouldSkip]. */
        private val COMPARISON = Regex("""(==|!=|>=|<=|>|<)""")

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

        /**
         * The run parked on an external event. Progress is checkpointed and the
         * worker permit is released; the wait row says what wakes it.
         *
         * Distinct from [WaitingForApproval] because the run STATUS differs —
         * approvals keep `waiting_for_approval`, which the Approvals page reads
         * as "a person must decide", and a video render must not appear there.
         * Distinct from [Throttled] because the resume is not time-gated: a
         * callback, a poll or a signal wakes it, and the timeout is a backstop
         * rather than the plan.
         */
        data class Waiting(
            val waitId: String,
            val kind: String,
            val nodeId: String,
            val label: String,
            val timeoutAt: java.time.Instant?,
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
            tracer = tracerFor(runId, workspaceId),
            tickDeadlineAtMs = tickDeadline(),
            executionLane = laneOf(runId),
            /* The SAME check `runDag` uses between nodes, handed down so an agent
               loop can stop between ITERATIONS. Without it, cancelling a run with
               a thirty-iteration agent inside it kept paying for a model to
               reason about a problem that had already been resolved. */
            cancellationCheck = cancellationCheck,
        )

        // 4. Build per-run output view for cross-step template resolution
        val stepOutputView = InMemoryStepOutputView()

        // 5. Run the DAG
        val startedAtMs = System.currentTimeMillis()
        val execResult = runDag(graph, graphScheduler, ctx, source, stepOutputView, cancellationCheck)
        finishTrace(ctx, execResult, startedAtMs)
        return execResult
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
        /* Set by RunProcessor from the job type. A continuation reconstructs; a
           deliberate re-run does not. See RuntimeContext.allowLoopReconstruction. */
        allowLoopReconstruction: Boolean = false,
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
            allowLoopReconstruction = allowLoopReconstruction,
            tracer = tracerFor(runId, workspaceId),
            tickDeadlineAtMs = tickDeadline(),
            executionLane = laneOf(runId),
            /* The SAME check `runDag` uses between nodes, handed down so an agent
               loop can stop between ITERATIONS. Without it, cancelling a run with
               a thirty-iteration agent inside it kept paying for a model to
               reason about a problem that had already been resolved. */
            cancellationCheck = cancellationCheck,
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

        val startedAtMs = System.currentTimeMillis()
        val execResult = runDag(graph, graphScheduler, ctx, source, stepOutputView, cancellationCheck)
        finishTrace(ctx, execResult, startedAtMs)
        return execResult
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

        /*
         * ── run, tick and wait spans ────────────────────────────────────────
         *
         * Opened here because runDag is the one place both execute() and resume()
         * converge, so a tick is exactly one pass through it. `enforceBudget` marks
         * the TOP-LEVEL call — a parallel branch re-enters this method with it false,
         * and a branch is not a tick.
         *
         * The run span is (re)opened on every tick rather than only the first. The
         * insert is idempotent on its derived id, so this costs one no-op write and
         * removes the need for a worker to know whether it is the first to touch the
         * run — which, after a crash or a yield, it cannot know cheaply.
         */
        if (enforceBudget) runCatching {
            ctx.tracer?.let { t ->
                t.openRunSpan("run", java.time.Instant.ofEpochMilli(dagStartedAtMs))
                emitWaitSpanForGapBefore(ctx, t)
                t.openTick("tick")
            }
        }

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

            /*
             * ── THE STEP BOUNDARY ───────────────────────────────────────────
             *
             * "Delivered to the run at its next step boundary" is this line, and
             * this is the only place it can be: between finishing whatever ran
             * last and choosing what runs next. Delivering mid-node would mean a
             * node's inputs changing underneath it while it executes.
             *
             * Checked BEFORE the completion test, so a signal that arrives while
             * the final node is running is delivered rather than dropped by a run
             * that was one iteration from finishing. It is a bounded index probe
             * on a partial index over unconsumed rows — empty for almost every
             * run, so the cost of asking is a probe, not a scan.
             */
            deliverPendingSignals(ctx, source)

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

                /*
                 * A node that was escalated must not run again until the answer
                 * has been read. Checked HERE rather than after execution,
                 * because "skip" and "abort" both mean the node's side effect
                 * must not happen — and a step that restarts a service would
                 * have restarted it before anyone looked at the decision.
                 */
                when (val gate = escalationGate(node, ctx, source)) {
                    is EscalationGate.Proceed -> {}
                    is EscalationGate.Stop -> {
                        if (gate.result != null) return gate.result
                        continue
                    }
                }

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

        /*
         * THE RIBBON NEVER SHOWED A RUNNING NODE.
         *
         * `RibbonWriter.State.EXECUTING` has existed since the ribbon shipped and
         * had no writer: every call site recorded COMMITTED, GATED, FAILED or
         * SKIPPED, all of which are TERMINAL for a node. So the cell for the node
         * currently executing was not on the ribbon at all — the run detail header
         * padded it out as `pending`, drawn as an empty outline with no motion,
         * and a live run looked identical to a queued one until the node finished.
         *
         * Recorded here, at the same point `markRunning` moves the in-memory
         * state, so the two cannot disagree. The upsert is keyed on the node id,
         * so this entry is REPLACED by the terminal one a moment later rather than
         * accumulating a second cell (see RibbonWriter.UPSERT_SQL), and
         * `node_committed` is derived from the array so an executing entry never
         * inflates the committed count.
         */
        recordRibbon(ctx, node.id, RibbonWriter.State.EXECUTING)

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

        /*
         * ── "SKIP IF" WAS A TEXT BOX WIRED TO NOTHING ────────────────────────
         *
         * The Advanced tab has offered a `skipIf` expression since it shipped and
         * no code has ever read it: the node ran regardless. That is the most
         * expensive way for a conditional to be wrong — the work happens, the
         * side effects happen, and the author believes they were prevented.
         *
         * Evaluated HERE, after input resolution, because the expression is
         * written against this node's inputs ("{{ input.amount }} < 100") and
         * they do not exist until the mapping has run. `ConditionEvaluator` is
         * the same pattern matcher branch edges use; no expression is ever eval'd
         * as code.
         */
        if (shouldSkip(node, resolvedInputs)) {
            ctx.markSkipped(node.id)
            recordRibbon(ctx, node.id, RibbonWriter.State.SKIPPED)
            emitEvent(ctx, EventType.STEP_SKIPPED, "running", source,
                title   = "Skipped: ${nodeLabel(node)}",
                summary = "skipIf matched, so this step did not run.",
                stepId  = node.id)
            // The run has to carry on past a skipped node, so its ordinary
            // outgoing edges are selected exactly as if it had completed with no
            // output. Without this the graph stalls with nothing runnable.
            scheduler.selectEdgesAfterNode(node, emptyMap(), ctx)
            return null
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

        /*
         * The step span, and the registry entry executors resolve their parent from.
         * Opened here rather than inside executeGuardedWithRetry so it covers the
         * retries as well: a step that succeeded on attempt three took as long as all
         * three attempts, and a waterfall that showed only the last one would be
         * lying about where the time went.
         *
         * Every tracer call is wrapped: a fault in observability must not be able to
         * change what this method returns.
         */
        val stepSpan = runCatching {
            ctx.tracer?.open("step", nodeLabel(node), ctx.tracer.tickSpanId, nodeId = node.id)
        }.getOrNull()

        val result = executeGuardedWithRetry(node, executor, resolvedInputs, ctx, source)

        runCatching {
            ctx.tracer?.close(
                stepSpan, "step", nodeLabel(node),
                status = when (result) {
                    is NodeResult.Completed       -> "ok"
                    is NodeResult.ApprovalPaused  -> "paused"
                    is NodeResult.Waiting         -> "paused"
                    is NodeResult.Throttled       -> "paused"
                    is NodeResult.Unsupported     -> "skipped"
                    is NodeResult.Failed          -> "error"
                },
                stepId = node.id, nodeId = node.id,
                attributesJson = """{"nodeType":${jsonStr(node.type)}}""",
                errorJson = (result as? NodeResult.Failed)
                    ?.let { """{"reason":${jsonStr(it.reason.take(300))}}""" },
            )
        }

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
                is NodeResult.Throttled, is NodeResult.Waiting -> return result
                is NodeResult.Failed -> {
                    if (guarded) stepGuard.markFailed(ctx.runId, node.id, attempt,
                        """{"reason":${jsonStr(result.reason.take(300))}}""")
                    /*
                     * A settled outcome is not retried, however many attempts the policy
                     * allows.
                     *
                     * The policy answers "how many times", and it was the only thing
                     * asked. Whether another attempt could END DIFFERENTLY is a separate
                     * question, and only the executor can answer it: an agent that
                     * weighed its task and declined, a tool that is not granted, output
                     * that failed its schema. Those replay identically. Each replay of an
                     * agent step is a whole brain loop — several LLM calls — so three
                     * doomed attempts also exhaust the run's per-tick execution budget,
                     * and the run yields and re-enqueues on top of it. That is the
                     * "completed agent retries and then the run starts over" shape.
                     *
                     * Said on the STEP_FAILED event below rather than on one of its own: a
                     * retry policy that visibly does nothing is its own support ticket, but
                     * a second STEP_FAILED for one failed step would double-count in
                     * everything that reads the timeline by event type.
                     */
                    if (!result.retryable && attempt < maxAttempts) {
                        log.info("[runtime] node failed with a settled outcome — not retrying " +
                            "[nodeId={}, runId={}, attemptsLeft={}]: {}",
                            node.id, ctx.runId, maxAttempts - attempt, result.reason.take(120))
                        return result
                    }
                    if (attempt < maxAttempts) {
                        /* The policy owns the curve - fixed / linear / exponential, its
                           cap, and whether to jitter - so the schedule the builder draws
                           and the schedule executed here are the same function. */
                        val backoff = node.retryPolicy
                            .delayForAttempt(attempt, java.util.concurrent.ThreadLocalRandom.current())
                            .coerceIn(100L, MAX_BACKOFF_MS)
                        log.warn("[runtime] node failed — retrying {}/{} after {}ms [nodeId={}, runId={}]: {}",
                            attempt, maxAttempts - 1, backoff, node.id, ctx.runId, result.reason.take(120))
                        emitEvent(ctx, EventType.RETRY_STARTED, "running", source,
                            title   = "Retrying: ${nodeLabel(node)} (attempt ${attempt + 1}/$maxAttempts)",
                            summary = "Previous attempt failed: ${result.reason.take(150)}. Backing off ${backoff}ms.",
                            stepId  = node.id)
                        /*
                         * `delay`, not `Thread.sleep`.
                         *
                         * This function is `suspend` and runs on a bounded execution
                         * pool; sleeping pins one of those threads for the whole
                         * backoff, which is precisely what the NodeExecutor contract
                         * forbids ("an implementation that blocks instead of suspends
                         * pins a dispatcher thread and silently serialises everything
                         * behind it"). It went unnoticed because the default policy is
                         * `maxAttempts = 0` and this branch had never executed. Turning
                         * retries on is what would have made it reachable.
                         */
                        kotlinx.coroutines.delay(backoff)
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
            // node_id and workflow_id are set HERE rather than at each executor,
            // because the requirement is that every line emitted during this node
            // carries them - including lines from the HTTP client, the JDBC driver and
            // anything else the executor reaches that has never heard of a node. A
            // parameter threaded through our own code reaches only our own code, which
            // is the part that was already easy to attribute.
            MDC.put(com.vectorbea.worker.observability.MdcKeys.NODE_ID, node.id)
            MDC.put(com.vectorbea.worker.observability.MdcKeys.WORKFLOW_ID, ctx.workflowId.toString())
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

        // §5.4: per-node duration by kind. Wraps the timeout paths below rather than
        // sitting inside runIt(), so a node killed by its timeout is still measured -
        // the slow ones are the point of the metric and they are exactly the ones that
        // do not return normally.
        suspend fun timedRunIt(): NodeResult {
            val startedAt = System.nanoTime()
            var outcome = "ok"
            try {
                // One span per node, a child of the run span the processor opened,
                // which is itself a child of the API request that enqueued the job.
                // That is the full path §5.4 asks for: request → enqueue → claim →
                // node → tool call → completion, in one trace.
                //
                // The span wraps runIt() rather than the executor directly so a tool
                // call made inside the executor becomes a grandchild automatically —
                // OpenTelemetry's context is ambient within the coroutine, so nothing
                // downstream has to be passed anything.
                val r = com.vectorbea.observability.tracing.Tracing.spanSuspending(
                    name = "node.${node.nodeType.value}",
                    attributes = mapOf(
                        "vectorbea.node_id" to node.id,
                        "vectorbea.node_type" to node.nodeType.value,
                        "vectorbea.run_id" to ctx.runId.toString(),
                    ),
                ) { runIt() }
                if (r is NodeResult.Failed) outcome = "failed"
                return r
            } catch (e: Throwable) {
                // `withTimeoutOrNull` below cancels rather than throwing a timeout, so
                // a timed-out node arrives here as a CancellationException. Classifying
                // it as "error" would hide the slowest nodes in the bucket you look at
                // last.
                outcome = if (e is CancellationException) "timeout" else "error"
                throw e
            } finally {
                com.vectorbea.worker.metrics.WorkerMetrics.jobExecutionDurationSeconds
                    .observeSeconds((System.nanoTime() - startedAt) / 1_000_000_000.0,
                        node.nodeType.value, outcome)
            }
        }

        if (timeoutMs <= 0) {
            return try { timedRunIt() }
            catch (e: TenantDbDispatcher.DispatcherFullException) {
                NodeResult.Failed(e.message ?: "Tenant database capacity is exhausted")
            }
            catch (e: Exception) { NodeResult.Failed(sanitizeError(e)) }
        }

        return try {
            withTimeoutOrNull(timeoutMs) { timedRunIt() }
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
            /* Still `running` in the debugger, exactly as an approval is: the step
               has not finished, and its resolved inputs are what somebody opening
               the debugger on a parked run wants to see. Marking it complete would
               hide the node the run is actually sitting on. */
            is NodeResult.Waiting -> captureDebugSnapshot(
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
            // duplicate by trying again. The ribbon is put back to `pending` for
            // the same reason: the entry recorded at start says `executing`, and a
            // run parked on a provider's backoff is not executing anything.
            recordRibbon(ctx, node.id, RibbonWriter.State.PENDING)
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

            // ---- Layer 3: confidence routing ---------------------------------
            //
            // Same position and the same reason as the contract check above: before
            // setOutput, before persistStepOutput, before the checkpoint. A gated
            // output must not be durable-then-retracted.
            //
            // The distinction between this and the contract check is what each is
            // able to say. A contract says "this is wrong" and fails. Confidence says
            // "I cannot show that this is right", which is not grounds to throw the
            // work away - it is grounds to ask. So GATE suspends rather than fails,
            // and the output travels with the gate so a person can see it.
            val gating = confidence?.evaluate(
                runId = ctx.runId,
                workspaceId = ctx.workspaceId,
                workflowId = ctx.workflowId,
                nodeId = node.id,
                environmentId = ctx.environmentId,
                verdict = verdict,
                metadata = result.metadata,
                output = result.output,
                downstreamSideEffect = firstDownstreamSideEffect(node, scheduler, ctx),
            )

            if (gating is com.vectorbea.worker.confidence.ConfidenceGating.Decision.Fail) {
                recordRibbon(ctx, node.id, RibbonWriter.State.FAILED)
                return@run applyNodeResult(
                    node, NodeResult.Failed(gating.message),
                    scheduler, ctx, source, stepOutputView)
            }

            if (gating is com.vectorbea.worker.confidence.ConfidenceGating.Decision.Gate) {
                // The output IS committed to the in-memory context and to step
                // outputs, because the reviewer is being asked about this value and
                // the run resumes from here. What does not happen is the rest of the
                // graph: WaitingForApproval stops the run, so no downstream node -
                // and therefore no side effect - runs on an unreviewed value.
                ctx.setOutput(node.id, result.output)
                ctx.markCompleted(node.id)
                recordRibbon(ctx, node.id, RibbonWriter.State.GATED,
                    (result.metadata["durationMs"] as? Number)?.toLong())
                stepOutputView.putRaw(node.id, result.output)
                stepOutputView.putExtracted(node.id, result.output)
                stepOutputView.putValidated(node.id, result.output)
                persistStepOutput(node, result, ctx)

                emitEvent(ctx, EventType.APPROVAL_REQUESTED, "waiting_for_approval", source,
                    title   = "Review needed: ${nodeLabel(node)}",
                    summary = gating.message,
                    stepId  = node.id,
                    meta    = """{"approvalId":${jsonStr(gating.approvalId.toString())},""" +
                              """"nodeId":"${node.id}","reason":"low_confidence"}""")

                // The checkpoint matters more here than anywhere: the run is about to
                // stop for an unbounded time, and it must resume from exactly this
                // point however long the reviewer takes.
                writeCheckpoint(node.id, ctx, source)

                return@run ExecutionResult.WaitingForApproval(gating.approvalId.toString(), node.id)
            }

            if (gating is com.vectorbea.worker.confidence.ConfidenceGating.Decision.Flag) {
                contracts?.markLowConfidence(ctx.runId, listOf(gating.message))
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

            /*
             * ── STREAM THIS NODE, IF ANYBODY ASKED ─────────────────────
             * A six-hour pipeline that emits nothing until it finishes is
             * indistinguishable from one that is stuck, and the customer cannot
             * start on the first half of a result they will not see for hours.
             *
             * Here rather than at the checkpoint because THIS is the point where
             * the node's output is durable and correct. It queues a row and
             * returns — the dispatcher does the sending, so a slow receiver
             * cannot slow the run that is producing their data.
             */
            streamPartial(node, result, ctx)

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

            /* Why no retries happened, on the event that reports the failure. Without
               this the timeline shows a node configured for 3 retries failing once with
               no retry in sight, which reads as the retry policy being broken rather
               than as the runtime declining to repeat a settled outcome. */
            val retryNote = if (!result.retryable && node.retryPolicy.maxAttempts > 0)
                "Not retried: this outcome would be identical on another attempt, so the " +
                "${node.retryPolicy.maxAttempts} configured retry attempt(s) were skipped."
            else null

            emitEvent(ctx, EventType.STEP_FAILED, "running", source,
                title   = "Failed: ${nodeLabel(node)}",
                summary = retryNote,
                stepId  = node.id,
                error   = """{"reason":${jsonStr(result.reason)},"nodeType":"${node.type}"}""")

            when {
                node.failurePolicy.onFailure == FailurePolicy.CONTINUE -> {
                    null // keep going, ignore this failure
                }
                /*
                 * Checked BEFORE the failure edge: a node declaring both is
                 * asking a person to choose between them, and an edge silently
                 * winning would make the escalation setting look broken rather
                 * than overridden.
                 */
                node.failurePolicy.onFailure == FailurePolicy.ESCALATE ->
                    openEscalation(node, ctx, source, result.reason)
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
            // Waiting on a person is `gated`, not `executing` — the ribbon's ember
            // halo is the whole reason a reader can tell "stopped for a decision"
            // from "still working" at a glance.
            recordRibbon(ctx, node.id, RibbonWriter.State.GATED)
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

        is NodeResult.Waiting -> {
            /* GATED for the same reason an approval is: the ribbon's ember halo is
               how a reader tells "stopped waiting for something" from "still
               working", and a six-minute render is exactly the case where those
               two look identical without it. */
            recordRibbon(ctx, node.id, RibbonWriter.State.GATED)
            emitEvent(ctx, EventType.RUN_WAIT_STARTED, "waiting_for_event", source,
                title   = "Waiting: ${nodeLabel(node)}",
                summary = result.label,
                stepId  = node.id,
                meta    = "{\"waitId\":${jsonStr(result.waitId)}," +
                          "\"waitKind\":${jsonStr(result.kind)}," +
                          "\"nodeId\":${jsonStr(node.id)}}")

            /*
             * The checkpoint is written UNCONDITIONALLY, unlike the approval arm
             * above which respects `checkpointPolicy.enabled`.
             *
             * An approval that skipped its checkpoint still resumes correctly: the
             * approval node re-executes and reads its decision out of the
             * database. A wait carries a RESULT — the render's output, the
             * signal's payload — and resuming with no checkpoint would replay the
             * node from before it submitted, which for an async tool means
             * submitting the six-minute job a second time.
             */
            writeCheckpoint(node.id, ctx, source)

            ExecutionResult.Waiting(
                waitId = result.waitId,
                kind = result.kind,
                nodeId = node.id,
                label = result.label,
                timeoutAt = result.timeoutAt,
            )
        }
    } }

    // ── Escalation ───────────────────────────────────────────────

    /*
     * A NODE FAILED AND ITS POLICY SAYS TO ASK A PERSON.
     *
     * ── WHY THIS IS A SIGNAL AND NOT A NEW KIND OF PAUSE ───────────────
     * Invariants 9 and 15. A second parking mechanism means a second timeout
     * policy, a second reconciler arm and a second way for a run to be stuck
     * forever — and only one of those would be tested. An escalation is a
     * question with a deadline, which is precisely a signal wait, so it parks
     * through the same primitive and is answered through the endpoint that
     * already exists:
     *
     *     POST /api/runs/:id/signals
     *     {"name": "escalation:<nodeId>", "payload": {"decision": "retry"}}
     *
     * ── AND WHY THE ANSWER IS READ BEFORE THE NODE RUNS, NOT AFTER ───────
     * Two of the three decisions — skip and abort — mean the node's side effect
     * must NOT happen. Reading the answer after re-executing would restart the
     * service a person had just said to leave alone. So the node is parked in
     * PENDING (not FAILED) and the decision is a gate in front of it.
     */

    /** What the gate decided about a node that is about to run. */
    private sealed class EscalationGate {
        object Proceed : EscalationGate()
        /** Do not run the node. A null [result] continues the DAG without it. */
        data class Stop(val result: ExecutionResult?) : EscalationGate()
    }

    /**
     * Read this node's outstanding escalation, if it has one.
     *
     * Cheap for the overwhelming majority of nodes: one indexed lookup on a
     * derived key, and only for nodes whose policy is `escalate`.
     */
    private fun escalationGate(
        node: WorkflowNode,
        ctx: RuntimeContext,
        source: String,
    ): EscalationGate {
        if (node.failurePolicy.onFailure != FailurePolicy.ESCALATE) return EscalationGate.Proceed
        if (!escalationEnabled) return EscalationGate.Proceed

        val last = latestEscalation(ctx.runId, node.id) ?: return EscalationGate.Proceed

        if (last.status == com.vectorbea.worker.durable.wait.RunWait.Status.WAITING) {
            /* Still open. The run was woken by something else — another branch's
               signal, a reconciler sweep — and this node is still owed an answer,
               so it re-parks on the wait it already has rather than asking twice. */
            return EscalationGate.Stop(ExecutionResult.Waiting(
                waitId = last.id.toString(),
                kind = "signal",
                nodeId = node.id,
                label = last.label ?: "Escalated: ${nodeLabel(node)}",
                timeoutAt = last.timeoutAt,
            ))
        }

        return when (val decision = decisionOf(last)) {
            /* Fall through and run it. If it fails again, the failure handler
               opens the NEXT escalation — the attempt number advances, so a
               resolved wait is never read twice and "retry" cannot loop. */
            "retry" -> {
                emitEvent(ctx, EventType.RUN_WAIT_RESOLVED, "running", source,
                    title  = "Escalation answered: retry ${nodeLabel(node)}",
                    stepId = node.id,
                    meta   = "{\"decision\":\"retry\",\"waitId\":${jsonStr(last.id.toString())}}")
                EscalationGate.Proceed
            }
            "skip" -> {
                ctx.markSkipped(node.id)
                recordRibbon(ctx, node.id, RibbonWriter.State.SKIPPED)
                emitEvent(ctx, EventType.STEP_SKIPPED, "running", source,
                    title   = "Escalation answered: skip ${nodeLabel(node)}",
                    summary = "A person chose to continue past this failure.",
                    stepId  = node.id,
                    meta    = "{\"decision\":\"skip\",\"waitId\":${jsonStr(last.id.toString())}}")
                EscalationGate.Stop(null)
            }
            else -> {
                /* `abort`, and also what a TIMED-OUT escalation reads as. Nobody
                   answered, so continuing would carry on as though a failed step
                   had succeeded. */
                emitEvent(ctx, EventType.RUN_WAIT_RESOLVED, "running", source,
                    title  = "Escalation answered: $decision — ${nodeLabel(node)}",
                    stepId = node.id,
                    meta   = "{\"decision\":${jsonStr(decision)}," +
                             "\"waitId\":${jsonStr(last.id.toString())}}")
                EscalationGate.Stop(ExecutionResult.Failed(
                    "Node ${node.id} (${node.type}) failed and its escalation was answered " +
                        "with `$decision`."))
            }
        }
    }

    /**
     * Ask, and park.
     *
     * The node is left PENDING rather than FAILED, so the gate above sees it on
     * the next tick and the answer is read before the node can run again.
     */
    private fun openEscalation(
        node: WorkflowNode,
        ctx: RuntimeContext,
        source: String,
        reason: String,
    ): ExecutionResult? {
        if (!escalationEnabled) {
            log.warn("[runtime] node {} asked to escalate but escalation is off — failing " +
                "the run instead [runId={}]", node.id, ctx.runId)
            return ExecutionResult.Failed("Node ${node.id} (${node.type}) failed: $reason")
        }

        val attempt = escalationCount(ctx.runId, node.id)
        if (attempt >= maxEscalations) {
            log.error("[runtime] node {} escalated {} times [runId={}]",
                node.id, maxEscalations, ctx.runId)
            return ExecutionResult.Failed(
                "Node ${node.id} failed and was escalated $maxEscalations times without " +
                    "succeeding. The last failure was: $reason")
        }

        val signalName = node.failurePolicy.escalationSignal ?: "escalation:${node.id}"
        val opened = waits.open(com.vectorbea.worker.durable.wait.WaitStore.OpenRequest(
            workspaceId = ctx.workspaceId,
            environmentId = ctx.environmentId,
            runId = ctx.runId,
            workflowId = ctx.workflowId,
            nodeId = escalationNodeId(node.id),
            attemptGroup = attempt,
            kind = com.vectorbea.worker.durable.wait.WaitKind.SIGNAL,
            label = "Escalated: ${nodeLabel(node)}",
            signalName = signalName,
            timeoutMs = node.failurePolicy.escalationTimeoutMs,
            /* Already sanitized — `reason` came through `sanitizeError`.
               Invariant 4: the store writes what it is given. */
            metadata = mapOf(
                "escalation" to true,
                "nodeId" to node.id,
                "nodeType" to node.type,
                "attempt" to attempt,
                "reason" to reason.take(500),
                "signalName" to signalName,
                "decisions" to listOf("retry", "skip", "abort"),
            ),
        ))

        /* PENDING, not FAILED: the gate has to see this node again to read the
           answer, and a failed node is never scheduled. */
        ctx.markPending(node.id)
        recordRibbon(ctx, node.id, RibbonWriter.State.GATED)

        emitEvent(ctx, EventType.RUN_WAIT_STARTED, "waiting_for_event", source,
            title   = "Escalated: ${nodeLabel(node)}",
            summary = "This step failed and its policy asks a person to decide. Send the " +
                "signal '$signalName' with a decision of retry, skip or abort.",
            stepId  = node.id,
            meta    = "{\"waitId\":${jsonStr(opened.wait.id.toString())}," +
                      "\"waitKind\":\"signal\",\"escalation\":true," +
                      "\"signalName\":${jsonStr(signalName)}," +
                      "\"attempt\":$attempt,\"nodeId\":${jsonStr(node.id)}}")

        /* Unconditional, like every other wait: resuming without one would
           replay the node from before it failed and lose the answer. */
        writeCheckpoint(node.id, ctx, source)

        return ExecutionResult.Waiting(
            waitId = opened.wait.id.toString(),
            kind = "signal",
            nodeId = node.id,
            label = "Escalated: ${nodeLabel(node)}",
            timeoutAt = opened.wait.timeoutAt,
        )
    }

    /**
     * The node id an escalation's wait is filed under.
     *
     * Suffixed so it cannot collide with the node's OWN wait — an async tool
     * that parks and then fails would otherwise reuse the same derived key and
     * the escalation would silently resolve against the tool's answer.
     */
    private fun escalationNodeId(nodeId: String) = "$nodeId#escalation"

    /** How many times this node has been escalated. Probes the derived keys. */
    private fun escalationCount(runId: java.util.UUID, nodeId: String): Int {
        var n = 0
        while (n < maxEscalations) {
            val key = com.vectorbea.worker.durable.wait.RunWait.keyFor(
                runId, escalationNodeId(nodeId), n)
            if (runCatching { waits.findByKey(runId, key) }.getOrNull() == null) return n
            n++
        }
        return n
    }

    /** The most recent escalation wait for a node, or null if it has never had one. */
    private fun latestEscalation(
        runId: java.util.UUID,
        nodeId: String,
    ): com.vectorbea.worker.durable.wait.RunWait? {
        val count = escalationCount(runId, nodeId)
        if (count == 0) return null
        val key = com.vectorbea.worker.durable.wait.RunWait.keyFor(
            runId, escalationNodeId(nodeId), count - 1)
        return runCatching { waits.findByKey(runId, key) }.getOrNull()
    }

    /**
     * The decision a person gave, defaulting to `abort`.
     *
     * A TIMED-OUT escalation has no payload, and `abort` is the right reading of
     * "nobody answered": continuing would report a failed step as done, and
     * retrying unanswered is what [maxEscalations] exists to stop. Anything
     * outside the three words is treated the same way — an unrecognised decision
     * is not a licence to guess.
     */
    private fun decisionOf(wait: com.vectorbea.worker.durable.wait.RunWait): String {
        val payload = wait.resolutionJson ?: return "abort"
        val found = runCatching {
            val tree = mapper.readTree(payload)
            listOf("/payload/decision", "/decision")
                .map { tree.at(it) }
                .firstOrNull { !it.isMissingNode && it.isTextual }
                ?.asText()?.lowercase()?.trim()
        }.getOrNull()
        return if (found in setOf("retry", "skip", "abort")) found!! else "abort"
    }

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
        // Same reason as executeSingleNode: a fan-out that takes a while is a
        // running node, and the ribbon has to say so while it runs.
        recordRibbon(ctx, parallelNode.id, RibbonWriter.State.EXECUTING)

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
                // The ribbon carries an `executing` entry for this node from the
                // line above; leaving it there would show a permanently running
                // cell on a run that has already stopped.
                recordRibbon(ctx, parallelNode.id, RibbonWriter.State.FAILED)
                return ExecutionResult.Failed("PARALLEL node ${parallelNode.id} failed: ${parallelResult.reason}")
            }
            is NodeResult.Completed -> {
                ctx.setOutput(parallelNode.id, parallelResult.output)
                ctx.markCompleted(parallelNode.id)
                recordRibbon(ctx, parallelNode.id, RibbonWriter.State.COMMITTED)
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
                /*
                 * A branch that parks is named here for the same reason the
                 * ceiling arm above is: so it appears in the log rather than being
                 * swallowed by an `else`.
                 *
                 * It is a real possibility, not a defensive one — an async tool
                 * inside a parallel fan-out parks its branch, and the branch
                 * result travels up to `executeParallelNode`, which returns the
                 * first non-succeeded result. So the wait reaches the top level
                 * and the run parks, which is correct: the fan-out cannot join
                 * until that branch has its answer.
                 */
                is ExecutionResult.Waiting            -> "waiting on ${result.kind}"
            }
            log.info("[runtime] branch {} → {} [parallelId={}]", entryNodeId, status, parallelNode.id)
        }

        /*
         * ── HOW MANY BRANCHES HAVE TO SURVIVE IS NOW DECLARED ─────────────
         *
         * This was a hard-coded rule — tolerate partial failures, fail only when
         * every branch failed — and it is right for "check five services" and
         * wrong for "drain the node, update DNS, verify", where one branch
         * failing quietly means the run reports success having done two thirds
         * of the work. `require_one` is the default, so a graph that says
         * nothing behaves exactly as it did.
         */
        val failedBranches = branchResults.filter { it.third is ExecutionResult.Failed }
        val branchPolicy = parallelNode.failurePolicy.branchFailure
        val fanOutFailed = when (branchPolicy) {
            FailurePolicy.BRANCH_ALL_MUST_SUCCEED -> failedBranches.isNotEmpty()
            FailurePolicy.BRANCH_TOLERATE_ALL -> false
            else -> failedBranches.size == branchResults.size   // require_one
        }
        if (fanOutFailed) {
            val firstReason = (failedBranches.first().third as ExecutionResult.Failed).reason
            val which = failedBranches.joinToString { it.first }
            log.error("[runtime] {}/{} branches failed for parallel node {} under policy {} — " +
                "aborting [failed={}]",
                failedBranches.size, branchResults.size, parallelNode.id, branchPolicy, which)
            emitEvent(ctx, EventType.STEP_FAILED, "running", source,
                title   = "Fan-out failed: ${nodeLabel(parallelNode)}",
                summary = "${failedBranches.size} of ${branchResults.size} branches failed, and " +
                    "this fan-out's policy is `$branchPolicy`.",
                stepId  = parallelNode.id,
                error   = """{"reason":${jsonStr(firstReason)},"branchFailure":${jsonStr(branchPolicy)},
                             "failedBranches":${jsonStr(which)}}""".trimIndent())
            ctx.markFailed(parallelNode.id)
            recordRibbon(ctx, parallelNode.id, RibbonWriter.State.FAILED)
            return ExecutionResult.Failed(
                "${failedBranches.size} of ${branchResults.size} parallel branches failed for " +
                    "node ${parallelNode.id} under policy `$branchPolicy`. First reason: $firstReason"
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
                /*
                 * Which span this event happened inside, so any log line can be
                 * located in the tree. Resolved from the step's registry entry when
                 * the event names a step, else the tick — which is what makes
                 * "show me the events for this span" answerable without timestamps.
                 */
                spanId = ctx.tracer?.let { t ->
                    stepId?.let { t.spanForNode(it) } ?: t.tickSpanId
                },
            ))
        }.onFailure { e ->
            log.warn("[runtime] failed to emit event [type={}, runId={}]: {}", type, ctx.runId, e.message)
        }
    }

    /**
     * Queue a partial delivery for a node that just committed.
     *
     * ── THE SEQUENCE IS THE PARTIAL COUNT, NOT THE NODE INDEX ──────────
     * It has to be stable across re-execution, because a resumed run re-enters
     * this path and the idempotency key is derived from it — a sequence that
     * shifted would make a receiver see the same partial twice under two keys.
     * Deriving it from the node's position in the graph gives exactly that
     * stability, and the `ON CONFLICT` on `(run, target, sequence)` makes a
     * re-execution a no-op rather than a duplicate.
     *
     * Sequence 0 is the terminal delivery, so partials start at 1.
     *
     * `runCatching` throughout: streaming is a courtesy on top of a run that is
     * going fine, and a failure to queue a partial must never fail the node that
     * produced it.
     */
    private fun streamPartial(
        node: WorkflowNode,
        result: NodeResult.Completed,
        ctx: RuntimeContext,
    ) {
        val store = deliveries ?: return
        runCatching {
            val targets = store.streamingTargetsFor(
                ctx.workspaceId, ctx.environmentId, ctx.workflowId)
            if (targets.isEmpty()) return

            /* +1 so the first partial is sequence 1. `indexOf` on the graph's own
               node order is the stable position; a node not in the graph (which
               should not happen) falls back to a hash so the key is still
               deterministic rather than colliding on 1. */
            val position = ctx.graph.nodes.indexOfFirst { it.id == node.id }
                .let { if (it >= 0) it + 1 else (node.id.hashCode() and 0x7fff) + 1 }

            val outputJson = runCatching {
                jacksonObjectMapper().writeValueAsString(result.output)
            }.getOrDefault("{}")

            for (target in targets) {
                /* An empty `streamNodes` means every committed node. Named nodes
                   are the shape to encourage — a wide graph streaming every node
                   is a lot of deliveries for a receiver who wanted three. */
                if (target.streamNodes.isNotEmpty() && node.id !in target.streamNodes) continue
                store.enqueuePartial(
                    workspaceId = ctx.workspaceId,
                    environmentId = ctx.environmentId,
                    runId = ctx.runId,
                    target = target,
                    sequence = position,
                    nodeId = node.id,
                    outputJson = outputJson,
                )
            }
        }.onFailure {
            log.warn("[runtime] could not stream partial for node {}: {}", node.id, it.message)
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
    /**
     * Take delivery of anything sent to this run since the last step.
     *
     * ── WHERE A DELIVERED SIGNAL LANDS ──────────────────────────────────────
     * As a step output under [SIGNALS_STEP_ID], so it is addressable from the
     * expression language the workflow already has — `steps.__signals__.latest`
     * — and so it survives the checkpoint like every other step output. A
     * separate side-channel would need its own persistence, its own restore, and
     * its own syntax, and would be invisible to every existing mapping.
     *
     * ── ACCUMULATED, NEVER REPLACED ─────────────────────────────────────────
     * Three alerts for one incident are three items in order, not the third one.
     * A run that only ever saw the newest would be unable to say the alert count
     * went up, which for an incident run is most of the information.
     *
     * ── CONSUMED AFTER IT IS VISIBLE, NOT BEFORE ────────────────────────────
     * The output is written first and the rows marked consumed second. A crash
     * between them redelivers the signal on the next tick — at-least-once, and
     * the run sees a duplicate item — where the other order would lose it
     * silently. For an incident alert, seeing one twice beats never seeing it.
     */
    @Suppress("UNCHECKED_CAST")
    private fun deliverPendingSignals(ctx: RuntimeContext, source: String) {
        val store = signals ?: return
        val pending = try {
            store.pending(ctx.runId)
        } catch (e: Exception) {
            log.warn("[runtime] signal delivery lookup failed [runId={}]: {}", ctx.runId, e.message)
            return
        }
        if (pending.isEmpty()) return

        val existing = ctx.getOutput(SIGNALS_STEP_ID)
        val items = ((existing["items"] as? List<Map<String, Any?>>) ?: emptyList()).toMutableList()
        pending.forEach { items += it.asObservation(mapper) }

        ctx.setOutput(SIGNALS_STEP_ID, mapOf(
            "items" to items,
            "count" to items.size,
            "latest" to (items.lastOrNull() ?: emptyMap<String, Any?>()),
            /* The names seen so far, so a branch can ask "has a `cancel` arrived"
               without walking the list in an expression. */
            "names" to items.mapNotNull { it["signal"] as? String }.distinct(),
        ))

        pending.forEach { signal ->
            emitEvent(ctx, EventType.SIGNAL_DELIVERED, "running", source,
                title = "Signal delivered: ${signal.name}",
                summary = "Signal #${signal.sequence} reached the run at a step boundary.",
                meta = "{\"signal\":${jsonStr(signal.name)},\"sequence\":${signal.sequence}}")
        }

        store.consume(pending.map { it.id }, waitId = null)
        log.info("[runtime] delivered {} signal(s) at step boundary [runId={}]",
            pending.size, ctx.runId)
    }

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

    /**
     * When this tick's wall clock runs out, for a node that can stop between
     * sub-units of its own work.
     *
     * The SAME budget the tracker enforces, expressed as a deadline. One source,
     * so a node that stops early and the runtime that yields afterwards cannot
     * disagree about when the tick ended. See RuntimeContext.tickDeadlineAtMs.
     */
    private fun tickDeadline(): Long? =
        executionBudget?.maxWallClockMs?.takeIf { it > 0 }?.let { System.currentTimeMillis() + it }

    private fun writeCheckpoint(nodeId: String, ctx: RuntimeContext, source: String) {
        runCatching {
            val snap = ctx.snapshot()
            val cpId = checkpointStore.save(ctx.runId, ctx.workspaceId, ctx.environmentId, nodeId, snap)
            emitEvent(ctx, EventType.CHECKPOINT_CREATED, "running", source,
                title  = "Checkpoint saved after node $nodeId",
                stepId = nodeId,
                meta   = """{"checkpointId":"$cpId","sequence":${snap.sequence}}""")
        }.onFailure { e ->
            /*
             * ── STILL SWALLOWED, BUT NO LONGER QUIETLY ───────────────────
             * A checkpoint that cannot be written must not fail a run — the work
             * is done and the outputs are durable; what is lost is the ability to
             * resume cheaply. But `warn` was too quiet for what it was reporting:
             * this line fired on EVERY checkpoint of EVERY run for as long as
             * `run_checkpoints` had two conflicting definitions (see V069), and a
             * warning that always fires is a warning nobody reads.
             *
             * `error`, and it says what the consequence is, because "checkpoint
             * write failed" does not tell an operator that their long runs are
             * silently replaying from the start.
             */
            log.error("[runtime] CHECKPOINT NOT WRITTEN [nodeId={}, runId={}]: {} — this run " +
                "will resume by replaying from its first node, re-executing every step " +
                "before this one", nodeId, ctx.runId, e.message)
            com.vectorbea.worker.metrics.WorkerMetrics.checkpointWriteFailures.inc()
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
        node: com.vectorbea.graph.WorkflowNode,
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
     * The first downstream node that would do something irreversible.
     *
     * The gate payload uses this to tell a reviewer what approving actually causes -
     * "this will send an email" rather than "the run will continue". Best-effort and
     * one hop only: a reviewer needs the immediate consequence, and walking the whole
     * transitive graph would produce a list nobody reads.
     */
    private fun firstDownstreamSideEffect(
        node: com.vectorbea.graph.WorkflowNode,
        scheduler: GraphScheduler,
        ctx: RuntimeContext,
    ): String? = runCatching {
        scheduler.graph.edges
            .filter { it.source == node.id }
            .mapNotNull { e -> scheduler.graph.nodes.firstOrNull { it.id == e.target } }
            .firstOrNull { it.nodeType in SIDE_EFFECTING }
            ?.let { nodeLabel(it) }
    }.getOrNull()

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
                    // The dollar was escaped, so every contract gate was titled
                    // with the literal text "$nodeId" instead of the node.
                    stmt.setString(7, "Contract gate on '" + nodeId + "'")
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
     * Does this node's `skipIf` expression match?
     *
     * THE FAIL-OPEN DIRECTION MATTERS AND IT IS NOT THE EVALUATOR'S.
     * `ConditionEvaluator` returns `true` for anything it cannot parse, because
     * for an EDGE that means "follow it" and a graph must keep advancing. Reusing
     * that default here would mean "skip the step", so a typo in the expression
     * would silently omit the work. The expression is therefore only honoured
     * when it is one of the forms the evaluator actually recognises; anything
     * else runs the step and says so in the log.
     */
    private fun shouldSkip(node: WorkflowNode, resolvedInputs: Map<String, Any>): Boolean {
        val raw = (node.config["skipIf"] as? String)?.trim()
        if (raw.isNullOrEmpty()) return false

        // The expression is written against this node's inputs, so `input.` and
        // `output.` have to resolve against the same map. ConditionEvaluator
        // strips `output.`/`result.` itself; `input.` is normalised here.
        val expr = raw.removePrefix("{{").removeSuffix("}}").trim().replace("input.", "output.")

        val recognised = COMPARISON.containsMatchIn(expr) ||
            expr.equals("true", ignoreCase = true) ||
            expr.equals("false", ignoreCase = true) ||
            expr.startsWith("!") ||
            resolvedInputs.containsKey(expr.removePrefix("output."))

        if (!recognised) {
            log.warn("[runtime] skipIf '{}' on node {} is not an expression this engine understands — " +
                "running the step. Use a comparison such as output.amount < 100.", raw, node.id)
            return false
        }

        val matched = com.vectorbea.worker.runtime.graph.ConditionEvaluator.evaluate(expr, resolvedInputs)
        if (matched) log.info("[runtime] node skipped by skipIf [nodeId={}, expr={}]", node.id, raw)
        return matched
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

    /**
     * Close the tick, and close the run span only when the run is actually over.
     *
     * A yield or an approval pause ends the TICK but not the run — leaving the run
     * span `running` is what lets the next tick's spans attach to it and what makes
     * a multi-tick waterfall readable as one run rather than several.
     */
    private fun finishTrace(
        ctx: RuntimeContext, result: ExecutionResult, startedAtMs: Long,
    ) = runCatching {
        val t = ctx.tracer ?: return@runCatching
        t.closeTick(status = when (result) {
            is ExecutionResult.Succeeded -> "ok"
            is ExecutionResult.Failed, is ExecutionResult.CeilingExceeded -> "error"
            else -> "paused"
        })
        val terminal = result is ExecutionResult.Succeeded ||
            result is ExecutionResult.Failed ||
            result is ExecutionResult.Cancelled ||
            result is ExecutionResult.CeilingExceeded
        if (terminal) {
            t.closeRunSpan(
                name = "run",
                status = when (result) {
                    is ExecutionResult.Succeeded -> "ok"
                    is ExecutionResult.Cancelled -> "cancelled"
                    else -> "error"
                },
                startedAt = java.time.Instant.ofEpochMilli(startedAtMs),
            )
        }
        /* The registry holds in-flight work only; a tick that ended with spans still
           open leaves nothing behind for the next one to trip over. */
        t.clear()
    }

    /**
     * The gap since this run was last touched, as an explicit `wait` span.
     *
     * A waterfall with an unexplained hole in it looks like the product hanging, and
     * generates more support tickets than an error does. The reason comes from the
     * status the run was parked in, which is already durable — the worker was not
     * running during the gap, so this is the only moment it can be recorded.
     */
    private fun emitWaitSpanForGapBefore(
        ctx: RuntimeContext, tracer: com.vectorbea.worker.events.RunTracer,
    ) {
        val ds = dataSource ?: return
        runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT status, updated_at FROM agent_runs WHERE id = ?"
                ).use { st ->
                    st.setObject(1, ctx.runId)
                    st.executeQuery().use { rs ->
                        if (!rs.next()) return@use
                        val prevStatus = rs.getString("status") ?: return@use
                        val since = rs.getTimestamp("updated_at")?.toInstant() ?: return@use
                        val reason = when (prevStatus) {
                            "waiting_for_approval" -> "approval"
                            "waiting_for_timer"    -> "timer"
                            "yielded"              -> "throttle"
                            "queued", "claimed"    -> "queue"
                            "recovering"           -> "queue"
                            else                   -> return@use   // not a wait
                        }
                        tracer.emitWait(reason, since, java.time.Instant.now())
                    }
                }
            }
        }
    }

    /**
     * One tracer per run execution, or null when tracing is off.
     *
     * `trace_id` is the run id, per the trace model: a run is a trace, and child runs
     * (P4) will carry the ROOT run's id here so a dispatched subtree stays in one
     * trace rather than starting a second one.
     */
    private fun tracerFor(runId: java.util.UUID, workspaceId: java.util.UUID):
        com.vectorbea.worker.events.RunTracer? =
        spanWriter?.let {
            com.vectorbea.worker.events.RunTracer(it, traceId = runId, runId = runId,
                workspaceId = workspaceId, runCreatedAt = runCreatedAt(runId))
        }

    /**
     * The run's durable start, for the run span's partition key.
     *
     * One small query per tick, and it buys the thing the run span's idempotency
     * always depended on: a `created_at` that is the same on every tick and in
     * every process. See [com.vectorbea.worker.events.RunTracer.runCreatedAt].
     *
     * Falls back to now() when the row cannot be read, which reproduces the old
     * behaviour — a row per tick — rather than failing a run over a trace detail.
     */
    private fun runCreatedAt(runId: java.util.UUID): java.time.Instant =
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    "SELECT COALESCE(started_at, created_at) FROM agent_runs WHERE id = ?"
                ).use { st ->
                    st.setObject(1, runId)
                    st.executeQuery().use { rs ->
                        if (rs.next()) rs.getTimestamp(1)?.toInstant() else null
                    }
                }
            }
        }.getOrNull() ?: java.time.Instant.now()
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
