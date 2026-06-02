package com.vectorbea.api.architect

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.api.api.context
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router

/**
 * AI Workflow Architect API routes.
 * All routes: authenticated, workspace-scoped, beta-gated.
 */
class WorkflowArchitectRoutes(private val service: WorkflowArchitectService) {

    private val mapper = jacksonObjectMapper()

    fun register(router: Router) {
        router.post("/api/architect/sessions",            ::createSession)
        router.get("/api/architect/sessions/:id",         ::getSession)
        router.post("/api/architect/sessions/:id/generate-plan",   ::generatePlan)
        router.post("/api/architect/sessions/:id/revise-plan",     ::revisePlan)
        router.post("/api/architect/sessions/:id/approve-plan",    ::approvePlan)
        router.post("/api/architect/sessions/:id/create-workflow", ::createWorkflow)
    }

    // POST /api/architect/sessions
    private fun createSession(req: Request): Response {
        val ctx  = req.context()
        val body = req.bodyAs<Map<String, Any?>>()
        val goal = body["goal"]?.toString()?.trim()
            ?: throw ApiError.ValidationError("'goal' is required")

        if (goal.length > WorkflowArchitectService.MAX_GOAL_LENGTH) {
            throw ApiError.ValidationError("Goal text exceeds ${WorkflowArchitectService.MAX_GOAL_LENGTH} characters")
        }

        if (!service.checkDailyLimit(ctx.workspaceId)) {
            return Response.json(429, mapOf(
                "error" to "ARCHITECT_USAGE_LIMIT_EXCEEDED",
                "message" to "Daily AI Architect limit reached. Try again tomorrow.",
            ))
        }

        val envId = ctx.environmentId
            ?: throw ApiError.ValidationError("X-Environment-Id header is required")

        val session = service.createSession(
            workspaceId   = ctx.workspaceId,
            environmentId = envId,
            userId        = ctx.workspaceId, // use workspaceId as proxy — replace with real userId when available
            goal          = goal,
        )

        // Check if clarification is needed (async-safe, quick)
        val questions = try { service.checkClarification(session) } catch (_: Exception) { emptyList() }

        return Response.created(mapOf(
            "id"                    to session.id.toString(),
            "status"                to session.status,
            "userGoal"              to session.userGoal,
            "clarificationQuestions" to questions,
            "needsClarification"    to questions.isNotEmpty(),
            "createdAt"             to session.createdAt.toString(),
        ))
    }

    // GET /api/architect/sessions/:id
    private fun getSession(req: Request): Response {
        val ctx = req.context()
        val id  = java.util.UUID.fromString(req.pathParam("id"))
        val session = service.repo.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Architect session")
        return Response.ok(sessionToResponse(session))
    }

    // POST /api/architect/sessions/:id/generate-plan
    private fun generatePlan(req: Request): Response {
        val ctx  = req.context()
        val id   = java.util.UUID.fromString(req.pathParam("id"))
        val body = req.bodyAs<Map<String, Any?>>()
        @Suppress("UNCHECKED_CAST")
        val answers = (body["answers"] as? Map<String, String>) ?: emptyMap()

        val session = service.repo.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Architect session")

        val planJson = service.generatePlan(session, answers)

        // Re-fetch to get animation steps
        val updated = service.repo.findById(id, ctx.workspaceId)!!
        return Response.ok(mapOf(
            "id"             to session.id.toString(),
            "status"         to "plan_generated",
            "plan"           to mapper.readValue(planJson, Map::class.java),
            "animationSteps" to (updated.animationStepsJson?.let { mapper.readValue(it, List::class.java) } ?: emptyList<Any>()),
        ))
    }

    // POST /api/architect/sessions/:id/revise-plan
    private fun revisePlan(req: Request): Response {
        val ctx  = req.context()
        val id   = java.util.UUID.fromString(req.pathParam("id"))
        val body = req.bodyAs<Map<String, Any?>>()
        val instruction = body["instruction"]?.toString()?.trim()
            ?: throw ApiError.ValidationError("'instruction' is required")

        val session = service.repo.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Architect session")

        val revised = service.revisePlan(session, instruction)
        val updated = service.repo.findById(id, ctx.workspaceId)!!

        return Response.ok(mapOf(
            "id"             to session.id.toString(),
            "status"         to "plan_generated",
            "plan"           to mapper.readValue(revised, Map::class.java),
            "animationSteps" to (updated.animationStepsJson?.let { mapper.readValue(it, List::class.java) } ?: emptyList<Any>()),
        ))
    }

    // POST /api/architect/sessions/:id/approve-plan
    private fun approvePlan(req: Request): Response {
        val ctx = req.context()
        val id  = java.util.UUID.fromString(req.pathParam("id"))
        val session = service.repo.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Architect session")
        service.approvePlan(session)
        return Response.ok(mapOf("id" to id.toString(), "status" to "plan_approved"))
    }

    // POST /api/architect/sessions/:id/create-workflow
    private fun createWorkflow(req: Request): Response {
        val ctx  = req.context()
        val id   = java.util.UUID.fromString(req.pathParam("id"))
        val body = req.bodyAs<Map<String, Any?>>()
        @Suppress("UNCHECKED_CAST")
        val bindings = (body["connectionBindings"] as? Map<String, String>) ?: emptyMap()

        val session = service.repo.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Architect session")

        val result = service.createWorkflow(session, bindings)
        return Response.created(result)
    }

    private fun sessionToResponse(s: ArchitectSession): Map<String, Any?> = mapOf(
        "id"             to s.id.toString(),
        "status"         to s.status,
        "userGoal"       to s.userGoal,
        "plan"           to s.generatedPlanJson?.let { runCatching { mapper.readValue(it, Map::class.java) }.getOrNull() },
        "animationSteps" to s.animationStepsJson?.let { runCatching { mapper.readValue(it, List::class.java) }.getOrNull() },
        "workflowId"     to s.generatedWorkflowId?.toString(),
        "failureReason"  to s.failureReason,
        "createdAt"      to s.createdAt.toString(),
        "updatedAt"      to s.updatedAt.toString(),
    )
}
