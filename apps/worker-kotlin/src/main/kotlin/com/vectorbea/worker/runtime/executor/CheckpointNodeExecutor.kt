package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowNode

/**
 * Executor for CHECKPOINT nodes — the canvas's "Checkpoint" step.
 *
 * Completes at once and passes its resolved inputs through, the way an END node
 * does without ending the run. The durability it names is already provided by
 * the runtime: each completed node's output is persisted, so a retry or resume
 * reuses everything before the failure instead of repeating it. No I/O, no side
 * effects, nothing to retry.
 */
class CheckpointNodeExecutor : NodeExecutor {
    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult = NodeResult.Completed(output = resolvedInputs)
}
