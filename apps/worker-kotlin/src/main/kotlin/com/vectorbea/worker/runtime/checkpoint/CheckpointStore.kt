package com.vectorbea.worker.runtime.checkpoint

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.graph.RuntimeSnapshot
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Persists [RuntimeSnapshot] checkpoints to the `run_checkpoints` table.
 *
 * Each checkpoint captures the full execution state after a node completes,
 * allowing a run to be resumed from any persisted checkpoint.
 *
 * SECURITY: The snapshot stores node status and output keys only — raw output
 * values are NOT stored here.  This avoids persisting potentially sensitive
 * user-derived data in a diagnostic table.
 */
open class CheckpointStore(private val dataSource: DataSource) {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    /**
     * Save a checkpoint for [runId] after [nodeId] completes.
     * Returns the generated checkpoint UUID.
     */
    open fun save(
        runId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        nodeId: String,
        snapshot: RuntimeSnapshot,
    ): UUID {
        val id           = UUID.randomUUID()
        val snapshotJson = mapper.writeValueAsString(snapshot)

        dataSource.connection.use { conn ->
            /*
             * `step_id` and `workflow_version_id` are written alongside the
             * columns this class actually reads back. They are V001's spelling
             * of the same two facts, and populating them costs one bind each —
             * cheaper than leaving a column that looks like it means something
             * permanently null for anyone who joins against it later.
             */
            conn.prepareStatement(
                """INSERT INTO run_checkpoints
                       (id, run_id, workspace_id, environment_id, node_id, sequence,
                        snapshot_json, created_at, step_id, workflow_version_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, ?)"""
            ).use { stmt ->
                stmt.setObject(1, id)
                stmt.setObject(2, runId)
                stmt.setObject(3, workspaceId)
                stmt.setObject(4, environmentId)
                stmt.setString(5, nodeId)
                stmt.setInt(6, snapshot.sequence)
                stmt.setString(7, snapshotJson)
                stmt.setTimestamp(8, Timestamp.from(Instant.now()))
                stmt.setString(9, nodeId)
                stmt.setObject(10, snapshot.workflowVersionId)
                stmt.executeUpdate()
            }
        }

        log.debug("[checkpoint] saved [runId={}, nodeId={}, seq={}, id={}]",
            runId, nodeId, snapshot.sequence, id)
        return id
    }

    /**
     * Load a specific checkpoint by its UUID.
     * Returns null if not found or workspace mismatch.
     */
    fun loadById(checkpointId: UUID, workspaceId: UUID): RuntimeSnapshot? {
        return dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT snapshot_json FROM run_checkpoints
                   WHERE id = ? AND workspace_id = ?"""
            ).use { stmt ->
                stmt.setObject(1, checkpointId)
                stmt.setObject(2, workspaceId)
                stmt.executeQuery().use { rs ->
                    if (!rs.next()) return@use null
                    mapper.readValue(rs.getString("snapshot_json"), RuntimeSnapshot::class.java)
                }
            }
        }
    }

    /**
     * Load the most recent checkpoint for [runId].
     * Returns null if no checkpoint exists.
     */
    fun loadLatest(runId: UUID, workspaceId: UUID): RuntimeSnapshot? {
        return dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT snapshot_json FROM run_checkpoints
                   WHERE run_id = ? AND workspace_id = ?
                   ORDER BY sequence DESC LIMIT 1"""
            ).use { stmt ->
                stmt.setObject(1, runId)
                stmt.setObject(2, workspaceId)
                stmt.executeQuery().use { rs ->
                    if (!rs.next()) return@use null
                    mapper.readValue(rs.getString("snapshot_json"), RuntimeSnapshot::class.java)
                }
            }
        }
    }
}
