package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode

/**
 * Executor for TRIGGER nodes.
 *
 * A trigger node is the entry point of a workflow.  It simply passes through
 * the workflow input as its output so downstream nodes can reference it via
 * `steps.triggerId.key` or `output.key`.
 */
class TriggerNodeExecutor : NodeExecutor {
    override fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult = NodeResult.Completed(
        output = ctx.workflowInput + resolvedInputs,
    )
}
