package com.vectorbea.worker.agents.brain.runtime

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.agents.brain.model.*
import com.vectorbea.worker.agents.brain.prompts.AgentPromptBuilder
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.durable.StepExecutionGuard
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.StepOutputStore
import com.vectorbea.worker.runtime.executor.LlmNodeExecutor
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.executor.ToolNodeExecutor
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode
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
        internal fun toolGuardNodeId(stepId: String, toolId: UUID, args: Map<String, Any?>): String =
            "$stepId:tool:$toolId:${sha256Hex(canonicalJson(args)).take(32)}"

        /** The approval key: keyed on the tool, never on the arguments. See [toolGuardNodeId]. */
        internal fun toolApprovalNodeId(stepId: String, toolId: UUID): String =
            "$stepId:tool:$toolId"

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
        if (llmHttpClient == null) LlmNodeExecutor(connectionResolver, eventStore)
        else LlmNodeExecutor(connectionResolver, eventStore, httpClient = llmHttpClient)
    }

    data class RunResult(
        val finalOutput: Map<String, Any?>,
        val stopReason: AgentLoopState.StopReason,
        val iterationsUsed: Int,
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
                allowed = runtimeCtx.allowLoopReconstruction,
                enabled = reconstructionEnabled,
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
                    "no earlier work repeated")
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
        var approvalMessage: String? = null

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

        try {
            while (!state.isDone) {
                budget.iterationStarted()
                state.iteration++

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
                val systemPrompt = AgentPromptBuilder.buildSystemPrompt(config, tools)
                val userPrompt   = AgentPromptBuilder.buildUserPrompt(config, state)

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
                            toolResultRef = outcome.resultRef)

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
                        if (outcome.pause == null &&
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
            approvalMessage    = approvalMessage,
        )
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
        AgentLoopState.StopReason.TOOL_NOT_ALLOWED ->
            "The agent tried to call a tool that is not in its allowed tool list."
        AgentLoopState.StopReason.SCHEMA_INVALID ->
            "The agent's final output did not match the required output schema."
        AgentLoopState.StopReason.ERROR, null ->
            "The agent stopped with an error that was not recorded."
        AgentLoopState.StopReason.FINAL_OUTPUT -> ""
    }

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
            // Return a THINK action as repair so loop can continue / fail gracefully
            AgentAction(
                type = AgentAction.ActionType.THINK,
                reasoningSummary = "Failed to parse action response — trying next iteration",
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
    )

    private suspend fun executeTool(
        action: AgentAction,
        config: AgentBrainConfig,
        runtimeCtx: RuntimeContext,
        state: AgentLoopState,
    ): ToolOutcome {
        val toolId = try { UUID.fromString(action.toolId!!) }
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
                id     = toolApprovalNodeId(config.stepId, toolId),
                type   = "tool",
                config = mapOf("toolId" to toolId.toString()),
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
            val guardNodeId = toolGuardNodeId(config.stepId, toolId, inputs)
            val guard       = toolGuard
            val cached      = if (guard == null) null else replayGuardedTool(
                guard, guardNodeId, config, runtimeCtx, toolId, state)
            if (cached != null) return cached

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

                    ToolOutcome(
                        AgentObservation(state.iteration, "CALL_TOOL", toolId.toString(),
                            buildToolObservationSummary(toolId, execResult.output), true,
                            payload = renderToolPayload(execResult.output)),
                        resultRef = fullRef)
                }

                is NodeResult.Failed -> {
                    val errSummary = "Tool $toolId failed: ${execResult.reason.take(200)}"
                    log.warn("[brain] tool execution failed toolId={}: {}", toolId, execResult.reason)
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
    private fun buildToolObservationSummary(toolId: UUID, result: Map<String, Any?>): String {
        val size = result.size
        val keys = result.keys.take(5).joinToString()
        return "Tool returned $size field(s): $keys"
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

    private fun validateFinalOutput(output: Map<String, Any?>, config: AgentBrainConfig): Boolean {
        if (config.outputSchemaJson == "{}") return true
        // Basic required field check — full JSON Schema validation would use a library
        return try {
            @Suppress("UNCHECKED_CAST")
            val schema   = mapper.readValue(config.outputSchemaJson, Map::class.java) as Map<String, Any?>
            val required = (schema["required"] as? List<*>)?.map { it.toString() } ?: emptyList()
            required.all { output.containsKey(it) }
        } catch (_: Exception) { true }
    }

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

        fun close(status: String) {
            if (!closed.compareAndSet(false, true)) return
            runCatching {
                tracer.close(
                    spanId, "iteration", "iteration $index", status,
                    stepId = stepId, iterationIndex = index,
                )
                tracer.bindNode(stepId, parentSpanId)
            }
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
                         tool_calls_delta=?, loop_schema_version=?
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
                    stmt.setObject(17, iterationId)
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) { log.warn("[brain] persist iteration complete failed: {}", e.message) }
    }

    // ── Tool descriptors ──────────────────────────────────────────────────────

    private fun loadAllowedToolDescriptors(config: AgentBrainConfig): List<AgentPromptBuilder.ToolDescriptor> {
        if (dataSource == null || config.allowedToolIds.isEmpty()) return emptyList()
        return try {
            dataSource.connection.use { conn ->
                val placeholders = config.allowedToolIds.joinToString(",") { "?" }
                conn.prepareStatement(
                    "SELECT id, name, description, input_schema_json FROM tools WHERE id IN ($placeholders) AND workspace_id=? AND status='active'"
                ).use { stmt ->
                    config.allowedToolIds.forEachIndexed { i, id -> stmt.setObject(i + 1, id) }
                    stmt.setObject(config.allowedToolIds.size + 1, config.workspaceId)
                    val rs = stmt.executeQuery()
                    buildList {
                        while (rs.next()) {
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
