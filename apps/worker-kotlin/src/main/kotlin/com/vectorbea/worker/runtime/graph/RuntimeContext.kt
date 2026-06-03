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
    /** Raw workflow input — treat as untrusted, do not log. */
    val workflowInput: Map<String, Any>,
    val graph: WorkflowGraph,
) {
    enum class NodeStatus { PENDING, RUNNING, COMPLETED, FAILED, SKIPPED }

    // ── Node state ────────────────────────────────────────────────────────────

    private val nodeStatus: MutableMap<String, NodeStatus> = ConcurrentHashMap()
    private val stepOutputs: MutableMap<String, Map<String, Any>> = ConcurrentHashMap()
    private val selectedEdges: MutableSet<String> = ConcurrentHashMap.newKeySet()

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
    }

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
                    val predecessors = graph.inboundSources(node.id).filter { isCompleted(it) }
                    predecessors.lastOrNull()
                        ?: stepOutputs.keys.lastOrNull()  // fallback: globally last completed step
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
                    // Nested field lookup, e.g. steps.agent.output.itinerary.hotels
                    fields.fold(outputs as Any?) { acc, key -> (acc as? Map<*, *>)?.get(key) }
                        ?: outputs[fields.last()]  // flat fallback: ignore nesting
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
            workflowInput = workflowInput,
            graph = graph,
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
