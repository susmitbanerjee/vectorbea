package com.vectorbea.api.queue

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper

/**
 * Derives an [ExecutionClass] from a workflow's `graph_json`.
 *
 * Pure and side-effect free: same graph in, same class out, no I/O. That matters
 * because the result is memoised permanently on the version row — a classifier
 * that could return different answers for the same graph would poison that memo.
 *
 * WHY THIS PARSES INSTEAD OF SUBSTRING-MATCHING
 * ---------------------------------------------
 * The worker's original classifier approximated node count by counting `"type":`
 * occurrences across the raw JSON. **Edges carry a `type` field too**, so a
 * 7-node / 6-edge workflow counted as 13, crossed the threshold of 12, and was
 * routed to the 2-slot LONG pool instead of the 8-slot SHORT one — mis-binning
 * essentially every workflow above about six nodes (TECH-DEBT.md#D5).
 *
 * This runs once per workflow *version*, not once per run, so parsing properly
 * costs nothing worth optimising and removes a whole class of false positives.
 */
object GraphClassifier {

    private val mapper = ObjectMapper()

    /**
     * Node types that make a workflow AGENT — the scarce, slowest resource.
     *
     * `agent_team` is a TYPE ADDITION and nothing more: a team is several agent
     * loops, so it belongs in the class one agent loop already puts a workflow in.
     * No rule changes, no threshold moves, and the memo on existing version rows
     * stays valid because no graph that lacks the new type can classify
     * differently than it did.
     */
    private val AGENT_NODE_TYPES = setOf("llm", "agent", "agent_team")

    /** Node types that imply slow or unbounded outbound I/O. */
    private val LONG_NODE_TYPES = setOf(
        "http", "http_tool", "db_query", "db_read", "db_write", "tool",
        "mcp_tool", "grpc_tool", "graphql_tool",
    )

    /** At or above this many **nodes** (edges excluded), treat the graph as LONG. */
    const val DEFAULT_LONG_NODE_THRESHOLD = 12

    /** At or above this fan-out from a single parallel node, treat as LONG. */
    const val DEFAULT_MAX_PARALLEL_BRANCHES = 4

    /**
     * Classify [graphJson]. Returns [ExecutionClass.SHORT] when the graph cannot
     * be parsed — an unclassifiable graph is not a reason to refuse to run it,
     * and SHORT is the smallest claim on capacity.
     */
    fun classify(
        graphJson: String?,
        longNodeThreshold: Int = DEFAULT_LONG_NODE_THRESHOLD,
        maxParallelBranches: Int = DEFAULT_MAX_PARALLEL_BRANCHES,
    ): ExecutionClass {
        if (graphJson.isNullOrBlank()) return ExecutionClass.SHORT

        val root = try {
            mapper.readTree(graphJson)
        } catch (_: Exception) {
            return ExecutionClass.SHORT
        }

        val nodes = root.path("nodes").takeIf { it.isArray } ?: return ExecutionClass.SHORT
        val edges = root.path("edges").takeIf { it.isArray }

        var hasAgentNode = false
        var hasLongNode = false

        for (node in nodes) {
            val type = nodeType(node)
            if (type in AGENT_NODE_TYPES) hasAgentNode = true
            if (type in LONG_NODE_TYPES) hasLongNode = true
        }

        // Any AI work dominates: an LLM call is the longest blocking operation
        // the worker performs, so one such node decides the class outright.
        if (hasAgentNode) return ExecutionClass.AGENT

        // Node count excludes edges — see the KDoc.
        if (nodes.size() >= longNodeThreshold) return ExecutionClass.LONG

        if (hasLongNode) return ExecutionClass.LONG

        // Large fan-out: one parallel node with many outgoing parallel edges runs
        // its branches concurrently, so it behaves like a long workflow even when
        // every individual branch is trivial.
        if (edges != null && widestFanOut(nodes, edges) >= maxParallelBranches) {
            return ExecutionClass.LONG
        }

        return ExecutionClass.SHORT
    }

    /**
     * Node type, tolerating both wire formats: the internal flat shape and the
     * React Flow shape the builder saves, where `type` sits at the top level but
     * config lives under `data`.
     */
    private fun nodeType(node: JsonNode): String =
        node.path("type").asText("").lowercase().trim()

    /** Greatest number of outgoing edges from any single `parallel` node. */
    private fun widestFanOut(nodes: JsonNode, edges: JsonNode): Int {
        val parallelNodeIds = nodes
            .filter { nodeType(it) == "parallel" }
            .mapNotNull { it.path("id").asText(null) }
            .toSet()
        if (parallelNodeIds.isEmpty()) return 0

        val outgoing = HashMap<String, Int>()
        for (edge in edges) {
            val source = edge.path("source").asText(null) ?: continue
            if (source in parallelNodeIds) outgoing.merge(source, 1, Int::plus)
        }
        return outgoing.values.maxOrNull() ?: 0
    }
}
