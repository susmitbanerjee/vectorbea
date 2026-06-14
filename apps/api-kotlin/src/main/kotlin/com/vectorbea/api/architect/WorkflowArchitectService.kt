package com.vectorbea.api.architect

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.repository.AgentRepository
import com.vectorbea.api.repository.CreateAgentRequest
import com.vectorbea.api.repository.CreateToolRequest
import com.vectorbea.api.repository.CreateWorkflowRequest
import com.vectorbea.api.repository.CreateWorkflowVersionRequest
import com.vectorbea.api.repository.ConnectionRepository
import com.vectorbea.api.repository.ToolRepository
import com.vectorbea.api.repository.WorkflowRepository
import org.slf4j.LoggerFactory
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID
import javax.sql.DataSource

/**
 * AI Workflow Architect service — full pipeline:
 * Goal → Plan → Connections → Tools → Agents → Workflow Graph → Animation
 *
 * Security: never logs or returns secrets. All LLM prompts are sanitized.
 */
class WorkflowArchitectService(
    val repo: WorkflowArchitectRepository,
    private val workflowRepo: WorkflowRepository,
    private val toolRepo: ToolRepository,
    private val agentRepo: AgentRepository,
    private val connectionRepo: ConnectionRepository,
    private val dataSource: DataSource,
    private val config: AppConfig,
) {
    private val log    = LoggerFactory.getLogger(WorkflowArchitectService::class.java)
    private val mapper = jacksonObjectMapper()
    private val http   = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build()

    companion object {
        const val MAX_DAILY_REQUESTS = 20
        /** Architect is a heavyweight accelerator — one full build per workspace per rolling window. */
        const val MAX_BUILDS_PER_PERIOD = 1
        /** Length of the rolling cooldown window, in days. */
        const val BUILD_PERIOD_DAYS = 30
        const val MAX_GOAL_LENGTH    = 4000
        const val MAX_REVISIONS      = 5
        /** Namespaced classid for architect-build advisory locks (avoids clashing with other advisory locks). */
        const val BUILD_LOCK_CLASSID = 0x41524348  // "ARCH"
    }

    /** Snapshot of a workspace's architect build allowance — surfaced to the UI. */
    data class ArchitectUsage(
        val used: Int,
        val limit: Int,
        val periodDays: Int,
        val lastBuildAt: java.time.Instant?,
        /** When the next build unlocks (lastBuild + period). Null when not currently locked. */
        val resetAt: java.time.Instant?,
        val locked: Boolean,
    )

    /** Thrown when a build would exceed the rolling build limit. Carries usage for the UI. */
    class BuildLimitExceededException(val usage: ArchitectUsage) :
        RuntimeException("ARCHITECT_USAGE_LIMIT_EXCEEDED")

    /** Thrown when another build is already running for this workspace (advisory lock held). */
    class BuildInProgressException : RuntimeException("ARCHITECT_BUILD_IN_PROGRESS")

    fun isEnabled(): Boolean = config.architectEnabled

    private fun defaultLimits(): Map<String, Any> = mapOf(
        "maxSteps" to 20, "maxAgents" to 5, "maxTools" to 10,
        "maxParallelBranches" to 4, "schedulesEnabled" to true,
        "webhooksEnabled" to true, "iterativeAgentsEnabled" to config.architectEnabled,
    )

    fun checkDailyLimit(workspaceId: UUID): Boolean =
        repo.getDailyPlanningRequests(workspaceId) < MAX_DAILY_REQUESTS

    /** One architect build per workspace per rolling [BUILD_PERIOD_DAYS]-day window. */
    fun checkBuildLimit(workspaceId: UUID): Boolean =
        repo.getBuildsInPeriod(workspaceId, BUILD_PERIOD_DAYS) < MAX_BUILDS_PER_PERIOD

    /**
     * Authoritative build-time check (abuse-proof). A session that already produced
     * a workflow may re-run idempotently; otherwise builds from OTHER sessions in the
     * window count, so a user can't bypass the limit with extra sessions.
     */
    fun canBuildWorkflow(session: ArchitectSession): Boolean {
        if (session.generatedWorkflowId != null) return true
        return repo.getBuildsInPeriodExcludingSession(session.workspaceId, session.id, BUILD_PERIOD_DAYS) < MAX_BUILDS_PER_PERIOD
    }

    /** Current build allowance + exact reset time for this workspace. */
    fun getUsage(workspaceId: UUID): ArchitectUsage {
        val used      = repo.getBuildsInPeriod(workspaceId, BUILD_PERIOD_DAYS)
        val lastBuild = repo.getLastBuildAt(workspaceId)
        val locked    = used >= MAX_BUILDS_PER_PERIOD
        val resetAt   = if (locked) lastBuild?.plus(java.time.Duration.ofDays(BUILD_PERIOD_DAYS.toLong())) else null
        return ArchitectUsage(
            used = used, limit = MAX_BUILDS_PER_PERIOD, periodDays = BUILD_PERIOD_DAYS,
            lastBuildAt = lastBuild, resetAt = resetAt, locked = locked,
        )
    }

    // ── Stage 1: Create session ───────────────────────────────────────────────

    fun createSession(workspaceId: UUID, environmentId: UUID, userId: UUID, goal: String): ArchitectSession {
        require(goal.length <= MAX_GOAL_LENGTH) { "Goal text exceeds $MAX_GOAL_LENGTH characters" }
        // Early feedback only — the authoritative gate is enforced at build time
        // (createWorkflow) so multiple open sessions cannot bypass the limit.
        require(checkBuildLimit(workspaceId)) { "AI Architect build limit reached ($MAX_BUILDS_PER_PERIOD per $BUILD_PERIOD_DAYS days)" }
        val session = repo.create(workspaceId, environmentId, userId, goal)
        repo.appendEvent(workspaceId, session.id, "ARCHITECT_SESSION_CREATED", "Session created", goal.take(200))
        repo.incrementUsage(workspaceId)
        return session
    }

    // ── Stage 1: Clarification check ─────────────────────────────────────────

    /**
     * Adaptive clarification: the LLM decides how many questions (0–5) the goal
     * genuinely needs. Each question is a structured object:
     *   { question, why, suggestions[] }
     * Plain-string questions from older prompts are normalized into that shape.
     */
    fun checkClarification(session: ArchitectSession): List<Map<String, Any?>> {
        if (!config.architectEnabled) return emptyList()
        val prompt = WorkflowArchitectPromptBuilder.buildClarificationPrompt(session.userGoal)
        val raw = try { callPlanningLlm(prompt, maxTokens = 900) } catch (e: Exception) {
            log.warn("[architect] clarification LLM call failed: {}", e.message)
            return emptyList()
        }
        return try {
            @Suppress("UNCHECKED_CAST")
            val parsed = mapper.readValue(raw, Map::class.java) as Map<String, Any>
            val needs  = parsed["needsClarification"] as? Boolean ?: false
            if (needs) {
                val questions = (parsed["questions"] as? List<*>)
                    ?.mapNotNull { normalizeClarifyQuestion(it) }
                    ?.take(5)
                    ?: emptyList()
                if (questions.isNotEmpty()) {
                    repo.saveClarifications(session.id, mapper.writeValueAsString(questions))
                    repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_CLARIFICATION_REQUESTED",
                        "Clarification needed", "${questions.size} questions")
                }
                questions
            } else emptyList()
        } catch (e: Exception) {
            log.warn("[architect] clarification parse failed: {}", e.message)
            emptyList()
        }
    }

    private fun normalizeClarifyQuestion(entry: Any?): Map<String, Any?>? = when (entry) {
        is String -> if (entry.isBlank()) null else mapOf(
            "question" to entry, "why" to null, "suggestions" to emptyList<String>())
        is Map<*, *> -> {
            val q = entry["question"]?.toString()?.takeIf { it.isNotBlank() } ?: return null
            mapOf(
                "question"    to q,
                "why"         to entry["why"]?.toString()?.takeIf { it.isNotBlank() },
                "suggestions" to ((entry["suggestions"] as? List<*>)
                    ?.mapNotNull { it?.toString()?.takeIf { s -> s.isNotBlank() } }
                    ?.take(4) ?: emptyList<String>()),
            )
        }
        else -> null
    }

    // ── Stage 2: Generate plan ────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    fun generatePlan(session: ArchitectSession, answers: Map<String, String> = emptyMap()): String {
        require(config.architectEnabled) { "AI Architect is not enabled" }
        val systemPrompt = WorkflowArchitectPromptBuilder.buildSystemPrompt(defaultLimits())
        val userPrompt   = WorkflowArchitectPromptBuilder.buildPlanningPrompt(session.userGoal, answers)

        var planJson = callPlanningLlm(userPrompt, systemPrompt = systemPrompt, maxTokens = 4000)

        // Validate and repair once if needed
        val validationError = validatePlanJson(planJson)
        if (validationError != null) {
            log.warn("[architect] plan validation failed: {} — attempting repair", validationError)
            val repaired = try {
                callPlanningLlm(WorkflowArchitectPromptBuilder.buildRepairPrompt(planJson, validationError), maxTokens = 4000)
            } catch (e: Exception) { null }
            if (repaired != null) {
                val repairError = validatePlanJson(repaired)
                if (repairError == null) {
                    planJson = repaired
                    log.info("[architect] plan repaired successfully")
                } else {
                    throw RuntimeException("Plan validation failed after repair: $repairError")
                }
            } else {
                throw RuntimeException("Plan validation failed: $validationError")
            }
        }

        // Materialize connection requirements from plan
        val plan = mapper.readValue(planJson, Map::class.java) as Map<String, Any?>
        materializeConnectionRequirements(session, plan)

        // Pre-materialize tools/agents as "planned"
        materializePlannedTools(session, plan)
        materializePlannedAgents(session, plan)

        // Generate initial animation + graph (will be updated after real tool/agent creation)
        val animSteps = generatePreliminaryAnimationSteps(planJson)
        val graphJson = compilePlanToGraphJson(planJson, emptyMap(), emptyMap())

        repo.savePlan(session.id, planJson, graphJson, animSteps)
        repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_PLAN_GENERATED", "Workflow plan generated")
        return planJson
    }

    // ── Stage 2: Revise plan ──────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    fun revisePlan(session: ArchitectSession, instruction: String): String {
        require(config.architectEnabled) { "AI Architect is not enabled" }
        require(session.generatedPlanJson != null) { "No plan to revise" }
        val prompt  = WorkflowArchitectPromptBuilder.buildRevisionPrompt(instruction, session.generatedPlanJson)
        val revised = callPlanningLlm(prompt, maxTokens = 4000)
        validatePlanJson(revised)?.let { throw RuntimeException("Revised plan invalid: $it") }

        val plan = mapper.readValue(revised, Map::class.java) as Map<String, Any?>
        materializeConnectionRequirements(session, plan)
        materializePlannedTools(session, plan)
        materializePlannedAgents(session, plan)

        val animSteps = generatePreliminaryAnimationSteps(revised)
        val graphJson = compilePlanToGraphJson(revised, emptyMap(), emptyMap())
        repo.savePlan(session.id, revised, graphJson, animSteps)
        repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_PLAN_REVISED", "Plan revised", instruction.take(200))
        return revised
    }

    // ── Stage 3: Approve plan → materialise connection requirements ───────────

    fun approvePlan(session: ArchitectSession) {
        require(session.generatedPlanJson != null) { "No plan to approve" }
        repo.approvePlan(session.id)
        repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_PLAN_APPROVED", "Plan approved by user")
    }

    // ── Stage 3: Connection binding ───────────────────────────────────────────

    fun bindExistingConnection(session: ArchitectSession, requirementId: UUID, connectionId: UUID) {
        val req = repo.findConnectionRequirement(requirementId, session.id)
            ?: throw IllegalArgumentException("Connection requirement not found")
        // Security: verify the connection belongs to this workspace — prevents cross-tenant binding
        connectionRepo.findById(connectionId, session.workspaceId)
            ?: throw IllegalArgumentException("Connection $connectionId not found in workspace ${session.workspaceId}")
        repo.updateConnectionRequirementStatus(req.id, "selected_existing", boundConnectionId = connectionId)
        repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_CONNECTION_BOUND",
            "Connection bound: ${req.name}", "requirementId=$requirementId")
    }

    fun markSimulationPlaceholder(session: ArchitectSession, requirementId: UUID) {
        val req = repo.findConnectionRequirement(requirementId, session.id)
            ?: throw IllegalArgumentException("Connection requirement not found")
        repo.updateConnectionRequirementStatus(req.id, "simulation_placeholder")
        repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_CONNECTION_PLACEHOLDER",
            "Simulation placeholder: ${req.name}")
    }

    fun getConnectionRequirements(session: ArchitectSession): List<ConnectionRequirement> =
        repo.listConnectionRequirements(session.id)

    // ── Stage 4: Generate real tools ──────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    fun generateTools(session: ArchitectSession): List<GeneratedTool> {
        require(session.generatedPlanJson != null) { "No plan found" }
        val plan  = mapper.readValue(session.generatedPlanJson, Map::class.java) as Map<String, Any?>
        val tools = plan["tools"] as? List<*> ?: emptyList<Any>()
        val connReqs = repo.listConnectionRequirements(session.id).associateBy { it.tempConnectionId }

        var seq = 10
        val result = mutableListOf<GeneratedTool>()

        for (toolEntry in tools) {
            val t = toolEntry as? Map<*, *> ?: continue
            val tempToolId      = t["tempToolId"]?.toString() ?: continue
            val name            = t["name"]?.toString() ?: "Tool"
            val rawType         = t["type"]?.toString() ?: "generic_tool"
            // Normalize LLM type names → worker-supported canonical types
            val type = when (rawType.lowercase()) {
                "http_api", "rest_api", "api", "rest" -> "http"
                "database_read", "db_read"             -> "database_read"
                "database_write", "db_write"           -> "database_write"
                "database", "db"                       -> "database"
                "email", "smtp", "sendgrid", "resend",
                "builtin_email"                        -> "builtin_email"
                "slack"                                -> "slack"
                "crm"                                  -> "crm"
                else                                   -> "http"  // safest fallback for unknown external types
            }
            val connTempId      = t["connectionTempId"]?.toString()
            val riskLevel       = t["riskLevel"]?.toString() ?: "low"
            val requiresApproval = (t["requiresApproval"] as? Boolean) ?: (riskLevel == "high")
            val inputSchema     = t["inputSchema"]?.let { mapper.writeValueAsString(it) } ?: "{}"
            val outputSchema    = t["outputSchema"]?.let { mapper.writeValueAsString(it) } ?: "{}"
            val operation       = t["operation"]?.let { mapper.writeValueAsString(it) } ?: "{}"
            val simulationOut   = t["simulationOutput"]?.let { mapper.writeValueAsString(it) } ?: "{}"
            val configJson      = mapper.writeValueAsString(mapOf(
                "operation" to (t["operation"] ?: emptyMap<String, Any>()),
                "simulationOutput" to (t["simulationOutput"] ?: emptyMap<String, Any>()),
            ))

            val connReq = connTempId?.let { connReqs[it] }
            val isTransform = type == "transform"
            val isMissingConn = !isTransform && connReq == null
            val hasReadyConn = connReq?.status?.let { it == "test_passed" || it == "selected_existing" || it == "created" || it == "simulation_placeholder" } ?: isTransform

            val toolStatus = when {
                isMissingConn                          -> "blocked_missing_connection"
                !hasReadyConn && type != "transform"   -> "blocked_missing_connection"
                else                                   -> "planned"
            }

            // Persist to architect tracking table
            val genTool = repo.upsertGeneratedTool(
                workspaceId = session.workspaceId, sessionId = session.id,
                tempToolId = tempToolId, name = name, type = type,
                connectionRequirementId = connReq?.id,
                boundConnectionId = connReq?.boundConnectionId,
                status = toolStatus, configJson = configJson,
                inputSchemaJson = inputSchema, outputSchemaJson = outputSchema,
                riskLevel = riskLevel, requiresApproval = requiresApproval,
            )

            // Create real tool record if we have everything
            if (toolStatus == "planned") {
                try {
                    val slug = name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-') +
                        "-" + session.id.toString().take(6)
                    val tool = toolRepo.create(CreateToolRequest(
                        workspaceId   = session.workspaceId,
                        environmentId = session.environmentId,
                        name          = name,
                        slug          = slug,
                        type          = type,
                        description   = t["description"]?.toString(),
                        connectionId  = connReq?.boundConnectionId,
                        inputSchema   = mapper.readValue(inputSchema, Map::class.java) as Map<String, Any>,
                        outputSchema  = mapper.readValue(outputSchema, Map::class.java) as Map<String, Any>,
                        config        = mapper.readValue(configJson, Map::class.java) as Map<String, Any>,
                        riskLevel     = riskLevel,
                        requiresApproval = requiresApproval,
                        timeoutMs     = (t["timeoutMs"] as? Int),
                        status        = "active",
                    ))
                    repo.updateGeneratedToolId(genTool.id, tool.id, "created")
                    log.info("[architect] created tool '{}' → {}", name, tool.id)

                    repo.insertBuildStep(session.workspaceId, session.id, seq++,
                        "create_tool", "Creating tool: $name",
                        "Type: $type · Risk: $riskLevel",
                        targetType = "tool", targetId = tool.id.toString(),
                        delayMs = 600,
                    )
                    result.add(genTool.copy(toolId = tool.id, status = "created"))
                } catch (e: Exception) {
                    log.error("[architect] failed to create tool '{}': {}", name, e.message)
                    repo.upsertGeneratedTool(
                        session.workspaceId, session.id, tempToolId, name, type,
                        connReq?.id, connReq?.boundConnectionId, "failed",
                        configJson, inputSchema, outputSchema, riskLevel, requiresApproval,
                    )
                    result.add(genTool.copy(status = "failed"))
                }
            } else {
                result.add(genTool)
            }
        }

        repo.markToolsGenerated(session.id)
        repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_TOOLS_GENERATED",
            "Tools generated", "${result.count { it.status == "created" }} created, ${result.count { it.status == "blocked_missing_connection" }} blocked")
        return result
    }

    // ── Stage 5: Generate real agents ─────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    fun generateAgents(session: ArchitectSession): List<GeneratedAgent> {
        require(session.generatedPlanJson != null) { "No plan found" }
        val plan   = mapper.readValue(session.generatedPlanJson, Map::class.java) as Map<String, Any?>
        val agents = plan["agents"] as? List<*> ?: emptyList<Any>()
        val genTools = repo.listGeneratedTools(session.id).associateBy { it.tempToolId }
        val workflowName = plan["workflowName"]?.toString() ?: "AI Workflow"

        // Build tempConnectionId → boundConnectionId map from session requirements
        val connReqsByTempId = repo.listConnectionRequirements(session.id)
            .filter { it.boundConnectionId != null }
            .associateBy { it.tempConnectionId }

        // Find a workspace-level LLM connection as fallback
        // (any connection whose type contains "llm", "openai", "anthropic", "ai")
        val llmFallbackConnectionId: UUID? = connectionRepo.list(
            workspaceId = session.workspaceId, environmentId = null, type = null, status = null
        ).items.firstOrNull { conn ->
            val t = conn.type.lowercase()
            t.contains("llm") || t.contains("openai") || t.contains("anthropic") ||
            t.contains("ai") || t.contains("claude") || t.contains("gemini") ||
            conn.provider.lowercase().let { p ->
                p.contains("openai") || p.contains("anthropic") || p.contains("llm")
            }
        }?.id

        var seq = 50
        val result = mutableListOf<GeneratedAgent>()

        for (agentEntry in agents) {
            val a = agentEntry as? Map<*, *> ?: continue
            val tempAgentId = a["tempAgentId"]?.toString() ?: continue
            val name        = a["name"]?.toString() ?: "Agent"
            val type        = a["type"]?.toString() ?: "native_llm_agent"
            val role        = a["role"]?.toString()
            val outputSchema = a["outputSchema"]?.let { mapper.writeValueAsString(it) } ?: "{}"

            // Resolve allowed tool IDs
            @Suppress("UNCHECKED_CAST")
            val allowedTempToolIds = (a["allowedTempToolIds"] as? List<*>)?.map { it.toString() } ?: emptyList()
            val boundToolIds = allowedTempToolIds.mapNotNull { genTools[it]?.toolId?.toString() }
            val allToolsReady = allowedTempToolIds.all { genTools[it]?.status == "created" || genTools[it]?.status == null }

            // Use LLM-generated system prompt if present and non-placeholder, else build fallback
            val systemPrompt = a["systemPrompt"]?.toString()
                ?.takeIf { it.isNotBlank() && it != "DETAILED production-quality system prompt (200+ words)" }
                ?: buildFallbackSystemPrompt(
                    name = name,
                    role = role ?: "Analyze and process workflow data, return a structured JSON result.",
                    tools = allowedTempToolIds.mapNotNull { genTools[it]?.name },
                    workflowName = workflowName,
                    outputSchemaJson = outputSchema,
                )

            // Resolve LLM connection: plan tempId → bound connection → workspace fallback
            val llmTempId = a["llmConnectionTempId"]?.toString()
            val llmConnectionId: UUID? = llmTempId?.let { connReqsByTempId[it]?.boundConnectionId }
                ?: llmFallbackConnectionId

            if (llmConnectionId == null) {
                log.warn("[architect] agent '{}' has no LLM connection — will use platform default if configured", name)
            } else {
                log.info("[architect] agent '{}' → llmConnectionId={}", name, llmConnectionId)
            }

            val status = if (!allToolsReady) "blocked_missing_tools" else "planned"

            val genAgent = repo.upsertGeneratedAgent(
                workspaceId = session.workspaceId, sessionId = session.id,
                tempAgentId = tempAgentId, name = name, type = type, role = role,
                systemPrompt = systemPrompt,
                allowedTempToolIds = mapper.writeValueAsString(allowedTempToolIds),
                outputSchemaJson = outputSchema, status = status,
            )

            if (status == "planned") {
                try {
                    val slug = name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-') +
                        "-" + session.id.toString().take(6)
                    val modelHints = a["modelHints"] as? Map<*, *>
                    val agent = agentRepo.create(CreateAgentRequest(
                        workspaceId      = session.workspaceId,
                        environmentId    = session.environmentId,
                        name             = name,
                        slug             = slug,
                        type             = type,
                        role             = role,
                        instructions     = systemPrompt,
                        llmConnectionId  = llmConnectionId,   // ← resolved LLM connection
                        modelName        = config.architectModel ?: "gpt-4o-mini",
                        temperature      = (modelHints?.get("temperature") as? Number)?.toDouble() ?: 0.2,
                        maxTokens        = (modelHints?.get("maxTokens") as? Number)?.toInt() ?: 4000,
                        allowedToolIds   = boundToolIds,
                        outputSchema     = runCatching {
                            mapper.readValue(outputSchema, Map::class.java) as Map<String, Any>
                        }.getOrDefault(emptyMap()),
                        status           = "active",
                    ))
                    repo.updateGeneratedAgentId(genAgent.id, agent.id, mapper.writeValueAsString(boundToolIds), "created")
                    log.info("[architect] created agent '{}' → {}", name, agent.id)

                    repo.insertBuildStep(session.workspaceId, session.id, seq++,
                        "create_agent", "Creating agent: $name",
                        "Role: ${role ?: "processor"} · Tools: ${boundToolIds.size}",
                        targetType = "agent", targetId = agent.id.toString(),
                        delayMs = 800,
                    )
                    result.add(genAgent.copy(agentId = agent.id, status = "created"))
                } catch (e: Exception) {
                    log.error("[architect] failed to create agent '{}': {}", name, e.message)
                    result.add(genAgent.copy(status = "failed"))
                }
            } else {
                result.add(genAgent)
            }
        }

        repo.markAgentsGenerated(session.id)
        repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_AGENTS_GENERATED",
            "Agents generated", "${result.count { it.status == "created" }} created")
        return result
    }

    // ── Stage 6: Create workflow graph using real IDs ─────────────────────────

    @Suppress("UNCHECKED_CAST")
    fun createWorkflow(session: ArchitectSession, connectionBindings: Map<String, String>): Map<String, Any?> {
        require(session.status in listOf("plan_approved", "creating_workflow") ||
            session.currentStage in listOf("tool_generation", "agent_generation", "workflow_graph_generation"))
            { "Session must be in plan_approved stage. Current: ${session.status}/${session.currentStage}" }
        require(session.generatedPlanJson != null) { "No plan found" }

        // ABUSE + RACE GUARD: serialize concurrent builds for this workspace with a
        // per-workspace Postgres advisory lock, then re-check the limit while holding
        // it. This makes the check-then-build atomic — two simultaneous createWorkflow
        // calls can't both pass. A second concurrent build fast-fails (BUILD_IN_PROGRESS).
        val lockConn = acquireBuildLock(session.workspaceId)
            ?: throw BuildInProgressException()
        try {
            // Authoritative limit check — race-free while the lock is held.
            if (!canBuildWorkflow(session)) throw BuildLimitExceededException(getUsage(session.workspaceId))

            repo.updateStatus(session.id, "creating_workflow")
            repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_WORKFLOW_CREATION_STARTED", "Creating workflow")

            try {
            // Apply any connection bindings passed in
            if (connectionBindings.isNotEmpty()) {
                val connReqs = repo.listConnectionRequirements(session.id).associateBy { it.tempConnectionId }
                for ((tempId, connId) in connectionBindings) {
                    connReqs[tempId]?.let { req ->
                        repo.updateConnectionRequirementStatus(req.id, "selected_existing",
                            boundConnectionId = UUID.fromString(connId))
                    }
                }
            }

            // Generate tools if not already done
            val existingTools = repo.listGeneratedTools(session.id)
            if (existingTools.none { it.status == "created" }) {
                generateTools(session)
            }

            // Generate agents if not already done
            val existingAgents = repo.listGeneratedAgents(session.id)
            if (existingAgents.none { it.status == "created" }) {
                // Reload session for updated state
                val updatedSession = repo.findById(session.id, session.workspaceId) ?: session
                generateAgents(updatedSession)
            }

            // Build tempId → real ID maps
            val toolIdMap  = repo.listGeneratedTools(session.id)
                .filter { it.toolId != null }
                .associate { it.tempToolId to it.toolId!!.toString() }
            val agentIdMap = repo.listGeneratedAgents(session.id)
                .filter { it.agentId != null }
                .associate { it.tempAgentId to it.agentId!!.toString() }
            val connIdMap  = repo.listConnectionRequirements(session.id)
                .filter { it.boundConnectionId != null }
                .associate { it.tempConnectionId to it.boundConnectionId!!.toString() }

            val plan = mapper.readValue(session.generatedPlanJson, Map::class.java) as Map<String, Any?>
            val workflowName = plan["workflowName"]?.toString() ?: "AI-Generated Workflow"

            // Compile graph with real IDs
            val graphJson = compilePlanToGraphJson(session.generatedPlanJson, toolIdMap, agentIdMap)

            // Validate before creating
            val readinessIssues = validateGraph(session, toolIdMap, agentIdMap)
            val connReqsForReadiness = repo.listConnectionRequirements(session.id)
            val allRealExecReady = connReqsForReadiness
                .filter { it.requiredForRealExecution }
                .all { it.status == "test_passed" }
            val noErrors = readinessIssues.none { (it["severity"] as? String) == "error" }
            val readinessStatus = when {
                noErrors && allRealExecReady && config.architectEnabled -> "real_ready"
                noErrors                                                 -> "simulation_ready"
                else                                                     -> "needs_connections"
            }
            // Add real-execution readiness issue if connections are not all tested
            val finalIssues = readinessIssues.toMutableList()
            if (!allRealExecReady) {
                val missing = connReqsForReadiness.filter { it.requiredForRealExecution && it.status != "test_passed" }
                if (missing.isNotEmpty()) {
                    finalIssues.add(mapOf("severity" to "info", "code" to "REAL_EXECUTION_LOCKED",
                        "message" to "Real execution requires ${missing.size} connection(s) to be tested: ${missing.joinToString { it.name }}.",
                        "targetType" to "workflow"))
                }
            }
            repo.updateReadiness(session.id, readinessStatus, mapper.writeValueAsString(finalIssues))

            // Create workflow record
            val workflow = workflowRepo.create(CreateWorkflowRequest(
                workspaceId   = session.workspaceId,
                environmentId = session.environmentId,
                name          = workflowName,
                slug          = workflowName.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-'),
                description   = plan["workflowDescription"]?.toString() ?: "",
                status        = "draft",
            ))

            val version = workflowRepo.createVersion(CreateWorkflowVersionRequest(
                workflowId    = workflow.id,
                graph         = mapper.readValue(graphJson, Map::class.java) as Map<String, Any>,
                triggerConfig = mapOf<String, Any>("type" to ((plan["trigger"] as? Map<*, *>)?.get("type") ?: "manual")),
            ))

            repo.saveWorkflowIds(session.id, workflow.id, version.id)

            // Generate rich animation steps with real IDs
            val buildSteps = generateBuildSteps(session, toolIdMap, agentIdMap, connIdMap, graphJson)
            val animJson   = mapper.writeValueAsString(buildSteps)

            // Update animation steps on session
            repo.savePlan(session.id, session.generatedPlanJson, graphJson, animJson)

            try { sessionStorage(session.id.toString(), animJson) } catch (_: Exception) {}

            repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_WORKFLOW_CREATED",
                "Workflow created", "workflowId=${workflow.id}")

            return mapOf(
                "workflowId"        to workflow.id.toString(),
                "workflowVersionId" to version.id.toString(),
                "workflowName"      to workflowName,
                "animationSteps"    to buildSteps,
                "readinessStatus"   to readinessStatus,
                "readinessIssues"   to readinessIssues,
                "toolsCreated"      to toolIdMap.size,
                "agentsCreated"     to agentIdMap.size,
                "status"            to "workflow_created",
            )
        } catch (e: Exception) {
            repo.updateStatus(session.id, "failed", e.message)
            repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_WORKFLOW_CREATION_FAILED",
                "Workflow creation failed", e.message?.take(300))
            throw e
        }
        } finally {
            releaseBuildLock(lockConn, session.workspaceId)
        }
    }

    // ── Build serialization (per-workspace advisory lock) ─────────────────────

    /** Stable 32-bit object id for a workspace's build advisory lock. */
    private fun workspaceLockObjId(workspaceId: UUID): Int =
        (workspaceId.mostSignificantBits xor workspaceId.leastSignificantBits).toInt()

    /**
     * Non-blocking attempt to acquire the per-workspace build advisory lock on a
     * dedicated connection. Returns the connection (caller MUST pass it to
     * [releaseBuildLock] in a finally), or null if another build already holds the
     * lock for this workspace. Held on a session-level lock, so if the process dies
     * the lock auto-releases when the connection closes — no permanently stuck slot.
     */
    private fun acquireBuildLock(workspaceId: UUID): java.sql.Connection? {
        val conn = dataSource.connection
        return try {
            val acquired = conn.prepareStatement("SELECT pg_try_advisory_lock(?, ?)").use { st ->
                st.setInt(1, BUILD_LOCK_CLASSID)
                st.setInt(2, workspaceLockObjId(workspaceId))
                st.executeQuery().use { rs -> rs.next() && rs.getBoolean(1) }
            }
            if (acquired) conn else { runCatching { conn.close() }; null }
        } catch (e: Exception) {
            runCatching { conn.close() }
            throw IllegalStateException("Could not acquire architect build lock: ${e.message}", e)
        }
    }

    /** Release the build advisory lock and return the connection to the pool. */
    private fun releaseBuildLock(conn: java.sql.Connection, workspaceId: UUID) {
        try {
            conn.prepareStatement("SELECT pg_advisory_unlock(?, ?)").use { st ->
                st.setInt(1, BUILD_LOCK_CLASSID)
                st.setInt(2, workspaceLockObjId(workspaceId))
                st.executeQuery().use {}
            }
        } catch (e: Exception) {
            log.warn("[architect] advisory unlock failed (auto-releases on connection close): {}", e.message)
        } finally {
            runCatching { conn.close() }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun materializeConnectionRequirements(session: ArchitectSession, plan: Map<String, Any?>) {
        val conns = plan["requiredConnections"] as? List<*> ?: return
        for (conn in conns) {
            val c = conn as? Map<*, *> ?: continue
            val tempId = c["tempConnectionId"]?.toString() ?: continue
            repo.upsertConnectionRequirement(
                workspaceId = session.workspaceId,
                sessionId   = session.id,
                tempConnectionId = tempId,
                name        = c["name"]?.toString() ?: tempId,
                type        = c["type"]?.toString() ?: "generic",
                providerHint = c["providerHint"]?.toString(),
                description = c["description"]?.toString(),
                usedByTempIds = (c["usedByTempToolIds"] as? List<*>)?.let { mapper.writeValueAsString(it) } ?: "[]",
                requiredForSimulation = (c["requiredForSimulation"] as? Boolean) ?: false,
                requiredForRealExecution = (c["requiredForRealExecution"] as? Boolean) ?: true,
                setupInstructions = c["setupInstructions"]?.toString(),
                fieldsNeededJson = (c["fieldsNeeded"] as? List<*>)?.let { mapper.writeValueAsString(it) } ?: "[]",
            )
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun materializePlannedTools(session: ArchitectSession, plan: Map<String, Any?>) {
        val tools = plan["tools"] as? List<*> ?: return
        val connReqs = repo.listConnectionRequirements(session.id).associateBy { it.tempConnectionId }
        for (t in tools) {
            val tool = t as? Map<*, *> ?: continue
            val tempToolId = tool["tempToolId"]?.toString() ?: continue
            val connTempId = tool["connectionTempId"]?.toString()
            val connReq    = connTempId?.let { connReqs[it] }
            repo.upsertGeneratedTool(
                workspaceId = session.workspaceId, sessionId = session.id,
                tempToolId = tempToolId, name = tool["name"]?.toString() ?: tempToolId,
                type = tool["type"]?.toString() ?: "generic_tool",
                connectionRequirementId = connReq?.id, boundConnectionId = connReq?.boundConnectionId,
                status = "planned",
                configJson = tool["operation"]?.let { mapper.writeValueAsString(mapOf("operation" to it)) } ?: "{}",
                inputSchemaJson = tool["inputSchema"]?.let { mapper.writeValueAsString(it) } ?: "{}",
                outputSchemaJson = tool["outputSchema"]?.let { mapper.writeValueAsString(it) } ?: "{}",
                riskLevel = tool["riskLevel"]?.toString() ?: "low",
                requiresApproval = (tool["requiresApproval"] as? Boolean) ?: false,
            )
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun materializePlannedAgents(session: ArchitectSession, plan: Map<String, Any?>) {
        val agents = plan["agents"] as? List<*> ?: return
        for (a in agents) {
            val agent = a as? Map<*, *> ?: continue
            val tempAgentId = agent["tempAgentId"]?.toString() ?: continue
            repo.upsertGeneratedAgent(
                workspaceId = session.workspaceId, sessionId = session.id,
                tempAgentId = tempAgentId, name = agent["name"]?.toString() ?: tempAgentId,
                type = agent["type"]?.toString() ?: "native_llm_agent",
                role = agent["role"]?.toString(),
                systemPrompt = agent["systemPrompt"]?.toString() ?: "",
                allowedTempToolIds = (agent["allowedTempToolIds"] as? List<*>)?.let { mapper.writeValueAsString(it) } ?: "[]",
                outputSchemaJson = agent["outputSchema"]?.let { mapper.writeValueAsString(it) } ?: "{}",
                status = "planned",
            )
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun compilePlanToGraphJson(
        planJson: String,
        toolIdMap: Map<String, String>,
        agentIdMap: Map<String, String>,
    ): String {
        val plan  = mapper.readValue(planJson, Map::class.java) as Map<String, Any?>
        val steps = (plan["workflowSteps"] as? List<*> ?: plan["steps"] as? List<*> ?: emptyList<Any>())
        val edges = (plan["edges"] as? List<*> ?: emptyList<Any>())
        val triggerType = (plan["trigger"] as? Map<*, *>)?.get("type")?.toString() ?: "manual"

        val xCol1 = 120; val xCol2 = 440; val yStart = 60; val ySpacing = 200

        val allNodes = mutableListOf<Map<String, Any?>>()
        val allEdges = mutableListOf<Map<String, Any?>>()

        // ── 1. Always ensure a trigger node exists ────────────────────────────
        val hasTrigger = steps.any { (it as? Map<*, *>)?.let { s ->
            (s["nodeType"] ?: s["type"])?.toString() == "trigger" } == true }
        val triggerId = "trigger_auto"
        if (!hasTrigger) {
            allNodes.add(mapOf(
                "id"       to triggerId,
                "type"     to "trigger",
                "position" to mapOf("x" to xCol1, "y" to yStart),
                "data"     to mapOf(
                    "label"               to "Start",
                    "nodeType"            to "trigger",
                    "description"         to "Workflow trigger ($triggerType)",
                    "generatedByArchitect" to true,
                    "triggerConfig"       to mapOf("type" to triggerType),
                ),
            ))
        }

        // ── 2. Compile plan steps ─────────────────────────────────────────────
        val stepNodeIds = mutableListOf<String>()
        steps.forEachIndexed { i, step ->
            val s        = step as? Map<*, *> ?: return@forEachIndexed
            val tempId   = (s["tempStepId"] ?: s["tempId"])?.toString() ?: "step_$i"
            val nodeType = (s["nodeType"] ?: s["type"])?.toString()?.let {
                if (it == "trigger") "trigger" else it
            } ?: "tool"
            val toolTempId  = s["toolTempId"]?.toString()
            val agentTempId = s["agentTempId"]?.toString()
            val realToolId  = toolTempId?.let { toolIdMap[it] }
            val realAgentId = agentTempId?.let { agentIdMap[it] }
            val col = if (i % 2 == 0) xCol1 else xCol2

            allNodes.add(mapOf(
                "id"       to tempId,
                "type"     to nodeType,
                "position" to mapOf("x" to col, "y" to yStart + (i + if (!hasTrigger) 1 else 0) * ySpacing),
                "data"     to mapOf(
                    "label"               to (s["name"] ?: "Step ${i + 1}"),
                    "description"         to (s["description"] ?: ""),
                    "nodeType"            to nodeType,
                    "toolId"              to realToolId,
                    "agentId"             to realAgentId,
                    "toolTempId"          to toolTempId,
                    "agentTempId"         to agentTempId,
                    "inputMappings"       to (s["inputMappings"] ?: emptyMap<String, Any>()),
                    "outputMappings"      to (s["outputMappings"] ?: emptyMap<String, Any>()),
                    "generatedByArchitect" to true,
                    "status"              to when {
                        nodeType == "tool"  && realToolId  == null -> "missing_tool"
                        nodeType == "agent" && realAgentId == null -> "missing_agent"
                        else -> "ready"
                    },
                ).filterValues { it != null },
            ))
            if (nodeType != "trigger") stepNodeIds.add(tempId)
        }

        // ── 3. Plan edges ─────────────────────────────────────────────────────
        val edgeSet = mutableSetOf<String>()
        for (edge in edges) {
            val e    = edge as? Map<*, *> ?: continue
            val from = (e["from"] ?: e["fromStepTempId"])?.toString() ?: continue
            val to   = (e["to"]   ?: e["toStepTempId"])?.toString()   ?: continue
            val key  = "$from→$to"
            if (key !in edgeSet) {
                edgeSet.add(key)
                allEdges.add(mapOf("id" to "e-$from-$to", "source" to from, "target" to to,
                    "type" to "workflow", "data" to mapOf("edgeType" to (e["type"] ?: "success"))))
            }
        }

        // ── 4. Connect trigger to first non-trigger step if disconnected ──────
        if (!hasTrigger && stepNodeIds.isNotEmpty()) {
            val firstStep = stepNodeIds.first()
            val key = "$triggerId→$firstStep"
            if (key !in edgeSet) {
                edgeSet.add(key)
                allEdges.add(mapOf("id" to "e-$triggerId-$firstStep", "source" to triggerId,
                    "target" to firstStep, "type" to "workflow",
                    "data" to mapOf("edgeType" to "success")))
            }
        }

        // ── 5. Find nodes that have no outgoing edges and no incoming edges ───
        //       (disconnected nodes) and wire them linearly from the last connected node
        val allNodeIds = allNodes.map { it["id"].toString() }.toSet()
        val sourcesWithOut = allEdges.map { it["source"].toString() }.toSet()
        val targetsWithIn  = allEdges.map { it["target"].toString() }.toSet()

        // Nodes with no incoming connection (except trigger) should connect from previous
        var prevId: String? = null
        for (node in allNodes) {
            val nid  = node["id"].toString()
            val type = ((node["data"] as? Map<*, *>)?.get("nodeType") as? String) ?: ""
            if (type == "trigger") { prevId = nid; continue }
            if (type == "end")     continue
            if (nid !in targetsWithIn && prevId != null) {
                val key = "$prevId→$nid"
                if (key !in edgeSet) {
                    edgeSet.add(key)
                    allEdges.add(mapOf("id" to "e-$prevId-$nid", "source" to prevId,
                        "target" to nid, "type" to "workflow",
                        "data" to mapOf("edgeType" to "success")))
                }
            }
            prevId = nid
        }

        // ── 6. Always add an End node and connect the last dangling node ──────
        val hasEnd = allNodes.any { ((it["data"] as? Map<*, *>)?.get("nodeType") as? String) == "end" }
        if (!hasEnd) {
            val endId  = "end_auto"
            val lastY  = (allNodes.size + 1) * ySpacing + yStart
            allNodes.add(mapOf(
                "id"       to endId,
                "type"     to "end",
                "position" to mapOf("x" to xCol1, "y" to lastY),
                "data"     to mapOf("label" to "End", "nodeType" to "end", "generatedByArchitect" to true),
            ))
            // Connect every node that has no outgoing edge → End
            val sourcesAfterLinear = allEdges.map { it["source"].toString() }.toSet()
            for (nid in allNodeIds) {
                if (nid !in sourcesAfterLinear) {
                    val key = "$nid→$endId"
                    if (key !in edgeSet) {
                        edgeSet.add(key)
                        allEdges.add(mapOf("id" to "e-$nid-$endId", "source" to nid,
                            "target" to endId, "type" to "workflow",
                            "data" to mapOf("edgeType" to "success")))
                    }
                }
            }
        }

        return mapper.writeValueAsString(mapOf("nodes" to allNodes, "edges" to allEdges, "version" to "2"))
    }

    @Suppress("UNCHECKED_CAST")
    private fun validateGraph(
        session: ArchitectSession,
        toolIdMap: Map<String, String>,
        agentIdMap: Map<String, String>,
    ): List<Map<String, Any?>> {
        val issues = mutableListOf<Map<String, Any?>>()
        val plan = mapper.readValue(session.generatedPlanJson!!, Map::class.java) as Map<String, Any?>
        val steps = plan["workflowSteps"] as? List<*> ?: plan["steps"] as? List<*> ?: emptyList<Any>()

        for (step in steps) {
            val s        = step as? Map<*, *> ?: continue
            val nodeType = (s["nodeType"] ?: s["type"])?.toString() ?: continue
            val name     = s["name"]?.toString() ?: "step"
            if (nodeType == "tool") {
                val toolTempId = s["toolTempId"]?.toString()
                if (toolTempId != null && toolIdMap[toolTempId] == null) {
                    // error — workflow cannot execute without a real tool record
                    issues.add(mapOf("severity" to "error", "code" to "TOOL_NEEDS_CONFIGURATION",
                        "message" to "Tool '$name' has no backing tool record — missing or failed connection binding.",
                        "targetType" to "tool", "targetId" to toolTempId))
                }
            }
            if (nodeType == "agent") {
                val agentTempId = s["agentTempId"]?.toString()
                if (agentTempId != null && agentIdMap[agentTempId] == null) {
                    // error — workflow cannot execute without a real agent record
                    issues.add(mapOf("severity" to "error", "code" to "AGENT_MISSING",
                        "message" to "Agent '$name' has no backing agent record — creation failed.",
                        "targetType" to "agent", "targetId" to agentTempId))
                }
            }
            // Point 16: high-risk write tool without requiresApproval flag is a warning
            if (nodeType == "tool") {
                val toolTempId = s["toolTempId"]?.toString()
                val genTool = toolTempId?.let { repo.listGeneratedTools(session.id).find { t -> t.tempToolId == it } }
                if (genTool != null && genTool.riskLevel == "high" && !genTool.requiresApproval) {
                    issues.add(mapOf("severity" to "warning", "code" to "HIGH_RISK_NO_APPROVAL",
                        "message" to "Tool '$name' is high-risk but requiresApproval is false. Consider adding an approval gate.",
                        "targetType" to "tool", "targetId" to toolTempId))
                }
            }
        }

        val connReqs = repo.listConnectionRequirements(session.id)
        for (req in connReqs) {
            if (req.requiredForSimulation && req.status !in listOf("test_passed", "selected_existing", "created", "simulation_placeholder")) {
                issues.add(mapOf("severity" to "error", "code" to "MISSING_CONNECTION",
                    "message" to "Connection '${req.name}' required for simulation is not configured.",
                    "targetType" to "connection", "targetId" to req.tempConnectionId))
            }
        }
        return issues
    }

    @Suppress("UNCHECKED_CAST")
    private fun generateBuildSteps(
        session: ArchitectSession,
        toolIdMap: Map<String, String>,
        agentIdMap: Map<String, String>,
        connIdMap: Map<String, String>,
        graphJson: String,
    ): List<Map<String, Any?>> {
        val steps = mutableListOf<Map<String, Any?>>()
        var seq = 0; var delay = 0

        steps.add(mapOf("sequence" to ++seq, "type" to "thinking",
            "title" to "Understanding automation goal",
            "description" to "Detected automation goal, identified systems and data flows.",
            "durationMs" to 600))
        delay += 600

        // Connection binding steps
        val connReqs = repo.listConnectionRequirements(session.id)
        for (req in connReqs) {
            if (req.boundConnectionId != null) {
                delay += 500
                steps.add(mapOf("sequence" to ++seq, "type" to "connection_bound",
                    "connectionId" to req.boundConnectionId.toString(),
                    "title" to "Binding ${req.name}",
                    "description" to "Connected ${req.type} for ${req.name}",
                    "durationMs" to delay))
            }
        }

        // Tool creation steps
        val genTools = repo.listGeneratedTools(session.id).filter { it.toolId != null }
        for (tool in genTools) {
            delay += 700
            steps.add(mapOf("sequence" to ++seq, "type" to "tool_created",
                "toolId" to tool.toolId.toString(),
                "title" to "Creating tool: ${tool.name}",
                "description" to "Type: ${tool.type} · Risk: ${tool.riskLevel}",
                "durationMs" to delay))
        }

        // Agent creation steps
        val genAgents = repo.listGeneratedAgents(session.id).filter { it.agentId != null }
        for (agent in genAgents) {
            delay += 800
            steps.add(mapOf("sequence" to ++seq, "type" to "agent_created",
                "agentId" to agent.agentId.toString(),
                "title" to "Creating agent: ${agent.name}",
                "description" to "Role: ${agent.role ?: "processor"}",
                "durationMs" to delay))
        }

        // Canvas node reveal steps
        val graph = mapper.readValue(graphJson, Map::class.java) as Map<String, Any?>
        val nodes = graph["nodes"] as? List<*> ?: emptyList<Any>()
        val edges = graph["edges"] as? List<*> ?: emptyList<Any>()

        for (node in nodes) {
            val n = node as? Map<*, *> ?: continue
            val nodeId = n["id"]?.toString() ?: continue
            val label  = (n["data"] as? Map<*, *>)?.get("label")?.toString() ?: nodeId
            delay += 400
            steps.add(mapOf("sequence" to ++seq, "type" to "add_node",
                "nodeId" to nodeId, "title" to "Adding $label",
                "durationMs" to delay))
        }

        for (edge in edges) {
            val e = edge as? Map<*, *> ?: continue
            val edgeId = e["id"]?.toString() ?: continue
            delay += 300
            steps.add(mapOf("sequence" to ++seq, "type" to "add_edge",
                "edgeId" to edgeId, "title" to "Connecting workflow",
                "durationMs" to delay))
        }

        delay += 800
        steps.add(mapOf("sequence" to ++seq, "type" to "validate_workflow",
            "title" to "Validating workflow",
            "description" to "Checking connections, mappings, and simulation readiness.",
            "durationMs" to delay))

        delay += 600
        steps.add(mapOf("sequence" to ++seq, "type" to "complete",
            "title" to "Workflow ready",
            "description" to "You can now run a simulation or configure real execution.",
            "durationMs" to delay))

        return steps
    }

    @Suppress("UNCHECKED_CAST")
    private fun generatePreliminaryAnimationSteps(planJson: String): String {
        val plan  = mapper.readValue(planJson, Map::class.java) as Map<String, Any?>
        val steps = (plan["workflowSteps"] as? List<*> ?: plan["steps"] as? List<*> ?: emptyList<Any>())
        val edges = (plan["edges"] as? List<*> ?: emptyList<Any>())
        val animSteps = mutableListOf<Map<String, Any?>>()
        var delay = 0
        animSteps.add(mapOf("type" to "start", "delayMs" to delay, "title" to "Building your workflow…"))
        delay += 300
        steps.forEach { step ->
            val s = step as? Map<*, *> ?: return@forEach
            val tempId = (s["tempStepId"] ?: s["tempId"])?.toString() ?: return@forEach
            animSteps.add(mapOf("type" to "add_node", "nodeId" to tempId, "delayMs" to delay, "title" to "Adding ${s["name"]}"))
            delay += 350
            edges.forEach { edge ->
                val e = edge as? Map<*, *> ?: return@forEach
                if (e["from"]?.toString() == tempId) {
                    animSteps.add(mapOf("type" to "add_edge", "edgeId" to "e-${e["from"]}-${e["to"]}", "delayMs" to delay, "title" to "Connecting…"))
                    delay += 250
                }
            }
        }
        animSteps.add(mapOf("type" to "complete", "delayMs" to delay, "title" to "Workflow ready for review"))
        return mapper.writeValueAsString(animSteps)
    }

    private fun buildFallbackSystemPrompt(
        name: String, role: String, tools: List<String>,
        workflowName: String, outputSchemaJson: String,
    ): String {
        val toolList = if (tools.isEmpty()) "No tools." else tools.joinToString("\n") { "- $it" }
        return """
You are the $name agent in the "$workflowName" automated workflow running on Vectorbea.

## Your Role
$role

## Input
You will receive structured input data from previous workflow steps.
All inputs are pre-validated before reaching you.

## Allowed Tools
$toolList

Use tools only when necessary. All tool calls are logged and audited.

## Output
Return only valid JSON. Do not include explanations outside the JSON structure.
${if (outputSchemaJson != "{}") "Output schema: $outputSchemaJson" else "Return a JSON object with your analysis result, confidence score, and any notes."}

## Constraints
- Do NOT invent or hallucinate data not present in your input
- If data is missing, return partial result with missingData explanation
- Do NOT make external calls except through provided tools
- Do NOT include secrets, tokens, or passwords in output
- For write operations: confirm input explicitly states the action is approved
""".trimIndent()
    }

    // ── Plan validation ───────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    internal fun validatePlanJson(json: String): String? {
      return try {
        val plan = mapper.readValue(json, Map::class.java) as Map<String, Any?>
        if (plan["workflowName"] == null) return "Missing workflowName"
        if (plan["goalSummary"]  == null) return "Missing goalSummary"
        if (plan["trigger"]      == null) return "Missing trigger"
        val trigger = plan["trigger"] as? Map<*, *> ?: return "trigger must be an object"
        if (trigger["type"] == null) return "trigger.type is required"

        // Accept either workflowSteps (new schema) or steps (old schema)
        val steps = plan["workflowSteps"] as? List<*> ?: plan["steps"] as? List<*>
            ?: return "workflowSteps must be an array"
        if (steps.isEmpty()) return "workflowSteps array is empty"

        // Build known tool/agent tempIds from plan for orphan checks
        @Suppress("UNCHECKED_CAST")
        val knownToolIds  = (plan["tools"]  as? List<*>)?.mapNotNull { (it as? Map<*, *>)?.get("tempToolId")?.toString() }?.toSet()  ?: emptySet<String>()
        @Suppress("UNCHECKED_CAST")
        val knownAgentIds = (plan["agents"] as? List<*>)?.mapNotNull { (it as? Map<*, *>)?.get("tempAgentId")?.toString() }?.toSet() ?: emptySet<String>()

        val stepIds = mutableSetOf<String>()
        for ((i, step) in steps.withIndex()) {
            val s   = step as? Map<*, *> ?: return "workflowSteps[$i] must be an object"
            val tid = (s["tempStepId"] ?: s["tempId"])?.toString() ?: return "workflowSteps[$i].tempStepId is required"
            if (tid in stepIds) return "Duplicate tempStepId: $tid"
            stepIds.add(tid)
            if (s["name"] == null) return "workflowSteps[$i].name is required"

            val nodeType = (s["nodeType"] ?: s["type"])?.toString()
            // Orphan checks: tool/agent nodes must reference a real plan entry
            if (nodeType == "tool") {
                val toolRef = s["toolTempId"]?.toString()
                    ?: return "workflowSteps[$i] (tool node '${s["name"]}') is missing toolTempId"
                if (toolRef !in knownToolIds)
                    return "workflowSteps[$i].toolTempId='$toolRef' not found in plan.tools"
            }
            if (nodeType == "agent") {
                val agentRef = s["agentTempId"]?.toString()
                    ?: return "workflowSteps[$i] (agent node '${s["name"]}') is missing agentTempId"
                if (agentRef !in knownAgentIds)
                    return "workflowSteps[$i].agentTempId='$agentRef' not found in plan.agents"
            }
        }

        val edges = plan["edges"] as? List<*> ?: return "edges must be an array"
        for ((i, edge) in edges.withIndex()) {
            val e    = edge as? Map<*, *> ?: return "edges[$i] must be an object"
            val from = (e["from"] ?: e["fromStepTempId"])?.toString() ?: return "edges[$i].from is required"
            val to   = (e["to"] ?: e["toStepTempId"])?.toString() ?: return "edges[$i].to is required"
            if (from !in stepIds) return "edges[$i].from='$from' does not match any step"
            if (to   !in stepIds) return "edges[$i].to='$to' does not match any step"
        }
        null
      } catch (e: Exception) {
        "Invalid JSON: ${e.message?.take(100)}"
      }
    }

    // ── LLM call ──────────────────────────────────────────────────────────────

    internal fun callPlanningLlm(userPrompt: String, systemPrompt: String? = null, maxTokens: Int = 2000): String {
        val apiKey = config.architectApiKey
            ?: throw IllegalStateException("AI Architect LLM is not configured. Set AI_ARCHITECT_API_KEY or OPENAI_API_KEY.")
        val model  = config.architectModel ?: "gpt-4o-mini"
        val messages = buildList {
            if (systemPrompt != null) add(mapOf("role" to "system", "content" to systemPrompt))
            add(mapOf("role" to "user", "content" to userPrompt))
        }
        val body = mapper.writeValueAsString(mapOf(
            "model" to model, "max_tokens" to maxTokens, "temperature" to 0.2, "messages" to messages,
        ))
        return try {
            val req = HttpRequest.newBuilder()
                .uri(URI.create("https://api.openai.com/v1/chat/completions"))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer $apiKey")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .timeout(Duration.ofSeconds(90))
                .build()
            val res = http.send(req, HttpResponse.BodyHandlers.ofString())
            if (res.statusCode() !in 200..299)
                throw RuntimeException("LLM API returned HTTP ${res.statusCode()}: ${res.body().take(200)}")
            @Suppress("UNCHECKED_CAST")
            val parsed  = mapper.readValue(res.body(), Map::class.java) as Map<String, Any?>
            val choices = parsed["choices"] as? List<*> ?: throw RuntimeException("No choices in LLM response")
            val content = ((choices[0] as? Map<*, *>)?.get("message") as? Map<*, *>)?.get("content") as? String
                ?: throw RuntimeException("No content in LLM response")
            content.trim().removePrefix("```json").removePrefix("```").removeSuffix("```").trim()
        } catch (e: Exception) {
            log.error("[architect] LLM call failed: {}", e.message)
            throw e
        }
    }

    // No-op (sessionStorage is purely frontend)
    private fun sessionStorage(@Suppress("UNUSED_PARAMETER") key: String, @Suppress("UNUSED_PARAMETER") value: String) {}
}
