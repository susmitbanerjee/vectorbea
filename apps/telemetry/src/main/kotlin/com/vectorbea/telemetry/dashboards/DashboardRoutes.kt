package com.vectorbea.telemetry.dashboards

import com.vectorbea.telemetry.analytics.AnalyticsQueryService
import com.vectorbea.telemetry.analytics.DashboardFilters
import com.vectorbea.telemetry.auth.TelemetryAuthMiddleware
import com.vectorbea.telemetry.engineering.EngineeringTelemetryService
import com.vectorbea.telemetry.http.Response
import com.vectorbea.telemetry.http.Router
import java.time.Instant
import java.time.temporal.ChronoUnit

class DashboardRoutes(
    private val auth: TelemetryAuthMiddleware,
    private val analyticsQuery: AnalyticsQueryService,
    private val engineeringService: EngineeringTelemetryService,
) {
    fun register(router: Router) {
        router.get("/api/dashboard/summary")   { req -> auth.requireAdmin(req) ?: return@get; handleSummary(req) }
        router.get("/api/dashboard/business")  { req -> auth.requireAdmin(req) ?: return@get; handleBusiness(req) }
        router.get("/api/dashboard/engineering") { req -> auth.requireAdmin(req) ?: return@get; handleEngineering(req) }
        router.get("/api/dashboard/users")     { req -> auth.requireAdmin(req) ?: return@get; handleUsers(req) }
        router.get("/api/dashboard/revenue")   { req -> auth.requireAdmin(req) ?: return@get; handleRevenue(req) }
        router.get("/api/dashboard/architect") { req -> auth.requireAdmin(req) ?: return@get; handleArchitect(req) }
        router.get("/api/dashboard/workflows") { req -> auth.requireAdmin(req) ?: return@get; handleWorkflows(req) }
        router.get("/api/dashboard/environments") { req -> auth.requireAdmin(req) ?: return@get; handleEnvironments(req) }
    }

    private fun filtersFrom(req: com.vectorbea.telemetry.http.TelemetryRequest): DashboardFilters {
        val env = req.queryParam("environment")
        val dateFrom = req.queryParam("dateFrom")?.let { Instant.parse(it) }
            ?: Instant.now().minus(7, ChronoUnit.DAYS)
        val dateTo = req.queryParam("dateTo")?.let { Instant.parse(it) }
            ?: Instant.now()
        return DashboardFilters(
            environment = if (env == "all") null else env,
            dateFrom = dateFrom,
            dateTo = dateTo,
            workspaceId = req.queryParam("workspaceId"),
        )
    }

    private fun handleSummary(req: com.vectorbea.telemetry.http.TelemetryRequest) {
        val filters = filtersFrom(req)
        val business = analyticsQuery.businessSummary(filters)
        val users = analyticsQuery.userSummary(filters)
        Response.ok(req.exchange, mapOf(
            "business" to business,
            "users" to users,
            "filters" to mapOf(
                "environment" to (filters.environment ?: "all"),
                "dateFrom" to filters.dateFrom.toString(),
                "dateTo" to filters.dateTo.toString(),
            ),
        ))
    }

    private fun handleBusiness(req: com.vectorbea.telemetry.http.TelemetryRequest) {
        val filters = filtersFrom(req)
        val summary = analyticsQuery.businessSummary(filters)
        val onboarding = analyticsQuery.onboardingFunnel(filters)
        val topEvents = analyticsQuery.topEvents(filters)
        Response.ok(req.exchange, mapOf(
            "summary" to summary,
            "onboardingFunnel" to onboarding,
            "topEvents" to topEvents,
        ))
    }

    private fun handleEngineering(req: com.vectorbea.telemetry.http.TelemetryRequest) {
        val env = req.queryParam("environment")
        val snapshots = engineeringService.latestSnapshots(if (env == "all") null else env)
        val incidents = engineeringService.openIncidents(if (env == "all") null else env)
        Response.ok(req.exchange, mapOf(
            "services" to snapshots,
            "openIncidents" to incidents,
            "grafanaNote" to "For full traces, metrics, and logs, see Grafana dashboards. Link: \${GRAFANA_URL}",
        ))
    }

    private fun handleUsers(req: com.vectorbea.telemetry.http.TelemetryRequest) {
        val filters = filtersFrom(req)
        val summary = analyticsQuery.userSummary(filters)
        val onboarding = analyticsQuery.onboardingFunnel(filters)
        Response.ok(req.exchange, mapOf(
            "summary" to summary,
            "onboardingFunnel" to onboarding,
        ))
    }

    private fun handleRevenue(req: com.vectorbea.telemetry.http.TelemetryRequest) {
        // Revenue telemetry schema is ready. Monetization is intentionally disabled.
        Response.ok(req.exchange, mapOf(
            "monetizationEnabled" to false,
            "message" to "Revenue telemetry schema is ready. Monetization is disabled.",
            "schemaStatus" to "inactive_scaffolded",
            "metrics" to mapOf(
                "mrr" to "disabled",
                "arr" to "disabled",
                "paidWorkspaces" to "disabled",
                "conversion" to "disabled",
                "churnRate" to "disabled",
            ),
            "note" to "Revenue telemetry will activate when monetization is enabled. " +
                "See revenue_events and revenue_daily_rollups tables for the schema.",
        ))
    }

    private fun handleArchitect(req: com.vectorbea.telemetry.http.TelemetryRequest) {
        val filters = filtersFrom(req)
        val funnel = analyticsQuery.architectFunnel(filters)
        Response.ok(req.exchange, mapOf("architectFunnel" to funnel))
    }

    private fun handleWorkflows(req: com.vectorbea.telemetry.http.TelemetryRequest) {
        val filters = filtersFrom(req)
        val events = analyticsQuery.topEvents(filters)
            .filter { it.category in listOf("workflow", "run", "simulation", "real_execution") }
        Response.ok(req.exchange, mapOf("workflowEvents" to events))
    }

    private fun handleEnvironments(req: com.vectorbea.telemetry.http.TelemetryRequest) {
        val now = Instant.now()
        val from = now.minus(7, ChronoUnit.DAYS)
        val envs = listOf("dev", "stage", "prod")
        val comparison = envs.map { env ->
            val filters = DashboardFilters(environment = env, dateFrom = from, dateTo = now)
            mapOf(
                "environment" to env,
                "business" to analyticsQuery.businessSummary(filters),
                "users" to analyticsQuery.userSummary(filters),
            )
        }
        Response.ok(req.exchange, mapOf("environments" to comparison))
    }
}
