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
    /** "PENDING" | "APPROVED" | "REJECTED" */
    val status: String,
    val message: String?,
    val resolvedBy: String?,
)

/**
 * Creates and manages approval rows in the `run_approvals` table.
 *
 * An approval row is created when an APPROVAL node is reached.
 * The run pauses until the approval is resolved via the API.
 *
 * SECURITY: [resolvedInputs] may contain user data.  Only the keys
 * are stored in the metadata; raw values are not stored here.
 */
open class ApprovalStore(private val dataSource: DataSource) {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    /**
     * Create a pending approval row.
     * Returns the approval UUID (stored in the run_approvals table).
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

        // Only store keys from resolvedInputs — not values — to avoid persisting sensitive data
        val metadataJson = mapper.writeValueAsString(
            mapOf(
                "nodeId"       to nodeId,
                "approvers"    to approvers,
                "inputKeys"    to resolvedInputs.keys.toList(),
                "message"      to message,
            )
        )

        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """INSERT INTO run_approvals
                       (id, run_id, workspace_id, environment_id, node_id,
                        status, message, metadata_json, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?::jsonb, ?, ?)"""
            ).use { stmt ->
                val now = Timestamp.from(Instant.now())
                stmt.setObject(1, id)
                stmt.setObject(2, runId)
                stmt.setObject(3, workspaceId)
                stmt.setObject(4, environmentId)
                stmt.setString(5, nodeId)
                stmt.setString(6, message)
                stmt.setString(7, metadataJson)
                stmt.setTimestamp(8, now)
                stmt.setTimestamp(9, now)
                stmt.executeUpdate()
            }
        }

        log.info("[approval] created pending approval [runId={}, nodeId={}, id={}]",
            runId, nodeId, id)
        return id.toString()
    }

    /**
     * Find the most recent approval row for [runId] + [nodeId], or null if none exists.
     * Used by [DbWriteNodeExecutor] to check whether an approval was already granted or rejected.
     */
    open fun findApproval(runId: UUID, nodeId: String): ApprovalRow? {
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT id, run_id, node_id, status, message, resolved_by
                       FROM run_approvals
                       WHERE run_id = ? AND node_id = ?
                       ORDER BY created_at DESC
                       LIMIT 1"""
                ).use { stmt ->
                    stmt.setObject(1, runId)
                    stmt.setString(2, nodeId)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) return@use null
                        ApprovalRow(
                            id         = UUID.fromString(rs.getString("id")),
                            runId      = UUID.fromString(rs.getString("run_id")),
                            nodeId     = rs.getString("node_id"),
                            status     = rs.getString("status") ?: "PENDING",
                            message    = rs.getString("message"),
                            resolvedBy = rs.getString("resolved_by"),
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
}
