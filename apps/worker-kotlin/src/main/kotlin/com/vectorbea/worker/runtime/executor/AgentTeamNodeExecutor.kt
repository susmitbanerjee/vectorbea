package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import com.vectorbea.worker.agents.brain.model.AgentLoopState
import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner
import com.vectorbea.worker.agents.budget.BudgetLedger
import com.vectorbea.worker.agents.budget.BudgetVector
import com.vectorbea.worker.agents.orchestration.ActivationStore
import com.vectorbea.worker.agents.orchestration.HandoffStore
import com.vectorbea.worker.agents.orchestration.OrchestrationLoop
import com.vectorbea.worker.agents.orchestration.TaskContract
import com.vectorbea.worker.agents.orchestration.TeamConfig
import com.vectorbea.worker.agents.orchestration.TeamPolicy
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.budget.RunCeilings
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowNode
import java.util.UUID
import javax.sql.DataSource

/**
 * Executes an `agent_team` node.
 *
 * ── A NEW NODE TYPE, AND NOTHING MIGRATES ───────────────────────────────────
 * `agent` nodes are untouched: a graph that has never had a team behaves exactly
 * as it did, and this executor shares every primitive with [AgentNodeExecutor]
 * rather than sharing a node type and branching inside it. The two are siblings
 * over the same `AgentHarness`, `AgentCallExecutor` and `BudgetLedger`.
 *
 * ── WHAT THIS CLASS ACTUALLY DOES ───────────────────────────────────────────
 * Parse the config, create the entry activation, hand it to
 * [OrchestrationLoop], map the outcome back onto [NodeResult]. The scheduling,
 * such as it is, belongs to `WorkflowRuntime` exactly as it did before: this
 * runs inside one node execution, on its thread, under its per-tick execution
 * budget, and returns upward when it is done. Nothing here holds a worker.
 */
class AgentTeamNodeExecutor(
    private val dataSource: DataSource,
    private val connectionResolver: ConnectionResolver,
    private val eventStore: RunEventStore,
    private val dbPoolManager: com.vectorbea.worker.connector.pool.ClientDbPoolManager? = null,
    /**
     * Mirrors AGENT_TEAMS_ENABLED. A parameter for the same reason every other
     * flag in this package is one: a test drives both settings in one JVM.
     */
    private val teamsEnabled: Boolean = TEAMS_ENABLED,
    private val llmHttpClient: java.net.http.HttpClient? = null,
    /**
     * Shared provider token bucket. §12.4.
     *
     * This class had no capacity parameter at all, so the entire multi-agent path
     * called providers unmetered even with the bucket enabled — and a team node is
     * the largest fan-out in the product, which is exactly what the bucket exists
     * for. Every member's brain gets it below.
     */
    private val capacity: com.vectorbea.worker.net.ProviderCapacityBucket? = null,
) : NodeExecutor {

    private val log = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        /**
         * Teams. Default OFF.
         *
         * Off, an `agent_team` node fails with a sentence saying so rather than
         * being reported as an unsupported node type — "this worker does not
         * support agent_team" reads as a bug, and "teams are switched off here"
         * reads as the configuration it is.
         */
        val TEAMS_ENABLED: Boolean =
            System.getenv("AGENT_TEAMS_ENABLED")?.lowercase() == "true"
    }

    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        ctx: RuntimeContext,
    ): NodeResult {
        if (!teamsEnabled) return NodeResult.Failed(
            "Agent teams are switched off on this worker, so node '${node.id}' did not run.",
            retryable = false)

        val team = when (val parsed = TeamConfig.parse(node.config)) {
            is TeamConfig.Parsed.Invalid -> return NodeResult.Failed(
                "Agent team node '${node.id}' is not configured correctly: ${parsed.reason}",
                retryable = false)
            is TeamConfig.Parsed.Valid -> parsed.config
        }

        val taskInstruction = node.config["taskInstruction"] as? String
            ?: resolvedInputs["taskInstruction"] as? String
            ?: resolvedInputs["task"] as? String
            ?: resolvedInputs["prompt"] as? String
            ?: resolvedInputs["input"] as? String

        val activations = ActivationStore(dataSource)
        val ledger = BudgetLedger(RunCeilings.forWorkspace(dataSource, ctx.workspaceId))
        val policy = TeamPolicy.of(team)

        /*
         * The entry activation, created BEFORE the loop runs, so the ledger's root
         * and the activation tree's root are the same id. A loop that created its
         * own root would leave the budget attached to something the trace does not
         * show.
         *
         * `createOrReattach` is the ROOT path — natural-key lookup — so a resumed
         * tick reattaches to the entry activation it already made rather than
         * starting a second team.
         */
        val entry = activations.createOrReattach(
            runId = ctx.runId, workspaceId = ctx.workspaceId, environmentId = ctx.environmentId,
            stepId = node.id, agentId = team.entry.agentId,
            resolvedTaskInstruction = taskInstruction,
            agentSnapshot = mapOf("policy" to team.policy.wire),
            agentVersion = null,
            budgetAllocated = team.budget.toMap(),
        ) ?: return NodeResult.Failed(
            "The team's entry activation could not be created, so node '${node.id}' did not run.",
            retryable = true)

        emitEvent(ctx, node.id, EventType.AGENT_STARTED, "running",
            "Team started: ${team.policy.wire}",
            "${team.roster.size} member(s), join=${team.joinPolicy.wire}")

        /*
         * ONE ledger for this node execution, closed over by both seams. The budget
         * TREE is a tree only because every member shares this instance — a
         * per-member ledger would give each agent its own root and bound nothing,
         * which is the flat-budget arithmetic §8 opens by refuting.
         *
         * A local, never a field: two team nodes can execute concurrently on one
         * worker, and a field would silently merge their budgets.
         */
        val loop = OrchestrationLoop(
            activations = activations,
            ledger = ledger,
            runMember = { call, c -> runMember(team, policy, ledger, call, c, node) },
            transfer = { call, c -> transferTo(team, policy, ledger, call, c, node) },
        )

        val outcome = try {
            loop.run(team, ctx, entry.id, taskInstruction, resolvedInputs)
        } catch (e: Exception) {
            log.error("[team] node {} failed: {}", node.id, e.message)
            return NodeResult.Failed(
                "The agent team on node '${node.id}' stopped with an error: ${e.message?.take(300)}")
        }

        return when (outcome) {
            is OrchestrationLoop.TeamOutcome.Completed -> {
                emitEvent(ctx, node.id, EventType.AGENT_COMPLETED, "succeeded",
                    "Team finished: ${team.policy.wire}", null)
                NodeResult.Completed(output = outcome.output + mapOf("_teamPolicy" to team.policy.wire))
            }

            is OrchestrationLoop.TeamOutcome.Partial -> {
                /* A partial answer with a stated shortfall, not a failure. §8. */
                emitEvent(ctx, node.id, EventType.AGENT_COMPLETED, "warning",
                    "Team finished with a partial answer", outcome.shortfall.take(300))
                NodeResult.Completed(output = outcome.output + mapOf("_teamPolicy" to team.policy.wire))
            }

            is OrchestrationLoop.TeamOutcome.Yielded -> {
                /*
                 * ── STAND DOWN, USING THE MECHANISM THAT ALREADY EXISTS ──────
                 *
                 * `Throttled` is the runtime's existing "nothing is wrong, give the
                 * permit back, re-execute this node" signal: RunProcessor parks the
                 * run at status `yielded` — its own comment says "the same state a
                 * cooperative yield uses" — and the step is NOT marked complete, so
                 * the node runs again.
                 *
                 * That is exactly a tick yield, so it is reused rather than a new
                 * NodeResult variant being added. A new variant would change what
                 * happens on resume for every node type, which is a state-machine
                 * change this phase has no reason to make. `retryAfterMs = 0`
                 * because there is nothing to wait for — unlike a real throttle,
                 * the resource that ran out was our own tick.
                 */
                emitEvent(ctx, node.id, EventType.RUN_YIELDED, "yielded",
                    "Team yielded after a bounded execution tick", outcome.reason.take(300))
                NodeResult.Throttled(
                    provider = "agent_team",
                    retryAfterMs = 0,
                    message = outcome.reason,
                )
            }

            is OrchestrationLoop.TeamOutcome.Paused -> NodeResult.ApprovalPaused(
                approvalId = outcome.approvalId,
                message = outcome.message,
                metadata = mapOf("teamPolicy" to team.policy.wire),
            )

            is OrchestrationLoop.TeamOutcome.Failed -> {
                emitEvent(ctx, node.id, EventType.AGENT_FAILED, "failed",
                    "Team failed: ${outcome.stopReason}", outcome.reason.take(300))
                NodeResult.Failed(
                    "Agent team '${node.id}' failed: ${outcome.reason} " +
                    "(stopReason=${outcome.stopReason})",
                    retryable = outcome.retryable)
            }
        }
    }

    // ── The two seams the loop drives ────────────────────────────────────────

    /**
     * Run one member, through the same brain a lone agent uses.
     *
     * The member's OWN roster comes from the team config, not from the agent row:
     * §6's `canDelegateTo` is per-member, so the same agent can be a supervisor in
     * one team and a leaf in another without either team editing the agent.
     */
    private suspend fun runMember(
        team: TeamConfig,
        policy: TeamPolicy,
        ledger: BudgetLedger,
        call: OrchestrationLoop.MemberCall,
        ctx: RuntimeContext,
        node: WorkflowNode,
    ): OrchestrationLoop.MemberOutcome {
        val agent = loadAgent(call.member.agentId, ctx.workspaceId)
            ?: return OrchestrationLoop.MemberOutcome.Failed(
                "Agent ${call.member.agentId} is not available in this workspace.", "ERROR")

        val connectionId = agent.llmConnectionId
            ?: return OrchestrationLoop.MemberOutcome.Failed(
                "Agent '${agent.name}' has no LLM connection configured.", "ERROR")

        val config = AgentBrainConfig(
            agentId = call.member.agentId,
            workspaceId = ctx.workspaceId,
            environmentId = ctx.environmentId,
            runId = ctx.runId,
            stepId = node.id,
            agentName = agent.name,
            role = call.member.role,
            instructions = agent.instructions ?: "Complete the task.",
            llmConnectionId = connectionId,
            modelName = agent.modelName ?: "gpt-4o-mini",
            maxIterations = agent.maxIterations,
            maxToolCalls = agent.maxToolCalls,
            maxCostCents = Math.ceil(call.budget.costCents).toInt().coerceAtLeast(1),
            maxTotalTokens = call.budget.tokens.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
                .coerceAtLeast(1),
            allowedToolIds = agent.allowedToolIds,
            /* PER-MEMBER, from the team. Not the agent row's global roster. */
            canDelegateTo = call.member.canDelegateTo,
            activationId = call.activationId,
            depth = call.depth,
            taskInstruction = call.taskInstruction,
            resolvedInput = call.inputs,
        )

        val result = brainFor(policy, team, ledger).run(config, ctx)

        return when {
            result.stopReason == AgentLoopState.StopReason.APPROVAL_REQUESTED &&
                result.approvalId != null ->
                OrchestrationLoop.MemberOutcome.Paused(
                    result.approvalId,
                    result.approvalMessage ?: "Agent '${agent.name}' is waiting for approval.")

            result.yieldedReason != null ->
                OrchestrationLoop.MemberOutcome.Yielded(result.yieldedReason)

            result.stopReason == AgentLoopState.StopReason.FINAL_OUTPUT ->
                OrchestrationLoop.MemberOutcome.Completed(
                    result.finalOutput.filterValues { it != null }.mapValues { it.value!! },
                    handedOff = result.handedOff,
                )

            else -> OrchestrationLoop.MemberOutcome.Failed(
                result.failureReason ?: "Agent '${agent.name}' stopped with ${result.stopReason}.",
                result.stopReason.name,
            )
        }
    }

    /** One pipeline stage handing off to the next. The loop's only other verb. */
    private suspend fun transferTo(
        team: TeamConfig,
        policy: TeamPolicy,
        ledger: BudgetLedger,
        call: OrchestrationLoop.TransferCall,
        ctx: RuntimeContext,
        node: WorkflowNode,
    ): OrchestrationLoop.MemberOutcome {
        val caller = brainFor(policy, team, ledger).callExecutor()
            ?: return OrchestrationLoop.MemberOutcome.Failed(
                "Delegation is not available on this worker, so the pipeline could not advance.",
                "ERROR")

        val result = caller.delegate(
            ctx = ctx,
            stepId = node.id,
            approvalNodeId = AgentBrainRunner.agentApprovalNodeId(node.id, call.to.agentId),
            parentActivationId = call.fromActivationId,
            parentDepth = call.depth,
            rootActivationId = call.rootActivationId,
            targetAgentId = call.to.agentId,
            contract = call.contract,
            reason = "pipeline stage ${call.to.alias ?: call.to.agentId}",
            kind = HandoffStore.Kind.TRANSFER,
            contextVersion = 0L,
        )

        (result.exceptionOrNull() as? AgentCallExecutor.RefusedException)?.let {
            return OrchestrationLoop.MemberOutcome.Failed(it.refusal.reason, it.refusal.stopReason)
        }
        result.exceptionOrNull()?.let {
            return OrchestrationLoop.MemberOutcome.Failed(
                it.message?.take(300) ?: "the stage could not be started", "ERROR")
        }

        return when (val o = result.getOrThrow()) {
            is AgentCallExecutor.ChildOutcome.Paused ->
                OrchestrationLoop.MemberOutcome.Paused(o.approvalId, o.message)
            is AgentCallExecutor.ChildOutcome.Failed ->
                OrchestrationLoop.MemberOutcome.Failed(o.reason, o.stopReason)
            is AgentCallExecutor.ChildOutcome.Completed ->
                OrchestrationLoop.MemberOutcome.Completed(o.output, handedOff = true)
        }
    }

    /**
     * A brain configured for this team.
     *
     * Built per call rather than cached because a brain carries no state between
     * runs and caching one would make the ledger it holds outlive the tick that
     * owns it.
     */
    private fun brainFor(policy: TeamPolicy, team: TeamConfig, ledger: BudgetLedger) = AgentBrainRunner(
        dataSource = dataSource,
        eventStore = eventStore,
        connectionResolver = connectionResolver,
        dbPoolManager = dbPoolManager,
        approvalStore = com.vectorbea.worker.runtime.checkpoint.ApprovalStore(dataSource),
        llmHttpClient = llmHttpClient,
        budgetLedger = ledger,
        teamLimits = team.limits,
        teamPolicy = policy,
        /* A team IS delegation. The team flag being on is the decision; making an
           operator set two flags to run one node is a footgun with no upside. */
        delegationEnabled = true,
        capacity = capacity,
    )

    // ── The agent row ────────────────────────────────────────────────────────

    private data class AgentRow(
        val name: String,
        val instructions: String?,
        val llmConnectionId: UUID?,
        val modelName: String?,
        val maxIterations: Int,
        val maxToolCalls: Int,
        val allowedToolIds: Set<UUID>,
    )

    private fun loadAgent(agentId: UUID, workspaceId: UUID): AgentRow? = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT name, instructions, llm_connection_id, model_name,
                          max_iterations, COALESCE(max_tool_calls, 5) AS max_tool_calls,
                          COALESCE(to_jsonb(allowed_tool_ids), '[]'::jsonb) AS tool_ids
                     FROM agents
                    WHERE id = ? AND workspace_id = ? AND status = 'active'"""
            ).use { st ->
                st.setObject(1, agentId); st.setObject(2, workspaceId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) null else AgentRow(
                        name = rs.getString("name"),
                        instructions = rs.getString("instructions"),
                        llmConnectionId = rs.getString("llm_connection_id")
                            ?.let { runCatching { UUID.fromString(it) }.getOrNull() },
                        modelName = rs.getString("model_name"),
                        maxIterations = rs.getObject("max_iterations")
                            ?.let { (it as? Number)?.toInt() } ?: 5,
                        maxToolCalls = rs.getInt("max_tool_calls"),
                        allowedToolIds = runCatching {
                            @Suppress("UNCHECKED_CAST")
                            (mapper.readValue(rs.getString("tool_ids") ?: "[]", List::class.java)
                                as List<String>)
                                .mapNotNull { s -> runCatching { UUID.fromString(s) }.getOrNull() }
                                .toSet()
                        }.getOrDefault(emptySet()),
                    )
                }
            }
        }
    }.getOrNull()

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
