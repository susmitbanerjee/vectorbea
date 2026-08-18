package com.vectorbea.observability.analytics

import java.time.Instant
import java.time.temporal.ChronoUnit

data class DashboardFilters(
    val environment: String?,
    val dateFrom: Instant,
    val dateTo: Instant,
    val workspaceId: String? = null,
)

data class BusinessSummary(
    val betaApplicationsSubmitted: Long,
    val betaApplicationsApproved: Long,
    val betaApplicationsRejected: Long,
    val activeWorkspaces: Long,
    val workflowsCreated: Long,
    val architectSessions: Long,
    val workflowsFromArchitect: Long,
    val simulationRuns: Long,
    val realRuns: Long,
    val usageLimitBlocks: Long,
)

data class UserAnalyticsSummary(
    val activeUsers: Long,
    val activeWorkspaces: Long,
    val newUsers: Long,
    val signIns: Long,
    val onboardingCompletions: Long,
)

data class EventCount(val name: String, val category: String, val count: Long)

class AnalyticsQueryService(private val repo: AnalyticsRepository) {

    fun businessSummary(filters: DashboardFilters): BusinessSummary {
        fun count(eventName: String) = repo.countByEventNameSingle(filters.environment, eventName, filters.dateFrom, filters.dateTo)
        return BusinessSummary(
            betaApplicationsSubmitted = count("beta_application_submitted"),
            betaApplicationsApproved = count("beta_application_approved"),
            betaApplicationsRejected = count("beta_application_rejected"),
            activeWorkspaces = repo.countDistinctWorkspaces(filters.environment, filters.dateFrom, filters.dateTo),
            workflowsCreated = count("workflow_created"),
            architectSessions = count("architect_opened"),
            workflowsFromArchitect = count("architect_workflow_created"),
            simulationRuns = count("simulation_run_started"),
            realRuns = count("real_execution_started"),
            usageLimitBlocks = count("usage_limit_blocked"),
        )
    }

    fun userSummary(filters: DashboardFilters): UserAnalyticsSummary {
        fun count(eventName: String) = repo.countByEventNameSingle(filters.environment, eventName, filters.dateFrom, filters.dateTo)
        return UserAnalyticsSummary(
            activeUsers = repo.countDistinctUsers(filters.environment, filters.dateFrom, filters.dateTo),
            activeWorkspaces = repo.countDistinctWorkspaces(filters.environment, filters.dateFrom, filters.dateTo),
            newUsers = count("workspace_created"),
            signIns = count("user_signed_in"),
            onboardingCompletions = count("first_real_run_completed"),
        )
    }

    fun topEvents(filters: DashboardFilters): List<EventCount> =
        repo.countByEventName(filters.environment, filters.dateFrom, filters.dateTo)
            .map { EventCount(it["eventName"] as String, it["eventCategory"] as String, it["count"] as Long) }

    /** Daily event counts per category for the activity chart. */
    fun dailyActivity(filters: DashboardFilters): List<Map<String, Any?>> =
        repo.dailyCounts(filters.environment, filters.dateFrom, filters.dateTo)

    fun architectFunnel(filters: DashboardFilters): Map<String, Long> {
        val events = listOf(
            "architect_opened",
            "architect_goal_submitted",
            "architect_plan_generated",
            "architect_plan_approved",
            "architect_workflow_created",
            "architect_simulation_started",
        )
        return events.associateWith { name ->
            repo.countByEventNameSingle(filters.environment, name, filters.dateFrom, filters.dateTo)
        }
    }

    fun onboardingFunnel(filters: DashboardFilters): Map<String, Long> {
        val events = listOf(
            "workspace_created",
            "first_connection_created",
            "first_workflow_created",
            "first_simulation_run_started",
            "first_simulation_run_completed",
            "first_real_run_started",
            "first_real_run_completed",
        )
        return events.associateWith { name ->
            repo.countByEventNameSingle(filters.environment, name, filters.dateFrom, filters.dateTo)
        }
    }
}
