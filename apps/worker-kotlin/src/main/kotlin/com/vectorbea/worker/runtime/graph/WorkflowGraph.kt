package com.vectorbea.worker.runtime.graph

import com.fasterxml.jackson.annotation.JsonIgnoreProperties
import com.fasterxml.jackson.databind.DeserializationFeature
import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.fasterxml.jackson.module.kotlin.readValue

// ── React Flow wire format (from frontend) ────────────────────────────────────
// The frontend saves SavedWorkflowNode { id, type, position, data: WFNodeData }
// The worker's internal WorkflowNode is flat — we convert on parse.

@JsonIgnoreProperties(ignoreUnknown = true)
private data class RfGraph(
    val nodes: List<RfNode> = emptyList(),
    val edges: List<RfEdge> = emptyList(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
private data class RfNode(
    val id: String = "",
    val type: String = "unknown",
    // React Flow nodes embed all config inside `data`; internal format uses flat `config`
    val data: Map<String, Any?> = emptyMap(),
    // Allow internal format too (flat config at top level)
    val config: Map<String, Any?> = emptyMap(),
    val label: String = "",
    val inputMapping: Map<String, String> = emptyMap(),
    val outputMapping: Map<String, String> = emptyMap(),
)

@JsonIgnoreProperties(ignoreUnknown = true)
private data class RfEdge(
    val id: String = "",
    val source: String = "",
    val target: String = "",
    val sourceHandle: String? = null,
    val targetHandle: String? = null,
    // React Flow edges embed type/condition inside `data`
    val data: Map<String, Any?> = emptyMap(),
    // Allow internal format (type directly at top level)
    val type: String = "default",
    val condition: String? = null,
    val label: String? = null,
)

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

        /**
         * Parse a workflow graph from JSON.
         *
         * Accepts two formats:
         *  1. React Flow format — nodes have { id, type, position, data: { label, *Config, ... } }
         *     This is the format saved by the frontend workflow builder.
         *  2. Internal format — nodes have flat { id, type, label, config, inputMapping, ... }
         *
         * React Flow format is detected by the presence of a non-empty `data` field on nodes.
         */
        fun parse(json: String): WorkflowGraph {
            val rf = mapper.readValue<RfGraph>(json)
            val nodes = rf.nodes.map { convertNode(it) }
            val edges = rf.edges.map { convertEdge(it) }
            return WorkflowGraph(nodes = nodes, edges = edges)
        }

        @Suppress("UNCHECKED_CAST")
        private fun convertNode(rf: RfNode): WorkflowNode {
            // React Flow format: everything is inside `data`
            val isReactFlow = rf.data.isNotEmpty()
            val data = rf.data

            val label: String = if (isReactFlow) {
                data["label"] as? String ?: rf.label
            } else rf.label

            // Helper: extract a nested config map from data by key, removing nulls
            fun configOf(key: String): Map<String, Any> =
                (data[key] as? Map<String, Any?> ?: emptyMap())
                    .filterValues { it != null }
                    .mapValues { (_, v) -> v!! }

            // Helper: safely read string mapping from data
            fun mappingOf(key: String): Map<String, String> =
                (data[key] as? Map<String, Any?> ?: emptyMap())
                    .filterValues { it is String }
                    .mapValues { (_, v) -> v as String }

            val config: Map<String, Any> = if (isReactFlow) {
                when (rf.type) {
                    "llm" -> {
                        val cfg = configOf("llmConfig")
                        // Convert LlmNodeConfig to the flat map LlmNodeExecutor expects.
                        // Build messages list from systemPrompt + userPromptTemplate.
                        val systemPrompt = cfg["systemPrompt"] as? String
                        val userPrompt   = cfg["userPromptTemplate"] as? String
                            ?: cfg["prompt"] as? String
                        val messages     = buildLlmMessages(systemPrompt, userPrompt)
                        cfg + mapOf("messages" to messages)
                    }
                    "http_tool" -> {
                        // Frontend uses urlTemplate/bodyTemplate; HttpNodeExecutor reads url/body
                        val cfg = configOf("httpToolConfig")
                        val result = cfg.toMutableMap()
                        (cfg["urlTemplate"] as? String)?.let { result["url"] = it }
                        (cfg["bodyTemplate"] as? String)?.let { result["body"] = it }
                        result
                    }
                    "db_read"   -> {
                        // Frontend uses sqlTemplate; DbReadNodeExecutor reads query
                        val cfg = configOf("dbReadConfig")
                        val result = cfg.toMutableMap()
                        (cfg["sqlTemplate"] as? String)?.let { result["query"] = it }
                        result
                    }
                    "db_write"  -> {
                        val cfg = configOf("dbWriteConfig")
                        val result = cfg.toMutableMap()
                        // Frontend uses sqlTemplate; DbWriteNodeExecutor reads statement
                        (cfg["sqlTemplate"] as? String)?.let { result["statement"] = it }
                        result
                    }
                    "tool"      -> configOf("toolConfig")
                    "agent"     -> configOf("agentConfig")
                    "transform" -> configOf("transformConfig")
                    "branch"    -> configOf("branchConfig")
                    "parallel"  -> configOf("parallelConfig")
                    "join"      -> configOf("joinConfig")
                    "trigger"   -> configOf("triggerConfig")
                    "approval"  -> configOf("approvalConfig")
                    "mcp_tool"  -> configOf("mcpToolConfig")
                    "grpc_tool" -> configOf("grpcToolConfig")
                    "graphql_tool" -> configOf("graphqlToolConfig")
                    "webhook_wait" -> configOf("webhookWaitConfig")
                    "timer"     -> configOf("timerConfig")
                    "artifact"  -> configOf("artifactConfig")
                    "checkpoint" -> configOf("checkpointConfig")
                    "end"       -> configOf("endConfig")
                    else        -> emptyMap()
                }
            } else {
                // Internal format: config is already at top level
                rf.config.filterValues { it != null }.mapValues { (_, v) -> v!! }
            }

            // Input mapping resolution:
            //  1. data.inputMappingJson  — top-level workflow mapping (generic nodes)
            //  2. data.toolConfig.inputMapping — tool-node inspector stores it here
            //  3. data.agentConfig.inputMapping — agent-node inspector
            //  4. rf.inputMapping — internal format fallback
            val inputMapping: Map<String, String> = if (isReactFlow) {
                mappingOf("inputMappingJson").ifEmpty {
                    // Tool nodes: inspector writes to toolConfig.inputMapping
                    @Suppress("UNCHECKED_CAST")
                    (data["toolConfig"] as? Map<String, Any?>)
                        ?.let { tc -> (tc["inputMapping"] as? Map<String, Any?>)
                            ?.filterValues { it is String }
                            ?.mapValues { (_, v) -> v as String } }
                    // Agent nodes: inspector writes to agentConfig.inputMapping
                        ?: (data["agentConfig"] as? Map<String, Any?>)
                            ?.let { ac -> (ac["inputMapping"] as? Map<String, Any?>)
                                ?.filterValues { it is String }
                                ?.mapValues { (_, v) -> v as String } }
                        ?: emptyMap()
                }
            } else rf.inputMapping

            val outputMapping: Map<String, String> = if (isReactFlow) {
                mappingOf("outputMappingJson").ifEmpty {
                    @Suppress("UNCHECKED_CAST")
                    (data["toolConfig"] as? Map<String, Any?>)
                        ?.let { tc -> (tc["outputMapping"] as? Map<String, Any?>)
                            ?.filterValues { it is String }
                            ?.mapValues { (_, v) -> v as String } }
                        ?: (data["agentConfig"] as? Map<String, Any?>)
                            ?.let { ac -> (ac["outputMapping"] as? Map<String, Any?>)
                                ?.filterValues { it is String }
                                ?.mapValues { (_, v) -> v as String } }
                        ?: emptyMap()
                }
            } else rf.outputMapping

            return WorkflowNode(
                id            = rf.id,
                type          = rf.type,
                label         = label,
                config        = config,
                inputMapping  = inputMapping,
                outputMapping = outputMapping,
            )
        }

        private fun convertEdge(rf: RfEdge): WorkflowEdge {
            val data = rf.data
            // React Flow: edgeType/condition/label are inside `data`
            val edgeType  = (data["edgeType"] as? String) ?: rf.type
            val condition = (data["condition"] as? String) ?: rf.condition
            val label     = (data["label"]     as? String) ?: rf.label
            return WorkflowEdge(
                id        = rf.id,
                source    = rf.source,
                target    = rf.target,
                type      = edgeType,
                condition = condition,
                label     = label,
            )
        }

        private fun buildLlmMessages(systemPrompt: String?, userPrompt: String?): List<Map<String, Any>> {
            val messages = mutableListOf<Map<String, Any>>()
            if (!systemPrompt.isNullOrBlank()) {
                messages += mapOf("role" to "system", "content" to systemPrompt)
            }
            if (!userPrompt.isNullOrBlank()) {
                messages += mapOf("role" to "user", "content" to userPrompt)
            }
            return messages
        }
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
        NodeType.TOOL, NodeType.AGENT,
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
    // Reference types — resolved at runtime via DB lookup
    TOOL("tool"),
    AGENT("agent"),
    UNKNOWN("unknown"),
    ;

    companion object {
        /**
         * Map node type strings (from both frontend React Flow and internal formats) to [NodeType].
         *
         * Frontend aliases:
         *  - "http_tool"     → HTTP   (frontend's explicit HTTP tool node)
         *  - "db_read"       → DB_QUERY
         *  - "graphql_tool"  → UNKNOWN (not yet supported)
         *  - "mcp_tool"      → UNKNOWN
         *  - "grpc_tool"     → UNKNOWN
         *  - "webhook_wait"  → UNKNOWN
         *  - "timer"         → UNKNOWN
         *  - "artifact"      → UNKNOWN
         *  - "checkpoint"    → UNKNOWN
         */
        fun fromString(s: String): NodeType = when (s.lowercase()) {
            "trigger"                    -> TRIGGER
            "transform"                  -> TRANSFORM
            "branch"                     -> BRANCH
            "parallel"                   -> PARALLEL
            "join"                       -> JOIN
            "approval"                   -> APPROVAL
            "end"                        -> END
            "llm"                        -> LLM
            "http", "http_tool"          -> HTTP
            "db_query", "db_read"        -> DB_QUERY
            "db_write"                   -> DB_WRITE
            "tool"                       -> TOOL
            "agent"                      -> AGENT
            else                         -> UNKNOWN
        }
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
    APPROVED("approved"),
    REJECTED("rejected"),
    ;

    companion object {
        fun fromString(s: String): EdgeType = when (s.lowercase()) {
            "default"                    -> DEFAULT
            "success"                    -> SUCCESS
            "failure"                    -> FAILURE
            "branch"                     -> BRANCH
            "parallel", "parallel_branch"-> PARALLEL
            "true", "conditional_true"   -> TRUE
            "false", "conditional_false" -> FALSE
            "approval_approved", "approved" -> APPROVED
            "approval_rejected", "rejected" -> REJECTED
            "join"                       -> DEFAULT  // join connectors are default-follow
            else                         -> DEFAULT
        }
    }
}
