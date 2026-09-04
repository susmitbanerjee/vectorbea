package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowNode

/**
 * Executor for node types not yet supported by this worker (LLM, TOOL, AGENT, HTTP, DB_QUERY).
 *
 * Returns [NodeResult.Unsupported] which the [WorkflowRuntime] maps to a
 * NODE_TYPE_UNSUPPORTED event.  The node's [FailurePolicy] then determines
 * whether to fail the run or follow a failure edge.
 */
class UnsupportedNodeExecutor : NodeExecutor {
    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult = NodeResult.Unsupported(nodeType = node.type)
}
