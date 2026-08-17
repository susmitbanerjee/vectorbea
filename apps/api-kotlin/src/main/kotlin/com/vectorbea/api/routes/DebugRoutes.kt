package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.toJson
import com.vectorbea.api.queue.JobType
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.queue.WorkflowQueueException
import com.vectorbea.api.queue.WorkflowRunJob
import com.vectorbea.api.repository.CreateRunRequest
import com.vectorbea.api.repository.NodeDebugSnapshot
import com.vectorbea.api.repository.DebugSnapshotRepository
import com.vectorbea.api.repository.RunRepository
import com.vectorbea.api.repository.WorkflowRepository
import org.slf4j.LoggerFactory
import java.util.UUID

private val log = LoggerFactory.getLogger(DebugRoutes::class.java)

private fun NodeDebugSnapshot.toSummary(): Map<String, Any?> = mapOf(
    "nodeId" to nodeId,
    "nodeType" to nodeType,
    "nodeName" to nodeName,
    "status" to status,
    "attempt" to attempt,
    "errorType" to errorType,
    "humanFailureReason" to humanFailureReason,
    "startedAt" to startedAt?.toString(),
    "finishedAt" to finishedAt?.toString(),
    "durationMs" to durationMs,
    "hasFailure" to (status == "failed"),
)

private fun NodeDebugSnapshot.toDetail(): Map<String, Any?> = mapOf(
    "id" to id.toString(),
    "workflowRunId" to workflowRunId.toString(),
    "nodeId" to nodeId,
    "nodeType" to nodeType,
    "nodeName" to nodeName,
    "attempt" to attempt,
    "status" to status,
    "inputTemplate" to inputTemplateJson,
    "resolvedInput" to resolvedInputJson,
    "resolvedVariables" to resolvedVariablesJson,
    "variableSources" to variableSourcesJson,
    "output" to outputJson,
    "parsedOutput" to parsedOutputJson,
    "schemaValidation" to schemaValidationJson,
    "errorType" to errorType,
    "errorMessage" to errorMessage,
    "humanFailureReason" to humanFailureReason,
    "suggestedFix" to suggestedFix,
    "modelProvider" to modelProvider,
    "modelName" to modelName,
    "tokensInput" to tokensInput,
    "tokensOutput" to tokensOutput,
    "costEstimate" to costEstimate,
    "startedAt" to startedAt?.toString(),
    "finishedAt" to finishedAt?.toString(),
    "durationMs" to durationMs,
    "createdAt" to createdAt.toString(),
)

/**
 * Routes for the Workflow Debugger ("Debug Run").
 *
 * Distinct from [RunRoutes] / logs: this surfaces *resolved inputs, outputs,
 * variable provenance and human-readable failure explanations* captured only
 * when a run was started in debug mode — never for normal Run Now executions.
 */
class DebugRoutes(
    private val runRepo: RunRepository,
    private val debugRepo: DebugSnapshotRepository,
    private val workflowRepo: WorkflowRepository? = null,
    private val queue: WorkflowQueue? = null,
    private val classResolver: com.vectorbea.api.queue.ExecutionClassResolver? = null,
) {
    private fun classifyVersion(versionId: java.util.UUID) =
        classResolver?.resolve(versionId) ?: com.vectorbea.api.queue.ExecutionClass.SHORT

    fun register(router: Router) {
        router.post("/api/workflows/:workflowId/runs/debug", ::startDebugRun)
        router.get("/api/workflow-runs/:runId/debug/nodes", ::listNodeSummaries)
        router.get("/api/workflow-runs/:runId/debug/nodes/:nodeId", ::getNodeDetail)
        router.get("/api/workflow-runs/:runId/debug/nodes/:nodeId/attempts", ::listNodeAttempts)
    }

    // ── POST /api/workflows/:workflowId/runs/debug ────────────────────────────

    private fun startDebugRun(req: Request): Response {
        val ctx = req.context()
        val environmentId = ctx.requireEnvironmentId()
        val workflowId = req.pathUUID("workflowId")

        val wfRepo = workflowRepo ?: throw ApiError.InternalError("Workflow repository not available")
        val q = queue ?: throw ApiError.ServiceUnavailable("Queue not available — Redis required")

        val workflow = wfRepo.findById(workflowId, ctx.workspaceId) ?: throw ApiError.NotFound("Workflow")
        if (workflow.status == "archived") {
            throw ApiError.ValidationError("Workflow '${workflow.name}' is archived and cannot be triggered")
        }
        val versionId = workflow.currentVersionId
            ?: throw ApiError.ValidationError("Workflow '${workflow.name}' has no current version — publish a version first")

        data class DebugTriggerBody(val input: Map<String, Any?> = emptyMap())
        val body = if (req.body.isBlank()) DebugTriggerBody() else req.bodyAs<DebugTriggerBody>()

        val inputJson = try {
            toJson(body.input)
        } catch (e: Exception) {
            throw ApiError.ValidationError("Invalid input JSON: ${e.message}")
        }

        // A debug run executes the same graph as a normal run, so it is
        // classified identically and shares its pool. Debug is an observability
        // mode, not an execution class.
        val debugClass = classifyVersion(versionId)

        // Debug runs are scoped to a single run — never persisted as a workflow-level setting.
        val run = runRepo.create(CreateRunRequest(
            workspaceId = ctx.workspaceId,
            environmentId = environmentId,
            workflowId = workflowId,
            workflowVersionId = versionId,
            triggerType = "manual",
            inputJson = inputJson,
            debugMode = true,
            executionClass = debugClass.wire,
        ))

        val job = WorkflowRunJob(
            runId = run.id.toString(),
            workspaceId = ctx.workspaceId.toString(),
            environmentId = environmentId.toString(),
            workflowId = workflowId.toString(),
            workflowVersionId = versionId.toString(),
            jobType = JobType.START_RUN,
            inputJson = inputJson,
            requestedByUserId = req.principal?.appUserId?.toString(),
            debugMode = true,
            executionClass = debugClass,
        )

        try {
            q.enqueue(job)
        } catch (e: WorkflowQueueException) {
            log.error("[debug-run] enqueue failed for runId={}: {}", run.id, e.message)
            runCatching { runRepo.updateStatus(run.id, ctx.workspaceId, "enqueue_failed") }
            throw ApiError.ServiceUnavailable("Failed to enqueue debug run: queue unavailable")
        }

        log.info("[debug-run] started runId={} workflowId={}", run.id, workflowId)

        return Response.accepted(mapOf(
            "runId" to run.id.toString(),
            "status" to "QUEUED",
            "debugMode" to true,
        ))
    }

    // ── GET /api/workflow-runs/:runId/debug/nodes ─────────────────────────────

    private fun listNodeSummaries(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("runId")
        val run = runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")

        if (!run.debugMode) {
            return Response.ok(mapOf(
                "runId" to runId.toString(),
                "debugMode" to false,
                "nodes" to emptyList<Any>(),
                "message" to "No debug data captured. Run this workflow with Debug Run.",
            ))
        }

        val nodes = debugRepo.listLatestByRun(runId, ctx.workspaceId).map { it.toSummary() }
        return Response.ok(mapOf(
            "runId" to runId.toString(),
            "debugMode" to true,
            "nodes" to nodes,
        ))
    }

    // ── GET /api/workflow-runs/:runId/debug/nodes/:nodeId ─────────────────────

    private fun getNodeDetail(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("runId")
        val nodeId = req.pathParam("nodeId")
        val run = runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")
        if (!run.debugMode) throw ApiError.NotFound("Debug snapshot")

        val snapshot = debugRepo.findLatest(runId, ctx.workspaceId, nodeId)
            ?: throw ApiError.NotFound("Debug snapshot")

        return Response.ok(snapshot.toDetail())
    }

    // ── GET /api/workflow-runs/:runId/debug/nodes/:nodeId/attempts ────────────

    private fun listNodeAttempts(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("runId")
        val nodeId = req.pathParam("nodeId")
        val run = runRepo.findById(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")
        if (!run.debugMode) {
            return Response.ok(mapOf("runId" to runId.toString(), "nodeId" to nodeId, "attempts" to emptyList<Any>()))
        }

        val attempts = debugRepo.listAttempts(runId, ctx.workspaceId, nodeId).map { it.toDetail() }
        return Response.ok(mapOf(
            "runId" to runId.toString(),
            "nodeId" to nodeId,
            "attempts" to attempts,
        ))
    }
}
