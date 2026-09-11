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
    /**
     * The subtree's budget, when there is one.
     *
     * Null for a single-agent run, which has no tree to bound — its budget is the
     * agent's own `AgentBudget`, enforced in the loop. Non-null once delegation
     * lands, and consulted HERE rather than in the brain because a clamp is a
     * property of the activation, not of an iteration: the agent needs to be told
     * once, at the top, what it actually has.
     */
    private val ledger: com.vectorbea.worker.agents.budget.BudgetLedger? = null,
) {
    private val log = logger()
    private val mapper = com.fasterxml.jackson.module.kotlin.jacksonObjectMapper()

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
        /*
         * The activation id and depth are stamped HERE, not by the caller, because
         * the harness is what owns the activation. They are load-bearing for three
         * separate things — the depth guard, the depth-scoped approval keys, and a
         * delegation's parent id — and a caller that forgot one would produce a run
         * that delegates with no bound, keys its gates as a root, or cannot delegate
         * at all.
         */
        val config = req.buildConfig(instruction).copy(
            activationId = activation?.id,
            depth = activation?.depth ?: 0,
        )

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
        /*
         * ── THE ROOT'S ALLOCATION, WITHOUT WHICH THE TREE HAS NO CEILING ─────
         *
         * BudgetLedger.allocate fails CLOSED on an unknown parent — a child of an
         * un-hydrated parent is granted nothing. That is the right direction to
         * fail, and it means the root must be allocated before any delegation can
         * be. Doing it here, once, is also what makes the ledger's tree match the
         * activation tree: the root of one is the root of the other.
         *
         * Idempotent by construction: `allocate` returns the existing grant for an
         * activation it already knows, so a resumed tick does not re-debit anything.
         */
        activation?.let { a ->
            ledger?.allocate(a.id, null, com.vectorbea.worker.agents.budget.BudgetVector(
                iterations = (req.budgetAllocated["maxIterations"] as? Number)?.toInt() ?: 0,
                toolCalls = (req.budgetAllocated["maxToolCalls"] as? Number)?.toInt() ?: 0,
                tokens = (req.budgetAllocated["maxTotalTokens"] as? Number)?.toLong() ?: 0L,
                costMicroCents = com.vectorbea.worker.agents.budget.BudgetVector.ofCents(
                    (req.budgetAllocated["maxCostCents"] as? Number)?.toDouble() ?: 0.0),
            ))
        }

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
                iterations = 0, tokens = 0, activationId = activation?.id,
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
            activationId = activation?.id,
            /* §5 of the skills design: which skills were active on an activation
               is a span attribute, so a behaviour change months later is
               attributable to a skill VERSION rather than to the agent. The loop
               is the only thing that knows what was actually composed — a grant
               row does not, because a skill can be granted and then dropped. */
            skillAttributes = result.skillAttributes,
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
                        a.id,
                        /* Neither succeeded nor failed. A router that correctly
                           transferred to a specialist did its job: grading it
                           succeeded inflates success metrics, and grading it failed
                           makes every routed run look broken. */
                        if (result.handedOff) ActivationStore.Status.HANDED_OFF
                        else ActivationStore.Status.SUCCEEDED,
                        normalised.output, result.stopReason.name, null, consumed)

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
        activationId: UUID? = null,
        /**
         * The skills this activation composed. Empty on the throw path, where the
         * loop did not get far enough to say — which is honest: an activation
         * that died before composing had none.
         */
        skillAttributes: Map<String, Any> = emptyMap(),
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
                   split is already on the llm_call spans beneath this one.

                   A budget clamp rides here too. An agent that produced a thin
                   answer because it was handed a tenth of what it asked for looks,
                   in every other artefact, exactly like an agent that is bad at
                   its job — the clamp is the one thing that tells them apart. */
                attributesJson = activationAttributes(req, iterations, tokens, activationId, skillAttributes),
                failureClass = failureClass,
            )
            tracer.bindNode(req.stepId, restoreTo)
        }
    }

    /**
     * The activation span's attributes, with the budget clamp merged in.
     *
     * Built as a map and serialised, not concatenated: the clamp's dimension list
     * comes from the ledger and an agent name can contain a quote, and a
     * hand-built JSON string that is occasionally invalid produces a span whose
     * attributes silently fail to parse on the read side.
     */
    private fun activationAttributes(
        req: ActivationRequest,
        iterations: Int,
        tokens: Int,
        activationId: UUID?,
        skillAttributes: Map<String, Any> = emptyMap(),
    ): String {
        val attrs = buildMap<String, Any> {
            put("agent_id", req.agentId.toString())
            put("iterations", iterations)
            put("tokens", tokens)
            activationId?.let { id -> putAll(ledger?.spanAttributes(id) ?: emptyMap()) }
            /* Last, so a future clamp key can never quietly shadow a skills key —
               and if one ever collides, the collision is visible here rather than
               in whichever map happened to be merged second. */
            putAll(skillAttributes)
        }
        return runCatching { mapper.writeValueAsString(attrs) }.getOrDefault("{}")
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
