package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.checkpoint.ApprovalGateConfig
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowNode

/**
 * Executor for APPROVAL nodes.
 *
 * On first execution: creates a pending approval row and pauses the run.
 * On resume execution: checks the existing approval decision.
 *   - APPROVED → returns Completed (run continues downstream).
 *   - REJECTED → returns Failed (failure policy applies).
 *   - PENDING  → returns ApprovalPaused again (re-pauses; avoids duplicate row).
 *   - null     → creates a new pending approval row.
 *
 * This idempotent check prevents duplicate approval rows when a run is resumed
 * and the approval node is re-executed from a checkpoint snapshot.
 *
 * ── THE CANVAS CONFIGURATION WAS NEVER READ ──────────────────────────────────
 *
 * The Approval inspector has always offered an approver group, an SLA in
 * minutes, a timeout behaviour and a table of decision-context bindings. This
 * executor read exactly two keys — `message` and `approvers` — so none of them
 * reached the gate. The Approvals page then had nothing to render and filled the
 * gaps with placeholders: `slaMs: 1`, `approverGroup: "Not provided by API"`.
 *
 * The keys below are the ones the inspector actually writes. `approvers` is
 * still accepted, because the Architect and older graphs write that instead.
 */
class ApprovalNodeExecutor(
    private val approvalStore: ApprovalStore,
) : NodeExecutor {

    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult {
        val label = node.label.ifBlank { node.id }
        val message = node.config["message"] as? String
            ?: node.config["approvalMessage"] as? String
            ?: "Approval required for node $label"

        @Suppress("UNCHECKED_CAST")
        val approvers = (node.config["approvers"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()

        // Check for an existing approval row (prevents duplicate creation on resume)
        val existing = approvalStore.findApproval(ctx.runId, node.id)

        return when (existing?.status?.uppercase()) {
            "APPROVED" -> NodeResult.Completed(
                output = mapOf(
                    "decision" to "approved",
                    "approvalId" to existing.id.toString(),
                    "resolvedBy" to (existing.resolvedBy ?: ""),
                ),
                metadata = mapOf("approvalId" to existing.id.toString(), "decision" to "approved"),
            )

            "REJECTED" -> NodeResult.Failed(
                reason = "Approval rejected for node '$label'" +
                    (existing.resolvedBy?.let { " by $it" } ?: ""),
            )

            "PENDING" -> {
                // Already pending — re-pause without creating a duplicate row
                NodeResult.ApprovalPaused(
                    approvalId = existing.id.toString(),
                    message = existing.message ?: message,
                    metadata = mapOf("approvers" to approvers, "nodeId" to node.id),
                )
            }

            else -> {
                val gate = gateConfig(node, message, resolvedInputs)
                val approvalId = approvalStore.createPendingApproval(
                    runId = ctx.runId,
                    workspaceId = ctx.workspaceId,
                    environmentId = ctx.environmentId,
                    nodeId = node.id,
                    message = message,
                    approvers = approvers.ifEmpty { listOfNotNull(gate.approverGroup) },
                    resolvedInputs = resolvedInputs,
                    gate = gate,
                )

                NodeResult.ApprovalPaused(
                    approvalId = approvalId,
                    message = message,
                    metadata = mapOf(
                        "approvers" to approvers,
                        "nodeId" to node.id,
                        "approverGroup" to (gate.approverGroup ?: ""),
                        "slaMinutes" to (gate.slaMinutes ?: 0),
                    ),
                )
            }
        }
    }

    /** Translate the inspector's keys into the gate the store persists. */
    private fun gateConfig(
        node: WorkflowNode,
        message: String,
        resolvedInputs: Map<String, Any>,
    ): ApprovalGateConfig {
        val cfg = node.config
        val (context, evidence) = resolveDecisionContext(cfg, resolvedInputs)
        return ApprovalGateConfig(
            approverGroup = (cfg["approverGroup"] as? String)?.takeIf { it.isNotBlank() },
            slaMinutes = num(cfg["slaMinutes"])?.toInt()?.takeIf { it > 0 },
            onTimeout = (cfg["onTimeout"] as? String)?.takeIf { it.isNotBlank() },
            decisionContext = context,
            evidenceRefs = evidence,
            title = (cfg["title"] as? String)?.takeIf { it.isNotBlank() }
                ?: node.label.takeIf { it.isNotBlank() }
                ?: message.take(120),
            riskLevel = (cfg["riskLevel"] as? String)?.lowercase()?.takeIf {
                it in setOf("low", "medium", "high", "critical")
            } ?: "medium",
        )
    }

    /**
     * Turn the inspector's `contextFields` into RESOLVED values plus provenance.
     *
     * V027 is explicit that `decision_context_json` must hold resolved values and
     * not templates: "the approval card was rendering `{{customer.name}} requested
     * {{amount}}` because the template was stored and the values were not. An
     * approver cannot decide from a template."
     *
     * So the expression is looked up against the inputs this node actually
     * resolved, and the expression itself is kept separately in the evidence map
     * — which is what answers the auditor's question, "where did this number come
     * from". A binding that resolves to nothing is recorded as unresolved rather
     * than dropped: an approver seeing a blank row knows the gate is
     * misconfigured, whereas a missing row looks like a gate with less context
     * than it was given.
     */
    private fun resolveDecisionContext(
        cfg: Map<String, Any>,
        resolvedInputs: Map<String, Any>,
    ): Pair<Map<String, Any?>, Map<String, Any?>> {
        @Suppress("UNCHECKED_CAST")
        val rows = (cfg["contextFields"] as? List<*>)?.filterIsInstance<Map<String, Any?>>()
            ?: return emptyMap<String, Any?>() to emptyMap()

        val context = LinkedHashMap<String, Any?>()
        val evidence = LinkedHashMap<String, Any?>()

        for ((index, row) in rows.withIndex()) {
            val label = (row["label"] as? String)?.trim().orEmpty().ifEmpty { "Field ${index + 1}" }
            val expression = (row["expression"] as? String)?.trim().orEmpty()
            if (expression.isEmpty()) continue

            val value = lookup(expression, resolvedInputs)
            context[label] = value ?: "(unresolved)"
            evidence[label] = mapOf("expression" to expression, "resolved" to (value != null))
        }
        return context to evidence
    }

    /**
     * Resolve one `{{ … }}` binding against the node's resolved inputs.
     *
     * Deliberately small. The template engine has already run by the time a node
     * executes — `resolvedInputs` IS the substituted map — so the only work left
     * is to find the value the inspector's expression names. A dotted path is
     * walked so `{{ n1001.output.total }}` finds `total` whether the mapping
     * flattened it or not.
     */
    private fun lookup(expression: String, inputs: Map<String, Any>): Any? {
        val path = expression.trim().removePrefix("{{").removeSuffix("}}").trim()
        if (path.isEmpty()) return null

        // Direct hit first: an input mapping usually names the field the context
        // row wants, and the exact key beats any traversal.
        inputs[path]?.let { return it }

        val segments = path.split('.').filter { it.isNotBlank() }
        if (segments.isEmpty()) return null

        var cursor: Any? = inputs
        for (segment in segments) {
            cursor = when (cursor) {
                is Map<*, *> -> cursor[segment]
                else -> null
            }
            if (cursor == null) break
        }
        // A path anchored on a node id will not be in this node's inputs at all;
        // fall back to the last segment, which is the field name the approver is
        // actually being shown.
        return cursor ?: inputs[segments.last()]
    }

    private fun num(value: Any?): Number? = when (value) {
        is Number -> value
        is String -> value.trim().toDoubleOrNull()
        else -> null
    }
}
