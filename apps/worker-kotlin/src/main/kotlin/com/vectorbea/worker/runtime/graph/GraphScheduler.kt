package com.vectorbea.worker.runtime.graph

/**
 * Pure, stateless DAG scheduler.
 *
 * Given a [WorkflowGraph] and the current [RuntimeContext], answers questions
 * like "which nodes are ready to run?" and "which edges should we follow after
 * this node completes?".  All state mutations happen in [RuntimeContext]; this
 * class reads state only.
 *
 * Thread-safety: all methods are thread-safe (read-only access to immutable
 * graph structure; context reads are synchronised inside [RuntimeContext]).
 */
class GraphScheduler(private val graph: WorkflowGraph) {

    // ── Entry-point discovery ─────────────────────────────────────────────────

    /**
     * Returns the single trigger/start node.
     * Throws [InvalidGraphException] if there is none or more than one.
     */
    fun findStartNode(): WorkflowNode {
        val triggers = graph.nodes.filter { it.nodeType == NodeType.TRIGGER }
        return when (triggers.size) {
            1    -> triggers.first()
            0    -> throw InvalidGraphException("Graph has no TRIGGER node")
            else -> throw InvalidGraphException("Graph has ${triggers.size} TRIGGER nodes — exactly one required")
        }
    }

    // ── Runnable node discovery ───────────────────────────────────────────────

    /**
     * Returns nodes that are ready to be executed given the current context.
     *
     * A node N is runnable when ALL of the following hold:
     *   1. N is not yet terminal (pending status).
     *   2. At least one inbound selected edge points to N
     *      (or N is the start node with no inbound edges).
     *   3. For JOIN nodes: [joinIsReady] must be satisfied.
     *   4. N is not currently marked as RUNNING.
     */
    fun findRunnableNodes(ctx: RuntimeContext): List<WorkflowNode> {
        return graph.nodes.filter { node ->
            ctx.isPending(node.id) && isReachable(node, ctx) && !isBlocked(node, ctx)
        }
    }

    private fun isReachable(node: WorkflowNode, ctx: RuntimeContext): Boolean {
        val inbound = graph.edgesTo(node.id)
        if (inbound.isEmpty()) return true // start node or disconnected (allow)
        return inbound.any { ctx.isEdgeSelected(it.id) }
    }

    private fun isBlocked(node: WorkflowNode, ctx: RuntimeContext): Boolean {
        if (node.nodeType == NodeType.JOIN) return !joinIsReady(node, ctx)
        return false
    }

    // ── Edge selection after node completion ──────────────────────────────────

    /**
     * Determine which outgoing edges to activate after [node] completes with [output].
     * Marks the selected edges in [ctx] and returns the list.
     *
     * Rules:
     *  - BRANCH nodes: evaluate each edge's condition; select edges where condition is true.
     *    If no branch edge matches, select the first FALSE/DEFAULT edge as fallback.
     *  - PARALLEL nodes: select all outgoing PARALLEL edges.
     *  - END nodes: select no edges (terminal).
     *  - All others: select all outgoing SUCCESS/DEFAULT edges whose conditions pass.
     */
    fun selectEdgesAfterNode(
        node: WorkflowNode,
        output: Map<String, Any>,
        ctx: RuntimeContext,
    ): List<WorkflowEdge> {
        val outEdges = graph.edgesFrom(node.id)
        if (outEdges.isEmpty()) return emptyList()

        val selected: List<WorkflowEdge> = when (node.nodeType) {
            NodeType.BRANCH   -> selectBranchEdges(outEdges, output)
            NodeType.PARALLEL -> outEdges.filter { it.edgeType == EdgeType.PARALLEL || it.edgeType == EdgeType.DEFAULT }
            NodeType.END      -> emptyList()
            else              -> outEdges.filter { edge ->
                edge.edgeType in setOf(EdgeType.SUCCESS, EdgeType.DEFAULT) &&
                        ConditionEvaluator.evaluate(edge.condition, output)
            }
        }

        selected.forEach { ctx.selectEdge(it.id) }
        return selected
    }

    /**
     * Activate the failure edges after a node fails.
     * If the node's [FailurePolicy.onFailure] is "follow_failure_edge", picks FAILURE edges.
     * Otherwise returns empty (caller should fail the run).
     */
    fun selectEdgesAfterFailure(node: WorkflowNode, ctx: RuntimeContext): List<WorkflowEdge> {
        if (node.failurePolicy.onFailure != "follow_failure_edge") return emptyList()
        val failEdges = graph.edgesFrom(node.id).filter { it.edgeType == EdgeType.FAILURE }
        failEdges.forEach { ctx.selectEdge(it.id) }
        return failEdges
    }

    private fun selectBranchEdges(edges: List<WorkflowEdge>, output: Map<String, Any>): List<WorkflowEdge> {
        // Evaluate all branch/TRUE/FALSE edges; take those where condition matches
        val branchEdges = edges.filter { it.edgeType in setOf(EdgeType.BRANCH, EdgeType.TRUE, EdgeType.FALSE, EdgeType.DEFAULT) }

        val matched = branchEdges.filter { ConditionEvaluator.evaluate(it.condition, output) }
        if (matched.isNotEmpty()) return matched

        // Fallback: take first FALSE or DEFAULT edge
        val fallback = branchEdges.firstOrNull { it.edgeType == EdgeType.FALSE }
            ?: branchEdges.firstOrNull { it.edgeType == EdgeType.DEFAULT }
        return listOfNotNull(fallback)
    }

    // ── Parallel / Join ───────────────────────────────────────────────────────

    /**
     * Returns the parallel node that spawned the given branch nodes.
     * Walks inbound edges until a PARALLEL node is found.
     */
    fun findParallelSource(joinNode: WorkflowNode): WorkflowNode? {
        // A join node is connected from all branches that the parallel node fanned out to.
        // We find the parallel node by following edges backwards until we hit a PARALLEL type.
        val visited = mutableSetOf<String>()
        val queue   = ArrayDeque(graph.inboundSources(joinNode.id).toList())
        while (queue.isNotEmpty()) {
            val id = queue.removeFirst()
            if (id in visited) continue
            visited.add(id)
            val n = graph.nodeById(id) ?: continue
            if (n.nodeType == NodeType.PARALLEL) return n
            graph.inboundSources(id).forEach { queue.add(it) }
        }
        return null
    }

    /**
     * Returns all nodes that are part of a parallel branch between [parallelNode] and [joinNode].
     * Used to determine which nodes to fork into child contexts.
     */
    fun branchNodesBetween(parallelNode: WorkflowNode, joinNode: WorkflowNode): Set<String> {
        val result  = mutableSetOf<String>()
        val visited = mutableSetOf<String>()
        val queue   = ArrayDeque(graph.edgesFrom(parallelNode.id).map { it.target })
        while (queue.isNotEmpty()) {
            val id = queue.removeFirst()
            if (id in visited || id == joinNode.id) continue
            visited.add(id)
            result.add(id)
            graph.edgesFrom(id).map { it.target }.forEach { queue.add(it) }
        }
        return result
    }

    /**
     * Determines whether a JOIN node is ready to execute.
     *
     * wait_all (default): all inbound branches must have a terminal node pointing to the join
     * via a selected edge, meaning all branch paths have completed or been skipped.
     */
    fun joinIsReady(joinNode: WorkflowNode, ctx: RuntimeContext): Boolean {
        val policy = joinNode.config["joinPolicy"] as? String ?: "wait_all"
        val inboundEdges = graph.edgesTo(joinNode.id)
        if (inboundEdges.isEmpty()) return true

        return when (policy) {
            "wait_all" -> {
                // Every inbound edge must be selected (i.e., its source completed)
                inboundEdges.all { edge ->
                    ctx.isEdgeSelected(edge.id) && ctx.isTerminal(edge.source)
                }
            }
            "wait_any" -> {
                // At least one inbound edge must be selected
                inboundEdges.any { edge ->
                    ctx.isEdgeSelected(edge.id) && ctx.isTerminal(edge.source)
                }
            }
            else -> inboundEdges.all { edge ->
                ctx.isEdgeSelected(edge.id) && ctx.isTerminal(edge.source)
            }
        }
    }

    // ── Completion detection ──────────────────────────────────────────────────

    /**
     * Returns true when the run is complete — either an END node is completed,
     * or all nodes are terminal and no nodes are pending.
     */
    fun isRunComplete(ctx: RuntimeContext): Boolean {
        val endCompleted = graph.nodes.any { it.nodeType == NodeType.END && ctx.isCompleted(it.id) }
        if (endCompleted) return true

        val pending = graph.nodes.filter { ctx.isPending(it.id) }
        val runnable = findRunnableNodes(ctx)
        return pending.isEmpty() || (runnable.isEmpty() && pending.isNotEmpty() && hasNoProgress(ctx))
    }

    /** Returns true if no node is in RUNNING state and no node is runnable. */
    private fun hasNoProgress(ctx: RuntimeContext): Boolean {
        val running = graph.nodes.any { ctx.statusOf(it.id) == RuntimeContext.NodeStatus.RUNNING }
        if (running) return false
        return findRunnableNodes(ctx).isEmpty()
    }

    // ── Graph validation ──────────────────────────────────────────────────────

    /**
     * Basic structural validation before execution starts.
     * Returns a list of error messages; empty means valid.
     */
    fun validateGraph(): List<String> {
        val errors = mutableListOf<String>()

        val triggers = graph.nodes.filter { it.nodeType == NodeType.TRIGGER }
        if (triggers.isEmpty()) errors += "No TRIGGER node found"
        if (triggers.size > 1)  errors += "Multiple TRIGGER nodes found (${triggers.size})"

        // Detect unreferenced edge endpoints
        val nodeIds = graph.nodes.map { it.id }.toSet()
        for (edge in graph.edges) {
            if (edge.source !in nodeIds) errors += "Edge ${edge.id} references unknown source: ${edge.source}"
            if (edge.target !in nodeIds) errors += "Edge ${edge.id} references unknown target: ${edge.target}"
        }

        // Every JOIN must have a corresponding PARALLEL node reachable via backward traversal
        for (node in graph.nodes.filter { it.nodeType == NodeType.JOIN }) {
            if (findParallelSource(node) == null) {
                errors += "JOIN node ${node.id} has no reachable PARALLEL source"
            }
        }

        return errors
    }

    /**
     * Deadlock detection: returns node IDs that are waiting and cannot make progress.
     * A node is deadlocked if it is pending, has inbound edges, but no inbound edge
     * will ever be selected because all source nodes are also deadlocked.
     */
    fun detectDeadlock(ctx: RuntimeContext): Set<String> {
        val pending = graph.nodes.filter { ctx.isPending(it.id) }.map { it.id }.toSet()
        val deadlocked = mutableSetOf<String>()

        for (nodeId in pending) {
            val inEdges = graph.edgesTo(nodeId)
            if (inEdges.isEmpty()) continue
            val allSourcesTerminal = inEdges.all { edge ->
                ctx.isTerminal(edge.source) && !ctx.isEdgeSelected(edge.id)
            }
            if (allSourcesTerminal) deadlocked.add(nodeId)
        }

        return deadlocked
    }
}

class InvalidGraphException(message: String) : Exception(message)
