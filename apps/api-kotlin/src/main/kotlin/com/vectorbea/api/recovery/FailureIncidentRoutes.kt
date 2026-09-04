package com.vectorbea.api.recovery

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.api.pageParams
import org.slf4j.LoggerFactory
import java.util.UUID

class FailureIncidentRoutes(private val repo: FailureIncidentRepository) {
    private val log = LoggerFactory.getLogger(FailureIncidentRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/runs/:runId/failure-incident",    ::getByRun)
        router.get("/api/failure-incidents",               ::list)
        router.post("/api/failure-incidents/mark-all-resolved", ::markAllResolved)
        // Registered BEFORE the :id route: the router matches in registration
        // order and "delete-resolved" would otherwise be read as an id and fail
        // as a malformed UUID.
        router.post("/api/failure-incidents/delete-resolved", ::deleteResolved)
        router.get("/api/failure-incidents/:id",           ::getById)
        router.post("/api/failure-incidents/:id/mark-resolved", ::markResolved)
        router.delete("/api/failure-incidents/:id",        ::delete)
    }

    private fun getByRun(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("runId")
        val incident = repo.findByRunId(runId, ctx.workspaceId)
            ?: return Response.noContent()   // no failure incident for this run — not an error
        return Response.ok(incident.toResponse())
    }

    private fun list(req: Request): Response {
        val ctx = req.context()
        val status   = req.query("status")
        val category = req.query("category")
        val limit    = req.query("limit")?.toIntOrNull()?.coerceIn(1, 100) ?: 50
        return Response.ok(repo.list(ctx.workspaceId, status, category, limit).map { it.toResponse() })
    }

    private fun getById(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val incident = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("FailureIncident")
        return Response.ok(incident.toResponse())
    }

    private fun markResolved(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val updated = repo.markResolved(id, ctx.workspaceId)
        if (!updated) throw ApiError.NotFound("FailureIncident")
        return Response.ok(mapOf("resolved" to true))
    }

    private fun markAllResolved(req: Request): Response {
        val ctx = req.context()
        val resolved = repo.markAllResolved(ctx.workspaceId)
        log.info("[recovery] incidents resolved workspaceId={} count={}", ctx.workspaceId, resolved)
        return Response.ok(mapOf("resolved" to resolved))
    }

    /**
     * DELETE /api/failure-incidents/:id
     *
     * Purging resolved every open incident and deleted nothing, so a workspace
     * accumulated signature rows it could never clear — the resolved filter was
     * the only place they went, and they stayed there. This removes the record.
     * 404 rather than 204 on a miss, so deleting an id from another workspace is
     * indistinguishable from deleting one that never existed.
     */
    private fun delete(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        if (!repo.delete(id, ctx.workspaceId)) throw ApiError.NotFound("FailureIncident")
        return Response.ok(mapOf("deleted" to true))
    }

    /**
     * POST /api/failure-incidents/delete-resolved
     *
     * The second half of a purge: resolve everything open, then clear what is
     * resolved. Open incidents are never touched here — deleting a live problem
     * is not tidying, it is losing the evidence during the incident.
     */
    private fun deleteResolved(req: Request): Response {
        val ctx = req.context()
        val deleted = repo.deleteResolved(ctx.workspaceId)
        log.info("[recovery] resolved incidents purged workspaceId={} count={}", ctx.workspaceId, deleted)
        return Response.ok(mapOf("deleted" to deleted))
    }

    private fun FailureIncidentRow.toResponse() = mapOf(
        "id"                   to id.toString(),
        "runId"                to runId.toString(),
        "workflowId"           to workflowId.toString(),
        "failedNodeId"         to failedNodeId,
        "failedStepId"         to failedStepId,
        "failedAgentId"        to failedAgentId?.toString(),
        "failedToolId"         to failedToolId?.toString(),
        "failedConnectionId"   to failedConnectionId?.toString(),
        "category"             to category,
        "code"                 to code,
        "severity"             to severity,
        "summary"              to summary,
        "technicalSummary"     to technicalSummary,
        "recommendedAction"    to recommendedAction,
        "retryable"            to retryable,
        "autoReplaySafe"       to autoReplaySafe,
        "requiresHumanApproval" to requiresHumanApproval,
        "remediationJson"      to remediationJson,
        "detectedAt"           to detectedAt.toString(),
        "resolutionStatus"     to resolutionStatus,
    )
}
