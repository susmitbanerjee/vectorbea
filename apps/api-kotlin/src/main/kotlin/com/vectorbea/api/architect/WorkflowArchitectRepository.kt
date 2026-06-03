package com.vectorbea.api.architect

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.api.repository.BaseRepository
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class ArchitectSession(
    val id: UUID, val workspaceId: UUID, val environmentId: UUID,
    val createdByUserId: UUID, val status: String, val currentStage: String,
    val userGoal: String, val refinedGoal: String?,
    val clarificationQuestionsJson: String, val userAnswersJson: String,
    val generatedPlanJson: String?, val generatedGraphJson: String?,
    val animationStepsJson: String?, val generatedWorkflowId: UUID?,
    val generatedWorkflowVersionId: UUID?, val readinessStatus: String,
    val readinessIssuesJson: String, val failureReason: String?,
    val createdAt: Instant, val updatedAt: Instant,
)

data class ConnectionRequirement(
    val id: UUID, val workspaceId: UUID, val sessionId: UUID,
    val tempConnectionId: String, val name: String, val type: String,
    val providerHint: String?, val description: String?,
    val usedByTempIds: String, val requiredForSimulation: Boolean,
    val requiredForRealExecution: Boolean, val status: String,
    val boundConnectionId: UUID?, val testStatus: String?,
    val testErrorSanitized: String?, val setupInstructions: String?,
    val fieldsNeededJson: String, val createdAt: Instant, val updatedAt: Instant,
)

data class GeneratedTool(
    val id: UUID, val workspaceId: UUID, val sessionId: UUID,
    val tempToolId: String, val toolId: UUID?, val name: String, val type: String,
    val connectionRequirementId: UUID?, val boundConnectionId: UUID?,
    val status: String, val generatedConfigJson: String,
    val inputSchemaJson: String, val outputSchemaJson: String,
    val riskLevel: String, val requiresApproval: Boolean,
    val createdAt: Instant, val updatedAt: Instant,
)

data class GeneratedAgent(
    val id: UUID, val workspaceId: UUID, val sessionId: UUID,
    val tempAgentId: String, val agentId: UUID?,
    val name: String, val type: String, val role: String?,
    val generatedSystemPrompt: String, val allowedTempToolIds: String,
    val boundToolIds: String, val outputSchemaJson: String,
    val status: String, val createdAt: Instant, val updatedAt: Instant,
)

data class BuildStep(
    val id: UUID, val sessionId: UUID, val sequence: Int,
    val stepType: String, val title: String, val description: String?,
    val status: String, val targetType: String?, val targetId: String?,
    val payloadJsonSanitized: String, val delayMs: Int, val createdAt: Instant,
)

class WorkflowArchitectRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(WorkflowArchitectRepository::class.java)
    @Suppress("unused") private val mapper = jacksonObjectMapper()

    private val sCols = """id, workspace_id, environment_id, created_by_user_id, status,
        COALESCE(current_stage, 'understand_goal') as current_stage,
        user_goal, refined_goal, clarification_questions_json, user_answers_json,
        generated_plan_json, generated_graph_json, animation_steps_json,
        generated_workflow_id, generated_workflow_version_id,
        COALESCE(readiness_status, 'not_ready') as readiness_status,
        COALESCE(readiness_issues_json::text, '[]') as readiness_issues_json,
        failure_reason, created_at, updated_at"""

    fun create(workspaceId: UUID, environmentId: UUID, userId: UUID, goal: String): ArchitectSession =
        executeReturning(
            "INSERT INTO workflow_architect_sessions (workspace_id,environment_id,created_by_user_id,user_goal)" +
            " VALUES (?,?,?,?) RETURNING $sCols",
            { setObject(1, workspaceId); setObject(2, environmentId); setObject(3, userId); setString(4, goal) },
            ::mapSession,
        )

    fun findById(id: UUID, workspaceId: UUID): ArchitectSession? = queryOne(
        "SELECT $sCols FROM workflow_architect_sessions WHERE id=? AND workspace_id=?",
        { setObject(1, id); setObject(2, workspaceId) }, ::mapSession,
    )

    fun updateStatus(id: UUID, status: String, failureReason: String? = null) = execute(
        "UPDATE workflow_architect_sessions SET status=?,failure_reason=?,updated_at=now() WHERE id=?",
    ) { setString(1, status); setString(2, failureReason); setObject(3, id) }

    fun updateStage(id: UUID, stage: String) = execute(
        "UPDATE workflow_architect_sessions SET current_stage=?,updated_at=now() WHERE id=?",
    ) { setString(1, stage); setObject(2, id) }

    fun savePlan(id: UUID, planJson: String, graphJson: String?, animSteps: String?) = execute(
        "UPDATE workflow_architect_sessions SET generated_plan_json=?::jsonb,generated_graph_json=?::jsonb," +
        "animation_steps_json=?::jsonb,status='plan_generated',current_stage='plan_generated',updated_at=now() WHERE id=?",
    ) { setString(1, planJson); setString(2, graphJson); setString(3, animSteps); setObject(4, id) }

    fun approvePlan(id: UUID) = execute(
        "UPDATE workflow_architect_sessions SET status='plan_approved',current_stage='connection_setup'," +
        "approved_plan_at=now(),updated_at=now() WHERE id=?",
    ) { setObject(1, id) }

    fun markConnectionSetupComplete(id: UUID) = execute(
        "UPDATE workflow_architect_sessions SET connection_setup_completed_at=now()," +
        "current_stage='tool_generation',updated_at=now() WHERE id=?",
    ) { setObject(1, id) }

    fun markToolsGenerated(id: UUID) = execute(
        "UPDATE workflow_architect_sessions SET tools_generated_at=now()," +
        "current_stage='agent_generation',updated_at=now() WHERE id=?",
    ) { setObject(1, id) }

    fun markAgentsGenerated(id: UUID) = execute(
        "UPDATE workflow_architect_sessions SET agents_generated_at=now()," +
        "current_stage='workflow_graph_generation',updated_at=now() WHERE id=?",
    ) { setObject(1, id) }

    fun saveWorkflowIds(id: UUID, workflowId: UUID, versionId: UUID) = execute(
        "UPDATE workflow_architect_sessions SET generated_workflow_id=?,generated_workflow_version_id=?," +
        "workflow_graph_generated_at=now(),status='workflow_created',current_stage='canvas_animation',updated_at=now() WHERE id=?",
    ) { setObject(1, workflowId); setObject(2, versionId); setObject(3, id) }

    fun updateReadiness(id: UUID, status: String, issuesJson: String) = execute(
        "UPDATE workflow_architect_sessions SET readiness_status=?,readiness_issues_json=?::jsonb,updated_at=now() WHERE id=?",
    ) { setString(1, status); setString(2, issuesJson); setObject(3, id) }

    fun saveClarifications(id: UUID, questionsJson: String) = execute(
        "UPDATE workflow_architect_sessions SET clarification_questions_json=?::jsonb," +
        "status='needs_clarification',updated_at=now() WHERE id=?",
    ) { setString(1, questionsJson); setObject(2, id) }

    fun incrementUsage(workspaceId: UUID, planGenerations: Int = 0, tokensUsed: Int = 0, costCents: Int = 0) = execute(
        "INSERT INTO workflow_architect_usage (workspace_id,usage_date,planning_requests,plan_generations,tokens_used,estimated_cost_cents)" +
        " VALUES (?,CURRENT_DATE,1,?,?,?)" +
        " ON CONFLICT (workspace_id,usage_date) DO UPDATE SET" +
        " planning_requests=workflow_architect_usage.planning_requests+1," +
        " plan_generations=workflow_architect_usage.plan_generations+EXCLUDED.plan_generations," +
        " tokens_used=workflow_architect_usage.tokens_used+EXCLUDED.tokens_used," +
        " estimated_cost_cents=workflow_architect_usage.estimated_cost_cents+EXCLUDED.estimated_cost_cents," +
        " updated_at=now()",
    ) { setObject(1, workspaceId); setInt(2, planGenerations); setInt(3, tokensUsed); setInt(4, costCents) }

    fun getDailyPlanningRequests(workspaceId: UUID): Int = queryOne(
        "SELECT COALESCE(planning_requests,0) FROM workflow_architect_usage WHERE workspace_id=? AND usage_date=CURRENT_DATE",
        { setObject(1, workspaceId) }, { it.getInt(1) },
    ) ?: 0

    fun getRevisionCount(sessionId: UUID): Int = queryOne(
        "SELECT COUNT(*) FROM workflow_architect_events WHERE session_id=? AND event_type='ARCHITECT_PLAN_REVISED'",
        { setObject(1, sessionId) }, { it.getInt(1) },
    ) ?: 0

    fun appendEvent(workspaceId: UUID, sessionId: UUID, eventType: String, title: String, message: String? = null) = execute(
        "INSERT INTO workflow_architect_events (workspace_id,session_id,sequence,event_type,title,message)" +
        " VALUES (?,?,(SELECT COALESCE(MAX(sequence),0)+1 FROM workflow_architect_events WHERE session_id=?),?,?,?)",
    ) { setObject(1, workspaceId); setObject(2, sessionId); setObject(3, sessionId); setString(4, eventType); setString(5, title); setString(6, message) }

    // ── Connection requirements ───────────────────────────────────────────────

    fun upsertConnectionRequirement(
        workspaceId: UUID, sessionId: UUID, tempConnectionId: String,
        name: String, type: String, providerHint: String?, description: String?,
        usedByTempIds: String, requiredForSimulation: Boolean, requiredForRealExecution: Boolean,
        setupInstructions: String?, fieldsNeededJson: String,
    ): ConnectionRequirement = executeReturning(
        "INSERT INTO workflow_architect_connection_requirements" +
        " (workspace_id,session_id,temp_connection_id,name,type,provider_hint,description," +
        " used_by_temp_ids,required_for_simulation,required_for_real_execution,setup_instructions,fields_needed_json)" +
        " VALUES (?,?,?,?,?,?,?,?::jsonb,?,?,?,?::jsonb)" +
        " ON CONFLICT (session_id,temp_connection_id) DO UPDATE SET" +
        " name=EXCLUDED.name,type=EXCLUDED.type,provider_hint=EXCLUDED.provider_hint," +
        " description=EXCLUDED.description,used_by_temp_ids=EXCLUDED.used_by_temp_ids," +
        " required_for_simulation=EXCLUDED.required_for_simulation," +
        " required_for_real_execution=EXCLUDED.required_for_real_execution," +
        " setup_instructions=EXCLUDED.setup_instructions," +
        " fields_needed_json=EXCLUDED.fields_needed_json,updated_at=now()" +
        " RETURNING *",
        {
            setObject(1, workspaceId); setObject(2, sessionId); setString(3, tempConnectionId)
            setString(4, name); setString(5, type); setString(6, providerHint); setString(7, description)
            setString(8, usedByTempIds); setBoolean(9, requiredForSimulation); setBoolean(10, requiredForRealExecution)
            setString(11, setupInstructions); setString(12, fieldsNeededJson)
        },
        ::mapConnReq,
    )

    fun listConnectionRequirements(sessionId: UUID): List<ConnectionRequirement> = queryList(
        "SELECT * FROM workflow_architect_connection_requirements WHERE session_id=? ORDER BY created_at",
        { setObject(1, sessionId) }, ::mapConnReq,
    )

    fun findConnectionRequirement(id: UUID, sessionId: UUID): ConnectionRequirement? = queryOne(
        "SELECT * FROM workflow_architect_connection_requirements WHERE id=? AND session_id=?",
        { setObject(1, id); setObject(2, sessionId) }, ::mapConnReq,
    )

    fun updateConnectionRequirementStatus(
        id: UUID, status: String, boundConnectionId: UUID? = null,
        testStatus: String? = null, testError: String? = null,
    ) = execute(
        "UPDATE workflow_architect_connection_requirements" +
        " SET status=?,bound_connection_id=?,test_status=?,test_error_sanitized=?,updated_at=now() WHERE id=?",
    ) { setString(1, status); setObject(2, boundConnectionId); setString(3, testStatus); setString(4, testError); setObject(5, id) }

    // ── Generated tools ───────────────────────────────────────────────────────

    fun upsertGeneratedTool(
        workspaceId: UUID, sessionId: UUID, tempToolId: String,
        name: String, type: String, connectionRequirementId: UUID?,
        boundConnectionId: UUID?, status: String,
        configJson: String, inputSchemaJson: String, outputSchemaJson: String,
        riskLevel: String, requiresApproval: Boolean,
    ): GeneratedTool = executeReturning(
        "INSERT INTO workflow_architect_generated_tools" +
        " (workspace_id,session_id,temp_tool_id,name,type,connection_requirement_id," +
        " bound_connection_id,status,generated_config_json,input_schema_json,output_schema_json,risk_level,requires_approval)" +
        " VALUES (?,?,?,?,?,?,?,?,?::jsonb,?::jsonb,?::jsonb,?,?)" +
        " ON CONFLICT (session_id,temp_tool_id) DO UPDATE SET" +
        " name=EXCLUDED.name,type=EXCLUDED.type,status=EXCLUDED.status," +
        " generated_config_json=EXCLUDED.generated_config_json," +
        " input_schema_json=EXCLUDED.input_schema_json,output_schema_json=EXCLUDED.output_schema_json," +
        " bound_connection_id=EXCLUDED.bound_connection_id,updated_at=now()" +
        " RETURNING *",
        {
            setObject(1, workspaceId); setObject(2, sessionId); setString(3, tempToolId)
            setString(4, name); setString(5, type); setObject(6, connectionRequirementId)
            setObject(7, boundConnectionId); setString(8, status)
            setString(9, configJson); setString(10, inputSchemaJson); setString(11, outputSchemaJson)
            setString(12, riskLevel); setBoolean(13, requiresApproval)
        },
        ::mapGenTool,
    )

    fun updateGeneratedToolId(id: UUID, toolId: UUID, status: String) = execute(
        "UPDATE workflow_architect_generated_tools SET tool_id=?,status=?,updated_at=now() WHERE id=?",
    ) { setObject(1, toolId); setString(2, status); setObject(3, id) }

    fun listGeneratedTools(sessionId: UUID): List<GeneratedTool> = queryList(
        "SELECT * FROM workflow_architect_generated_tools WHERE session_id=? ORDER BY created_at",
        { setObject(1, sessionId) }, ::mapGenTool,
    )

    // ── Generated agents ──────────────────────────────────────────────────────

    fun upsertGeneratedAgent(
        workspaceId: UUID, sessionId: UUID, tempAgentId: String,
        name: String, type: String, role: String?,
        systemPrompt: String, allowedTempToolIds: String,
        outputSchemaJson: String, status: String,
    ): GeneratedAgent = executeReturning(
        "INSERT INTO workflow_architect_generated_agents" +
        " (workspace_id,session_id,temp_agent_id,name,type,role,generated_system_prompt," +
        " allowed_temp_tool_ids,output_schema_json,status)" +
        " VALUES (?,?,?,?,?,?,?,?::jsonb,?::jsonb,?)" +
        " ON CONFLICT (session_id,temp_agent_id) DO UPDATE SET" +
        " name=EXCLUDED.name,role=EXCLUDED.role,generated_system_prompt=EXCLUDED.generated_system_prompt," +
        " allowed_temp_tool_ids=EXCLUDED.allowed_temp_tool_ids,status=EXCLUDED.status,updated_at=now()" +
        " RETURNING *",
        {
            setObject(1, workspaceId); setObject(2, sessionId); setString(3, tempAgentId)
            setString(4, name); setString(5, type); setString(6, role); setString(7, systemPrompt)
            setString(8, allowedTempToolIds); setString(9, outputSchemaJson); setString(10, status)
        },
        ::mapGenAgent,
    )

    fun updateGeneratedAgentId(id: UUID, agentId: UUID, boundToolIds: String, status: String) = execute(
        "UPDATE workflow_architect_generated_agents SET agent_id=?,bound_tool_ids=?::jsonb,status=?,updated_at=now() WHERE id=?",
    ) { setObject(1, agentId); setString(2, boundToolIds); setString(3, status); setObject(4, id) }

    fun listGeneratedAgents(sessionId: UUID): List<GeneratedAgent> = queryList(
        "SELECT * FROM workflow_architect_generated_agents WHERE session_id=? ORDER BY created_at",
        { setObject(1, sessionId) }, ::mapGenAgent,
    )

    // ── Build steps ───────────────────────────────────────────────────────────

    fun insertBuildStep(
        workspaceId: UUID, sessionId: UUID, sequence: Int,
        stepType: String, title: String, description: String? = null,
        targetType: String? = null, targetId: String? = null,
        payloadJson: String = "{}", delayMs: Int = 0,
    ) = execute(
        "INSERT INTO workflow_architect_build_steps" +
        " (workspace_id,session_id,sequence,step_type,title,description,target_type,target_id,payload_json_sanitized,delay_ms)" +
        " VALUES (?,?,?,?,?,?,?,?,?::jsonb,?) ON CONFLICT (session_id,sequence) DO NOTHING",
    ) {
        setObject(1, workspaceId); setObject(2, sessionId); setInt(3, sequence)
        setString(4, stepType); setString(5, title); setString(6, description)
        setString(7, targetType); setString(8, targetId); setString(9, payloadJson); setInt(10, delayMs)
    }

    fun listBuildSteps(sessionId: UUID): List<BuildStep> = queryList(
        "SELECT * FROM workflow_architect_build_steps WHERE session_id=? ORDER BY sequence",
        { setObject(1, sessionId) }, ::mapBuildStep,
    )

    // ── Row mappers ───────────────────────────────────────────────────────────

    private fun mapSession(rs: java.sql.ResultSet) = ArchitectSession(
        id = UUID.fromString(rs.getString("id")),
        workspaceId = UUID.fromString(rs.getString("workspace_id")),
        environmentId = UUID.fromString(rs.getString("environment_id")),
        createdByUserId = UUID.fromString(rs.getString("created_by_user_id")),
        status = rs.getString("status"),
        currentStage = rs.getString("current_stage") ?: "understand_goal",
        userGoal = rs.getString("user_goal"),
        refinedGoal = rs.getString("refined_goal"),
        clarificationQuestionsJson = rs.getString("clarification_questions_json") ?: "[]",
        userAnswersJson = rs.getString("user_answers_json") ?: "{}",
        generatedPlanJson = rs.getString("generated_plan_json"),
        generatedGraphJson = rs.getString("generated_graph_json"),
        animationStepsJson = rs.getString("animation_steps_json"),
        generatedWorkflowId = rs.getString("generated_workflow_id")?.let { UUID.fromString(it) },
        generatedWorkflowVersionId = rs.getString("generated_workflow_version_id")?.let { UUID.fromString(it) },
        readinessStatus = rs.getString("readiness_status") ?: "not_ready",
        readinessIssuesJson = rs.getString("readiness_issues_json") ?: "[]",
        failureReason = rs.getString("failure_reason"),
        createdAt = rs.getTimestamp("created_at").toInstant(),
        updatedAt = rs.getTimestamp("updated_at").toInstant(),
    )

    private fun mapConnReq(rs: java.sql.ResultSet) = ConnectionRequirement(
        id = UUID.fromString(rs.getString("id")),
        workspaceId = UUID.fromString(rs.getString("workspace_id")),
        sessionId = UUID.fromString(rs.getString("session_id")),
        tempConnectionId = rs.getString("temp_connection_id"),
        name = rs.getString("name"), type = rs.getString("type"),
        providerHint = rs.getString("provider_hint"), description = rs.getString("description"),
        usedByTempIds = rs.getString("used_by_temp_ids") ?: "[]",
        requiredForSimulation = rs.getBoolean("required_for_simulation"),
        requiredForRealExecution = rs.getBoolean("required_for_real_execution"),
        status = rs.getString("status"),
        boundConnectionId = rs.getString("bound_connection_id")?.let { UUID.fromString(it) },
        testStatus = rs.getString("test_status"), testErrorSanitized = rs.getString("test_error_sanitized"),
        setupInstructions = rs.getString("setup_instructions"),
        fieldsNeededJson = rs.getString("fields_needed_json") ?: "[]",
        createdAt = rs.getTimestamp("created_at").toInstant(), updatedAt = rs.getTimestamp("updated_at").toInstant(),
    )

    private fun mapGenTool(rs: java.sql.ResultSet) = GeneratedTool(
        id = UUID.fromString(rs.getString("id")),
        workspaceId = UUID.fromString(rs.getString("workspace_id")),
        sessionId = UUID.fromString(rs.getString("session_id")),
        tempToolId = rs.getString("temp_tool_id"),
        toolId = rs.getString("tool_id")?.let { UUID.fromString(it) },
        name = rs.getString("name"), type = rs.getString("type"),
        connectionRequirementId = rs.getString("connection_requirement_id")?.let { UUID.fromString(it) },
        boundConnectionId = rs.getString("bound_connection_id")?.let { UUID.fromString(it) },
        status = rs.getString("status"),
        generatedConfigJson = rs.getString("generated_config_json") ?: "{}",
        inputSchemaJson = rs.getString("input_schema_json") ?: "{}",
        outputSchemaJson = rs.getString("output_schema_json") ?: "{}",
        riskLevel = rs.getString("risk_level"), requiresApproval = rs.getBoolean("requires_approval"),
        createdAt = rs.getTimestamp("created_at").toInstant(), updatedAt = rs.getTimestamp("updated_at").toInstant(),
    )

    private fun mapGenAgent(rs: java.sql.ResultSet) = GeneratedAgent(
        id = UUID.fromString(rs.getString("id")),
        workspaceId = UUID.fromString(rs.getString("workspace_id")),
        sessionId = UUID.fromString(rs.getString("session_id")),
        tempAgentId = rs.getString("temp_agent_id"),
        agentId = rs.getString("agent_id")?.let { UUID.fromString(it) },
        name = rs.getString("name"), type = rs.getString("type"), role = rs.getString("role"),
        generatedSystemPrompt = rs.getString("generated_system_prompt") ?: "",
        allowedTempToolIds = rs.getString("allowed_temp_tool_ids") ?: "[]",
        boundToolIds = rs.getString("bound_tool_ids") ?: "[]",
        outputSchemaJson = rs.getString("output_schema_json") ?: "{}",
        status = rs.getString("status"),
        createdAt = rs.getTimestamp("created_at").toInstant(), updatedAt = rs.getTimestamp("updated_at").toInstant(),
    )

    private fun mapBuildStep(rs: java.sql.ResultSet) = BuildStep(
        id = UUID.fromString(rs.getString("id")),
        sessionId = UUID.fromString(rs.getString("session_id")),
        sequence = rs.getInt("sequence"), stepType = rs.getString("step_type"),
        title = rs.getString("title"), description = rs.getString("description"),
        status = rs.getString("status"), targetType = rs.getString("target_type"),
        targetId = rs.getString("target_id"),
        payloadJsonSanitized = rs.getString("payload_json_sanitized") ?: "{}",
        delayMs = rs.getInt("delay_ms"), createdAt = rs.getTimestamp("created_at").toInstant(),
    )
}
