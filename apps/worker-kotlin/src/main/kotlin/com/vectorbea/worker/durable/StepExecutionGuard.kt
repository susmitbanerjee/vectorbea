package com.vectorbea.worker.durable

import com.vectorbea.worker.logging.logger
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Guards node execution for idempotency during crash recovery.
 *
 * Before executing a node, the worker calls [tryAcquire].
 * If the node already completed successfully in a previous attempt, the worker
 * skips execution and uses the cached result.
 *
 * This prevents duplicate external side effects (HTTP POSTs, DB writes, etc.)
 * after a worker crash and recovery.
 *
 * This guard answers "has this already run", never "may this run" — see
 * [com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner.toolGuardNodeId] for
 * why a call that is also gated by an approval needs two different keys.
 *
 * Usage — note the guard reports only the VERDICT, and the caller fetches the
 * output itself. There is no `cachedResult` on [AcquireResult]: the output lives in
 * [com.vectorbea.worker.runtime.StepOutputStore], keyed by the same `nodeId`, and a
 * verdict of ALREADY_COMPLETED with no stored output means re-execute.
 *
 *   val guard = stepExecutionGuard.tryAcquire(runId, workspaceId, environmentId, nodeId, attempt)
 *   if (guard.alreadyCompleted) stepOutputStore.loadRaw(runId, nodeId)?.let { return it }
 *   // ... execute node ...
 *   stepExecutionGuard.markCompleted(runId, nodeId, attempt)
 */
open class StepExecutionGuard(private val dataSource: DataSource) {
    private val log = logger()

    enum class AcquireStatus { ACQUIRED, ALREADY_COMPLETED, ALREADY_RUNNING }

    data class AcquireResult(
        val status: AcquireStatus,
        val executionId: UUID?,
        val alreadyCompleted: Boolean = status == AcquireStatus.ALREADY_COMPLETED,
    )

    /**
     * Try to acquire execution slot for [nodeId] at [attempt].
     * Returns ACQUIRED if the slot was created (safe to execute),
     * ALREADY_COMPLETED if a previous run already succeeded,
     * ALREADY_RUNNING if another thread is executing right now.
     */
    open fun tryAcquire(
        runId: UUID, workspaceId: UUID, environmentId: UUID,
        nodeId: String, attempt: Int, idempotencyKey: String? = null,
    ): AcquireResult {
        return try {
            dataSource.connection.use { conn ->
                // Check existing execution for this (run, node, attempt)
                val existing = findExisting(conn, runId, nodeId, attempt)
                if (existing != null) {
                    return when (existing.second) {
                        "succeeded" -> AcquireResult(AcquireStatus.ALREADY_COMPLETED, existing.first)
                        "running"   -> AcquireResult(AcquireStatus.ALREADY_RUNNING, existing.first)
                        else        -> AcquireResult(AcquireStatus.ACQUIRED, existing.first)  // failed, retry
                    }
                }
                // Insert new execution row
                val id = UUID.randomUUID()
                conn.prepareStatement(
                    """INSERT INTO step_executions
                       (id, workspace_id, environment_id, run_id, node_id, attempt, status, idempotency_key)
                       VALUES (?, ?, ?, ?, ?, ?, 'running', ?)
                       ON CONFLICT (run_id, node_id, attempt) DO NOTHING
                       RETURNING id"""
                ).use { stmt ->
                    stmt.setObject(1, id)
                    stmt.setObject(2, workspaceId)
                    stmt.setObject(3, environmentId)
                    stmt.setObject(4, runId)
                    stmt.setString(5, nodeId)
                    stmt.setInt(6, attempt)
                    stmt.setString(7, idempotencyKey)
                    val rs = stmt.executeQuery()
                    if (!rs.next()) {
                        // Conflict — re-read
                        val e = findExisting(conn, runId, nodeId, attempt)
                        if (e?.second == "succeeded") return AcquireResult(AcquireStatus.ALREADY_COMPLETED, e.first)
                        return AcquireResult(AcquireStatus.ALREADY_RUNNING, e?.first)
                    }
                    AcquireResult(AcquireStatus.ACQUIRED, UUID.fromString(rs.getString("id")))
                }
            }
        } catch (e: Exception) {
            log.warn("[step-guard] tryAcquire failed run={} node={}: {}", runId, nodeId, e.message)
            AcquireResult(AcquireStatus.ACQUIRED, null)  // fail open — allow execution
        }
    }

    open fun markCompleted(runId: UUID, nodeId: String, attempt: Int) {
        update(runId, nodeId, attempt, "succeeded", null)
    }

    open fun markFailed(runId: UUID, nodeId: String, attempt: Int, errorJson: String?) {
        update(runId, nodeId, attempt, "failed", errorJson)
    }

    open fun markSkipped(runId: UUID, nodeId: String, attempt: Int) {
        update(runId, nodeId, attempt, "skipped", null)
    }

    private fun update(runId: UUID, nodeId: String, attempt: Int, status: String, errorJson: String?) {
        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE step_executions SET status=?, completed_at=?,
                       error_json_sanitized=?::jsonb WHERE run_id=? AND node_id=? AND attempt=?"""
                ).use { stmt ->
                    stmt.setString(1, status)
                    stmt.setTimestamp(2, Timestamp.from(Instant.now()))
                    stmt.setString(3, errorJson)
                    stmt.setObject(4, runId)
                    stmt.setString(5, nodeId)
                    stmt.setInt(6, attempt)
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) {
            log.warn("[step-guard] update failed run={} node={}: {}", runId, nodeId, e.message)
        }
    }

    private fun findExisting(conn: java.sql.Connection, runId: UUID, nodeId: String, attempt: Int): Pair<UUID, String>? {
        conn.prepareStatement(
            "SELECT id, status FROM step_executions WHERE run_id=? AND node_id=? AND attempt=? LIMIT 1"
        ).use { stmt ->
            stmt.setObject(1, runId)
            stmt.setString(2, nodeId)
            stmt.setInt(3, attempt)
            val rs = stmt.executeQuery()
            if (!rs.next()) return null
            return Pair(UUID.fromString(rs.getString("id")), rs.getString("status"))
        }
    }
}
