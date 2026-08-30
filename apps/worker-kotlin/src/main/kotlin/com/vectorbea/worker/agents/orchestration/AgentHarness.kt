package com.vectorbea.worker.agents.orchestration

import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import com.vectorbea.worker.agents.brain.model.AgentLoopState
import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner
import com.vectorbea.worker.agents.brain.runtime.StopReasonTaxonomy
import com.vectorbea.observability.failures.Classification
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.graph.RuntimeContext
import java.util.UUID

/**
 * One activation's lifecycle: reattach or create, carve out the budget, run the
 * brain, normalise the result.
 *
 * WHAT THIS PHASE IS AND IS NOT
 * -----------------------------
 * It is the activation becoming the durable unit of one agent's participation,
 * with the EXISTING single-agent path routed through it. It is not delegation,
 * teams, or new brain actions — those are later phases, and [ActivationResult]
 * carries their cases as defined-but-unconstructed so that adding them is a
 * compile error at every consumer rather than a silent fall-through.
 *
 * NOTHING ABOUT A SINGLE-AGENT RUN MAY BEHAVE DIFFERENTLY. The normalisation
 * below — which stop reason becomes which node result, which underscore-prefixed
 * keys ride on the output, how a failure message is built — was MOVED here from
 * `AgentNodeExecutor` unchanged, because every one of those shapes is asserted by
 * a test written before this phase existed. Rewriting them while moving them is
 * the way this phase silently breaks something.
 */
class AgentHarness(
    private val store: ActivationStore,
    private val brainRunner: AgentBrainRunner,
) {
    private val log = logger()

    /** What an activation was asked to do. */
    data class ActivationRequest(
        val runId: UUID,
        val workspaceId: UUID,
        val environmentId: UUID,
        val stepId: String,
        val agentId: UUID,
        val agentName: String,
        /**
         * Resolved through the node-config → taskInstruction → task → prompt →
         * input fallback by the caller. Used ONLY when no activation exists yet;
         * on reattach the stored value wins. See [ActivationStore.createOrReattach].
         */
        val resolvedTaskInstruction: String?,
        /** Pinned on first creation, re-read from the row on resume. */
        val agentSnapshot: Map<String, Any?>,
        val agentVersion: String?,
        val budgetAllocated: Map<String, Any?>,
        /** Built by the caller so the config stays the caller's concern. */
        val buildConfig: (taskInstruction: String?) -> AgentBrainConfig,
    )

    /**
     * How an activation ended.
     *
     * Sealed, and consumed by an exhaustive `when` with no `else`, so P7 adding
     * [Delegated] or [Transferred] fails to compile everywhere they are not
     * handled instead of falling through to a default that quietly does the wrong
     * thing.
     */
    sealed class ActivationResult {
        data class Completed(
            val output: Map<String, Any>,
            val iterationsUsed: Int,
            val tokensUsed: Int,
        ) : ActivationResult()

        data class Paused(
            val approvalId: String,
            val message: String,
            val iterationsUsed: Int,
        ) : ActivationResult()

        data class Failed(
            val reason: String,
            val stopReason: AgentLoopState.StopReason,
            val retryable: Boolean,
        ) : ActivationResult()

        /** P7. The agent delegated and is parked on a child. Never constructed here. */
        data class Delegated(val childActivationIds: List<UUID>) : ActivationResult()

        /** P7. Control transferred to a peer; this activation is done. Never constructed here. */
        data class Transferred(val toActivationId: UUID) : ActivationResult()
    }

    suspend fun activate(req: ActivationRequest, ctx: RuntimeContext): ActivationResult {
        /*
         * Reattach or create. Isolated so that a fault in activation bookkeeping
         * degrades to "no activation row" rather than failing a run that would
         * otherwise have worked — the same posture every observability write in
         * this system takes.
         */
        val activation = runCatching {
            store.createOrReattach(
                runId = req.runId, workspaceId = req.workspaceId,
                environmentId = req.environmentId, stepId = req.stepId,
                agentId = req.agentId,
                resolvedTaskInstruction = req.resolvedTaskInstruction,
                agentSnapshot = req.agentSnapshot,
                agentVersion = req.agentVersion,
                budgetAllocated = req.budgetAllocated,
            )
        }.getOrNull()

        if (activation?.reattached == true) {
            log.info("[activation] reattached {} run={} step={} (status={})",
                activation.id, req.runId, req.stepId, activation.status)
        }

        /*
         * ── VERSION PINNING, AND ITS ONE BOUNDARY ───────────────────────────
         *
         * The instruction comes from the ROW when there is one, so a run finishes
         * as the thing it started as rather than half on the old definition and
         * half on the edited one.
         *
         * The pin covers the DEFINITION, never the GRANT. Granted tool ids are
         * deliberately absent from the snapshot and are re-read live by the brain
         * on every execution, failing closed — because revoking a tool is a policy
         * decision, and a paused run must not resume with access somebody
         * deliberately removed. Same reasoning as the beta gate being re-read at
         * execution rather than trusted from enqueue time.
         */
        val instruction = activation?.taskInstruction ?: req.resolvedTaskInstruction
        val config = req.buildConfig(instruction)

        /*
         * ── THE ACTIVATION SPAN, AND THE REGISTRY SWAP UNDER IT ──────────────
         *
         * P2 defined the `activation` and `iteration` span kinds and emitted
         * neither, because nothing owned an activation yet. This does.
         *
         * Opened AFTER the row so the span carries the activation id it belongs to;
         * every span opened beneath it inherits that id without any executor having
         * to know activations exist. See RunTracer.open.
         *
         * The rebind is what makes the tree nest. The brain's model and tool calls
         * find their parent by this step's node id — which until now resolved to the
         * STEP span, so an agent's whole loop hung flat off the step. Pointing the id
         * at the activation for the duration of the call puts the loop inside it, and
         * the restore in the finally puts it back so anything the runtime opens after
         * this step parents exactly where it did before.
         */
        val tracer = ctx.tracer
        val stepSpan = tracer?.spanForNode(req.stepId)
        val activationSpan = tracer?.open(
            kind = "activation",
            name = req.agentName,
            parentSpanId = stepSpan ?: tracer.tickSpanId,
            activationId = activation?.id,
        )
        if (activationSpan != null) tracer.bindNode(req.stepId, activationSpan)

        val result = try {
            brainRunner.run(config, ctx)
        } catch (e: Throwable) {
            /* The brain threw rather than returning a stop reason — a budget ceiling
               or an unexpected fault. The span still has to close, or the trace shows
               an activation that never ended and the critical path walks off it. */
            closeActivationSpan(
                tracer, activationSpan, req, stepSpan,
                status = "error", stopReason = null,
                failureReason = e.message?.take(300) ?: e.javaClass.simpleName,
                iterations = 0, tokens = 0,
            )
            activation?.let { a ->
                runCatching {
                    store.complete(a.id, ActivationStore.Status.FAILED, null, null, null, emptyMap())
                }
            }
            throw e
        }

        // ── Normalisation. Moved verbatim; see the class note. ───────────────
        val normalised: ActivationResult = when {
            result.stopReason == AgentLoopState.StopReason.APPROVAL_REQUESTED &&
                result.approvalId != null ->
                ActivationResult.Paused(
                    approvalId = result.approvalId,
                    message = result.approvalMessage
                        ?: "Agent '${req.agentName}' is waiting for approval to continue.",
                    iterationsUsed = result.iterationsUsed,
                )

            result.stopReason == AgentLoopState.StopReason.FINAL_OUTPUT ->
                ActivationResult.Completed(
                    output = result.finalOutput.filterValues { it != null }
                        .mapValues { it.value!! } + mapOf(
                        "_brainIterations" to result.iterationsUsed,
                        "_brainTokens" to result.tokensUsed,
                        "_brainStopReason" to result.stopReason.name,
                    ) + if (result.failedToolCalls.isEmpty()) emptyMap() else mapOf(
                        "_toolFailures" to result.failedToolCalls.size,
                        "_toolFailureMessages" to result.failedToolCalls.map { it.take(300) },
                    ),
                    iterationsUsed = result.iterationsUsed,
                    tokensUsed = result.tokensUsed,
                )

            else -> ActivationResult.Failed(
                reason = buildFailureMessage(req.agentName, result),
                stopReason = result.stopReason,
                retryable = result.retryable,
            )
        }

        closeActivationSpan(
            tracer, activationSpan, req, stepSpan,
            status = when (normalised) {
                is ActivationResult.Completed -> "ok"
                /* Not an error. An activation parked on a person is the product
                   working; painting it red is how "approve this" reads as "this
                   broke". */
                is ActivationResult.Paused -> "paused"
                else -> "error"
            },
            stopReason = result.stopReason,
            failureReason = result.failureReason,
            iterations = result.iterationsUsed,
            tokens = result.tokensUsed,
        )

        // ── Record the outcome on the activation ─────────────────────────────
        activation?.let { a ->
            runCatching {
                val consumed = mapOf(
                    "iterations" to result.iterationsUsed,
                    "tokens" to result.tokensUsed,
                    "costCents" to result.estimatedCostCents,
                )
                when (normalised) {
                    is ActivationResult.Completed -> store.complete(
                        a.id, ActivationStore.Status.SUCCEEDED, normalised.output,
                        result.stopReason.name, null, consumed)

                    /* Parked, not ended: an activation waiting on a person is still
                       this run's activation, and the resume must find it in a
                       non-terminal state to reattach to. */
                    is ActivationResult.Paused ->
                        store.park(a.id, ActivationStore.Status.WAITING_FOR_APPROVAL)

                    is ActivationResult.Failed -> store.complete(
                        a.id, ActivationStore.Status.FAILED, null,
                        result.stopReason.name, null, consumed)

                    is ActivationResult.Delegated, is ActivationResult.Transferred ->
                        error("P7 result reached the P6 harness — this is unreachable")
                }
            }
        }

        return normalised
    }

    /**
     * Close the activation span and hand the node id back to the step span.
     *
     * One function rather than a `finally`, because the two exits carry genuinely
     * different information — a thrown budget ceiling has no stop reason and no
     * token count — and a `finally` that reconstructs them from nullable locals is
     * how a span ends up labelled `error` for a run that succeeded.
     *
     * Every line is wrapped: this is observability, and an activation must not fail
     * because its span could not be written.
     */
    private fun closeActivationSpan(
        tracer: com.vectorbea.worker.events.RunTracer?,
        activationSpan: UUID?,
        req: ActivationRequest,
        restoreTo: UUID?,
        status: String,
        stopReason: AgentLoopState.StopReason?,
        failureReason: String?,
        iterations: Int,
        tokens: Int,
    ) {
        if (tracer == null || activationSpan == null) return
        runCatching {
            /*
             * The SAME classifier the failure panel and the cause sentence use. A
             * span carrying a class the read side computed differently is worse than
             * a span carrying none: the debugger would show two answers for one
             * failure and offer no way to tell which is right.
             */
            val failureClass = stopReason
                ?.let { StopReasonTaxonomy.classify(it, failureReason) }
                ?.let { it as? Classification.Failed }
                ?.verdict?.failureClass?.name

            tracer.close(
                activationSpan, "activation", req.agentName, status,
                stepId = req.stepId,
                /* Totals, in attributes rather than in tokens_in/tokens_out. The
                   loop reports one combined figure; splitting a total across the two
                   columns would make the trace's own arithmetic wrong, and the real
                   split is already on the llm_call spans beneath this one. */
                attributesJson =
                    """{"agent_id":"${req.agentId}","iterations":$iterations,"tokens":$tokens}""",
                failureClass = failureClass,
            )
            tracer.bindNode(req.stepId, restoreTo)
        }
    }

    /**
     * Moved verbatim from `AgentNodeExecutor`.
     *
     * Leads with WHAT went wrong and only then the category, because this string
     * becomes the run's `error_json` and is what the run detail screen shows for a
     * failed run. "Stopped with reason: ERROR after 1 iterations" told whoever
     * opened it nothing, while the real cause sat in an event further down.
     */
    private fun buildFailureMessage(agentName: String, result: AgentBrainRunner.RunResult): String {
        val cause = result.failureReason?.takeIf { it.isNotBlank() }
        /*
         * Byte-identical to what AgentNodeExecutor produced. Every character of
         * this is load-bearing: it becomes the run's error_json, the run detail
         * screen renders it, and the differential test compares it verbatim
         * between the flag being on and off. A tidier phrasing here would be an
         * undetected behaviour change.
         */
        return buildString {
            append("Agent '$agentName' ")
            if (cause != null) append("failed: $cause") else append("did not produce a final output")
            append(" (stopReason=${result.stopReason}, iterations=${result.iterationsUsed})")
        }
    }
}
