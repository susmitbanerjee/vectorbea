package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.agents.budget.BudgetLedger
import com.vectorbea.worker.agents.budget.BudgetVector
import com.vectorbea.worker.agents.orchestration.ActivationStore
import com.vectorbea.worker.agents.orchestration.HandoffStore
import com.vectorbea.worker.agents.orchestration.OutputSchemaCheck
import com.vectorbea.worker.agents.orchestration.TaskContract
import com.vectorbea.worker.agents.orchestration.TeamLimits
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.checkpoint.ApprovalDecision
import com.vectorbea.worker.runtime.checkpoint.ApprovalGateConfig
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.checkpoint.decideOnApproval
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode
import java.util.UUID
import javax.sql.DataSource

/**
 * One agent calling another. The agent-side twin of [ToolNodeExecutor].
 *
 * ── §2: AN AGENT IS A CALLABLE, EXACTLY LIKE A TOOL ─────────────────────────
 * This is deliberately the same class shape as [ToolNodeExecutor], not a
 * parallel design that happens to do something similar. It implements
 * [NodeExecutor]; it is driven by a synthetic [WorkflowNode] whose **id is the
 * approval key**; it does a workspace-scoped lookup that fails closed; it
 * enforces `requires_approval` at the boundary before anything happens; and it
 * returns the same [NodeResult] vocabulary. The brain's DELEGATE handler is
 * therefore `executeTool` with a different noun, rather than a second dispatch
 * path that will drift from it.
 *
 * ── WHERE THE GUARDS LIVE, AND WHY HERE ─────────────────────────────────────
 * Every §9 guard is checked in [execute], BEFORE an activation exists. The brain
 * also checks the roster before dispatching, which looks like duplication and is
 * not: the brain's check makes the stop attributable to the model's choice on a
 * specific iteration, and this one is the enforcement point — the only path a
 * future caller is guaranteed to go through. "The model chooses; the runtime
 * executes" means the runtime checks at the place it executes.
 *
 * Guards run BEFORE the approval gate, deliberately. Opening an approval for a
 * delegation that a guard would refuse spends a person's attention on a decision
 * that cannot matter.
 *
 * ── EXECUTION IS INLINE ─────────────────────────────────────────────────────
 * The child runs synchronously, same tick, same thread. `waiting_for_child` on
 * the parent is a durable marker rather than a scheduling state — it exists so a
 * crash mid-delegation leaves a row saying what the parent was doing, and so the
 * debugger renders the parent as blocked rather than idle. Dispatched child runs
 * are P10.
 */
class AgentCallExecutor(
    private val dataSource: DataSource,
    private val eventStore: RunEventStore,
    private val activations: ActivationStore,
    private val handoffs: HandoffStore,
    /**
     * Runs the child's brain. A lambda, not an [AgentBrainRunner], because the
     * brain builds THIS lazily to serve DELEGATE and this builds a child brain
     * per call — a constructor reference either way would be a cycle. The
     * recursion it creates is bounded by the depth guard, which is checked before
     * a child brain is ever constructed.
     */
    private val runChild: suspend (ChildCall, RuntimeContext) -> ChildOutcome,
    private val ledger: BudgetLedger? = null,
    private val limits: TeamLimits = TeamLimits(),
    /**
     * Which handoff kinds this team's policy permits, per §6.
     *
     * Null means "no team policy applies" — a lone agent using P9 delegation,
     * where every kind it can construct is allowed. Non-null and the check is
     * enforcement, not documentation: a router whose specialists start
     * delegating to each other is no longer a router, and the run that results is
     * one nobody designed.
     */
    private val permittedKinds: Set<HandoffStore.Kind>? = null,
    /**
     * The TEAM's roster for a given agent, when a team owns this call.
     *
     * ── WHY THE AGENT ROW IS NOT THE ANSWER ─────────────────────────────────
     * §6's `canDelegateTo` is PER MEMBER: the same agent can be a supervisor in
     * one team and a leaf in another, and neither team should have to edit the
     * agent to say so. Falling back to the row would mean a member's grant
     * applied only to the entry agent and every delegated child silently
     * inherited a global roster — the per-member rule would look implemented and
     * enforce nothing below depth 0.
     *
     * Null for a lone agent using P9 delegation, where the row IS the roster. A
     * team that has no entry for an agent returns null too, and that agent gets
     * no roster at all rather than the row's — because a member missing from the
     * team config is a member the builder did not put there.
     */
    private val rosterFor: ((UUID) -> Set<UUID>?)? = null,
    private val teamStartedAtMs: Long = System.currentTimeMillis(),
) : NodeExecutor {

    private val log = logger()
    private val mapper = jacksonObjectMapper()
    private val approvalStore by lazy { ApprovalStore(dataSource) }

    /** What the caller asks for. Assembled by the brain from the model's action. */
    data class ChildCall(
        val childActivationId: UUID,
        val agentId: UUID,
        val agentName: String,
        val instructions: String?,
        val modelName: String?,
        val llmConnectionId: UUID?,
        val allowedToolIds: Set<UUID>,
        val canDelegateTo: Set<UUID>,
        val contract: TaskContract,
        val depth: Int,
        val budget: BudgetVector,
    )

    /** What the child produced. Mirrors the three outcomes a tool call has. */
    sealed class ChildOutcome {
        data class Completed(val output: Map<String, Any>, val tokensUsed: Int, val costCents: Double) :
            ChildOutcome()

        data class Paused(val approvalId: String, val message: String) : ChildOutcome()

        data class Failed(val reason: String, val stopReason: String) : ChildOutcome()
    }

    /**
     * Why a delegation was refused before it started.
     *
     * A distinct type rather than a [NodeResult.Failed] with a parseable message,
     * because the caller has to turn each of these into a specific stop reason and
     * matching on prose is how a stop reason ends up being ERROR.
     */
    data class Refusal(val stopReason: String, val reason: String)

    class RefusedException(val refusal: Refusal) : RuntimeException(refusal.reason)

    // ── The boundary ─────────────────────────────────────────────────────────

    /**
     * [NodeExecutor] conformance, for the P10 `agent_call` graph node.
     *
     * Not registered in the runtime's dispatch table yet — there is no such node
     * type until fan-out lands. It implements the interface so that becomes a
     * one-line registration rather than a refactor, and so this class cannot
     * quietly grow a shape that a graph node could not drive.
     */
    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult = NodeResult.Unsupported("agent_call")

    /**
     * Validate, gate, create, run.
     *
     * @param approvalNodeId the synthetic node id that IS the approval key —
     *        `<stepId>:agent:<agentId>`. Passed in rather than derived here so
     *        the key lives in one place next to the tool key it must stay
     *        disjoint from.
     */
    suspend fun delegate(
        ctx: RuntimeContext,
        stepId: String,
        approvalNodeId: String,
        parentActivationId: UUID,
        parentDepth: Int,
        rootActivationId: UUID,
        targetAgentId: UUID,
        contract: TaskContract,
        reason: String?,
        kind: HandoffStore.Kind,
        contextVersion: Long,
        /** Non-null for one BROADCAST's children — what ties the fan-out together. */
        joinGroupId: UUID? = null,
    ): Result<ChildOutcome> {
        // ── 1. Workspace-scoped lookup, failing closed ────────────────────────
        val agent = try {
            loadAgent(targetAgentId, ctx.workspaceId)
        } catch (e: Exception) {
            /* Same posture as ToolNodeExecutor's approval lookup: a check that
               ERRORED is not a check that passed. */
            return refuse("AGENT_NOT_IN_ROSTER",
                "Could not verify agent $targetAgentId is available: ${e.message?.take(200)}")
        } ?: return refuse("AGENT_NOT_IN_ROSTER",
            "Agent $targetAgentId was not found in this workspace, or is not active.")

        // ── 2. The team's policy, before anything else ────────────────────────
        if (permittedKinds != null && kind !in permittedKinds) {
            return refuse("AGENT_NOT_IN_ROSTER",
                "This team's policy does not allow a ${kind.name} — '${agent.name}' was not " +
                "started. Permitted here: ${permittedKinds.joinToString { it.name }}.")
        }

        // ── 3. Every guard, before an activation exists ───────────────────────
        guard(ctx, parentActivationId, parentDepth, targetAgentId, contract, agent, kind)?.let {
            return Result.failure(RefusedException(it))
        }

        // ── 3. The gate, after the guards ─────────────────────────────────────
        if (agent.requiresApproval) {
            when (val gate = resolveGate(ctx, approvalNodeId, agent, contract)) {
                is Gate.Rejected -> return refuse("AGENT_NOT_IN_ROSTER",
                    "Delegating to '${agent.name}' was not approved" +
                        (gate.by?.let { " (decided by $it)" } ?: "") + ".")
                is Gate.Pending -> return Result.success(
                    ChildOutcome.Paused(gate.approvalId, gate.message))
                Gate.Granted -> Unit
            }
        }

        // ── 4. The activation, and the edge ───────────────────────────────────
        val activation = activations.createOrReattachChild(
            runId = ctx.runId, workspaceId = ctx.workspaceId, environmentId = ctx.environmentId,
            stepId = stepId, agentId = targetAgentId,
            parentActivationId = parentActivationId, rootActivationId = rootActivationId,
            /*
             * ── A TRANSFER IS A TAIL CALL, SO IT DOES NOT GROW THE STACK ────
             *
             * DELEGATE pushes a frame: the parent waits and will read the result,
             * so the chain genuinely gets deeper and the depth guard genuinely
             * bounds it. TRANSFER replaces the frame — the router is done the
             * moment it transfers, and §5.1 has it end `handed_off`.
             *
             * Counting a transfer as depth would cap a router chain and a pipeline
             * at `maxDepth` stages, which is a limit nobody chose and one that
             * reads as arbitrary on a canvas. A transfer chain is still bounded,
             * by three other things: maxActivations, HANDOFF_LOOP on the repeated
             * (from, to, contract) triple, and the subtree budget.
             *
             * The causal edge is unaffected: the child's parent is still the
             * activation that transferred to it, so the constellation view draws
             * the chain either way.
             */
            depth = if (kind == HandoffStore.Kind.TRANSFER) parentDepth else parentDepth + 1,
            contract = contract.toMap(),
            agentSnapshot = mapOf(
                "instructions" to agent.instructions,
                "modelName" to agent.modelName,
                "maxIterations" to agent.maxIterations,
            ),
            agentVersion = null,
            budgetAllocated = contract.budget.toMap(),
        ) ?: return refuse("MAX_DEPTH_EXCEEDED",
            "The activation for '${agent.name}' could not be created, so the delegation " +
            "did not run.")

        /*
         * ── THE REATTACH RULE ────────────────────────────────────────────────
         * Terminal: replay the recorded outcome, run nothing. That is what makes a
         * resumed delegation cost one row read instead of the child's entire brain
         * loop, and it is the acceptance criterion "zero repeated LLM calls".
         * Non-terminal: run it. See ActivationStore.Activation.terminal.
         */
        if (activation.reattached && activation.terminal) {
            log.info("[delegate] replaying terminal activation {} (status={})",
                activation.id, activation.status)
            return Result.success(replayTerminal(activation, agent.name))
        }

        /*
         * ── 5. THE BUDGET, KEYED ON THE ACTIVATION THAT ACTUALLY EXISTS ──────
         *
         * Allocated AFTER creation, and never before. This was a
         * freshly-generated UUID handed to the ledger while `createOrReattachChild`
         * minted its own id for the row — so `allocate`, `consume` and `settle` all
         * addressed a node no activation corresponded to. The allocation was
         * reserved against the parent and NEVER RELEASED, because settle was
         * settling a phantom. The first delegation worked; the second was refused
         * with TEAM_BUDGET_EXCEEDED, because from the parent's point of view its
         * whole budget was still out on loan to a child that had already finished.
         *
         * On a reattach the row's existing id is the one that matters, which is a
         * second reason this cannot be pre-generated.
         */
        val granted = ledger?.allocate(activation.id, parentActivationId, contract.budget)?.granted
            ?: contract.budget

        handoffs.record(
            runId = ctx.runId, workspaceId = ctx.workspaceId,
            fromActivationId = parentActivationId, toActivationId = activation.id,
            kind = kind, reason = reason, contract = contract,
            contractHash = contract.hash(), contextVersion = contextVersion,
            joinGroupId = joinGroupId,
        )

        emitEvent(ctx, stepId, EventType.AGENT_STARTED, "running",
            "Delegated to ${agent.name}",
            reason?.take(300) ?: contract.objective.take(300))

        // ── 6. The parent parks, durably, while the child runs ────────────────
        activations.park(parentActivationId, ActivationStore.Status.WAITING_FOR_CHILD)

        /*
         * The child's `activation` span, opened HERE because this is where the child
         * activation exists. The brain that runs the child does not open one — it is
         * an ordinary run from its own point of view, and does not know it is a
         * child. Bound to the step's node id so the child's iterations and model
         * calls nest inside it, exactly as a root activation's do.
         */
        val tracer = ctx.tracer
        val spanParent = tracer?.spanForNode(stepId)
        val childSpan = tracer?.open(
            kind = "activation", name = agent.name,
            parentSpanId = spanParent ?: tracer.tickSpanId,
            activationId = activation.id,
        )
        if (childSpan != null) tracer.bindNode(stepId, childSpan)

        val outcome = try {
            runChild(
                ChildCall(
                    childActivationId = activation.id,
                    agentId = targetAgentId,
                    agentName = agent.name,
                    instructions = agent.instructions,
                    modelName = agent.modelName,
                    llmConnectionId = agent.llmConnectionId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                    allowedToolIds = agent.allowedToolIds,
                    /* The team's grant for THIS member, or the agent row when no
                       team owns the call. See [rosterFor]. */
                    canDelegateTo = rosterFor?.invoke(targetAgentId) ?: agent.canDelegateTo,
                    contract = contract,
                    depth = parentDepth + 1,
                    budget = granted,
                ),
                ctx,
            )
        } finally {
            /* Back to running whatever happened. A parent left `waiting_for_child`
               after its child returned is a run the debugger draws as blocked
               forever. */
            activations.park(parentActivationId, ActivationStore.Status.RUNNING)
            runCatching {
                tracer?.close(childSpan, "activation", agent.name, "ok", stepId = stepId)
                tracer?.bindNode(stepId, spanParent)
            }
        }

        // ── 7. Record the child's outcome, and settle its budget ──────────────
        recordChildOutcome(activation.id, outcome)
        ledger?.settle(activation.id)

        // ── 8. THE CALLER validates the contract's schema ─────────────────────
        if (outcome is ChildOutcome.Completed) {
            val check = OutputSchemaCheck.validate(outcome.output, contract.outputSchema)
            if (!check.valid) {
                /*
                 * §5.2 rule 1: outputSchema is validated by the CALLER'S harness.
                 * A child that returns a shape its parent cannot use fails here,
                 * with the mismatch named — rather than the parent accepting it and
                 * reading nulls out of it three steps later, somewhere that has no
                 * idea a delegation happened.
                 */
                return refuse("SCHEMA_INVALID",
                    "Agent '${agent.name}' returned a result that does not match the " +
                    "contract's output schema: ${check.describe(outcome.output.keys)}")
            }
        }

        return Result.success(outcome)
    }

    // ── Guards, §9 ───────────────────────────────────────────────────────────

    /**
     * The seven guards, cheapest first. Returns the refusal, or null to proceed.
     *
     * Every one is checked BEFORE an activation is created. A guard that fires
     * after creation has already paid for the thing it was meant to prevent.
     */
    private fun guard(
        ctx: RuntimeContext,
        parentActivationId: UUID,
        parentDepth: Int,
        targetAgentId: UUID,
        contract: TaskContract,
        agent: AgentRow,
        kind: HandoffStore.Kind,
    ): Refusal? {
        // 1. Depth. Free — the parent's depth is already in hand.
        if (kind != HandoffStore.Kind.TRANSFER && parentDepth + 1 > limits.maxDepth) {
            return Refusal("MAX_DEPTH_EXCEEDED",
                "Delegating to '${agent.name}' would make this chain ${parentDepth + 1} agents " +
                "deep, past the limit of ${limits.maxDepth}. Flatten the delegation, or raise " +
                "the team's depth limit.")
        }

        // 2. Wall clock. Also free.
        val elapsed = System.currentTimeMillis() - teamStartedAtMs
        if (limits.maxDurationMs > 0 && elapsed >= limits.maxDurationMs) {
            return Refusal("BUDGET_EXCEEDED",
                "The team reached its ${limits.maxDurationMs}ms time limit before delegating " +
                "to '${agent.name}'.")
        }

        // 3. Total activations. One count.
        val existing = activations.countInRun(ctx.runId)
        if (existing >= limits.maxActivations) {
            return Refusal("TEAM_BUDGET_EXCEEDED",
                "This run has already created $existing agent activations, its limit. " +
                "Delegating to '${agent.name}' would exceed it.")
        }

        // 4. Repeated handoff, on (from AGENT, to AGENT, contract-hash).
        val hash = contract.hash()
        val callerAgentId = activations.byId(parentActivationId)?.agentId
        val sources = callerAgentId
            ?.let { handoffs.activationsOfAgent(ctx.runId, it) }
            ?: listOf(parentActivationId)
        val targets = handoffs.activationsOfAgent(ctx.runId, targetAgentId)
        val repeats = handoffs.countRepeats(ctx.runId, sources, targets, hash)
        if (repeats >= limits.maxHandoffsPerPair) {
            /* The direct analogue of the repeated-tool-failure stop: this exact
               request has already gone down this exact edge and come back the
               same, and spending the rest of the budget reproving it helps nobody. */
            return Refusal("HANDOFF_LOOP",
                "The same request has already been delegated to '${agent.name}' $repeats " +
                "time(s) along this path without the answer changing, so it was stopped " +
                "rather than repeated. Objective: ${contract.objective.take(150)}")
        }

        // 5. Subtree budget.
        ledger?.remaining(parentActivationId)?.let { snap ->
            if (snap.availableToChildren.isExhausted) {
                return Refusal("TEAM_BUDGET_EXCEEDED",
                    "The agents on this step have used the budget allowed for the group, so " +
                    "'${agent.name}' could not be given anything to work with.")
            }
        }

        /*
         * 6. Join progress — JOIN_DEADLOCK.
         *
         * NOT CHECKED, because it cannot fire. A deadlock needs a fan-out to
         * deadlock on and BROADCAST is P10; with a single inline child there is
         * always exactly one runnable activation. Named here so the absence is a
         * decision on the record rather than a guard someone assumes is running.
         */

        return null
    }

    // ── The gate ─────────────────────────────────────────────────────────────

    private sealed class Gate {
        object Granted : Gate()
        data class Rejected(val by: String?) : Gate()
        data class Pending(val approvalId: String, val message: String) : Gate()
    }

    /**
     * Find or open the delegation gate.
     *
     * Byte-for-byte the shape [ToolNodeExecutor.approvalGate] uses: look up by
     * `(runId, nodeId)` first, create only when nothing is there, and read the
     * status through the one shared [decideOnApproval] — including its rule that
     * anything unrecognised means WAIT and never opens a second gate. Re-execution
     * after a decision must FIND the decision; a key that moved between attempts
     * is how approving a run produces another pending approval and the run never
     * moves.
     */
    private fun resolveGate(
        ctx: RuntimeContext,
        approvalNodeId: String,
        agent: AgentRow,
        contract: TaskContract,
    ): Gate {
        val existing = runCatching { approvalStore.findApproval(ctx.runId, approvalNodeId) }
            .getOrElse { e ->
                log.error("[delegate] approval lookup failed [nodeId={}]: {}", approvalNodeId, e.message)
                /* Fail closed. A delegation that needs approval must not run
                   because the lookup broke — that is exactly when running it is
                   worst. */
                return Gate.Rejected(null)
            }

        if (existing != null) {
            return when (decideOnApproval(existing.status)) {
                ApprovalDecision.GRANT -> Gate.Granted
                ApprovalDecision.REJECT -> Gate.Rejected(existing.resolvedBy)
                ApprovalDecision.WAIT -> Gate.Pending(
                    existing.id.toString(),
                    existing.message ?: "Waiting for approval to delegate to '${agent.name}'")
            }
        }

        val message = "Delegating to agent '${agent.name}' requires approval. " +
            "Task: ${contract.objective.take(300)}"
        return Gate.Pending(
            approvalStore.createPendingApproval(
                runId = ctx.runId, workspaceId = ctx.workspaceId, environmentId = ctx.environmentId,
                nodeId = approvalNodeId, message = message, approvers = emptyList(),
                resolvedInputs = contract.inputs.filterValues { it != null }.mapValues { it.value!! },
                gate = ApprovalGateConfig(
                    title = "Delegation approval: ${agent.name}",
                    riskLevel = "medium",
                ),
            ),
            message,
        )
    }

    // ── Outcome bookkeeping ──────────────────────────────────────────────────

    private fun recordChildOutcome(activationId: UUID, outcome: ChildOutcome) {
        when (outcome) {
            is ChildOutcome.Completed -> activations.complete(
                activationId, ActivationStore.Status.SUCCEEDED, outcome.output,
                "FINAL_OUTPUT", null,
                mapOf("tokens" to outcome.tokensUsed, "costCents" to outcome.costCents))

            /* Parked, not ended. A resumed run must find it non-terminal to
               reattach and continue, not replay a recorded outcome it never had. */
            is ChildOutcome.Paused ->
                activations.park(activationId, ActivationStore.Status.WAITING_FOR_APPROVAL)

            is ChildOutcome.Failed -> activations.complete(
                activationId, ActivationStore.Status.FAILED, null,
                outcome.stopReason, null, emptyMap())
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun replayTerminal(activation: ActivationStore.Activation, agentName: String): ChildOutcome {
        if (activation.status == ActivationStore.Status.SUCCEEDED.wire) {
            val output = runCatching {
                activation.outputJson?.let { mapper.readValue(it, Map::class.java) as Map<String, Any> }
            }.getOrNull() ?: emptyMap()
            return ChildOutcome.Completed(output, tokensUsed = 0, costCents = 0.0)
        }
        return ChildOutcome.Failed(
            "Agent '$agentName' already ran on this delegation and did not succeed " +
            "(status=${activation.status}, stopReason=${activation.stopReason ?: "unrecorded"}).",
            activation.stopReason ?: "ERROR")
    }

    /**
     * Mark a created-but-never-run child as cancelled.
     *
     * CANCELLED, not FAILED. A `wait_any` sibling that lost the race was never
     * asked to finish; grading it failed makes a working race look like four
     * broken agents and one good one, and puts four spurious failures into every
     * aggregate that counts activation outcomes.
     */
    fun cancel(activationId: UUID, why: String) {
        activations.complete(
            activationId, ActivationStore.Status.CANCELLED, null,
            stopReason = null, failureClass = null, budgetConsumed = emptyMap())
        ledger?.settle(activationId)
        log.info("[delegate] cancelled activation {} — {}", activationId, why)
    }

    /**
     * Create a fan-out child and immediately cancel it.
     *
     * ── WHY CREATE IT AT ALL ────────────────────────────────────────────────
     * The alternative is to skip it, and then a `wait_any` of five shows ONE
     * activation in the trace. The most interesting fact about that run — that
     * the supervisor asked five agents and needed one — would be invisible, and
     * the fan-out would look like a plain delegation.
     *
     * It also makes the resume honest: the row exists, so a resumed tick
     * reattaches to a CANCELLED terminal activation and replays that, rather than
     * fanning out again to agents whose answers are no longer wanted.
     */
    suspend fun createAndCancel(
        ctx: RuntimeContext,
        stepId: String,
        parentActivationId: UUID,
        parentDepth: Int,
        rootActivationId: UUID,
        targetAgentId: UUID,
        contract: TaskContract,
        joinGroupId: UUID,
        why: String,
    ) {
        val agent = runCatching { loadAgent(targetAgentId, ctx.workspaceId) }.getOrNull() ?: return
        val activation = activations.createOrReattachChild(
            runId = ctx.runId, workspaceId = ctx.workspaceId, environmentId = ctx.environmentId,
            stepId = stepId, agentId = targetAgentId,
            parentActivationId = parentActivationId, rootActivationId = rootActivationId,
            depth = parentDepth + 1,
            contract = contract.toMap(),
            agentSnapshot = mapOf("modelName" to agent.modelName),
            agentVersion = null,
            budgetAllocated = emptyMap(),
        ) ?: return

        /* Already terminal from an earlier tick — leave it alone. Overwriting a
           succeeded sibling with `cancelled` on a resume would lose its output. */
        if (activation.reattached && activation.terminal) return

        handoffs.record(
            runId = ctx.runId, workspaceId = ctx.workspaceId,
            fromActivationId = parentActivationId, toActivationId = activation.id,
            kind = HandoffStore.Kind.BROADCAST, reason = why, contract = contract,
            contractHash = contract.hash(), contextVersion = 0L, joinGroupId = joinGroupId,
        )
        cancel(activation.id, why)
    }

    private fun refuse(stopReason: String, reason: String): Result<ChildOutcome> =
        Result.failure(RefusedException(Refusal(stopReason, reason)))

    // ── The agent row ────────────────────────────────────────────────────────

    data class AgentRow(
        val id: UUID,
        val name: String,
        val instructions: String?,
        val llmConnectionId: String?,
        val modelName: String?,
        val maxIterations: Int,
        val allowedToolIds: Set<UUID>,
        val canDelegateTo: Set<UUID>,
        val requiresApproval: Boolean,
    )

    /**
     * Workspace-scoped, like every other runtime lookup. Cross-workspace
     * delegation is impossible because the WHERE clause makes it impossible, not
     * because a caller remembered to check.
     *
     * Throws rather than returning null on a query fault, so [delegate] can tell
     * "this agent does not exist" from "the check did not run" — the two must not
     * produce the same outcome.
     */
    private fun loadAgent(agentId: UUID, workspaceId: UUID): AgentRow? =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT id, name, instructions, llm_connection_id, model_name, max_iterations,
                          COALESCE(to_jsonb(allowed_tool_ids), '[]'::jsonb) AS tool_ids,
                          COALESCE(to_jsonb(can_delegate_to),  '[]'::jsonb) AS roster,
                          COALESCE(requires_approval, false)                AS requires_approval
                     FROM agents
                    WHERE id = ? AND workspace_id = ? AND status = 'active'"""
            ).use { st ->
                st.setObject(1, agentId); st.setObject(2, workspaceId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) null else AgentRow(
                        id = rs.getObject("id", UUID::class.java),
                        name = rs.getString("name"),
                        instructions = rs.getString("instructions"),
                        llmConnectionId = rs.getString("llm_connection_id"),
                        modelName = rs.getString("model_name"),
                        maxIterations = rs.getObject("max_iterations")?.let { (it as? Number)?.toInt() } ?: 5,
                        allowedToolIds = uuidSet(rs.getString("tool_ids")),
                        canDelegateTo = uuidSet(rs.getString("roster")),
                        requiresApproval = rs.getBoolean("requires_approval"),
                    )
                }
            }
        }

    private fun uuidSet(json: String?): Set<UUID> = runCatching {
        @Suppress("UNCHECKED_CAST")
        (mapper.readValue(json ?: "[]", List::class.java) as List<String>)
            .mapNotNull { runCatching { UUID.fromString(it) }.getOrNull() }.toSet()
    }.getOrDefault(emptySet())

    private fun emitEvent(
        ctx: RuntimeContext, stepId: String, type: EventType,
        status: String, title: String, summary: String?,
    ) = runCatching {
        eventStore.appendEvent(RunEvent(
            runId = ctx.runId, workspaceId = ctx.workspaceId, environmentId = ctx.environmentId,
            type = type, status = status, stepId = stepId, title = title, summary = summary,
        ))
    }
}
