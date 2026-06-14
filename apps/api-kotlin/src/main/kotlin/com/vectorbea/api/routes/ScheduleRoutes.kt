package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.schedule.CronExpression
import com.vectorbea.api.schedule.ScheduleRepository
import com.vectorbea.api.schedule.ScheduleWithWorkflow
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.UUID

/**
 * Read API for cron-based workflow schedules.
 *
 * Schedules are created/updated as a side-effect of saving a workflow version with
 * a cron trigger (see WorkflowRoutes.createVersion), so this exposes a list endpoint
 * the Schedules screen reads. The response shape matches the frontend `Schedule`.
 */
class ScheduleRoutes(private val repo: ScheduleRepository) {

    fun register(router: Router) {
        router.get("/api/schedules", ::list)
        router.patch("/api/schedules/:id", ::update)
    }

    private fun list(req: Request): Response {
        val ctx = req.context()
        val schedules = repo.listByWorkspace(ctx.workspaceId)
        return Response.ok(schedules.map(::toResponse))
    }

    /** Pause or resume a schedule. On resume, the next fire time is recomputed. */
    private fun update(req: Request): Response {
        val ctx = req.context()
        val id = UUID.fromString(req.pathParam("id"))
        val enabled = req.bodyAs<Map<String, Any?>>()["enabled"] as? Boolean
            ?: throw ApiError.ValidationError("'enabled' (boolean) is required")
        val schedule = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Schedule")

        val nextFire = if (enabled) {
            val zone = runCatching { ZoneId.of(schedule.timezone) }.getOrDefault(ZoneOffset.UTC)
            runCatching { CronExpression.parse(schedule.cronExpression).nextAfter(Instant.now(), zone) }.getOrNull()
        } else {
            schedule.nextFireAt
        }
        repo.setEnabled(id, ctx.workspaceId, enabled, nextFire)
        return Response.ok(mapOf(
            "id"      to id.toString(),
            "status"  to if (enabled) "ACTIVE" else "PAUSED",
            "nextRun" to nextFire?.toString(),
        ))
    }

    private fun toResponse(row: ScheduleWithWorkflow): Map<String, Any?> {
        val s = row.schedule
        return mapOf(
            "id"            to s.id.toString(),
            "jobName"       to row.workflowName,
            "cron"          to s.cronExpression,
            // Humanized client-side from `cron`; sent as a safe fallback.
            "humanReadable" to s.cronExpression,
            "timezone"      to s.timezone,
            "nextRun"       to s.nextFireAt?.toString(),
            "lastRun"       to s.lastFireAt?.toString(),
            "status"        to if (s.enabled) "ACTIVE" else "PAUSED",
            // The schedule targets a workflow; the UI links to the workflow.
            "jobId"         to s.workflowId.toString(),
        )
    }
}
