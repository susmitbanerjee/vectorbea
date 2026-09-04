package com.vectorbea.api.routes

import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * One activation's iterations, as the inspector needs them.
 *
 * ── WHY THIS READS `agent_iterations` AND NOT THE SPAN TREE ─────────────────
 * A span records that something took time. An ITERATION records what the agent
 * decided and what came back — the parsed action, the observation, the tool
 * result, the budget delta — and that is a different table for a good reason:
 * it is also what a resume reconstructs from, so it has to be complete enough
 * to continue the loop, not just to draw it.
 *
 * Reconstructing that from spans would mean inferring the action type from a
 * span name and the observation from nothing at all.
 *
 * ── WHY NO PAYLOAD CONTENT CROSSES THIS BOUNDARY ────────────────────────────
 * Prompts and model responses are refs here, never values. A 40-iteration
 * activation is 40 prompts of maybe 12,000 characters each; inlining them would
 * be a megabyte on a view where the reader opens perhaps one. The refs carry
 * enough to render the collapsed state honestly — size, whether it was
 * truncated, what was redacted — and the content is fetched when asked for.
 */
class IterationReader(private val ds: DataSource) {

    private companion object {
        /**
         * How many recent successful activations the baseline is drawn from.
         *
         * Bounded because an agent edited last month is a different agent in every
         * way that matters, and a median over its whole history compares today's
         * behaviour against a prompt nobody is running any more.
         */
        const val BASELINE_WINDOW = 20

        /** Below this there is no typical, only a previous value. */
        const val MIN_BASELINE_SAMPLE = 3
    }


    /** One iteration, everything except payload content. */
    data class Iteration(
        val id: String,
        val number: Int,
        val status: String,
        /** THINK · CALL_TOOL · FINAL · DELEGATE … Null while still running. */
        val actionType: String?,
        val thought: String?,
        val observation: String?,
        val observationSuccess: Boolean?,
        val startedAt: Instant,
        val completedAt: Instant?,
        val durationMs: Long?,
        val tokensDelta: Int?,
        val costDeltaCents: Double?,
        /** The action AS PARSED, sanitized, straight from the row. */
        val actionJson: String?,
        /**
         * The runtime built this action because the response would not parse.
         *
         * Null means the row predates the column, which is NOT false: an older
         * worker's rows must not claim the model chose to think.
         */
        val actionRepaired: Boolean?,
        val selectedToolId: String?,
        /**
         * The tool's HUMAN name, joined at read time.
         *
         * The Activity view composes a sentence about what the agent did, and a
         * uuid cannot appear in one. Read here rather than resolved in the browser
         * because the browser would need a second request per distinct tool and
         * would render "loading" inside a narrative line.
         */
        val toolName: String?,
        /** The guard replayed a previous identical call rather than executing. */
        val toolResultCached: Boolean?,
        val toolResultRef: String?,
        val observationPayloadRef: String?,
        /** The model call beneath this iteration, if its span was recorded. */
        val llmCall: CallSpan?,
        val toolCall: CallSpan?,
        /** What the context assembler dropped to fit this prompt. */
        val context: ContextFit?,
        /**
         * Restored from the transcript on resume rather than executed this time.
         *
         * Seeing the same iteration twice with no way to tell which is which is
         * the confusion this exists to prevent.
         */
        val recalled: Boolean,
    )

    /** A span under an iteration, with its payload REFS but not their content. */
    data class CallSpan(
        val spanId: String,
        val name: String,
        val status: String,
        val durationMs: Int?,
        val hasInput: Boolean,
        val hasOutput: Boolean,
        val inputBytes: Int?,
        val outputBytes: Int?,
        val tokensIn: Int?,
        val tokensOut: Int?,
    )

    /**
     * What the assembler had to leave out.
     *
     * Named sections, not a boolean: "context was truncated" tells the reader
     * something is missing but not what, and the whole diagnostic value is in
     * WHICH sections went — an agent that "ignored" an instruction it was never
     * shown is the hardest agent failure to diagnose.
     */
    data class ContextFit(
        val truncated: Boolean,
        val droppedSections: List<String>,
        val charsUsed: Int?,
        val charBudget: Int?,
        val overBudget: Boolean,
    )

    /** Allocated against consumed, so "it ran out of iterations" is read. */
    data class Budget(
        val dimension: String,
        val used: Double,
        val limit: Double?,
    )

    data class Activation(
        val id: String?,
        val stepId: String,
        val agentId: String?,
        val agentName: String?,
        val status: String?,
        val stopReason: String?,
        val budgets: List<Budget>,
        val iterations: List<Iteration>,
        /**
         * Set when reconstruction failed and the loop replayed from iteration 1.
         *
         * A reader seeing iteration 3 twice deserves to know the second one is a
         * replay and why the first could not be reused.
         */
        val replayedFrom: ReplayNote?,
        /**
         * What this agent usually takes, when it succeeds.
         *
         * Null is the common and correct answer: an agent nobody has run
         * successfully yet has no typical, and inventing one would flag every
         * early run as abnormal. Absence is rendered as saying nothing.
         */
        val baseline: Baseline?,
    )

    /**
     * The step count a reader should compare this activation against.
     *
     * MEDIAN, not mean: one runaway 60-step activation in the sample would drag a
     * mean far enough that the next runaway looks ordinary, which is precisely
     * the case the signal exists to catch.
     *
     * [sampleRuns] travels with it because "typical is 3" means something
     * different over 19 runs than over 3, and a reader deciding whether to
     * investigate deserves to see which one they have.
     */
    data class Baseline(val typicalSteps: Int, val sampleRuns: Int)

    data class ReplayNote(val reason: String, val detail: String?)

    // ── Reading ─────────────────────────────────────────────────────────────

    /**
     * Every activation in a run that has iterations, newest column set last.
     *
     * Workspace-scoped in the SQL rather than filtered afterwards: the run is
     * already authorised by the route, and re-stating the workspace here keeps
     * the predicate next to the read for anyone auditing it later.
     */
    fun activations(runId: UUID, wsId: UUID): List<Activation> {
        val read = readIterations(runId, wsId)
        val rows = read.byStep
        if (rows.isEmpty()) return emptyList()

        val spans = readCallSpans(runId, wsId)
        val payloadSizes = readPayloadSizes(runId, wsId)
        val budgets = readBudgets(runId, wsId)
        val recall = readRecall(runId, wsId)
        val baselines = readBaselines(runId, wsId, read.agentIdByStep.values.toSet())

        return rows.entries
            .sortedBy { it.value.firstOrNull()?.startedAt ?: Instant.EPOCH }
            .map { (stepId, iters) ->
                val note = recall[stepId]
                val resumeFrom = note?.resumeFromIteration
                val b = budgets[stepId]
                val agentId = read.agentIdByStep[stepId]
                Activation(
                    id = b?.activationId,
                    stepId = stepId,
                    agentId = agentId,
                    agentName = b?.agentName ?: spans.agentNameFor(stepId),
                    status = b?.status,
                    stopReason = b?.stopReason,
                    budgets = b?.budgets.orEmpty(),
                    replayedFrom = note?.replay,
                    baseline = agentId?.let { baselines[it] },
                    iterations = iters.map { r ->
                        r.copy(
                            llmCall = spans.llmFor(stepId, r.number)?.withSizes(payloadSizes),
                            toolCall = spans.toolFor(stepId, r.number)?.withSizes(payloadSizes),
                            context = spans.contextFor(stepId, r.number),
                            /* Everything before the resume point was restored from
                               the transcript, not executed on this attempt. */
                            recalled = resumeFrom != null && r.number < resumeFrom,
                        )
                    },
                )
            }
    }

    /** The iterations of a run, plus which agent each step belongs to. */
    private data class Rows(
        val byStep: Map<String, List<Iteration>>,
        val agentIdByStep: Map<String, String>,
    )

    private fun readIterations(runId: UUID, wsId: UUID): Rows =
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT i.id, i.step_id, i.agent_id, i.iteration_number, i.status,
                          i.action_type,
                          i.thought_summary_sanitized, i.observation_summary_sanitized,
                          i.observation_success, i.started_at, i.completed_at,
                          i.tokens_delta, i.cost_delta_cents,
                          i.action_json_sanitized::text AS action_json_sanitized,
                          i.selected_tool_id, i.tool_result_ref, i.observation_payload_ref,
                          i.action_repaired, i.tool_result_cached,
                          t.name AS tool_name
                     FROM agent_iterations i
                     /* LEFT, and workspace-scoped on both sides. A deleted tool must
                        still render its iterations — losing the row because somebody
                        tidied up a tool six weeks later would delete history. The
                        workspace predicate is repeated here rather than trusted from
                        the iteration: a join is a second lookup, and invariant 8 says
                        every lookup is scoped at its own boundary. */
                LEFT JOIN tools t
                       ON t.id = i.selected_tool_id
                      AND t.workspace_id = i.workspace_id
                    WHERE i.run_id = ? AND i.workspace_id = ?
                    ORDER BY i.step_id, i.iteration_number"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    val out = LinkedHashMap<String, MutableList<Iteration>>()
                    val agents = LinkedHashMap<String, String>()
                    while (rs.next()) {
                        val started = rs.getTimestamp("started_at").toInstant()
                        val completed = rs.getTimestamp("completed_at")?.toInstant()
                        val step = rs.getString("step_id")
                        rs.getObject("agent_id", UUID::class.java)?.let { agents[step] = it.toString() }
                        out.getOrPut(step) { mutableListOf() }.add(Iteration(
                            id = rs.getObject("id", UUID::class.java).toString(),
                            number = rs.getInt("iteration_number"),
                            status = rs.getString("status"),
                            actionType = rs.getString("action_type"),
                            thought = rs.getString("thought_summary_sanitized"),
                            observation = rs.getString("observation_summary_sanitized"),
                            observationSuccess = rs.getObject("observation_success") as? Boolean,
                            startedAt = started,
                            completedAt = completed,
                            durationMs = completed?.let { it.toEpochMilli() - started.toEpochMilli() },
                            tokensDelta = rs.getObject("tokens_delta") as? Int,
                            costDeltaCents = (rs.getObject("cost_delta_cents") as? java.math.BigDecimal)?.toDouble(),
                            actionJson = rs.getString("action_json_sanitized"),
                            actionRepaired = rs.getObject("action_repaired") as? Boolean,
                            selectedToolId = rs.getObject("selected_tool_id", UUID::class.java)?.toString(),
                            toolName = rs.getString("tool_name"),
                            toolResultCached = rs.getObject("tool_result_cached") as? Boolean,
                            toolResultRef = rs.getString("tool_result_ref"),
                            observationPayloadRef = rs.getString("observation_payload_ref"),
                            llmCall = null, toolCall = null, context = null, recalled = false,
                        ))
                    }
                    Rows(out, agents)
                }
            }
        }

    /** The spans beneath each iteration, keyed by (step, iteration). */
    private class Spans(
        val llm: Map<Pair<String, Int>, CallSpan>,
        val tool: Map<Pair<String, Int>, CallSpan>,
        val context: Map<Pair<String, Int>, ContextFit>,
        val agentNames: Map<String, String>,
    ) {
        fun llmFor(step: String, n: Int) = llm[step to n]
        fun toolFor(step: String, n: Int) = tool[step to n]
        fun contextFor(step: String, n: Int) = context[step to n]
        fun agentNameFor(step: String) = agentNames[step]
    }

    /**
     * Model and tool spans, matched to their iteration.
     *
     * Matched through the ITERATION span rather than by timestamp: an agent that
     * calls the same tool in iterations two and five produces two spans whose
     * only reliable difference is their parent, and a time-window match would
     * happily attribute one to the other on a fast loop.
     */
    /**
     * What each agent usually takes, from runs that SUCCEEDED.
     *
     * ── WHY SUCCESSFUL RUNS ONLY ────────────────────────────────────────────
     * The question a reader is asking is "should 14 steps worry me", and the
     * comparison that answers it is against the runs where this agent did the
     * job. Failed runs are full of retry loops and budget exhaustion — averaging
     * them in raises the bar until nothing looks abnormal, which is the same as
     * having no signal.
     *
     * ── WHY A MEDIAN OVER ACTIVATIONS, NOT OVER RUNS ────────────────────────
     * One run can activate the same agent several times. Counting per run would
     * add those together and compare a single activation against a sum.
     * Grouped by (run, step), each sample is one activation, which is the thing
     * on the screen.
     *
     * ── WHY THE SAMPLE FLOOR ────────────────────────────────────────────────
     * Below [MIN_BASELINE_SAMPLE] there is no typical, only a previous value.
     * Returning one would flag the second run an agent ever makes, and a signal
     * that fires on new agents is a signal people learn to ignore.
     *
     * Fails to an empty map, never to an error: a baseline is an aid to reading
     * the activity, and losing the whole view because a statistic could not be
     * computed would be a bad trade.
     */
    private fun readBaselines(runId: UUID, wsId: UUID, agentIds: Set<String>): Map<String, Baseline> {
        if (agentIds.isEmpty()) return emptyMap()
        val uuids = agentIds.mapNotNull { runCatching { UUID.fromString(it) }.getOrNull() }
        if (uuids.isEmpty()) return emptyMap()

        return runCatching {
            ds.connection.use { c ->
                c.prepareStatement(
                    """WITH per_activation AS (
                           SELECT i.agent_id      AS agent_id,
                                  count(*)::int   AS steps,
                                  max(i.started_at) AS at
                             FROM agent_iterations i
                             JOIN agent_runs r
                               ON r.id = i.run_id
                              AND r.workspace_id = i.workspace_id
                            WHERE i.workspace_id = ?
                              AND i.agent_id = ANY (?)
                              AND i.run_id <> ?
                              AND r.status = 'succeeded'
                            GROUP BY i.agent_id, i.run_id, i.step_id
                       ), recent AS (
                           SELECT agent_id, steps,
                                  row_number() OVER (
                                      PARTITION BY agent_id ORDER BY at DESC
                                  ) AS rn
                             FROM per_activation
                       )
                       SELECT agent_id,
                              percentile_disc(0.5) WITHIN GROUP (ORDER BY steps)::int AS typical,
                              count(*)::int AS sample
                         FROM recent
                        WHERE rn <= $BASELINE_WINDOW
                        GROUP BY agent_id"""
                ).use { st ->
                    st.setObject(1, wsId)
                    st.setArray(2, c.createArrayOf("uuid", uuids.toTypedArray()))
                    st.setObject(3, runId)
                    st.executeQuery().use { rs ->
                        val out = HashMap<String, Baseline>()
                        while (rs.next()) {
                            val sample = rs.getInt("sample")
                            if (sample < MIN_BASELINE_SAMPLE) continue
                            out[rs.getObject("agent_id", UUID::class.java).toString()] =
                                Baseline(typicalSteps = rs.getInt("typical"), sampleRuns = sample)
                        }
                        out
                    }
                }
            }
        }.getOrDefault(emptyMap())
    }

    private fun readCallSpans(runId: UUID, wsId: UUID): Spans {
        val llm = HashMap<Pair<String, Int>, CallSpan>()
        val tool = HashMap<Pair<String, Int>, CallSpan>()
        val context = HashMap<Pair<String, Int>, ContextFit>()
        val agents = HashMap<String, String>()

        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT s.span_id, s.parent_span_id, s.kind, s.name, s.status,
                          s.duration_ms, s.step_id, s.iteration_index,
                          s.input_ref, s.output_ref, s.tokens_in, s.tokens_out,
                          s.attributes_json::text AS attrs
                     FROM run_spans s
                    WHERE s.run_id = ? AND s.workspace_id = ?
                      AND s.kind IN ('iteration','llm_call','tool_call','activation')"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    /* Two passes: the first learns which span id is which
                       iteration, the second attributes the calls under them. */
                    data class Row(
                        val id: UUID, val parent: UUID?, val kind: String, val name: String,
                        val status: String, val ms: Int?, val step: String?, val idx: Int?,
                        val inRef: String?, val outRef: String?,
                        val tin: Int?, val tout: Int?, val attrs: String?,
                    )
                    val all = buildList {
                        while (rs.next()) add(Row(
                            rs.getObject("span_id", UUID::class.java),
                            rs.getObject("parent_span_id", UUID::class.java),
                            rs.getString("kind"), rs.getString("name"), rs.getString("status"),
                            rs.getObject("duration_ms") as? Int,
                            rs.getString("step_id"), rs.getObject("iteration_index") as? Int,
                            rs.getString("input_ref"), rs.getString("output_ref"),
                            rs.getObject("tokens_in") as? Int, rs.getObject("tokens_out") as? Int,
                            rs.getString("attrs"),
                        ))
                    }

                    val iterationKey = HashMap<UUID, Pair<String, Int>>()
                    all.filter { it.kind == "iteration" }.forEach { r ->
                        val step = r.step ?: return@forEach
                        val n = r.idx ?: return@forEach
                        iterationKey[r.id] = step to n
                        parseContext(r.attrs)?.let { context[step to n] = it }
                    }
                    all.filter { it.kind == "activation" }.forEach { r ->
                        r.step?.let { agents[it] = r.name }
                    }

                    all.forEach { r ->
                        val key = r.parent?.let { iterationKey[it] } ?: return@forEach
                        val call = CallSpan(
                            spanId = r.id.toString(), name = r.name, status = r.status,
                            durationMs = r.ms,
                            hasInput = r.inRef != null, hasOutput = r.outRef != null,
                            inputBytes = null, outputBytes = null,
                            tokensIn = r.tin, tokensOut = r.tout,
                        )
                        when (r.kind) {
                            "llm_call" -> llm[key] = call
                            "tool_call" -> tool[key] = call
                        }
                    }
                }
            }
        }
        return Spans(llm, tool, context, agents)
    }

    /**
     * Payload sizes by span, so a collapsed panel can say "12,400 characters"
     * without fetching 12,400 characters.
     */
    private fun readPayloadSizes(runId: UUID, wsId: UUID): Map<String, Pair<Int?, Int?>> =
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement(
                    """SELECT s.span_id, pi.size_bytes AS in_bytes, po.size_bytes AS out_bytes
                         FROM run_spans s
                    LEFT JOIN run_payloads pi ON pi.ref = s.input_ref  AND pi.workspace_id = s.workspace_id
                    LEFT JOIN run_payloads po ON po.ref = s.output_ref AND po.workspace_id = s.workspace_id
                        WHERE s.run_id = ? AND s.workspace_id = ?
                          AND (s.input_ref IS NOT NULL OR s.output_ref IS NOT NULL)"""
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, wsId)
                    st.executeQuery().use { rs ->
                        buildMap {
                            while (rs.next()) put(
                                rs.getObject("span_id", UUID::class.java).toString(),
                                (rs.getObject("in_bytes") as? Int) to (rs.getObject("out_bytes") as? Int),
                            )
                        }
                    }
                }
            }
        }.getOrDefault(emptyMap())

    private class ActivationFacts(
        val activationId: String?,
        val agentName: String?,
        val status: String?,
        val stopReason: String?,
        val budgets: List<Budget>,
    )

    /**
     * Allocated against consumed, per activation.
     *
     * `budget_allocated_json` is the ceiling the parent granted and
     * `budget_consumed_json` is what was spent, so "it ran out of iterations" is
     * a full bar rather than an inference from a stop reason. A dimension present
     * in consumed but absent from allocated renders with no ceiling instead of a
     * guessed one.
     */
    private fun readBudgets(runId: UUID, wsId: UUID): Map<String, ActivationFacts> =
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement(
                    """SELECT step_id, id, status, stop_reason,
                              budget_allocated_json::text AS alloc,
                              budget_consumed_json::text  AS used,
                              agent_snapshot_json->>'name' AS agent_name
                         FROM agent_activations
                        WHERE run_id = ? AND workspace_id = ?
                        ORDER BY created_at"""
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, wsId)
                    st.executeQuery().use { rs ->
                        buildMap {
                            while (rs.next()) {
                                val alloc = flatNumbers(rs.getString("alloc"))
                                val used = flatNumbers(rs.getString("used"))
                                put(rs.getString("step_id"), ActivationFacts(
                                    activationId = rs.getObject("id", UUID::class.java)?.toString(),
                                    agentName = rs.getString("agent_name"),
                                    status = rs.getString("status"),
                                    stopReason = rs.getString("stop_reason"),
                                    budgets = (used.keys + alloc.keys).sorted().map { k ->
                                        Budget(k, used[k] ?: 0.0, alloc[k])
                                    },
                                ))
                            }
                        }
                    }
                }
            }
        }.getOrDefault(emptyMap())

    private class RecallFacts(val resumeFromIteration: Int?, val replay: ReplayNote?)

    /**
     * What resume did to this step: recalled the transcript, or replayed it.
     *
     * From the events, because reconstruction is a decision the loop makes rather
     * than a row it writes. Both events carry structured metadata precisely so
     * this does not have to read a sentence.
     */
    private fun readRecall(runId: UUID, wsId: UUID): Map<String, RecallFacts> =
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement(
                    """SELECT step_id, type, metadata_json_sanitized::text AS meta
                         FROM run_events
                        WHERE run_id = ? AND workspace_id = ?
                          AND type IN ('AGENT_LOOP_RECONSTRUCTED','AGENT_LOOP_RECONSTRUCTION_SKIPPED')
                        ORDER BY sequence"""
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, wsId)
                    st.executeQuery().use { rs ->
                        val out = HashMap<String, RecallFacts>()
                        while (rs.next()) {
                            val step = rs.getString("step_id") ?: continue
                            val meta = rs.getString("meta")
                            out[step] = if (rs.getString("type") == "AGENT_LOOP_RECONSTRUCTED") {
                                RecallFacts(intField(meta, "resumeFromIteration"), null)
                            } else {
                                RecallFacts(null, ReplayNote(
                                    reason = stringField(meta, "reason") ?: "unknown",
                                    detail = stringField(meta, "detail"),
                                ))
                            }
                        }
                        out
                    }
                }
            }
        }.getOrDefault(emptyMap())

    // ── Small JSON readers ──────────────────────────────────────────────────
    //
    // The blobs here are written by the worker under fixed shapes and are small.
    // A full parse per span on a large trace is real work for three fields, and a
    // malformed blob must degrade to a missing marker, never to a 500 on the page
    // somebody opened because something already went wrong.

    private fun parseContext(json: String?): ContextFit? {
        val j = json ?: return null
        if (!j.contains("context_")) return null
        val truncated = boolField(j, "context_truncated") ?: false
        val over = boolField(j, "context_over_budget") ?: false
        if (!truncated && !over) return null
        return ContextFit(
            truncated = truncated,
            droppedSections = stringArrayField(j, "context_dropped_sections"),
            charsUsed = intField(j, "context_chars"),
            charBudget = intField(j, "context_char_budget"),
            overBudget = over,
        )
    }

    private fun boolField(json: String, key: String): Boolean? =
        Regex("\"$key\"\\s*:\\s*(true|false)").find(json)?.groupValues?.get(1)?.toBooleanStrictOrNull()

    private fun intField(json: String?, key: String): Int? =
        json?.let { Regex("\"$key\"\\s*:\\s*(-?\\d+)").find(it)?.groupValues?.get(1)?.toIntOrNull() }

    private fun stringField(json: String?, key: String): String? =
        json?.let { Regex("\"$key\"\\s*:\\s*\"([^\"]{0,400})\"").find(it)?.groupValues?.get(1) }

    private fun stringArrayField(json: String, key: String): List<String> {
        val body = Regex("\"$key\"\\s*:\\s*\\[([^\\]]{0,600})\\]").find(json)?.groupValues?.get(1)
            ?: return emptyList()
        return Regex("\"([^\"]{1,120})\"").findAll(body).map { it.groupValues[1] }.toList()
    }

    /** `{"tokens": 24000, "iterations": 5}` → a flat map of numbers. */
    private fun flatNumbers(json: String?): Map<String, Double> {
        val j = json ?: return emptyMap()
        return Regex("\"([a-zA-Z_]{1,40})\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)")
            .findAll(j)
            .mapNotNull { m -> m.groupValues[2].toDoubleOrNull()?.let { m.groupValues[1] to it } }
            .toMap()
    }

    private fun CallSpan.withSizes(sizes: Map<String, Pair<Int?, Int?>>): CallSpan {
        val s = sizes[spanId] ?: return this
        return copy(inputBytes = s.first, outputBytes = s.second)
    }
}
