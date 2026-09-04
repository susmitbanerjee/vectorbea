package com.vectorbea.worker.runtime.checkpoint

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.logging.logger
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Row returned by [ApprovalStore.findApproval].
 */
data class ApprovalRow(
    val id: UUID,
    val runId: UUID,
    val nodeId: String,
    /** "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" — compared case-insensitively. */
    val status: String,
    val message: String?,
    val resolvedBy: String?,
)

/** What an existing approval row means for the caller waiting on it. */
enum class ApprovalDecision { GRANT, REJECT, WAIT }

/**
 * What an approval row's status means.
 *
 * Lives beside [ApprovalRow] because it is a fact about the row, and because it has
 * two callers that must not disagree: the agent brain's own ASK_APPROVAL gate and the
 * tool gate in `ToolNodeExecutor`. Two copies of this rule drifting apart would mean a
 * run that the agent considers approved and the tool considers pending.
 *
 * The API writes APPROVED / REJECTED (via `UPPER(?)`) and SENT_BACK. EXPIRED stops the
 * run rather than opening a second gate. SENT_BACK is not a decision, so it waits. And
 * ANYTHING unrecognised must WAIT — never "open a new gate", which on a step that
 * re-executes would file a fresh approval on every resume, and a run that re-asks
 * forever looks exactly like one nobody has got round to approving.
 */
fun decideOnApproval(status: String?): ApprovalDecision = when (status?.trim()?.uppercase()) {
    "APPROVED" -> ApprovalDecision.GRANT
    "REJECTED", "EXPIRED", "CANCELLED" -> ApprovalDecision.REJECT
    else -> ApprovalDecision.WAIT
}

/**
 * The gate as the canvas configured it.
 *
 * Every field here comes from a control the Approval inspector already renders
 * and that nothing has ever read. See [ApprovalStore.createPendingApproval].
 */
data class ApprovalGateConfig(
    /** Workspace role permitted to decide. Null = anybody with the permission. */
    val approverGroup: String? = null,
    /** Minutes before the decision is late. Null = no SLA. */
    val slaMinutes: Int? = null,
    /** escalate | reject | approve | hold. */
    val onTimeout: String? = null,
    /** Resolved values shown to the approver — NOT templates. */
    val decisionContext: Map<String, Any?> = emptyMap(),
    /** Where each decision-context value came from: label -> {expression}. */
    val evidenceRefs: Map<String, Any?> = emptyMap(),
    val title: String? = null,
    val riskLevel: String = "medium",
)

/**
 * Creates and queries approval rows.
 *
 * ── WHICH TABLE, AND WHY THAT WAS THE WHOLE BUG ──────────────────────────────
 *
 * This wrote to `approvals`. The API reads `run_approvals` — V027 made that
 * table authoritative precisely because two overlapping tables meant the
 * Approvals UI showed whichever it happened to query. Nothing updated this
 * writer, so every gate an APPROVAL node opened landed in a table no reader
 * looks at: the run stopped and waited, and the Approvals page stayed empty.
 * The only rows the page ever showed came from confidence gating and contract
 * gates, both of which write `run_approvals` directly.
 *
 * That is why the approval node "has all mocked data" — there was no real data
 * path from the canvas to the screen at all. Everything writes `run_approvals`
 * now, and the columns V027 added for exactly this purpose
 * (`sla_deadline_at`, `escalation_policy_json`, `decision_context_json`,
 * `evidence_refs_json`) are populated from the node's own configuration rather
 * than left NULL for the UI to invent placeholders around.
 *
 * SECURITY: [ApprovalGateConfig.decisionContext] is written verbatim and is
 * shown to approvers, so the caller is responsible for putting only resolved,
 * non-secret values in it — see `ApprovalNodeExecutor.resolveDecisionContext`.
 */
open class ApprovalStore(private val dataSource: DataSource) {

    private val log = logger()
    private val mapper = jacksonObjectMapper()

    /**
     * Create a pending approval row in `run_approvals`.
     * Returns the approval UUID as a string.
     */
    open fun createPendingApproval(
        runId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        nodeId: String,
        message: String,
        approvers: List<String>,
        resolvedInputs: Map<String, Any>,
        gate: ApprovalGateConfig = ApprovalGateConfig(),
    ): String {
        val id = UUID.randomUUID()

        /*
         * `metadata_json` keeps the shape the old sanitized payload had — input
         * KEYS, never values — because it is the fallback the API reads when
         * `decision_context_json` is absent, and a fallback that leaked values
         * would leak them on precisely the rows nobody configured carefully.
         */
        val metadataJson = mapper.writeValueAsString(
            buildMap {
                put("nodeId", nodeId)
                put("approvers", approvers)
                put("inputKeys", resolvedInputs.keys.toList())
                gate.approverGroup?.let { put("approverGroup", it) }
            }
        )

        val escalationJson = if (gate.onTimeout == null && gate.approverGroup == null && gate.slaMinutes == null) null
        else mapper.writeValueAsString(
            buildMap<String, Any?> {
                put("onTimeout", gate.onTimeout ?: "hold")
                put("approverGroup", gate.approverGroup)
                put("slaMinutes", gate.slaMinutes)
            }
        )

        val decisionContextJson =
            if (gate.decisionContext.isEmpty()) null else mapper.writeValueAsString(gate.decisionContext)
        val evidenceJson =
            if (gate.evidenceRefs.isEmpty()) null else mapper.writeValueAsString(gate.evidenceRefs)

        val slaDeadline = gate.slaMinutes
            ?.takeIf { it > 0 }
            ?.let { Timestamp.from(Instant.now().plusSeconds(it.toLong() * 60)) }

        val workflowId = lookupWorkflowId(runId)

        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """
                INSERT INTO run_approvals (
                    id, run_id, workspace_id, environment_id, node_id,
                    status, message, metadata_json,
                    title, risk_level, requested_by, workflow_id,
                    sla_deadline_at, escalation_policy_json,
                    decision_context_json, evidence_refs_json,
                    created_at, updated_at
                ) VALUES (
                    ?, ?, ?, ?, ?,
                    'PENDING', ?, ?::jsonb,
                    ?, ?, 'workflow-worker', ?,
                    ?, ?::jsonb,
                    ?::jsonb, ?::jsonb,
                    ?, ?
                )
                """.trimIndent()
            ).use { stmt ->
                val now = Timestamp.from(Instant.now())
                stmt.setObject(1, id)
                stmt.setObject(2, runId)
                stmt.setObject(3, workspaceId)
                stmt.setObject(4, environmentId)
                stmt.setString(5, nodeId)
                stmt.setString(6, message)
                stmt.setString(7, metadataJson)
                stmt.setString(8, gate.title ?: message.take(120))
                stmt.setString(9, gate.riskLevel)
                stmt.setObject(10, workflowId)
                stmt.setTimestamp(11, slaDeadline)
                stmt.setString(12, escalationJson)
                stmt.setString(13, decisionContextJson)
                stmt.setString(14, evidenceJson)
                stmt.setTimestamp(15, now)
                stmt.setTimestamp(16, now)
                stmt.executeUpdate()
            }
        }

        log.info(
            "[approval] created pending approval [runId={}, nodeId={}, id={}, group={}, slaMinutes={}]",
            runId, nodeId, id, gate.approverGroup ?: "any", gate.slaMinutes ?: 0,
        )
        return id.toString()
    }

    /**
     * Find the most recent approval row for [runId] + [nodeId].
     *
     * Used by the approval and db_write executors to check whether a gate was
     * already decided, so a resume does not create a second row.
     */
    open fun findApproval(runId: UUID, nodeId: String): ApprovalRow? {
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """
                    SELECT id, run_id, node_id, status, message, resolved_by
                    FROM run_approvals
                    WHERE run_id = ? AND node_id = ?
                    ORDER BY created_at DESC
                    LIMIT 1
                    """.trimIndent()
                ).use { stmt ->
                    stmt.setObject(1, runId)
                    stmt.setString(2, nodeId)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) return@use null
                        ApprovalRow(
                            id = UUID.fromString(rs.getString("id")),
                            runId = UUID.fromString(rs.getString("run_id")),
                            nodeId = rs.getString("node_id"),
                            status = rs.getString("status") ?: "PENDING",
                            message = rs.getString("message"),
                            resolvedBy = rs.getString("resolved_by"),
                        )
                    }
                }
            }
        } catch (e: Exception) {
            log.warn(
                "[approval] DB error looking up approval [runId={}, nodeId={}]: {}",
                runId, nodeId, e.message
            )
            null
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun lookupWorkflowId(runId: UUID): UUID? = try {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "SELECT workflow_id FROM agent_runs WHERE id = ?"
            ).use { stmt ->
                stmt.setObject(1, runId)
                stmt.executeQuery().use { rs ->
                    if (rs.next()) UUID.fromString(rs.getString("workflow_id")) else null
                }
            }
        }
    } catch (_: Exception) { null }
}
