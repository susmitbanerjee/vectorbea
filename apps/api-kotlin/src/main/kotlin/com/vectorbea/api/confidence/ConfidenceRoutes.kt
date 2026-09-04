package com.vectorbea.api.confidence

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.audit.AuditLog
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.fromJson
import com.vectorbea.api.http.toDataJson
import com.vectorbea.api.http.toJson
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * The gate payload, the four reviewer actions, and calibration.
 *
 * `GET  /api/approvals/:id/gate`        everything a reviewer needs to decide
 * `POST /api/approvals/:id/decide`      approve · correct · reject · send back
 * `GET  /api/workflows/:id/calibration` does confidence predict correctness?
 * `GET  /api/runs/:id/confidence`       per-node validation trace
 *
 * WHY THE GATE PAYLOAD IS ONE CALL
 * --------------------------------
 * §3 lists six things the gate must carry. Assembled server-side into one response
 * rather than left to the client to fetch piecemeal, because a reviewer staring at
 * a half-loaded decision screen makes worse decisions — and because the *pairing*
 * of output with source and highlighted spans is the thing that makes this
 * reviewable at a glance. Split across four requests, the client would have to
 * re-derive the pairing and would get it subtly wrong.
 */
class ConfidenceRoutes(
    private val dataSource: DataSource,
    private val audit: AuditLog? = null,
) {
    private val log = LoggerFactory.getLogger(ConfidenceRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/approvals/:id/gate") { req -> gate(req) }
        router.post("/api/approvals/:id/decide") { req -> decide(req) }
        router.get("/api/workflows/:id/calibration") { req -> calibration(req) }
        router.get("/api/runs/:id/confidence") { req -> runTrace(req) }
    }

    // ── The gate payload ────────────────────────────────────────────────────

    private fun gate(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")

        return dataSource.connection.use { conn ->
            val row = conn.prepareStatement(
                """SELECT a.id, a.run_id, a.node_id, a.status, a.message, a.title,
                          a.risk_level, a.sla_deadline_at,
                          a.decision_context_json::text  AS ctx,
                          a.evidence_refs_json::text     AS evidence,
                          a.original_output_json::text   AS output,
                          c.id AS score_id, c.score, c.components_json::text AS components,
                          c.weakest_signal, c.explanation, c.thresholds_json::text AS thresholds,
                          r.workflow_id, r.input_json::text AS run_input
                     FROM run_approvals a
                     LEFT JOIN confidence_scores c ON c.id = a.confidence_score_id
                     JOIN agent_runs r ON r.id = a.run_id
                    WHERE a.id = ? AND a.workspace_id = ?"""
            ).use { stmt ->
                stmt.setObject(1, id); stmt.setObject(2, ctx.workspaceId)
                stmt.executeQuery().use { rs -> if (rs.next()) readGate(rs) else null }
            } ?: throw ApiError.NotFound("Approval")

            val workflowId = row["workflowId"] as? UUID
            val nodeId = row["nodeId"] as String

            Response.ok(row + mapOf(
                // How this agent usually scores. A 0.62 is alarming if the node
                // normally scores 0.95 and unremarkable if it normally scores 0.65 -
                // and in the second case the threshold, not the output, is the problem.
                "history" to history(conn, workflowId, nodeId),
                // What happens on approval, and what it will cause. A reviewer
                // approving a step that then emails a customer must know that before
                // clicking, not after.
                "nextAction" to nextAction(conn, row["runId"] as UUID, nodeId),
                "actions" to listOf(
                    mapOf("id" to "approve", "label" to "Approve",
                          "effect" to "The agent's output is used as-is and the run continues."),
                    mapOf("id" to "approve_with_correction", "label" to "Approve with correction",
                          "effect" to "Your edited value replaces the agent's and flows downstream. " +
                              "The correction is saved as a test case."),
                    mapOf("id" to "reject", "label" to "Reject",
                          "effect" to "The run stops here. Nothing downstream executes."),
                    mapOf("id" to "send_back", "label" to "Send back for retry",
                          "effect" to "The agent tries again with your note as guidance."),
                ),
            ))
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun readGate(rs: java.sql.ResultSet): Map<String, Any?> {
        val components = rs.getString("components")?.let { fromJson<List<Map<String, Any?>>>(it) }
            ?: emptyList()
        val output = rs.getString("output")?.let { runCatching { fromJson<Any>(it) }.getOrNull() }
        val runInput = rs.getString("run_input")?.let { runCatching { fromJson<Any>(it) }.getOrNull() }

        return mapOf(
            "approvalId" to rs.getString("id"),
            "runId" to UUID.fromString(rs.getString("run_id")),
            "workflowId" to rs.getString("workflow_id")?.let { UUID.fromString(it) },
            "nodeId" to rs.getString("node_id"),
            "status" to rs.getString("status"),
            "title" to rs.getString("title"),
            "message" to rs.getString("message"),
            "riskLevel" to rs.getString("risk_level"),
            "slaDeadlineAt" to rs.getTimestamp("sla_deadline_at")?.toInstant()?.toString(),

            "confidence" to mapOf(
                "score" to rs.getObject("score"),
                // Sorted by how much each signal COST, so the reviewer's eye lands on
                // the reason first rather than on an alphabetical list.
                "components" to components.sortedByDescending { c ->
                    val v = (c["value"] as? Number)?.toDouble() ?: 1.0
                    val w = (c["weight"] as? Number)?.toDouble() ?: 0.0
                    (1.0 - v) * w
                },
                "weakestSignal" to rs.getString("weakest_signal"),
                "explanation" to rs.getString("explanation"),
                "thresholds" to rs.getString("thresholds")?.let { fromJson<Map<String, Any?>>(it) },
            ),

            // Output beside source. The client highlights the verified spans; the
            // offsets come from evidence_refs so the highlighting is the same
            // verification the engine performed, not a re-implementation in JS.
            "output" to output,
            "source" to runInput,
            "decisionContext" to rs.getString("ctx")?.let { fromJson<Map<String, Any?>>(it) },
            "evidence" to rs.getString("evidence")?.let { fromJson<Map<String, Any?>>(it) },
        )
    }

    private fun history(conn: java.sql.Connection, workflowId: UUID?, nodeId: String): Map<String, Any?> =
        runCatching {
            conn.prepareStatement(
                """SELECT round(avg(c.score)::numeric, 3) AS typical,
                          count(*) AS scored,
                          count(*) FILTER (WHERE c.action = 'gate') AS gated,
                          (SELECT count(*) FROM run_approvals a2
                            JOIN confidence_scores c2 ON c2.id = a2.confidence_score_id
                           WHERE c2.workflow_id = ? AND c2.node_id = ?
                             AND a2.decision_action IN ('approve', 'approve_with_correction')) AS approved,
                          (SELECT count(*) FROM run_approvals a3
                            JOIN confidence_scores c3 ON c3.id = a3.confidence_score_id
                           WHERE c3.workflow_id = ? AND c3.node_id = ?
                             AND a3.decision_action IS NOT NULL) AS decided
                     FROM confidence_scores c
                    WHERE c.workflow_id = ? AND c.node_id = ?"""
            ).use { stmt ->
                stmt.setObject(1, workflowId); stmt.setString(2, nodeId)
                stmt.setObject(3, workflowId); stmt.setString(4, nodeId)
                stmt.setObject(5, workflowId); stmt.setString(6, nodeId)
                stmt.executeQuery().use { rs ->
                    if (!rs.next()) emptyMap() else {
                        val decided = rs.getInt("decided")
                        val approved = rs.getInt("approved")
                        mapOf(
                            "typicalScore" to rs.getObject("typical"),
                            "timesScored" to rs.getInt("scored"),
                            "timesGated" to rs.getInt("gated"),
                            "approvalRate" to if (decided == 0) null
                                              else Math.round(approved * 100.0 / decided),
                            "note" to if (decided == 0) "No gates on this node have been decided yet."
                                      else "$approved of $decided gates on this node were approved.",
                        )
                    }
                }
            }
        }.getOrDefault(emptyMap())

    /** What runs next if approved, and which of it causes side effects. */
    private fun nextAction(conn: java.sql.Connection, runId: UUID, nodeId: String): Map<String, Any?> =
        runCatching {
            conn.prepareStatement(
                """SELECT v.graph_json::text
                     FROM agent_runs r JOIN workflow_versions v ON v.id = r.workflow_version_id
                    WHERE r.id = ?"""
            ).use { stmt ->
                stmt.setObject(1, runId)
                stmt.executeQuery().use { rs ->
                    if (!rs.next()) return@runCatching emptyMap<String, Any?>()
                    @Suppress("UNCHECKED_CAST")
                    val graph = fromJson<Map<String, Any?>>(rs.getString(1))
                    @Suppress("UNCHECKED_CAST")
                    val edges = graph["edges"] as? List<Map<String, Any?>> ?: emptyList()
                    @Suppress("UNCHECKED_CAST")
                    val nodes = graph["nodes"] as? List<Map<String, Any?>> ?: emptyList()

                    val downstreamIds = edges.filter { it["source"] == nodeId }
                        .mapNotNull { it["target"] as? String }
                    val downstream = nodes.filter { it["id"] in downstreamIds }

                    // Which of those actually touch the outside world. This is the
                    // sentence that changes a reviewer's behaviour: "approving this
                    // sends an email" is a different decision from "approving this
                    // computes a number".
                    val sideEffecting = downstream.filter {
                        (it["type"] as? String)?.lowercase() in SIDE_EFFECT_TYPES
                    }.mapNotNull { it["id"] as? String }

                    mapOf(
                        "nextNodes" to downstreamIds,
                        "sideEffectNodes" to sideEffecting,
                        "hasSideEffects" to sideEffecting.isNotEmpty(),
                        "warning" to if (sideEffecting.isEmpty()) null
                            else "Approving this will run " + sideEffecting.joinToString(", ") +
                                ", which sends data outside Vectorbea. That cannot be undone.",
                    )
                }
            }
        }.getOrDefault(emptyMap())

    // ── The four reviewer actions ───────────────────────────────────────────

    data class DecideBody(
        val action: String,
        val reason: String? = null,
        /** Required for approve_with_correction: the output as the reviewer fixed it. */
        val correctedOutput: Map<String, Any?>? = null,
        val decidedBy: String? = null,
    )

    /**
     * Record a reviewer's decision.
     *
     * `approve_with_correction` is the valuable one and gets the most care: the
     * corrected value replaces the agent's downstream, AND the pair is captured as
     * an eval case. A human-verified correct answer for a case the agent got wrong
     * is the single most valuable training signal available, and it is free — the
     * reviewer was going to look at it anyway.
     */
    private fun decide(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val body = req.bodyAs<DecideBody>()

        if (body.action !in VALID_ACTIONS) {
            throw ApiError.ValidationError(
                "action must be one of: " + VALID_ACTIONS.joinToString(", "))
        }
        if (body.action == "approve_with_correction" && body.correctedOutput == null) {
            throw ApiError.ValidationError(
                "approve_with_correction requires correctedOutput - the value you want the run " +
                    "to continue with.")
        }

        return dataSource.connection.use { conn ->
            conn.autoCommit = false
            try {
                val existing = conn.prepareStatement(
                    """SELECT run_id, node_id, status, original_output_json::text AS orig,
                              confidence_score_id, (SELECT score FROM confidence_scores
                                                     WHERE id = confidence_score_id) AS score
                         FROM run_approvals WHERE id = ? AND workspace_id = ? FOR UPDATE"""
                ).use { stmt ->
                    stmt.setObject(1, id); stmt.setObject(2, ctx.workspaceId)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) null else mapOf(
                            "runId" to UUID.fromString(rs.getString("run_id")),
                            "nodeId" to rs.getString("node_id"),
                            "status" to rs.getString("status"),
                            "orig" to rs.getString("orig"),
                            "score" to (rs.getObject("score") as? Number)?.toDouble(),
                        )
                    }
                } ?: throw ApiError.NotFound("Approval")

                if ((existing["status"] as String).uppercase() != "PENDING") {
                    throw ApiError.Conflict(
                        "This approval was already decided. Reload to see the outcome.")
                }

                val status = when (body.action) {
                    "approve", "approve_with_correction" -> "APPROVED"
                    "reject" -> "REJECTED"
                    else -> "SENT_BACK"
                }

                conn.prepareStatement(
                    """UPDATE run_approvals
                          SET status = ?, decision_action = ?, decision_reason = ?,
                              corrected_output_json = ?::jsonb,
                              resolved_by = ?, resolved_at = now(), updated_at = now()
                        WHERE id = ?"""
                ).use { stmt ->
                    stmt.setString(1, status)
                    stmt.setString(2, body.action)
                    stmt.setString(3, body.reason)
                    // toDataJson, not toJson: a reviewer correcting a field to null is stating
                    // that the value is absent from the source. Dropping the key would
                    // record that as "said nothing" instead.
                    stmt.setString(4, body.correctedOutput?.let { toDataJson(it) })
                    stmt.setString(5, body.decidedBy ?: req.principal?.appUserId?.toString() ?: "api")
                    stmt.setObject(6, id)
                    stmt.executeUpdate()
                }

                // Capture the correction as an eval case, in the SAME transaction.
                // A correction recorded only if a follow-up write happens to succeed
                // is a correction that quietly stops being captured, and nobody
                // notices until the eval suite is inexplicably thin.
                if (body.action == "approve_with_correction") {
                    captureEvalCase(conn, ctx.workspaceId, existing, body)
                    applyCorrectionToStepOutput(conn, existing, body)
                }

                conn.commit()

                audit?.recordUserAction(
                    req, ctx.workspaceId, AuditLog.Action.APPROVAL_DECIDE, "approval",
                    targetId = id,
                    before = mapOf("status" to "PENDING", "confidence" to existing["score"]),
                    after = mapOf("action" to body.action, "reason" to body.reason),
                )

                log.info("[confidence] gate {} decided: {} (node {}, score {})",
                    id, body.action, existing["nodeId"], existing["score"])

                Response.ok(mapOf(
                    "approvalId" to id.toString(),
                    "action" to body.action,
                    "status" to status,
                    "capturedAsEvalCase" to (body.action == "approve_with_correction"),
                    "message" to when (body.action) {
                        "approve" -> "Approved. The run continues with the agent's output."
                        "approve_with_correction" ->
                            "Approved with your correction. The run continues with your value, " +
                                "and this has been saved as a test case for this agent."
                        "reject" -> "Rejected. The run stopped here and nothing downstream ran."
                        else -> "Sent back. The agent will try again with your note."
                    },
                ))
            } catch (e: Exception) {
                conn.rollback(); throw e
            } finally {
                conn.autoCommit = true
            }
        }
    }

    /**
     * Overwrite the node's stored output with the reviewer's corrected value.
     *
     * This is the step that makes "the run continues with your value" true rather than
     * merely reassuring. When the run resumes, the runtime rehydrates completed nodes
     * from `step_outputs` - so a correction that lives only on the approval row is a
     * correction the workflow never sees. Every downstream `steps.<node>.<field>`
     * expression would still resolve to the value the human just rejected.
     *
     * In the same transaction as the decision, for the same reason as the eval case:
     * a decision that is recorded while its correction is not is worse than no decision
     * at all, because the UI would report success.
     *
     * The agent's original output is not lost - `run_approvals.original_output_json`
     * holds it, which is what the run detail shows as "the agent said / you corrected".
     */
    private fun applyCorrectionToStepOutput(
        conn: java.sql.Connection,
        existing: Map<String, Any?>,
        body: DecideBody,
    ) {
        val corrected = toDataJson(body.correctedOutput!!)
        conn.prepareStatement(
            // The `_sanitized` suffix on these columns is historical and inaccurate
            // (D24) - they hold the full output. Named as they are on disk.
            """UPDATE step_outputs
                  SET raw_output_json_sanitized       = ?::jsonb,
                      extracted_output_json_sanitized = ?::jsonb,
                      validated_output_json_sanitized = ?::jsonb,
                      updated_at = now()
                WHERE run_id = ? AND node_id = ?"""
        ).use { stmt ->
            stmt.setString(1, corrected)
            stmt.setString(2, corrected)
            stmt.setString(3, corrected)
            stmt.setObject(4, existing["runId"] as UUID)
            stmt.setString(5, existing["nodeId"] as String)
            val rows = stmt.executeUpdate()
            if (rows == 0) {
                // No stored output to correct means the run cannot pick the correction
                // up on resume. Fail the decision rather than report a success the
                // workflow will not honour.
                throw ApiError.Conflict(
                    "This output could not be corrected because the run has no stored " +
                        "output for node '${existing["nodeId"]}'. Approve without a " +
                        "correction, or send it back for a retry.")
            }
        }
    }

    private fun captureEvalCase(
        conn: java.sql.Connection,
        workspaceId: UUID,
        existing: Map<String, Any?>,
        body: DecideBody,
    ) {
        runCatching {
            conn.prepareStatement(
                """INSERT INTO eval_cases
                    (workspace_id, workflow_id, node_id, input_json, agent_output_json,
                     expected_output_json, source, confidence_at_capture, source_run_id, note)
                   SELECT ?, r.workflow_id, ?, r.input_json, ?::jsonb, ?::jsonb,
                          'correction', ?, r.id, ?
                     FROM agent_runs r WHERE r.id = ?"""
            ).use { stmt ->
                stmt.setObject(1, workspaceId)
                stmt.setString(2, existing["nodeId"] as String)
                stmt.setString(3, existing["orig"] as? String)
                stmt.setString(4, toDataJson(body.correctedOutput!!))
                val score = existing["score"] as? Double
                if (score != null) stmt.setDouble(5, score) else stmt.setNull(5, java.sql.Types.DOUBLE)
                stmt.setString(6, body.reason)
                stmt.setObject(7, existing["runId"] as UUID)
                stmt.executeUpdate()
            }
        }.onFailure {
            // Rethrown: the transaction must roll back rather than record a decision
            // whose correction was silently not captured.
            log.error("[confidence] could not capture the eval case for approval: {}", it.message)
            throw it
        }
    }

    // ── Calibration ─────────────────────────────────────────────────────────

    /**
     * Does confidence predict correctness?
     *
     * The recommendation is the useful part. A band whose outputs are approved 95%
     * of the time is a band that should not have been gated, and the fix is a number
     * the user can apply rather than an invitation to think about it.
     */
    private fun calibration(req: Request): Response {
        val ctx = req.context()
        val workflowId = req.pathUUID("id")

        return dataSource.connection.use { conn ->
            val bands = conn.prepareStatement(
                """SELECT node_id, band_low, band_high, gated_count, approved_clean,
                          approved_corrected, rejected, clean_approval_rate
                     FROM confidence_calibration
                    WHERE workflow_id = ?
                    ORDER BY node_id, band_low"""
            ).use { stmt ->
                stmt.setObject(1, workflowId)
                stmt.executeQuery().use { rs ->
                    val out = mutableListOf<Map<String, Any?>>()
                    while (rs.next()) {
                        out += mapOf(
                            "nodeId" to rs.getString("node_id"),
                            "band" to "${rs.getBigDecimal("band_low")}-${rs.getBigDecimal("band_high")}",
                            "bandLow" to rs.getBigDecimal("band_low"),
                            "gated" to rs.getInt("gated_count"),
                            "approvedClean" to rs.getInt("approved_clean"),
                            "approvedCorrected" to rs.getInt("approved_corrected"),
                            "rejected" to rs.getInt("rejected"),
                            "cleanApprovalRate" to rs.getObject("clean_approval_rate"),
                        )
                    }
                    out
                }
            }

            // Only recommend from bands with enough decisions to mean something. A
            // 100% approval rate over two samples is noise, and acting on it would
            // make the thresholds worse.
            val recommendations = bands
                .filter { (it["gated"] as Int) >= MIN_SAMPLES_FOR_RECOMMENDATION }
                .mapNotNull { b ->
                    val rate = (b["cleanApprovalRate"] as? java.math.BigDecimal)?.toDouble()
                        ?: return@mapNotNull null
                    val low = (b["bandLow"] as java.math.BigDecimal).toDouble()
                    when {
                        rate >= 0.90 -> mapOf(
                            "nodeId" to b["nodeId"], "band" to b["band"],
                            "finding" to "${Math.round(rate * 100)}% of gates in this band were " +
                                "approved with no change.",
                            "recommendation" to "Lower the gate threshold for this node to " +
                                "${"%.2f".format(low)} - these decisions are being sent to a " +
                                "person who almost always agrees with the agent.",
                            "suggestedGateThreshold" to low,
                        )
                        rate <= 0.40 -> mapOf(
                            "nodeId" to b["nodeId"], "band" to b["band"],
                            "finding" to "Only ${Math.round(rate * 100)}% of gates in this band " +
                                "were approved unchanged.",
                            "recommendation" to "Raise the FAIL threshold toward " +
                                "${"%.2f".format(low + 0.1)} - outputs scoring this low are " +
                                "usually wrong, and failing them saves reviewer time.",
                            "suggestedGateThreshold" to low + 0.1,
                        )
                        else -> null
                    }
                }

            Response.ok(mapOf(
                "workflowId" to workflowId.toString(),
                "bands" to bands,
                "recommendations" to recommendations,
                "summary" to when {
                    bands.isEmpty() -> "No gated decisions yet. Calibration appears once reviewers " +
                        "have decided some gates."
                    recommendations.isEmpty() -> "Thresholds look reasonable - no band is being " +
                        "systematically over- or under-gated."
                    else -> "${recommendations.size} threshold change(s) suggested by the evidence."
                },
            ))
        }
    }

    // ── Per-run trace ───────────────────────────────────────────────────────

    /** Every check and its result, per node — the run-detail validation trace. */
    private fun runTrace(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("id")

        return dataSource.connection.use { conn ->
            val nodes = conn.prepareStatement(
                """SELECT c.node_id, c.score, c.action, c.hard_gated, c.weakest_signal,
                          c.explanation, c.components_json::text AS components, c.created_at,
                          v.outcome AS contract_outcome, v.schema_valid,
                          v.assertion_results_json::text AS assertions
                     FROM confidence_scores c
                     LEFT JOIN contract_validations v
                            ON v.run_id = c.run_id AND v.node_id = c.node_id
                    WHERE c.run_id = ? AND c.workspace_id = ?
                    ORDER BY c.created_at"""
            ).use { stmt ->
                stmt.setObject(1, runId); stmt.setObject(2, ctx.workspaceId)
                stmt.executeQuery().use { rs ->
                    val out = mutableListOf<Map<String, Any?>>()
                    while (rs.next()) {
                        out += mapOf(
                            "nodeId" to rs.getString("node_id"),
                            "score" to rs.getDouble("score"),
                            "action" to rs.getString("action"),
                            "hardGated" to rs.getBoolean("hard_gated"),
                            "weakestSignal" to rs.getString("weakest_signal"),
                            "explanation" to rs.getString("explanation"),
                            "components" to rs.getString("components")
                                ?.let { fromJson<List<Map<String, Any?>>>(it) },
                            "contractOutcome" to rs.getString("contract_outcome"),
                            "schemaValid" to rs.getObject("schema_valid"),
                            "assertions" to rs.getString("assertions")
                                ?.let { fromJson<List<Map<String, Any?>>>(it) },
                            "at" to rs.getTimestamp("created_at")?.toInstant()?.toString(),
                        )
                    }
                    out
                }
            }
            Response.ok(mapOf("runId" to runId.toString(), "nodes" to nodes))
        }
    }

    private companion object {
        val VALID_ACTIONS = setOf("approve", "approve_with_correction", "reject", "send_back")

        /** Node types that reach outside Vectorbea. */
        val SIDE_EFFECT_TYPES = setOf("http", "email", "db_write", "tool", "webhook", "slack")

        /**
         * Below this, a band's approval rate is noise.
         *
         * Ten is low for statistics and right for this: the alternative to a
         * cautious recommendation is no recommendation, and a user who never sees
         * one will never tune anything.
         */
        const val MIN_SAMPLES_FOR_RECOMMENDATION = 10
    }
}
