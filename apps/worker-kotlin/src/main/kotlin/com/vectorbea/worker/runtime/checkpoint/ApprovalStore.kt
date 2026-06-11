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
    /** "pending" | "approved" | "rejected" | "expired" (lowercase — matches DB) */
    val status: String,
    val message: String?,
    val resolvedBy: String?,
)

/**
 * Creates and queries approval rows in the `approvals` table.
 *
 * The `approvals` table is shared between the worker (writer) and the API
 * (reader + decision writer).  The worker inserts `status = 'pending'`; the
 * API sets `status = 'approved'` or `'rejected'` via POST /api/approvals/:id/approve.
 *
 * Status values are lowercase to match the API's ApprovalRepository convention.
 * [ApprovalNodeExecutor] calls `.uppercase()` when comparing so both cases work.
 *
 * SECURITY: Only metadata keys (not values) from [resolvedInputs] are stored.
 */
open class ApprovalStore(private val dataSource: DataSource) {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    /**
     * Create a pending approval row in the `approvals` table.
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
    ): String {
        val id = UUID.randomUUID()

        // Build sanitized payload — only input keys, never raw values
        val payloadJson = mapper.writeValueAsString(
            mapOf(
                "nodeId"    to nodeId,
                "approvers" to approvers,
                "inputKeys" to resolvedInputs.keys.toList(),
            )
        )

        // Look up workflow_id from the run (needed by ApprovalRepository)
        val workflowId = lookupWorkflowId(runId) ?: runId  // fallback to runId if not found

        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """
                INSERT INTO approvals (
                    id, run_id, workflow_id, step_id,
                    status, title, message, risk_level,
                    requested_by, requested_at,
                    payload_json_sanitized,
                    created_at, updated_at
                ) VALUES (
                    ?, ?, ?, ?,
                    'pending', ?, ?, 'medium',
                    'workflow-worker', ?,
                    ?::jsonb,
                    ?, ?
                )
                """.trimIndent()
            ).use { stmt ->
                val now = Timestamp.from(Instant.now())
                stmt.setObject(1, id)
                stmt.setObject(2, runId)
                stmt.setObject(3, workflowId)
                stmt.setString(4, nodeId)
                stmt.setString(5, message)           // title
                stmt.setString(6, message)           // message
                stmt.setTimestamp(7, now)            // requested_at
                stmt.setString(8, payloadJson)       // payload_json_sanitized
                stmt.setTimestamp(9, now)            // created_at
                stmt.setTimestamp(10, now)           // updated_at
                stmt.executeUpdate()
            }
        }

        log.info("[approval] created pending approval [runId={}, nodeId={}, id={}]",
            runId, nodeId, id)
        return id.toString()
    }

    /**
     * Find the most recent approval row for [runId] + [nodeId].
     * Used by [com.vectorbea.worker.runtime.executor.ApprovalNodeExecutor]
     * to check whether an approval was already decided.
     */
    open fun findApproval(runId: UUID, nodeId: String): ApprovalRow? {
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """
                    SELECT id, run_id, step_id, status, message, decided_by
                    FROM approvals
                    WHERE run_id = ? AND step_id = ?
                    ORDER BY requested_at DESC
                    LIMIT 1
                    """.trimIndent()
                ).use { stmt ->
                    stmt.setObject(1, runId)
                    stmt.setString(2, nodeId)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) return@use null
                        ApprovalRow(
                            id         = UUID.fromString(rs.getString("id")),
                            runId      = UUID.fromString(rs.getString("run_id")),
                            nodeId     = rs.getString("step_id"),
                            status     = rs.getString("status") ?: "pending",
                            message    = rs.getString("message"),
                            resolvedBy = rs.getString("decided_by"),
                        )
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[approval] DB error looking up approval [runId={}, nodeId={}]: {}",
                runId, nodeId, e.message)
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
