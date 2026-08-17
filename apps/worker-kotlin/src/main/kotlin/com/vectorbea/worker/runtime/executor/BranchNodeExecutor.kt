package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode

/**
 * Executor for BRANCH nodes.
 *
 * A branch node evaluates outgoing edge conditions to decide which path to follow.
 * The node itself does not perform any computation — it passes its resolved inputs
 * through as output so the [GraphScheduler] can use the output map to evaluate
 * edge conditions.
 *
 * Edge condition evaluation happens in [GraphScheduler.selectEdgesAfterNode].
 */
class BranchNodeExecutor : NodeExecutor {
    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult {
        // Merge predecessor outputs so branch conditions can reference them via "output.key"
        val merged = mutableMapOf<String, Any>()
        val predecessors = ctx.graph.inboundSources(node.id).filter { ctx.isCompleted(it) }
        for (predId in predecessors) {
            merged.putAll(ctx.getOutput(predId))
        }
        // resolved inputs (from explicit input mapping) take precedence
        merged.putAll(resolvedInputs)
        return NodeResult.Completed(output = merged)
    }
}
