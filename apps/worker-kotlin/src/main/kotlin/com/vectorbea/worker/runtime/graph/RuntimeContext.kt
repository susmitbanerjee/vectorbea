package com.vectorbea.worker.runtime.graph

import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Mutable execution context for a single workflow run.
 *
 * Tracks:
 *  - node status (pending / running / completed / failed / skipped)
 *  - step outputs — keyed by nodeId, value is a parsed output map
 *  - selected edges — edges chosen after each completed node
 *  - fork depth — for parallel branch isolation
 *
 * Thread-safety: all state mutations are synchronised on [this].
 * Callers driving parallel branches should use [fork]/[merge].
 *
 * SECURITY: [workflowInput] is treated as untrusted user data and must
 * never be logged raw.  Node outputs are derived from execution results
 * and may contain user data — same restriction applies.
 */
class RuntimeContext(
    val runId: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val workflowVersionId: UUID,
    val workflowId: UUID = workflowVersionId,
    /** Raw workflow input — treat as untrusted, do not log. */
    val workflowInput: Map<String, Any>,
    val graph: WorkflowGraph,
    /** True for "Debug Run" — when set, the runtime captures per-node debug snapshots. */
    val debugMode: Boolean = false,
    /**
     * Nodes the operator explicitly asked to re-execute (RETRY_NODE / resume overrides).
     * The step-idempotency guard is bypassed for these so a deliberate retry always runs.
     */
    val forceReexecuteNodeIds: Set<String> = emptySet(),
    /**
     * Which logical attempt-group this run belongs to.
     *
     * Increments only on user-initiated re-runs, never on automatic retries, and
     * is the third component of every side-effect idempotency key. That is what
     * makes a retry share a key with the operation it retries (so it dedupes)
     * while a deliberate re-run gets a fresh one (so it genuinely runs again).
     */
    val attemptGroup: Int = 0,
    /**
     * The lease token this worker holds for the run, or null when unfenced.
     * Recorded on side effects so an incident can be traced to a worker+lease.
     */
    val leaseToken: String? = null,
    /**
     * Whether an agent step may rebuild its loop from persisted iterations instead
     * of replaying from iteration 1.
     *
     * TRUE FOR A CONTINUATION, FALSE FOR A FRESH START. A RESUME_RUN — after an
     * approval, a timer, a yield, or a crash-recovery re-enqueue — is the same
     * logical execution picking up where it stopped, and repeating the LLM calls it
     * already paid for is pure waste. A RETRY_NODE or a REPLAY_RUN is not: someone
     * asked for the work to happen AGAIN, and a replay in particular exists to
     * re-exercise the provider calls that reconstruction would skip.
     *
     * Passed explicitly rather than derived from [attemptGroup], which would be the
     * natural home for it, because attemptGroup is currently always 0 — nothing
     * increments it — and fixing that changes idempotency key derivation, which is
     * its own decision. When it is wired, this flag should be derived from it and
     * this parameter deleted.
     */
    val allowLoopReconstruction: Boolean = false,
    /**
     * Trace bookkeeping for this run execution, or null when tracing is off.
     *
     * Carried here because it is the one object every layer already receives.
     * Observability only: nothing reads it to make a decision, and every call
     * through it is null-safe, so a run behaves identically with it absent.
     */
    val tracer: com.vectorbea.worker.events.RunTracer? = null,
    /**
     * When this tick's execution budget runs out, as epoch millis. Null when
     * unbounded.
     *
     * ── WHY A NODE CAN SEE THIS AT ALL ──────────────────────────────────────
     * `WorkflowRuntime` checks the budget BETWEEN nodes, which is right for every
     * node that finishes in one bounded operation. An `agent_team` node does not:
     * it is several agent loops, and a fan-out to five workers can outlast a tick
     * on its own. Between-nodes checking would let one team node hold a worker for
     * the whole fan-out and then discover the tick was spent.
     *
     * Read-only and advisory. Nothing decides a RUN outcome from it — the team
     * uses it to stop STARTING new children, and the children it already created
     * are durable and reattach, so the resumed execution continues rather than
     * repeating. It is not a second budget, and it is not a scheduler.
     */
    val tickDeadlineAtMs: Long? = null,
    /**
     * Which queue lane this run came off, or null when unknown.
     *
     * ── WHY A NODE NEEDS TO KNOW ────────────────────────────────────────────
     * §12.4's provider token bucket gives interactive lanes first draw: batch
     * work may only draw a bucket down to a reserved floor, interactive may draw
     * it to zero. That is a property of the RUN, decided at claim time, and the
     * only object every layer already receives is this one.
     *
     * Advisory and read-only, like [tickDeadlineAtMs]. Nothing decides a run
     * outcome from it, and a null lane behaves as batch — the conservative
     * reading, since mislabelling batch work as interactive is what would let a
     * fan-out eat the reserve it exists to protect.
     */
    val executionLane: com.vectorbea.worker.queue.WorkerJobType? = null,
) {
    /** Number of attempts seen so far per node — used to tag retry attempts in debug snapshots. */
    private val nodeAttempts: MutableMap<String, Int> = ConcurrentHashMap()

    fun nextAttempt(nodeId: String): Int = synchronized(this) {
        val n = (nodeAttempts[nodeId] ?: 0) + 1
        nodeAttempts[nodeId] = n
        n
    }

    enum class NodeStatus { PENDING, RUNNING, COMPLETED, FAILED, SKIPPED }

    // ── Node state ────────────────────────────────────────────────────────────

    private val nodeStatus: MutableMap<String, NodeStatus> = ConcurrentHashMap()
    private val stepOutputs: MutableMap<String, Map<String, Any>> = ConcurrentHashMap()
    private val selectedEdges: MutableSet<String> = ConcurrentHashMap.newKeySet()
    /** Ordered list of node IDs as they completed — used to resolve 'previous' in templates. */
    private val completionOrder: MutableList<String> = java.util.Collections.synchronizedList(mutableListOf())

    // ── Sequence counter (local; persisted to DB by WorkflowRuntime) ──────────

    @Volatile
    var sequence: Int = 0
        private set

    fun nextSequence(): Int = synchronized(this) { ++sequence }
    fun restoreSequence(seq: Int) = synchronized(this) { if (seq > sequence) sequence = seq }

    // ── Node status queries ───────────────────────────────────────────────────

    fun statusOf(nodeId: String): NodeStatus = nodeStatus[nodeId] ?: NodeStatus.PENDING

    fun isCompleted(nodeId: String): Boolean = statusOf(nodeId) == NodeStatus.COMPLETED
    fun isFailed(nodeId: String): Boolean    = statusOf(nodeId) == NodeStatus.FAILED
    fun isTerminal(nodeId: String): Boolean  = statusOf(nodeId) in setOf(NodeStatus.COMPLETED, NodeStatus.FAILED, NodeStatus.SKIPPED)
    fun isPending(nodeId: String): Boolean   = statusOf(nodeId) == NodeStatus.PENDING

    fun completedNodeIds(): Set<String> = nodeStatus.filterValues { it == NodeStatus.COMPLETED }.keys.toSet()
    fun failedNodeIds(): Set<String>    = nodeStatus.filterValues { it == NodeStatus.FAILED }.keys.toSet()
    fun pendingNodeIds(): Set<String>   = graph.nodes.map { it.id }.filter { isPending(it) }.toSet()

    // ── Node status mutations ─────────────────────────────────────────────────

    fun markRunning(nodeId: String)   = synchronized(this) { nodeStatus[nodeId] = NodeStatus.RUNNING }
    fun markCompleted(nodeId: String) = synchronized(this) { nodeStatus[nodeId] = NodeStatus.COMPLETED }
    fun markFailed(nodeId: String)    = synchronized(this) { nodeStatus[nodeId] = NodeStatus.FAILED }
    fun markSkipped(nodeId: String)   = synchronized(this) { nodeStatus[nodeId] = NodeStatus.SKIPPED }
    /** Reset a node to PENDING — used by retry-node to re-run a failed step. */
    fun markPending(nodeId: String)   = synchronized(this) { nodeStatus.remove(nodeId) }

    // ── Step outputs ──────────────────────────────────────────────────────────

    fun setOutput(nodeId: String, output: Map<String, Any>) = synchronized(this) {
        stepOutputs[nodeId] = output
        if (!completionOrder.contains(nodeId)) completionOrder.add(nodeId)
    }

    /** Returns node IDs in the order they completed, most recent last. */
    fun completionOrderedIds(): List<String> = synchronized(completionOrder) { completionOrder.toList() }

    fun getOutput(nodeId: String): Map<String, Any> = stepOutputs[nodeId] ?: emptyMap()

    fun allOutputs(): Map<String, Map<String, Any>> = HashMap(stepOutputs)

    // ── Selected edges ────────────────────────────────────────────────────────

    fun selectEdge(edgeId: String)   = selectedEdges.add(edgeId)
    fun isEdgeSelected(edgeId: String): Boolean = edgeId in selectedEdges
    fun selectedEdges(): Set<String> = HashSet(selectedEdges)

    // ── Input resolution ──────────────────────────────────────────────────────

    /**
     * Resolve a node's input mapping against current context state.
     *
     * Expression forms:
     *   "input.key"           → workflowInput["key"]
     *   "output.key"          → last node output (closest predecessor) ["key"]
     *   "steps.nodeId.key"    → stepOutputs[nodeId]["key"]
     *   "literal:value"       → "value" (verbatim)
     *   anything else         → treated as literal string
     */
    fun resolveInputMapping(node: WorkflowNode): Map<String, Any> {
        val resolved = mutableMapOf<String, Any>()
        for ((targetKey, expr) in node.inputMapping) {
            val value = resolveExpression(expr, node)
            if (value != null) resolved[targetKey] = value
        }
        return resolved
    }

    private fun resolveExpression(expr: String, node: WorkflowNode): Any? = when {
        expr.startsWith("input.") -> {
            val key = expr.removePrefix("input.")
            workflowInput[key]
        }
        expr.startsWith("steps.") -> {
            val rest  = expr.removePrefix("steps.")
            val parts = rest.split(".")
            val ref   = parts[0].lowercase()
            // "previous", "prev", "last" → last completed step before this node
            val nodeId = when (ref) {
                "previous", "prev", "last" -> {
                    // Prefer direct graph predecessors (inbound edges), most recent first
                    val inbound = graph.inboundSources(node.id).filter { isCompleted(it) }
                    inbound.lastOrNull()
                        // Fallback: the node that completed most recently across the whole run
                        ?: completionOrderedIds().lastOrNull { it != node.id }
                }
                else -> parts[0]
            }
            if (nodeId == null) null
            else {
                val outputs = stepOutputs[nodeId] ?: emptyMap()
                // Skip optional "output" segment: steps.X.output.field == steps.X.field
                val fields = if (parts.size >= 2 && parts[1] == "output") parts.drop(2) else parts.drop(1)
                if (fields.isEmpty()) {
                    // {{steps.X}} with no field — return first meaningful value
                    outputs["content"] ?: outputs["summary"] ?: outputs["result"]
                        ?: outputs.values.firstOrNull()
                } else {
                    val field = fields.last()
                    // 1. Nested lookup (steps.X.output.a.b.c)
                    val nested = fields.fold(outputs as Any?) { acc, key -> (acc as? Map<*, *>)?.get(key) }
                    // 2. Flat lookup (skip nesting)
                    val flat = outputs[field]
                    // 3. Reverse output-mapping: template uses source expr, stored under mapped key
                    //    e.g. outputMapping: {itinerary ← final_itinerary}  →  template says "final_itinerary" → return outputs["itinerary"]
                    val viaMapping = graph.nodes.firstNotNullOfOrNull { n ->
                        n.outputMapping.entries.firstOrNull { (_, srcExpr) ->
                            srcExpr.removePrefix("output.").trim() == field
                        }?.let { (storedKey, _) -> stepOutputs[n.id]?.get(storedKey) }
                    }
                    // 4. Global search across ALL step outputs for this field name
                    val globalSearch = stepOutputs.values.firstNotNullOfOrNull { it[field] }

                    nested ?: flat ?: viaMapping ?: globalSearch
                }
            }
        }
        expr.startsWith("output.") -> {
            // Resolve from the closest completed predecessor
            val key = expr.removePrefix("output.")
            val predecessors = graph.inboundSources(node.id).filter { isCompleted(it) }
            predecessors.firstNotNullOfOrNull { stepOutputs[it]?.get(key) }
        }
        expr.startsWith("literal:") -> expr.removePrefix("literal:")
        else -> expr // treat as literal
    }

    // ── Fork / merge for parallel branches ───────────────────────────────────

    /**
     * Create an isolated child context for a parallel branch.
     * The child starts with a snapshot of this context's outputs and edge selections.
     * Node status starts fresh (only pending nodes matter in child).
     */
    fun fork(branchNodeIds: Set<String>): RuntimeContext {
        val child = RuntimeContext(
            runId = runId,
            workspaceId = workspaceId,
            environmentId = environmentId,
            workflowVersionId = workflowVersionId,
            workflowId = workflowId,
            workflowInput = workflowInput,
            graph = graph,
            debugMode = debugMode,
            forceReexecuteNodeIds = forceReexecuteNodeIds,
            /* A forked branch is the same run on the same lane. Dropping it here
               would silently demote every parallel branch to batch. */
            executionLane = executionLane,
        )
        child.sequence = sequence
        // Copy parent outputs and edge selections so child can reference prior steps
        synchronized(this) {
            child.stepOutputs.putAll(stepOutputs)
            child.selectedEdges.addAll(selectedEdges)
        }
        // Mark branch-scoped nodes as pending in child (inherit parent status for non-branch nodes)
        synchronized(this) {
            for ((id, status) in nodeStatus) {
                if (id !in branchNodeIds) child.nodeStatus[id] = status
            }
        }
        return child
    }

    /**
     * Merge completed branch contexts back into this (parent) context.
     * Outputs from branch children are merged deterministically (last writer wins by nodeId order).
     * Selected edges from all branches are unioned.
     * Node statuses from branch children overwrite parent for branch-scoped nodes.
     */
    fun merge(children: List<RuntimeContext>, branchNodeIds: Set<String>) = synchronized(this) {
        for (child in children.sortedBy { it.runId.toString() }) {
            for (nodeId in branchNodeIds) {
                child.nodeStatus[nodeId]?.let { nodeStatus[nodeId] = it }
                child.stepOutputs[nodeId]?.let { stepOutputs[nodeId] = it }
            }
            selectedEdges.addAll(child.selectedEdges)
        }
        // Advance sequence to max across all children
        sequence = maxOf(sequence, children.maxOfOrNull { it.sequence } ?: sequence)
    }

    // ── Snapshot for checkpointing ────────────────────────────────────────────

    fun snapshot(): RuntimeSnapshot = synchronized(this) {
        RuntimeSnapshot(
            runId = runId,
            workspaceId = workspaceId,
            environmentId = environmentId,
            workflowVersionId = workflowVersionId,
            sequence = sequence,
            nodeStatus = HashMap(nodeStatus.mapValues { it.value.name }),
            stepOutputKeys = HashMap(stepOutputs.mapValues { it.value.keys.toList() }),
            selectedEdges = HashSet(selectedEdges),
            completedNodeIds = completedNodeIds(),
            pendingNodeIds = pendingNodeIds(),
        )
    }
}

/**
 * Serializable snapshot of [RuntimeContext] for checkpoint persistence.
 * Outputs themselves are NOT stored here to avoid storing sensitive payload data —
 * only the output schema keys are recorded for diagnostic purposes.
 */
data class RuntimeSnapshot(
    val runId: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val workflowVersionId: UUID,
    val sequence: Int,
    val nodeStatus: Map<String, String>,          // nodeId → NodeStatus.name
    val stepOutputKeys: Map<String, List<String>>, // nodeId → list of output keys (no values)
    val selectedEdges: Set<String>,
    val completedNodeIds: Set<String>,
    val pendingNodeIds: Set<String>,
)
