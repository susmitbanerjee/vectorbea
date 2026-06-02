package com.vectorbea.api.architect

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.api.config.AppConfig
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
 * Core AI Workflow Architect service.
 * Handles planning LLM calls, plan validation, compilation, and animation steps.
 * Security: never logs or returns secrets. All LLM calls sanitized.
 */
class WorkflowArchitectService(
    private val repo: WorkflowArchitectRepository,
    private val workflowRepo: WorkflowRepository,
    private val dataSource: DataSource,
    private val config: AppConfig,
) {
    private val log    = LoggerFactory.getLogger(WorkflowArchitectService::class.java)
    private val mapper = jacksonObjectMapper()
    private val http   = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(15)).build()

    companion object {
        const val MAX_DAILY_REQUESTS = 20
        const val MAX_GOAL_LENGTH    = 4000
        const val MAX_REVISIONS      = 5
    }

    fun isEnabled(): Boolean = config.architectEnabled

    // ── Workspace limits (can be extended from DB in future) ──────────────────
    private fun defaultLimits(): Map<String, Any> = mapOf(
        "maxSteps" to 20,
        "maxAgents" to 5,
        "maxTools" to 10,
        "maxParallelBranches" to 4,
        "schedulesEnabled" to true,
        "webhooksEnabled" to true,
        "iterativeAgentsEnabled" to (config.architectEnabled),
    )

    // ── Rate limit check ──────────────────────────────────────────────────────
    fun checkDailyLimit(workspaceId: UUID): Boolean {
        val used = repo.getDailyPlanningRequests(workspaceId)
        return used < MAX_DAILY_REQUESTS
    }

    // ── Create session ────────────────────────────────────────────────────────
    fun createSession(workspaceId: UUID, environmentId: UUID, userId: UUID, goal: String): ArchitectSession {
        require(goal.length <= MAX_GOAL_LENGTH) { "Goal text exceeds $MAX_GOAL_LENGTH characters" }
        require(checkDailyLimit(workspaceId)) { "Daily AI Architect limit reached ($MAX_DAILY_REQUESTS/day)" }

        val session = repo.create(workspaceId, environmentId, userId, goal)
        repo.appendEvent(workspaceId, session.id, "ARCHITECT_SESSION_CREATED", "Session created", goal.take(200))
        repo.incrementUsage(workspaceId)
        return session
    }

    // ── Check if clarification is needed ─────────────────────────────────────
    fun checkClarification(session: ArchitectSession): List<String> {
        if (!config.architectEnabled) return emptyList()
        val prompt = WorkflowArchitectPromptBuilder.buildClarificationPrompt(session.userGoal)
        val raw    = callPlanningLlm(prompt, maxTokens = 500) ?: return emptyList()
        return try {
            @Suppress("UNCHECKED_CAST")
            val parsed = mapper.readValue(raw, Map::class.java) as Map<String, Any>
            val needs  = parsed["needsClarification"] as? Boolean ?: false
            if (needs) {
                @Suppress("UNCHECKED_CAST")
                val questions = (parsed["questions"] as? List<*>)?.map { it.toString() } ?: emptyList()
                if (questions.isNotEmpty()) {
                    repo.saveClarifications(session.id, mapper.writeValueAsString(questions))
                    repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_CLARIFICATION_REQUESTED",
                        "Clarification needed", "${questions.size} questions generated")
                }
                questions
            } else emptyList()
        } catch (e: Exception) {
            log.warn("[architect] clarification parse failed: {}", e.message)
            emptyList()
        }
    }

    // ── Generate plan ─────────────────────────────────────────────────────────
    fun generatePlan(session: ArchitectSession, answers: Map<String, String> = emptyMap()): String {
        require(config.architectEnabled) { "AI Architect is not enabled" }

        val systemPrompt = WorkflowArchitectPromptBuilder.buildSystemPrompt(defaultLimits())
        val userPrompt   = WorkflowArchitectPromptBuilder.buildPlanningPrompt(session.userGoal, answers)

        var planJson = callPlanningLlm(userPrompt, systemPrompt = systemPrompt, maxTokens = 4000)
            ?: throw RuntimeException("Planning LLM returned no response")

        // Validate and repair once if needed
        val validationError = validatePlanJson(planJson)
        if (validationError != null) {
            log.warn("[architect] plan validation failed: {} — attempting repair", validationError)
            val repaired = callPlanningLlm(
                WorkflowArchitectPromptBuilder.buildRepairPrompt(planJson, validationError),
                maxTokens = 4000,
            )
            if (repaired != null) {
                val repairError = validatePlanJson(repaired)
                if (repairError == null) {
                    planJson = repaired
                    log.info("[architect] plan repaired successfully")
                } else {
                    throw RuntimeException("Plan validation failed after repair: $repairError")
                }
            } else {
                throw RuntimeException("Plan validation failed and repair returned no response")
            }
        }

        // Generate animation steps from plan
        val animSteps = generateAnimationSteps(planJson)
        val graphJson = compilePlanToGraphJson(planJson)

        repo.savePlan(session.id, planJson, graphJson, animSteps)
        repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_PLAN_GENERATED",
            "Workflow plan generated")

        return planJson
    }

    // ── Revise plan ───────────────────────────────────────────────────────────
    fun revisePlan(session: ArchitectSession, instruction: String): String {
        require(config.architectEnabled) { "AI Architect is not enabled" }
        require(session.generatedPlanJson != null) { "No plan to revise" }

        val prompt = WorkflowArchitectPromptBuilder.buildRevisionPrompt(instruction, session.generatedPlanJson)
        val revised = callPlanningLlm(prompt, maxTokens = 4000)
            ?: throw RuntimeException("Revision LLM returned no response")

        validatePlanJson(revised)?.let { throw RuntimeException("Revised plan invalid: $it") }

        val animSteps = generateAnimationSteps(revised)
        val graphJson = compilePlanToGraphJson(revised)
        repo.savePlan(session.id, revised, graphJson, animSteps)
        repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_PLAN_REVISED",
            "Plan revised", instruction.take(200))
        return revised
    }

    // ── Approve plan ──────────────────────────────────────────────────────────
    fun approvePlan(session: ArchitectSession) {
        require(session.generatedPlanJson != null) { "No plan to approve" }
        repo.updateStatus(session.id, "plan_approved")
        repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_PLAN_APPROVED", "Plan approved by user")
    }

    // ── Create workflow from plan ─────────────────────────────────────────────
    fun createWorkflow(
        session: ArchitectSession,
        connectionBindings: Map<String, String>,
    ): Map<String, Any?> {
        require(session.status == "plan_approved") { "Plan must be approved before creating workflow" }
        require(session.generatedPlanJson != null) { "No plan found" }
        require(session.generatedGraphJson != null) { "No graph JSON found" }

        repo.updateStatus(session.id, "creating_workflow")
        repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_WORKFLOW_CREATION_STARTED",
            "Creating workflow from plan")

        try {
            // Create the workflow and version in the DB using WorkflowRepository
            val planMap = mapper.readValue(session.generatedPlanJson, Map::class.java)
            val workflowName = planMap["workflowName"]?.toString() ?: "AI-Generated Workflow"
            val description  = planMap["workflowDescription"]?.toString() ?: ""

            val workflow = workflowRepo.create(
                com.vectorbea.api.repository.CreateWorkflowRequest(
                    workspaceId   = session.workspaceId,
                    environmentId = session.environmentId,
                    name          = workflowName,
                    slug          = workflowName.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-'),
                    description   = description,
                    status        = "draft",
                )
            )

            val version = workflowRepo.createVersion(
                com.vectorbea.api.repository.CreateWorkflowVersionRequest(
                    workflowId  = workflow.id,
                    graph       = mapper.readValue(session.generatedGraphJson, Map::class.java) as Map<String, Any>,
                    triggerConfig = mapOf("type" to (planMap["trigger"] as? Map<*, *>)?.get("type") ?: "manual"),
                )
            )

            repo.saveWorkflowIds(session.id, workflow.id, version.id)
            repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_WORKFLOW_CREATED",
                "Workflow created successfully", "workflowId=${workflow.id}")

            return mapOf(
                "workflowId"            to workflow.id.toString(),
                "workflowVersionId"     to version.id.toString(),
                "workflowName"          to workflowName,
                "animationSteps"        to (session.animationStepsJson?.let {
                    mapper.readValue(it, List::class.java)
                } ?: emptyList<Any>()),
                "status"                to "workflow_created",
            )
        } catch (e: Exception) {
            repo.updateStatus(session.id, "failed", e.message)
            repo.appendEvent(session.workspaceId, session.id, "ARCHITECT_WORKFLOW_CREATION_FAILED",
                "Workflow creation failed", e.message?.take(300))
            throw e
        }
    }

    // ── LLM call ──────────────────────────────────────────────────────────────
    private fun callPlanningLlm(
        userPrompt: String,
        systemPrompt: String? = null,
        maxTokens: Int = 2000,
    ): String? {
        val apiKey = config.architectApiKey ?: return null
        val model  = config.architectModel  ?: "gpt-4o-mini"
        val url    = "https://api.openai.com/v1/chat/completions"

        val messages = buildList {
            if (systemPrompt != null) add(mapOf("role" to "system", "content" to systemPrompt))
            add(mapOf("role" to "user", "content" to userPrompt))
        }

        val body = mapper.writeValueAsString(mapOf(
            "model"       to model,
            "max_tokens"  to maxTokens,
            "temperature" to 0.2,
            "messages"    to messages,
        ))

        return try {
            val req = HttpRequest.newBuilder()
                .uri(URI.create(url))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer $apiKey")
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .timeout(Duration.ofSeconds(60))
                .build()

            val res = http.send(req, HttpResponse.BodyHandlers.ofString())
            if (res.statusCode() !in 200..299) {
                log.warn("[architect] LLM API returned HTTP ${res.statusCode()}")
                return null
            }

            @Suppress("UNCHECKED_CAST")
            val parsed  = mapper.readValue(res.body(), Map::class.java) as Map<String, Any?>
            val choices = parsed["choices"] as? List<*> ?: return null
            val content = ((choices[0] as? Map<*, *>)?.get("message") as? Map<*, *>)?.get("content") as? String

            // Track usage
            @Suppress("UNCHECKED_CAST")
            val usage   = parsed["usage"] as? Map<String, Any?> ?: emptyMap<String, Any?>()
            val tokens  = (usage["total_tokens"] as? Int) ?: 0

            content?.trim()?.removePrefix("```json")?.removePrefix("```")?.removeSuffix("```")?.trim()
        } catch (e: Exception) {
            log.error("[architect] LLM call failed: {}", e.message)
            null
        }
    }

    // ── Plan validation ───────────────────────────────────────────────────────
    @Suppress("UNCHECKED_CAST")
    private fun validatePlanJson(json: String): String? {
        return try {
            val plan = mapper.readValue(json, Map::class.java) as Map<String, Any?>

            // Required top-level fields
            if (plan["workflowName"] == null)  return "Missing workflowName"
            if (plan["goalSummary"]  == null)  return "Missing goalSummary"
            if (plan["confidence"]   == null)  return "Missing confidence"
            if (plan["trigger"]      == null)  return "Missing trigger"

            val confidence = (plan["confidence"] as? Number)?.toDouble() ?: return "confidence must be a number"
            if (confidence < 0 || confidence > 1) return "confidence must be 0-1"

            val trigger = plan["trigger"] as? Map<*, *> ?: return "trigger must be an object"
            if (trigger["type"] == null) return "trigger.type is required"

            val steps = plan["steps"] as? List<*> ?: return "steps must be an array"
            if (steps.isEmpty()) return "steps array is empty"

            val edges = plan["edges"] as? List<*> ?: return "edges must be an array"

            // Verify all steps have tempId and type
            val tempIds = mutableSetOf<String>()
            for ((i, step) in steps.withIndex()) {
                val s = step as? Map<*, *> ?: return "steps[$i] must be an object"
                val tid = s["tempId"]?.toString() ?: return "steps[$i].tempId is required"
                if (tid in tempIds) return "Duplicate tempId: $tid"
                tempIds.add(tid)
                if (s["name"] == null) return "steps[$i].name is required"
                if (s["type"] == null) return "steps[$i].type is required"
            }

            // Verify edges reference real tempIds
            for ((i, edge) in edges.withIndex()) {
                val e = edge as? Map<*, *> ?: return "edges[$i] must be an object"
                val from = e["from"]?.toString() ?: return "edges[$i].from is required"
                val to   = e["to"]?.toString()   ?: return "edges[$i].to is required"
                if (from !in tempIds) return "edges[$i].from='$from' does not match any step tempId"
                if (to   !in tempIds) return "edges[$i].to='$to' does not match any step tempId"
            }

            null // valid
        } catch (e: Exception) {
            "Invalid JSON: ${e.message?.take(100)}"
        }
    }

    // ── Graph JSON compiler ───────────────────────────────────────────────────
    @Suppress("UNCHECKED_CAST")
    private fun compilePlanToGraphJson(planJson: String): String {
        val plan  = mapper.readValue(planJson, Map::class.java) as Map<String, Any?>
        val steps = plan["steps"] as? List<*> ?: emptyList<Any>()
        val edges = plan["edges"] as? List<*> ?: emptyList<Any>()

        // Convert plan steps to React Flow nodes
        val xSpacing = 280; val yStart = 80; val ySpacing = 160
        val nodes = steps.mapIndexed { i, step ->
            val s = step as? Map<*, *> ?: return@mapIndexed null
            val tempId = s["tempId"]?.toString() ?: "step_$i"
            val type   = when (s["type"]?.toString()) {
                "trigger"  -> "trigger"
                "agent"    -> "agent"
                "tool"     -> "tool"
                "approval" -> "approval"
                "branch"   -> "branch"
                "join"     -> "join"
                "end"      -> "end"
                else       -> "tool"
            }
            mapOf(
                "id"       to tempId,
                "type"     to type,
                "position" to mapOf("x" to 120, "y" to yStart + i * ySpacing),
                "data"     to mapOf(
                    "label"       to (s["name"] ?: "Step ${i+1}"),
                    "description" to (s["description"] ?: ""),
                    "nodeType"    to type,
                    "generatedByArchitect" to true,
                    "planAssumptions" to s["inputMappings"],
                ),
            )
        }.filterNotNull()

        // Convert plan edges to React Flow edges
        val rfEdges = (edges as List<*>).mapIndexed { i, edge ->
            val e = edge as? Map<*, *> ?: return@mapIndexed null
            val edgeType = when (e["type"]?.toString()) {
                "success"         -> "success"
                "failure"         -> "failure"
                "condition_true"  -> "conditional_true"
                "condition_false" -> "conditional_false"
                "parallel"        -> "parallel_branch"
                else              -> "default"
            }
            mapOf(
                "id"     to "e-${e["from"]}-${e["to"]}",
                "source" to (e["from"] ?: ""),
                "target" to (e["to"] ?: ""),
                "type"   to "workflow",
                "data"   to mapOf("edgeType" to edgeType, "label" to e["label"]),
            )
        }.filterNotNull()

        return mapper.writeValueAsString(mapOf("nodes" to nodes, "edges" to rfEdges, "version" to "1"))
    }

    // ── Animation steps generator ─────────────────────────────────────────────
    @Suppress("UNCHECKED_CAST")
    private fun generateAnimationSteps(planJson: String): String {
        val plan  = mapper.readValue(planJson, Map::class.java) as Map<String, Any?>
        val steps = (plan["steps"] as? List<*> ?: emptyList<Any>())
        val edges = (plan["edges"] as? List<*> ?: emptyList<Any>())

        val animSteps = mutableListOf<Map<String, Any?>>()
        var delay = 0

        animSteps.add(mapOf("type" to "start", "delayMs" to delay, "title" to "Building your workflow…"))
        delay += 300

        steps.forEach { step ->
            val s = step as? Map<*, *> ?: return@forEach
            val tempId = s["tempId"]?.toString() ?: return@forEach
            animSteps.add(mapOf(
                "type"    to "add_node",
                "nodeId"  to tempId,
                "delayMs" to delay,
                "title"   to "Adding ${s["name"]}",
            ))
            delay += 350

            // Add the outgoing edges right after the node
            (edges as List<*>).forEach { edge ->
                val e = edge as? Map<*, *> ?: return@forEach
                if (e["from"]?.toString() == tempId) {
                    animSteps.add(mapOf(
                        "type"   to "add_edge",
                        "edgeId" to "e-${e["from"]}-${e["to"]}",
                        "delayMs" to delay,
                        "title"  to "Connecting ${s["name"]}",
                    ))
                    delay += 250
                }
            }
        }

        animSteps.add(mapOf("type" to "complete", "delayMs" to delay, "title" to "Workflow ready for review"))
        return mapper.writeValueAsString(animSteps)
    }
}
