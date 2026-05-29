package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pageParams
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.mapper
import com.vectorbea.api.queue.JobType
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.queue.WorkflowRunJob
import com.vectorbea.api.repository.Approval
import com.vectorbea.api.repository.ApprovalRepository
import com.vectorbea.api.repository.AppendEventRequest
import com.vectorbea.api.repository.DecideApprovalRequest
import com.vectorbea.api.repository.Page
import com.vectorbea.api.repository.RunEventRepository
import com.vectorbea.api.repository.RunRepository
import org.slf4j.LoggerFactory

// ── Response shape ────────────────────────────────────────────────────────────

@Suppress("UNCHECKED_CAST")
private fun Approval.toResponse(): Map<String, Any?> = mapOf(
    "id" to id.toString(),
    "runId" to runId.toString(),
    "workflowId" to workflowId.toString(),
    "stepId" to stepId,
    "nodeId" to stepId,   // frontend ApprovalItem uses nodeId; stepId is the canonical DB name
    "agentId" to agentId?.toString(),
    "status" to status.uppercase(),   // UI compares against "PENDING"/"APPROVED"/"REJECTED"
    "title" to title,
    "message" to message,
    "riskLevel" to riskLevel,
    "requestedBy" to requestedBy,
    "decidedBy" to decidedBy,
    "requestedAt" to requestedAt.toString(),
    "decidedAt" to decidedAt?.toString(),
    "decisionReason" to decisionReason,
    // sanitized payload — secrets already stripped by executor
    "payloadJsonSanitized" to payloadJsonSanitized?.let {
        runCatching { mapper.readValue(it, Map::class.java) }.getOrDefault(emptyMap<String, Any>())
    },
    "createdAt" to createdAt.toString(),
    "updatedAt" to updatedAt.toString(),
)

private val log = LoggerFactory.getLogger(ApprovalRoutes::class.java)

// ── Route handler ─────────────────────────────────────────────────────────────

class ApprovalRoutes(
    private val repo: ApprovalRepository,
    private val runRepo: RunRepository? = null,
    private val eventRepo: RunEventRepository? = null,
    private val queue: WorkflowQueue? = null,
) {

    fun register(router: Router) {
        router.get("/api/approvals", ::list)
        router.get("/api/approvals/:id", ::getById)
        router.post("/api/approvals/:id/approve", ::approve)
        router.post("/api/approvals/:id/reject",  ::reject)
    }

    private fun list(req: Request): Response {
        val ctx = req.context()
        val params = req.pageParams()
        val statusFilter = req.query("status")
        val workflowIdStr = req.query("workflowId")
        val runIdStr = req.query("runId")

        val workflowId = workflowIdStr?.let {
            try { java.util.UUID.fromString(it) }
            catch (_: IllegalArgumentException) { throw ApiError.ValidationError("workflowId must be a valid UUID") }
        }
        val runId = runIdStr?.let {
            try { java.util.UUID.fromString(it) }
            catch (_: IllegalArgumentException) { throw ApiError.ValidationError("runId must be a valid UUID") }
        }

        val page = repo.list(
            workspaceId = ctx.workspaceId,
            workflowId = workflowId,
            runId = runId,
            status = statusFilter,
            params = params,
        )
        return Response.ok(page.mapItems { it.toResponse() })
    }

    private fun getById(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val approval = repo.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Approval")
        return Response.ok(approval.toResponse())
    }

    // ── POST /api/approvals/:id/approve ───────────────────────────────────────

    private fun approve(req: Request): Response = decideApproval(req, "approved")

    // ── POST /api/approvals/:id/reject ────────────────────────────────────────

    private fun reject(req: Request): Response = decideApproval(req, "rejected")

    // ── Shared approve/reject logic ───────────────────────────────────────────

    private fun decideApproval(req: Request, decision: String): Response {
        val ctx = req.context()
        val id  = req.pathUUID("id")

        data class DecideBody(
            val decidedBy: String = "api",
            val reason: String? = null,
        )
        val body = if (req.body.isBlank()) DecideBody() else req.bodyAs<DecideBody>()

        // Load approval (workspace-scoped)
        val approval = repo.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Approval")

        if (approval.status.lowercase() != "pending") {
            throw ApiError.ValidationError(
                "Approval is already '${approval.status}' — cannot $decision"
            )
        }

        // Write decision
        val updated = repo.decide(DecideApprovalRequest(
            id          = id,
            workspaceId = ctx.workspaceId,
            decision    = decision,
            decidedBy   = body.decidedBy,
            reason      = body.reason,
        ))
        if (!updated) {
            // Race condition: another request decided it first
            throw ApiError.ValidationError("Approval decision could not be applied (already decided?)")
        }

        log.info("[approval] {} id={} runId={} stepId={} by={}",
            decision, id, approval.runId, approval.stepId, body.decidedBy)

        // Load the run to get environmentId (needed for event and job)
        val run = runRepo?.findById(approval.runId, ctx.workspaceId)

        // Emit event
        val er = eventRepo
        if (er != null && run != null) {
            runCatching {
                er.append(AppendEventRequest(
                    runId         = approval.runId,
                    workspaceId   = ctx.workspaceId,
                    environmentId = run.environmentId,
                    type          = if (decision == "approved") "APPROVAL_APPROVED" else "APPROVAL_REJECTED",
                    status        = "waiting_for_approval",
                    source        = "api:approval",
                    title         = "Approval ${decision}: ${approval.title}",
                    summary       = body.reason?.take(200),
                ))
            }.onFailure { e ->
                log.warn("[approval] failed to append decision event: {}", e.message)
            }
        }

        // Enqueue RESUME_RUN job so the worker continues the run
        val q = queue
        if (q != null && run != null) {
            runCatching {
                q.enqueue(WorkflowRunJob(
                    runId             = approval.runId.toString(),
                    workspaceId       = ctx.workspaceId.toString(),
                    environmentId     = run.environmentId.toString(),
                    workflowId        = run.workflowId.toString(),
                    workflowVersionId = run.workflowVersionId.toString(),
                    jobType           = JobType.RESUME_RUN,
                    resumeFromNodeId  = approval.stepId,
                    inputJson         = run.inputJson,
                ))
            }.onFailure { e ->
                log.error("[approval] failed to enqueue RESUME_RUN for runId={}: {}", approval.runId, e.message)
                // Don't fail the request — the decision is already recorded; operator can retry
            }
        }

        return Response.ok(mapOf(
            "id"       to id.toString(),
            "decision" to decision,
            "message"  to "Approval $decision. Run will resume shortly.",
        ))
    }
}

private fun <T, R> Page<T>.mapItems(transform: (T) -> R) =
    Page(items = items.map(transform), total = total, page = page, pageSize = pageSize)
