package com.vectorbea.worker.runtime.budget

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import java.util.UUID
import javax.sql.DataSource

/**
 * The bounds on a whole run, as opposed to [ExecutionBudget]'s bounds on a tick.
 *
 * THESE ARE DIFFERENT THINGS AND CONFLATING THEM IS THE BUG
 * ---------------------------------------------------------
 * [ExecutionBudget] answers "has this tick gone on long enough that the worker
 * should checkpoint and let someone else run?" — a scheduling courtesy. Exceeding
 * it is normal and costs nothing: the run yields and resumes.
 *
 * A ceiling answers "has this run consumed more than it is allowed to?" — a
 * contract. Exceeding it ends the run, and the user is charged for what was spent
 * getting there.
 *
 * The distinction matters because an agent in an infinite loop passes the tick
 * budget cleanly, forever. It yields, resumes, yields, resumes — each tick well
 * behaved, the run immortal. The tick budget was never going to stop it.
 *
 * WHY THE COUNTERS LIVE IN POSTGRES
 * ---------------------------------
 * A run executes as a sequence of ticks, possibly on different workers, possibly
 * hours apart across a suspension. Counters held in a tracker reset at every
 * RESUME_RUN, so the loop above would reach step 200 on every tick and never on
 * the run. The row is the only thing that survives.
 *
 * Read once at tick start, accumulated in memory during the tick (so the check is
 * a field comparison, not a query), flushed at every checkpoint and at the
 * terminal transition.
 *
 * ACTIVE TIME, NOT WALL TIME
 * --------------------------
 * `active_ms` accumulates only while a tick is executing. A run waiting three days
 * for an approval, or parked on a durable timer, holds no permit and costs
 * nothing — charging it wall-clock time would make "max 1 hour" mean "no workflow
 * may wait for a human", which is the opposite of what a durable engine is for.
 */
class RunCeilings(
    val maxSteps: Int,
    val maxActiveMs: Long,
    val maxCostCents: Int,
    val maxTokens: Int,
    val maxNodePayloadBytes: Int,
) {
    companion object {
        private val log = logger("RunCeilings")

        /**
         * Platform defaults, overridden per workspace by plan policy.
         *
         * A value ≤ 0 disables that dimension, so an operator can turn one off
         * without turning off the rest.
         */
        fun defaults() = RunCeilings(
            maxSteps = env("RUN_MAX_STEPS", 200),
            maxActiveMs = envL("RUN_MAX_ACTIVE_MS", 3_600_000L),
            maxCostCents = env("RUN_MAX_COST_CENTS", 100),
            maxTokens = env("RUN_MAX_TOKENS", 1_000_000),
            maxNodePayloadBytes = env("RUN_MAX_NODE_PAYLOAD_BYTES", 262_144),
        )

        /**
         * Ceilings for one workspace, from its plan.
         *
         * Cached permanently per workspace, like [com.vectorbea.worker.fairness.WorkspaceLimits]:
         * a plan change is rare and takes effect on the next worker cycle, which is
         * the right trade against a query on every run. Falls back to platform
         * defaults when there is no policy row or the lookup fails — a run must not
         * fail because we could not read its limits.
         */
        fun forWorkspace(dataSource: DataSource, workspaceId: UUID): RunCeilings =
            cache.computeIfAbsent(workspaceId) { ws ->
                runCatching {
                    dataSource.connection.use { conn ->
                        conn.prepareStatement(
                            """SELECT max_steps_per_run, max_active_seconds, max_cost_cents_per_run,
                                      max_tokens_per_run, max_node_payload_bytes
                                 FROM workspace_usage_policies WHERE workspace_id = ?"""
                        ).use { stmt ->
                            stmt.setObject(1, ws)
                            stmt.executeQuery().use { rs ->
                                if (!rs.next()) defaults() else RunCeilings(
                                    maxSteps = rs.getInt(1),
                                    maxActiveMs = rs.getInt(2) * 1_000L,
                                    maxCostCents = rs.getInt(3),
                                    maxTokens = rs.getInt(4),
                                    maxNodePayloadBytes = rs.getInt(5),
                                )
                            }
                        }
                    }
                }.getOrElse {
                    log.warn("[ceilings] policy lookup failed for {} — using platform defaults: {}",
                        ws, it.message)
                    defaults()
                }
            }

        private val cache = java.util.concurrent.ConcurrentHashMap<UUID, RunCeilings>()

        private fun env(name: String, default: Int) = System.getenv(name)?.toIntOrNull() ?: default
        private fun envL(name: String, default: Long) = System.getenv(name)?.toLongOrNull() ?: default
    }

    /**
     * Which ceiling was hit, and what to tell the user about it.
     *
     * [status] is a distinct terminal status per dimension, not a shared
     * `failed`. "Your run failed" is a support ticket; "your run reached its
     * $1.00 cost limit after 47 steps" is an answer, and the UI can offer the
     * right next action for each — raise the plan, fix the loop, split the
     * workflow.
     */
    data class Breach(
        val dimension: String,
        val status: String,
        val message: String,
        val used: Long,
        val limit: Long,
    ) {
        fun toErrorJson(): String =
            """{"code":"${status.uppercase()}","message":${jsonString(message)},""" +
                """"dimension":"$dimension","used":$used,"limit":$limit,"retryable":false}"""

        private fun jsonString(s: String) =
            "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""
    }
}

/**
 * A run's consumption so far, checked continuously and flushed durably.
 *
 * One instance per tick. Constructed from the row's persisted totals, so
 * `steps` counts every step the run has ever executed rather than every step this
 * tick executed.
 */
class RunCeilingTracker(
    private val ceilings: RunCeilings,
    private val runId: UUID,
    startingSteps: Int = 0,
    startingActiveMs: Long = 0,
    startingCostCents: Int = 0,
    startingTokens: Int = 0,
) {
    private val log = logger()

    private var steps = startingSteps
    private var costCents = startingCostCents
    private var tokens = startingTokens
    private val carriedActiveMs = startingActiveMs
    private val tickStartedAtMs = System.currentTimeMillis()

    /** Set once a ceiling is breached, so the reason survives to the terminal write. */
    var breach: RunCeilings.Breach? = null
        private set

    fun activeMs(): Long = carriedActiveMs + (System.currentTimeMillis() - tickStartedAtMs)
    fun steps(): Int = steps
    fun costCents(): Int = costCents
    fun tokens(): Int = tokens

    fun recordStep() { steps++ }

    fun recordUsage(tokensUsed: Int, costCentsUsed: Int) {
        tokens += tokensUsed
        costCents += costCentsUsed
    }

    private var lastUsageProbeMs = 0L

    /**
     * Re-read token and cost totals from `run_events`.
     *
     * Cost and tokens are recorded by the node executors, into the event stream,
     * one row per model call — that is where the authoritative numbers already
     * live, and it is per-call rather than per-run. Threading a tracker down
     * through every executor to double-count them in memory would touch a dozen
     * files and create a second source of truth that could disagree with the
     * first.
     *
     * So this reads the real total instead, throttled to [USAGE_PROBE_MS]. That
     * makes the cost ceiling accurate to within one probe interval rather than
     * exact — a run can overshoot its limit by whatever it spends in two seconds.
     * For a $1.00 ceiling and per-call costs in fractions of a cent, that is
     * cents of overshoot, and the alternative was a query per loop iteration.
     *
     * Recorded as D17: exact enforcement wants the executors to report usage
     * inline, which is the right change when the executor signature next moves.
     */
    private fun refreshUsage(dataSource: DataSource) {
        val now = System.currentTimeMillis()
        if (now - lastUsageProbeMs < USAGE_PROBE_MS) return
        lastUsageProbeMs = now
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT COALESCE(SUM(token_count), 0)::int          AS tokens,
                              COALESCE(SUM(estimated_cost), 0)::float       AS cost_usd
                         FROM run_events WHERE run_id = ?"""
                ).use { stmt ->
                    stmt.setObject(1, runId)
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) {
                            tokens = rs.getInt("tokens")
                            // Rounded up: a run that has spent $0.996 has spent
                            // 100 cents for the purpose of a $1.00 ceiling.
                            // Rounding down would let it keep going.
                            costCents = Math.ceil(rs.getDouble("cost_usd") * 100.0).toInt()
                        }
                    }
                }
            }
        }
    }

    /**
     * Check every dimension. Cheap enough to call in the execution loop — four
     * integer comparisons against fields, no I/O.
     *
     * Order is deliberate: cost first, because it is the one with a bill attached
     * and the one a user most needs named precisely. A run that blew through both
     * its step and cost ceilings in the same node should be reported as a cost
     * breach.
     */
    fun check(dataSource: DataSource? = null): RunCeilings.Breach? {
        breach?.let { return it }
        dataSource?.let { refreshUsage(it) }

        val c = ceilings
        val found = when {
            c.maxCostCents > 0 && costCents >= c.maxCostCents -> RunCeilings.Breach(
                dimension = "cost",
                status = "cost_limit_exceeded",
                message = "This run reached its cost limit of ${dollars(c.maxCostCents)} " +
                    "after $steps steps. Raise the limit on your plan, or reduce the number of " +
                    "model calls in this workflow.",
                used = costCents.toLong(), limit = c.maxCostCents.toLong(),
            )
            c.maxSteps > 0 && steps >= c.maxSteps -> RunCeilings.Breach(
                dimension = "steps",
                status = "step_limit_exceeded",
                message = "This run executed ${c.maxSteps} steps, its maximum. This usually means " +
                    "an agent or loop node is not reaching its exit condition — check the loop's " +
                    "termination check.",
                used = steps.toLong(), limit = c.maxSteps.toLong(),
            )
            c.maxTokens > 0 && tokens >= c.maxTokens -> RunCeilings.Breach(
                dimension = "tokens",
                status = "token_limit_exceeded",
                message = "This run used ${c.maxTokens} tokens, its maximum. Shorten the prompt, " +
                    "reduce the conversation history the agent carries, or raise the limit on your plan.",
                used = tokens.toLong(), limit = c.maxTokens.toLong(),
            )
            c.maxActiveMs > 0 && activeMs() >= c.maxActiveMs -> RunCeilings.Breach(
                dimension = "duration",
                status = "duration_limit_exceeded",
                message = "This run spent ${minutes(c.maxActiveMs)} minutes executing, its maximum. " +
                    "Time spent waiting for approvals or timers is not counted, so this is " +
                    "${minutes(c.maxActiveMs)} minutes of actual work.",
                used = activeMs(), limit = c.maxActiveMs,
            )
            else -> null
        }
        if (found != null) {
            breach = found
            WorkerMetrics.ceilingBreachTotal.inc(found.dimension)
            log.warn("[ceilings] {} breached for run {}: {} >= {}",
                found.dimension, runId, found.used, found.limit)
        }
        return found
    }

    /**
     * Payload check, separate from [check] because it is per node and carries the
     * node's identity into the message.
     *
     * Returns the breach rather than setting it, so the caller can decide whether
     * a too-large payload should end the run or be offloaded to object storage.
     * Nothing is offloaded yet — that is honest tech debt, recorded as D16 — so
     * every caller currently ends the run.
     */
    fun checkPayload(nodeId: String, bytes: Int): RunCeilings.Breach? {
        val limit = ceilings.maxNodePayloadBytes
        if (limit <= 0 || bytes <= limit) return null
        val found = RunCeilings.Breach(
            dimension = "payload",
            status = "payload_limit_exceeded",
            message = "Node '$nodeId' produced ${kb(bytes)}KB, over the ${kb(limit)}KB inline limit. " +
                "Return a reference to the data instead of the data itself, or filter the fields " +
                "the next node needs.",
            used = bytes.toLong(), limit = limit.toLong(),
        )
        breach = found
        WorkerMetrics.ceilingBreachTotal.inc("payload")
        log.warn("[ceilings] payload breached for run {} node {}: {} > {}", runId, nodeId, bytes, limit)
        return found
    }

    /**
     * Flush the accumulated totals onto the run row.
     *
     * Called at every yield and at the terminal transition — the two points where
     * the tick's in-memory count would otherwise be lost. Not called per step: that
     * would put a write in the execution loop to protect against a crash that
     * crash recovery already handles, and the counters only need to be right at
     * the boundaries where another tick reads them.
     *
     * Never throws. Losing a counter update is a mis-measured ceiling; failing the
     * run over it is an outage.
     */
    fun persist(dataSource: DataSource) {
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE agent_runs
                          SET steps_executed = ?, active_ms = ?, cost_cents = ?,
                              tokens_used = ?, ceiling_breached = ?, updated_at = now()
                        WHERE id = ?"""
                ).use { stmt ->
                    stmt.setInt(1, steps)
                    stmt.setLong(2, activeMs())
                    stmt.setInt(3, costCents)
                    stmt.setInt(4, tokens)
                    stmt.setString(5, breach?.dimension)
                    stmt.setObject(6, runId)
                    stmt.executeUpdate()
                }
            }
        }.onFailure {
            log.warn("[ceilings] could not persist counters for run {}: {}", runId, it.message)
        }
    }

    companion object {
        /**
         * How often token/cost totals are re-read from the event stream.
         *
         * Two seconds: short enough that a runaway agent is stopped within one
         * model call of its ceiling, long enough that the query is invisible next
         * to the model latency it is measuring.
         */
        private val USAGE_PROBE_MS =
            System.getenv("RUN_CEILING_USAGE_PROBE_MS")?.toLongOrNull() ?: 2_000L

        /**
         * Load a run's persisted totals and build a tracker for this tick.
         *
         * A failed read starts from zero rather than failing the run. That is the
         * safe direction: the ceiling is generous rather than absent, and the next
         * tick reads the persisted value again.
         */
        fun forRun(dataSource: DataSource, runId: UUID, ceilings: RunCeilings): RunCeilingTracker =
            runCatching {
                dataSource.connection.use { conn ->
                    conn.prepareStatement(
                        """SELECT steps_executed, active_ms, cost_cents, tokens_used
                             FROM agent_runs WHERE id = ?"""
                    ).use { stmt ->
                        stmt.setObject(1, runId)
                        stmt.executeQuery().use { rs ->
                            if (!rs.next()) RunCeilingTracker(ceilings, runId)
                            else RunCeilingTracker(
                                ceilings, runId,
                                startingSteps = rs.getInt(1),
                                startingActiveMs = rs.getLong(2),
                                startingCostCents = rs.getInt(3),
                                startingTokens = rs.getInt(4),
                            )
                        }
                    }
                }
            }.getOrElse { RunCeilingTracker(ceilings, runId) }
    }
}

private fun dollars(cents: Int) = "$%.2f".format(cents / 100.0)
private fun minutes(ms: Long) = ms / 60_000
private fun kb(bytes: Int) = bytes / 1024
