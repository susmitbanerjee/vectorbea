package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode

/**
 * Pluggable executor for a single workflow node type.
 *
 * Each implementation receives the resolved inputs and returns a [NodeResult].
 * Executors must NOT mutate [RuntimeContext] directly — they return results
 * and [WorkflowRuntime] applies them.
 *
 * SECURITY: [resolvedInputs] may contain user data from [RuntimeContext.workflowInput].
 * Executors must not log raw input values.
 */
interface NodeExecutor {
    /**
     * Execute the node.
     *
     * @param node           the node definition (config, policies, etc.)
     * @param resolvedInputs inputs resolved from the context's input mapping
     * @param ctx            read-only view of current execution context
     */
    fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult
}

/**
 * Result returned by a [NodeExecutor].
 */
sealed class NodeResult {
    /**
     * Node completed normally.
     * [output] is stored as the node's step output.
     * [metadata] carries sanitized diagnostic info (extraction mode, field count, etc.) — never raw data.
     */
    data class Completed(
        val output: Map<String, Any> = emptyMap(),
        val metadata: Map<String, Any> = emptyMap(),
    ) : NodeResult()

    companion object // allows extension functions

    /** Node failed. [reason] is a sanitized message safe to persist. */
    data class Failed(val reason: String) : NodeResult()

    /**
     * Node requires human approval before continuing.
     * The [approvalId] uniquely identifies the pending approval row.
     * The run will be paused until an approve/reject call is received.
     */
    data class ApprovalPaused(
        val approvalId: String,
        val message: String,
        val metadata: Map<String, Any> = emptyMap(),
    ) : NodeResult()

    /**
     * Node type is not supported by this worker.
     * The run will follow failure policy for the node.
     */
    data class Unsupported(val nodeType: String) : NodeResult()
}
