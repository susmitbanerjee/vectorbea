package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode

/**
 * Executor for END nodes.
 *
 * An end node is a terminal node — it captures the final workflow output
 * from its resolved inputs and signals completion.  No outgoing edges
 * are selected after an END node (enforced by [GraphScheduler]).
 */
class EndNodeExecutor : NodeExecutor {
    override fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult = NodeResult.Completed(output = resolvedInputs)
}
