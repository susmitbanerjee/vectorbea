package com.vectorbea.graph

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

            /*
             * POLICIES WERE NEVER READ.
             *
             * `WorkflowNode` has carried `retryPolicy`, `timeoutPolicy` and
             * `failurePolicy` since it was written, and `WorkflowRuntime` has always
             * honoured them - but this converter never populated any of them, so every
             * node in every workflow ran with the defaults. `RetryPolicy().maxAttempts`
             * is 0, which means the retry loop executed exactly once and the retry
             * count, backoff curve and jitter toggle configured on the canvas changed
             * nothing at all. The builder drew a retry timeline the worker never ran.
             */
            val retryPolicy = readRetryPolicy(mergedConfig, data)
            val timeoutPolicy = readTimeoutPolicy(mergedConfig, data)
            val failurePolicy = readFailurePolicy(mergedConfig, data)
            val checkpointPolicy = readCheckpointPolicy(mergedConfig, data)

            return WorkflowNode(
                id            = rf.id,
                type          = rf.type,
                label         = label,
                config        = config,
                inputMapping  = inputMapping,
                outputMapping = outputMapping,
                retryPolicy   = retryPolicy,
                timeoutPolicy = timeoutPolicy,
                checkpointPolicy = checkpointPolicy,
                failurePolicy = failurePolicy,
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

        /**
         * The node's retry policy, from whichever dialect wrote it.
         *
         * The current builder stores `config.retry = {attempts, backoff, baseDelayMs,
         * maxDelayMs}` where `backoff` is one of fixed / linear / exponential /
         * exponential-jitter. The legacy inspector stored
         * `data.retryPolicyJson = {maxAttempts, backoffType, backoffMs}`. Both are
         * read; neither used to be.
         */
        private fun readRetryPolicy(config: Map<String, Any>, data: Map<String, Any?>): RetryPolicy {
            @Suppress("UNCHECKED_CAST")
            val fromBuilder = config["retry"] as? Map<String, Any?>
            @Suppress("UNCHECKED_CAST")
            val fromLegacy = data["retryPolicyJson"] as? Map<String, Any?>

            val source = fromBuilder ?: fromLegacy ?: return RetryPolicy()

            val attempts = num(source["attempts"] ?: source["maxAttempts"])?.toInt()
                ?: return RetryPolicy()

            val declared = (source["backoff"] ?: source["backoffType"])?.toString()?.lowercase()
            val strategy = when {
                declared == null                 -> "exponential"
                declared.startsWith("fixed")     -> "fixed"
                declared.startsWith("linear")    -> "linear"
                else                             -> "exponential"
            }

            return RetryPolicy(
                maxAttempts       = attempts.coerceAtLeast(0),
                backoffMs         = num(source["baseDelayMs"] ?: source["backoffMs"])?.toLong() ?: 1_000L,
                backoffMultiplier = num(source["backoffMultiplier"])?.toDouble() ?: 2.0,
                strategy          = strategy,
                // The builder encodes jitter INSIDE the strategy name
                // ("exponential-jitter") as well as offering a separate flag.
                jitter            = (source["jitter"] as? Boolean)
                    ?: (declared?.contains("jitter") == true),
                maxBackoffMs      = num(source["maxDelayMs"] ?: source["maxBackoffMs"])?.toLong() ?: 0L,
            )
        }

        /** Per-step timeout, from `config.timeoutMs` or the legacy `timeoutPolicyJson`. */
        private fun readTimeoutPolicy(config: Map<String, Any>, data: Map<String, Any?>): TimeoutPolicy {
            @Suppress("UNCHECKED_CAST")
            val legacy = data["timeoutPolicyJson"] as? Map<String, Any?>
            val ms = num(config["timeoutMs"])?.toLong()
                ?: num(legacy?.get("stepTimeoutMs"))?.toLong()
                ?: num(legacy?.get("timeoutMs"))?.toLong()
                ?: return TimeoutPolicy()
            return TimeoutPolicy(timeoutMs = ms.coerceAtLeast(0L))
        }

        /**
         * What happens to the run when this node fails.
         *
         * The builder writes `errorPolicy: "fail-run" | "continue" | …` with a hyphen;
         * the runtime's vocabulary uses an underscore. Normalised here rather than
         * left to mismatch silently, which would read as "fail_run" for every value.
         */
        private fun readFailurePolicy(config: Map<String, Any>, data: Map<String, Any?>): FailurePolicy {
            val raw = (config["errorPolicy"] ?: config["onFailure"] ?: data["errorPolicy"])
                ?.toString()?.lowercase()?.replace('-', '_')
                /* Not an early return any more: a PARALLEL node commonly declares
                   `branchFailure` and nothing else, and returning the default
                   here would read that as having declared nothing at all. */
                ?: return FailurePolicy(branchFailure = readBranchFailure(config, data))
            val normalised = when (raw) {
                "continue", "ignore", "skip"        -> "continue"
                /*
                 * "error-path" and "fallback" are two of the FOUR values the
                 * Advanced tab offers, and neither was listed — so both fell to
                 * the `else` and became "fail_run". Choosing "route to the error
                 * path" in the inspector produced a node that ignored its error
                 * edge and stopped the run, which is the opposite of what the
                 * control says it does.
                 *
                 * `fallback` maps here too: the runtime's mechanism for running
                 * something else instead IS the failure edge, and the fallback
                 * node is its target. Silently failing the run was strictly
                 * worse than following the edge the author drew.
                 */
                "follow_failure_edge", "failure_edge", "error_path", "fallback" -> "follow_failure_edge"
                /* Park and ask a person. The synonyms are what the inspector and
                   the Architect each call it; all three mean the same thing and
                   falling through to `fail_run` would be the same silent
                   downgrade "error-path" suffered above. */
                "escalate", "ask_human", "escalate_to_human" -> "escalate"
                else                                 -> "fail_run"
            }
            return FailurePolicy(
                onFailure = normalised,
                escalationSignal = (config["escalationSignal"] ?: data["escalationSignal"])
                    ?.toString()?.takeIf { it.isNotBlank() },
                escalationTimeoutMs = (config["escalationTimeoutMs"] ?: data["escalationTimeoutMs"])
                    ?.toString()?.toLongOrNull()?.takeIf { it > 0 },
                branchFailure = readBranchFailure(config, data),
            )
        }

        /**
         * How many branches of a fan-out have to survive.
         *
         * Defaults to `require_one`, which is exactly what the runtime did
         * before this was declarable — so a graph that says nothing behaves
         * identically, and only a graph that asks for something else changes.
         */
        private fun readBranchFailure(config: Map<String, Any>, data: Map<String, Any?>): String {
            val raw = (config["branchFailure"] ?: config["branchFailurePolicy"]
                ?: data["branchFailure"] ?: data["branchFailurePolicy"])
                ?.toString()?.lowercase()?.replace('-', '_')
                ?: return FailurePolicy.BRANCH_REQUIRE_ONE
            return when (raw) {
                "all_must_succeed", "all", "strict" -> FailurePolicy.BRANCH_ALL_MUST_SUCCEED
                "tolerate_all", "any", "best_effort" -> FailurePolicy.BRANCH_TOLERATE_ALL
                else -> FailurePolicy.BRANCH_REQUIRE_ONE
            }
        }

        /**
         * Whether this node commits a checkpoint after it completes.
         *
         * The Advanced tab has a "checkpoint" switch, and `WorkflowRuntime`
         * honours `node.checkpointPolicy.enabled` in three places — after a
         * completed node, before an approval pause, and on the gated path. The
         * converter never populated it, so the switch was decorative: every node
         * checkpointed regardless, including the ones an author had deliberately
         * turned it off for.
         *
         * Defaults to enabled when unset. Durability is the product's whole
         * proposition and losing it must be an explicit choice, never an
         * omission.
         */
        private fun readCheckpointPolicy(config: Map<String, Any>, data: Map<String, Any?>): CheckpointPolicy {
            @Suppress("UNCHECKED_CAST")
            val legacy = data["checkpointPolicyJson"] as? Map<String, Any?>
            val raw = config["checkpoint"]
                ?: config["checkpointEnabled"]
                ?: legacy?.get("enabled")
                ?: return CheckpointPolicy()
            val enabled = when (raw) {
                is Boolean -> raw
                is String  -> raw.trim().lowercase() !in setOf("false", "off", "0", "no")
                is Number  -> raw.toInt() != 0
                else       -> true
            }
            return CheckpointPolicy(enabled = enabled)
        }

        /** A config value as a Number, whether it arrived as one or as a string. */
        private fun num(value: Any?): Number? = when (value) {
            is Number -> value
            is String -> value.trim().toDoubleOrNull()
            else      -> null
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
        NodeType.TOOL, NodeType.AGENT, NodeType.AGENT_TEAM,
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
    /** `fixed` | `linear` | `exponential`. The builder's own vocabulary. */
    val strategy: String = "exponential",
    /** Spread retries out so N nodes failing together do not retry in lockstep. */
    val jitter: Boolean = false,
    /** Ceiling for a single backoff. 0 means "use the runtime's own ceiling". */
    val maxBackoffMs: Long = 0L,
) {
    /**
     * How long to wait before [attempt] + 1, in milliseconds.
     *
     * On the policy rather than in the runtime so the schedule the builder DRAWS and
     * the schedule the worker WAITS can be compared, and so it can be tested without
     * standing up a run.
     *
     * Full jitter - a uniform draw from [0, delay] rather than delay ± a little -
     * matches `ProviderThrottle`, which documents why: partial jitter still leaves a
     * peak, and the peak is the thing that knocks a recovering dependency back over.
     */
    fun delayForAttempt(attempt: Int, random: java.util.random.RandomGenerator): Long {
        val base = when (strategy.lowercase()) {
            "fixed"  -> backoffMs.toDouble()
            "linear" -> backoffMs.toDouble() * attempt
            else     -> backoffMs.toDouble() * Math.pow(backoffMultiplier, (attempt - 1).toDouble())
        }
        val capped = if (maxBackoffMs > 0) minOf(base, maxBackoffMs.toDouble()) else base
        val withJitter = if (jitter && capped >= 1.0) random.nextDouble() * capped else capped
        return withJitter.toLong()
    }
}

@JsonIgnoreProperties(ignoreUnknown = true)
data class TimeoutPolicy(
    val timeoutMs: Long = 0L, // 0 = no timeout
)

@JsonIgnoreProperties(ignoreUnknown = true)
data class CheckpointPolicy(
    val enabled: Boolean = true,
)

/**
 * What a failure does to the rest of the run.
 *
 * ── FOUR ANSWERS, AND THE FOURTH IS THE ONE SRE WORK NEEDS ─────────────
 * A workflow that pages someone, restarts a service and posts a summary has
 * three nodes with three different right answers to "it failed":
 *
 *   abort     — `fail_run`. Stop. The default, because it is the only one that
 *               cannot silently produce a wrong result.
 *   continue  — the summary did not post; the incident is still handled.
 *   retry     — [RetryPolicy], which is a different axis and composes with all
 *               of these: retries are exhausted BEFORE the failure policy is
 *               consulted at all.
 *   escalate  — park and ask a person. The restart failed; a human decides
 *               whether to retry it, skip it, or stop the run. Aborting throws
 *               away a run that has already paged and diagnosed; continuing
 *               pretends a service was restarted when it was not.
 *
 * `escalate` is a SIGNAL WAIT, not a new mechanism (invariant 15). The run
 * parks on `escalation:<nodeId>` and any of the existing ways to signal a run —
 * the API, the UI, an on-call bot — answers it with
 * `{"decision": "retry" | "skip" | "abort"}`. A second parking mechanism would
 * mean a second timeout policy and a second way to be stuck forever.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
data class FailurePolicy(
    /** "fail_run" | "continue" | "follow_failure_edge" | "escalate" */
    val onFailure: String = "fail_run",
    /**
     * The signal that answers an escalation.
     *
     * Defaults to `escalation:<nodeId>` at the point of use, so two escalating
     * nodes in one run cannot answer each other's question — which is what a
     * single shared name would do, silently, and only under the concurrency that
     * makes it hardest to reproduce.
     */
    val escalationSignal: String? = null,
    /**
     * How long a person has before the escalation times out, in milliseconds.
     *
     * Null takes the wait primitive's default. The deadline is never absent:
     * a run parked forever on a question nobody was told about is the failure
     * mode every wait in this system is clamped to avoid.
     */
    val escalationTimeoutMs: Long? = null,
    /**
     * On a PARALLEL node: how many branches have to survive.
     *
     * ── THIS WAS ALWAYS A POLICY; IT JUST WAS NOT DECLARED ──────────────
     * The runtime already had a rule — tolerate partial failures, fail only if
     * every branch failed — hard-coded, undeclared and unchangeable. That is
     * right for "check five services", and wrong for "drain the node, then
     * update DNS, then verify", where a branch failing silently means the run
     * reports success having done two thirds of the work.
     *
     *   require_one       — today's behaviour, and the default so nothing moves.
     *   all_must_succeed  — any failed branch fails the fan-out.
     *   tolerate_all      — the join proceeds even if every branch failed.
     *
     * Read from the PARALLEL node, not from the branches: it is a statement
     * about the fan-out as a whole, and putting it on the branches would raise
     * the question of which branch's copy wins.
     */
    val branchFailure: String = "require_one",
) {
    companion object {
        const val ABORT = "fail_run"
        const val CONTINUE = "continue"
        const val FAILURE_EDGE = "follow_failure_edge"
        const val ESCALATE = "escalate"

        const val BRANCH_REQUIRE_ONE = "require_one"
        const val BRANCH_ALL_MUST_SUCCEED = "all_must_succeed"
        const val BRANCH_TOLERATE_ALL = "tolerate_all"
    }
}

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
    /**
     * A team of agents under an orchestration policy.
     *
     * A NEW TYPE, not a mode of [AGENT]. Existing agent nodes are untouched and
     * nothing migrates: a graph that has never had a team behaves exactly as it
     * did, and the two executors share every primitive beneath them rather than
     * sharing a node type and branching inside it.
     */
    AGENT_TEAM("agent_team"),
    /**
     * A named save point the canvas offers ("Checkpoint").
     *
     * It was missing, so the type fell to [UNKNOWN] and every workflow built with
     * a Checkpoint step failed there with "Unsupported node type". Every node's
     * output is already persisted as it completes (`checkpointPolicy`), which is
     * what makes a resume skip finished work; this node adds a visible boundary
     * and passes its inputs through. It does not change what happens on resume.
     */
    CHECKPOINT("checkpoint"),
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
         *  - "checkpoint"    → CHECKPOINT (canvas: "commit", "savepoint")
         *  - "merge"         → JOIN (the canvas calls a join "merge" and saves that)
         */
        fun fromString(s: String): NodeType = when (s.lowercase()) {
            "trigger"                    -> TRIGGER
            "transform"                  -> TRANSFORM
            "branch"                     -> BRANCH
            "parallel"                   -> PARALLEL
            "join", "merge", "fan_in"    -> JOIN
            "approval"                   -> APPROVAL
            "end"                        -> END
            "llm"                        -> LLM
            "http", "http_tool"          -> HTTP
            "db_query", "db_read"        -> DB_QUERY
            "db_write"                   -> DB_WRITE
            "tool"                       -> TOOL
            "agent"                      -> AGENT
            "agent_team", "team"         -> AGENT_TEAM
            "checkpoint", "commit", "savepoint" -> CHECKPOINT
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
