package com.vectorbea.worker.agents.orchestration

import com.vectorbea.worker.agents.budget.BudgetLedger
import com.vectorbea.worker.agents.budget.BudgetVector
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.graph.RuntimeContext
import java.util.UUID

/**
 * A team, run.
 *
 * ── INVARIANT 9: THIS IS NOT A SECOND SCHEDULER ─────────────────────────────
 * It has no queue, no wait set, no lease, no timer and nothing to wake. It does
 * not decide when a worker runs — `WorkflowRuntime` already owns that, and this
 * executes inside ONE node execution, on that runtime's thread, under that
 * runtime's per-tick execution budget. When the tick runs out it returns upward
 * and the existing checkpoint-and-yield machinery takes over unchanged; nothing
 * here holds the worker.
 *
 * What it actually does is three things:
 *
 *   1. allocate the team's budget on the entry activation, through the P7 ledger;
 *   2. start the entry member, through the SAME `AgentHarness` a lone agent uses;
 *   3. read the outcome against the policy's [Termination] row.
 *
 * Everything in between — delegation, fan-out, joins, guards — happens in the
 * primitives P8 and P9 built, driven by the agents' own brain actions. A team is
 * configuration over those primitives, which is exactly what §6 claims and what
 * this class has to keep true.
 *
 * ── THE ONE POLICY THAT ITERATES, AND WHY IT IS STILL NOT A SCHEDULER ───────
 * [OrchestrationPolicy.PIPELINE] has no model making the routing decision — the
 * order IS the configuration — so the loop advances the stages itself. That is a
 * `for` over the same `delegate` primitive one delegation uses. It creates no
 * concurrency, no ordering problem and nothing a resumed tick must rebuild.
 */
class OrchestrationLoop(
    private val activations: ActivationStore,
    private val ledger: BudgetLedger,
    /**
     * Runs one member to completion. Supplied by the caller so this class does
     * not construct a brain — the same seam `AgentCallExecutor` uses, and the
     * reason the recursion between the two is a cycle nobody has to break here.
     */
    private val runMember: suspend (MemberCall, RuntimeContext) -> MemberOutcome,
    /** Delegates from one member to another. The pipeline's only verb. */
    private val transfer: suspend (TransferCall, RuntimeContext) -> MemberOutcome,
) {
    private val log = logger()

    data class MemberCall(
        val member: TeamConfig.Member,
        val activationId: UUID,
        val taskInstruction: String?,
        val inputs: Map<String, Any?>,
        val budget: BudgetVector,
        val depth: Int,
    )

    data class TransferCall(
        val from: TeamConfig.Member,
        val fromActivationId: UUID,
        val to: TeamConfig.Member,
        val contract: TaskContract,
        val depth: Int,
        val rootActivationId: UUID,
    )

    /** What one member produced. The three outcomes every callable has. */
    sealed class MemberOutcome {
        data class Completed(val output: Map<String, Any>, val handedOff: Boolean = false) :
            MemberOutcome()
        data class Paused(val approvalId: String, val message: String) : MemberOutcome()
        data class Failed(val reason: String, val stopReason: String) : MemberOutcome()
        /** The tick ended mid-work. Not an outcome; the node re-executes. */
        data class Yielded(val reason: String) : MemberOutcome()
    }

    /** How the team ended. Mapped onto `NodeResult` by the executor. */
    sealed class TeamOutcome {
        data class Completed(val output: Map<String, Any>) : TeamOutcome()
        data class Paused(val approvalId: String, val message: String) : TeamOutcome()
        data class Failed(val reason: String, val stopReason: String, val retryable: Boolean = false) :
            TeamOutcome()

        /**
         * The budget ran out but the team has something to say.
         *
         * NOT a failure. §8's completion margin exists exactly so a supervisor
         * whose workers spent the rest can still write down what they found, and a
         * partial answer with a stated shortfall is worth more than a failed run
         * holding a complete set of results nobody can read.
         */
        data class Partial(val output: Map<String, Any>, val shortfall: String) : TeamOutcome()

        /**
         * The tick ended before the team did.
         *
         * NOT a failure and not a result. The team's activations are durable and
         * terminal children reattach, so re-executing this node continues rather
         * than repeating — which is what makes standing the run down cheap enough
         * to be the right answer.
         */
        data class Yielded(val reason: String) : TeamOutcome()
    }

    /**
     * Run [team] to a terminal state.
     *
     * @param entryActivationId the entry member's activation, created by the caller
     *        so the ledger and the trace agree on the root before anything runs.
     */
    suspend fun run(
        team: TeamConfig,
        ctx: RuntimeContext,
        entryActivationId: UUID,
        taskInstruction: String?,
        inputs: Map<String, Any?>,
    ): TeamOutcome {
        /*
         * The team's budget, on the entry activation. Everything beneath is
         * carved from this by the ledger, so the team is bounded as a TREE rather
         * than as a set of agents that each stayed inside their own limit — which
         * is the arithmetic §8 opens with.
         */
        val allocated = ledger.allocate(entryActivationId, null, team.budget)
        if (allocated.clamped) {
            log.info("[team] entry budget clamped on {}: {}",
                entryActivationId, allocated.clampedDimensions)
        }

        val outcome = runPolicy(team, ctx, entryActivationId, taskInstruction, inputs,
            allocated.granted)

        /*
         * ── THE ENTRY ACTIVATION IS THIS LOOP'S TO CLOSE ────────────────────
         *
         * A single agent's activation is terminalised by `AgentHarness`, which the
         * team path does not go through — the team owns its entry. Leaving it
         * `running` after the node returns is not cosmetic: `running` is a
         * NON-TERMINAL status, so a resumed tick would reattach and run the whole
         * team again, and the debugger would draw a finished run as in-flight
         * forever.
         */
        terminaliseEntry(entryActivationId, outcome)
        return outcome
    }

    /** The policy table's one branch: everything except a pipeline starts its entry. */
    private suspend fun runPolicy(
        team: TeamConfig,
        ctx: RuntimeContext,
        entryActivationId: UUID,
        taskInstruction: String?,
        inputs: Map<String, Any?>,
        budget: BudgetVector,
    ): TeamOutcome {
        return when (team.policy.terminatesOn) {
            /*
             * FOUR OF THE FIVE POLICIES ARE THE SAME CODE. The entry member runs,
             * its own brain actions drive the delegation, and the policy's only
             * remaining job is to say how to read the result. That similarity is
             * the design working — if these needed four branches, §6's claim that
             * a policy is a table entry would be false.
             */
            Termination.ENTRY_FINAL,
            Termination.TRANSFER_TARGET_FINAL,
            Termination.REVIEWER_APPROVES_OR_ROUNDS,
            Termination.QUORUM_OR_PEER_FINAL ->
                runEntry(team, ctx, entryActivationId, taskInstruction, inputs, budget)

            Termination.LAST_STAGE_FINAL ->
                runPipeline(team, ctx, entryActivationId, taskInstruction, inputs, budget)
        }
    }

    /**
     * Close the entry activation, per §5.1.
     *
     * ── handed_off IS TERMINAL AND IS NEITHER SUCCESS NOR FAILURE ───────────
     * A router that correctly transferred did its job. Grading it `succeeded`
     * inflates success metrics; grading it `failed` makes every routed run look
     * broken. It is its own terminal status, and every aggregate that ever counts
     * activation outcomes has to know that — which is why it is written here, once,
     * rather than inferred by a reader from the absence of an output.
     *
     * A YIELD writes nothing: the tick ended, the team is not finished, and a
     * terminal status would stop the resumed tick from continuing it.
     */
    private fun terminaliseEntry(entryActivationId: UUID, outcome: TeamOutcome) {
        runCatching {
            when (outcome) {
                is TeamOutcome.Yielded -> Unit

                is TeamOutcome.Paused ->
                    activations.park(entryActivationId, ActivationStore.Status.WAITING_FOR_APPROVAL)

                is TeamOutcome.Completed -> activations.complete(
                    entryActivationId,
                    if (handedOff) ActivationStore.Status.HANDED_OFF
                    else ActivationStore.Status.SUCCEEDED,
                    outcome.output, "FINAL_OUTPUT", null, emptyMap())

                is TeamOutcome.Partial -> activations.complete(
                    entryActivationId, ActivationStore.Status.SUCCEEDED,
                    outcome.output, "FINAL_OUTPUT", null, emptyMap())

                is TeamOutcome.Failed -> activations.complete(
                    entryActivationId, ActivationStore.Status.FAILED, null,
                    outcome.stopReason, null, emptyMap())
            }
        }
    }

    /**
     * Whether the entry TRANSFERRED rather than answering.
     *
     * Set by [interpret] and read by [terminaliseEntry], because a handoff ends
     * with FINAL_OUTPUT and the child's answer — indistinguishable, from the
     * outcome alone, from the entry having produced that answer itself.
     */
    private var handedOff = false

    /** Start the entry member and read what it produced. */
    private suspend fun runEntry(
        team: TeamConfig,
        ctx: RuntimeContext,
        entryActivationId: UUID,
        taskInstruction: String?,
        inputs: Map<String, Any?>,
        budget: BudgetVector,
    ): TeamOutcome {
        val outcome = runMember(
            MemberCall(team.entry, entryActivationId, taskInstruction, inputs, budget, depth = 0),
            ctx,
        )
        return interpret(team, outcome, entryActivationId)
    }

    /**
     * Each stage transfers to the next; the last stage's output is the team's.
     *
     * A transfer, not a delegation, because a stage does not wait for the next
     * one and does not read its result — which is also why the depth guard does
     * not grow down a pipeline. See `AgentCallExecutor`'s note on tail calls.
     */
    private suspend fun runPipeline(
        team: TeamConfig,
        ctx: RuntimeContext,
        entryActivationId: UUID,
        taskInstruction: String?,
        inputs: Map<String, Any?>,
        budget: BudgetVector,
    ): TeamOutcome {
        var carried: Map<String, Any> = inputs.filterValues { it != null }.mapValues { it.value!! }
        var fromActivation = entryActivationId
        var from = team.entry

        val first = runMember(
            MemberCall(team.entry, entryActivationId, taskInstruction, inputs, budget, depth = 0), ctx)
        when (first) {
            is MemberOutcome.Yielded -> return TeamOutcome.Yielded(first.reason)
            is MemberOutcome.Paused -> return TeamOutcome.Paused(first.approvalId, first.message)
            is MemberOutcome.Failed -> return TeamOutcome.Failed(
                "Stage '${team.entry.alias ?: team.entry.agentId}' failed: ${first.reason}",
                first.stopReason)
            is MemberOutcome.Completed -> carried = first.output
        }

        for (stage in team.roster.drop(1)) {
            val contract = TaskContract(
                objective = taskInstruction ?: "Continue the pipeline.",
                inputs = carried,
                budget = ledger.remaining(fromActivation)?.availableToChildren ?: BudgetVector.ZERO,
            )
            val outcome = transfer(
                TransferCall(from, fromActivation, stage, contract, depth = 0,
                    rootActivationId = entryActivationId),
                ctx,
            )
            when (outcome) {
                is MemberOutcome.Yielded -> return TeamOutcome.Yielded(outcome.reason)
                is MemberOutcome.Paused -> return TeamOutcome.Paused(outcome.approvalId, outcome.message)
                is MemberOutcome.Failed -> {
                    /*
                     * A pipeline stage is not an optional worker. Its output IS the
                     * next stage's input, so continuing past a failure would run the
                     * remaining stages on nothing — the P9 "carry on" rule does not
                     * apply where there is nothing to carry.
                     */
                    return partialOr(TeamOutcome.Failed(
                        "Stage '${stage.alias ?: stage.agentId}' failed: ${outcome.reason}",
                        outcome.stopReason), carried, entryActivationId)
                }
                is MemberOutcome.Completed -> {
                    carried = outcome.output
                    from = stage
                    /* The next stage transfers FROM this one, so the handoff chain
                       matches the pipeline the builder drew. */
                    fromActivation = activations
                        .lineageOf(entryActivationId).firstOrNull() ?: entryActivationId
                }
            }
        }
        return TeamOutcome.Completed(carried)
    }

    /**
     * Read a member's outcome against the policy.
     *
     * ── handed_off IS NEITHER SUCCESS NOR FAILURE ───────────────────────────
     * A router that correctly transferred did its job. The TEAM succeeded — the
     * specialist's answer is the team's answer — and the router's own activation
     * ends `handed_off`, which is terminal and is graded as neither. That is why
     * a routed run leaves success-rate metrics exactly where they were: the
     * metric counts runs, the run succeeded, and nothing anywhere counts a
     * `handed_off` activation as a failure.
     */
    private fun interpret(
        team: TeamConfig,
        outcome: MemberOutcome,
        entryActivationId: UUID,
    ): TeamOutcome = when (outcome) {
        is MemberOutcome.Paused -> TeamOutcome.Paused(outcome.approvalId, outcome.message)

        is MemberOutcome.Completed -> {
            handedOff = outcome.handedOff
            if (team.policy.terminatesOn == Termination.TRANSFER_TARGET_FINAL && !outcome.handedOff) {
                /*
                 * A router that answered instead of routing. Legal — the model may
                 * decide no specialist is needed — but worth saying, because a
                 * router that NEVER routes is a workflow that should not have been
                 * a team, and the only place that is visible is here.
                 */
                log.info("[team] router {} answered without transferring", team.entry.agentId)
            }
            TeamOutcome.Completed(outcome.output)
        }

        is MemberOutcome.Yielded -> TeamOutcome.Yielded(outcome.reason)

        is MemberOutcome.Failed -> partialOr(
            TeamOutcome.Failed(outcome.reason, outcome.stopReason), emptyMap(), entryActivationId)
    }

    /**
     * A budget failure with something to show becomes a PARTIAL, not a failure.
     *
     * §8's completion margin is held back precisely so this is possible. Without
     * it the run dies at `BUDGET_EXCEEDED` holding a complete set of worker
     * results that nobody can read, having paid for all of them.
     */
    private fun partialOr(
        failure: TeamOutcome.Failed,
        carried: Map<String, Any>,
        entryActivationId: UUID,
    ): TeamOutcome {
        val budgetish = failure.stopReason == "TEAM_BUDGET_EXCEEDED" ||
            failure.stopReason == "BUDGET_EXCEEDED"
        if (!budgetish || carried.isEmpty()) return failure

        val snap = ledger.remaining(entryActivationId)
        val margin = snap?.completionReserve
        if (margin == null || margin.isExhausted) return failure

        return TeamOutcome.Partial(
            output = carried + mapOf("_partial" to true, "_shortfall" to failure.reason),
            shortfall = failure.reason,
        )
    }
}
