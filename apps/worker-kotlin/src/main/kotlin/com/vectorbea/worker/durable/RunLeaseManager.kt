package com.vectorbea.worker.durable

import com.vectorbea.worker.logging.logger
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Manages run leases for crash recovery.
 *
 * A run lease is a row in [run_leases] with an expiry time.
 * Workers acquire a lease before executing a run and renew it periodically.
 * If a worker crashes the lease expires and a recovery loop can detect it.
 *
 * Lease TTL: configurable via WORKER_LEASE_TTL_SECONDS (default 60s).
 * Renewal interval: half the TTL is a safe choice.
 */
class RunLeaseManager(
    private val dataSource: DataSource,
    val leaseTtlSeconds: Long = (System.getenv("WORKER_LEASE_TTL_SECONDS") ?: "60").toLong(),
) {
    private val log = logger()

    data class Lease(val runId: UUID, val workerId: String, val token: String, val expiresAt: Instant)

    /**
     * Try to acquire exclusive lease on [runId] for [workerId].
     * Returns the lease token on success, null if another worker holds the lease.
     */
    fun acquire(runId: UUID, workspaceId: UUID, workerId: String): Lease? {
        val token = UUID.randomUUID().toString()
        val expiresAt = Instant.now().plusSeconds(leaseTtlSeconds)
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO run_leases (workspace_id, run_id, worker_id, lease_token, expires_at)
                       VALUES (?, ?, ?, ?, ?)
                       ON CONFLICT (run_id) DO UPDATE
                         SET worker_id = EXCLUDED.worker_id,
                             lease_token = EXCLUDED.lease_token,
                             expires_at = EXCLUDED.expires_at,
                             renewed_at = now()
                         WHERE run_leases.expires_at < now()  -- only steal expired leases
                       RETURNING lease_token, expires_at"""
                ).use { stmt ->
                    stmt.setObject(1, workspaceId)
                    stmt.setObject(2, runId)
                    stmt.setString(3, workerId)
                    stmt.setString(4, token)
                    stmt.setTimestamp(5, Timestamp.from(expiresAt))
                    val rs = stmt.executeQuery()
                    if (!rs.next()) return null  // another worker holds a valid lease
                    Lease(runId, workerId, rs.getString("lease_token"), rs.getTimestamp("expires_at").toInstant())
                }
            }
        } catch (e: Exception) {
            log.warn("[lease] acquire failed runId={}: {}", runId, e.message)
            null
        }
    }

    /** Renew the lease to prevent expiry during long-running execution. */
    fun renew(runId: UUID, workerId: String, token: String): Boolean {
        val newExpiry = Instant.now().plusSeconds(leaseTtlSeconds)
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE run_leases SET expires_at = ?, renewed_at = now()
                       WHERE run_id = ? AND worker_id = ? AND lease_token = ?"""
                ).use { stmt ->
                    stmt.setTimestamp(1, Timestamp.from(newExpiry))
                    stmt.setObject(2, runId)
                    stmt.setString(3, workerId)
                    stmt.setString(4, token)
                    stmt.executeUpdate() > 0
                }
            }
        } catch (e: Exception) {
            log.warn("[lease] renew failed runId={}: {}", runId, e.message)
            false
        }
    }

    /** Release lease on run completion or pause. */
    fun release(runId: UUID, workerId: String) {
        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    "DELETE FROM run_leases WHERE run_id = ? AND worker_id = ?"
                ).use { stmt ->
                    stmt.setObject(1, runId)
                    stmt.setString(2, workerId)
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) {
            log.warn("[lease] release failed runId={}: {}", runId, e.message)
        }
    }

    /**
     * Find runs that appear stale: status RUNNING and either
     *   - the lease exists but expired more than 30s ago (worker crashed mid-run), or
     *   - no lease exists AND the run has made no progress for 120s
     *     (worker crashed between claiming the job and acquiring the lease).
     *
     * A merely missing lease is NOT enough on its own: every event append bumps
     * agent_runs.updated_at, so an actively-executing run is never "quiet" —
     * this prevents the recovery loop from double-executing healthy runs.
     */
    fun findStaleRuns(workspaceId: UUID? = null, limit: Int = 20): List<StaleLease> {
        return try {
            dataSource.connection.use { conn ->
                val wsFilter = if (workspaceId != null) "AND ar.workspace_id = ?" else ""
                conn.prepareStatement(
                    """SELECT ar.id AS run_id, ar.workspace_id, ar.workflow_id,
                              ar.workflow_version_id, ar.environment_id,
                              rl.worker_id, rl.expires_at
                       FROM agent_runs ar
                       LEFT JOIN run_leases rl ON rl.run_id = ar.id
                       WHERE ar.status IN ('running', 'yielded')
                         AND (
                              (rl.id IS NOT NULL AND rl.expires_at < now() - INTERVAL '30 seconds')
                           OR (rl.id IS NULL     AND ar.updated_at < now() - INTERVAL '120 seconds')
                         )
                         $wsFilter
                       ORDER BY ar.updated_at ASC
                       LIMIT $limit"""
                ).use { stmt ->
                    if (workspaceId != null) stmt.setObject(1, workspaceId)
                    val rs = stmt.executeQuery()
                    val result = mutableListOf<StaleLease>()
                    while (rs.next()) {
                        result.add(StaleLease(
                            runId = UUID.fromString(rs.getString("run_id")),
                            workspaceId = UUID.fromString(rs.getString("workspace_id")),
                            workflowId = UUID.fromString(rs.getString("workflow_id")),
                            workflowVersionId = UUID.fromString(rs.getString("workflow_version_id")),
                            environmentId = UUID.fromString(rs.getString("environment_id")),
                            lastWorker = rs.getString("worker_id"),
                            leaseExpiredAt = rs.getTimestamp("expires_at")?.toInstant(),
                        ))
                    }
                    result
                }
            }
        } catch (e: Exception) {
            log.error("[lease] findStaleRuns failed: {}", e.message)
            emptyList()
        }
    }

    data class StaleLease(
        val runId: UUID,
        val workspaceId: UUID,
        val workflowId: UUID,
        val workflowVersionId: UUID,
        val environmentId: UUID,
        val lastWorker: String?,
        val leaseExpiredAt: Instant?,
    )
}
