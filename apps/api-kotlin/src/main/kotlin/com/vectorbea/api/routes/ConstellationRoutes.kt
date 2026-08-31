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

        val nodes = dataSource.connection.use { conn ->
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
                            /* The absence, explained. See the KDoc. */
                            "blockedReason" to blockedReason(status, rs.getString("stop_reason")),
                        )
                    }
                    out
                }
            }
        }

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

        return Response.ok(mapOf(
            "runId" to runId.toString(),
            "nodes" to nodes,
            "edges" to edges,
            "cycles" to cycles,
        ))
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
    private fun blockedReason(status: String?, stopReason: String?): String? = when {
        status == "cancelled" && stopReason == null ->
            "Never started — the join was already satisfied by its siblings."
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

        val points = dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT s.activation_id, s.started_at, s.ended_at,
                          COALESCE(s.tokens_in,0) + COALESCE(s.tokens_out,0) AS tokens,
                          COALESCE(s.cost_cents,0) AS cost_cents,
                          s.kind
                     FROM run_spans s
                    WHERE s.run_id = ? AND s.workspace_id = ?
                      AND s.kind IN ('llm_call','tool_call','iteration')
                    ORDER BY s.started_at"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    val out = mutableListOf<Map<String, Any?>>()
                    while (rs.next()) out += mapOf(
                        "activationId" to rs.getString("activation_id"),
                        "at" to rs.getTimestamp("started_at")?.toInstant()?.toString(),
                        "tokens" to rs.getLong("tokens"),
                        "costCents" to rs.getDouble("cost_cents"),
                        /* An `iteration` span contributes one iteration and no
                           tokens; the tokens are on the llm_call inside it, and
                           counting both would double every figure. */
                        "iterations" to if (rs.getString("kind") == "iteration") 1 else 0,
                        "kind" to rs.getString("kind"),
                    )
                    out
                }
            }
        }

        /*
         * The CEILINGS, so the chart can draw the lines. Without them a burn-down
         * shows a curve going up and answers nothing: the useful fact is not
         * "this run cost 40 cents", it is "this run cost 40 of its 100".
         */
        val ceilings = dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT COALESCE(p.max_cost_cents_per_run, 100) AS max_cost_cents,
                          COALESCE(p.max_tokens_per_run, 1000000) AS max_tokens
                     FROM workspaces w
                     LEFT JOIN workspace_usage_policies p ON p.workspace_id = w.id
                    WHERE w.id = ?"""
            ).use { st ->
                st.setObject(1, wsId)
                st.executeQuery().use { rs ->
                    if (rs.next()) mapOf(
                        "maxCostCents" to rs.getInt("max_cost_cents"),
                        "maxTokens" to rs.getLong("max_tokens"),
                    ) else mapOf("maxCostCents" to 100, "maxTokens" to 1_000_000L)
                }
            }
        }

        return Response.ok(mapOf("runId" to runId.toString(), "points" to points, "ceilings" to ceilings))
    }

    // ── §5.7 compare ─────────────────────────────────────────────────────────

    /**
     * Diff this run against another on the same workflow version.
     *
     * ── THE DIVERGENCE POINT IS THE ANSWER ──────────────────────────────────
     * "It worked yesterday" is the most common report there is, and the useful
     * reply is not a list of differences — it is the FIRST one. Everything after
     * the divergence is a consequence of it, so a view that shows twelve deltas
     * equally has buried the answer among its own symptoms.
     *
     * Spans are matched on `(step_id, kind, name)` rather than on span id, which
     * is random per run. Two runs of one workflow version execute the same steps
     * in the same order, so that triple is stable across them and is what makes
     * "present in one and not the other" a real statement rather than a diff of
     * two id lists that share nothing.
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
        if (versions.size != 2) throw ApiError.NotFound("Run")

        val a = spansOf(runId, wsId)
        val b = spansOf(otherId, wsId)
        val keysA = a.map { it.key }.toSet()
        val keysB = b.map { it.key }.toSet()

        /* The first key present in one and missing from the other, walking A in
           execution order. Everything after it is downstream of it. */
        val divergence = a.firstOrNull { it.key !in keysB }?.key
            ?: b.firstOrNull { it.key !in keysA }?.key

        val deltas = a.mapNotNull { sa ->
            val sb = b.firstOrNull { it.key == sa.key } ?: return@mapNotNull null
            val diffs = buildList {
                if (sa.model != sb.model && (sa.model != null || sb.model != null))
                    add(mapOf("field" to "model", "a" to sa.model, "b" to sb.model))
                if (sa.status != sb.status)
                    add(mapOf("field" to "status", "a" to sa.status, "b" to sb.status))
                /* Duration only when it moved enough to mean something. A 3 ms
                   difference on every span is noise that buries the 40-second one. */
                if (sa.durationMs != null && sb.durationMs != null &&
                    Math.abs(sa.durationMs - sb.durationMs) > 250)
                    add(mapOf("field" to "durationMs", "a" to sa.durationMs, "b" to sb.durationMs))
                if (sa.tokens != sb.tokens && Math.abs(sa.tokens - sb.tokens) > 0)
                    add(mapOf("field" to "tokens", "a" to sa.tokens, "b" to sb.tokens))
                if (sa.iterationIndex != sb.iterationIndex)
                    add(mapOf("field" to "iterationIndex", "a" to sa.iterationIndex, "b" to sb.iterationIndex))
            }
            if (diffs.isEmpty()) null
            else mapOf("key" to sa.key, "name" to sa.name, "kind" to sa.kind, "deltas" to diffs)
        }

        return Response.ok(mapOf(
            "a" to mapOf("runId" to runId.toString(),
                "workflowVersionId" to versions[runId.toString()]?.first,
                "status" to versions[runId.toString()]?.second),
            "b" to mapOf("runId" to otherId.toString(),
                "workflowVersionId" to versions[otherId.toString()]?.first,
                "status" to versions[otherId.toString()]?.second),
            /* Stated, not hidden: comparing across versions is legitimate — "it
               worked before we shipped" is the same question — but the answer
               means something different, and the view has to say which it is. */
            "sameVersion" to (versions[runId.toString()]?.first == versions[otherId.toString()]?.first),
            "divergenceKey" to divergence,
            "onlyInA" to a.filter { it.key !in keysB }.map { it.summary() },
            "onlyInB" to b.filter { it.key !in keysA }.map { it.summary() },
            "deltas" to deltas,
        ))
    }

    private data class CmpSpan(
        val key: String, val name: String, val kind: String, val status: String,
        val durationMs: Int?, val tokens: Long, val model: String?, val iterationIndex: Int?,
    ) {
        fun summary(): Map<String, Any?> =
            mapOf("key" to key, "name" to name, "kind" to kind, "status" to status,
                  "durationMs" to durationMs)
    }

    private fun spansOf(runId: UUID, wsId: UUID): List<CmpSpan> =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT step_id, kind, name, status, duration_ms, iteration_index,
                          COALESCE(tokens_in,0) + COALESCE(tokens_out,0) AS tokens,
                          attributes_json->>'model' AS model
                     FROM run_spans
                    WHERE run_id = ? AND workspace_id = ?
                    ORDER BY started_at"""
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, wsId)
                st.executeQuery().use { rs ->
                    val out = mutableListOf<CmpSpan>()
                    while (rs.next()) {
                        val stepId = rs.getString("step_id") ?: ""
                        val kind = rs.getString("kind")
                        val name = rs.getString("name")
                        val iter = rs.getObject("iteration_index")?.let { (it as Number).toInt() }
                        out += CmpSpan(
                            /* Span ids are random per run; this triple is what two
                               runs of one version have in common. The iteration
                               index joins it so iteration 3 compares against
                               iteration 3 rather than against the first one found. */
                            key = "$stepId|$kind|$name|${iter ?: ""}",
                            name = name, kind = kind, status = rs.getString("status"),
                            durationMs = rs.getObject("duration_ms")?.let { (it as Number).toInt() },
                            tokens = rs.getLong("tokens"),
                            model = rs.getString("model"),
                            iterationIndex = iter,
                        )
                    }
                    out
                }
            }
        }
}
