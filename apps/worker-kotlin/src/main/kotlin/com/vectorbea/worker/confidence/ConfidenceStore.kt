package com.vectorbea.worker.confidence

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * Persists a confidence score with its full breakdown, and opens the gate.
 *
 * The breakdown is the reason this table exists at all — the score alone decides
 * whether a person is interrupted, and a reviewer who cannot see *why* will either
 * approve everything or override everything. Storing components is what makes the
 * routing trustworthy rather than arbitrary.
 */
class ConfidenceStore(private val dataSource: DataSource) {

    private val log = logger()
    /**
     * Deliberately a bare mapper: default inclusion is ALWAYS, so explicit nulls are
     * written rather than dropped. A field the model answered as null means "not present
     * in the source", which the gate must show and downstream nodes must receive. Do not
     * swap this for a NON_NULL-configured mapper.
     */
    private val mapper = ObjectMapper()

    /**
     * Record the score and return its id.
     *
     * The id matters: a gate row references it, and calibration joins on it. Null on
     * failure — the caller still routes, because losing the audit row must not
     * change the decision.
     */
    fun record(
        runId: UUID,
        workspaceId: UUID,
        workflowId: UUID?,
        nodeId: String,
        score: ConfidenceScorer.Score,
        decision: ConfidenceRouter.Decision,
        thresholds: ConfidenceRouter.Thresholds,
    ): UUID? = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """INSERT INTO confidence_scores
                    (run_id, workspace_id, workflow_id, node_id, score, action,
                     hard_gated, components_json, weakest_signal, explanation, thresholds_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?::jsonb)
                   RETURNING id"""
            ).use { stmt ->
                stmt.setObject(1, runId)
                stmt.setObject(2, workspaceId)
                stmt.setObject(3, workflowId)
                stmt.setString(4, nodeId)
                stmt.setDouble(5, score.value)
                stmt.setString(6, decision.action.name.lowercase())
                stmt.setBoolean(7, score.hardGated)
                stmt.setString(8, mapper.writeValueAsString(score.components.map {
                    mapOf("name" to it.name, "value" to it.value, "weight" to it.weight,
                          "contribution" to it.contribution, "present" to it.present,
                          "description" to it.description)
                }))
                stmt.setString(9, score.weakest?.name)
                stmt.setString(10, score.explanation)
                stmt.setString(11, mapper.writeValueAsString(mapOf(
                    "commit" to thresholds.commitAbove,
                    "flag" to thresholds.flagAbove,
                    "gate" to thresholds.gateAbove,
                )))
                stmt.executeQuery().use { rs ->
                    if (rs.next()) UUID.fromString(rs.getString(1)) else null
                }
            }
        }
    }.getOrElse {
        log.warn("[confidence] could not record the score for run {} node {}: {}",
            runId, nodeId, it.message)
        null
    }

    /**
     * Open a confidence gate.
     *
     * Carries everything §3 of the prompt asks for. The original output is frozen
     * here rather than read later: the point of "approve with correction" is to
     * compare what the agent said with what a human said, and that comparison is
     * destroyed if the original is overwritten downstream.
     */
    fun openGate(
        runId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        nodeId: String,
        scoreId: UUID?,
        score: ConfidenceScorer.Score,
        decision: ConfidenceRouter.Decision,
        output: Any?,
        decisionContext: Map<String, Any?>,
        evidenceRefs: Map<String, Any?>,
    ): UUID? = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """INSERT INTO run_approvals
                    (run_id, workspace_id, environment_id, node_id, status, message,
                     title, risk_level, requested_by, confidence_score, confidence_score_id,
                     decision_context_json, evidence_refs_json, original_output_json,
                     metadata_json)
                   VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?, 'confidence_gate', ?, ?,
                           ?::jsonb, ?::jsonb, ?::jsonb, ?::jsonb)
                   RETURNING id"""
            ).use { stmt ->
                stmt.setObject(1, runId)
                stmt.setObject(2, workspaceId)
                stmt.setObject(3, environmentId)
                stmt.setString(4, nodeId)
                stmt.setString(5, decision.message)
                stmt.setString(6, "Low confidence on '$nodeId'")
                // Risk scales with doubt: the closer to the fail threshold, the more
                // likely this genuinely is wrong.
                stmt.setString(7, if (score.value < 0.60) "high" else "medium")
                stmt.setDouble(8, score.value)
                stmt.setObject(9, scoreId)
                stmt.setString(10, mapper.writeValueAsString(decisionContext))
                stmt.setString(11, mapper.writeValueAsString(evidenceRefs))
                stmt.setString(12, mapper.writeValueAsString(output))
                stmt.setString(13, mapper.writeValueAsString(mapOf(
                    "source" to "confidence_gate",
                    "weakestSignal" to score.weakest?.name,
                )))
                stmt.executeQuery().use { rs ->
                    if (rs.next()) UUID.fromString(rs.getString(1)) else null
                }
            }
        }
    }.getOrElse {
        // A gate that could not be created means a doubtful output will commit
        // unreviewed. Loud, because that is the opposite of what the gate exists for.
        log.error("[confidence] COULD NOT OPEN the gate for run {} node {} - the output is " +
            "NOT being reviewed: {}", runId, nodeId, it.message)
        null
    }

    /**
     * How this node usually scores, for the gate's historical context.
     *
     * A reviewer seeing 0.62 needs to know whether that is unusual for this agent.
     * If it normally scores 0.95, this one deserves attention; if it normally scores
     * 0.65, the threshold is miscalibrated and the reviewer is being wasted.
     */
    fun historyFor(workflowId: UUID?, nodeId: String, limit: Int = 200): Map<String, Any?> =
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT avg(score) AS mean, count(*) AS n,
                              count(*) FILTER (WHERE action = 'gate') AS gated
                         FROM (SELECT score, action FROM confidence_scores
                                WHERE workflow_id = ? AND node_id = ?
                                ORDER BY created_at DESC LIMIT ?) recent"""
                ).use { stmt ->
                    stmt.setObject(1, workflowId)
                    stmt.setString(2, nodeId)
                    stmt.setInt(3, limit)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) emptyMap() else mapOf(
                            "typicalScore" to rs.getDouble("mean").takeIf { !rs.wasNull() },
                            "sampleSize" to rs.getInt("n"),
                            "gatedCount" to rs.getInt("gated"),
                        )
                    }
                }
            }
        }.getOrDefault(emptyMap())

    /** Per-node thresholds from the contract, falling back to plan then default. */
    fun thresholdsFor(workflowId: UUID?, nodeId: String, workspaceId: UUID): ConfidenceRouter.Thresholds =
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT COALESCE(
                                 (SELECT confidence_thresholds_json FROM node_contracts
                                   WHERE workflow_id = ? AND node_id = ? AND status = 'active'),
                                 (SELECT confidence_thresholds_json FROM workspace_usage_policies
                                   WHERE workspace_id = ?)
                              )::text"""
                ).use { stmt ->
                    stmt.setObject(1, workflowId)
                    stmt.setString(2, nodeId)
                    stmt.setObject(3, workspaceId)
                    stmt.executeQuery().use { rs ->
                        val json = if (rs.next()) rs.getString(1) else null
                        if (json == null) ConfidenceRouter.Thresholds.DEFAULT
                        else {
                            @Suppress("UNCHECKED_CAST")
                            ConfidenceRouter.Thresholds.from(
                                mapper.readValue(json, Map::class.java) as Map<String, Any?>)
                        }
                    }
                }
            }
        }.getOrDefault(ConfidenceRouter.Thresholds.DEFAULT)
}
