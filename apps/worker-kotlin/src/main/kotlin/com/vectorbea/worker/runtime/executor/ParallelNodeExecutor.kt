package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode

/**
 * Executor for PARALLEL nodes.
 *
 * A parallel node is a fan-out control node — it activates all its outgoing
 * PARALLEL edges simultaneously.  The node itself performs no computation.
 * Actual parallel branch execution is orchestrated by [WorkflowRuntime].
 */
class ParallelNodeExecutor : NodeExecutor {
    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult = NodeResult.Completed(output = resolvedInputs)
}
