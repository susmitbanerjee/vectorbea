package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode

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
 * Config keys (from [WorkflowNode.config]):
 *   "message"     — human-readable description of what is being approved
 *   "approvers"   — list of approver identifiers (informational only)
 *   "timeoutMs"   — optional approval window (0 = no timeout)
 */
class ApprovalNodeExecutor(
    private val approvalStore: ApprovalStore,
) : NodeExecutor {
    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult {
        val message   = node.config["message"] as? String ?: "Approval required for node ${node.label.ifBlank { node.id }}"
        @Suppress("UNCHECKED_CAST")
        val approvers = (node.config["approvers"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()

        // Check for an existing approval row (prevents duplicate creation on resume)
        val existing = approvalStore.findApproval(ctx.runId, node.id)

        return when (existing?.status?.uppercase()) {
            "APPROVED" -> NodeResult.Completed(
                output   = mapOf("decision" to "approved", "approvalId" to existing.id.toString(), "resolvedBy" to (existing.resolvedBy ?: "")),
                metadata = mapOf("approvalId" to existing.id.toString(), "decision" to "approved"),
            )

            "REJECTED" -> NodeResult.Failed(
                reason = "Approval rejected for node '${node.label.ifBlank { node.id }}'" +
                    (existing.resolvedBy?.let { " by $it" } ?: ""),
            )

            "PENDING" -> {
                // Already pending — re-pause without creating a duplicate row
                NodeResult.ApprovalPaused(
                    approvalId = existing.id.toString(),
                    message    = existing.message ?: message,
                    metadata   = mapOf("approvers" to approvers, "nodeId" to node.id),
                )
            }

            else -> {
                // No existing row — create a new pending approval
                val approvalId = approvalStore.createPendingApproval(
                    runId          = ctx.runId,
                    workspaceId    = ctx.workspaceId,
                    environmentId  = ctx.environmentId,
                    nodeId         = node.id,
                    message        = message,
                    approvers      = approvers,
                    resolvedInputs = resolvedInputs,
                )

                NodeResult.ApprovalPaused(
                    approvalId = approvalId,
                    message    = message,
                    metadata   = mapOf("approvers" to approvers, "nodeId" to node.id),
                )
            }
        }
    }
}
