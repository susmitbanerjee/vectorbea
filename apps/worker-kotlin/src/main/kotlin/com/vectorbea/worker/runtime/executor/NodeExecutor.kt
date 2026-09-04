package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowNode

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
     * SUSPENDING BY CONTRACT. A node that waits — on an LLM, an HTTP tool, a
     * tenant database — must release its thread while it waits, because an
     * execution slot is now a semaphore permit rather than a thread. An
     * implementation that blocks instead of suspending pins a dispatcher thread
     * and silently serialises everything behind it; BlockHound fails the build
     * when that happens (see BlockingCallAuditTest).
     *
     * Blocking work that genuinely cannot be converted — JDBC to a tenant
     * database — belongs in `withContext(tenantDbDispatcher)`, never inline.
     *
     * @param node           the node definition (config, policies, etc.)
     * @param resolvedInputs inputs resolved from the context's input mapping
     * @param ctx            read-only view of current execution context
     */
    suspend fun execute(
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

    /**
     * Node failed. [reason] is a sanitized message safe to persist.
     *
     * [retryable] is whether running this node again could plausibly end differently.
     * Default true: a transport error, a refused connection, a provider hiccup — the
     * faults the node's retry policy exists for. Set it false when the executor KNOWS
     * the outcome is settled: an agent that considered the task and declined it, a
     * tool the agent is not granted, output that failed its schema. Those cost a full
     * execution to reproduce and reproduce identically, and on an agent step each
     * attempt is several LLM calls — enough to push the run past its per-tick
     * execution budget and make it yield and re-enqueue, so a doomed retry does not
     * just waste money, it visibly churns the run.
     */
    data class Failed(val reason: String, val retryable: Boolean = true) : NodeResult()

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

    /**
     * A provider rate-limited this call and the run should stand down.
     *
     * Not [Failed]: nothing is wrong and the work is not lost. Not a sleep
     * either — the run gives its worker permit back and resumes when the timer
     * fires, because holding a slot through a 60-second provider backoff is how
     * one throttled integration stalls a whole pool.
     *
     * The node is re-executed from the start on resume, which is safe because a
     * 429 means the provider did not perform the work.
     */
    data class Throttled(
        val provider: String,
        val retryAfterMs: Long,
        val message: String,
    ) : NodeResult()
}
