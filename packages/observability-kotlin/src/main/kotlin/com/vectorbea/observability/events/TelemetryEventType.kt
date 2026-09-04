package com.vectorbea.observability.events

/** All valid analytics event categories. */
enum class EventCategory(val value: String) {
    BETA("beta"),
    ONBOARDING("onboarding"),
    ARCHITECT("architect"),
    WORKFLOW("workflow"),
    RUN("run"),
    CONNECTION("connection"),
    AGENT("agent"),
    TOOL("tool"),
    SIMULATION("simulation"),
    REAL_EXECUTION("real_execution"),
    APPROVAL("approval"),
    RECOVERY("recovery"),
    USAGE_LIMIT("usage_limit"),
    USER("user"),
    WORKSPACE("workspace"),
    REVENUE_FUTURE("revenue_future");

    companion object {
        private val byValue = values().associateBy { it.value }
        fun from(raw: String?): EventCategory? = byValue[raw?.lowercase()]
    }
}

/** Canonical event names — enforced at ingestion. */
object EventNames {
    val BETA = setOf(
        "beta_application_viewed",
        "beta_application_submitted",
        "beta_application_approved",
        "beta_application_rejected",
        "workspace_real_execution_enabled",
        "workspace_real_execution_disabled",
    )
    val ONBOARDING = setOf(
        "user_signed_in",
        "workspace_created",
        "first_connection_created",
        "first_workflow_created",
        "first_simulation_run_started",
        "first_simulation_run_completed",
        "first_real_run_started",
        "first_real_run_completed",
    )
    val ARCHITECT = setOf(
        "architect_opened",
        "architect_goal_submitted",
        "architect_plan_generated",
        "architect_plan_approved",
        "architect_connection_requirement_created",
        "architect_connection_bound",
        "architect_tool_generated",
        "architect_agent_generated",
        "architect_workflow_created",
        "architect_animation_started",
        "architect_animation_completed",
        "architect_simulation_started",
    )
    val WORKFLOW = setOf(
        "workflow_created",
        "workflow_updated",
        "workflow_published",
        "workflow_archived",
        "workflow_deleted",
        "workflow_builder_opened",
        "workflow_validation_failed",
    )
    val RUN = setOf(
        "workflow_run_queued",
        "workflow_run_started",
        "workflow_run_succeeded",
        "workflow_run_failed",
        "workflow_run_cancelled",
        "workflow_run_recovered",
        "workflow_run_continued_as_new",
        "workflow_debug_run_queued",
    )
    val CONNECTION = setOf(
        "connection_created",
        "connection_test_started",
        "connection_test_succeeded",
        "connection_test_failed",
        "connection_secret_rotated",
    )
    val AGENT = setOf(
        "agent_created",
        "agent_updated",
        "agent_iteration_started",
        "agent_iteration_completed",
        "agent_budget_exceeded",
    )
    val TOOL = setOf(
        "tool_created",
        "tool_updated",
        "tool_call_started",
        "tool_call_succeeded",
        "tool_call_failed",
    )
    val SIMULATION = setOf(
        "simulation_run_started",
        "simulation_run_completed",
        "simulation_real_call_blocked",
    )
    val REAL_EXECUTION = setOf(
        "real_execution_requested",
        "real_execution_blocked",
        "real_execution_started",
        "real_execution_completed",
    )
    val APPROVAL = setOf(
        "approval_requested",
        "approval_approved",
        "approval_rejected",
        "approval_timeout",
    )
    val RECOVERY = setOf(
        "failure_incident_created",
        "recovery_recommendation_generated",
        "recovery_attempt_started",
        "recovery_attempt_succeeded",
        "recovery_attempt_failed",
    )
    val USAGE_LIMIT = setOf(
        "usage_limit_warning",
        "usage_limit_blocked",
        "beta_limit_increase_requested",
    )
    val USER = setOf(
        "member_invited",
        "member_joined",
        "workspace_settings_updated",
        // Generic product-analytics events emitted by the web app
        "page_viewed",
        "user_signed_out",
        "docs_viewed",
    )
    val REVENUE_FUTURE = setOf(
        "revenue_event_placeholder",
        "monetization_disabled_viewed",
    )

    private val ALL: Map<EventCategory, Set<String>> = mapOf(
        EventCategory.BETA to BETA,
        EventCategory.ONBOARDING to ONBOARDING,
        EventCategory.ARCHITECT to ARCHITECT,
        EventCategory.WORKFLOW to WORKFLOW,
        EventCategory.RUN to RUN,
        EventCategory.CONNECTION to CONNECTION,
        EventCategory.AGENT to AGENT,
        EventCategory.TOOL to TOOL,
        EventCategory.SIMULATION to SIMULATION,
        EventCategory.REAL_EXECUTION to REAL_EXECUTION,
        EventCategory.APPROVAL to APPROVAL,
        EventCategory.RECOVERY to RECOVERY,
        EventCategory.USAGE_LIMIT to USAGE_LIMIT,
        EventCategory.USER to USER,
        EventCategory.WORKSPACE to USER,
        EventCategory.REVENUE_FUTURE to REVENUE_FUTURE,
    )

    fun isValid(category: EventCategory, eventName: String): Boolean =
        ALL[category]?.contains(eventName) ?: false
}
