package com.vectorbea.worker.runtime.graph

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue

/**
 * Parsed workflow graph loaded from workflow_versions.graph_json.
 *
 * Security: this object is derived from a database value that was originally
 * submitted by a user (workflow builder).  It is treated as trusted structure
 * but any user-supplied strings inside node configs are treated as untrusted
 * data during execution (never evaluated as code, never logged raw).
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class WorkflowGraph(
    val nodes: List<WorkflowNode> = emptyList(),
    val edges: List<WorkflowEdge> = emptyList(),
    val inputSchema: Map<String, Any> = emptyMap(),
    val outputSchema: Map<String, Any> = emptyMap(),
) {
    fun nodeById(id: String): WorkflowNode? = nodes.firstOrNull { it.id == id }
    fun edgesFrom(nodeId: String): List<WorkflowEdge> = edges.filter { it.source == nodeId }
    fun edgesTo(nodeId: String): List<WorkflowEdge> = edges.filter { it.target == nodeId }
    fun inboundSources(nodeId: String): Set<String> = edgesTo(nodeId).map { it.source }.toSet()

    companion object {
        private val mapper = jacksonObjectMapper().apply {
            configure(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES, false)
        }

        fun parse(json: String): WorkflowGraph = mapper.readValue(json)
    }
}

// ── Node ──────────────────────────────────────────────────────────────────────

@JsonIgnoreProperties(ignoreUnknown = true)
data class WorkflowNode(
    val id: String,
    val type: String = "unknown",
    val label: String = "",
    /** Arbitrary config supplied by the workflow builder — treat as untrusted. */
    val config: Map<String, Any> = emptyMap(),
    /**
     * Input mapping: nodeInputKey → expression (e.g. "output.fieldName",
     * "variables.myVar", "input.key", or a literal value).
     */
    val inputMapping: Map<String, String> = emptyMap(),
    /** How to map node outputs into the step output object. */
    val outputMapping: Map<String, String> = emptyMap(),
    /** JSONPath-like paths to extract specific fields from the raw output. */
    val outputExtraction: Map<String, String> = emptyMap(),
    val outputSchema: Map<String, Any> = emptyMap(),
    val retryPolicy: RetryPolicy = RetryPolicy(),
    val timeoutPolicy: TimeoutPolicy = TimeoutPolicy(),
    val checkpointPolicy: CheckpointPolicy = CheckpointPolicy(),
    val failurePolicy: FailurePolicy = FailurePolicy(),
) {
    val nodeType: NodeType get() = NodeType.fromString(type)

    fun isSupported(): Boolean = nodeType in setOf(
        NodeType.TRIGGER, NodeType.TRANSFORM, NodeType.BRANCH,
        NodeType.PARALLEL, NodeType.JOIN, NodeType.APPROVAL, NodeType.END,
        NodeType.LLM, NodeType.HTTP, NodeType.DB_QUERY, NodeType.DB_WRITE,
    )
}

@JsonIgnoreProperties(ignoreUnknown = true)
data class WorkflowEdge(
    val id: String,
    val source: String,
    val target: String,
    val type: String = "default",
    /** Condition expression for branch edges. Null = always take this edge. */
    val condition: String? = null,
    val label: String? = null,
    val mapping: Map<String, String> = emptyMap(),
) {
    val edgeType: EdgeType get() = EdgeType.fromString(type)
}

// ── Policy types ──────────────────────────────────────────────────────────────

@JsonIgnoreProperties(ignoreUnknown = true)
data class RetryPolicy(
    val maxAttempts: Int = 0,
    val backoffMs: Long = 1_000L,
    val backoffMultiplier: Double = 2.0,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class TimeoutPolicy(
    val timeoutMs: Long = 0L, // 0 = no timeout
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class CheckpointPolicy(
    val enabled: Boolean = true,
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class FailurePolicy(
    /** "fail_run" | "continue" | "follow_failure_edge" */
    val onFailure: String = "fail_run",
)

// ── Enums ─────────────────────────────────────────────────────────────────────

enum class NodeType(val value: String) {
    TRIGGER("trigger"),
    TRANSFORM("transform"),
    BRANCH("branch"),
    PARALLEL("parallel"),
    JOIN("join"),
    APPROVAL("approval"),
    END("end"),
    // Connector / external node types
    LLM("llm"),
    HTTP("http"),
    DB_QUERY("db_query"),
    DB_WRITE("db_write"),
    // Unsupported
    TOOL("tool"),
    AGENT("agent"),
    UNKNOWN("unknown"),
    ;

    companion object {
        fun fromString(s: String): NodeType =
            entries.firstOrNull { it.value == s.lowercase() } ?: UNKNOWN
    }
}

enum class EdgeType(val value: String) {
    DEFAULT("default"),
    SUCCESS("success"),
    FAILURE("failure"),
    BRANCH("branch"),
    PARALLEL("parallel"),
    TRUE("true"),
    FALSE("false"),
    ;

    companion object {
        fun fromString(s: String): EdgeType =
            entries.firstOrNull { it.value == s.lowercase() } ?: DEFAULT
    }
}
