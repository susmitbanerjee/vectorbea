package com.vectorbea.api.architect

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.api.api.context
import com.vectorbea.api.connector.ConnectionTester
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.secrets.SecretService
import java.util.UUID

/**
 * AI Workflow Architect API routes.
 * All routes: authenticated, workspace-scoped, feature-gated.
 */
class WorkflowArchitectRoutes(
    private val service: WorkflowArchitectService,
    private val connectionRepo: ConnectionRepository,
    private val secretService: SecretService,
) {

    private val mapper = jacksonObjectMapper()

    fun register(router: Router) {
        router.post("/api/architect/sessions",                                                     ::createSession)
        router.get ("/api/architect/sessions/:id",                                                 ::getSession)
        router.post("/api/architect/sessions/:id/generate-plan",                                   ::generatePlan)
        router.post("/api/architect/sessions/:id/revise-plan",                                     ::revisePlan)
        router.post("/api/architect/sessions/:id/approve-plan",                                    ::approvePlan)
        // Stage 3: connections
        router.get ("/api/architect/sessions/:id/connection-requirements",                         ::getConnectionRequirements)
        router.post("/api/architect/sessions/:id/connection-requirements/:reqId/bind-existing",    ::bindExistingConnection)
        router.post("/api/architect/sessions/:id/connection-requirements/:reqId/use-simulation",   ::useSimulationPlaceholder)
        // Stage 4/5: generate tools & agents
        router.post("/api/architect/sessions/:id/generate-tools",                                  ::generateTools)
        router.post("/api/architect/sessions/:id/generate-agents",                                 ::generateAgents)
        // Stage 6: workflow creation
        router.post("/api/architect/sessions/:id/create-workflow",                                 ::createWorkflow)
        // Build steps & readiness
        router.get ("/api/architect/sessions/:id/build-steps",                                     ::getBuildSteps)
        router.get ("/api/architect/sessions/:id/readiness",                                       ::getReadiness)
        // Connection test
        router.post("/api/architect/sessions/:id/connection-requirements/:reqId/test",             ::testConnection)
        // Workspace connections list (for picker)
        router.get ("/api/architect/connections",                                                   ::listConnections)
    }

    private fun enabledGuard(): Response? = if (!service.isEnabled()) Response.json(403, mapOf(
        "error" to "ARCHITECT_DISABLED",
        "message" to "AI Workflow Architect is not enabled. Set AI_ARCHITECT_ENABLED=true.",
    )) else null

    private fun sessionOrNotFound(id: UUID, workspaceId: UUID) =
        service.repo.findById(id, workspaceId) ?: throw ApiError.NotFound("Architect session")

    // ── POST /api/architect/sessions ─────────────────────────────────────────

    private fun createSession(req: Request): Response {
        enabledGuard()?.let { return it }
        val ctx  = req.context()
        val body = req.bodyAs<Map<String, Any?>>()
        val goal = body["goal"]?.toString()?.trim()
            ?: throw ApiError.ValidationError("'goal' is required")
        if (goal.length > WorkflowArchitectService.MAX_GOAL_LENGTH)
            throw ApiError.ValidationError("Goal exceeds ${WorkflowArchitectService.MAX_GOAL_LENGTH} chars")
        if (!service.checkDailyLimit(ctx.workspaceId))
            return Response.json(429, mapOf("error" to "ARCHITECT_USAGE_LIMIT_EXCEEDED",
                "message" to "Daily AI Architect limit reached. Try again tomorrow."))
        val envId  = ctx.environmentId ?: throw ApiError.ValidationError("X-Environment-Id header is required")
        val userId = req.principal?.appUserId ?: throw ApiError.Unauthorized("Authentication required")

        val session   = service.createSession(ctx.workspaceId, envId, userId, goal)
        val questions = try { service.checkClarification(session) } catch (_: Exception) { emptyList() }
        return Response.created(mapOf(
            "id"                      to session.id.toString(),
            "status"                  to session.status,
            "currentStage"            to session.currentStage,
            "userGoal"                to session.userGoal,
            "clarificationQuestions"  to questions,
            "needsClarification"      to questions.isNotEmpty(),
            "createdAt"               to session.createdAt.toString(),
        ))
    }

    // ── GET /api/architect/sessions/:id ──────────────────────────────────────

    private fun getSession(req: Request): Response {
        val ctx     = req.context()
        val id      = UUID.fromString(req.pathParam("id"))
        val session = sessionOrNotFound(id, ctx.workspaceId)
        return Response.ok(sessionToResponse(session))
    }

    // ── POST .../generate-plan ────────────────────────────────────────────────

    private fun generatePlan(req: Request): Response {
        enabledGuard()?.let { return it }
        val ctx  = req.context()
        val id   = UUID.fromString(req.pathParam("id"))
        @Suppress("UNCHECKED_CAST")
        val answers = (req.bodyAs<Map<String, Any?>>()["answers"] as? Map<String, String>) ?: emptyMap()
        val session = sessionOrNotFound(id, ctx.workspaceId)
        val planJson = try {
            service.generatePlan(session, answers)
        } catch (e: IllegalStateException) {
            return Response.json(503, mapOf("error" to "ARCHITECT_LLM_UNAVAILABLE",
                "message" to (e.message ?: "LLM not configured.")))
        } catch (e: Exception) {
            return Response.json(500, mapOf("error" to "PLAN_GENERATION_FAILED",
                "message" to (e.message ?: "Plan generation failed.")))
        }
        val updated = service.repo.findById(id, ctx.workspaceId)!!
        val connReqs = service.repo.listConnectionRequirements(id)
        val genTools = service.repo.listGeneratedTools(id)
        val genAgents = service.repo.listGeneratedAgents(id)
        return Response.ok(mapOf(
            "id"                     to id.toString(),
            "status"                 to "plan_generated",
            "currentStage"           to updated.currentStage,
            "plan"                   to mapper.readValue(planJson, Map::class.java),
            "connectionRequirements" to connReqs.map { connReqToMap(it) },
            "generatedTools"         to genTools.map { genToolToMap(it) },
            "generatedAgents"        to genAgents.map { genAgentToMap(it) },
            "animationSteps"         to (updated.animationStepsJson?.let { mapper.readValue(it, List::class.java) } ?: emptyList<Any>()),
        ))
    }

    // ── POST .../revise-plan ──────────────────────────────────────────────────

    private fun revisePlan(req: Request): Response {
        enabledGuard()?.let { return it }
        val ctx         = req.context()
        val id          = UUID.fromString(req.pathParam("id"))
        val instruction = req.bodyAs<Map<String, Any?>>()["instruction"]?.toString()?.trim()
            ?: throw ApiError.ValidationError("'instruction' is required")
        val session0 = sessionOrNotFound(id, ctx.workspaceId)
        if (service.repo.getRevisionCount(id) >= WorkflowArchitectService.MAX_REVISIONS)
            return Response.json(429, mapOf("error" to "REVISION_LIMIT_EXCEEDED",
                "message" to "Maximum revisions (${WorkflowArchitectService.MAX_REVISIONS}) reached."))
        val revised = try {
            service.revisePlan(session0, instruction)
        } catch (e: IllegalStateException) {
            return Response.json(503, mapOf("error" to "ARCHITECT_LLM_UNAVAILABLE", "message" to (e.message ?: "LLM not configured.")))
        } catch (e: Exception) {
            return Response.json(500, mapOf("error" to "REVISION_FAILED", "message" to (e.message ?: "Revision failed.")))
        }
        val updated  = service.repo.findById(id, ctx.workspaceId)!!
        val connReqs = service.repo.listConnectionRequirements(id)
        return Response.ok(mapOf(
            "id"                     to id.toString(),
            "status"                 to "plan_generated",
            "currentStage"           to updated.currentStage,
            "plan"                   to mapper.readValue(revised, Map::class.java),
            "connectionRequirements" to connReqs.map { connReqToMap(it) },
            "animationSteps"         to (updated.animationStepsJson?.let { mapper.readValue(it, List::class.java) } ?: emptyList<Any>()),
        ))
    }

    // ── POST .../approve-plan ─────────────────────────────────────────────────

    private fun approvePlan(req: Request): Response {
        val ctx     = req.context()
        val id      = UUID.fromString(req.pathParam("id"))
        val session = sessionOrNotFound(id, ctx.workspaceId)
        service.approvePlan(session)
        val connReqs = service.repo.listConnectionRequirements(id)
        return Response.ok(mapOf(
            "id"                     to id.toString(),
            "status"                 to "plan_approved",
            "currentStage"           to "connection_setup",
            "connectionRequirements" to connReqs.map { connReqToMap(it) },
            "needsConnections"       to connReqs.isNotEmpty(),
        ))
    }

    // ── GET .../connection-requirements ──────────────────────────────────────

    private fun getConnectionRequirements(req: Request): Response {
        val ctx     = req.context()
        val id      = UUID.fromString(req.pathParam("id"))
        sessionOrNotFound(id, ctx.workspaceId)
        val reqs = service.repo.listConnectionRequirements(id)
        return Response.ok(mapOf(
            "connectionRequirements" to reqs.map { connReqToMap(it) },
            "allReady" to reqs.all { it.status in listOf("test_passed","selected_existing","created","simulation_placeholder") || !it.requiredForSimulation },
        ))
    }

    // ── POST .../connection-requirements/:reqId/bind-existing ────────────────

    private fun bindExistingConnection(req: Request): Response {
        val ctx     = req.context()
        val id      = UUID.fromString(req.pathParam("id"))
        val reqId   = UUID.fromString(req.pathParam("reqId"))
        val body    = req.bodyAs<Map<String, Any?>>()
        val connId  = body["connectionId"]?.toString()
            ?: throw ApiError.ValidationError("'connectionId' is required")
        val session = sessionOrNotFound(id, ctx.workspaceId)
        service.bindExistingConnection(session, reqId, UUID.fromString(connId))
        return Response.ok(mapOf("id" to reqId.toString(), "status" to "selected_existing"))
    }

    // ── POST .../connection-requirements/:reqId/use-simulation ───────────────

    private fun useSimulationPlaceholder(req: Request): Response {
        val ctx     = req.context()
        val id      = UUID.fromString(req.pathParam("id"))
        val reqId   = UUID.fromString(req.pathParam("reqId"))
        val session = sessionOrNotFound(id, ctx.workspaceId)
        service.markSimulationPlaceholder(session, reqId)
        return Response.ok(mapOf("id" to reqId.toString(), "status" to "simulation_placeholder"))
    }

    // ── POST .../generate-tools ───────────────────────────────────────────────

    private fun generateTools(req: Request): Response {
        val ctx     = req.context()
        val id      = UUID.fromString(req.pathParam("id"))
        val session = sessionOrNotFound(id, ctx.workspaceId)
        val tools   = try { service.generateTools(session) }
        catch (e: Exception) { return Response.json(500, mapOf("error" to "TOOL_GENERATION_FAILED", "message" to (e.message ?: "Tool generation failed."))) }
        return Response.ok(mapOf(
            "tools"    to tools.map { genToolToMap(it) },
            "created"  to tools.count { it.status == "created" },
            "blocked"  to tools.count { it.status == "blocked_missing_connection" },
        ))
    }

    // ── POST .../generate-agents ──────────────────────────────────────────────

    private fun generateAgents(req: Request): Response {
        val ctx     = req.context()
        val id      = UUID.fromString(req.pathParam("id"))
        val session = sessionOrNotFound(id, ctx.workspaceId)
        val agents  = try { service.generateAgents(session) }
        catch (e: Exception) { return Response.json(500, mapOf("error" to "AGENT_GENERATION_FAILED", "message" to (e.message ?: "Agent generation failed."))) }
        return Response.ok(mapOf(
            "agents"  to agents.map { genAgentToMap(it) },
            "created" to agents.count { it.status == "created" },
        ))
    }

    // ── POST .../create-workflow ──────────────────────────────────────────────

    private fun createWorkflow(req: Request): Response {
        val ctx  = req.context()
        val id   = UUID.fromString(req.pathParam("id"))
        @Suppress("UNCHECKED_CAST")
        val bindings = (req.bodyAs<Map<String, Any?>>()["connectionBindings"] as? Map<String, String>) ?: emptyMap()
        val session  = sessionOrNotFound(id, ctx.workspaceId)
        val result   = try { service.createWorkflow(session, bindings) }
        catch (e: IllegalArgumentException) {
            return Response.json(400, mapOf("error" to "INVALID_REQUEST", "message" to (e.message ?: "Invalid request.")))
        } catch (e: Exception) {
            return Response.json(500, mapOf("error" to "WORKFLOW_CREATION_FAILED", "message" to (e.message ?: "Workflow creation failed.")))
        }
        return Response.created(result)
    }

    // ── GET .../build-steps ───────────────────────────────────────────────────

    private fun getBuildSteps(req: Request): Response {
        val ctx = req.context()
        val id  = UUID.fromString(req.pathParam("id"))
        sessionOrNotFound(id, ctx.workspaceId)
        val steps = service.repo.listBuildSteps(id)
        return Response.ok(mapOf("buildSteps" to steps.map { buildStepToMap(it) }))
    }

    // ── GET .../readiness ─────────────────────────────────────────────────────

    private fun getReadiness(req: Request): Response {
        val ctx     = req.context()
        val id      = UUID.fromString(req.pathParam("id"))
        val session = sessionOrNotFound(id, ctx.workspaceId)
        return Response.ok(mapOf(
            "readinessStatus" to session.readinessStatus,
            "readinessIssues" to mapper.readValue(session.readinessIssuesJson, List::class.java),
            "simulationReady" to (session.readinessStatus in listOf("simulation_ready", "real_ready")),
            "realExecutionReady" to (session.readinessStatus == "real_ready"),
        ))
    }

    // ── POST .../connection-requirements/:reqId/test ──────────────────────────

    private fun testConnection(req: Request): Response {
        val ctx    = req.context()
        val id     = UUID.fromString(req.pathParam("id"))
        val reqId  = UUID.fromString(req.pathParam("reqId"))
        sessionOrNotFound(id, ctx.workspaceId)
        val connReq = service.repo.findConnectionRequirement(reqId, id)
            ?: throw ApiError.NotFound("Connection requirement")
        val connId = connReq.boundConnectionId
            ?: return Response.json(400, mapOf("error" to "NOT_BOUND",
                "message" to "No connection is bound to this requirement. Bind a connection first."))
        val connection = connectionRepo.findById(connId, ctx.workspaceId)
            ?: return Response.json(400, mapOf("error" to "CONNECTION_NOT_FOUND",
                "message" to "Bound connection not found in workspace."))

        service.repo.updateConnectionRequirementStatus(reqId, "test_pending",
            boundConnectionId = connId, testStatus = "pending")

        return try {
            val tester = ConnectionTester(secretService)
            val result = tester.test(connection)
            val passed = result.status == com.vectorbea.api.connector.ConnectionTestResult.TestStatus.CONNECTED
            val (newStatus, testStatus, testError) = if (passed) {
                Triple("test_passed", "passed", null)
            } else {
                Triple("test_failed", "failed", result.message.take(300))
            }
            service.repo.updateConnectionRequirementStatus(reqId, newStatus,
                boundConnectionId = connId, testStatus = testStatus, testError = testError)
            service.repo.appendEvent(ctx.workspaceId, id, "ARCHITECT_CONNECTION_TESTED",
                "${connReq.name}: $testStatus", testError)
            Response.ok(mapOf(
                "id"         to reqId.toString(),
                "status"     to newStatus,
                "testStatus" to testStatus,
                "ok"         to passed,
                "latencyMs"  to result.latencyMs,
                "message"    to result.message,
            ))
        } catch (e: Exception) {
            service.repo.updateConnectionRequirementStatus(reqId, "test_failed",
                boundConnectionId = connId, testStatus = "failed",
                testError = e.message?.take(300))
            Response.json(500, mapOf("error" to "TEST_ERROR",
                "message" to (e.message ?: "Connection test failed unexpectedly.")))
        }
    }

    // ── GET /api/architect/connections ────────────────────────────────────────

    private fun listConnections(req: Request): Response {
        val ctx  = req.context()
        val type = req.query("type")
        val page = connectionRepo.list(
            workspaceId   = ctx.workspaceId,
            environmentId = ctx.environmentId,
            type          = type,
            status        = "active",
        )
        return Response.ok(mapOf(
            "connections" to page.items.map { conn -> mapOf(
                "id"         to conn.id.toString(),
                "name"       to conn.name,
                "type"       to conn.type,
                "provider"   to conn.provider,
                "status"     to conn.status,
                "testStatus" to conn.lastTestStatus,
                "testedAt"   to conn.lastTestedAt?.toString(),
            )},
            "total" to page.total,
        ))
    }

    // ── Serialization helpers ─────────────────────────────────────────────────

    private fun sessionToResponse(s: ArchitectSession): Map<String, Any?> = mapOf(
        "id"             to s.id.toString(),
        "status"         to s.status,
        "currentStage"   to s.currentStage,
        "userGoal"       to s.userGoal,
        "plan"           to s.generatedPlanJson?.let { runCatching { mapper.readValue(it, Map::class.java) }.getOrNull() },
        "animationSteps" to s.animationStepsJson?.let { runCatching { mapper.readValue(it, List::class.java) }.getOrNull() },
        "workflowId"     to s.generatedWorkflowId?.toString(),
        "readinessStatus" to s.readinessStatus,
        "failureReason"  to s.failureReason,
        "createdAt"      to s.createdAt.toString(),
        "updatedAt"      to s.updatedAt.toString(),
    )

    private fun connReqToMap(r: ConnectionRequirement) = mapOf(
        "id"                       to r.id.toString(),
        "tempConnectionId"         to r.tempConnectionId,
        "name"                     to r.name,
        "type"                     to r.type,
        "providerHint"             to r.providerHint,
        "description"              to r.description,
        "requiredForSimulation"    to r.requiredForSimulation,
        "requiredForRealExecution" to r.requiredForRealExecution,
        "status"                   to r.status,
        "boundConnectionId"        to r.boundConnectionId?.toString(),
        "testStatus"               to r.testStatus,
        "testError"                to r.testErrorSanitized,
        "setupInstructions"        to r.setupInstructions,
        "fieldsNeeded"             to runCatching { mapper.readValue(r.fieldsNeededJson, List::class.java) }.getOrDefault(emptyList<Any>()),
    )

    private fun genToolToMap(t: GeneratedTool) = mapOf(
        "id"              to t.id.toString(),
        "tempToolId"      to t.tempToolId,
        "toolId"          to t.toolId?.toString(),
        "name"            to t.name,
        "type"            to t.type,
        "status"          to t.status,
        "riskLevel"       to t.riskLevel,
        "requiresApproval" to t.requiresApproval,
        "boundConnectionId" to t.boundConnectionId?.toString(),
        "inputSchema"     to runCatching { mapper.readValue(t.inputSchemaJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
        "outputSchema"    to runCatching { mapper.readValue(t.outputSchemaJson, Map::class.java) }.getOrDefault(emptyMap<String, Any>()),
    )

    private fun genAgentToMap(a: GeneratedAgent) = mapOf(
        "id"                  to a.id.toString(),
        "tempAgentId"         to a.tempAgentId,
        "agentId"             to a.agentId?.toString(),
        "name"                to a.name,
        "type"                to a.type,
        "role"                to a.role,
        "status"              to a.status,
        "systemPromptPreview" to a.generatedSystemPrompt.take(300),
        "allowedTempToolIds"  to runCatching { mapper.readValue(a.allowedTempToolIds, List::class.java) }.getOrDefault(emptyList<Any>()),
        "boundToolIds"        to runCatching { mapper.readValue(a.boundToolIds, List::class.java) }.getOrDefault(emptyList<Any>()),
    )

    private fun buildStepToMap(b: BuildStep) = mapOf(
        "sequence"    to b.sequence,
        "type"        to b.stepType,
        "title"       to b.title,
        "description" to b.description,
        "status"      to b.status,
        "targetType"  to b.targetType,
        "targetId"    to b.targetId,
        "delayMs"     to b.delayMs,
    )
}
