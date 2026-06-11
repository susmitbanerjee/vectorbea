package com.vectorbea.api.beta

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.api.repository.BaseRepository
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class DailyUsage(
    val workflowRuns: Int,
    val simulationRuns: Int,
    val realRuns: Int,
    val aiArchitectRequests: Int,
    val llmCalls: Int,
    val toolCalls: Int,
)

data class WorkspaceBetaControls(
    val id: UUID,
    val workspaceId: UUID,
    val accessStatus: String,
    val executionMode: String,
    val realExecutionEnabled: Boolean,
    val simulationEnabled: Boolean,
    val adminNotes: String?,
    val disabledReason: String?,
    val createdAt: Instant,
    val updatedAt: Instant,
)

data class WorkspaceUsagePolicy(
    val workspaceId: UUID,
    val maxWorkflows: Int,
    val maxRunsPerDay: Int,
    val maxStepsPerWorkflow: Int,
    val maxParallelBranches: Int,
    val maxRunDurationSeconds: Int,
    val maxEventsPerRun: Int,
    val logRetentionDays: Int,
    val allowSchedules: Boolean,
    val allowWebhooks: Boolean,
    val allowIterativeAgents: Boolean,
    val allowAiArchitect: Boolean,
    val maxLlmProviders: Int,
    val maxTeamMembers: Int,
)

data class BetaApplication(
    val id: UUID,
    val appUserId: UUID?,
    val email: String,
    val fullName: String?,
    val companyName: String?,
    val useCase: String?,
    val status: String,
    val createdAt: Instant,
)

class BetaAccessRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(BetaAccessRepository::class.java)
    private val mapper = jacksonObjectMapper()

    // ── Workspace beta controls ───────────────────────────────────────────────

    fun getWorkspaceBetaControls(workspaceId: UUID): WorkspaceBetaControls? = queryOne(
        "SELECT id,workspace_id,access_status,execution_mode,real_execution_enabled,simulation_enabled," +
        "admin_notes,disabled_reason,created_at,updated_at FROM workspace_beta_controls WHERE workspace_id=?",
        { setObject(1, workspaceId) },
    ) { rs -> WorkspaceBetaControls(
        id                   = UUID.fromString(rs.getString("id")),
        workspaceId          = UUID.fromString(rs.getString("workspace_id")),
        accessStatus         = rs.getString("access_status"),
        executionMode        = rs.getString("execution_mode"),
        realExecutionEnabled = rs.getBoolean("real_execution_enabled"),
        simulationEnabled    = rs.getBoolean("simulation_enabled"),
        adminNotes           = rs.getString("admin_notes"),
        disabledReason       = rs.getString("disabled_reason"),
        createdAt            = rs.getTimestamp("created_at").toInstant(),
        updatedAt            = rs.getTimestamp("updated_at").toInstant(),
    )}

    fun ensureWorkspaceBetaControls(workspaceId: UUID) {
        execute("""
            INSERT INTO workspace_beta_controls (workspace_id)
            VALUES (?) ON CONFLICT (workspace_id) DO NOTHING
        """.trimIndent()) { setObject(1, workspaceId) }
    }

    fun setRealExecutionEnabled(workspaceId: UUID, enabled: Boolean, adminUserId: UUID?) {
        execute("""
            UPDATE workspace_beta_controls
            SET real_execution_enabled=?,
                execution_mode=CASE WHEN ? THEN 'real_execution_enabled' ELSE 'simulation_only' END,
                approved_by_user_id=?, approved_at=now(), updated_at=now()
            WHERE workspace_id=?
        """.trimIndent()) {
            setBoolean(1, enabled); setBoolean(2, enabled)
            setObject(3, adminUserId); setObject(4, workspaceId)
        }
    }

    fun disableWorkspace(workspaceId: UUID, reason: String?, adminUserId: UUID?) {
        execute("""
            UPDATE workspace_beta_controls
            SET access_status='disabled', execution_mode='disabled',
                real_execution_enabled=false, simulation_enabled=false,
                disabled_reason=?, approved_by_user_id=?, updated_at=now()
            WHERE workspace_id=?
        """.trimIndent()) { setString(1, reason); setObject(2, adminUserId); setObject(3, workspaceId) }
    }

    // ── Usage policy ──────────────────────────────────────────────────────────

    fun getUsagePolicy(workspaceId: UUID): WorkspaceUsagePolicy? = queryOne(
        """SELECT workspace_id,max_workflows,max_runs_per_day,max_steps_per_workflow,
           max_parallel_branches,max_run_duration_seconds,max_events_per_run,log_retention_days,
           allow_schedules,allow_webhooks,allow_iterative_agents,allow_ai_architect,
           max_llm_providers,max_team_members
           FROM workspace_usage_policies WHERE workspace_id=?""",
        { setObject(1, workspaceId) },
    ) { rs -> WorkspaceUsagePolicy(
        workspaceId          = UUID.fromString(rs.getString("workspace_id")),
        maxWorkflows         = rs.getInt("max_workflows"),
        maxRunsPerDay        = rs.getInt("max_runs_per_day"),
        maxStepsPerWorkflow  = rs.getInt("max_steps_per_workflow"),
        maxParallelBranches  = rs.getInt("max_parallel_branches"),
        maxRunDurationSeconds = rs.getInt("max_run_duration_seconds"),
        maxEventsPerRun      = rs.getInt("max_events_per_run"),
        logRetentionDays     = rs.getInt("log_retention_days"),
        allowSchedules       = rs.getBoolean("allow_schedules"),
        allowWebhooks        = rs.getBoolean("allow_webhooks"),
        allowIterativeAgents = rs.getBoolean("allow_iterative_agents"),
        allowAiArchitect     = rs.getBoolean("allow_ai_architect"),
        maxLlmProviders      = rs.getInt("max_llm_providers"),
        maxTeamMembers       = rs.getInt("max_team_members"),
    )}

    fun ensureUsagePolicy(workspaceId: UUID) {
        execute("INSERT INTO workspace_usage_policies (workspace_id) VALUES (?) ON CONFLICT (workspace_id) DO NOTHING") {
            setObject(1, workspaceId)
        }
    }

    // ── Daily usage counters ──────────────────────────────────────────────────

    fun getDailyRunCount(workspaceId: UUID): Int = queryOne(
        "SELECT COALESCE(workflow_runs,0) FROM daily_workspace_usage WHERE workspace_id=? AND usage_date=CURRENT_DATE",
        { setObject(1, workspaceId) }, { it.getInt(1) }
    ) ?: 0

    fun getDailyUsage(workspaceId: UUID): DailyUsage? = queryOne(
        """SELECT COALESCE(workflow_runs,0),COALESCE(simulation_runs,0),COALESCE(real_runs,0),
           COALESCE(ai_architect_requests,0),COALESCE(llm_calls,0),COALESCE(tool_calls,0)
           FROM daily_workspace_usage WHERE workspace_id=? AND usage_date=CURRENT_DATE""",
        { setObject(1, workspaceId) },
    ) { rs -> DailyUsage(
        workflowRuns         = rs.getInt(1),
        simulationRuns       = rs.getInt(2),
        realRuns             = rs.getInt(3),
        aiArchitectRequests  = rs.getInt(4),
        llmCalls             = rs.getInt(5),
        toolCalls            = rs.getInt(6),
    )}

    fun incrementDailyRuns(workspaceId: UUID, isSimulation: Boolean) {
        execute("""
            INSERT INTO daily_workspace_usage (workspace_id, usage_date, workflow_runs, simulation_runs, real_runs)
            VALUES (?, CURRENT_DATE, 1, ?, ?)
            ON CONFLICT (workspace_id, usage_date) DO UPDATE SET
                workflow_runs   = daily_workspace_usage.workflow_runs + 1,
                simulation_runs = daily_workspace_usage.simulation_runs + EXCLUDED.simulation_runs,
                real_runs       = daily_workspace_usage.real_runs + EXCLUDED.real_runs,
                updated_at      = now()
        """.trimIndent()) {
            setObject(1, workspaceId)
            setInt(2, if (isSimulation) 1 else 0)
            setInt(3, if (isSimulation) 0 else 1)
        }
    }

    // ── Beta applications ─────────────────────────────────────────────────────

    fun findApplicationByEmail(email: String): BetaApplication? = queryOne(
        "SELECT id,app_user_id,email,full_name,company_name,use_case,status,created_at FROM beta_applications WHERE LOWER(email)=LOWER(?) LIMIT 1",
        { setString(1, email) },
    ) { rs -> BetaApplication(
        id          = UUID.fromString(rs.getString("id")),
        appUserId   = rs.getString("app_user_id")?.let { UUID.fromString(it) },
        email       = rs.getString("email"),
        fullName    = rs.getString("full_name"),
        companyName = rs.getString("company_name"),
        useCase     = rs.getString("use_case"),
        status      = rs.getString("status"),
        createdAt   = rs.getTimestamp("created_at").toInstant(),
    )}

    fun upsertBetaApplication(
        email: String, supabaseUserId: UUID?, appUserId: UUID?,
        fullName: String?, company: String?, useCase: String?, currentTools: String?,
        painPoint: String?, workflowsPerWeek: String?, teamSize: String?, byokReady: Boolean?,
    ): BetaApplication = executeReturning("""
        INSERT INTO beta_applications
          (email, supabase_user_id, app_user_id, full_name, company_name, use_case,
           current_tools, pain_point, workflows_per_week, team_size, byok_ready)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT (email) DO UPDATE SET
          supabase_user_id=EXCLUDED.supabase_user_id, app_user_id=EXCLUDED.app_user_id,
          full_name=EXCLUDED.full_name, company_name=EXCLUDED.company_name,
          use_case=EXCLUDED.use_case, current_tools=EXCLUDED.current_tools,
          pain_point=EXCLUDED.pain_point, workflows_per_week=EXCLUDED.workflows_per_week,
          team_size=EXCLUDED.team_size, byok_ready=EXCLUDED.byok_ready, updated_at=now()
        RETURNING id, app_user_id, email, full_name, company_name, use_case, status, created_at
    """.trimIndent(), {
        setString(1, email); setObject(2, supabaseUserId); setObject(3, appUserId)
        setString(4, fullName); setString(5, company); setString(6, useCase)
        setString(7, currentTools); setString(8, painPoint); setString(9, workflowsPerWeek)
        setString(10, teamSize); setBoolean(11, byokReady ?: false)
    }) { rs -> BetaApplication(
        id          = UUID.fromString(rs.getString("id")),
        appUserId   = rs.getString("app_user_id")?.let { UUID.fromString(it) },
        email       = rs.getString("email"),
        fullName    = rs.getString("full_name"),
        companyName = rs.getString("company_name"),
        useCase     = rs.getString("use_case"),
        status      = rs.getString("status"),
        createdAt   = rs.getTimestamp("created_at").toInstant(),
    )}

    fun listBetaApplications(status: String? = null): List<BetaApplication> = query(
        "SELECT id,app_user_id,email,full_name,company_name,use_case,status,created_at " +
        "FROM beta_applications" + (if (status != null) " WHERE status=?" else "") +
        " ORDER BY created_at DESC",
        { if (status != null) setString(1, status) },
    ) { rs -> BetaApplication(
        id          = UUID.fromString(rs.getString("id")),
        appUserId   = rs.getString("app_user_id")?.let { UUID.fromString(it) },
        email       = rs.getString("email"),
        fullName    = rs.getString("full_name"),
        companyName = rs.getString("company_name"),
        useCase     = rs.getString("use_case"),
        status      = rs.getString("status"),
        createdAt   = rs.getTimestamp("created_at").toInstant(),
    )}

    fun updateBetaApplicationStatus(id: UUID, status: String, reviewedBy: UUID?, reason: String?) {
        execute("""
            UPDATE beta_applications SET status=?, reviewed_by_user_id=?, reviewed_at=now(),
            decision_reason=?, updated_at=now() WHERE id=?
        """.trimIndent()) { setString(1,status); setObject(2,reviewedBy); setString(3,reason); setObject(4,id) }
    }

    // Beta applications table might not have email unique constraint in initial migration
    // Add it defensively
    fun ensureBetaApplicationEmailUnique() {
        try {
            execute("ALTER TABLE beta_applications ADD CONSTRAINT uq_beta_apps_email UNIQUE (email)") {}
        } catch (_: Exception) { /* already exists */ }
    }
}
