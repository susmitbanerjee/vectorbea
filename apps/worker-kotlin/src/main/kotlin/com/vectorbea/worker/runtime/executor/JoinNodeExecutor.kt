package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode

/**
 * Executor for JOIN nodes.
 *
 * A join node merges outputs from parallel branches.  It collects all inbound
 * step outputs and exposes them as a merged map under the key "branches".
 * Duplicate keys from different branches are last-writer-wins (deterministic
 * ordering by nodeId).
 *
 * The [GraphScheduler] ensures the JOIN node only becomes runnable once its
 * join policy is satisfied (e.g., all branches have completed for wait_all).
 */
class JoinNodeExecutor : NodeExecutor {
    override fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult {
        // Collect outputs from all completed inbound branch nodes
        val branchOutputs = mutableMapOf<String, Any>()
        val allOutputs    = ctx.allOutputs()

        // resolvedInputs already contains merged results from context input mapping
        // We additionally collect all step outputs from the graph's inbound sources
        val inboundSources = ctx.graph.inboundSources(node.id)
        for (sourceId in inboundSources.sorted()) { // sort for determinism
            val sourceOutput = allOutputs[sourceId] ?: continue
            branchOutputs[sourceId] = sourceOutput
            // Merge flat keys (for easy downstream access)
            branchOutputs.putAll(sourceOutput)
        }

        // Also include resolved inputs (from explicit inputMapping)
        branchOutputs.putAll(resolvedInputs)

        return NodeResult.Completed(output = branchOutputs)
    }
}
