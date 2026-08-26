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
            val data = rf.data

            /* No dialect flag. There used to be an `isReactFlow` derived from
               `data.isNotEmpty()`, and branching on it is what silently emptied the
               config of every node the current builder writes (see the note below).
               Nothing here needs to know which builder wrote the node: the label is
               either in `data.label` or at the top level, so take the first non-blank
               of the two. */
            val label: String =
                (data["label"] as? String)?.takeIf { it.isNotBlank() } ?: rf.label

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

            /*
             * CONFIG IS MERGED FROM EVERY DIALECT, NEVER CHOSEN BETWEEN THEM.
             *
             * THE BUG THIS FIXES: this used to branch on `isReactFlow` - the mere
             * presence of a non-empty `data` - and then read config ONLY from the
             * type-specific `data.<type>Config` key, discarding the flat top-level
             * `config` entirely.
             *
             * `src/lib/workflows/graph-codec.ts` writes the SUPERSET on purpose, and
             * says so: flat `type`/`label`/`config` "for worker-kotlin's WorkflowNode"
             * plus `position`/`data` for the canvas. But its `data` has no
             * `agentConfig` - it carries `data.config` - so the branch matched the
             * React Flow arm, looked for a key that was not there, and every node
             * saved by that builder reached the executors with an EMPTY config.
             *
             * Agent nodes failed loudest ("missing required config: agentId") only
             * because agentId is validated first. The same graph also silently
             * stripped `toolId` from tool nodes, `connectionId` from llm nodes and the
             * statement from db_write nodes.
             *
             * Merging is the only encoding-agnostic answer, and the three sources
             * cannot conflict in practice: a graph written by one builder carries just
             * one of them. Order is least-specific to most-specific, so where a legacy
             * graph carries both a generic and a type-specific block, the block the
             * type-specific inspector wrote still wins.
             */
            val flatConfig: Map<String, Any> =
                rf.config.filterValues { it != null }.mapValues { (_, v) -> v!! }

            val mergedConfig: Map<String, Any> =
                dataLeafConfig(data) +                // Architect dialect: agentId/toolId on `data` itself
                flatConfig +                          // internal dialect, and graph-codec's flat copy
                configOf("config") +                  // graph-codec's canvas copy of the same map
                configOf(dialectConfigKey(rf.type))   // legacy per-type inspector block

            val config: Map<String, Any> = when (rf.type) {
                "llm" -> {
                    // Convert LlmNodeConfig to the flat map LlmNodeExecutor expects.
                    // Build messages list from systemPrompt + userPromptTemplate.
                    val systemPrompt = mergedConfig["systemPrompt"] as? String
                    val userPrompt   = mergedConfig["userPromptTemplate"] as? String
                        ?: mergedConfig["prompt"] as? String
                    val messages     = buildLlmMessages(systemPrompt, userPrompt)
                    // Only override when the prompts actually produced messages. A
                    // config that already carries an explicit `messages` list - the
                    // internal dialect, and what AgentNodeExecutor synthesises - must
                    // keep it rather than be handed an empty one.
                    if (messages.isNotEmpty()) mergedConfig + mapOf("messages" to messages)
                    else mergedConfig
                }
                "http_tool" -> {
                    // Frontend uses urlTemplate/bodyTemplate; HttpNodeExecutor reads url/body
                    val result = mergedConfig.toMutableMap()
                    (mergedConfig["urlTemplate"] as? String)?.let { result["url"] = it }
                    (mergedConfig["bodyTemplate"] as? String)?.let { result["body"] = it }
                    result
                }
                "db_read" -> {
                    // Frontend uses sqlTemplate; DbReadNodeExecutor reads query
                    val result = mergedConfig.toMutableMap()
                    (mergedConfig["sqlTemplate"] as? String)?.let { result["query"] = it }
                    result
                }
                "db_write" -> {
                    // Frontend uses sqlTemplate; DbWriteNodeExecutor reads statement
                    val result = mergedConfig.toMutableMap()
                    (mergedConfig["sqlTemplate"] as? String)?.let { result["statement"] = it }
                    result
                }
                else -> mergedConfig
            }

            // Input mapping resolution:
            //  1. data.inputMappingJson  — top-level workflow mapping (generic nodes)
            //  2. data.toolConfig.inputMapping — tool-node inspector stores it here
            //  3. data.agentConfig.inputMapping — agent-node inspector
            //  4. rf.inputMapping — internal format fallback
            /* Same rule as config: take the first dialect that actually carries a
               mapping, rather than deciding up front which dialect this graph is.
               `mergedConfig` covers the flat and graph-codec forms, where the mapping
               rides inside the node's own config, and the legacy per-type blocks
               (toolConfig.inputMapping, agentConfig.inputMapping) are already folded
               into it. */
            val inputMapping: Map<String, String> =
                mappingOf("inputMappingJson")
                    .ifEmpty { rf.inputMapping }
                    .ifEmpty { stringMap(mergedConfig["inputMapping"]) }
                    // The Architect writes the plural spelling.
                    .ifEmpty { stringMap(mergedConfig["inputMappings"]) }

            val outputMapping: Map<String, String> =
                mappingOf("outputMappingJson")
                    .ifEmpty { rf.outputMapping }
                    .ifEmpty { stringMap(mergedConfig["outputMapping"]) }
                    .ifEmpty { stringMap(mergedConfig["outputMappings"]) }

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

        /**
         * `data`'s own scalar entries, as a config source.
         *
         * `WorkflowArchitectService.compilePlanToGraphJson` is a THIRD dialect: it
         * writes `agentId` and `toolId` directly onto `data`, alongside `label` and
         * `nodeType`, with no wrapping block at all. So an Architect-generated
         * workflow hit the same empty-config failure as the builder's, and would have
         * kept hitting it after the builder was fixed.
         *
         * Structural canvas keys are excluded rather than merged: `label`/`nodeType`
         * are read elsewhere, and the `*Config` / `*Json` blocks are nested maps with
         * their own handling, so folding them in as config entries would put a map
         * where an executor expects a value.
         *
         * Lowest priority in the merge. This source is the loosest of the three - it
         * is whatever the canvas happened to put on the node - so anything a builder
         * wrote deliberately into a config block outranks it.
         */
        private fun dataLeafConfig(data: Map<String, Any?>): Map<String, Any> =
            data.filterKeys { key ->
                key !in STRUCTURAL_DATA_KEYS &&
                    !key.endsWith("Config") &&
                    !key.endsWith("Json")
            }
                .filterValues { it != null }
                .mapValues { (_, v) -> v!! }

        /** Canvas metadata on `data` that is never node config. */
        private val STRUCTURAL_DATA_KEYS = setOf(
            "label", "name", "nodeType", "description", "position", "status",
            "generatedByArchitect",
        )

        /**
         * The `data` key a legacy per-type inspector wrote this node's config under.
         *
         * Only the React Flow builder ever used these; graph-codec writes
         * `data.config` and the internal dialect writes a flat `config`. Returning a
         * key that is simply absent for those graphs is correct - the merge skips it.
         */
        private fun dialectConfigKey(type: String): String = when (type) {
            "llm" -> "llmConfig"
            "http_tool" -> "httpToolConfig"
            "db_read" -> "dbReadConfig"
            "db_write" -> "dbWriteConfig"
            "tool" -> "toolConfig"
            "agent" -> "agentConfig"
            "transform" -> "transformConfig"
            "branch" -> "branchConfig"
            "parallel" -> "parallelConfig"
            "join" -> "joinConfig"
            "trigger" -> "triggerConfig"
            "approval" -> "approvalConfig"
            "mcp_tool" -> "mcpToolConfig"
            "grpc_tool" -> "grpcToolConfig"
            "graphql_tool" -> "graphqlToolConfig"
            "webhook_wait" -> "webhookWaitConfig"
            "timer" -> "timerConfig"
            "artifact" -> "artifactConfig"
            "checkpoint" -> "checkpointConfig"
            "end" -> "endConfig"
            else -> type + "Config"
        }

        /** A nested `{key: string}` map, or empty when the value is not one. */
        @Suppress("UNCHECKED_CAST")
        private fun stringMap(value: Any?): Map<String, String> =
            (value as? Map<String, Any?>)
                ?.filterValues { it is String }
                ?.mapValues { (_, v) -> v as String }
                ?: emptyMap()

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
