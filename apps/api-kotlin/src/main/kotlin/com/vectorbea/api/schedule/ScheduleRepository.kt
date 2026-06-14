package com.vectorbea.api.schedule

import com.vectorbea.api.repository.BaseRepository
import org.slf4j.LoggerFactory
import java.sql.ResultSet
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/** A cron-based workflow trigger row from the `schedules` table. */
data class Schedule(
    val id: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val workflowId: UUID,
    val cronExpression: String,
    val timezone: String,
    val enabled: Boolean,
    val nextFireAt: Instant?,
    val lastFireAt: Instant?,
)

/** A schedule joined with its workflow name — for the schedules list UI. */
data class ScheduleWithWorkflow(
    val schedule: Schedule,
    val workflowName: String,
)

/**
 * Persistence for cron-based workflow trigger schedules.
 *
 * A workflow has at most one trigger schedule, so writes are keyed by workflow_id:
 * [upsertForWorkflow] updates the existing row (preserving last_fire_at) or inserts
 * a new one, and [deleteForWorkflow] removes it when the trigger is no longer cron.
 */
open class ScheduleRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(ScheduleRepository::class.java)

    private fun mapRow(rs: ResultSet) = Schedule(
        id = rs.uuid("id"),
        workspaceId = rs.uuid("workspace_id"),
        environmentId = rs.uuid("environment_id"),
        workflowId = rs.uuid("workflow_id"),
        cronExpression = rs.getString("cron_expression"),
        timezone = rs.getString("timezone"),
        enabled = rs.getBoolean("enabled"),
        nextFireAt = rs.instantOrNull("next_fire_at"),
        lastFireAt = rs.instantOrNull("last_fire_at"),
    )

    /** Create or update the workflow's trigger schedule, preserving last_fire_at. */
    open fun upsertForWorkflow(
        workspaceId: UUID,
        environmentId: UUID,
        workflowId: UUID,
        cronExpression: String,
        timezone: String,
        nextFireAt: Instant?,
    ) {
        val updated = execute(
            """
            UPDATE schedules
               SET cron_expression = ?, timezone = ?, environment_id = ?,
                   enabled = true, next_fire_at = ?, updated_at = now()
             WHERE workflow_id = ?
            """.trimIndent(),
        ) {
            setString(1, cronExpression)
            setString(2, timezone)
            setUuid(3, environmentId)
            setInstantOrNull(4, nextFireAt)
            setUuid(5, workflowId)
        }
        if (updated == 0) {
            execute(
                """
                INSERT INTO schedules
                    (workspace_id, environment_id, workflow_id, cron_expression, timezone, enabled, next_fire_at)
                VALUES (?, ?, ?, ?, ?, true, ?)
                """.trimIndent(),
            ) {
                setUuid(1, workspaceId)
                setUuid(2, environmentId)
                setUuid(3, workflowId)
                setString(4, cronExpression)
                setString(5, timezone)
                setInstantOrNull(6, nextFireAt)
            }
        }
    }

    /** Remove the workflow's trigger schedule (trigger is no longer a cron). */
    open fun deleteForWorkflow(workflowId: UUID): Int =
        execute("DELETE FROM schedules WHERE workflow_id = ?") { setUuid(1, workflowId) }

    open fun findById(id: UUID, workspaceId: UUID): Schedule? = queryOne(
        """
        SELECT id, workspace_id, environment_id, workflow_id, cron_expression,
               timezone, enabled, next_fire_at, last_fire_at
          FROM schedules WHERE id = ? AND workspace_id = ?
        """.trimIndent(),
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapRow,
    )

    /** Pause / resume a schedule. On resume, [nextFireAt] is recomputed by the caller. */
    open fun setEnabled(id: UUID, workspaceId: UUID, enabled: Boolean, nextFireAt: Instant?): Boolean =
        execute(
            "UPDATE schedules SET enabled = ?, next_fire_at = ?, updated_at = now() WHERE id = ? AND workspace_id = ?",
        ) {
            setBoolean(1, enabled)
            setInstantOrNull(2, nextFireAt)
            setUuid(3, id)
            setUuid(4, workspaceId)
        } > 0

    /** List all schedules in a workspace, joined with the workflow name. */
    open fun listByWorkspace(workspaceId: UUID): List<ScheduleWithWorkflow> = query(
        """
        SELECT s.id, s.workspace_id, s.environment_id, s.workflow_id, s.cron_expression,
               s.timezone, s.enabled, s.next_fire_at, s.last_fire_at, w.name AS workflow_name
          FROM schedules s
          JOIN workflows w ON w.id = s.workflow_id
         WHERE s.workspace_id = ?
         ORDER BY s.next_fire_at ASC NULLS LAST, s.created_at DESC
        """.trimIndent(),
        { setUuid(1, workspaceId) },
    ) { rs -> ScheduleWithWorkflow(mapRow(rs), rs.getString("workflow_name")) }

    /** Schedules that are enabled and due to fire at or before [now]. */
    open fun listDue(now: Instant, limit: Int = 100): List<Schedule> = query(
        """
        SELECT id, workspace_id, environment_id, workflow_id, cron_expression,
               timezone, enabled, next_fire_at, last_fire_at
          FROM schedules
         WHERE enabled = true AND next_fire_at IS NOT NULL AND next_fire_at <= ?
         ORDER BY next_fire_at ASC
         LIMIT $limit
        """.trimIndent(),
        { setInstant(1, now) },
        ::mapRow,
    )

    /**
     * Atomically claim a due schedule by advancing its next_fire_at past [threshold].
     * Returns true only for the caller that wins the race — the WHERE guard on
     * next_fire_at means a second concurrent firer sees 0 rows. This makes firing
     * exactly-once across multiple API instances without a separate lock.
     */
    open fun claimAndAdvance(id: UUID, threshold: Instant, firedAt: Instant, nextFireAt: Instant?): Boolean =
        execute(
            """
            UPDATE schedules
               SET last_fire_at = ?, next_fire_at = ?, updated_at = now()
             WHERE id = ? AND enabled = true AND next_fire_at IS NOT NULL AND next_fire_at <= ?
            """.trimIndent(),
        ) {
            setInstant(1, firedAt)
            setInstantOrNull(2, nextFireAt)
            setUuid(3, id)
            setInstant(4, threshold)
        } > 0
}
