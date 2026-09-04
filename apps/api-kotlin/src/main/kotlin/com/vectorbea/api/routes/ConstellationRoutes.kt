package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.repository.RunRepository
import java.util.UUID
import javax.sql.DataSource

/**
 * The three reads the debugger's v2 views need, beside the span tree.
 *
 * ── WHY THESE ARE NOT SPANS ─────────────────────────────────────────────────
 * `TraceRoutes` answers "what happened, in what order, nested how". The
 * constellation asks a different question: "who asked whom to do what, and
 * why" — which lives in `agent_activations` and `agent_handoffs`, not in the
 * span tree. Deriving it from spans would mean pairing timestamps to guess at
 * edges the database already records exactly, and losing the one field that
 * matters most: the model's stated REASON for each delegation.
 *
 * Every read is workspace-scoped through the same `authorizedRun` guard the
 * trace routes use, because a run id in a URL is not an authorisation.
 */
class ConstellationRoutes(
    private val dataSource: DataSource,
    private val runRepo: RunRepository,
) {
    fun register(router: Router) {
        router.get("/api/runs/:id/constellation", ::constellation)
        router.get("/api/runs/:id/burndown", ::burndown)
        router.get("/api/runs/:id/compare/:otherId", ::compare)
        /* No target given: the view asks who to compare against first. */
        router.get("/api/runs/:id/compare",          ::defaultTarget)
        router.get("/api/runs/:id/replay-options",   ::replayOptions)
        router.get("/api/runs/:id/replays",          ::replayHistory)
    }

    /**
     * The run, and the workspace that may see it.
     *
     * Identical to `TraceRoutes.authorizedRun` and deliberately duplicated
     * rather than shared through a base class: it is six lines, and a shared
     * superclass between route files is how an auth check ends up overridable.
     */
    private fun authorizedRun(req: Request): Pair<UUID, UUID> {
        val ctx = req.context()
        val runId = req.pathUUID("id")
        /* Not Found, never Forbidden — "this exists but is not yours" is itself a
           disclosure, and a run id is guessable enough to matter. Same rule
           TraceRoutes applies, stated here because a reader of this file should
           not have to go and find it. */
        runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")
        return runId to ctx.workspaceId
    }

    // ── §5.3 the handoff constellation ───────────────────────────────────────

    /**
     * Nodes are activations, edges are handoffs.
     *
     * ── WHAT THE UI CANNOT COMPUTE FOR ITSELF ──────────────────────────────
     * Three things, and each is why this endpoint exists rather than the view
     * deriving it from the span tree:
     *
     *  - **`reason`** — the model's stated reason for a delegation, recorded
     *    nowhere else, and the first thing anyone asks when a run went sideways.
     *  - **`joinGroupId`** — what makes five children of one BROADCAST render as
     *    one fan-out rather than five unrelated edges.
     *  - **`blockedReason`** — an activation that was CREATED and never ran.
     *    "Never started because its sibling failed under wait_all" is the most
     *    common "why is nothing happening" question and the hardest to answer
     *    from a log, because the evidence is an ABSENCE: no spans, no events, no
     *    output. Only the status and the join policy together explain it, and
     *    only the server has both.
     */
    private fun constellation(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)

        val activationNodes = dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT a.id, a.parent_activation_id, a.depth, a.status, a.role,
                          a.step_id, a.stop_reason, a.agent_id,
                          COALESCE(ag.name, 'agent') AS agent_name,
                          a.started_at, a.ended_at,
                          COALESCE((a.budget_consumed_json->>'tokens')::bigint, 0)   AS tokens,
                          COALESCE((a.budget_consumed_json->>'costCents')::float, 0) AS cost_cents,
                          COALESCE((a.budget_consumed_json->>'iterations')::int, 0)  AS iterations
                     FROM agent_activations a
                     LEFT JOIN agents ag ON ag.id = a.agent_id
                    WHERE a.run_id = ? AND a.workspace_id = ?
                    ORDER BY a.sequence"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    val out = mutableListOf<Map<String, Any?>>()
                    while (rs.next()) {
                        val status = rs.getString("status")
                        out += mapOf(
                            "id" to rs.getString("id"),
                            "parentId" to rs.getString("parent_activation_id"),
                            "depth" to rs.getInt("depth"),
                            "status" to status,
                            "role" to rs.getString("role"),
                            "stepId" to rs.getString("step_id"),
                            "stopReason" to rs.getString("stop_reason"),
                            "agentId" to rs.getString("agent_id"),
                            "agentName" to rs.getString("agent_name"),
                            "startedAt" to rs.getTimestamp("started_at")?.toInstant()?.toString(),
                            "endedAt" to rs.getTimestamp("ended_at")?.toInstant()?.toString(),
                            "tokens" to rs.getLong("tokens"),
                            "costCents" to rs.getDouble("cost_cents"),
                            "iterations" to rs.getInt("iterations"),
                        )
                    }
                    out
                }
            }
        }

        /*
         * ── WHEN THERE ARE NO ACTIVATION ROWS, DRAW THE AGENT ANYWAY ─────────
         *
         * `agent_activations` is written only on the activation path, which is
         * behind `AGENT_ACTIVATIONS_ENABLED` and off by default — so a perfectly
         * ordinary single-agent run has iterations and no activation row, and
         * this view used to answer it with an apology naming an environment
         * variable. That is the wrong answer twice over: it tells somebody
         * reading their run about our deployment configuration, and it implies
         * nothing is known about the agent when in fact everything on this card
         * is recorded.
         *
         * `agent_iterations` carries the agent, the step, the timings and the
         * budget deltas. So the node is built from that instead — the same run,
         * the same numbers, from the record that exists.
         *
         * WHAT IS NOT INVENTED: the derived node has no `stopReason` (nothing
         * recorded one) and there are no EDGES, because handoffs live in
         * `agent_handoffs` and are written on the same path. `derived` travels
         * with the response so the view can say that rather than let a reader
         * conclude a multi-agent run had no handoffs.
         */
        val derived = activationNodes.isEmpty()
        val nodes = if (!derived) activationNodes else derivedNodes(runId, wsId)

        val edges = dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT h.id, h.from_activation_id, h.to_activation_id, h.kind, h.reason,
                          h.contract_hash, h.join_group_id, h.created_at,
                          h.contract_json::text AS contract,
                          t.output_json::text   AS output
                     FROM agent_handoffs h
                     LEFT JOIN agent_activations t ON t.id = h.to_activation_id
                    WHERE h.run_id = ? AND h.workspace_id = ?
                    ORDER BY h.created_at, h.id"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    val out = mutableListOf<Map<String, Any?>>()
                    while (rs.next()) out += mapOf(
                        "id" to rs.getString("id"),
                        "from" to rs.getString("from_activation_id"),
                        "to" to rs.getString("to_activation_id"),
                        "kind" to rs.getString("kind"),
                        "reason" to rs.getString("reason"),
                        "contractHash" to rs.getString("contract_hash"),
                        "joinGroupId" to rs.getString("join_group_id"),
                        "createdAt" to rs.getTimestamp("created_at")?.toInstant()?.toString(),
                        /* Contract sent and output returned, so the UI can show
                           them side by side on hover without a second round trip
                           per edge — which on a 12-node tree is 12 requests to
                           answer one hover. */
                        "contract" to rs.getString("contract"),
                        "output" to rs.getString("output"),
                    )
                    out
                }
            }
        }

        /*
         * ── CYCLES ARE COUNTED HERE, NOT DRAWN HERE ─────────────────────────
         *
         * A cycle in this graph is a REPEATED EDGE between the same two agents
         * with the same contract — which is exactly the triple `HANDOFF_LOOP`
         * counts. Grouping by it on the server means the view renders one loop
         * with a hit counter rather than N overlapping edges, and the number it
         * shows is the same number the guard used, rather than one the UI
         * recomputed and could disagree about.
         */
        val cycles = edges
            .groupBy { Triple(agentOf(nodes, it["from"]), agentOf(nodes, it["to"]), it["contractHash"]) }
            .filterValues { it.size > 1 }
            .map { (key, group) ->
                mapOf(
                    "fromAgent" to key.first,
                    "toAgent" to key.second,
                    "contractHash" to key.third,
                    "hits" to group.size,
                    "edgeIds" to group.map { it["id"] },
                    "kind" to group.first()["kind"],
                )
            }

        /*
         * ── THE ROOT CAUSE, MARKED ON THE ACTIVATION THAT OWNS IT ───────────
         *
         * `run_spans.is_root_cause` is set on the SPAN that broke, which is
         * usually a tool or model call several levels below the activation the
         * reader needs to look at. Walking up to the owning activation is a join
         * the client cannot do — it has no span tree here — and getting it wrong
         * means ringing the wrong agent.
         *
         * `activation_id` is carried on every span written inside an activation,
         * so the walk is a lookup rather than a traversal.
         */
        val rootCauseActivations = runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT DISTINCT activation_id
                         FROM run_spans
                        WHERE run_id = ? AND workspace_id = ?
                          AND is_root_cause IS TRUE AND activation_id IS NOT NULL"""
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, wsId)
                    st.executeQuery().use { rs ->
                        buildSet { while (rs.next()) add(rs.getString("activation_id")) }
                    }
                }
            }
        }.getOrDefault(emptySet())

        /*
         * ── THE PATH FROM THE ROOT TO IT ────────────────────────────────────
         * Emphasised in the view, so the eye follows the delegation chain that
         * ended in the failure rather than scanning every node. Computed here
         * because the parent links are already in hand and the answer is the
         * same for every viewer.
         */
        val rootCausePath = rootCausePath(
            parentOf = nodes.associate { it["id"] as String to it["parentId"] as String? },
            from = rootCauseActivations,
        )

        /* The parent's stop reason is what explains a sibling's absence, and it
           is only in hand once every row has been read — so `blockedReason` is
           resolved here rather than inside the cursor. */
        val stopReasonOf = nodes.associate { it["id"] as String to it["stopReason"] as String? }

        val nodesWithCause = nodes.map { n ->
            n + mapOf(
                "isRootCause" to (n["id"] in rootCauseActivations),
                "onRootCausePath" to (n["id"] in rootCausePath),
                "blockedReason" to blockedReason(
                    status = n["status"] as String?,
                    stopReason = n["stopReason"] as String?,
                    parentStopReason = (n["parentId"] as String?)?.let { stopReasonOf[it] },
                ),
            )
        }

        return Response.ok(mapOf(
            "runId" to runId.toString(),
            "nodes" to nodesWithCause,
            "edges" to edges,
            "cycles" to cycles,
            /*
             * ── WHY THERE ARE NO NODES, WHEN THERE ARE NONE ─────────────────
             *
             * An empty constellation had one explanation in the UI — "this run
             * predates the agent harness" — and it is usually false. The common
             * cause is that `AGENT_ACTIVATIONS_ENABLED` is off, which is its
             * default and is set in no environment file in this repository: the
             * single-agent path then takes the pre-activation branch and writes no
             * `agent_activations` row at all, while `agent_iterations` is written
             * either way. That is exactly the reported symptom — Iterations
             * populated, Agents empty, on a run that succeeded.
             *
             * Guessing wrongly here is worse than saying nothing, because it sends
             * somebody to look for data that was never written and tells them
             * their run is old when it ran this morning. So the cause is
             * DETERMINED from what the run actually left behind:
             *
             *   `no_agent_steps`      no iterations either — this run had no agent
             *                         step, and an empty constellation is correct.
             *   `activations_disabled` iterations exist and activations do not, so
             *                         the flag was off when it ran.
             *   null                  there are nodes; nothing to explain.
             */
            "derived" to derived,
            "emptyCause" to if (nodesWithCause.isNotEmpty()) null
                            else emptyCause(runId, wsId),
            /*
             * ── WHAT THE GUARD ACTUALLY DOES TODAY ──────────────────────────
             * `HANDOFF_LOOP` is a defined stop reason with NO construction site
             * in the runtime: joins, fan-out and the loop guard land in a later
             * phase (see AgentLoopState.StopReason). So a repeated edge is real
             * and worth showing, but claiming a guard stopped it would be a
             * sentence the data cannot support.
             *
             * Sent as a fact about the SYSTEM rather than about this run, so the
             * view can say "the guard that would catch this is not enforced yet"
             * instead of inventing a bound.
             */
            "loopGuard" to mapOf(
                "name" to "HANDOFF_LOOP",
                "rule" to "the same (from agent, to agent, contract) triple repeated",
                "enforced" to false,
            ),
        ))
    }

    companion object {
        /**
         * The loop-state format this build can rebuild from.
         *
         * Mirrors `AgentLoopReconstructor.LOOP_SCHEMA_VERSION` in the worker. They
         * are in different modules and cannot share a constant today; a run whose
         * rows are ahead of this cannot be replayed from an iteration here, which
         * is the same verdict the worker reaches.
         */
        const val SUPPORTED_LOOP_SCHEMA_VERSION = 1

        /** Mirrors `RunRoutes.RETRYABLE_STATUSES`. */
        val RETRYABLE_RUN_STATUSES = setOf("failed", "enqueue_failed", "timed_out")

        /**
         * Every activation from the root cause up to the run's first activation.
         *
         * ── WHY IT WALKS UP AND NOT DOWN ────────────────────────────────────
         * The question is "how did the run get here", and the answer is the chain
         * of delegations that led to the failure — not everything the failing
         * agent went on to do. Walking down from the root would emphasise
         * siblings that had nothing to do with it.
         *
         * Cycle-safe: a parent chain that loops back on itself would otherwise
         * hang the request, and a delegation graph is exactly the kind that can.
         */
        internal fun rootCausePath(
            parentOf: Map<String, String?>,
            from: Set<String>,
        ): Set<String> {
            val path = LinkedHashSet<String>()
            from.forEach { start ->
                var cur: String? = start
                val seen = HashSet<String>()
                while (cur != null && seen.add(cur)) {
                    path += cur
                    cur = parentOf[cur]
                }
            }
            return path
        }
    }

    /** The agent behind an activation id, so a cycle is keyed on agents. */
    private fun agentOf(nodes: List<Map<String, Any?>>, activationId: Any?): String? =
        nodes.firstOrNull { it["id"] == activationId }?.get("agentName") as? String

    /**
     * Why an activation never produced anything, when that is the case.
     *
     * Null for every activation that ran. Non-null is the sentence the view puts
     * on a greyed node, and it exists because the alternative — a node with no
     * spans and no output — is indistinguishable from a rendering bug.
     */
    private fun blockedReason(
        status: String?,
        stopReason: String?,
        /** The parent's stop reason, which is what explains a sibling's absence. */
        parentStopReason: String? = null,
    ): String? = when {
        /*
         * ── THE SIBLING CASE, WHICH IS THE ONE PEOPLE ASK ABOUT ─────────────
         * "Never started because its sibling failed under wait_all" is the most
         * common "why is nothing happening" question, and the evidence is an
         * ABSENCE: no spans, no events, no output. Only the child's status and
         * the PARENT's stop reason together explain it.
         *
         * Named from the parent's actual stop reason rather than assuming a join
         * policy: `CHILD_FAILED` is the runtime's own word for "a child failed
         * and the join could not proceed without it".
         */
        status == "cancelled" && parentStopReason == "CHILD_FAILED" ->
            "Never started — a sibling failed and the join could not proceed without it."
        status == "cancelled" && parentStopReason == "JOIN_DEADLOCK" ->
            "Never started — the join it belonged to could never be satisfied."
        status == "cancelled" && stopReason == null ->
            "Never started — the run stopped before this branch was reached."
        status == "cancelled" ->
            "Cancelled before it finished ($stopReason)."
        status == "pending" ->
            "Created but never started. The run ended before it was reached."
        status == "waiting_for_child" ->
            "Still waiting on work it delegated."
        status == "handed_off" ->
            "Transferred control to another agent — neither succeeded nor failed."
        else -> null
    }

    // ── §5.6 the burn-down ───────────────────────────────────────────────────

    /**
     * Cost, tokens and iterations over run time, one band per activation.
     *
     * ── ONE PAYLOAD, THREE AXES ─────────────────────────────────────────────
     * The view toggles between the three on the same axis, so fetching one at a
     * time would make the toggle a network round-trip and the chart flicker.
     * They are the same rows with different columns; sending all three costs
     * almost nothing and makes the toggle instant.
     *
     * Points come from SPANS rather than from the activation rows, because the
     * question is "when was this spent" and only a span has a timestamp. An
     * activation's totals answer "how much", which the constellation already has.
     */
    private fun burndown(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)

        /*
         * The metered spans. `iteration` spans contribute one iteration and NO
         * tokens — the tokens are on the `llm_call` inside them, and counting
         * both would double every figure on the chart.
         */
        val samples = dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT s.activation_id, s.started_at, s.kind,
                          COALESCE(s.tokens_in,0) + COALESCE(s.tokens_out,0) AS tokens,
                          COALESCE(s.cost_cents,0) AS cost_cents
                     FROM run_spans s
                    WHERE s.run_id = ? AND s.workspace_id = ?
                      AND s.kind IN ('llm_call','tool_call','iteration')
                    ORDER BY s.started_at"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(BurndownReader.Sample(
                            activationId = rs.getString("activation_id"),
                            at = rs.getTimestamp("started_at").toInstant(),
                            tokens = rs.getLong("tokens"),
                            costCents = rs.getDouble("cost_cents"),
                            iterations = if (rs.getString("kind") == "iteration") 1 else 0,
                        ))
                    }
                }
            }
        }

        /* Who each band belongs to. A band labelled by a uuid answers nothing —
           "why did this cost 31 cents" wants a NAME. */
        val members = dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT a.id, a.role, a.depth, COALESCE(ag.name, 'agent') AS agent_name
                     FROM agent_activations a
                     LEFT JOIN agents ag ON ag.id = a.agent_id
                    WHERE a.run_id = ? AND a.workspace_id = ?"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(BurndownReader.Member(
                            id = rs.getString("id"),
                            agentName = rs.getString("agent_name"),
                            role = rs.getString("role"),
                            depth = rs.getInt("depth"),
                        ))
                    }
                }
            }
        }

        /*
         * ── THE CEILINGS, FROM THE TIGHTEST BINDING SOURCE ──────────────────
         * Three of them, and they are not interchangeable:
         *
         *   workspace  the usage policy — the outer limit, always present.
         *   run        the run's own ceiling, if one was set.
         *   team       what the ROOT activation was granted, which is the limit
         *              a delegating run actually hits first.
         *
         * All three are drawn, because "this run cost 40 of its 100" is a
         * different sentence depending on whose 100 it was, and a chart that
         * shows only the loosest one explains nothing about a run that stopped.
         */
        val ceilings = mutableListOf<BurndownReader.Ceiling>()

        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT COALESCE(p.max_cost_cents_per_run, 100) AS max_cost_cents,
                              COALESCE(p.max_tokens_per_run, 1000000) AS max_tokens
                         FROM workspaces w
                         LEFT JOIN workspace_usage_policies p ON p.workspace_id = w.id
                        WHERE w.id = ?"""
                ).use { st ->
                    st.setObject(1, wsId)
                    st.executeQuery().use { rs ->
                        if (rs.next()) {
                            ceilings += BurndownReader.Ceiling(
                                "cost", rs.getInt("max_cost_cents").toDouble(), "workspace", null)
                            ceilings += BurndownReader.Ceiling(
                                "tokens", rs.getLong("max_tokens").toDouble(), "workspace", null)
                        }
                    }
                }
            }
        }

        /* The team budget: what the root activation was granted. */
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT budget_allocated_json::text AS alloc
                         FROM agent_activations
                        WHERE run_id = ? AND workspace_id = ? AND depth = 0
                        ORDER BY sequence LIMIT 1"""
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, wsId)
                    st.executeQuery().use { rs ->
                        if (rs.next()) {
                            val alloc = flatNumbers(rs.getString("alloc"))
                            alloc["costCents"]?.let {
                                ceilings += BurndownReader.Ceiling("cost", it, "team budget", null)
                            }
                            alloc["tokens"]?.let {
                                ceilings += BurndownReader.Ceiling("tokens", it, "team budget", null)
                            }
                            alloc["iterations"]?.let {
                                ceilings += BurndownReader.Ceiling("iterations", it, "team budget", null)
                            }
                        }
                    }
                }
            }
        }

        val markers = budgetMarkers(runId, wsId, samples.minOfOrNull { it.at }?.toEpochMilli() ?: 0L)

        /* The run's own figure is in DOLLARS. Converted once, inside the reader,
           where the conversion is visible — see BurndownReader's header. */
        val recordedUsd = runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    "SELECT estimated_cost FROM agent_runs WHERE id = ? AND workspace_id = ?"
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, wsId)
                    st.executeQuery().use { rs ->
                        if (rs.next()) rs.getBigDecimal("estimated_cost")?.toDouble() else null
                    }
                }
            }
        }.getOrNull()

        val b = BurndownReader.build(samples, members, ceilings, markers, recordedUsd)

        return Response.ok(mapOf(
            "runId" to runId.toString(),
            "startedAtMs" to b.startedAtMs,
            "durationMs" to b.durationMs,
            "bands" to b.bands.map { band ->
                mapOf(
                    "activationId" to band.activationId,
                    "agentName" to band.agentName,
                    "role" to band.role,
                    "depth" to band.depth,
                    "tokens" to band.tokens,
                    "costCents" to band.costCents,
                    "iterations" to band.iterations,
                    "shareOfCost" to band.shareOfCost,
                    "points" to band.points.map {
                        mapOf("atMs" to it.atMs, "costCents" to it.costCents,
                              "tokens" to it.tokens, "iterations" to it.iterations)
                    },
                )
            },
            "ceilings" to b.ceilings.map {
                mapOf("dimension" to it.dimension, "limit" to it.limit,
                      "source" to it.source, "crossedAtMs" to it.crossedAtMs)
            },
            "markers" to b.markers.map {
                mapOf("kind" to it.kind, "atMs" to it.atMs, "label" to it.label,
                      "detail" to it.detail, "activationId" to it.activationId)
            },
            "reconciliation" to mapOf(
                "attributedCents" to b.reconciliation.attributedCents,
                "unattributedCents" to b.reconciliation.unattributedCents,
                "recordedTotalCents" to b.reconciliation.recordedTotalCents,
                "agrees" to b.reconciliation.agrees,
                "note" to b.reconciliation.note,
            ),
        ))
    }

    /**
     * The moments worth marking: clamps, ceiling warnings, the completion margin.
     *
     * ── WHY A CLAMP IS THE HEADLINE ─────────────────────────────────────────
     * A clamp is the reason a worker underperformed, and today it is invisible.
     * The child asked for a budget, was granted less, did less work than it was
     * told to — and every screen shows an agent that simply stopped early. The
     * `budget_clamped` span attribute is the only record that it was told it
     * could not continue.
     */
    private fun budgetMarkers(
        runId: java.util.UUID, wsId: java.util.UUID, t0: Long,
    ): List<BurndownReader.Marker> = runCatching {
        val out = mutableListOf<BurndownReader.Marker>()

        dataSource.connection.use { conn ->
            /* Clamps, from the span attribute. */
            conn.prepareStatement(
                """SELECT s.started_at, s.activation_id, s.name,
                          s.attributes_json->>'budget_clamped_dimensions' AS dims
                     FROM run_spans s
                    WHERE s.run_id = ? AND s.workspace_id = ?
                      AND (s.attributes_json->>'budget_clamped')::boolean IS TRUE
                    ORDER BY s.started_at"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    while (rs.next()) out += BurndownReader.Marker(
                        kind = "clamp",
                        atMs = rs.getTimestamp("started_at").time - t0,
                        label = "Budget clamped",
                        detail = rs.getString("dims")?.let { "Reduced: $it" }
                            ?: "This activation was granted less than it asked for.",
                        activationId = rs.getString("activation_id"),
                    )
                }
            }

            /* Ceiling crossings and the completion margin, from the events that
               name them. Both are already sentences the runtime wrote. */
            conn.prepareStatement(
                """SELECT timestamp, type, summary, activation_id
                     FROM run_events
                    WHERE run_id = ? AND workspace_id = ?
                      AND type IN ('AGENT_BUDGET_EXCEEDED','AGENT_CONTEXT_BUDGET_EXCEEDED',
                                   'AGENT_MAX_ITERATIONS_REACHED','RUN_CEILING_EXCEEDED')
                    ORDER BY sequence"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    while (rs.next()) {
                        val type = rs.getString("type")
                        out += BurndownReader.Marker(
                            kind = if (type == "AGENT_MAX_ITERATIONS_REACHED") "margin" else "ceiling",
                            atMs = rs.getTimestamp("timestamp").time - t0,
                            label = when (type) {
                                "AGENT_BUDGET_EXCEEDED" -> "Budget exceeded"
                                "AGENT_CONTEXT_BUDGET_EXCEEDED" -> "Context budget exceeded"
                                "AGENT_MAX_ITERATIONS_REACHED" -> "Iteration ceiling reached"
                                else -> "Run ceiling exceeded"
                            },
                            detail = rs.getString("summary"),
                            activationId = rs.getString("activation_id"),
                        )
                    }
                }
            }
        }
        out.sortedBy { it.atMs }
    }.getOrDefault(emptyList())

    /** `{"tokens": 24000, "costCents": 40}` to a flat map of numbers. */
    private fun flatNumbers(json: String?): Map<String, Double> {
        val j = json ?: return emptyMap()
        return Regex("\"([a-zA-Z_]{1,40})\"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)")
            .findAll(j)
            .mapNotNull { m -> m.groupValues[2].toDoubleOrNull()?.let { m.groupValues[1] to it } }
            .toMap()
    }

    // ── §6 replay and time travel ────────────────────────────────────────────

    /**
     * What may be done to this run, and what it will do in the world.
     *
     * ── WHY THE SERVER DECIDES AVAILABILITY ─────────────────────────────────
     * Whether "replay from iteration 4" can be honoured depends on the shape of
     * the persisted transcript — settled rows, contiguous numbering, a readable
     * action on each, a loop-state format this build understands. The client has
     * none of that, so a client-side guess would either offer an action the
     * worker refuses (the reader spends a run finding out) or hide one that
     * would have worked.
     *
     * `RETRYABLE_STATUSES` and the loop rules both live server-side for the same
     * reason. See [ReplayOptions] for what each option promises.
     */
    private fun replayOptions(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)

        val status = runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    "SELECT status FROM agent_runs WHERE id = ? AND workspace_id = ?"
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, wsId)
                    st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
                }
            }
        }.getOrNull() ?: "unknown"

        val facts = loopFacts(runId, wsId)

        val options = ReplayOptions.optionsFor(
            runStatus = status,
            loopFacts = facts,
            highestIteration = facts.settledIterations.maxOrNull(),
            retryable = status in RETRYABLE_RUN_STATUSES,
        )

        return Response.ok(mapOf(
            "runId" to runId.toString(),
            "status" to status,
            "highestIteration" to facts.settledIterations.maxOrNull(),
            "options" to options.map {
                mapOf(
                    "id" to it.id, "label" to it.label,
                    "sideEffects" to it.sideEffects.name,
                    "effectSummary" to it.effectSummary,
                    "available" to it.available,
                    "reason" to it.reason,
                )
            },
        ))
    }

    /**
     * The iteration facts the eligibility rules run on.
     *
     * A malformed action is detected by looking at the stored JSON rather than by
     * parsing it into an action type: the API does not have the worker's action
     * model, and "is there something there that starts like an object" is exactly
     * the check whose failure the worker reports as MALFORMED_ROW.
     */
    private fun loopFacts(runId: UUID, wsId: UUID): ReplayOptions.LoopFacts =
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT iteration_number, status, loop_schema_version,
                              action_json_sanitized::text AS action
                         FROM agent_iterations
                        WHERE run_id = ? AND workspace_id = ?
                        ORDER BY iteration_number"""
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, wsId)
                    st.executeQuery().use { rs ->
                        val settled = mutableListOf<Int>()
                        val malformed = mutableListOf<Int>()
                        var maxVersion = 0
                        while (rs.next()) {
                            val n = rs.getInt("iteration_number")
                            maxVersion = maxOf(maxVersion, rs.getInt("loop_schema_version"))
                            if (rs.getString("status") !in setOf("completed", "failed")) continue
                            settled += n
                            val action = rs.getString("action")
                            if (action.isNullOrBlank() || !action.trimStart().startsWith("{")) {
                                malformed += n
                            }
                        }
                        ReplayOptions.LoopFacts(
                            settledIterations = settled.sorted(),
                            malformed = malformed,
                            maxSchemaVersion = maxVersion,
                            supportedSchemaVersion = SUPPORTED_LOOP_SCHEMA_VERSION,
                        )
                    }
                }
            }
        }.getOrElse {
            /* A failed read is not "no iterations": one would offer the action and
               the other would refuse it, and guessing wrong in either direction is
               worse than saying the read failed. */
            ReplayOptions.LoopFacts(emptyList(), emptyList(), 0, SUPPORTED_LOOP_SCHEMA_VERSION)
        }

    /**
     * Every replay of this run, so three attempts at a fix are comparable.
     *
     * Both directions: replays OF this run, and — when this run is itself a
     * replay — its source and its siblings. A reader who opened attempt three
     * should not have to find attempt one by hand.
     */
    private fun replayHistory(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)

        val rows = runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """WITH root AS (
                         SELECT COALESCE(source_run_id, id) AS id
                           FROM agent_runs WHERE id = ? AND workspace_id = ?
                       )
                       SELECT r.id, r.status, r.created_at, r.completed_at,
                              r.source_run_id, r.replay_until_node,
                              r.trigger_type, r.execution_mode_kind
                         FROM agent_runs r, root
                        WHERE r.workspace_id = ?
                          AND (r.id = root.id OR r.source_run_id = root.id)
                        ORDER BY r.created_at"""
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, wsId); st.setObject(3, wsId)
                    st.executeQuery().use { rs ->
                        buildList {
                            while (rs.next()) add(mapOf(
                                "runId" to rs.getString("id"),
                                "status" to rs.getString("status"),
                                "createdAt" to rs.getTimestamp("created_at")?.toInstant()?.toString(),
                                "completedAt" to rs.getTimestamp("completed_at")?.toInstant()?.toString(),
                                "sourceRunId" to rs.getString("source_run_id"),
                                "replayUntilNode" to rs.getString("replay_until_node"),
                                /* The badge, decided once here so every surface
                                   agrees about what a replay is. */
                                "isReplay" to (rs.getString("source_run_id") != null ||
                                    rs.getString("trigger_type") == "replay" ||
                                    rs.getString("execution_mode_kind") == "replay"),
                                "isThisRun" to (rs.getString("id") == runId.toString()),
                            ))
                        }
                    }
                }
            }
        }.getOrDefault(emptyList())

        return Response.ok(mapOf("runId" to runId.toString(), "attempts" to rows))
    }

    // ── §5.7 compare ─────────────────────────────────────────────────────────

    /**
     * Who to compare this run against, when the reader has not said.
     *
     * ── WHY THE DEFAULT IS "MOST RECENT SUCCESSFUL, SAME VERSION" ───────────
     * The question is "it worked yesterday" — so the useful counterpart is the
     * last run that DID work, on the same version, because a diff across
     * versions cannot separate a behaviour change from an edit. Making the
     * reader pick a run first is asking them to answer the question they came
     * to ask.
     *
     * Returns null when there is no such run, which is a real state: the very
     * first run of a version has nothing to be compared with, and saying so
     * beats defaulting to a run on a different version.
     */
    private fun defaultTarget(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)

        val target = dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT other.id, other.status, other.completed_at
                     FROM agent_runs me
                     JOIN agent_runs other
                       ON other.workflow_version_id = me.workflow_version_id
                      AND other.workspace_id = me.workspace_id
                      AND other.id <> me.id
                    WHERE me.id = ? AND me.workspace_id = ?
                      AND other.status = 'succeeded'
                    ORDER BY other.completed_at DESC NULLS LAST
                    LIMIT 1"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    if (rs.next()) mapOf(
                        "runId" to rs.getString("id"),
                        "status" to rs.getString("status"),
                        "completedAt" to rs.getTimestamp("completed_at")?.toInstant()?.toString(),
                    ) else null
                }
            }
        }

        return Response.ok(mapOf(
            "runId" to runId.toString(),
            "target" to target,
            "reason" to if (target == null)
                "No other successful run of this workflow version has finished yet, so there " +
                "is nothing to compare against. A run can only be compared with another run " +
                "of the same version."
            else null,
        ))
    }

    /**
     * Diff this run against another on the same workflow version.
     *
     * The shaping — matching, deltas and the divergence point — is
     * [CompareReader], which is pure and tested without a database.
     */
    private fun compare(req: Request): Response {
        val (runId, wsId) = authorizedRun(req)
        val otherId = req.pathUUID("otherId")

        val versions = dataSource.connection.use { conn ->
            conn.prepareStatement(
                "SELECT id, workflow_version_id, status FROM agent_runs WHERE id IN (?,?) AND workspace_id = ?"
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, otherId); st.setObject(3, wsId)
                st.executeQuery().use { rs ->
                    val m = mutableMapOf<String, Pair<String?, String?>>()
                    while (rs.next()) m[rs.getString("id")] =
                        rs.getString("workflow_version_id") to rs.getString("status")
                    m
                }
            }
        }
        /* One row when a run is compared with itself, which is legitimate and
           must produce "no divergence" rather than Not Found. */
        val sameRun = runId == otherId
        if (versions.isEmpty() || (!sameRun && versions.size != 2)) throw ApiError.NotFound("Run")

        val c = CompareReader.compare(
            a = cmpSpans(runId, wsId),
            b = if (sameRun) cmpSpans(runId, wsId) else cmpSpans(otherId, wsId),
            versionA = versions[runId.toString()]?.first,
            versionB = versions[otherId.toString()]?.first,
            sameRun = sameRun,
        )

        return Response.ok(mapOf(
            "a" to mapOf("runId" to runId.toString(),
                "workflowVersionId" to versions[runId.toString()]?.first,
                "status" to versions[runId.toString()]?.second),
            "b" to mapOf("runId" to otherId.toString(),
                "workflowVersionId" to versions[otherId.toString()]?.first,
                "status" to versions[otherId.toString()]?.second),
            "sameVersion" to c.sameVersion,
            /* Present means the comparison was REFUSED and why — not a diff with
               a warning on top. See CompareReader.Refusal. */
            "refusal" to c.refusal?.let {
                mapOf("reason" to it.reason, "explanation" to it.explanation, "offer" to it.offer)
            },
            "divergenceKey" to c.divergenceKey,
            "onlyInA" to c.onlyInA,
            "onlyInB" to c.onlyInB,
            "nodes" to c.nodes.map { n ->
                mapOf(
                    "key" to n.key, "name" to n.name, "kind" to n.kind, "stepId" to n.stepId,
                    "presence" to n.presence,
                    "statusA" to n.statusA, "statusB" to n.statusB,
                    "divergent" to n.divergent,
                    "deltas" to n.deltas.map {
                        mapOf("field" to it.field, "a" to it.a, "b" to it.b, "note" to it.note)
                    },
                )
            },
        ))
    }

    /** The spans of one run, narrowed to what a comparison can use. */
    private fun cmpSpans(runId: UUID, wsId: UUID): List<CompareReader.Span> =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT step_id, kind, name, status, duration_ms, iteration_index,
                          COALESCE(tokens_in,0) + COALESCE(tokens_out,0) AS tokens,
                          COALESCE(cost_cents,0) AS cost_cents,
                          input_ref, output_ref,
                          attributes_json->>'model' AS model,
                          (attributes_json->>'context_chars')::int AS context_chars
                     FROM run_spans
                    WHERE run_id = ? AND workspace_id = ?
                    ORDER BY started_at, span_id"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(CompareReader.Span(
                            stepId = rs.getString("step_id"),
                            kind = rs.getString("kind"),
                            name = rs.getString("name"),
                            status = rs.getString("status"),
                            durationMs = rs.getObject("duration_ms") as? Int,
                            tokens = rs.getLong("tokens"),
                            costCents = rs.getDouble("cost_cents"),
                            model = rs.getString("model"),
                            iterationIndex = rs.getObject("iteration_index") as? Int,
                            inputRef = rs.getString("input_ref"),
                            outputRef = rs.getString("output_ref"),
                            contextChars = rs.getObject("context_chars") as? Int,
                        ))
                    }
                }
            }
        }
    /**
     * Why this run has no activations.
     *
     * One query, and it answers the only two questions worth distinguishing: did
     * this run have an agent step at all, and if it did, was the activation path
     * running when it executed.
     */
    /**
     * One node per agent step, reconstructed from `agent_iterations`.
     *
     * Every column here is recorded, not inferred:
     *
     *   status      from the iteration statuses — `failed` if any iteration
     *               failed, `running` if any is still open, else `ok`. Not read
     *               from the run: a run can succeed with a failed agent step
     *               retried after it, and colouring the agent green because the
     *               run went green is how a debugger loses trust.
     *   tokens/cost the per-iteration deltas, summed. The same numbers the
     *               activation path would have written to its budget ledger.
     *   iterations  a count of rows, which is what the activation's
     *               `budget_consumed_json->iterations` also is.
     *
     * `stopReason` stays NULL. Nothing recorded one on this path, and "completed"
     * would be a guess presented as a fact.
     *
     * Ordered by first activity so the columns read left to right in the order
     * the run actually executed them.
     */
    internal fun derivedNodes(runId: java.util.UUID, workspaceId: java.util.UUID): List<Map<String, Any?>> =
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT i.step_id,
                              i.agent_id,
                              COALESCE(ag.name, 'agent')                      AS agent_name,
                              min(i.started_at)                               AS started_at,
                              max(i.completed_at)                             AS ended_at,
                              count(*)::int                                   AS iterations,
                              COALESCE(sum(i.tokens_delta), 0)::bigint        AS tokens,
                              COALESCE(sum(i.cost_delta_cents), 0)::float     AS cost_cents,
                              count(*) FILTER (WHERE i.status = 'failed')::int  AS failed,
                              count(*) FILTER (WHERE i.status = 'running')::int AS running
                         FROM agent_iterations i
                         LEFT JOIN agents ag
                                ON ag.id = i.agent_id
                               AND ag.workspace_id = i.workspace_id
                        WHERE i.run_id = ? AND i.workspace_id = ?
                        GROUP BY i.step_id, i.agent_id, ag.name
                        ORDER BY min(i.started_at)"""
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, workspaceId)
                    st.executeQuery().use { rs ->
                        val out = mutableListOf<Map<String, Any?>>()
                        while (rs.next()) {
                            val stepId = rs.getString("step_id")
                            out += mapOf(
                                /* The step id IS the identity here. There is no
                                   activation uuid to use, and every consumer of
                                   this field either selects a node or matches an
                                   edge — and there are no edges. */
                                "id" to stepId,
                                "parentId" to null,
                                "depth" to 0,
                                "status" to when {
                                    rs.getInt("failed") > 0 -> "error"
                                    rs.getInt("running") > 0 -> "running"
                                    else -> "ok"
                                },
                                "role" to "specialist",
                                "stepId" to stepId,
                                "stopReason" to null,
                                "agentId" to rs.getString("agent_id"),
                                "agentName" to rs.getString("agent_name"),
                                "startedAt" to rs.getTimestamp("started_at")?.toInstant()?.toString(),
                                "endedAt" to rs.getTimestamp("ended_at")?.toInstant()?.toString(),
                                "tokens" to rs.getLong("tokens"),
                                "costCents" to rs.getDouble("cost_cents"),
                                "iterations" to rs.getInt("iterations"),
                            )
                        }
                        out
                    }
                }
            }
        }.getOrDefault(emptyList())

    private fun emptyCause(runId: java.util.UUID, workspaceId: java.util.UUID): String =
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """SELECT EXISTS (SELECT 1 FROM agent_iterations
                                       WHERE run_id = ? AND workspace_id = ?)"""
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, workspaceId)
                    st.executeQuery().use { rs ->
                        if (rs.next() && rs.getBoolean(1)) "activations_disabled"
                        else "no_agent_steps"
                    }
                }
            }
        }.getOrDefault("no_agent_steps")

}
