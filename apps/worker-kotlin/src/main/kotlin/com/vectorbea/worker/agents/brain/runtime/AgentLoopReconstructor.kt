package com.vectorbea.worker.agents.brain.runtime

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.agents.brain.model.AgentAction
import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import com.vectorbea.worker.agents.brain.model.AgentBudget
import com.vectorbea.worker.agents.brain.model.AgentLoopState
import com.vectorbea.worker.agents.brain.model.AgentObservation
import com.vectorbea.worker.events.PayloadStore
import com.vectorbea.worker.logging.logger
import javax.sql.DataSource

/**
 * Rebuilds an agent's loop state from what it already did, so a resumed step
 * CONTINUES instead of starting over.
 *
 * THE PROBLEM
 * -----------
 * An agent step re-executes from iteration 1 whenever the run resumes — after an
 * approval, a timer, a crash. Loop state is in memory, so the second pass starts
 * blind and re-derives every decision it already made. Each of those is a paid
 * provider call. A run that parked for approval at iteration 5 pays for five more
 * LLM calls to get back to where it was, and the trace shows the work happening
 * twice.
 *
 * THE FIX IS NOT "REPLAY MORE CHEAPLY", IT IS "DO NOT REPLAY"
 * ----------------------------------------------------------
 * `agent_iterations` already records one row per iteration. Given the parsed
 * action, the observation and a per-iteration budget delta, the loop's state at
 * iteration N is fully derivable — no model required. Reconstruction reads the
 * transcript, rebuilds [AgentLoopState], and the loop carries on at N+1.
 *
 * WHY THIS CLASS REFUSES SO READILY
 * ---------------------------------
 * Every refusal below falls back to today's replay, which is correct if wasteful.
 * A reconstruction that is subtly wrong is not: it would hand the model a false
 * account of its own history and let it act on it. So anything unexpected — a
 * schema version this build does not know, a row with no action, a hole in the
 * numbering — declines rather than improvises. Degraded correctly beats failed,
 * and both beat confidently wrong.
 */
class AgentLoopReconstructor(
    private val dataSource: DataSource?,
    private val payloads: PayloadStore?,
) {
    private val log = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        /**
         * The shape this build knows how to read.
         *
         * A row written by a newer worker carries a higher number and is refused
         * rather than partially understood — the two services deploy independently,
         * so a mixed fleet is normal and a worker must not guess at a transcript
         * written by a version that knew more than it does.
         */
        const val LOOP_SCHEMA_VERSION = 1

        /** Iterations to read at most, a guard against a pathological transcript. */
        private const val MAX_ROWS = 500
    }

    /** Why reconstruction did not happen, for the event and the operator. */
    enum class SkipReason {
        DISABLED,               // flag off
        NOT_A_CONTINUATION,     // START_RUN / RETRY_NODE / REPLAY_RUN
        NO_PERSISTENCE,         // no datasource
        NO_ITERATIONS,          // nothing to rebuild from — a first execution
        PRE_V040_ROWS,          // written before the columns existed
        SCHEMA_VERSION_AHEAD,   // newer worker wrote it
        NON_CONTIGUOUS,         // a hole in the numbering: a row was lost
        MALFORMED_ROW,          // action json unreadable
        READ_FAILED,            // the query itself failed
        /** Asked to replay from an iteration this run never reached. */
        ITERATION_OUT_OF_RANGE,
    }

    sealed class Outcome {
        /** Loop state was rebuilt; resume at [resumeFromIteration]. */
        data class Reconstructed(
            val resumeFromIteration: Int,
            val observationsRestored: Int,
            val tokensRestored: Int,
        ) : Outcome()

        /** Replay from iteration 1, for [reason]. [snapshotRef] preserves the transcript. */
        data class Skipped(
            val reason: SkipReason,
            val detail: String? = null,
            val snapshotRef: String? = null,
        ) : Outcome()
    }

    /** One persisted iteration, as far as this build understands it. */
    private data class Row(
        val iterationNumber: Int,
        val status: String,
        val actionJson: String?,
        val thoughtSummary: String?,
        val observationSummary: String?,
        val observationSuccess: Boolean?,
        val observationPayloadRef: String?,
        val selectedToolId: String?,
        val tokensDelta: Int,
        val costDeltaCents: Double,
        val toolCallsDelta: Int,
        val schemaVersion: Int,
    )

    /**
     * Rebuild [state] in place, or explain why not.
     *
     * Mutates [state] and [budget] ONLY on the success path, so a refusal leaves a
     * pristine loop for the caller to run normally.
     */
    /**
     * Rebuild loop state from the persisted transcript.
     *
     * @param upToIteration Restore only iterations `1..upToIteration` and resume at
     *   `upToIteration + 1`. Null — the default, and what every RESUME passes —
     *   restores everything settled, which is today's behaviour exactly.
     *
     *   ── WHY THIS PARAMETER EXISTS AND WHY IT IS NULLABLE ─────────────────
     *   "Replay from iteration 4" is the debugger asking for the loop to be
     *   restored to the state it was in BEFORE iteration 4 and then run live from
     *   there — which is this function with a ceiling. Without it the only
     *   choices are "resume where it stopped" and "start again from 1", and a
     *   debugger that can only do the second is a viewer.
     *
     *   It defaults to null so no resume caller passes it and the resume path is
     *   unchanged by construction. That matters: what happens on resume is on
     *   the list of things not to alter without asking, and an optional ceiling
     *   nobody supplies alters nothing.
     */
    fun reconstruct(
        config: AgentBrainConfig,
        state: AgentLoopState,
        budget: AgentBudget,
        allowed: Boolean,
        enabled: Boolean,
        upToIteration: Int? = null,
    ): Outcome {
        if (!enabled) return Outcome.Skipped(SkipReason.DISABLED)
        if (!allowed)  return Outcome.Skipped(SkipReason.NOT_A_CONTINUATION)
        val ds = dataSource ?: return Outcome.Skipped(SkipReason.NO_PERSISTENCE)

        val rows = try {
            read(ds, config)
        } catch (e: Exception) {
            log.warn("[brain] iteration read failed run={} step={}: {}",
                config.runId, config.stepId, e.message)
            return Outcome.Skipped(SkipReason.READ_FAILED, e.message?.take(200))
        }

        if (rows.isEmpty()) return Outcome.Skipped(SkipReason.NO_ITERATIONS)

        /*
         * A row still `running` is the one a crashed worker was in the middle of.
         * Its action may have been dispatched and its observation lost, so it is not
         * safe to rebuild FROM it — but everything before it is settled. Reconstruct
         * up to N-1 and let N execute again, where the step guard covers any tool
         * call it repeats.
         */
        val allSettled = rows.filter { it.status == "completed" || it.status == "failed" }
        if (allSettled.isEmpty()) return Outcome.Skipped(SkipReason.NO_ITERATIONS)

        /*
         * The ceiling, when the debugger asked for one.
         *
         * Applied BEFORE the contiguity check, so "replay from 4" on a run of ten
         * validates 1..3 and ignores 4..10 — which is the point: everything from
         * the chosen iteration onward is about to be re-executed live, so whether
         * those rows are well-formed is irrelevant.
         *
         * Asking to replay from an iteration the run never reached is a request
         * that cannot be honoured, and refusing loudly beats restoring less than
         * was asked for and running from a different place than the reader chose.
         */
        val settled = when {
            upToIteration == null -> allSettled
            upToIteration <= 1 -> emptyList()
            else -> allSettled.filter { it.iterationNumber < upToIteration }
        }
        if (upToIteration != null && upToIteration - 1 > allSettled.size) {
            return Outcome.Skipped(SkipReason.ITERATION_OUT_OF_RANGE,
                "asked to replay from iteration $upToIteration, but the run only " +
                "settled ${allSettled.size}")
        }
        if (settled.isEmpty()) {
            /* Replay from 1 IS a full replay, and the caller is entitled to it —
               there is simply nothing to restore. */
            return Outcome.Skipped(SkipReason.NO_ITERATIONS)
        }

        /*
         * `skipped` is in the CHECK constraint and has never been written, and the
         * loop persists a row for every iteration before doing anything with it. So
         * the settled numbers run 1..N with no interior holes, and a hole means a row
         * was lost — which would silently remove a step from the model's account of
         * its own history. Refuse.
         */
        val expected = (1..settled.size).toList()
        if (settled.map { it.iterationNumber } != expected) {
            return Outcome.Skipped(SkipReason.NON_CONTIGUOUS,
                "expected 1..${settled.size}, got ${settled.map { it.iterationNumber }.take(20)}")
        }

        settled.firstOrNull { it.schemaVersion > LOOP_SCHEMA_VERSION }?.let {
            return Outcome.Skipped(SkipReason.SCHEMA_VERSION_AHEAD,
                "row ${it.iterationNumber} is version ${it.schemaVersion}, this build reads $LOOP_SCHEMA_VERSION")
        }

        /*
         * The pre-V040 test. Old rows have every new column NULL, so they carry a
         * summary but not the action that produced it — enough to display, not
         * enough to continue from. This is what makes an in-flight run written by
         * the previous build resume without error.
         */
        settled.firstOrNull { it.actionJson.isNullOrBlank() }?.let {
            return Outcome.Skipped(SkipReason.PRE_V040_ROWS,
                "iteration ${it.iterationNumber} has no persisted action")
        }

        // ── Build, into locals first ──────────────────────────────────────────
        val observations = mutableListOf<AgentObservation>()
        var lastAction: AgentAction? = null
        var tokens = 0
        var cost = 0.0
        var toolCalls = 0

        for (row in settled) {
            val action = try {
                mapper.readValue(row.actionJson, AgentAction::class.java)
            } catch (e: Exception) {
                return Outcome.Skipped(SkipReason.MALFORMED_ROW,
                    "iteration ${row.iterationNumber}: ${e.message?.take(120)}")
            }
            lastAction = action

            /*
             * The payload is what the model actually READS on the next iteration —
             * the tool's values, not a description of them. A missing payload is not
             * fatal: the summary still conveys what happened, and losing the values
             * degrades the prompt rather than falsifying it. A missing ACTION would
             * falsify it, which is why that one refuses above and this one does not.
             */
            val payload = row.observationPayloadRef?.let { ref ->
                payloads?.load(ref) ?: run {
                    log.info("[brain] observation payload {} unavailable — restoring summary only",
                        ref.take(12))
                    null
                }
            }

            if (action.type != AgentAction.ActionType.FINAL) {
                observations.add(AgentObservation(
                    iterationNumber = row.iterationNumber,
                    actionType      = action.type.name,
                    toolId          = row.selectedToolId ?: action.toolId,
                    sanitizedSummary = row.observationSummary
                        ?: row.thoughtSummary ?: "(no summary recorded)",
                    /* Defaulting to the row's status is the honest read for an old
                       row; for a V040 row the column is authoritative. The
                       repeated-failure stop compares this, so it must be exact. */
                    success = row.observationSuccess ?: (row.status == "completed"),
                    payload = payload,
                ))
            }

            tokens += row.tokensDelta
            cost += row.costDeltaCents
            toolCalls += row.toolCallsDelta
        }

        // ── Commit to the live state, only now that nothing can refuse ────────
        observations.forEach { state.addObservation(it) }
        state.lastAction = lastAction
        state.iteration = settled.size

        /*
         * CONSUMPTION CARRIES OVER, LIVENESS RESETS.
         *
         * Tokens, cost, tool calls and iterations bound SPEND. They are cumulative
         * across the whole run and must survive a resume, or a run that resumes ten
         * times never reaches its iteration ceiling and bills ten times its budget.
         *
         * Wall clock bounds HANG DETECTION and is per-execution. `budget.startedAt`
         * is deliberately left at now(): an approval that sat overnight would
         * otherwise blow `timeoutMs` the instant it resumed, which is exactly the
         * cost this whole change exists to remove. The codebase already draws this
         * line — WORKER_MAX_RUN_DURATION_MS defaults to unlimited because waiting at
         * a gate is the product, and the run ceiling measures active duration rather
         * than wall clock.
         */
        budget.iterationsUsed    = settled.size
        budget.toolCallsUsed     = toolCalls
        budget.tokensUsed        = tokens
        budget.estimatedCostCents = cost

        log.info("[brain] reconstructed {} iteration(s) run={} step={} — resuming at {} " +
            "(tokens={}, toolCalls={})",
            settled.size, config.runId, config.stepId, settled.size + 1, tokens, toolCalls)

        return Outcome.Reconstructed(
            resumeFromIteration  = settled.size + 1,
            observationsRestored = observations.size,
            tokensRestored       = tokens,
        )
    }

    /**
     * Preserve the transcript before a fallback overwrites it.
     *
     * `persistIterationStart` upserts with `DO UPDATE SET action_type = NULL, …`, so
     * a replay from iteration 1 blanks rows 1..N as it goes. Before V040 those rows
     * held only a summary and little was lost. They now hold the action, the
     * observation and the budget deltas — the debugger's iteration inspector data,
     * and the input to any LATER reconstruction. So one transient failure would
     * destroy the evidence of what happened AND guarantee every subsequent resume
     * also falls back.
     *
     * One write into the payload store, ref carried on the skip event. No schema
     * change, no constraint change, and the transcript survives.
     */
    fun snapshotBeforeFallback(config: AgentBrainConfig): String? {
        val ds = dataSource ?: return null
        val store = payloads ?: return null
        return try {
            val rows = read(ds, config)
            if (rows.isEmpty()) return null
            store.capture(
                workspaceId = config.workspaceId,
                content = mapper.writeValueAsString(mapOf(
                    "runId" to config.runId.toString(),
                    "stepId" to config.stepId,
                    "capturedAt" to java.time.Instant.now().toString(),
                    "reason" to "loop reconstruction fell back to replay; " +
                        "these rows are about to be overwritten by the replayed iterations",
                    "iterations" to rows.map {
                        mapOf(
                            "iteration" to it.iterationNumber,
                            "status" to it.status,
                            "action" to it.actionJson,
                            "thought" to it.thoughtSummary,
                            "observation" to it.observationSummary,
                            "observationSuccess" to it.observationSuccess,
                            "observationPayloadRef" to it.observationPayloadRef,
                            "tokensDelta" to it.tokensDelta,
                            "costDeltaCents" to it.costDeltaCents,
                            "toolCallsDelta" to it.toolCallsDelta,
                        )
                    },
                )),
                contentType = PayloadStore.JSON,
            )?.ref
        } catch (e: Exception) {
            log.warn("[brain] transcript snapshot failed run={}: {}", config.runId, e.message)
            null
        }
    }

    private fun read(ds: DataSource, config: AgentBrainConfig): List<Row> =
        ds.connection.use { conn ->
            conn.prepareStatement(
                """SELECT iteration_number, status, action_json_sanitized::text AS action_json,
                          thought_summary_sanitized, observation_summary_sanitized,
                          observation_success, observation_payload_ref, selected_tool_id,
                          tokens_delta, cost_delta_cents, tool_calls_delta, loop_schema_version
                     FROM agent_iterations
                    WHERE run_id = ? AND step_id = ?
                    ORDER BY iteration_number
                    LIMIT $MAX_ROWS"""
            ).use { stmt ->
                stmt.setObject(1, config.runId)
                stmt.setString(2, config.stepId)
                stmt.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) {
                            add(Row(
                                iterationNumber = rs.getInt("iteration_number"),
                                status = rs.getString("status"),
                                actionJson = rs.getString("action_json"),
                                thoughtSummary = rs.getString("thought_summary_sanitized"),
                                observationSummary = rs.getString("observation_summary_sanitized"),
                                observationSuccess = rs.getObject("observation_success") as? Boolean,
                                observationPayloadRef = rs.getString("observation_payload_ref"),
                                selectedToolId = rs.getString("selected_tool_id"),
                                tokensDelta = rs.getInt("tokens_delta"),
                                costDeltaCents = rs.getBigDecimal("cost_delta_cents")?.toDouble() ?: 0.0,
                                toolCallsDelta = rs.getInt("tool_calls_delta"),
                                schemaVersion = rs.getInt("loop_schema_version"),
                            ))
                        }
                    }
                }
            }
        }
}
