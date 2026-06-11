package com.vectorbea.worker.mapping

import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowGraph
import com.vectorbea.worker.runtime.graph.WorkflowNode
import java.util.UUID

/**
 * Resolves input mapping expressions against the current [RuntimeContext].
 *
 * Template syntax (restricted — NOT arbitrary eval):
 *
 *   {{ workflow.input.customerId }}       → workflowInput["customerId"]
 *   {{ workflow.input.nested.key }}       → workflowInput["nested"]["key"] (dot-path)
 *   {{ run.id }}                          → runId (UUID string)
 *   {{ run.workspaceId }}                 → workspaceId (UUID string)
 *   {{ steps.fetchCustomer.output.raw.body }}         → step raw output
 *   {{ steps.riskAnalysis.output.extracted.riskLevel }} → step extracted output
 *   {{ steps.processData.output.validated.score }}      → step validated output
 *
 * Blocked namespaces (fail clearly, do NOT silently skip):
 *   secret.*          — secret references are never allowed
 *   env.*             — environment variable references are never allowed
 *   system.*          — system references are never allowed
 *   process.*         — process references are never allowed
 *   steps.<nodeId>.*  — future/incomplete step references (node not yet completed)
 *
 * Whitelisted run fields:
 *   run.id, run.workspaceId, run.environmentId, run.workflowVersionId
 *
 * SECURITY:
 *   - Template strings are parsed with a fixed regex — never eval'd as code.
 *   - Forbidden namespaces throw [MappingException] immediately.
 *   - Raw workflow input values are never logged.
 */
object MappingResolver {

    /**
     * Compiled once: matches {{ ... }} expressions.
     * The inner group accepts any characters except }} so that node labels
     * with spaces and special chars (e.g. "Risk Score & Recommendation") work.
     */
    private val TEMPLATE_REGEX = Regex("""\{\{\s*([^}]+?)\s*\}\}""")

    /** Forbidden namespace prefixes — checked before any resolution */
    private val FORBIDDEN_PREFIXES = listOf("secret.", "env.", "system.", "process.")

    /**
     * Resolve a complete mapping definition (Map<String, String>) against [ctx].
     * Each value may be a template string, a literal, or a mix.
     *
     * Returns a resolved Map<String, Any>.
     * Throws [MappingException] on forbidden references or missing completed steps.
     */
    fun resolveMapping(
        mapping: Map<String, String>,
        ctx: RuntimeContext,
        stepOutputs: StepOutputView,
    ): Map<String, Any> {
        val result = mutableMapOf<String, Any>()
        for ((targetKey, template) in mapping) {
            val value = resolveTemplateString(template, ctx, stepOutputs) ?: continue
            result[targetKey] = value
        }
        return result
    }

    /**
     * Resolve a single template string. May contain zero, one, or multiple
     * {{ ... }} expressions. If the entire string is one expression, the
     * original typed value (Any) is returned. If it's a mixed string, a
     * String is returned with expressions substituted.
     */
    fun resolveTemplateString(
        template: String,
        ctx: RuntimeContext,
        stepOutputs: StepOutputView,
    ): Any? {
        val matches = TEMPLATE_REGEX.findAll(template).toList()
        if (matches.isEmpty()) return template // plain literal

        // Single whole-string expression → return typed value
        if (matches.size == 1 && matches[0].value.trim() == template.trim()) {
            return resolveExpression(matches[0].groupValues[1], ctx, stepOutputs)
        }

        // Mixed string — substitute all expressions and return string
        return TEMPLATE_REGEX.replace(template) { match ->
            val resolved = resolveExpression(match.groupValues[1], ctx, stepOutputs)
            resolved.toString()
        }
    }

    /**
     * Validate that all mapping references in [node] are valid against [graph].
     * Returns a list of validation errors (empty = valid).
     * Does NOT resolve values — only checks structural validity.
     */
    fun validateMappingReferences(
        node: WorkflowNode,
        graph: WorkflowGraph,
        completedNodeIds: Set<String>,
    ): List<String> {
        val errors = mutableListOf<String>()
        val allNodeIds = graph.nodes.map { it.id }.toSet()

        for ((key, template) in node.inputMapping) {
            TEMPLATE_REGEX.findAll(template).forEach { match ->
                val expr = match.groupValues[1]
                val err = checkExpression(expr, allNodeIds, completedNodeIds)
                if (err != null) errors.add("inputMapping[$key]: $err")
            }
        }
        return errors
    }

    // ── Expression resolution ─────────────────────────────────────────────────

    private fun resolveExpression(
        expr: String,
        ctx: RuntimeContext,
        stepOutputs: StepOutputView,
    ): Any? {
        // Security: reject forbidden namespaces immediately
        for (forbidden in FORBIDDEN_PREFIXES) {
            if (expr.startsWith(forbidden)) {
                throw MappingException("Forbidden reference '$expr': '${forbidden.trimEnd('.')}' namespace is not allowed in mapping expressions")
            }
        }

        return when {
            // Full form: {{workflow.input.key}}
            expr.startsWith("workflow.input.") -> {
                val path = expr.removePrefix("workflow.input.")
                // Return null for missing keys rather than throwing — the caller can
                // supply defaults or use NULL in SQL params when the trigger has no input
                JsonPathResolver.resolvePathInMap(path, ctx.workflowInput)
            }

            // Short form alias: {{input.key}} → same as {{workflow.input.key}}
            expr.startsWith("input.") -> {
                val path = expr.removePrefix("input.")
                JsonPathResolver.resolvePathInMap(path, ctx.workflowInput)
            }

            expr.startsWith("run.") -> {
                resolveRunField(expr.removePrefix("run."), ctx)
            }

            expr.startsWith("steps.") -> {
                resolveStepReference(expr.removePrefix("steps."), ctx, stepOutputs)
            }

            else -> throw MappingException(
                "Unknown mapping namespace in expression '$expr'. " +
                "Valid namespaces: workflow.input (or just input), run, steps"
            )
        }
    }

    /**
     * Resolve a step reference string to a node ID using multiple strategies (in priority order):
     *
     *  1. Exact node ID match             "n1001"
     *  2. Exact label match               "Fetch Upcoming Renewals"
     *  3. Case-insensitive, no spaces     "fetchupcomingrenwals"
     *  4. Spaces → underscores            "fetch_upcoming_renewals"
     *  5. Slug (non-alnum→underscore)     handles "Risk Score & Recommendation" → "risk_score_recommendation"
     *  6. All reference words present     "fetch_renewals" → ["fetch","renewals"] ⊆ label words
     *     This handles abbreviated names where users omit filler words like "upcoming".
     *  7. Label starts with the reference "fetch" matches "Fetch Upcoming Renewals"
     *
     * Returns null when no node matches so the caller can provide a diagnostic error.
     */
    private fun resolveNodeRef(rawRef: String, ctx: RuntimeContext): String? {
        if (rawRef.isBlank()) return null

        val refLower = rawRef.lowercase()
        // Normalise ref: non-alphanumeric → "_", collapse runs, trim
        val refSlug  = refLower.replace(Regex("[^a-z0-9]+"), "_").trim('_')
        // Words in the reference (split on underscore/space/hyphen)
        val refWords = refSlug.split('_').filter { it.length > 1 }  // skip single chars

        return ctx.graph.nodes.firstOrNull { node ->
            val id    = node.id
            val label = node.label
            val labelLower = label.lowercase()
            val labelSlug  = labelLower.replace(Regex("[^a-z0-9]+"), "_").trim('_')
            val labelWords = labelSlug.split('_').filter { it.isNotEmpty() }

            // Strategy 1-5: exact and slug matches
            id         == rawRef  ||
            labelLower == refLower ||
            labelLower.replace(" ", "")  == refLower.replace("_", "") ||
            labelSlug  == refSlug  ||

            // Strategy 6: all reference words appear in the label words
            // "fetch_renewals" → ["fetch","renewals"] — both appear in ["fetch","upcoming","renewals"]
            (refWords.size >= 2 && refWords.all { w -> labelWords.any { lw -> lw.startsWith(w) || w.startsWith(lw) } }) ||

            // Strategy 7: label starts with the reference (handles "crm" → "CRM Analysis")
            (refWords.size == 1 && labelWords.firstOrNull()?.startsWith(refWords[0]) == true)
        }?.id
    }

    private fun resolveRunField(field: String, ctx: RuntimeContext): Any = when (field) {
        "id"                -> ctx.runId.toString()
        "workspaceId"       -> ctx.workspaceId.toString()
        "environmentId"     -> ctx.environmentId.toString()
        "workflowVersionId" -> ctx.workflowVersionId.toString()
        else -> throw MappingException("Unknown run field '$field'. Allowed: id, workspaceId, environmentId, workflowVersionId")
    }

    /**
     * Resolve `steps.<nodeId>.output.<tier>.<path>` where tier is one of:
     *   raw, extracted, validated, or any (alias for validated → extracted → raw)
     */
    private fun resolveStepReference(
        ref: String,               // e.g. "fetchCustomer.output.extracted.customer.id"
        ctx: RuntimeContext,
        stepOutputs: StepOutputView,
    ): Any? {
        val parts = ref.split(".", limit = 4)
        if (parts.size < 3 || parts[1] != "output") {
            throw MappingException("Invalid step reference 'steps.$ref'. Format: steps.<nodeId>.output.<path>")
        }

        val rawRef = parts[0]

        // Resolve the step reference to a node using a multi-strategy matcher.
        // Users write references like "fetch_renewals" (short) for node "Fetch Upcoming Renewals",
        // or "collect_parallel_results" for "Collect Parallel Results". Support all common patterns.
        val nodeId = resolveNodeRef(rawRef, ctx)
            ?: throw MappingException(
                "steps.$rawRef does not exist in the workflow graph. " +
                "Available steps: ${ctx.graph.nodes.joinToString { "'${it.id}' (${it.label})" }}"
            )

        // Security: only allow references to completed steps
        if (!ctx.isCompleted(nodeId)) {
            throw MappingException("steps.$rawRef is not yet completed — forward references are not allowed")
        }

        // Determine tier and path
        val rest = if (parts.size >= 3) parts.drop(2).joinToString(".") else ""
        val (tier, path) = parseTierAndPath(rest)

        val data = when (tier) {
            "raw"       -> stepOutputs.getRaw(nodeId)       ?: ctx.getOutput(nodeId)
            "extracted" -> stepOutputs.getExtracted(nodeId)  ?: stepOutputs.getRaw(nodeId) ?: ctx.getOutput(nodeId)
            "validated" -> stepOutputs.getValidated(nodeId)  ?: stepOutputs.getExtracted(nodeId) ?: ctx.getOutput(nodeId)
            "output"    -> stepOutputs.getValidated(nodeId)  ?: stepOutputs.getExtracted(nodeId) ?: ctx.getOutput(nodeId)
            else        -> {
                // `tier` is the fallback "output" sentinel — path holds the full original path.
                // Do NOT prepend "output." (that creates output.output.rows[0] double-prefix).
                val allOutput = stepOutputs.getValidated(nodeId) ?: stepOutputs.getExtracted(nodeId) ?: ctx.getOutput(nodeId)
                // Use `path` (= full rest) directly; if path is empty use `tier` as a key
                val resolvePath = if (path.isNotEmpty()) path else tier
                return JsonPathResolver.resolvePathInMap(resolvePath, allOutput)
                // null is acceptable — caller skips missing fields via ?: continue
            }
        }

        if (path.isEmpty()) return data

        // Return null when the path doesn't resolve — don't throw.
        // Throwing here causes the entire step to fail when a single field is missing
        // (e.g. a DB column name typo). The caller (resolveMapping) already skips null
        // values via `?: continue`, so the step simply runs without that specific input.
        return JsonPathResolver.resolvePathInMap(path, data)
    }

    /**
     * Split "extracted.customer.id" → ("extracted", "customer.id")
     * If the first segment is not a known tier, returns ("output", full string)
     */
    private fun parseTierAndPath(rest: String): Pair<String, String> {
        if (rest.isEmpty()) return "output" to ""
        val knownTiers = setOf("raw", "extracted", "validated")
        val firstDot = rest.indexOf('.')
        val firstSegment = if (firstDot >= 0) rest.substring(0, firstDot) else rest
        val remainder    = if (firstDot >= 0) rest.substring(firstDot + 1) else ""
        return if (firstSegment in knownTiers) firstSegment to remainder else "output" to rest
    }

    // ── Static validation ─────────────────────────────────────────────────────

    private fun checkExpression(
        expr: String,
        allNodeIds: Set<String>,
        completedNodeIds: Set<String>,
    ): String? {
        for (forbidden in FORBIDDEN_PREFIXES) {
            if (expr.startsWith(forbidden)) {
                return "forbidden namespace '${forbidden.trimEnd('.')}'"
            }
        }

        if (expr.startsWith("steps.")) {
            val nodeId = expr.removePrefix("steps.").split(".").firstOrNull() ?: ""
            if (nodeId !in allNodeIds) return "step '$nodeId' does not exist in the graph"
        }

        return null
    }
}

/**
 * Read-only view of persisted step outputs for a run.
 * Allows [MappingResolver] to read raw/extracted/validated tiers
 * without depending on [StepOutputStore] directly (avoids circular deps).
 */
interface StepOutputView {
    fun getRaw(nodeId: String): Map<String, Any>?
    fun getExtracted(nodeId: String): Map<String, Any>?
    fun getValidated(nodeId: String): Map<String, Any>?
}

/** Simple in-memory implementation used by [WorkflowRuntime] during a run. */
class InMemoryStepOutputView : StepOutputView {
    private val raw       = mutableMapOf<String, Map<String, Any>>()
    private val extracted = mutableMapOf<String, Map<String, Any>>()
    private val validated = mutableMapOf<String, Map<String, Any>>()

    fun putRaw(nodeId: String, data: Map<String, Any>)       { raw[nodeId]       = data }
    fun putExtracted(nodeId: String, data: Map<String, Any>) { extracted[nodeId] = data }
    fun putValidated(nodeId: String, data: Map<String, Any>) { validated[nodeId] = data }

    override fun getRaw(nodeId: String): Map<String, Any>?       = raw[nodeId]
    override fun getExtracted(nodeId: String): Map<String, Any>? = extracted[nodeId]
    override fun getValidated(nodeId: String): Map<String, Any>? = validated[nodeId]
}

class MappingException(message: String) : Exception(message)
