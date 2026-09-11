package com.vectorbea.worker.agents.brain.runtime

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.agents.brain.model.*
import com.vectorbea.worker.agents.budget.BudgetLedger
import com.vectorbea.worker.agents.budget.BudgetVector
import com.vectorbea.worker.agents.context.RunContextStore
import com.vectorbea.worker.agents.orchestration.ActivationStore
import com.vectorbea.worker.agents.orchestration.ContextRef
import com.vectorbea.worker.agents.orchestration.HandoffStore
import com.vectorbea.worker.agents.orchestration.JoinEvaluator
import com.vectorbea.worker.agents.orchestration.JoinPolicy
import com.vectorbea.worker.agents.orchestration.OnChildFailure
import com.vectorbea.worker.agents.orchestration.TeamPolicy
import com.vectorbea.worker.agents.orchestration.OutputSchemaCheck
import com.vectorbea.worker.agents.orchestration.TaskContract
import com.vectorbea.worker.agents.orchestration.TeamLimits
import com.vectorbea.worker.runtime.executor.AgentCallExecutor
import com.vectorbea.worker.agents.brain.prompts.AgentPromptBuilder
import com.vectorbea.worker.connector.ConnectionResolver
import kotlinx.coroutines.delay
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.durable.StepExecutionGuard
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.StepOutputStore
import com.vectorbea.worker.runtime.executor.LlmNodeExecutor
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.executor.ToolNodeExecutor
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowNode
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Iterative Agent Brain Runner.
 *
 * Implements the PLAN → ACT → OBSERVE → REFLECT → DECIDE loop.
 *
 * Safety guarantees (enforced by the runtime, not the LLM):
 *   - Budget hard limits: iterations, tool calls, tokens, cost, timeout
 *   - Only tools in config.allowedToolIds may be called
 *   - Sanitized summaries only — no raw chain-of-thought persisted
 *   - No secrets accessible through agent memory
 *   - Schema validation on final output
 */
class AgentBrainRunner(
    private val dataSource: DataSource?,
    private val eventStore: RunEventStore,
    private val connectionResolver: ConnectionResolver,
    /**
     * Pool manager for TENANT databases, needed because an agent may call a
     * database tool. Null only in tests that exercise no such tool; a null here
     * means database tools report "not available" rather than being silently
     * mis-executed as HTTP.
     */
    private val dbPoolManager: ClientDbPoolManager? = null,
    /**
     * Where ASK_APPROVAL becomes a real pending approval instead of a dead end.
     *
     * Null only where there is no database to write one to, in which case an agent
     * asking for approval fails with a message saying so — which is honest, and is
     * still better than the silent failure this replaced.
     */
    private val approvalStore: com.vectorbea.worker.runtime.checkpoint.ApprovalStore? = null,
    /**
     * Where a WAIT action becomes a real parked wait instead of a dead end.
     *
     * Null only where there is no database to write one to, in which case an
     * agent choosing to wait fails with a message saying so — the same honest
     * failure [approvalStore] gives, and for the same reason: an action that
     * silently does nothing is worse than one that reports it cannot.
     */
    private val waitStore: com.vectorbea.worker.durable.wait.WaitStore? = null,
    /** Read when a WAIT's signal may already have arrived. See [openAgentWait]. */
    private val signalStore: com.vectorbea.worker.durable.wait.SignalStore? = null,
    private val budgetGuard: AgentBudgetGuard = AgentBudgetGuard(),
    private val safetyGuard: AgentSafetyGuard = AgentSafetyGuard(),
    private val memoryStore: AgentMemoryStore = AgentMemoryStore(dataSource),
    /**
     * Idempotency for the loop's tool calls, keyed per (step, tool, arguments).
     *
     * Null only where there is no database to guard against, in which case tool
     * calls execute unguarded — which is the behaviour that existed before this
     * was wired, and is still correct for a runner with no persistence.
     *
     * Injectable so the regression test can exercise the skip path without a
     * database; production leaves it null and gets one built from [dataSource].
     */
    stepGuard: StepExecutionGuard? = null,
    /** Where a guarded tool call's result is stored and replayed from. See [stepGuard]. */
    stepOutputStore: StepOutputStore? = null,
    /**
     * HTTP client for the loop's own LLM calls. Null in production, where
     * [LlmNodeExecutor] uses the shared bounded client from `OutboundHttp`.
     *
     * Exists so a test can drive the loop against a scripted provider without a
     * network. It is the narrowest seam available: [LlmNodeExecutor] already accepts
     * an injectable client for exactly this reason, and the brain was the only
     * caller with no way to pass one through.
     */
    private val llmHttpClient: java.net.http.HttpClient? = null,
    /**
     * Where full tool results and observation payloads are stored, so the loop can
     * be rebuilt from them and the debugger can show what a tool actually returned.
     *
     * Null disables capture: refs stay null, reconstruction refuses on the missing
     * action, and the loop behaves exactly as it did before V040.
     */
    private val payloadStore: com.vectorbea.worker.events.PayloadStore? = null,
    /**
     * Whether a resumed step may rebuild its loop. Defaults to the env flag; a
     * parameter so a test can exercise both paths without mutating process
     * environment, which JUnit cannot do portably and which would leak between
     * tests sharing a JVM.
     */
    private val reconstructionEnabled: Boolean = RECONSTRUCTION_ENABLED,
    /**
     * The subtree's budget, when this run has one. Null for a single agent, which
     * has no tree to bound.
     */
    private val budgetLedger: BudgetLedger? = null,
    /** The team's §9 bounds. Defaults are the platform's; a node may tighten them. */
    private val teamLimits: TeamLimits = TeamLimits(),
    /**
     * The team this agent belongs to, when it belongs to one.
     *
     * Null for a lone agent using P9 delegation. Non-null supplies the join
     * policy, the child-failure setting and the permitted handoff kinds — all
     * three of which are §6 CONFIGURATION over the same primitives, not
     * alternative code paths.
     */
    private val teamPolicy: TeamPolicy? = null,
    /**
     * Mirrors AGENT_DELEGATION_ENABLED. A parameter for the same reason every
     * other flag here is one: a test has to drive both paths in one JVM.
     */
    private val delegationEnabled: Boolean = DELEGATION_ENABLED,
    /**
     * Shared provider token bucket. §12.4.
     *
     * This is the call site that matters. One agent step is `maxIterations`
     * provider calls, and a five-agent team multiplies that again — the plain
     * `llm` node is a rounding error beside it.
     */
    private val capacity: com.vectorbea.worker.net.ProviderCapacityBucket? = null,
    /**
     * Assemble the prompt under a budget instead of concatenating it.
     *
     * Mirrors AGENT_CONTEXT_ASSEMBLY_ENABLED without reading process env, which
     * is what lets a test drive both states — the same seam `reconstructionEnabled`
     * and `delegationEnabled` use, for the same reason.
     */
    private val contextAssemblyEnabled: Boolean =
        AgentPromptBuilder.CONTEXT_ASSEMBLY_ENABLED,
    /**
     * The agent's granted skills, loaded per activation.
     *
     * Injected rather than constructed inline for the reason every other
     * collaborator here is: a test drives both the flag-on and flag-off paths in
     * one JVM, and JUnit cannot portably mutate process environment.
     *
     * The default reads AGENT_SKILLS_ENABLED and is OFF, so the loop is
     * byte-for-byte what it was until somebody turns it on.
     */
    private val skillLoader: com.vectorbea.worker.agents.skills.SkillLoader =
        com.vectorbea.worker.agents.skills.SkillLoader(dataSource),
    /** Where the composition is written for the Debug tab. See the class note there. */
    private val skillRecorder: com.vectorbea.worker.agents.skills.ActivationSkillRecorder =
        com.vectorbea.worker.agents.skills.ActivationSkillRecorder(dataSource),
) {
    private val log = logger()
    private val mapper = jacksonObjectMapper()

    internal companion object {
        /**
         * How much of a tool result is handed back to the model, per observation.
         *
         * Every observation shown in the prompt carries one of these, so the ceiling on
         * added context is this times the ten observations the prompt keeps — a few
         * thousand tokens at worst, against a token budget the guard already enforces.
         * Large enough for the row sets and API responses these tools actually return;
         * small enough that one enormous response cannot eat the whole budget.
         */
        internal const val MAX_TOOL_PAYLOAD_CHARS = 2_000

        /** The signal name free-text guidance arrives under. */
        internal const val GUIDANCE_SIGNAL = "guidance"

        /**
         * How long one piece of guidance may be.
         *
         * A sentence or two of correction, not a document. Capped because this
         * is the one part of the prompt written by a person while the run is in
         * flight, and an uncapped one is a way to spend a workspace's own token
         * budget from outside its graph.
         */
        internal const val MAX_GUIDANCE_CHARS = 2_000

        /** Matches the truncation notice `AgentSafetyGuard` appends. */
        internal const val TRUNCATION_MARKER = "… [truncated"

        /** `HTTP 403` / `status 500` inside a failure message. */
        internal val STATUS_IN_MESSAGE =
            Regex("""\b(?:HTTP|status)\s+(\d{3})\b""", RegexOption.IGNORE_CASE)

        /**
         * Rebuild a resumed agent's loop instead of replaying it.
         *
         * Default OFF. This changes what a resumed run does, which is the most
         * expensive thing in this system to get wrong, so it ships dark and is turned
         * on deliberately. Off, every path below behaves exactly as it did before.
         */
        internal val RECONSTRUCTION_ENABLED: Boolean =
            System.getenv("AGENT_LOOP_RECONSTRUCTION_ENABLED")?.lowercase() == "true"

        /**
         * Store full tool results and observation payloads.
         *
         * Default ON, and safe to turn off in production: refs stop being written,
         * reconstruction then declines and replays, and no run's outcome changes.
         */
        internal val PAYLOAD_CAPTURE_ENABLED: Boolean =
            System.getenv("TRACE_PAYLOAD_CAPTURE")?.lowercase() != "false"

        /**
         * Summarise a tool result from its RESULT CONTRACT rather than its shape.
         *
         * "Tool returned 3 field(s): items, count, nextPage" describes the
         * envelope. "Returned 47 results, showing 5" describes the answer, and it
         * is the sentence the Activity view puts in front of somebody who has
         * never heard of an iteration.
         *
         * Default OFF because this string is not only a display: it goes into the
         * observation history the next prompt is built from, and into the
         * transcript a resumed run reads back. Better prose should be an
         * improvement to how the model reasons, but "should" is not how prompt
         * changes are shipped here.
         *
         * Off, [buildToolObservationSummary] is byte-for-byte what it was.
         */
        internal val RESULT_SUMMARY_ENABLED: Boolean =
            System.getenv("AGENT_RESULT_SUMMARY_ENABLED")?.lowercase() == "true"

        /**
         * The `:tool-<n>` counter that synthetic tool node ids used to carry.
         *
         * Kept, though ids are now keyed on the tool and carry no counter, because a
         * run that started before this change can still be resumed against the old
         * ids, and normalising a suffix that is no longer there costs nothing.
         */
        private val ATTEMPT_SUFFIX = Regex(":tool-\\d+")

        /**
         * A tool failure with the attempt number taken out, so two identical failures
         * compare equal.
         *
         * The synthetic node handed to the tool executor is named
         * `<stepId>:tool-<iteration>`, and the executors put that id into their error
         * text: `DB_WRITE node 'n-new-agent-2:tool-3': ...`. So the same failure reads
         * differently every iteration purely because of the counter, and a naive
         * equality check on the summary never fires - which is exactly how the first
         * version of this stop condition failed to stop anything.
         *
         * The counter is the ONLY part normalised. Anything else that differs between
         * two attempts - a different column, a different value, a different SQLSTATE -
         * is a real difference and must keep the loop going.
         *
         * On the companion because it depends on no instance state, which also means a
         * test can exercise it without standing up a runner and its collaborators.
         */
        internal fun failureSignature(summary: String): String =
            summary.replace(ATTEMPT_SUFFIX, ":tool-N")

        /**
         * ── TWO KEYS OFF ONE TOOL CALL, AND WHY THEY DIFFER ──────────────────
         *
         * A tool call inside an agent step is keyed twice, for two different
         * questions, and the answers are genuinely different:
         *
         *   approval  `<stepId>:tool:<toolId>`               — MAY this run?
         *   guard     `<stepId>:tool:<toolId>:<argsHash>`    — HAS this already run?
         *
         * "May this run" is a question about the tool. A person approving
         * `send_email` is approving the agent's use of that tool in that step, and
         * they must be asked once. Keying it on the arguments would re-ask on every
         * call, and — because the step replays from iteration 1 on resume — the
         * arguments the model produces on the second pass need not be byte-identical
         * to the first, so the resumed run could miss the decision and open a second
         * gate forever. That is the bug [ATTEMPT_SUFFIX] documents, one level up.
         *
         * "Has this already run" is a question about the CALL. `search(a)` and
         * `search(b)` are two calls; treating them as one would hand the second the
         * first's cached output. So the arguments belong in this key and only this
         * key.
         *
         * The hash is over [canonicalJson], not over the map's `toString` or a plain
         * `writeValueAsString`, because this key must survive re-execution
         * (durability invariant #2). A resumed step rebuilds its arguments by
         * parsing the model's JSON afresh: key order can move and `1` can come back
         * as `1.0`. Either would change a naive hash, and a guard key that changes
         * between attempts silently stops deduplicating — the mechanism would look
         * present and do nothing.
         */
        internal fun toolGuardNodeId(scope: String, toolId: UUID, args: Map<String, Any?>): String =
            "$scope:tool:$toolId:${sha256Hex(canonicalJson(args)).take(32)}"

        /** The approval key: keyed on the tool, never on the arguments. See [toolGuardNodeId]. */
        internal fun toolApprovalNodeId(scope: String, toolId: UUID): String =
            "$scope:tool:$toolId"

        /**
         * ── THE SCOPE BOTH TOOL KEYS HANG OFF, AND WHY IT DEPENDS ON DEPTH ───
         *
         * ```
         * depth == 0  →  <stepId>          (unchanged: exactly what shipped)
         * depth  > 0  →  <activationId>
         * ```
         *
         * **Why the root keeps the step scope.** Nothing in flight can be at depth
         * greater than zero, because delegation did not exist before this phase. So
         * this is a strict widening at a boundary that has never been reachable, not
         * a key move: no pending approval and no guard row anywhere can change
         * meaning, and a single-agent run derives the same two keys it always has.
         *
         * **Why a child needs its own scope.** Two workers in one team calling the
         * same gated tool must open TWO gates. Sharing `<stepId>:tool:<toolId>`, the
         * second worker silently inherits the first's decision — a person approved
         * worker A's email and worker B's went out on the strength of it.
         *
         * **Why BOTH keys take the scope, together.** Scoping only the approval key
         * gives two gates and one execution: worker B's call finds worker A's guard
         * row under the shared `<stepId>:tool:<toolId>:<argsHash>`, is served from
         * that cache, and emits STEP_SKIPPED. Somebody approved something that then
         * did not happen, which is worse than the bug being fixed. The cross-agent
         * dedup this gives up is real but speculative, and belongs in a deliberate
         * caching feature rather than as an emergent property of key derivation.
         *
         * **What this rests on.** The activation-scoped key is stable only because
         * [com.vectorbea.worker.agents.orchestration.ActivationStore] reattaches
         * deterministically. If a delegation ever produced a SECOND activation row
         * for the same work, the key would move with it and the resumed run would
         * open a gate nobody can ever close. The two are asserted together, in one
         * test, for exactly that reason.
         *
         * **The convergence path**, so this does not calcify into folklore: once no
         * run predates activations, a maintenance-window migration can rewrite
         * pending `<stepId>:tool:*` rows to their activation scope and this function
         * collapses to `activationId ?: stepId`. Not now — but written down.
         */
        internal fun keyScope(config: AgentBrainConfig): String =
            if (config.depth > 0 && config.activationId != null) config.activationId.toString()
            else config.stepId

        /**
         * The delegation gate's key: `<stepId>:agent:<agentId>`.
         *
         * Disjoint from both tool keys by the `:agent:` infix. Step-scoped rather
         * than activation-scoped for the same reason the tool APPROVAL key is keyed
         * on the tool and not the arguments: a person approving "this step may use
         * the billing agent" is answering a question about the step, and they must be
         * asked once. One gate per (step, target agent) is the same bargain the tool
         * gate already makes.
         *
         * Carries no iteration number and no contract hash, so it survives
         * re-execution: the resumed step re-issues the delegation and FINDS the
         * decision instead of opening a second gate.
         */
        internal fun agentApprovalNodeId(stepId: String, agentId: UUID): String =
            "$stepId:agent:$agentId"

        /**
         * The least budget a fan-out child needs to be worth starting.
         *
         * One iteration and enough tokens for a single model call. Below this a
         * child cannot produce anything, so funding N of them is not a fan-out —
         * it is N activations that will each fail with an empty answer.
         *
         * A floor rather than a share: see the note at the preflight call site for
         * why an equal share cannot be the test.
         */
        /**
         * Per child that did not fit, before the total is divided across the
         * fan-out. 250ms is roughly one provider round trip, so a child that was
         * over the line starts about when the one before it finished asking.
         */
        internal const val FAN_OUT_STAGGER_PER_CHILD_MS = 250L

        /** A stagger longer than this outlives the tick it is spreading. */
        internal const val MAX_FAN_OUT_STAGGER_MS = 10_000L

        internal val MIN_VIABLE_CHILD = BudgetVector(
            iterations = 1,
            tokens = System.getenv("AGENT_MIN_CHILD_TOKENS")?.toLongOrNull() ?: 256L,
            costMicroCents = BudgetVector.ofCents(0.01),
        )

        /**
         * Agent-to-agent delegation. Default OFF.
         *
         * Off: the roster and the two actions are absent from the prompt, and a
         * model that emits one anyway is rejected with a message saying delegation
         * is switched off — rather than silently treated as a THINK, which would
         * burn an iteration and tell nobody why.
         */
        val DELEGATION_ENABLED: Boolean =
            System.getenv("AGENT_DELEGATION_ENABLED")?.lowercase() == "true"

        /**
         * A JSON rendering that two runs of the same call agree on.
         *
         * Three normalisations, each closing a way the same call re-serialises
         * differently:
         *
         *  - **Keys sorted.** `{"a":1,"b":2}` and `{"b":2,"a":1}` are the same call.
         *    Jackson preserves the parse order, which follows the model's output.
         *  - **Numbers normalised.** A whole number renders as `1` whether it arrived
         *    as `Int`, `Long`, `Double` or `BigDecimal`; a fractional one renders via
         *    [java.math.BigDecimal.stripTrailingZeros] so `1.50` and `1.5` agree.
         *    Jackson parses bare JSON numbers to `Int` or `Double` depending on
         *    magnitude and form, so this is the common case, not an exotic one.
         *  - **Nulls dropped.** An absent key and an explicit `null` are the same
         *    call. [executeTool] already filters nulls out before dispatch, so
         *    keeping them here would key on something the tool never sees.
         *
         * Strings are escaped, never truncated: two calls differing only past a
         * truncation point must not collide.
         */
        internal fun canonicalJson(value: Any?): String = when (value) {
            null -> "null"
            is Map<*, *> -> value.entries
                .filter { it.value != null }
                .map { (k, v) -> k.toString() to v }
                .sortedBy { it.first }
                .joinToString(",", "{", "}") { (k, v) -> "${quote(k)}:${canonicalJson(v)}" }
            // Lists are ORDER-SENSITIVE and must stay so: [a,b] and [b,a] are
            // different arguments to every tool that takes a list.
            is List<*>       -> value.joinToString(",", "[", "]") { canonicalJson(it) }
            is Array<*>      -> value.joinToString(",", "[", "]") { canonicalJson(it) }
            is Number        -> canonicalNumber(value)
            is Boolean       -> value.toString()
            is String        -> quote(value)
            else             -> quote(value.toString())
        }

        private fun canonicalNumber(n: Number): String {
            val bd = when (n) {
                is java.math.BigDecimal -> n
                is java.math.BigInteger -> java.math.BigDecimal(n)
                is Double, is Float -> {
                    val d = n.toDouble()
                    // NaN and the infinities have no BigDecimal form. They are not
                    // valid JSON either, so they can only arrive from a hand-built
                    // map; rendering the token keeps the hash total.
                    if (d.isNaN() || d.isInfinite()) return d.toString()
                    java.math.BigDecimal(d.toString())
                }
                else -> java.math.BigDecimal(n.toLong())
            }
            val stripped = bd.stripTrailingZeros()
            return if (stripped.scale() <= 0) stripped.toBigInteger().toString()
                   else stripped.toPlainString()
        }

        private fun quote(s: String): String {
            val sb = StringBuilder(s.length + 2).append('"')
            for (c in s) when (c) {
                '"'  -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (c < ' ') sb.append("\\u%04x".format(c.code)) else sb.append(c)
            }
            return sb.append('"').toString()
        }

        private fun sha256Hex(s: String): String =
            java.security.MessageDigest.getInstance("SHA-256")
                .digest(s.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
    }

    /**
     * The SAME executor a `tool` node uses, so an agent calling a tool and a
     * workflow calling that tool do the same thing.
     *
     * This used to be a bare [com.vectorbea.worker.runtime.executor.HttpNodeExecutor],
     * which meant every agent tool call was executed as an HTTP request no matter
     * what the tool actually was. A Postgres tool resolved its `database`
     * connection against an executor demanding `http` and came back
     * "Connection 'X' has type 'database', expected 'http'" — recorded as one
     * failed observation inside the loop, after which the agent carried on and
     * the run still finished `succeeded`. Nothing was written and nothing said so.
     *
     * [ToolNodeExecutor] dispatches on the tool's own `type` (http / database /
     * builtin_email / SaaS aliases), applies its `requires_approval` flag, and
     * resolves `sqlTemplate` placeholders — none of which the HTTP path could do.
     */
    private val toolExecutor: ToolNodeExecutor? by lazy {
        val ds = dataSource ?: return@lazy null
        val pools = dbPoolManager ?: return@lazy null
        ToolNodeExecutor(ds, connectionResolver, pools, eventStore)
    }

    private val activationStore: ActivationStore? by lazy {
        dataSource?.let { ActivationStore(it) }
    }

    private val handoffStore: HandoffStore? by lazy { dataSource?.let { HandoffStore(it) } }

    private val contextStore: RunContextStore? by lazy {
        dataSource?.let { RunContextStore(it, payloads) }
    }

    /**
     * The delegation boundary.
     *
     * ── HOW THE CYCLE IS BROKEN ─────────────────────────────────────────────
     * The brain needs an [AgentCallExecutor] to serve DELEGATE, and the executor
     * needs a brain to run the child. Both are `by lazy`, mirroring how
     * [toolExecutor] is already built, and the child's brain is constructed PER
     * CALL inside [runChildAgent] — so there is no field that refers to a field
     * that refers back. The recursion this creates is bounded by the depth guard,
     * which is checked before a child brain is ever constructed.
     */
    private val agentCallExecutor: AgentCallExecutor? by lazy {
        if (!delegationEnabled) return@lazy null
        val ds = dataSource ?: return@lazy null
        val acts = activationStore ?: return@lazy null
        val edges = handoffStore ?: return@lazy null
        AgentCallExecutor(
            dataSource = ds,
            eventStore = eventStore,
            activations = acts,
            handoffs = edges,
            runChild = ::runChildAgent,
            ledger = budgetLedger,
            limits = teamLimits,
            permittedKinds = teamPolicy?.permittedKinds,
            rosterFor = teamPolicy?.rosterFor,
        )
    }

    /**
     * The delegation boundary, for a caller that is not the brain's own loop.
     *
     * Exactly one caller: the PIPELINE policy, where the runtime advances the
     * stages rather than a model choosing. It uses the same primitive an agent's
     * own DELEGATE uses — which is what stops the pipeline from becoming a second
     * dispatch path with its own guards, gate and reattach rules.
     */
    internal fun callExecutor(): AgentCallExecutor? = agentCallExecutor

    /**
     * Run one child agent to completion, inline.
     *
     * A fresh runner with the CHILD's grants, the child's activation id and the
     * child's depth — which is what makes the child's own roster check, its own
     * depth guard and its activation-scoped approval keys all correct without any
     * of them having to be told they are a child.
     *
     * Every collaborator is passed through rather than rebuilt, so a child shares
     * its parent's ledger (the whole point of a budget TREE), its event store and
     * its scripted provider in tests.
     */
    private suspend fun runChildAgent(
        call: AgentCallExecutor.ChildCall,
        ctx: RuntimeContext,
    ): AgentCallExecutor.ChildOutcome {
        val connectionId = call.llmConnectionId
            ?: return AgentCallExecutor.ChildOutcome.Failed(
                "Agent '${call.agentName}' has no LLM connection configured, so it could not run.",
                "ERROR")

        val childConfig = AgentBrainConfig(
            agentId = call.agentId,
            workspaceId = ctx.workspaceId,
            environmentId = ctx.environmentId,
            runId = ctx.runId,
            stepId = ctx.let { _ -> childStepId(call) },
            agentName = call.agentName,
            role = "worker",
            instructions = call.instructions ?: "Complete the task.",
            llmConnectionId = connectionId,
            modelName = call.modelName ?: "gpt-4o-mini",
            maxIterations = call.budget.iterations.coerceAtLeast(1),
            maxToolCalls = call.budget.toolCalls.coerceAtLeast(0),
            maxTotalTokens = call.budget.tokens.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()
                .coerceAtLeast(1),
            maxCostCents = Math.ceil(call.budget.costCents).toInt().coerceAtLeast(1),
            allowedToolIds = call.allowedToolIds,
            canDelegateTo = call.canDelegateTo,
            activationId = call.childActivationId,
            depth = call.depth,
            /* The contract's objective IS the child's task. That is the whole point
               of a structured contract: the child is told what is wanted rather than
               handed the parent's prompt and left to infer it. */
            taskInstruction = childInstruction(call.contract),
            /*
             * ── THE CHILD IS DELIBERATELY NOT GIVEN THE CONTRACT'S SCHEMA ───
             *
             * §5.2 rule 1: outputSchema is validated by the CALLER'S harness, not
             * the callee. Handing it down as the child's own `outputSchemaJson`
             * looks like belt and braces and is not: the child would stop with its
             * OWN SCHEMA_INVALID, the parent would see a failed observation, and the
             * boundary check — the one that names the mismatch to the party that
             * cares — would never run. The failure would read as "the worker
             * failed" rather than "the worker returned a shape its caller cannot
             * use", which is a different sentence pointing at a different fix.
             *
             * The schema is still STATED to the child, in the instruction, because
             * telling it what is wanted is how it produces the right shape. Stating
             * is not enforcing; the caller enforces.
             */
            outputSchemaJson = "{}",
            resolvedInput = call.contract.inputs + resolveContextRefs(call.contract, ctx),
        )

        val child = AgentBrainRunner(
            dataSource = dataSource,
            eventStore = eventStore,
            connectionResolver = connectionResolver,
            dbPoolManager = dbPoolManager,
            approvalStore = approvalStore,
            llmHttpClient = llmHttpClient,
            payloadStore = payloadStore,
            reconstructionEnabled = reconstructionEnabled,
            budgetLedger = budgetLedger,
            teamLimits = teamLimits,
            teamPolicy = teamPolicy,
            delegationEnabled = delegationEnabled,
            /* The child was constructed WITHOUT this, so a parent metered by the
               bucket produced children that were not — and delegation depth is
               the multiplier the bucket exists to bound. */
            capacity = capacity,
            /* Passed through for the same reason as every other collaborator: the
               child composes ITS OWN grants — `load` is keyed on the child's agent
               id and checked against the child's tools — but it must do so with the
               loader this runner was built with. Rebuilt from the default here, a
               child would read the process environment and silently ignore a flag
               the parent was constructed with, which is exactly how the capacity
               bucket came to meter parents and not children. */
            skillLoader = skillLoader,
            skillRecorder = skillRecorder,
        )

        val result = child.run(childConfig, ctx)

        budgetLedger?.consume(call.childActivationId, BudgetVector(
            iterations = result.iterationsUsed,
            tokens = result.tokensUsed.toLong(),
            costMicroCents = BudgetVector.ofCents(result.estimatedCostCents),
        ))

        return when {
            result.stopReason == AgentLoopState.StopReason.APPROVAL_REQUESTED &&
                result.approvalId != null ->
                AgentCallExecutor.ChildOutcome.Paused(
                    result.approvalId,
                    result.approvalMessage
                        ?: "Agent '${call.agentName}' is waiting for approval to continue.")

            result.stopReason == AgentLoopState.StopReason.FINAL_OUTPUT ->
                AgentCallExecutor.ChildOutcome.Completed(
                    output = result.finalOutput.filterValues { it != null }.mapValues { it.value!! },
                    tokensUsed = result.tokensUsed,
                    costCents = result.estimatedCostCents,
                )

            else -> AgentCallExecutor.ChildOutcome.Failed(
                result.failureReason
                    ?: "Agent '${call.agentName}' stopped with ${result.stopReason}.",
                result.stopReason.name,
            )
        }
    }

    /**
     * The child's step id.
     *
     * Derived from the parent's step and the child's ACTIVATION, so two workers on
     * one step keep separate iteration rows — `agent_iterations` is unique on
     * `(run_id, step_id, iteration_number)`, and two children sharing a step id
     * would overwrite each other's transcript, one iteration at a time.
     */
    private fun childStepId(call: AgentCallExecutor.ChildCall): String =
        "act:${call.childActivationId}"

    /** The objective, plus the parts of the contract a model needs stated in words. */
    private fun childInstruction(contract: TaskContract): String = buildString {
        append(contract.objective)
        /* Stated, not enforced — see the note on outputSchemaJson in [runChildAgent].
           A child told the expected shape usually produces it; a child that does not
           is caught at the caller's boundary, where the mismatch means something. */
        contract.outputSchema?.let { schema ->
            runCatching { mapper.writeValueAsString(schema) }.getOrNull()?.let {
                append("\n\nYOUR CALLER EXPECTS THIS SHAPE: ").append(it)
            }
        }
        contract.successCriteria?.takeIf { it.isNotBlank() }?.let {
            append("\n\nSUCCESS CRITERIA: ").append(it)
        }
        if (contract.constraints.isNotEmpty()) {
            append("\n\nCONSTRAINTS:\n")
            append(contract.constraints.joinToString("\n") { "- $it" })
        }
    }

    /**
     * Resolve the contract's blackboard POINTERS into values, for the child only.
     *
     * §5.2 rule 2: the contract carries pointers, not payloads, so the prompt does
     * not grow at every hop. The resolution happens HERE, at the callee, and only
     * for what the callee was actually pointed at.
     */
    /**
     * `(provider, credential fingerprint)` for this agent's LLM connection.
     *
     * Memoised for the life of this runner — one broadcast resolves it once,
     * and a runner exists for one node execution. Without the memo a twenty-child
     * fan-out would decrypt the same secret twenty times to answer a question that
     * has one answer.
     *
     * Null when the connection cannot be resolved, which makes the preflight a
     * no-op rather than an error: a fan-out whose connection is broken has a
     * bigger problem than its stagger, and it will surface at the first call.
     */
    @Volatile private var cachedAccount: Pair<String, String>? = null

    private fun accountOf(config: AgentBrainConfig): Pair<String, String>? {
        cachedAccount?.let { return it }
        return runCatching {
            val resolved = connectionResolver.resolve(
                config.llmConnectionId, config.workspaceId, expectedType = "llm")
            val fp = resolved.secret?.let { sv ->
                var chars = CharArray(0)
                sv.useOnce { chars = it.toCharArray() }
                val f = com.vectorbea.worker.net.CredentialKey.fingerprint(chars)
                java.util.Arrays.fill(chars, ' ')
                f
            } ?: com.vectorbea.worker.net.CredentialKey.UNKNOWN
            (resolved.record.provider to fp).also { cachedAccount = it }
        }.getOrNull()
    }

    private fun resolveContextRefs(contract: TaskContract, ctx: RuntimeContext): Map<String, Any?> {
        if (contract.contextRefs.isEmpty()) return emptyMap()
        val store = contextStore ?: return emptyMap()
        return runCatching {
            val reader = RunContextStore.Reader(ctx.runId, teamRef = null, activationId = null)
            store.latest(reader, contract.contextRefs.map { it.key })
                .associate { it.key to it.value }
        }.getOrDefault(emptyMap())
    }

    /**
     * Full-fidelity payload capture: injected, or built from [dataSource].
     *
     * Gated by TRACE_PAYLOAD_CAPTURE so it can be turned off in production without
     * touching a run's outcome — refs simply stop being written, and reconstruction
     * then declines and replays, which is the behaviour that shipped before this.
     */
    private val payloads: com.vectorbea.worker.events.PayloadStore? by lazy {
        payloadStore
            ?: if (!PAYLOAD_CAPTURE_ENABLED) null
        else dataSource?.let {
            com.vectorbea.worker.events.PayloadStore(
                it, retentionDays = com.vectorbea.worker.events.RetentionLookup(it)::daysFor)
        }
    }

    /** Rebuilds loop state from persisted iterations. See [AgentLoopReconstructor]. */
    private val reconstructor: AgentLoopReconstructor by lazy {
        AgentLoopReconstructor(dataSource, payloads)
    }

    /** The tool-call idempotency guard: injected, or built from [dataSource]. */
    private val toolGuard: StepExecutionGuard? =
        stepGuard ?: dataSource?.let { StepExecutionGuard(it) }

    /** Where a guarded tool call's output is stored and replayed from. */
    private val toolOutputs: StepOutputStore? =
        stepOutputStore ?: dataSource?.let { StepOutputStore(it) }

    /**
     * The SAME executor an `llm` node uses.
     *
     * The loop previously built its own OpenAI request by hand, which broke in two
     * ways. It appended `/chat/completions` to the connection's `baseUrl`, while
     * every other caller in the platform (`LlmNodeExecutor`, `LlmTester`,
     * `lib/server/execution.ts`) appends `/v1/chat/completions` — so a connection
     * whose `baseUrl` is `https://api.openai.com`, which is the form those callers
     * store, produced `https://api.openai.com/chat/completions` and a 404. And it
     * spoke OpenAI's dialect to every provider, so an Anthropic connection got an
     * OpenAI body and an `Authorization: Bearer` header posted to a path Anthropic
     * does not serve — another 404.
     *
     * Delegating fixes both and inherits the provider throttle, the connection
     * circuit breaker, replay recording and the cost/token metrics for free.
     */
    private val llmExecutor by lazy {
        /* The client is the ONLY seam a test needs: everything above it — prompt
           assembly, provider dialect, response parsing, cost and token accounting,
           LLM_CALL_* events — then runs for real against a scripted response, rather
           than being stubbed out and therefore untested. Null in production, where
           LlmNodeExecutor's own default (the shared, bounded OutboundHttp client)
           applies and this construction is byte-for-byte what it always was. */
        if (llmHttpClient == null) LlmNodeExecutor(connectionResolver, eventStore, capacity = capacity,
            pricing = com.vectorbea.worker.pricing.ModelPricing(dataSource))
        else LlmNodeExecutor(connectionResolver, eventStore, httpClient = llmHttpClient,
            capacity = capacity,
            pricing = com.vectorbea.worker.pricing.ModelPricing(dataSource))
    }

    data class RunResult(
        val finalOutput: Map<String, Any?>,
        val stopReason: AgentLoopState.StopReason,
        val iterationsUsed: Int,
        /**
         * True when the loop ended by TRANSFERRING control rather than by answering.
         *
         * Carried out of the loop because the harness cannot infer it: a handoff
         * ends with FINAL_OUTPUT and the child's answer, which is
         * indistinguishable from the agent having produced that answer itself.
         * Without this the activation is graded `succeeded`, and a router that
         * correctly routed is counted as having done the work.
         */
        val handedOff: Boolean = false,
        /**
         * Non-null when the loop stopped because the TICK ended, not because
         * anything was decided.
         *
         * The caller stands the run down and re-executes this node. Kept separate
         * from [failureReason] because a yield is not a failure and must never be
         * rendered as one — the run is fine, it is simply not finished.
         */
        val yieldedReason: String? = null,
        val tokensUsed: Int,
        val estimatedCostCents: Double,
        val observations: List<AgentObservation>,
        /**
         * Tool calls that failed, even when the agent went on to declare success.
         *
         * An agent can observe a tool failure and still return FINAL - the model
         * decides it has enough to answer. The runtime then reported a clean
         * `succeeded` run, which is how a workflow whose entire purpose was a database
         * write finished green with nothing written, three separate times, each time
         * with the real cause buried in one observation event mid-timeline.
         *
         * Kept so the step can carry it into its output and the run can say so. The
         * status is deliberately NOT changed here: an agent that tried a tool, found it
         * unavailable and produced a considered fallback is a legitimate success, and
         * that judgement belongs to whoever designed the workflow. What is not
         * legitimate is saying nothing.
         */
        val failedToolCalls: List<String> = emptyList(),

        /**
         * WHAT actually went wrong, when something did.
         *
         * The stop reason alone is a category, not a diagnosis. A run that died
         * because the LLM connection was refused recorded
         * `error_json: {"message": "Agent 'X' stopped with reason: ERROR after 1
         * iterations."}` — which is what the run detail screen shows for a failed
         * run, and it names nothing. The real cause ("HTTP request failed:
         * ConnectException") was written to an AGENT_FAILED event and went no
         * further, so the summary the screen leads with was the one place the
         * answer was missing.
         *
         * Null when the loop ended cleanly.
         */
        val failureReason: String? = null,

        /**
         * Whether running this agent step again could plausibly end differently.
         *
         * The node-level retry policy exists for faults that are transient by nature —
         * a refused connection, a dropped socket, a provider hiccup. It was being
         * applied to every failure equally, including the ones this loop reached BY
         * DECIDING: the agent weighed the task and declined, or it produced output that
         * did not match its schema, or a tool failed identically twice. Re-running
         * those replays the same prompt against the same state and reaches the same
         * conclusion, having spent a second full agent budget to do it — and, because
         * each attempt is several LLM calls, having pushed the run's per-tick execution
         * budget over its limit, which is what makes a failed agent step yield and
         * re-enqueue the whole run.
         *
         * So the loop says which kind of ending this was; [AgentBrainRunner] knows and
         * the retry loop cannot infer it from an error string. Default true, because
         * anything unrecognised is safer to retry than to abandon.
         */
        val retryable: Boolean = true,

        /**
         * The pending approval this run is waiting on, when [stopReason] is
         * APPROVAL_REQUESTED.
         *
         * Present so the caller can return [NodeResult.ApprovalPaused] and let the
         * runtime park the run against a real row in `run_approvals` — the same row the
         * Approvals screen lists and decides. Without it an agent asking for a human
         * had nowhere to put the question, and the ask was reported as a step failure.
         */
        val approvalId: String? = null,
        val approvalMessage: String? = null,

        /**
         * The wait this run parked on, when [stopReason] is WAITING.
         *
         * Present for the same reason [approvalId] is: so the caller can return
         * `NodeResult.Waiting` and let the runtime park the run against a real
         * `run_waits` row. Without it an agent that chose to wait would have
         * nowhere to put the question, and the wait would be reported as a step
         * failure — which is exactly what ASK_APPROVAL used to do.
         */
        val wait: NodeResult.Waiting? = null,
        /**
         * Which skills this activation ran with, and what composing them cost.
         *
         * Carried out of the loop for the same reason [handedOff] is: the harness
         * cannot infer it. The harness owns the ACTIVATION span, §5 says the
         * active skills belong on it, and the loop is the only thing that knows
         * what was actually composed — a grant row does not, because a skill can
         * be granted and then dropped under budget pressure or because its tools
         * were revoked.
         *
         * Empty whenever the feature is off, which is also what an activation
         * with no skills records: nothing.
         */
        val skillAttributes: Map<String, Any> = emptyMap(),
    )

    suspend fun run(config: AgentBrainConfig, runtimeCtx: RuntimeContext): RunResult {
        val budget = AgentBudget(
            maxIterations  = config.maxIterations,
            maxToolCalls   = config.maxToolCalls,
            maxTotalTokens = config.maxTotalTokens,
            maxCostCents   = config.maxCostCents,
            timeoutMs      = config.timeoutMs,
        )
        val state = AgentLoopState(config = config, budget = budget)

        /*
         * ── WHAT THIS AGENT ALREADY DID, BEFORE IT WAS INTERRUPTED ───────────
         *
         * The step re-executes from iteration 1 whenever the run resumes — after an
         * approval, a timer, a yield. Loop state lives in memory, so the second pass
         * started blind: same task, no observations, no memory, and it dutifully made
         * the same LLM calls and re-ran the same tools it had already run. Watching a
         * run get approved and then immediately repeat several minutes of work is
         * exactly the "the agent keeps going after it finished" report.
         *
         * `AgentMemoryStore` had been writing these entries since the loop shipped and
         * `load` had never been called from anywhere — the memory was write-only.
         */
        /*
         * ── CONTINUE, OR START OVER ──────────────────────────────────────────
         *
         * Reconstruction and memory recall solve the same problem at different
         * fidelities, and they must not both run. Recall restores a flattened
         * key/value summary of what happened; reconstruction restores the actual
         * observations in order. Doing both puts each observation in front of the
         * model TWICE, once as an observation and once as a memory entry — which
         * reads to the model as the tool having been called twice, and is exactly
         * the kind of false history that makes an agent's next decision wrong.
         *
         * So: reconstruct if we can, recall if we cannot. Never both.
         */
        val reconstruction = runCatching {
            reconstructor.reconstruct(
                config = config, state = state, budget = budget,
                /* A replay-from-N is a deliberate request to rebuild, so it does
                   not need the continuation flag a resume is gated on: the
                   caller has already said what it wants. */
                allowed = runtimeCtx.allowLoopReconstruction || runtimeCtx.replayFromIteration != null,
                enabled = reconstructionEnabled,
                upToIteration = runtimeCtx.replayFromIteration,
            )
        }.getOrElse { e ->
            /* A bug in reconstruction must not be able to fail a run. */
            log.warn("[brain] reconstruction threw — falling back to replay: {}", e.message)
            AgentLoopReconstructor.Outcome.Skipped(
                AgentLoopReconstructor.SkipReason.READ_FAILED, e.message?.take(200))
        }

        var recalled: Map<String, Any?> = emptyMap()

        when (reconstruction) {
            is AgentLoopReconstructor.Outcome.Reconstructed -> {
                emitEvent(config, RunEventStore.EventType.AGENT_LOOP_RECONSTRUCTED, "running",
                    "Resumed at iteration ${reconstruction.resumeFromIteration} — " +
                    "${reconstruction.observationsRestored} observation(s) restored, " +
                    "no earlier work repeated",
                    /* STRUCTURED, not only prose. The inspector marks iterations
                       before `resumeFromIteration` as recalled rather than
                       re-executed, and parsing that number back out of a sentence
                       would break the first time the sentence is reworded. */
                    metadataJson = runCatching {
                        mapper.writeValueAsString(mapOf(
                            "resumeFromIteration" to reconstruction.resumeFromIteration,
                            "observationsRestored" to reconstruction.observationsRestored,
                            "tokensRestored" to reconstruction.tokensRestored,
                        ))
                    }.getOrNull())
            }

            is AgentLoopReconstructor.Outcome.Skipped -> {
                /*
                 * Only the reasons that mean "there WAS a transcript and we could not
                 * use it" are worth an event or a snapshot. DISABLED,
                 * NOT_A_CONTINUATION and NO_ITERATIONS are the ordinary path — a first
                 * execution is not a degradation and must not read like one.
                 */
                val degraded = reconstruction.reason !in setOf(
                    AgentLoopReconstructor.SkipReason.DISABLED,
                    AgentLoopReconstructor.SkipReason.NOT_A_CONTINUATION,
                    AgentLoopReconstructor.SkipReason.NO_PERSISTENCE,
                    AgentLoopReconstructor.SkipReason.NO_ITERATIONS,
                )
                if (degraded) {
                    /* Before the replay overwrites rows 1..N, keep them. See
                       AgentLoopReconstructor.snapshotBeforeFallback. */
                    val snapshotRef = runCatching {
                        reconstructor.snapshotBeforeFallback(config)
                    }.getOrNull()

                    log.warn("[brain] loop reconstruction skipped ({}) run={} step={}: {}",
                        reconstruction.reason, config.runId, config.stepId, reconstruction.detail)

                    emitEvent(config, RunEventStore.EventType.AGENT_LOOP_RECONSTRUCTION_SKIPPED,
                        "running",
                        "Replaying from iteration 1 — could not rebuild loop state " +
                        "(${reconstruction.reason})",
                        metadataJson = mapper.writeValueAsString(buildMap {
                            put("reason", reconstruction.reason.name)
                            reconstruction.detail?.let { put("detail", it.take(300)) }
                            snapshotRef?.let { put("transcriptSnapshotRef", it) }
                        }))
                }

                /*
                 * Memory recall — the pre-existing, lower-fidelity path. Unchanged,
                 * and now explicitly the fallback rather than the only option.
                 *
                 * `AgentMemoryStore` had been writing these entries since the loop
                 * shipped and `load` had never been called from anywhere.
                 */
                recalled = memoryStore.load(config.runId, config.agentId)
                if (recalled.isNotEmpty()) {
                    recalled.forEach { (key, value) -> state.addRecalledMemory(key, value) }
                    log.info("[brain] resumed with {} memory entrie(s) runId={} step={}",
                        recalled.size, config.runId, config.stepId)
                }
            }
        }

        /* ONE start event. Emitting a second one to announce the recall made the
           timeline show the agent starting twice, which reads as the step running
           twice — the exact confusion this whole area keeps producing. */
        emitEvent(config, RunEventStore.EventType.AGENT_STARTED, "running",
            "Agent brain started — task: ${(config.taskInstruction ?: "").take(100)}" +
                when {
                    reconstruction is AgentLoopReconstructor.Outcome.Reconstructed ->
                        " (continued — rebuilt ${reconstruction.observationsRestored} observation(s), " +
                        "resuming at iteration ${reconstruction.resumeFromIteration})"
                    recalled.isNotEmpty() ->
                        " (resumed — recalled ${recalled.size} entrie(s) from earlier in this run)"
                    else -> ""
                })

        /* Carries the cause out of the loop and into RunResult. See RunResult.failureReason. */
        var failureReason: String? = null

        /* Set false at each stop the loop reached by deciding something, as opposed to
           by breaking. See RunResult.retryable. */
        var retryable = true

        /* The approval the loop is parked on, when it parks. See RunResult.approvalId. */
        var approvalId: String? = null
        /* The wait the loop is parked on, when it parks on something that is not
           a person. See RunResult.wait. */
        var pendingWait: NodeResult.Waiting? = null
        var approvalMessage: String? = null

        /* Set by HANDOFF. See RunResult.handedOff. */
        var handedOff = false

        /* Set when a fan-out ran out of tick. See RunResult.yieldedReason. */
        var yieldedReason: String? = null

        /*
         * ── WHAT EVERY ITERATION SPAN HANGS OFF, READ EXACTLY ONCE ───────────
         *
         * The activation span when the harness opened one, the agent's step span
         * otherwise — both answer to this step's node id, so one lookup covers both
         * and this class needs to know nothing about activations.
         *
         * Read HERE and not inside the loop. Each iteration repoints that node id at
         * ITSELF, so that the model and tool calls it makes find it as their parent;
         * a lookup inside the loop would return the previous iteration and nest the
         * iterations inside one another, turning a flat list of six into a ladder six
         * deep.
         */
        val tracer = runtimeCtx.tracer
        val loopParentSpan = tracer?.let { it.spanForNode(config.stepId) ?: it.tickSpanId }

        /* The iteration currently open, so the paths that leave the loop without
           finishing an iteration — a break, an exception — can still close it.
           [IterationSpan.close] is close-once, so the ordinary paths that already
           closed it are unaffected. */
        var openIteration: IterationSpan? = null

        /*
         * ── WHICH SKILLS WERE ACTIVE, CARRIED OUT TO THE ACTIVATION SPAN ─────
         *
         * §5: a behaviour change has to be attributable to a skill VERSION. The
         * activation span is where that belongs — it is the unit a reader opens
         * when asking "what was this agent working with" — and the harness owns
         * that span, so the answer rides out on [RunResult].
         *
         * Also put on each iteration span, because an iteration is what a reader
         * is looking at when they ask why THIS call went the way it did, and
         * walking up to the activation to find out is a click they should not
         * have to make.
         */
        var skillAttributes: Map<String, Any> = emptyMap()
        var skillsRecorded = false

        try {
            while (!state.isDone) {
                budget.iterationStarted()
                state.iteration++

                /*
                 * ── HAS SOMEBODY ASKED US TO STOP? ───────────────────────
                 *
                 * `WorkflowRuntime` checks cancellation BETWEEN nodes, which is
                 * the right granularity for a node that finishes in one bounded
                 * operation. An agent loop is not that: thirty iterations is
                 * thirty LLM calls inside ONE node, so before this check a
                 * cancelled incident kept paying a model to reason about a
                 * problem that had already been resolved — until the loop
                 * decided to stop on its own.
                 *
                 * EVERY iteration, not every fifth. The check is one indexed
                 * read; the thing it might save is an LLM call, and the ratio is
                 * not close. Placed before the budget check so a cancelled run
                 * stops rather than being reported as over budget.
                 */
                if (runtimeCtx.cancellationCheck()) {
                    state.stopReason = AgentLoopState.StopReason.CANCELLED
                    retryable = false
                    emitEvent(config, RunEventStore.EventType.AGENT_CANCELLED, "cancelled",
                        "Stopped at iteration ${state.iteration}: the run was cancelled.")
                    log.info("[brain] cancelled at iteration {} [run={}, step={}]",
                        state.iteration, runtimeCtx.runId, config.stepId)
                    break
                }

                // Hard budget check before each iteration
                try { budgetGuard.checkOrThrow(budget, "before iteration ${state.iteration}") }
                catch (e: BudgetExceededException) {
                    state.stopReason = AgentLoopState.StopReason.BUDGET_EXCEEDED
                    failureReason = "Budget exceeded: ${e.message}"
                    /* A retry gets the same budget and the same work to do with it. */
                    retryable = false
                    emitEvent(config, RunEventStore.EventType.AGENT_BUDGET_EXCEEDED, "failed",
                        "Budget exceeded: ${e.message}")
                    break
                }

                /*
                 * ── WHAT A PERSON HAS SAID SINCE THE LAST ITERATION ─────────
                 * Read here, before the prompt is built, so guidance sent while
                 * the previous LLM call was in flight is in front of the model on
                 * the very next iteration rather than one later. An agent that
                 * acts on a correction one step after being given it is, from the
                 * outside, an agent that ignored it.
                 */
                drainGuidance(config, runtimeCtx, state)

                log.info("[brain] iteration {}/{} runId={}", state.iteration, config.maxIterations, config.runId)
                emitEvent(config, RunEventStore.EventType.AGENT_ITERATION_STARTED, "running",
                    "Iteration ${state.iteration}/${config.maxIterations}")

                val iterationId = persistIterationStart(config, state)

                /* Opened alongside the row and closed alongside it, so the trace and
                   the reconstruction can never disagree about whether an iteration
                   failed — they are read side by side in the debugger, and a
                   discrepancy between them reads as a bug in the run itself. */
                val iterSpan = IterationSpan.open(tracer, loopParentSpan, state.iteration, config.stepId)
                openIteration = iterSpan

                /* Where the budget stood BEFORE this iteration, so its delta can be
                   recorded. See BudgetMark. */
                val budgetMark = BudgetMark.of(budget)

                // Build prompt and call LLM
                val tools = loadAllowedToolDescriptors(config)
                /*
                 * ── SKILLS, READ FRESH LIKE THE ROSTER AND THE TOOL LIST ─────
                 *
                 * Inside the loop rather than before it, for the reason stated on
                 * `loadRoster`: a grant is POLICY, and an operator who revokes a
                 * skill — or the tool a skill needs — mid-run is making a decision
                 * that must take effect. The read costs one query per iteration,
                 * the same as the two beside it.
                 *
                 * `grantedToolIds` is passed so the loader can drop a skill whose
                 * tools were revoked since the grant was saved. That check is the
                 * same `SkillGrant.check` the API ran at save time, from the same
                 * module — two implementations would drift, and the drift would be
                 * invisible: the form would call a grant fine and the runtime
                 * would quietly disagree.
                 */
                val loadedSkills = skillLoader.load(config.agentId, config.workspaceId, config.allowedToolIds)
                val composedSkills = skillLoader.compose(loadedSkills, teamLimits.maxContextChars)
                skillAttributes = composedSkills.spanAttributes()
                if (!skillsRecorded && composedSkills.outcomes.isNotEmpty()) {
                    /* Once per activation, not once per iteration. The row is keyed
                       so a repeat would be harmless, but a write per iteration is a
                       write per iteration. */
                    skillRecorder.record(
                        runId = config.runId, workspaceId = config.workspaceId,
                        agentId = config.agentId, stepId = config.stepId,
                        activationId = config.activationId, composed = composedSkills,
                    )
                    skillsRecorded = true
                }
                val systemPrompt = AgentPromptBuilder.buildSystemPrompt(
                    config, tools, loadRoster(config), composedSkills.text,
                )
                /* Flag off, `built.text` is byte-for-byte what buildUserPrompt has
                   always returned and `built.assembly` is null. On, the same
                   sections are assembled under a budget and every drop is named. */
                /* §12.5 — the team's character budget, not the global default.
                   Every agent in a team runs through this loop with that team's
                   limits, so passing it here covers the entry member, every
                   delegated child and every inline hop without a per-call-site
                   decision about which budget applies. */
                val built = AgentPromptBuilder.buildUserPromptDetailed(
                    config, state, charBudget = teamLimits.maxContextChars,
                    enabled = contextAssemblyEnabled)
                val userPrompt = built.text
                built.assembly?.let { iterSpan?.contextAttributesJson = it.attributesJson() }
                iterSpan?.skillAttributes = skillAttributes
                built.assembly?.let { reportContextBudget(config, state, it) }

                val llmResult = callLlm(config, systemPrompt, userPrompt, runtimeCtx)
                budget.addTokens(llmResult.tokensUsed, llmResult.estimatedCostCents)

                // Parse action from LLM response
                val action = parseAction(llmResult.rawContent, state, iterationId, config)

                // Validate action structure and safety
                try {
                    safetyGuard.validateActionStructure(action)
                    if (action.type == AgentAction.ActionType.CALL_TOOL) {
                        safetyGuard.validateToolAllowed(action, config)
                    }
                    /* The roster grant, checked exactly where the tool grant is and
                       in the same shape. AgentCallExecutor checks it AGAIN at the
                       boundary; this one is what makes the stop attributable to the
                       model's choice on this iteration. */
                    if (action.type == AgentAction.ActionType.DELEGATE ||
                        action.type == AgentAction.ActionType.HANDOFF) {
                        if (!delegationEnabled) throw InvalidActionException(
                            "${action.type} is not available: agent-to-agent delegation is " +
                            "switched off on this worker.")
                        safetyGuard.validateAgentAllowed(action, config)
                    }
                } catch (e: InvalidActionException) {
                    log.warn("[brain] invalid action iter={}: {}", state.iteration, e.message)
                    emitEvent(config, RunEventStore.EventType.AGENT_INVALID_ACTION, "running",
                        "Invalid action: ${e.message}")
                    persistIterationComplete(iterationId, iterSpan, "failed", action, null, budget, budgetMark)
                    state.stopReason = AgentLoopState.StopReason.ERROR
                    failureReason = "The agent produced an action the runtime could not execute: ${e.message}"
                    break
                } catch (e: ToolNotAllowedException) {
                    log.warn("[brain] tool not allowed toolId={}: {}", e.toolId, e.message)
                    emitEvent(config, RunEventStore.EventType.AGENT_TOOL_NOT_ALLOWED, "running",
                        "Tool ${e.toolId} not allowed")
                    persistIterationComplete(iterationId, iterSpan, "failed", action, null, budget, budgetMark)
                    state.stopReason = AgentLoopState.StopReason.TOOL_NOT_ALLOWED
                    failureReason = "The agent tried to call tool ${e.toolId}, which is not in its allowed tool list."
                    /* A grant, not a glitch. Nothing changes until someone changes it. */
                    retryable = false
                    break
                } catch (e: AgentNotInRosterException) {
                    /* The roster analogue of the branch above, and deliberately its
                       twin: same shape, same non-retryable reasoning, same hard stop.
                       An ungranted target is a configuration answer, not a fault. */
                    log.warn("[brain] agent not in roster target={}: {}", e.targetAgentId, e.message)
                    emitEvent(config, RunEventStore.EventType.AGENT_TOOL_NOT_ALLOWED, "running",
                        "Agent ${e.targetAgentId} is not on the roster")
                    persistIterationComplete(iterationId, iterSpan, "failed", action, null, budget, budgetMark)
                    state.stopReason = AgentLoopState.StopReason.AGENT_NOT_IN_ROSTER
                    failureReason = e.message
                    retryable = false
                    break
                }

                state.lastAction = action
                val sanitizedReason = safetyGuard.sanitizeReasoningSummary(action.reasoningSummary)
                emitEvent(config, RunEventStore.EventType.AGENT_ACTION_SELECTED, "running",
                    "Action: ${action.type} — $sanitizedReason")

                // Execute action
                when (action.type) {
                    AgentAction.ActionType.THINK -> {
                        val summary = "Thought: $sanitizedReason"
                        state.addObservation(AgentObservation(state.iteration, "THINK", sanitizedSummary = summary))
                        state.addMemory("thought_${state.iteration}", sanitizedReason)
                        emitEvent(config, RunEventStore.EventType.AGENT_REFLECTION_CREATED, "running", summary)
                        persistIterationComplete(iterationId, iterSpan, "completed", action, summary, budget, budgetMark)
                    }

                    AgentAction.ActionType.CALL_TOOL -> {
                        budget.toolCallUsed()
                        emitEvent(config, RunEventStore.EventType.AGENT_TOOL_SELECTED, "running",
                            "Calling tool: ${action.toolId}")

                        /* The observation BEFORE this call, so a repeat can be spotted. */
                        val previous = state.observations.lastOrNull()

                        val outcome = executeTool(action, config, runtimeCtx, state)
                        val obs = outcome.observation
                        state.addObservation(obs)
                        /* Not remembered when the call is only waiting on a gate: "waiting
                           for approval" is true for the next few seconds, and recalling it
                           on the resumed execution would tell the agent the tool is blocked
                           at the exact moment it has been unblocked. */
                        if (outcome.pause == null) {
                            /* The payload, not only the shape. Memory is what survives into
                               the next execution of this step, so storing "Tool returned 2
                               field(s)" here means a resumed agent knows it made the call and
                               still has to make it again to see the answer. */
                            state.addMemory(
                                "obs_${state.iteration}_${action.toolId}",
                                obs.payload?.let { "${obs.sanitizedSummary} RESULT: $it" }
                                    ?: obs.sanitizedSummary,
                            )
                        }
                        emitEvent(config, RunEventStore.EventType.AGENT_OBSERVATION_RECORDED, "running",
                            obs.sanitizedSummary)
                        /* The observation's payload is what the model reads next time,
                           so it is stored separately from the full result: the rebuild
                           needs the prompt-shaped version, the debugger needs the whole
                           thing. */
                        val obsRef = runCatching {
                            obs.payload?.let {
                                payloads?.capture(config.workspaceId, it,
                                    com.vectorbea.worker.events.PayloadStore.TEXT)?.ref
                            }
                        }.getOrNull()
                        persistIterationComplete(iterationId, iterSpan, "completed", action,
                            obs.sanitizedSummary, budget, budgetMark,
                            observationSuccess = obs.success,
                            observationPayloadRef = obsRef,
                            toolResultRef = outcome.resultRef,
                            toolResultCached = outcome.cached)

                        /* The tool started something long-running. Park the step on it
                           for the same reason an approval parks it: an agent that keeps
                           reasoning while a six-minute render runs spends its whole
                           iteration budget and then reports that it could not finish. */
                        if (outcome.wait != null) {
                            state.stopReason = AgentLoopState.StopReason.WAITING
                            retryable = false
                            pendingWait = outcome.wait
                            emitEvent(config, RunEventStore.EventType.RUN_WAIT_STARTED,
                                "waiting_for_event",
                                "Tool call is waiting: ${outcome.wait.label}")
                        }

                        /* The tool needs a person. Park the whole step on that decision
                           rather than letting the agent reason around a locked door. */
                        if (outcome.pause != null) {
                            state.stopReason = AgentLoopState.StopReason.APPROVAL_REQUESTED
                            retryable       = false
                            approvalId      = outcome.pause.approvalId
                            approvalMessage = outcome.pause.message
                            emitEvent(config, RunEventStore.EventType.AGENT_APPROVAL_REQUESTED,
                                "waiting_for_approval",
                                "Tool call needs approval before it can run: ${outcome.pause.message}")
                        }

                        /*
                         * STOP WHEN THE SAME CALL FAILS THE SAME WAY TWICE.
                         *
                         * A tool that fails deterministically - bad SQL, a missing
                         * column, a revoked credential - fails identically however many
                         * times it is asked. The loop had no notion of that: it fed the
                         * failure back as an observation and let the model try again
                         * until max iterations, which for one reported run meant ten
                         * iterations, ten LLM calls and ten identical errors before the
                         * step gave up. Every one of those was paid for.
                         *
                         * Identical means SAME TOOL and SAME MESSAGE. If the model
                         * changes its arguments and draws a different error it is
                         * learning something, and it keeps its remaining iterations;
                         * repeating itself verbatim is the case that cannot improve.
                         *
                         * The failure carries the tool's own message, so the run says
                         * what was wrong with the call rather than that the agent
                         * ran out of turns.
                         */
                        /* `outcome.pause == null` first: a paused call is an unsuccessful
                           observation twice over if the agent already tried it, and without
                           this the repeat check would overwrite APPROVAL_REQUESTED with
                           ERROR and turn a waiting run back into a failed one. */
                        if (outcome.pause == null && outcome.wait == null &&
                            !obs.success && previous != null && !previous.success &&
                            previous.actionType == "CALL_TOOL" &&
                            previous.toolId == obs.toolId &&
                            failureSignature(previous.sanitizedSummary) == failureSignature(obs.sanitizedSummary)
                        ) {
                            state.stopReason = AgentLoopState.StopReason.ERROR
                            /* The loop already proved this repeats. Proving it a third
                               and fourth time is what the node retry would do. */
                            retryable = false
                            failureReason = "Tool ${obs.toolId} failed twice with the same error, so the " +
                                "agent stopped rather than retrying it further: ${obs.sanitizedSummary}"
                            emitEvent(config, RunEventStore.EventType.AGENT_FAILED, "failed",
                                "Stopped after an identical repeated tool failure: ${obs.sanitizedSummary}")
                        }
                    }

                    AgentAction.ActionType.DELEGATE, AgentAction.ActionType.HANDOFF -> {
                        val outcome = executeDelegation(action, config, runtimeCtx, state)

                        when (outcome) {
                            is DelegationOutcome.Refused -> {
                                /* A guard said no BEFORE anything was created. Each
                                   refusal carries its own stop reason, so the run
                                   detail names the guard rather than the category. */
                                state.stopReason = outcome.stopReason
                                retryable = false
                                failureReason = outcome.reason
                                state.addObservation(AgentObservation(
                                    state.iteration, action.type.name, action.targetAgentId,
                                    outcome.reason.take(300), success = false))
                                emitEvent(config, RunEventStore.EventType.AGENT_FAILED, "failed",
                                    outcome.reason.take(300))
                                persistIterationComplete(iterationId, iterSpan, "failed", action,
                                    outcome.reason.take(300), budget, budgetMark)
                            }

                            is DelegationOutcome.Paused -> {
                                /* The CHILD is waiting on a person. The parent parks
                                   with it — this is the one case where
                                   `waiting_for_child` is a real wait rather than a
                                   marker, because the tick ends here. */
                                state.stopReason = AgentLoopState.StopReason.APPROVAL_REQUESTED
                                retryable = false
                                approvalId = outcome.approvalId
                                approvalMessage = outcome.message
                                emitEvent(config, RunEventStore.EventType.AGENT_APPROVAL_REQUESTED,
                                    "waiting_for_approval", outcome.message.take(300))
                                persistIterationComplete(iterationId, iterSpan, "completed", action,
                                    outcome.message.take(300), budget, budgetMark)
                            }

                            is DelegationOutcome.Yielded -> {
                                /* Stand the run down. The loop stops here with no
                                   stop reason — a yield is not an outcome — and the
                                   node re-executes on the next tick. */
                                yieldedReason = outcome.reason
                                state.stopReason = AgentLoopState.StopReason.BUDGET_EXCEEDED
                                retryable = true
                                failureReason = outcome.reason
                                persistIterationComplete(iterationId, iterSpan, "completed", action,
                                    outcome.reason.take(300), budget, budgetMark)
                            }

                            is DelegationOutcome.Returned -> {
                                /*
                                 * ── A FAILED DELEGATION IS A FAILED OBSERVATION ──
                                 *
                                 * Not a stop. §2 says an agent is a callable exactly
                                 * like a tool, and a failed tool call does not fail
                                 * the step — it records an unsuccessful observation
                                 * and the loop continues. The supervisor can try a
                                 * different worker, reformulate the contract, or
                                 * produce a partial FINAL that states what it could
                                 * not get; all three beat a hard stop.
                                 *
                                 * Nothing is unguarded by that choice. HANDOFF_LOOP
                                 * catches the same request going down the same edge,
                                 * and the budget tree debits the parent for
                                 * everything its children spend — so a supervisor
                                 * burning its budget on failed delegations hits
                                 * BUDGET_EXCEEDED on its own account. That second one
                                 * matters because the asymmetry is real: a failed
                                 * tool call is one HTTP request, a failed child is a
                                 * whole brain loop.
                                 */
                                state.addObservation(AgentObservation(
                                    iterationNumber = state.iteration,
                                    actionType = action.type.name,
                                    toolId = action.targetAgentId,
                                    sanitizedSummary = outcome.summary,
                                    success = outcome.success,
                                    payload = outcome.payload,
                                ))
                                state.addMemory("delegation_${state.iteration}", outcome.summary)
                                emitEvent(config, RunEventStore.EventType.AGENT_OBSERVATION_RECORDED,
                                    "running", outcome.summary.take(300))
                                persistIterationComplete(iterationId, iterSpan,
                                    if (outcome.success) "completed" else "failed",
                                    action, outcome.summary, budget, budgetMark,
                                    observationSuccess = outcome.success)

                                /*
                                 * HANDOFF is a tail call: control transferred, and
                                 * this agent is done. The child's output becomes the
                                 * step's output, and the parent's activation ends
                                 * `handed_off` — neither succeeded nor failed, because
                                 * a router that correctly routed did its job.
                                 */
                                if (action.type == AgentAction.ActionType.HANDOFF && outcome.success) {
                                    state.finalOutput = outcome.output
                                    state.stopReason = AgentLoopState.StopReason.FINAL_OUTPUT
                                    handedOff = true
                                }
                            }
                        }
                    }

                    AgentAction.ActionType.FINAL -> {
                        if (validateFinalOutput(action.finalOutput, config)) {
                            state.finalOutput = action.finalOutput
                            state.stopReason  = AgentLoopState.StopReason.FINAL_OUTPUT
                            emitEvent(config, RunEventStore.EventType.AGENT_FINAL_OUTPUT_CREATED, "running",
                                "Final output ready — ${action.finalOutput.keys.take(5).joinToString()}")
                            persistIterationComplete(iterationId, iterSpan, "completed", action, "Final output produced", budget, budgetMark)
                        } else {
                            emitEvent(config, RunEventStore.EventType.AGENT_OUTPUT_SCHEMA_INVALID, "running",
                                "Final output failed schema validation")
                            persistIterationComplete(iterationId, iterSpan, "failed", action, "Schema invalid", budget, budgetMark)
                            state.stopReason = AgentLoopState.StopReason.SCHEMA_INVALID
                            retryable = false
                            failureReason = "The agent's final output did not match the required output " +
                                "schema. It returned: ${action.finalOutput.keys.take(8).joinToString().ifBlank { "no fields" }}"
                        }
                    }

                    AgentAction.ActionType.ASK_APPROVAL -> {
                        /*
                         * ── ASKING FOR A PERSON IS NOT FAILING ───────────────────
                         *
                         * This used to set APPROVAL_REQUESTED and stop, and the caller
                         * turned every non-FINAL stop into NodeResult.Failed — so an
                         * agent that correctly paused for a human produced a failed step,
                         * a failed run, and no approval anywhere for anyone to decide.
                         * The one action whose whole purpose is to wait was the one that
                         * could not.
                         *
                         * The gate is keyed on (runId, stepId), exactly as the DB_WRITE
                         * gate is. That matters because the agent step re-executes from
                         * iteration 1 when the run resumes: the second time through, this
                         * finds APPROVED and the loop carries on instead of asking again,
                         * which is what would otherwise deadlock a resumed run.
                         *
                         * One consequence of that key, stated because it is a real limit:
                         * an agent gets ONE approval per step. A second ASK_APPROVAL in
                         * the same step sees the first decision. A per-question gate would
                         * need a key that survives re-execution, and iteration numbers do
                         * not.
                         */
                        when (val gate = resolveApprovalGate(config, sanitizedReason)) {
                            is ApprovalGate.Granted -> {
                                val summary = "Approval granted${gate.by?.let { " by $it" } ?: ""} — continuing."
                                state.addObservation(AgentObservation(
                                    state.iteration, "ASK_APPROVAL", sanitizedSummary = summary))
                                state.addMemory("approval_${state.iteration}", summary)
                                emitEvent(config, RunEventStore.EventType.APPROVAL_APPROVED, "running", summary)
                                persistIterationComplete(iterationId, iterSpan, "completed", action, summary, budget, budgetMark)
                                /* No stopReason: the loop keeps its remaining iterations
                                   and the model sees the grant in its observations. */
                            }

                            is ApprovalGate.Rejected -> {
                                state.stopReason = AgentLoopState.StopReason.AGENT_FAILED
                                retryable = false
                                failureReason = "A reviewer rejected this step" +
                                    (gate.by?.let { " (decided by $it)" } ?: "") +
                                    ". The agent asked: $sanitizedReason"
                                emitEvent(config, RunEventStore.EventType.APPROVAL_REJECTED, "failed",
                                    failureReason!!)
                                persistIterationComplete(iterationId, iterSpan, "failed", action, failureReason, budget, budgetMark)
                            }

                            is ApprovalGate.Pending -> {
                                state.stopReason = AgentLoopState.StopReason.APPROVAL_REQUESTED
                                /* Waiting on a person. Asking again immediately is not waiting. */
                                retryable = false
                                approvalId      = gate.approvalId
                                approvalMessage = gate.message
                                emitEvent(config, RunEventStore.EventType.AGENT_APPROVAL_REQUESTED,
                                    "waiting_for_approval",
                                    "Agent requested human approval: $sanitizedReason")
                                persistIterationComplete(iterationId, iterSpan, "completed", action, sanitizedReason, budget, budgetMark)
                            }

                            is ApprovalGate.Unavailable -> {
                                state.stopReason = AgentLoopState.StopReason.AGENT_FAILED
                                retryable = false
                                failureReason = "The agent asked for human approval, but no approval could " +
                                    "be created: ${gate.why}. The agent asked: $sanitizedReason"
                                emitEvent(config, RunEventStore.EventType.AGENT_FAILED, "failed", failureReason!!)
                                persistIterationComplete(iterationId, iterSpan, "failed", action, failureReason, budget, budgetMark)
                            }
                        }
                    }

                    AgentAction.ActionType.FAIL -> {
                        state.stopReason = AgentLoopState.StopReason.AGENT_FAILED
                        /* The agent considered the task and declined it. That is an
                           answer, not an outage. */
                        retryable = false
                        /* `sanitizeReasoningSummary` returns "" for a null or blank input, never
                           null, so the elvis that used to stand here could not fire: an agent that
                           chose FAIL without filling in `failReason` produced an empty reason, and
                           the empty reason then travelled all the way to the run detail screen.
                           Fall back through the fields the model actually filled in. */
                        val reason = safetyGuard.sanitizeReasoningSummary(action.failReason)
                            .ifBlank { sanitizedReason }
                        /* THE AGENT SAID WHY. RECORD IT.
                           This is the one stop reason where the cause is stated outright, and it
                           was the one that lost it: `failureReason` stayed null, so RunResult fell
                           through to its observation fallback, found nothing failed (the agent had
                           only THOUGHT before giving up), and AgentNodeExecutor reported
                           "did not produce a final output (stopReason=AGENT_FAILED)" — the model's
                           own explanation discarded one frame above the screen that needed it. */
                        failureReason = if (reason.isNotBlank())
                            "The agent stopped and reported: $reason"
                        else null
                        emitEvent(config, RunEventStore.EventType.AGENT_FAILED, "failed",
                            "Agent reported failure: ${reason.ifBlank { "no reason given" }}")
                        persistIterationComplete(iterationId, iterSpan, "failed", action, reason, budget, budgetMark)
                    }

                    AgentAction.ActionType.WAIT -> {
                        /*
                         * ── THE AGENT CHOOSES; THE RUNTIME VALIDATES ─────────
                         *
                         * Invariant 1, applied to a new action. The model names a
                         * signal and a duration; neither is trusted. A blank name
                         * is a malformed action and becomes a failure the model can
                         * read, and the duration is CLAMPED by `WaitStore.open`
                         * rather than checked — a clamp cannot be forgotten by the
                         * next caller, and a model asking to wait a year gets the
                         * platform maximum and is told so.
                         *
                         * The wait is keyed on (run, stepId, attemptGroup) like
                         * every other durable key, so the agent gets ONE wait per
                         * step — the same limit ASK_APPROVAL has, for the same
                         * reason: a per-question key would need something that
                         * survives re-execution, and iteration numbers do not.
                         */
                        val signalName = action.waitFor?.trim()?.take(200).orEmpty()
                        if (!AgentPromptBuilder.agentWaitEnabled()) {
                            /*
                             * The flag is off, so this deployment does not offer WAIT
                             * and the prompt never described it. A model emitting it
                             * anyway is emitting an action the runtime will not
                             * execute — which is the ordinary invalid-action path,
                             * not a special case. Refusing here rather than only
                             * omitting it from the prompt is what makes the flag a
                             * real off switch: invariant 1 says the runtime decides,
                             * so the runtime is where "off" has to be enforced.
                             */
                            state.stopReason = AgentLoopState.StopReason.AGENT_FAILED
                            retryable = false
                            failureReason = "The agent asked to wait, but waiting is not enabled " +
                                "for this deployment. Set AGENT_WAIT_ACTION_ENABLED=true to allow it."
                            emitEvent(config, RunEventStore.EventType.AGENT_INVALID_ACTION, "failed",
                                failureReason!!)
                            persistIterationComplete(iterationId, iterSpan, "failed", action,
                                failureReason, budget, budgetMark)
                        } else if (signalName.isBlank()) {
                            state.stopReason = AgentLoopState.StopReason.AGENT_FAILED
                            retryable = false
                            failureReason = "The agent asked to wait but named no signal to wait " +
                                "for. A WAIT must say what would wake it."
                            emitEvent(config, RunEventStore.EventType.AGENT_INVALID_ACTION, "failed",
                                failureReason!!)
                            persistIterationComplete(iterationId, iterSpan, "failed", action,
                                failureReason, budget, budgetMark)
                        } else when (val opened = openAgentWait(config, runtimeCtx, signalName,
                            action.waitSeconds, sanitizedReason)) {
                            is AgentWaitOutcome.Parked -> {
                                state.stopReason = AgentLoopState.StopReason.WAITING
                                retryable = false
                                pendingWait = opened.wait
                                state.addObservation(AgentObservation(
                                    state.iteration, "WAIT",
                                    sanitizedSummary = "Waiting for '$signalName'. " +
                                        "The run is parked and will resume when it arrives."))
                                emitEvent(config, RunEventStore.EventType.RUN_WAIT_STARTED,
                                    "waiting_for_event",
                                    "Agent is waiting for '$signalName': $sanitizedReason")
                                persistIterationComplete(iterationId, iterSpan, "completed", action,
                                    sanitizedReason, budget, budgetMark)
                            }

                            /*
                             * The signal already arrived — between the agent deciding
                             * to wait and the wait being opened, or on a resume where
                             * this step re-executes after being woken. Parking would
                             * be a deadlock: nothing else is coming.
                             */
                            is AgentWaitOutcome.AlreadyArrived -> {
                                state.addObservation(AgentObservation(
                                    state.iteration, "WAIT",
                                    sanitizedSummary = "Signal '$signalName' had already arrived: " +
                                        opened.summary))
                                state.addMemory("signal_$signalName", opened.summary)
                                emitEvent(config, RunEventStore.EventType.SIGNAL_DELIVERED, "running",
                                    "Signal '$signalName' delivered to the agent without parking.")
                                persistIterationComplete(iterationId, iterSpan, "completed", action,
                                    sanitizedReason, budget, budgetMark)
                            }

                            is AgentWaitOutcome.Unavailable -> {
                                state.stopReason = AgentLoopState.StopReason.AGENT_FAILED
                                retryable = false
                                failureReason = "The agent asked to wait for '$signalName', but the " +
                                    "wait could not be created: ${opened.why}"
                                emitEvent(config, RunEventStore.EventType.AGENT_FAILED, "failed",
                                    failureReason!!)
                                persistIterationComplete(iterationId, iterSpan, "failed", action,
                                    failureReason, budget, budgetMark)
                            }
                        }
                    }
                }

                /* A backstop, not the normal path: every branch above finishes its
                   iteration through persistIterationComplete, which closes the span
                   with the status it wrote to the row. This catches a branch that
                   ends an iteration without persisting one — an unfinished span is
                   invisible in a waterfall and silently drops its children's
                   self-time. */
                iterSpan?.close(if (state.stopReason == null) "ok" else "error")

                // Check if max iterations reached after this iteration
                if (!state.isDone && state.iteration >= config.maxIterations) {
                    state.stopReason = AgentLoopState.StopReason.MAX_ITERATIONS
                    /* It had its full iteration budget and did not converge; a retry
                       hands it the same budget and the same starting state. */
                    retryable = false
                    emitEvent(config, RunEventStore.EventType.AGENT_MAX_ITERATIONS_REACHED, "failed",
                        "Max iterations reached (${config.maxIterations})")
                }
            }
        } catch (e: Exception) {
            log.error("[brain] unexpected error runId={}: {}", config.runId, e.message)
            if (state.stopReason == null) state.stopReason = AgentLoopState.StopReason.ERROR
            failureReason = e.message?.take(300) ?: e.javaClass.simpleName
            emitEvent(config, RunEventStore.EventType.AGENT_FAILED, "failed", "Agent error: ${e.message?.take(200)}")
        }

        /* The loop is over however it got here. Close-once, so this fires only for an
           iteration that was still open — a throw out of the middle of one. The
           binding goes back to the parent either way: leaving this step's node id
           pointing at a closed iteration span would give the NEXT thing that looks it
           up a parent that has already ended. */
        openIteration?.close("error")
        tracer?.bindNode(config.stepId, loopParentSpan)

        // Persist memory entries
        memoryStore.persistAll(config, state)

        val failedToolCalls = state.observations
            .filter { it.actionType == "CALL_TOOL" && !it.success }
            .map { it.sanitizedSummary }

        /* A pause is not an outcome yet. Reporting AGENT_COMPLETED status=failed for a
           run parked on a human made the timeline say the agent had failed while the
           approval sat waiting for someone to decide it. */
        val waitingForApproval = state.stopReason == AgentLoopState.StopReason.APPROVAL_REQUESTED
        val finalStatus = when {
            state.stopReason == AgentLoopState.StopReason.FINAL_OUTPUT -> "succeeded"
            waitingForApproval -> "waiting_for_approval"
            else -> "failed"
        }

        /* A "succeeded" that had failed tool calls is the case that has repeatedly
           looked clean while nothing happened. Say it on the event the timeline leads
           with, rather than leaving it to one observation further up. */
        val toolNote = if (failedToolCalls.isNotEmpty())
            " — ${failedToolCalls.size} tool call(s) FAILED: ${failedToolCalls.last().take(160)}"
        else ""

        emitEvent(config, RunEventStore.EventType.AGENT_COMPLETED,
            if (finalStatus == "succeeded" && failedToolCalls.isNotEmpty()) "warning" else finalStatus,
            if (waitingForApproval)
                "Agent paused for approval after ${state.iteration} iteration(s) — waiting on a decision"
            else
                "Agent finished — stopReason=${state.stopReason} iterations=${state.iteration}$toolNote")

        return RunResult(
            finalOutput        = state.finalOutput,
            stopReason         = state.stopReason ?: AgentLoopState.StopReason.ERROR,
            iterationsUsed     = state.iteration,
            tokensUsed         = budget.tokensUsed,
            estimatedCostCents = budget.estimatedCostCents,
            observations       = state.observations.toList(),
            failedToolCalls    = failedToolCalls,
            /* No explicit reason recorded? The last unsuccessful observation is the
               next best evidence — for a loop that ran out of iterations while a
               tool kept failing, it is the actual answer. Failing that, name the stop
               reason in words: every path out of this loop that is not FINAL_OUTPUT
               now carries SOMETHING a person can read, because the alternative is the
               caller printing "did not produce a final output" and the run detail
               screen leading with a sentence that identifies nothing. */
            failureReason      = if (state.stopReason == AgentLoopState.StopReason.FINAL_OUTPUT ||
                                     waitingForApproval) null
                                 else failureReason
                                     ?: state.observations.lastOrNull { !it.success }?.sanitizedSummary
                                     ?: describeStop(state.stopReason, config),
            retryable          = retryable,
            approvalId         = approvalId,
            wait               = pendingWait,
            approvalMessage    = approvalMessage,
            handedOff          = handedOff,
            yieldedReason      = yieldedReason,
            skillAttributes    = skillAttributes,
        )
    }

    /**
     * Take delivery of any guidance a person has sent, and put it in context.
     *
     * ── A SIGNAL PLUS A CONTEXT WRITE, AND NOTHING ELSE ────────────────
     * Everything durable here already exists: `run_signals` stores it in order,
     * deduplicated and workspace-scoped, and the rate limit that stops an
     * unbounded signal stream from starving one run covers this too. What is new
     * is one read at the iteration boundary and one write into [AgentLoopState].
     * A separate "guidance" table with its own delivery semantics would be a
     * second signal system, and only one of them would be tested.
     *
     * ── WHY THE AGENT DOES NOT HAVE TO BE WAITING ───────────────────
     * `openAgentWait` reads signals too, but only the one the model asked for,
     * and only when it chose to stop. The case this exists for is the opposite:
     * an agent working happily down the wrong path, and an engineer who can see
     * it. Redirecting that agent must not require it to have predicted that it
     * would need redirecting.
     *
     * Consumed as it is read, so the same instruction is never delivered twice —
     * an agent told the same thing at four consecutive iterations reads it as
     * four separate insistences.
     */
    private fun drainGuidance(
        config: AgentBrainConfig,
        runtimeCtx: RuntimeContext,
        state: AgentLoopState,
    ) {
        val signals = signalStore ?: return
        val pending = runCatching { signals.pending(runtimeCtx.runId) }.getOrElse {
            /* Never fatal. Guidance not arriving is a degraded run; a run that
               dies because a guidance read failed is an outage. */
            log.warn("[brain] could not read guidance [run={}]: {}", runtimeCtx.runId, it.message)
            return
        }

        val guidance = pending.filter { isGuidanceSignal(it.name) }
        if (guidance.isEmpty()) return

        for (signal in guidance.take(AgentLoopState.MAX_GUIDANCE)) {
            val text = guidanceTextOf(signal) ?: continue
            state.addGuidance(AgentLoopState.Guidance(
                iterationNumber = state.iteration,
                text = text,
                from = signal.sentBy,
            ))
            emitEvent(config, RunEventStore.EventType.AGENT_GUIDANCE_RECEIVED, "running",
                "Guidance received at iteration ${state.iteration}: ${text.take(160)}")
            log.info("[brain] guidance at iteration {} [run={}, step={}, chars={}]",
                state.iteration, runtimeCtx.runId, config.stepId, text.length)
        }

        /* Consumed even when the text was unusable, so a malformed payload is not
           re-read at every iteration for the rest of the run. */
        runCatching { signals.consume(guidance.map { it.id }, waitId = null) }
            .onFailure { log.warn("[brain] guidance consume failed: {}", it.message) }
    }

    /** `guidance`, or anything under `guidance:` — so it can be addressed per agent. */
    private fun isGuidanceSignal(name: String): Boolean =
        name == GUIDANCE_SIGNAL || name.startsWith("$GUIDANCE_SIGNAL:")

    /**
     * The instruction inside a guidance signal, sanitized and capped.
     *
     * Accepts `{"text": "..."}`, `{"guidance": "..."}` or `{"message": "..."}`
     * because all three are what somebody types first, and a signal whose
     * payload shape was almost right is worse than one that was rejected.
     */
    private fun guidanceTextOf(signal: com.vectorbea.worker.durable.wait.SignalStore.Signal): String? {
        val raw = runCatching {
            val tree = mapper.readTree(signal.payloadJson)
            listOf("text", "guidance", "message", "instruction")
                .firstNotNullOfOrNull { field ->
                    tree.get(field)?.takeIf { it.isTextual }?.asText()
                }
        }.getOrNull() ?: return null

        val trimmed = raw.trim()
        if (trimmed.isEmpty()) return null
        return sanitizeGuidance(trimmed).take(MAX_GUIDANCE_CHARS)
    }

    /**
     * Flatten guidance to one paragraph of plain text.
     *
     * Newlines and the model's own action-format markers are collapsed, because
     * this text is concatenated into a prompt whose sections are separated by
     * blank lines and whose contract is JSON: a caller who sends a payload
     * containing what looks like a section heading, or a complete action object,
     * should not be able to end the guidance section early and start something
     * that reads as though the platform wrote it.
     */
    private fun sanitizeGuidance(text: String): String =
        text.replace(Regex("[\\r\\n]+"), " ")
            .replace(Regex("\\s{2,}"), " ")
            .trim()

    /** What happened when the agent asked to wait. */
    private sealed class AgentWaitOutcome {
        data class Parked(val wait: NodeResult.Waiting) : AgentWaitOutcome()

        /** The signal was already there. Parking would deadlock. */
        data class AlreadyArrived(val summary: String) : AgentWaitOutcome()

        data class Unavailable(val why: String) : AgentWaitOutcome()
    }

    /**
     * Open — or find — this step's wait.
     *
     * ── THE ORDER OF THE TWO CHECKS IS THE WHOLE CORRECTNESS ────────────────
     * Signals are read BEFORE the wait is opened, and that order is not
     * arbitrary. A signal can arrive between the model deciding to wait and this
     * running, and a wait opened first would park a run for a signal that has
     * already been delivered — a deadlock lasting until the timeout, with the
     * answer sitting unconsumed in the table the whole time.
     *
     * It is also what makes the resumed step correct. After the run is woken,
     * this step re-executes from iteration 1, reaches WAIT again, finds the
     * signal it was woken by, and carries on — rather than opening a second wait
     * and parking again, which would be a run that never finishes however many
     * signals it is sent.
     */
    private fun openAgentWait(
        config: AgentBrainConfig,
        runtimeCtx: RuntimeContext,
        signalName: String,
        requestedSeconds: Long?,
        reason: String,
    ): AgentWaitOutcome {
        val waits = waitStore
            ?: return AgentWaitOutcome.Unavailable("this worker has no database connection")

        signalStore?.pending(runtimeCtx.runId)
            ?.firstOrNull { it.name == signalName }
            ?.let { signal ->
                signalStore.consume(listOf(signal.id), waitId = null)
                val payload = runCatching { mapper.writeValueAsString(signal.asObservation(mapper)) }
                    .getOrDefault("{}")
                return AgentWaitOutcome.AlreadyArrived(payload.take(MAX_TOOL_PAYLOAD_CHARS))
            }

        return try {
            val opened = waits.open(
                com.vectorbea.worker.durable.wait.WaitStore.OpenRequest(
                    workspaceId = config.workspaceId,
                    environmentId = config.environmentId,
                    runId = runtimeCtx.runId,
                    workflowId = runtimeCtx.workflowId,
                    nodeId = config.stepId,
                    attemptGroup = runtimeCtx.attemptGroup,
                    kind = com.vectorbea.worker.durable.wait.WaitKind.AGENT_WAIT,
                    label = "Agent '${config.agentName}' is waiting for '$signalName'",
                    signalName = signalName,
                    /* Clamped by the store. A model asking for a year gets the
                       platform maximum; a model asking for nothing gets the
                       default. Neither is trusted, and neither has to be checked
                       here — which is the point of clamping at the boundary. */
                    timeoutMs = requestedSeconds?.times(1_000),
                    /* Sanitized: the model's own one-line reason, already through
                       `sanitizeReasoningSummary`. Nothing else, and never a tool
                       result — invariant 4 applies to this store like any other. */
                    metadata = mapOf("reason" to reason.take(500), "agent" to config.agentName),
                )
            )
            AgentWaitOutcome.Parked(
                NodeResult.Waiting(
                    waitId = opened.wait.id.toString(),
                    kind = opened.wait.kind.wire,
                    label = opened.wait.label ?: "Waiting for '$signalName'",
                    timeoutAt = opened.wait.timeoutAt,
                )
            )
        } catch (e: Exception) {
            log.error("[brain] could not open agent wait [run={}, signal={}]: {}",
                runtimeCtx.runId, signalName, e.message)
            AgentWaitOutcome.Unavailable(e.message?.take(200) ?: e.javaClass.simpleName)
        }
    }

    /** What the approval gate says about this step, right now. */
    private sealed class ApprovalGate {
        data class Granted(val by: String?) : ApprovalGate()
        data class Rejected(val by: String?) : ApprovalGate()
        data class Pending(val approvalId: String, val message: String) : ApprovalGate()
        data class Unavailable(val why: String) : ApprovalGate()
    }

    /**
     * Find or open this step's approval.
     *
     * Deliberately the same shape as `DbWriteNodeExecutor.handleApprovalGate`: look up
     * by (runId, nodeId) first, create only when nothing is there. Re-execution after a
     * decision must find the decision, not open a second gate — otherwise approving a
     * run produces another pending approval and the run never moves.
     */
    private fun resolveApprovalGate(config: AgentBrainConfig, reason: String): ApprovalGate {
        val store = approvalStore
            ?: return ApprovalGate.Unavailable("this worker has no database connection")

        val message = "Agent '${config.agentName}' requested approval to continue. $reason"
            .take(500)

        return try {
            when (val existing = store.findApproval(config.runId, config.stepId)) {
                null -> ApprovalGate.Pending(
                    approvalId = store.createPendingApproval(
                        runId          = config.runId,
                        workspaceId    = config.workspaceId,
                        environmentId  = config.environmentId,
                        nodeId         = config.stepId,
                        message        = message,
                        approvers      = emptyList(),
                        /* Input KEYS only reach metadata_json; see createPendingApproval. */
                        resolvedInputs = config.resolvedInput.filterValues { it != null }
                            .mapValues { it.value!! },
                        gate = com.vectorbea.worker.runtime.checkpoint.ApprovalGateConfig(
                            title = "Agent approval: ${config.agentName}",
                        ),
                    ),
                    message = message,
                )
                /* The shared rule — see decideOnApproval in ApprovalStore.kt. The tool
                   gate reads the same row through the same function, so the two cannot
                   disagree about whether this run is approved. */
                else -> when (com.vectorbea.worker.runtime.checkpoint.decideOnApproval(existing.status)) {
                    com.vectorbea.worker.runtime.checkpoint.ApprovalDecision.GRANT ->
                        ApprovalGate.Granted(existing.resolvedBy)
                    com.vectorbea.worker.runtime.checkpoint.ApprovalDecision.REJECT ->
                        ApprovalGate.Rejected(existing.resolvedBy)
                    com.vectorbea.worker.runtime.checkpoint.ApprovalDecision.WAIT ->
                        ApprovalGate.Pending(existing.id.toString(), existing.message ?: message)
                }
            }
        } catch (e: Exception) {
            log.error("[brain] approval gate failed runId={} step={}: {}",
                config.runId, config.stepId, e.message)
            ApprovalGate.Unavailable(e.message?.take(200) ?: e.javaClass.simpleName)
        }
    }

    /**
     * A readable sentence for a stop reason, used only when nothing more specific was
     * recorded. A stop reason is a category — "AGENT_FAILED", "MAX_ITERATIONS" — and a
     * category shown on its own tells whoever opened the run nothing about their run.
     */
    private fun describeStop(reason: AgentLoopState.StopReason?, config: AgentBrainConfig): String = when (reason) {
        AgentLoopState.StopReason.MAX_ITERATIONS ->
            "The agent used all ${config.maxIterations} of its iterations without producing a final output. " +
            "Raise the iteration limit or narrow the task."
        AgentLoopState.StopReason.BUDGET_EXCEEDED ->
            "The agent ran out of its token, cost or tool-call budget before finishing."
        AgentLoopState.StopReason.AGENT_FAILED ->
            "The agent reported it could not complete the task but gave no reason."
        AgentLoopState.StopReason.APPROVAL_REQUESTED ->
            "The agent asked for human approval before it could continue."
        AgentLoopState.StopReason.WAITING ->
            "The agent is waiting for an external event. The run is parked and will " +
            "resume when it arrives, or when the wait's deadline passes."
        AgentLoopState.StopReason.CANCELLED ->
            "The run was cancelled, so the agent stopped between iterations. Work " +
            "already committed stands; nothing further was attempted."
        AgentLoopState.StopReason.TOOL_NOT_ALLOWED ->
            "The agent tried to call a tool that is not in its allowed tool list."
        AgentLoopState.StopReason.SCHEMA_INVALID ->
            "The agent's final output did not match the required output schema."
        AgentLoopState.StopReason.AGENT_NOT_IN_ROSTER ->
            "The agent tried to delegate to an agent that is not on its team roster. " +
            "Add that agent to this agent's roster, or remove it from the instructions."
        AgentLoopState.StopReason.MAX_DEPTH_EXCEEDED ->
            "The delegation chain went deeper than this team allows. An agent delegated " +
            "to an agent that delegated again, past the depth limit."
        AgentLoopState.StopReason.HANDOFF_LOOP ->
            "The same request was delegated along the same edge repeatedly without the " +
            "answer changing, so the agent stopped rather than spending the rest of its " +
            "budget reproving it."
        AgentLoopState.StopReason.CHILD_FAILED ->
            "A delegated agent failed and this agent could not continue without its result."
        AgentLoopState.StopReason.JOIN_DEADLOCK ->
            "The agent was waiting on delegated work that could never finish."
        AgentLoopState.StopReason.TEAM_BUDGET_EXCEEDED ->
            "The agents working on this step used the whole budget allowed for the group, " +
            "which is a separate limit from any single agent's own."
        AgentLoopState.StopReason.ERROR, null ->
            "The agent stopped with an error that was not recorded."
        AgentLoopState.StopReason.FINAL_OUTPUT -> ""
    }

    /**
     * The roster, as the prompt states it.
     *
     * Empty whenever delegation is off or the agent has no grant, which is what
     * makes the prompt omit the actions AND the list together. Read fresh on every
     * iteration rather than pinned on the config, for the same reason a tool grant
     * is: a roster is POLICY, and an operator who removes an agent from a roster
     * mid-run is making a decision that must take effect.
     */
    private fun loadRoster(config: AgentBrainConfig): List<AgentPromptBuilder.AgentDescriptor> {
        if (!delegationEnabled || config.canDelegateTo.isEmpty()) return emptyList()
        val ds = dataSource ?: return emptyList()
        return runCatching {
            ds.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT id, name, COALESCE(description, '') AS description
                         FROM agents
                        WHERE workspace_id = ? AND status = 'active' AND id = ANY(?)
                        ORDER BY name"""
                ).use { st ->
                    st.setObject(1, config.workspaceId)
                    st.setArray(2, conn.createArrayOf("uuid", config.canDelegateTo.toTypedArray()))
                    st.executeQuery().use { rs ->
                        val out = mutableListOf<AgentPromptBuilder.AgentDescriptor>()
                        while (rs.next()) out += AgentPromptBuilder.AgentDescriptor(
                            id = rs.getString("id"),
                            name = rs.getString("name"),
                            description = rs.getString("description"),
                        )
                        out
                    }
                }
            }
        }.getOrElse {
            log.warn("[brain] roster load failed for {}: {}", config.agentId, it.message)
            /* An empty roster in the PROMPT, not an empty roster in the CHECK. The
               model is simply not offered delegation this iteration; the grant
               itself still lives on the config and is still enforced. */
            emptyList()
        }
    }

    // ── Delegation ───────────────────────────────────────────────────────────

    /** What a DELEGATE or HANDOFF produced, in the loop's vocabulary. */
    private sealed class DelegationOutcome {
        /** A guard or a grant said no, before anything was created. */
        data class Refused(
            val stopReason: AgentLoopState.StopReason,
            val reason: String,
        ) : DelegationOutcome()

        /** The child needs a person. The tick ends here. */
        data class Paused(val approvalId: String, val message: String) : DelegationOutcome()

        /**
         * The tick ended before the fan-out did.
         *
         * Nothing is wrong and no work is lost: the children that finished are
         * durable and terminal, and the re-execution reattaches to them. Distinct
         * from every other case here because it must NOT become a stop reason —
         * the run has not decided anything.
         */
        data class Yielded(val reason: String) : DelegationOutcome()

        /** The child ran. [success] false is an ordinary failed observation. */
        data class Returned(
            val success: Boolean,
            val summary: String,
            val payload: String?,
            val output: Map<String, Any> = emptyMap(),
        ) : DelegationOutcome()
    }

    /**
     * Dispatch one delegation.
     *
     * Deliberately the same shape as [executeTool]: build the contract, derive the
     * approval key, hand it to the executor that owns the boundary, and turn what
     * comes back into an observation. The executor does the validating, gating and
     * creating — this function's whole job is translation, which is why it is short
     * and why the two paths cannot drift apart.
     */
    private suspend fun executeDelegation(
        action: AgentAction,
        config: AgentBrainConfig,
        runtimeCtx: RuntimeContext,
        state: AgentLoopState,
    ): DelegationOutcome {
        /* A fan-out is N of the same call, joined. Split here and NOT lower down,
           so both shapes go through one `delegate` primitive rather than through
           two dispatch paths that have to be kept in step. */
        if (action.isBroadcast) return executeBroadcast(action, config, runtimeCtx, state)

        val target = runCatching { UUID.fromString(action.delegationTargets.first()) }.getOrNull()
            ?: return DelegationOutcome.Refused(
                AgentLoopState.StopReason.AGENT_NOT_IN_ROSTER,
                "The agent gave '${action.targetAgentId}' as a delegation target, which is not " +
                "a valid agent id.")

        val caller = agentCallExecutor
            ?: return DelegationOutcome.Refused(
                AgentLoopState.StopReason.ERROR,
                "Delegation is not available on this worker, so the agent could not hand this " +
                "task to $target.")

        val parentActivation = config.activationId
            ?: return DelegationOutcome.Refused(
                AgentLoopState.StopReason.ERROR,
                "This step is not running as an activation, so it cannot delegate. Delegation " +
                "requires AGENT_ACTIVATIONS_ENABLED.")

        val contract = buildContract(action, config, state)
        val kind = when {
            action.type == AgentAction.ActionType.HANDOFF -> HandoffStore.Kind.TRANSFER
            action.isBroadcast -> HandoffStore.Kind.BROADCAST
            else -> HandoffStore.Kind.DELEGATE
        }

        /*
         * ── THE HANDOFF SPAN, AND WHY IT IS THE CHILD'S PARENT ──────────────
         *
         * The span covers the WHOLE delegation: the guards, the gate and the
         * child's execution. Opening it here rather than around only the child's
         * run is what makes "this delegation took 40 seconds, 38 of them waiting
         * on a gate" answerable.
         *
         * It is bound to this step's node id, so the child's `activation` span —
         * which resolves its parent by that id, like every other span an executor
         * opens — nests inside it. That gives the constellation view a direct
         * edge-to-node mapping (handoff span → child activation span) instead of
         * one inferred by pairing timestamps.
         */
        val tracer = runtimeCtx.tracer
        val spanParent = tracer?.spanForNode(config.stepId)
        val handoffSpan = tracer?.open(
            kind = "handoff",
            name = "${action.type.name.lowercase()} → $target",
            parentSpanId = spanParent ?: tracer.tickSpanId,
        )
        if (handoffSpan != null) tracer.bindNode(config.stepId, handoffSpan)

        val result = try {
            caller.delegate(
            ctx = runtimeCtx,
            stepId = config.stepId,
            approvalNodeId = agentApprovalNodeId(config.stepId, target),
            parentActivationId = parentActivation,
            parentDepth = config.depth,
            rootActivationId = rootActivationOf(parentActivation),
            targetAgentId = target,
            contract = contract,
            reason = safetyGuard.sanitizeReasoningSummary(action.reasoningSummary),
            kind = kind,
            contextVersion = runCatching { contextStore?.currentWatermark(config.runId) }.getOrNull() ?: 0L,
            )
        } finally {
            /* Closed and unbound on every path, including a throw. A handoff span
               left open is invisible in the waterfall and silently swallows its
               child's self-time. */
            runCatching {
                tracer?.close(
                    handoffSpan, "handoff", "${action.type.name.lowercase()} → $target",
                    status = "ok", stepId = config.stepId,
                    attributesJson = mapper.writeValueAsString(mapOf(
                        "kind" to kind.name,
                        "target_agent_id" to target.toString(),
                        "contract_hash" to contract.hash().take(16),
                    )),
                )
                tracer?.bindNode(config.stepId, spanParent)
            }
        }

        result.exceptionOrNull()?.let { e ->
            val refusal = (e as? AgentCallExecutor.RefusedException)?.refusal
                ?: return DelegationOutcome.Refused(
                    AgentLoopState.StopReason.ERROR,
                    "The delegation to $target could not be carried out: ${e.message?.take(200)}")
            return DelegationOutcome.Refused(stopReasonOf(refusal.stopReason), refusal.reason)
        }

        return when (val outcome = result.getOrThrow()) {
            is AgentCallExecutor.ChildOutcome.Paused ->
                DelegationOutcome.Paused(outcome.approvalId, outcome.message)

            is AgentCallExecutor.ChildOutcome.Failed -> DelegationOutcome.Returned(
                success = false,
                summary = outcome.reason.take(MAX_TOOL_PAYLOAD_CHARS),
                payload = null,
            )

            is AgentCallExecutor.ChildOutcome.Completed -> {
                val rendered = runCatching { mapper.writeValueAsString(outcome.output) }
                    .getOrDefault(outcome.output.toString())
                DelegationOutcome.Returned(
                    success = true,
                    summary = "Agent returned ${outcome.output.size} field(s): " +
                        outcome.output.keys.take(8).joinToString().ifBlank { "none" },
                    /* The RESULT, not a description of it. Without the payload the
                       supervisor is told its worker succeeded and told the names of
                       the fields, and is then expected to summarise data it has never
                       been shown — the same bug the tool path had. */
                    payload = safetyGuard.sanitizeToolOutput(rendered, MAX_TOOL_PAYLOAD_CHARS),
                    output = outcome.output,
                )
            }
        }
    }

    /**
     * A fan-out, and its join.
     *
     * ── WHY THIS IS NOT A SCHEDULER ─────────────────────────────────────────
     * Children run one after another, inline, on this thread — the same
     * `delegate` primitive a single delegation uses, called N times. There is no
     * queue, no wait set and nothing to wake, so there is nothing here that a
     * resumed tick has to rebuild. `wait_any` "cancelling the rest" therefore
     * means the rest are never STARTED, which is strictly better than starting
     * and killing them: no tokens are spent on work whose answer is already in.
     *
     * The activations for those children are still CREATED and then cancelled, so
     * the fan-out's shape is visible in the trace — a join that shows two children
     * when the supervisor asked for five hides the most interesting thing about
     * the run.
     *
     * ── THE JOIN IS EVALUATED AFTER EVERY CHILD ─────────────────────────────
     * Not at the end. `wait_all` of five whose second child fails cannot succeed,
     * and running the other three costs three agent loops to reach a conclusion
     * already known. See [JoinEvaluator.Verdict.Impossible].
     */
    private suspend fun executeBroadcast(
        action: AgentAction,
        config: AgentBrainConfig,
        runtimeCtx: RuntimeContext,
        state: AgentLoopState,
    ): DelegationOutcome {
        val caller = agentCallExecutor
            ?: return DelegationOutcome.Refused(AgentLoopState.StopReason.ERROR,
                "Delegation is not available on this worker.")
        val parentActivation = config.activationId
            ?: return DelegationOutcome.Refused(AgentLoopState.StopReason.ERROR,
                "This step is not running as an activation, so it cannot fan out.")

        val targets = action.delegationTargets.mapNotNull {
            runCatching { UUID.fromString(it) }.getOrNull()
        }
        if (targets.isEmpty()) return DelegationOutcome.Refused(
            AgentLoopState.StopReason.AGENT_NOT_IN_ROSTER,
            "None of the broadcast targets is a valid agent id.")

        val join = teamPolicy?.joinPolicy ?: JoinPolicy.WaitAll
        val onFailure = teamPolicy?.onChildFailure ?: OnChildFailure.CONTINUE
        val contract = buildContract(action, config, state)

        /*
         * PREFLIGHT, before a single child exists. Discovering the ceiling after
         * three of eight children have run wastes the spend on all three; an
         * all-or-nothing refusal leaves the budget intact for a narrower plan.
         */
        budgetLedger?.let { l ->
            /*
             * ── THE PREFLIGHT ASKS A REAL QUESTION, NOT A TAUTOLOGY ─────────
             *
             * The obvious per-child figure is "an equal share of what is left",
             * and it makes the check INERT: `N × (available / N) <= available` is
             * true by construction, so the guard runs on every fan-out and refuses
             * none. A test caught this only because the fixture starved the parent
             * as well — with a healthy parent it would have passed silently
             * forever, which is the worst kind of guard.
             *
             * The question worth asking is whether each child would get enough to
             * DO anything. A child with a hundred tokens cannot make one model
             * call, so a fan-out that funds five of those has not been afforded —
             * it has been divided into five agents that will each fail with an
             * empty answer, at the cost of five activations.
             */
            val verdict = l.preflightFanOut(parentActivation, targets.size, MIN_VIABLE_CHILD)
            if (verdict is BudgetLedger.FanOutVerdict.Unaffordable) {
                /*
                 * ── TOLD, NOT STOPPED ────────────────────────────────────────
                 *
                 * A failed OBSERVATION, not a stop reason — the same choice
                 * `BudgetLedger.allocate` makes when it clamps rather than refuses.
                 * An agent told it cannot afford five workers can narrow to two, or
                 * answer with what it has; an agent stopped outright fails the run
                 * holding a completion margin it was never given the chance to
                 * spend, which is precisely what §8 held that margin back FOR.
                 *
                 * No child was created, so nothing was wasted discovering this.
                 */
                return DelegationOutcome.Returned(
                    success = false,
                    summary = "This team cannot afford to send work to ${targets.size} agents at " +
                        "once — it can afford ${verdict.affordableChildren}. Narrow the fan-out, " +
                        "answer with what you have, or raise the team's ${verdict.dimension} budget.",
                    payload = null,
                )
            }
        }

        /*
         * ── CAPACITY PREFLIGHT ─────────────────────────────────────────────
         *
         * The budget preflight above answers "can this team AFFORD N children".
         * It cannot answer "is there room to START them all now", because budget
         * is a TOTAL and a rate limit is a RATE. Twenty children can be entirely
         * affordable in tokens and still be twenty simultaneous requests in one
         * second, which is the single commonest way this product produced 429s.
         *
         * So the same question is asked of the bucket, and the answer is used
         * differently: budget refuses all-or-nothing because half a fan-out is
         * usually worth nothing, whereas capacity STAGGERS, because the children
         * that do not fit now will fit in a moment and the results are just as
         * good for having arrived a second apart.
         *
         * Nothing is reserved here. The reservation still happens per call in
         * `LlmNodeExecutor`; this only decides how fast to let them arrive, so a
         * stale answer costs a slightly wrong stagger and never a double-count.
         */
        val staggerMs: Long = run {
            val cap = capacity ?: return@run 0L
            val acct = accountOf(config) ?: return@run 0L
            val perChild = MIN_VIABLE_CHILD.tokens.coerceAtLeast(1L)
            val room = cap.headroomFor(acct.first, config.modelName, acct.second,
                targets.size, perChild)
            if (room >= targets.size) 0L else {
                /*
                 * Spread the ones that do not fit across the window it takes the
                 * bucket to refill for them, rather than firing them and letting
                 * each discover the limit independently. One RTT of stagger per
                 * child that did not fit, floored so a wide fan-out does not crawl
                 * and capped so it does not outlive the tick.
                 */
                val overflow = targets.size - room.coerceAtLeast(0)
                (overflow * FAN_OUT_STAGGER_PER_CHILD_MS)
                    .coerceIn(FAN_OUT_STAGGER_PER_CHILD_MS, MAX_FAN_OUT_STAGGER_MS) / targets.size
            }
        }
        if (staggerMs > 0) {
            log.info("[delegate] staggering {} children by {}ms each — capacity is short",
                targets.size, staggerMs)
        }

        /* One group id ties this broadcast's children together, so the debugger
           can draw the fan-out as one thing rather than N unrelated edges. */
        val joinGroupId = UUID.randomUUID()
        val outcomes = mutableListOf<JoinEvaluator.Outcome>()
        val results = mutableListOf<Pair<UUID, Map<String, Any>>>()
        val failures = mutableListOf<String>()
        var stopped = false
        var yielded = false
        var paused: DelegationOutcome.Paused? = null

        for ((index, target) in targets.withIndex()) {
            /*
             * ── STOP STARTING CHILDREN WHEN THE TICK IS SPENT ────────────────
             *
             * Checked between children and nowhere else: a child already running
             * is not interrupted, because killing an agent loop mid-flight throws
             * away tokens already paid for and leaves an activation in a state
             * nobody can interpret.
             *
             * Children already created are terminal and durable, so the resumed
             * execution reattaches to them and replays their recorded outputs — no
             * duplicate activations, and no repeated model calls. The ones not yet
             * started are simply started next tick.
             */
            if (!stopped && runtimeCtx.tickDeadlineAtMs != null &&
                System.currentTimeMillis() >= runtimeCtx.tickDeadlineAtMs) {
                yielded = true
                stopped = true
            }

            /* The stagger, applied BETWEEN starts and never before the first —
               delaying the first child would slow every fan-out to buy nothing.
               Jittered for the same reason every other delay here is: N brains
               staggering by an identical amount would still arrive in lockstep,
               one step later. */
            if (!stopped && index > 0 && staggerMs > 0) {
                delay(com.vectorbea.worker.net.ProviderThrottle.jitter(staggerMs))
            }

            if (stopped) {
                /* Cancel only what the JOIN made unnecessary. A child skipped
                   because the tick ran out is still wanted — cancelling it would
                   turn a yield into a silently narrower fan-out. */
                if (!yielded) {
                    caller.createAndCancel(runtimeCtx, config.stepId, parentActivation,
                        config.depth, rootActivationOf(parentActivation), target, contract,
                        joinGroupId, "the join was already satisfied")
                }
                continue
            }

            val r = caller.delegate(
                ctx = runtimeCtx,
                stepId = config.stepId,
                approvalNodeId = agentApprovalNodeId(config.stepId, target),
                parentActivationId = parentActivation,
                parentDepth = config.depth,
                rootActivationId = rootActivationOf(parentActivation),
                targetAgentId = target,
                contract = contract,
                reason = safetyGuard.sanitizeReasoningSummary(action.reasoningSummary),
                kind = HandoffStore.Kind.BROADCAST,
                contextVersion = runCatching { contextStore?.currentWatermark(config.runId) }
                    .getOrNull() ?: 0L,
                joinGroupId = joinGroupId,
            )

            val refusal = (r.exceptionOrNull() as? AgentCallExecutor.RefusedException)?.refusal
            when {
                refusal != null -> {
                    outcomes += JoinEvaluator.Outcome.FAILED
                    failures += refusal.reason
                }
                r.isFailure -> {
                    outcomes += JoinEvaluator.Outcome.FAILED
                    failures += r.exceptionOrNull()?.message?.take(200) ?: "unknown error"
                }
                else -> when (val o = r.getOrThrow()) {
                    is AgentCallExecutor.ChildOutcome.Paused -> {
                        outcomes += JoinEvaluator.Outcome.PAUSED
                        paused = DelegationOutcome.Paused(o.approvalId, o.message)
                    }
                    is AgentCallExecutor.ChildOutcome.Failed -> {
                        outcomes += JoinEvaluator.Outcome.FAILED
                        failures += o.reason
                    }
                    is AgentCallExecutor.ChildOutcome.Completed -> {
                        outcomes += JoinEvaluator.Outcome.SUCCEEDED
                        results += target to o.output
                    }
                }
            }

            when (JoinEvaluator.judge(outcomes, targets.size, join, onFailure)) {
                is JoinEvaluator.Verdict.Continue -> Unit
                is JoinEvaluator.Verdict.Satisfied -> stopped = true
                is JoinEvaluator.Verdict.Impossible -> stopped = true
                JoinEvaluator.Verdict.Paused -> {
                    /* A child is on a human. The tick ends; the rest are NOT
                       cancelled, because the resumed run will need them. */
                    return paused ?: DelegationOutcome.Paused("", "waiting for approval")
                }
            }
            if (index == targets.lastIndex) stopped = true
        }

        if (yielded) {
            /* Not an outcome. The tick ended mid-fan-out; the caller stands the run
               down and this node re-executes, reattaching to everything already
               finished. See DelegationOutcome.Yielded. */
            return DelegationOutcome.Yielded(
                "This team ran out of its execution tick after " +
                "${outcomes.size} of ${targets.size} agents; it will continue.")
        }

        val verdict = JoinEvaluator.judge(outcomes, targets.size, join, onFailure)
        val met = verdict is JoinEvaluator.Verdict.Satisfied

        if (!met && onFailure == OnChildFailure.FAIL_PARENT) {
            /*
             * THE ONE PLACE CHILD_FAILED IS CONSTRUCTED. It is reserved for a join
             * that genuinely cannot proceed — the operator asked for `fail_parent`,
             * or the arithmetic says the remaining children cannot make up the
             * shortfall. Under the default the failure is an observation and this
             * agent carries on, exactly as it does for one failed delegation.
             */
            return DelegationOutcome.Refused(
                AgentLoopState.StopReason.CHILD_FAILED,
                "This team needed ${join.required(targets.size)} of ${targets.size} agents to " +
                "succeed and got ${outcomes.count { it == JoinEvaluator.Outcome.SUCCEEDED }}. " +
                "First failure: ${failures.firstOrNull()?.take(200) ?: "unrecorded"}")
        }

        /*
         * SURVIVING SIBLINGS' OUTPUTS ARE RECORDED EITHER WAY. A join that failed
         * still did most of its work, and throwing away four good results because
         * a fifth agent failed is how a team costs five agent loops and produces
         * nothing a person can use.
         */
        val merged = results.associate { (id, out) -> id.toString() to out }
        val rendered = runCatching { mapper.writeValueAsString(merged) }.getOrDefault(merged.toString())
        val summary = buildString {
            append("Broadcast to ${targets.size} agent(s): ")
            append("${outcomes.count { it == JoinEvaluator.Outcome.SUCCEEDED }} succeeded, ")
            append("${outcomes.count { it == JoinEvaluator.Outcome.FAILED }} failed")
            if (failures.isNotEmpty()) append(". First failure: ${failures.first().take(200)}")
        }

        return DelegationOutcome.Returned(
            success = met,
            summary = summary,
            payload = safetyGuard.sanitizeToolOutput(rendered, MAX_TOOL_PAYLOAD_CHARS),
            output = merged.values.fold(emptyMap()) { acc, m -> acc + m },
        )
    }

    /**
     * The contract, from what the model wrote plus what the runtime knows.
     *
     * The model supplies the objective and the inputs. The runtime supplies the
     * BUDGET — carved from this agent's remainder, never from what the model asked
     * for — because a budget the model chooses is not a budget.
     */
    private fun buildContract(
        action: AgentAction,
        config: AgentBrainConfig,
        state: AgentLoopState,
    ): TaskContract {
        val raw = action.contract ?: emptyMap()
        @Suppress("UNCHECKED_CAST")
        val refs = (raw["contextRefs"] as? List<*>)?.mapNotNull {
            (it as? Map<String, Any?>)?.let(ContextRef::fromMap)
        } ?: emptyList()

        @Suppress("UNCHECKED_CAST")
        val schema = raw["outputSchema"] as? Map<String, Any?>

        return TaskContract(
            objective = (raw["objective"] as? String)?.takeIf { it.isNotBlank() }
                ?: safetyGuard.sanitizeReasoningSummary(action.reasoningSummary)
                    .ifBlank { config.taskInstruction ?: "Complete the delegated task." },
            inputs = (raw["inputs"] as? Map<*, *>)?.entries
                ?.associate { (k, v) -> k.toString() to v } ?: emptyMap(),
            contextRefs = refs,
            outputSchema = schema,
            successCriteria = raw["successCriteria"] as? String,
            constraints = (raw["constraints"] as? List<*>)?.map { it.toString() } ?: emptyList(),
            /* What is actually left, not what was asked for. */
            budget = childBudget(config, state),
        )
    }

    /**
     * What a child may spend.
     *
     * From the ledger when there is one, so the tree is genuinely bounded. Without
     * one — a single-agent worker with no budget tree — a proportional slice of
     * this agent's own remaining budget, which is a bound rather than a guarantee
     * but is strictly better than handing a child a fresh full allowance.
     */
    private fun childBudget(config: AgentBrainConfig, state: AgentLoopState): BudgetVector {
        val ledger = budgetLedger
        val parent = config.activationId
        if (ledger != null && parent != null) {
            ledger.remaining(parent)?.let { return it.availableToChildren }
        }
        val b = state.budget
        return BudgetVector(
            iterations = (b.maxIterations - b.iterationsUsed).coerceAtLeast(0),
            toolCalls = (b.maxToolCalls - b.toolCallsUsed).coerceAtLeast(0),
            tokens = (b.maxTotalTokens - b.tokensUsed).coerceAtLeast(0).toLong(),
            costMicroCents = BudgetVector.ofCents(
                (b.maxCostCents - b.estimatedCostCents).coerceAtLeast(0.0)),
        )
    }

    /** The subtree root, for a child's `root_activation_id`. */
    private fun rootActivationOf(activationId: UUID): UUID =
        runCatching { activationStore?.lineageOf(activationId)?.lastOrNull() }.getOrNull() ?: activationId

    /**
     * A refusal's stop-reason NAME back into the enum.
     *
     * A string across the boundary rather than the enum itself, because
     * `AgentCallExecutor` lives in the executor package and must not depend on the
     * brain's model — the dependency already runs the other way. Unrecognised maps
     * to ERROR, which is the honest answer for a name nobody defined.
     */
    private fun stopReasonOf(name: String): AgentLoopState.StopReason =
        AgentLoopState.StopReason.entries.firstOrNull { it.name == name }
            ?: AgentLoopState.StopReason.ERROR

    // ── LLM calling ──────────────────────────────────────────────────────────

    private data class LlmCallResult(val rawContent: String, val tokensUsed: Int, val estimatedCostCents: Double)

    private suspend fun callLlm(
        config: AgentBrainConfig,
        systemPrompt: String,
        userPrompt: String,
        runtimeCtx: RuntimeContext,
    ): LlmCallResult {
        /* The synthetic node carries the AGENT's step id, not a made-up one, so the
           LLM_CALL_* events the executor emits attach to the step the timeline
           already shows rather than to a node nobody can find. */
        val node = WorkflowNode(
            id   = config.stepId,
            type = "llm",
            config = buildMap {
                put("connectionId", config.llmConnectionId.toString())
                put("model",        config.modelName)
                put("temperature",  config.temperature)
                put("maxTokens",    config.maxTokens)
                put("timeoutMs",    config.timeoutMs)
                /*
                 * ── THIS IS THE LOOP THAT PAYS FOR A CACHE WRITE ────────────
                 *
                 * An agent iteration resends `systemPrompt` byte-for-byte:
                 * instructions, the serialised tool catalogue and the roster do
                 * not change between turns — only the observations do, and those
                 * are in the user message, AFTER the breakpoint. So the write
                 * premium is paid once on iteration 1 and read back on every
                 * iteration after it.
                 *
                 * A one-shot LLM node sets nothing here and stays uncached, which
                 * is correct: it never sends that prefix again, so a write it can
                 * never read back would be a pure loss. See
                 * `LlmNodeExecutor.CFG_CACHE_PREFIX`.
                 */
                put(LlmNodeExecutor.CFG_CACHE_PREFIX, true)
                put("messages", listOf(
                    mapOf("role" to "system", "content" to systemPrompt),
                    mapOf("role" to "user",   "content" to userPrompt),
                ))
            },
        )

        return when (val result = llmExecutor.execute(node, emptyMap(), runtimeCtx)) {
            is NodeResult.Completed -> {
                val content = result.output["content"] as? String ?: ""
                val tokens  = (result.output["tokenCount"] as? Number)?.toInt() ?: 0
                LlmCallResult(content, tokens, estimateCostCents(tokens, config.modelName))
            }

            /* A 429 is not a failure of the task, and it is not something the loop
               can reason its way past. Surfacing the provider's own message keeps
               "we were rate limited" distinguishable from "the agent could not do
               it", which the previous generic RuntimeException("returned 429")
               did not. */
            is NodeResult.Throttled ->
                throw LlmCallException("${result.provider} rate limited this call. ${result.message}")

            is NodeResult.Failed ->
                throw LlmCallException(result.reason)

            else ->
                throw LlmCallException("LLM call returned an unexpected result: ${result::class.simpleName}")
        }
    }

    /** Raised when the LLM leg of an iteration cannot produce content. */
    class LlmCallException(message: String) : RuntimeException(message)

    private fun estimateCostCents(tokens: Int, model: String): Double {
        val ratePerMillion = when {
            model.contains("gpt-4o", ignoreCase = true)  -> 500.0  // $5/M
            model.contains("gpt-4",  ignoreCase = true)  -> 3000.0 // $30/M
            model.contains("claude", ignoreCase = true)  -> 300.0
            else                                          -> 150.0
        }
        return (tokens / 1_000_000.0) * ratePerMillion
    }

    // ── Action parsing ────────────────────────────────────────────────────────

    private fun parseAction(
        rawContent: String,
        state: AgentLoopState,
        iterationId: UUID?,
        config: AgentBrainConfig,
    ): AgentAction {
        // Strip markdown code blocks if LLM wrapped JSON in them
        val cleaned = rawContent.trim()
            .removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
        return try {
            mapper.readValue(cleaned, AgentAction::class.java)
        } catch (e: Exception) {
            log.warn("[brain] failed to parse action iter={}: {}", state.iteration, e.message)
            /* A THINK as repair, so the loop can continue or fail gracefully —
               MARKED as a repair, because an unmarked one is indistinguishable
               from the model choosing to think and sends the reader to the
               prompt when the problem is the response format. */
            AgentAction(
                type = AgentAction.ActionType.THINK,
                reasoningSummary = "Failed to parse action response — trying next iteration",
                repaired = true,
            )
        }
    }

    // ── Tool execution ────────────────────────────────────────────────────────

    /**
     * What a tool call produced: always an observation, plus the gate it is waiting on
     * when the tool needs a human before it may run.
     */
    private data class ToolOutcome(
        val observation: AgentObservation,
        val pause: NodeResult.ApprovalPaused? = null,
        /**
         * The tool parked on something that is not a person.
         *
         * A SEPARATE field from [pause] rather than a widened one, for the same
         * reason `targetAgentId` is separate from `toolId`: the two are handled
         * differently — an approval sets `waiting_for_approval` and lands on the
         * Approvals screen, a wait sets `waiting_for_event` and does not — and one
         * field carrying both is how a video render ends up in an approvals queue.
         */
        val wait: NodeResult.Waiting? = null,
        /**
         * The FULL tool result in the payload store, if it was captured.
         *
         * ── THE CAP AND THE DURABILITY WERE THE SAME THING, AND SHOULD NOT BE ──
         *
         * [MAX_TOOL_PAYLOAD_CHARS] exists to bound what goes into the PROMPT: ten
         * observations of a few thousand characters is a context budget anyone can
         * reason about. It had also become the only version of the result that
         * survived the iteration, so anything past 2000 characters was gone —
         * unavailable to the debugger, and unavailable to a rebuild.
         *
         * Two consumers, two limits. The full result goes here; the capped version
         * goes in [AgentObservation.payload] and into the prompt.
         */
        val resultRef: String? = null,
        /**
         * True when the step guard replayed a previous identical call instead of
         * executing this one.
         *
         * The observation the model then reads is the OLD result. Unmarked, a
         * reader believes the tool ran now and returned this — and concludes an
         * external system is serving stale data.
         */
        val cached: Boolean = false,
    )

    private suspend fun executeTool(
        action: AgentAction,
        config: AgentBrainConfig,
        runtimeCtx: RuntimeContext,
        state: AgentLoopState,
    ): ToolOutcome {
        /* `<toolId>#<queryId>` for a named query; a plain uuid otherwise. The tool
           is what is loaded and guarded; the query id travels with it. */
        val (baseToolId, namedQueryId) =
            com.vectorbea.worker.agents.tools.NamedQuery.splitToolId(action.toolId ?: "")
        val toolId = try { UUID.fromString(baseToolId) }
        catch (_: Exception) {
            return ToolOutcome(AgentObservation(
                state.iteration, "CALL_TOOL", action.toolId, "Invalid tool ID format", false))
        }

        val executor = toolExecutor
            ?: return ToolOutcome(AgentObservation(
                state.iteration, "CALL_TOOL", toolId.toString(),
                "Tool execution is not available on this worker", false))

        return try {
            /* A `tool` node, not an `http` one. ToolNodeExecutor owns the lookup,
               the type dispatch and the config remapping, so the agent path and the
               workflow path cannot disagree about what calling a tool means. */
            /*
             * ── THE ID IS AN APPROVAL KEY, SO IT MUST NOT MOVE ───────────────
             *
             * This was `<stepId>:tool-<iteration>`. Any gate the tool opens —
             * DbWriteNodeExecutor's, today — files its approval row against this id,
             * and `findApproval(runId, nodeId)` is how the resumed run finds the
             * decision again.
             *
             * The agent step re-executes from iteration 1 on resume, so the same tool
             * call lands on a DIFFERENT iteration number and therefore a different id.
             * The approved row was filed under `:tool-4`; the resumed run looked up
             * `:tool-2`, found nothing, and opened ANOTHER pending approval. Approving
             * that one produced a third. The run could never get past the gate, and it
             * died on "Cannot proceed due to tool approval requirement and iteration
             * limit reached" with a pile of pending approvals behind it.
             *
             * Keyed on the tool instead: stable across iterations, across resumes and
             * across re-executions of the step. The trade is one approval per (step,
             * tool) — a second call to the SAME tool in the same step reuses the first
             * decision — which is the bargain the agent's own gate already makes, and
             * the only key available that survives re-execution.
             *
             * The IDEMPOTENCY key is a different key over the same call, and carries
             * the arguments. See [toolGuardNodeId] for why the two must not be one.
             */
            val syntheticNode = WorkflowNode(
                id     = toolApprovalNodeId(keyScope(config), toolId),
                type   = "tool",
                config = mapOf("toolId" to (action.toolId ?: toolId.toString())),
            )

            @Suppress("UNCHECKED_CAST")
            val inputs = (action.toolInput ?: emptyMap<String, Any?>())
                .filterValues { it != null } as Map<String, Any>

            /*
             * ── HAS THIS EXACT CALL ALREADY RUN? ─────────────────────────────
             *
             * The agent step replays from iteration 1 on resume, so without this
             * every tool call the step already made is made AGAIN: the email sent
             * before the approval gate is sent a second time when the approval comes
             * back. The step-level guard in WorkflowRuntime does not cover this — it
             * keys on the graph node and never sees the calls inside the loop, and it
             * leaves the agent step's own row `running` across an approval pause, so
             * the step re-executes by design.
             *
             * Keyed on the arguments as well as the tool, so two DIFFERENT calls to
             * one tool are two operations and both run. `attemptGroup` rather than an
             * iteration or attempt number for the same reason SideEffectGuard uses it:
             * it moves only when a human asks for the work to happen again, so a
             * resume dedupes and a deliberate re-run genuinely re-runs.
             */
            val guardNodeId = toolGuardNodeId(keyScope(config), toolId, inputs)
            val guard       = toolGuard
            val cached      = if (guard == null) null else replayGuardedTool(
                guard, guardNodeId, config, runtimeCtx, toolId, state)
            if (cached != null) return cached.copy(cached = true)

            /*
             * ── THE TOOL SPAN'S PARENT ──────────────────────────────────────
             *
             * ToolNodeExecutor resolves its parent from the node id it is handed,
             * and this synthetic id — `<stepId>:tool:<toolId>` — was never
             * registered, so every tool an agent called hung flat off the TICK
             * span, beside the step that dispatched it rather than inside it.
             *
             * `spanForNode(config.stepId)` is the iteration currently running (see
             * IterationSpan), so binding the synthetic id to it puts the tool call
             * where it belongs. Unbound immediately after: the id is per (step,
             * tool) and is reused by every later iteration that calls the same
             * tool, so a stale entry would parent iteration five's call to
             * iteration two's span.
             */
            val toolTracer = runtimeCtx.tracer
            runCatching {
                toolTracer?.spanForNode(config.stepId)?.let {
                    toolTracer.bindNode(syntheticNode.id, it)
                }
            }

            when (val execResult = try {
                executor.execute(syntheticNode, inputs, runtimeCtx)
            } finally {
                runCatching { toolTracer?.bindNode(syntheticNode.id, null) }
            }) {
                is NodeResult.Completed -> {
                    /* Recorded before the observation is built: the guard row and the
                       output are what a resumed step reads instead of calling again,
                       and both are best-effort — a failure to record costs a duplicate
                       call on resume, never a wrong result now. */
                    if (guard != null) {
                        toolOutputs?.let { store ->
                            runCatching {
                                store.save(
                                    runId = runtimeCtx.runId,
                                    workspaceId = config.workspaceId,
                                    environmentId = config.environmentId,
                                    nodeId = guardNodeId,
                                    nodeType = "tool",
                                    rawOutput = execResult.output,
                                    extractedOutput = null,
                                    validatedOutput = null,
                                )
                            }.onFailure {
                                log.warn("[brain] tool output persist failed [nodeId={}]: {}",
                                    guardNodeId, it.message)
                            }
                        }
                        guard.markCompleted(runtimeCtx.runId, guardNodeId, runtimeCtx.attemptGroup)
                    }
                    /* The full result, uncapped, before the prompt version is cut
                       down. Best-effort: a payload that cannot be stored costs a
                       debugging artefact and a future reconstruction, never this call. */
                    val fullRef = runCatching {
                        payloads?.capture(
                            workspaceId = config.workspaceId,
                            content = mapper.writeValueAsString(execResult.output),
                            contentType = com.vectorbea.worker.events.PayloadStore.JSON,
                        )?.ref
                    }.getOrNull()

                    /*
                     * ── THE CONTRACT, BETWEEN THE RESULT AND THE PROMPT ─────
                     *
                     * Order is the whole design. The FULL result went to the
                     * payload store above — the debugger keeps everything. What
                     * reaches the model is projected first and capped second, so
                     * the cap acts on ten meaningful fields rather than on a
                     * serialised tree it will cut mid-structure.
                     *
                     * A tool with no contract projects to itself, so this path is
                     * byte-for-byte what it was for every tool that has not
                     * adopted one.
                     */
                    val contract = loadToolContract(toolId, config.workspaceId)
                    val statusCode = com.vectorbea.worker.agents.tools.ToolErrorShape
                        .statusOf(execResult.output)

                    /*
                     * A NON-2xx THAT CAME BACK AS `Completed` IS STILL A FAILURE.
                     *
                     * HTTP tools return 404 and 403 as completed results rather
                     * than failing the node, because a 404 is a legitimate answer
                     * to a lookup and failing the run would be worse. The model was
                     * therefore handed `{"statusCode":403, "body":{...}}` and left
                     * to work out that it had been refused — which it does by
                     * trying again. The error contract applies here too.
                     */
                    if (statusCode != null && statusCode !in 200..299) {
                        val shape = com.vectorbea.worker.agents.tools.ToolErrorShape.of(
                            contract, statusCode,
                            com.vectorbea.worker.agents.tools.ToolErrorShape.bodyTextOf(execResult.output),
                            null)
                        recordObservationShape(projected = contract != null,
                            truncated = false, chars = shape.asObservation().length)
                        return ToolOutcome(
                            AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                                shape.asObservation(), false,
                                payload = renderToolPayload(mapOf(
                                    "error" to shape.kind,
                                    "retryable" to shape.retryable,
                                    "status" to shape.status))),
                            resultRef = fullRef)
                    }

                    val projection = com.vectorbea.worker.agents.tools.ResultProjection
                        .project(execResult.output, contract)
                    if (projection.missing.isNotEmpty()) {
                        /* The contract asked for fields the response did not have.
                           Almost always an API that changed shape, and silent
                           otherwise: the observation simply gets smaller. */
                        log.warn("[brain] result contract fields missing for tool {}: {}",
                            toolId, projection.missing.take(5))
                    }
                    val payload = capObservation(projection.json)
                    recordObservationShape(
                        projected = projection.applied,
                        truncated = payload?.contains(TRUNCATION_MARKER) == true,
                        chars = payload?.length ?: 0)

                    ToolOutcome(
                        AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                            buildToolObservationSummary(
                                toolId, execResult.output,
                                projected = projection.takeIf { it.applied }?.json),
                            true,
                            payload = payload),
                        resultRef = fullRef)
                }

                is NodeResult.Failed -> {
                    /*
                     * ── WHAT FAILED, AND WHETHER TO TRY AGAIN ────────────────
                     *
                     * The summary used to be "Tool <uuid> failed: <provider text>",
                     * which tells a model that something went wrong and nothing
                     * about what to do — so it retries, rephrases, retries again,
                     * and spends its iteration budget discovering that a revoked
                     * credential is still revoked.
                     *
                     * `retryable` is the field that ends that loop, and the
                     * sentence beside it says what would actually fix the problem.
                     * A tool with no contract still gets the HTTP defaults, which
                     * are correct for most failures — see [ToolErrorShape].
                     */
                    val shape = com.vectorbea.worker.agents.tools.ToolErrorShape.of(
                        contract = loadToolContract(toolId, config.workspaceId),
                        status = statusFromMessage(execResult.reason),
                        body = execResult.reason,
                        fallbackMessage = execResult.reason)
                    val errSummary = shape.asObservation()
                    log.warn("[brain] tool execution failed toolId={} kind={} retryable={}: {}",
                        toolId, shape.kind, shape.retryable, execResult.reason)
                    recordObservationShape(projected = false, truncated = false,
                        chars = errSummary.length)
                    /* Marked failed, not left running: `tryAcquire` reads a failed row as
                       free to retry, so a resumed step calls the tool again — which is
                       what should happen to a call that did not succeed. */
                    guard?.markFailed(runtimeCtx.runId, guardNodeId, runtimeCtx.attemptGroup, null)
                    ToolOutcome(AgentObservation(
                        state.iteration, "CALL_TOOL", toolId.toString(), errSummary, false))
                }

                /*
                 * ── A TOOL WAITING ON A PERSON MUST STOP THE RUN ─────────────
                 *
                 * This used to become one unsuccessful observation and the loop carried
                 * on. Nothing paused. The gate had already written a PENDING row, so an
                 * approval appeared on the Approvals screen for a run that was still
                 * executing, and the agent — told only "requires human approval" —
                 * reasoned around it until it ran out of iterations and reported
                 * "Cannot proceed due to tool approval requirement and iteration limit
                 * reached". Approving the row did nothing, because nothing was waiting
                 * for it.
                 *
                 * The pause travels out of the loop now, exactly as ASK_APPROVAL's does,
                 * and the step returns NodeResult.ApprovalPaused so the runtime parks the
                 * run against that row. On resume the tool is called again, its gate
                 * finds the decision under the same key, and the write goes through.
                 */
                is NodeResult.ApprovalPaused -> ToolOutcome(
                    AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                        "Tool $toolId is waiting for approval before it can run", false),
                    pause = execResult)

                is NodeResult.Throttled -> ToolOutcome(
                    AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                        "Tool $toolId was rate limited by ${execResult.provider}", false))

                /*
                 * ── AN ASYNC TOOL PARKS THE STEP, IT DOES NOT FAIL IT ────────
                 *
                 * The same shape as the approval arm above, and for the same
                 * reason: the alternative is one unsuccessful observation and a
                 * loop that reasons around a job which is running perfectly well.
                 * A six-minute render would burn the agent's remaining iterations
                 * and report that it could not proceed.
                 *
                 * The pause travels out of the loop and the step returns
                 * NodeResult.Waiting, so the runtime parks the run and releases the
                 * worker. On resume the tool re-executes, recomputes the same wait
                 * key, finds its own RESOLVED wait, and reads the result out of it
                 * instead of submitting the job again.
                 */
                is NodeResult.Waiting -> ToolOutcome(
                    AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                        "Tool $toolId started work that takes a while: ${execResult.label}", false),
                    wait = execResult)

                is NodeResult.Unsupported -> ToolOutcome(
                    AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                        "Tool $toolId has a type this worker cannot execute", false))
            }
        } catch (e: Exception) {
            val errSummary = "Tool $toolId failed: ${e.message?.take(200)}"
            log.warn("[brain] tool execution failed: {}", errSummary)
            ToolOutcome(AgentObservation(
                state.iteration, "CALL_TOOL", toolId.toString(), errSummary, false))
        }
    }

    /**
     * The cached outcome of this exact call, or null to go ahead and make it.
     *
     * Returns non-null only when the guard says this (step, tool, arguments) already
     * completed AND the stored output can be read back. "Completed but no stored
     * output" falls through and re-executes, the same trade
     * [com.vectorbea.worker.runtime.WorkflowRuntime] makes: repeating a call is worse
     * than a wrong answer only if the call has side effects, and returning an empty
     * result the model then reasons over is a wrong answer every time.
     *
     * A guard failure is not a reason to skip: [StepExecutionGuard.tryAcquire] already
     * fails open, and this reads its result rather than second-guessing it.
     */
    private fun replayGuardedTool(
        guard: StepExecutionGuard,
        guardNodeId: String,
        config: AgentBrainConfig,
        runtimeCtx: RuntimeContext,
        toolId: UUID,
        state: AgentLoopState,
    ): ToolOutcome? {
        val acq = guard.tryAcquire(
            runId = runtimeCtx.runId,
            workspaceId = config.workspaceId,
            environmentId = config.environmentId,
            nodeId = guardNodeId,
            attempt = runtimeCtx.attemptGroup,
        )
        if (!acq.alreadyCompleted) return null

        val cached = runCatching { toolOutputs?.loadRaw(runtimeCtx.runId, guardNodeId) }.getOrNull()
        if (cached == null) {
            log.warn("[brain] tool guard says completed but no stored output — re-executing " +
                "[nodeId={}, runId={}]", guardNodeId, runtimeCtx.runId)
            return null
        }

        log.info("[brain] tool call already completed with these arguments — using stored output " +
            "[toolId={}, runId={}]", toolId, runtimeCtx.runId)
        /* On config.stepId, not the guard id: the guard id is an internal key with an
           argument hash in it, and an event filed against it would attach to a step no
           screen can resolve. Same reasoning as the synthetic LLM node in callLlm. */
        emitEvent(config, RunEventStore.EventType.STEP_SKIPPED, "running",
            "Skipped re-execution of tool $toolId — already called with these arguments " +
            "in this run; stored result reused (idempotency guard)")

        return ToolOutcome(AgentObservation(
            state.iteration, "CALL_TOOL", toolId.toString(),
            /* No projected form here on purpose: this is the stored raw result
               being replayed, and re-projecting it would mean loading the contract
               on a path whose whole point is not to do work again. The shape
               summary is what the first execution's row already recorded. */
            buildToolObservationSummary(toolId, cached), true,
            payload = renderToolPayload(cached)))
    }

    /**
     * The one-line description of a tool result, for the timeline and the iteration
     * record. Deliberately still just shape — the values travel in the observation's
     * [AgentObservation.payload] instead of here, so that putting the data back in
     * front of the model does not also write a copy of every tool result into
     * `run_events` and inflate the run's history budget.
     */
    private fun buildToolObservationSummary(
        toolId: UUID,
        result: Map<String, Any?>,
        projected: String? = null,
    ): String {
        if (RESULT_SUMMARY_ENABLED && projected != null) {
            com.vectorbea.worker.agents.tools.ResultProjection.summaryOf(projected)
                ?.let { return it }
        }
        val size = result.size
        val keys = result.keys.take(5).joinToString()
        return "Tool returned $size field(s): $keys"
    }

    /**
     * Cap an already-projected observation.
     *
     * Split out from [renderToolPayload] because the input is now JSON TEXT rather
     * than a result map: the projection has already serialised it, and
     * re-serialising a parsed copy would reorder the keys — which matters, because
     * the collection summary is written first precisely so it survives a cap.
     */
    private fun capObservation(json: String?): String? {
        if (json.isNullOrBlank()) return null
        return safetyGuard.sanitizeToolOutput(json, MAX_TOOL_PAYLOAD_CHARS).takeIf { it.isNotBlank() }
    }

    /**
     * A status code named in a failure message, if there is one.
     *
     * `NodeResult.Failed` carries prose, and the HTTP executors write "HTTP 403"
     * into it. Parsing that is unlovely and it is the only way to classify a
     * failure that arrived as a sentence — the alternative is a structured error
     * on `NodeResult.Failed`, which changes a type every executor returns and is a
     * larger change than this work should make. Null when nothing matches, and the
     * classifier then falls back to `unknown`, which is not retryable.
     */
    private fun statusFromMessage(message: String?): Int? {
        if (message == null) return null
        return STATUS_IN_MESSAGE.find(message)?.groupValues?.get(1)?.toIntOrNull()
    }

    /**
     * What the last observation looked like, for the before/after measurement.
     *
     * Held here and written by [persistIterationEnd] rather than written directly,
     * because the iteration row does not exist yet at the moment a tool returns —
     * and "was this truncated" is knowable exactly here and only guessable
     * afterwards by matching text in a payload.
     */
    @Volatile private var pendingObservationShape: ObservationShape? = null

    internal data class ObservationShape(
        val projected: Boolean, val truncated: Boolean, val chars: Int)

    private fun recordObservationShape(projected: Boolean, truncated: Boolean, chars: Int) {
        pendingObservationShape = ObservationShape(projected, truncated, chars)
    }

    /**
     * The tool's result as JSON, sanitized and capped, for the next prompt.
     *
     * Serializing the whole output map rather than picking fields out of it is
     * deliberate: tools here are HTTP calls, SQL queries and SaaS actions with no
     * common result shape, and any guess about which field "the data" lives in would
     * be wrong for some tool and would fail silently — which is the failure this
     * whole function exists to end.
     */
    private fun renderToolPayload(result: Map<String, Any?>): String? {
        if (result.isEmpty()) return null
        val json = try { mapper.writeValueAsString(result) } catch (_: Exception) { result.toString() }
        return safetyGuard.sanitizeToolOutput(json, MAX_TOOL_PAYLOAD_CHARS).takeIf { it.isNotBlank() }
    }

    // ── Schema validation ─────────────────────────────────────────────────────

    /**
     * The agent's own FINAL, against its declared schema.
     *
     * Delegates to [OutputSchemaCheck], which is also what the CALLER'S harness
     * uses to validate a delegated child's result. One implementation, because two
     * that drift give you a child whose output the callee called valid and the
     * caller called invalid — or, worse, the reverse: the parent accepts a shape it
     * cannot use and starts reading nulls out of it three steps later.
     */
    private fun validateFinalOutput(output: Map<String, Any?>, config: AgentBrainConfig): Boolean =
        OutputSchemaCheck.validateJson(output, config.outputSchemaJson).valid

    // ── Persistence ───────────────────────────────────────────────────────────

    private fun persistIterationStart(config: AgentBrainConfig, state: AgentLoopState): UUID {
        val id = UUID.randomUUID()
        if (dataSource == null) return id
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO agent_iterations
                       (id,workspace_id,environment_id,run_id,step_id,agent_id,iteration_number,status)
                       VALUES(?,?,?,?,?,?,?,'running')
                       ON CONFLICT (run_id,step_id,iteration_number) DO UPDATE SET
                         status='running',
                         action_type=NULL,
                         thought_summary_sanitized=NULL,
                         observation_summary_sanitized=NULL,
                         tokens_used=0,
                         estimated_cost_cents=0,
                         started_at=now(),
                         completed_at=NULL
                       RETURNING id"""
                ).use { stmt ->
                    stmt.setObject(1, id); stmt.setObject(2, config.workspaceId)
                    stmt.setObject(3, config.environmentId); stmt.setObject(4, config.runId)
                    stmt.setString(5, config.stepId); stmt.setObject(6, config.agentId)
                    stmt.setInt(7, state.iteration)
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) rs.getObject("id", UUID::class.java) else id
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[brain] persist iteration start failed: {}", e.message)
            id
        }
    }

    /**
     * One iteration's span, and the registry swap it owns.
     *
     * ── WHY THIS IS AN OBJECT AND NOT TWO TRACER CALLS ──────────────────────
     * An iteration ends in eleven places. Ten of them are branches of one `when`
     * over the model's chosen action, and each already tells
     * [persistIterationComplete] whether the iteration completed or failed —
     * which is exactly what the span needs to say. Threading the close through
     * that one function makes the two agree by construction, instead of by
     * eleven people remembering.
     *
     * [close] is idempotent so the backstop at the foot of the loop and the one
     * after it can fire unconditionally without double-writing a span or
     * corrupting the parent's self-time accumulator.
     *
     * The object also owns the node-id binding it made: `llm_call` and
     * `tool_call` spans find their parent by this step's node id, so the id
     * points at the live iteration while it runs and goes back to the loop's
     * parent when it ends. Owning both halves is what stops a close path from
     * restoring the binding and forgetting the span, or the reverse.
     */
    private class IterationSpan private constructor(
        private val tracer: com.vectorbea.worker.events.RunTracer,
        private val spanId: UUID,
        private val parentSpanId: UUID?,
        private val index: Int,
        private val stepId: String,
    ) {
        private val closed = java.util.concurrent.atomic.AtomicBoolean(false)

        /**
         * What the context assembler had to drop to fit this iteration's prompt.
         *
         * Recorded on the span rather than logged, because the failure it prevents
         * — an agent that "ignored" an instruction it was never shown — is
         * diagnosed by looking at the iteration, not by grepping. Set before the
         * model call; emitted whenever the span closes, on every path.
         */
        @Volatile
        var contextAttributesJson: String? = null

        /**
         * Which skills this iteration's prompt carried, and what the budget did
         * to them.
         *
         * Kept as a MAP beside [contextAttributesJson]'s string rather than as a
         * second JSON string, because the span takes one attributes document and
         * merging two JSON strings textually is the kind of thing that works
         * until a skill slug contains a brace. Merged once, on close.
         */
        @Volatile
        var skillAttributes: Map<String, Any> = emptyMap()

        fun close(status: String) {
            if (!closed.compareAndSet(false, true)) return
            runCatching {
                tracer.close(
                    spanId, "iteration", "iteration $index", status,
                    stepId = stepId, iterationIndex = index,
                    attributesJson = mergedAttributes(),
                )
                tracer.bindNode(stepId, parentSpanId)
            }
        }

        /**
         * The context bookkeeping and the skills bookkeeping, as one document.
         *
         * Falls back to whichever half exists. A failure to serialise yields the
         * context half unchanged rather than nothing: losing the skills
         * attributes degrades one answer, losing both degrades the answer this
         * whole path exists to give.
         */
        private fun mergedAttributes(): String {
            val ctx = contextAttributesJson
            val skills = skillAttributes
            if (skills.isEmpty()) return ctx ?: "{}"
            return runCatching {
                val m = jacksonObjectMapper()
                val merged = linkedMapOf<String, Any?>()
                if (ctx != null) {
                    @Suppress("UNCHECKED_CAST")
                    merged.putAll(m.readValue(ctx, Map::class.java) as Map<String, Any?>)
                }
                merged.putAll(skills)
                m.writeValueAsString(merged)
            }.getOrElse { ctx ?: "{}" }
        }

        companion object {
            /** Null tracer, tracing off, or a failed open all give the same no-op. */
            fun open(
                tracer: com.vectorbea.worker.events.RunTracer?,
                parentSpanId: UUID?,
                index: Int,
                stepId: String,
            ): IterationSpan? {
                val t = tracer ?: return null
                val id = runCatching {
                    t.open("iteration", "iteration $index", parentSpanId)
                }.getOrNull() ?: return null
                runCatching { t.bindNode(stepId, id) }
                return IterationSpan(t, id, parentSpanId, index, stepId)
            }
        }
    }

    /**
     * A snapshot of the budget's consumption counters, for computing an iteration's
     * delta.
     *
     * The cumulative totals on the row are the right thing for a progress display
     * and the wrong thing for a rebuild: a reconstruction resuming at iteration 5
     * needs what the budget stood at after 4, and a total may have been written by
     * an attempt that was later abandoned. Deltas sum; totals do not.
     */
    private data class BudgetMark(val tokens: Int, val costCents: Double, val toolCalls: Int) {
        companion object {
            fun of(b: AgentBudget) = BudgetMark(b.tokensUsed, b.estimatedCostCents, b.toolCallsUsed)
        }
    }

    private fun persistIterationComplete(
        iterationId: UUID?,
        /**
         * Closed with the same verdict the row is given, here rather than at the
         * eleven call sites — see [IterationSpan]. Null whenever tracing is off, and
         * deliberately BEFORE the early return below: a row that could not be written
         * because there is no data source still had a real iteration behind it, and
         * an unclosed span would leave a hole in the waterfall.
         */
        span: IterationSpan?,
        status: String,
        action: AgentAction,
        observationSummary: String?,
        budget: AgentBudget,
        /* Everything below is what makes the iteration reconstructible. All optional:
           absent, the row is still a valid record and reconstruction declines on it. */
        mark: BudgetMark? = null,
        observationSuccess: Boolean? = null,
        observationPayloadRef: String? = null,
        toolResultRef: String? = null,
        /**
         * Whether the guard replayed this tool call. Null when there was no tool
         * call at all — which is not the same as "executed fresh".
         */
        toolResultCached: Boolean? = null,
    ) {
        span?.close(if (status == "completed") "ok" else "error")
        if (dataSource == null || iterationId == null) return
        try {
            /* The action AS PARSED, with its arguments — the one field without which a
               transcript can be displayed but not continued from. Sanitized: a tool
               input can carry whatever the model put in it. */
            val actionJson = runCatching {
                mapper.writeValueAsString(mapOf(
                    "type" to action.type.name,
                    "toolId" to action.toolId,
                    "toolInput" to action.toolInput,
                    "reasoningSummary" to safetyGuard.sanitizeReasoningSummary(action.reasoningSummary),
                    "failReason" to action.failReason?.take(500),
                    "confidence" to action.confidence,
                    /* Deliberately NOT finalOutput: a FINAL ends the loop, so no
                       reconstruction ever needs to replay past it, and it can be large. */
                ))
            }.getOrNull()

            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE agent_iterations SET
                         status=?, action_type=?, thought_summary_sanitized=?,
                         observation_summary_sanitized=?, tokens_used=?,
                         estimated_cost_cents=?, completed_at=?,
                         action_json_sanitized=?::jsonb, observation_success=?,
                         observation_payload_ref=?, tool_result_ref=?,
                         selected_tool_id=?, tokens_delta=?, cost_delta_cents=?,
                         tool_calls_delta=?, loop_schema_version=?,
                         action_repaired=?, tool_result_cached=?,
                         observation_projected=?, observation_truncated=?,
                         observation_chars=?
                       WHERE id=?"""
                ).use { stmt ->
                    stmt.setString(1, status)
                    stmt.setString(2, action.type.name)
                    stmt.setString(3, (action.reasoningSummary ?: "").take(500))
                    stmt.setString(4, observationSummary?.take(500))
                    stmt.setInt(5, budget.tokensUsed)
                    stmt.setBigDecimal(6, java.math.BigDecimal.valueOf(budget.estimatedCostCents))
                    stmt.setTimestamp(7, Timestamp.from(Instant.now()))
                    stmt.setString(8, actionJson)
                    if (observationSuccess == null) stmt.setNull(9, java.sql.Types.BOOLEAN)
                    else stmt.setBoolean(9, observationSuccess)
                    stmt.setString(10, observationPayloadRef)
                    stmt.setString(11, toolResultRef)
                    val toolUuid = action.toolId?.let { runCatching { UUID.fromString(it) }.getOrNull() }
                    if (toolUuid == null) stmt.setNull(12, java.sql.Types.OTHER)
                    else stmt.setObject(12, toolUuid)
                    stmt.setInt(13, (budget.tokensUsed - (mark?.tokens ?: 0)).coerceAtLeast(0))
                    stmt.setBigDecimal(14, java.math.BigDecimal.valueOf(
                        (budget.estimatedCostCents - (mark?.costCents ?: 0.0)).coerceAtLeast(0.0)))
                    stmt.setInt(15, (budget.toolCallsUsed - (mark?.toolCalls ?: 0)).coerceAtLeast(0))
                    stmt.setInt(16, AgentLoopReconstructor.LOOP_SCHEMA_VERSION)
                    stmt.setBoolean(17, action.repaired)
                    if (toolResultCached == null) stmt.setNull(18, java.sql.Types.BOOLEAN)
                    else stmt.setBoolean(18, toolResultCached)
                    /*
                     * ── THE BEFORE/AFTER, RECORDED PER ITERATION ─────────────
                     *
                     * NULL when this iteration made no tool call, which is a third
                     * state and not a false: "no contract applied" and "a contract
                     * applied and produced nothing" need to be told apart, and so do
                     * "not truncated" and "nothing to truncate". The acceptance
                     * criterion is a RATE over contracted tools, and a rate computed
                     * over rows that never called a tool is not that rate.
                     *
                     * Consumed and cleared: the field is per-iteration state on a
                     * runner that outlives the iteration, so leaving it set would
                     * attribute this observation's size to the next iteration too.
                     */
                    val shape = pendingObservationShape
                    pendingObservationShape = null
                    if (shape == null) {
                        stmt.setNull(19, java.sql.Types.BOOLEAN)
                        stmt.setNull(20, java.sql.Types.BOOLEAN)
                        stmt.setNull(21, java.sql.Types.INTEGER)
                    } else {
                        stmt.setBoolean(19, shape.projected)
                        stmt.setBoolean(20, shape.truncated)
                        stmt.setInt(21, shape.chars)
                    }
                    stmt.setObject(22, iterationId)
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) { log.warn("[brain] persist iteration complete failed: {}", e.message) }
    }

    // ── Tool descriptors ──────────────────────────────────────────────────────

    /**
     * Parsed contracts, by the JSON they came from.
     *
     * Keyed on the text rather than the tool id because the same contract is read
     * twice while building one descriptor and once per tool call, and parsing is
     * pure. Bounded by the number of distinct contracts an agent can see, which is
     * its tool grant.
     */
    private val contractCache =
        java.util.concurrent.ConcurrentHashMap<String, com.vectorbea.worker.agents.tools.ToolResultContract>()

    private fun contractFor(json: String?): com.vectorbea.worker.agents.tools.ToolResultContract? {
        if (json.isNullOrBlank()) return null
        contractCache[json]?.let { return it }
        val parsed = com.vectorbea.worker.agents.tools.ToolResultContract.parse(json)
        if (parsed == null) {
            /* A contract that will not parse is a tool whose author believes it has
               one. Warn once per distinct text rather than per call: the loop would
               otherwise log it on every iteration of every run using that tool. */
            if (contractCache.putIfAbsent(json,
                    com.vectorbea.worker.agents.tools.ToolResultContract()) == null) {
                log.warn("[brain] tool result contract is unreadable — falling back to the " +
                    "whole result for this tool")
            }
            return null
        }
        contractCache[json] = parsed
        return parsed
    }

    /** This tool's contract, read at call time. Null when it declares none. */
    private fun loadToolContract(toolId: UUID, workspaceId: UUID):
        com.vectorbea.worker.agents.tools.ToolResultContract? {
        val ds = dataSource ?: return null
        return runCatching {
            ds.connection.use { c ->
                c.prepareStatement(
                    "SELECT result_contract_json FROM tools WHERE id=? AND workspace_id=?"
                ).use { st ->
                    st.setObject(1, toolId); st.setObject(2, workspaceId)
                    st.executeQuery().use { rs ->
                        if (rs.next()) contractFor(rs.getString(1)) else null
                    }
                }
            }
        }.getOrNull()
    }

    private fun loadAllowedToolDescriptors(config: AgentBrainConfig): List<AgentPromptBuilder.ToolDescriptor> {
        if (dataSource == null || config.allowedToolIds.isEmpty()) return emptyList()
        return try {
            dataSource.connection.use { conn ->
                val placeholders = config.allowedToolIds.joinToString(",") { "?" }
                conn.prepareStatement(
                    "SELECT id, name, description, input_schema_json, result_contract_json, " +
                    "named_queries_json " +
                    "FROM tools WHERE id IN ($placeholders) AND workspace_id=? AND status='active'"
                ).use { stmt ->
                    config.allowedToolIds.forEachIndexed { i, id -> stmt.setObject(i + 1, id) }
                    stmt.setObject(config.allowedToolIds.size + 1, config.workspaceId)
                    val rs = stmt.executeQuery()
                    buildList {
                        while (rs.next()) {
                            /*
                             * ── ONE TOOL PER NAMED QUERY ─────────────────────
                             *
                             * A database tool with a catalogue is not offered to
                             * the model as "a database tool" — each of its queries
                             * is a tool in its own right, with its own description
                             * and its own parameter schema. Discovery is then the
                             * same mechanism as every other tool, and the model
                             * never has a reason to ask "what SQL should I write":
                             * there is no affordance for writing any.
                             *
                             * The id carries both halves (`<toolId>#<queryId>`),
                             * which is what `ToolNodeExecutor` splits back apart.
                             * The grant list still names the TOOL, so a query is
                             * reachable exactly when its tool is — one grant, not
                             * two, and no way to grant a write without granting the
                             * tool that owns it.
                             */
                            val queries = com.vectorbea.worker.agents.tools.NamedQuery
                                .parseCatalogue(rs.getString("named_queries_json"))
                            if (queries.isNotEmpty()) {
                                val toolId = rs.getString("id")
                                val toolName = rs.getString("name")
                                queries.forEach { q ->
                                    add(AgentPromptBuilder.ToolDescriptor(
                                        id = com.vectorbea.worker.agents.tools.NamedQuery
                                            .syntheticToolId(toolId, q.id),
                                        name = "$toolName.${q.id}",
                                        description = q.description,
                                        inputSchema = q.inputSchema(),
                                        resultLegend = com.vectorbea.worker.agents.tools
                                            .ResultProjection.legendOf(q.resultContract),
                                        /* The access level is stated because it
                                           changes what the model should expect:
                                           a write may pause for approval, and an
                                           agent that knows that plans around it
                                           rather than treating the pause as a
                                           failure. */
                                        usage = if (q.access ==
                                            com.vectorbea.worker.agents.tools.NamedQuery.Access.WRITE)
                                            "This query WRITES and may require human approval " +
                                            "before it runs. Returns at most ${q.maxRows} row(s)."
                                        else "Read-only. Returns at most ${q.maxRows} row(s)."
                                    ))
                                }
                                continue
                            }
                            add(AgentPromptBuilder.ToolDescriptor(
                                id = rs.getString("id"),
                                name = rs.getString("name"),
                                description = rs.getString("description") ?: "",
                                /* THE ARGUMENT NAMES. `ToolDescriptor` has carried an
                                   `inputSchema` field since it was written and the
                                   system prompt has always rendered it, but this query
                                   never selected the column - it selected `config_json`
                                   and then ignored that too - so every tool reached the
                                   model as a name and a sentence with no parameters.
                                   The model was being asked to call a tool and left to
                                   guess what to pass it, which is how a tool call comes
                                   back with the right intent and the wrong keys. */
                                inputSchema = parseJsonObject(rs.getString("input_schema_json")),
                                /* The two halves of the contract the MODEL needs to
                                   see: what to expect back, and when to reach for
                                   this tool at all. The projection half is applied
                                   server-side and the model never reads it. */
                                resultLegend = com.vectorbea.worker.agents.tools.ResultProjection
                                    .legendOf(contractFor(rs.getString("result_contract_json"))),
                                usage = contractFor(rs.getString("result_contract_json"))?.usage,
                            ))
                        }
                    }
                }
            }
        } catch (e: Exception) { log.warn("[brain] load tools failed: {}", e.message); emptyList() }
    }

    /** A jsonb column as a map. Empty when absent or not an object. */
    @Suppress("UNCHECKED_CAST")
    private fun parseJsonObject(raw: String?): Map<String, Any?> =
        if (raw.isNullOrBlank()) emptyMap()
        else runCatching { mapper.readValue(raw, Map::class.java) as Map<String, Any?> }
            .getOrDefault(emptyMap())

    /**
     * Announce a context-budget breach, once per iteration that has one.
     *
     * Both halves of a breach are reported, and they are different problems:
     *
     *   • `truncated` — sections were dropped to fit. The run is fine and the
     *     model saw less than it could have. Worth knowing when an answer looks
     *     thin.
     *   • `overBudget` — the PROTECTED sections alone exceeded the budget, so the
     *     budget was not enforced at all. [ContextAssembler] refuses to cut the
     *     objective or the inputs, which is right, but it means the limit somebody
     *     configured is not being honoured and they should hear about it rather
     *     than discover it from a provider error.
     */
    private fun reportContextBudget(
        config: AgentBrainConfig,
        state: AgentLoopState,
        a: com.vectorbea.worker.agents.context.ContextAssembler.Assembled,
    ) {
        if (!a.truncated && !a.overBudget) return
        val summary = if (a.overBudget)
            "The task and its inputs alone are ${a.charsUsed} characters, over the " +
            "${a.charBudget}-character team budget; nothing was dropped"
        else
            "Context trimmed to fit ${a.charBudget} characters — dropped " +
            a.droppedSections.joinToString(", ")
        emitEvent(config, RunEventStore.EventType.AGENT_CONTEXT_BUDGET_EXCEEDED,
            status = "warning", summary = summary,
            metadataJson = runCatching {
                mapper.writeValueAsString(a.spanAttributes() + mapOf("iteration" to state.iteration))
            }.getOrNull())
    }

    // ── Event emission ────────────────────────────────────────────────────────

    private fun emitEvent(
        config: AgentBrainConfig,
        type: RunEventStore.EventType,
        status: String,
        summary: String,
        tokenCount: Int? = null,
        estimatedCost: Double? = null,
        /**
         * Structured detail for events whose reason matters more than their prose —
         * the reconstruction skip carries its reason and its transcript snapshot ref
         * here. Sanitized by the caller, per RunEventStore's contract.
         */
        metadataJson: String? = null,
    ) {
        try {
            eventStore.appendEvent(RunEventStore.RunEvent(
                runId         = config.runId,
                workspaceId   = config.workspaceId,
                environmentId = config.environmentId,
                type          = type,
                status        = status,
                source        = "agent-brain:${config.agentName}",
                title         = type.value.replace("_", " ").lowercase()
                    .replaceFirstChar { it.uppercase() },
                summary       = summary.take(300),
                stepId        = config.stepId,
                agentId       = config.agentId,
                tokenCount    = tokenCount,
                estimatedCost = estimatedCost,
                metadataJsonSanitized = metadataJson,
            ))
        } catch (e: Exception) { log.warn("[brain] event emit failed type={}: {}", type, e.message) }
    }
}
