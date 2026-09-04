package com.vectorbea.api.telemetry

import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.observability.analytics.AnalyticsIngestionService
import com.vectorbea.observability.analytics.AnalyticsQueryService
import com.vectorbea.observability.analytics.DashboardFilters
import com.vectorbea.observability.analytics.IngestBatchRequest
import com.vectorbea.observability.engineering.EngineeringTelemetryService
import com.vectorbea.observability.json.mapper
import org.slf4j.LoggerFactory
import java.time.Instant
import java.time.temporal.ChronoUnit

/**
 * The routes that used to be `apps/telemetry`.
 *
 * INGESTION PATHS ARE UNCHANGED
 * -----------------------------
 * `/api/telemetry/events` and `/internal/telemetry/events` keep their exact paths,
 * bodies and auth model, so the web app moves by pointing `TELEMETRY_ENDPOINT` at the
 * API host. No client change, no coordinated deploy.
 *
 * THE ADMIN DASHBOARD PATHS HAD TO MOVE
 * -------------------------------------
 * They did not survive the merge unchanged, and pretending otherwise would have been
 * worse than moving them. `apps/telemetry` served `GET /api/dashboard/summary` for the
 * cross-workspace admin analytics. `api-kotlin` ALREADY serves `GET
 * /api/dashboard/summary` for the product dashboard a normal user sees on Home. Two
 * different resources, same path, in one process now.
 *
 * Whichever registered second would have shadowed the other - silently, since the
 * router matches first-wins - and the failure would have surfaced as a user seeing
 * platform-wide analytics or an admin seeing one workspace's. So the admin set moved to
 * `/api/admin/telemetry/…` and the static console with it. This is the one behavioural
 * change in the fold; it is listed in docs/architecture/OBSERVABILITY.md.
 *
 * AUTH IS THE API'S OWN
 * ---------------------
 * The telemetry service carried its own `JwtVerifier` and `TelemetryAuthMiddleware`
 * because it had no other. Inside the API those would be a second implementation of
 * authentication - the last thing a codebase should have two of - so they are dropped
 * and these routes use the principal the API's middleware already resolved.
 */
class TelemetryRoutes(
    private val ingestion: AnalyticsIngestionService?,
    private val query: AnalyticsQueryService?,
    private val engineering: EngineeringTelemetryService?,
    private val config: AppConfig,
) {
    private val log = LoggerFactory.getLogger(TelemetryRoutes::class.java)

    fun register(router: Router) {
        if (ingestion == null || query == null || engineering == null) {
            log.warn("[telemetry] analytics disabled — no database; ingestion and admin routes not registered")
            return
        }

        // ── Ingestion — same paths as the standalone service ──────────────────
        router.post("/api/telemetry/events") { req ->
            // Any authenticated user may report their own client events.
            req.principal ?: throw ApiError.Unauthorized()
            ingest(req, "user-client")
        }

        router.post("/internal/telemetry/events") { req ->
            requireInternalToken(req)
            ingest(req, req.header("X-Source-Service") ?: "internal")
        }

        // ── Admin analytics — moved under /api/admin/telemetry ────────────────
        router.get("/api/admin/telemetry/summary")      { req -> admin(req); summary(req) }
        router.get("/api/admin/telemetry/business")     { req -> admin(req); business(req) }
        router.get("/api/admin/telemetry/engineering")  { req -> admin(req); engineeringSnapshot(req) }
        router.get("/api/admin/telemetry/users")        { req -> admin(req); users(req) }
        router.get("/api/admin/telemetry/revenue")      { req -> admin(req); revenue(req) }
        router.get("/api/admin/telemetry/architect")    { req -> admin(req); architect(req) }
        router.get("/api/admin/telemetry/workflows")    { req -> admin(req); workflows(req) }
        router.get("/api/admin/telemetry/environments") { req -> admin(req); environments(req) }

        log.info("[telemetry] in-process analytics registered (ingestion + 8 admin routes)")
    }

    // ── Guards ────────────────────────────────────────────────────────────────

    private fun admin(req: Request) {
        val p = req.principal ?: throw ApiError.Unauthorized()
        if (!p.isPlatformAdmin && !config.isAdmin(p.email)) {
            throw ApiError.Forbidden("Platform admin access required")
        }
    }

    /**
     * Constant-time comparison on the internal token.
     *
     * The token gates writes into the analytics store from anything that can reach the
     * API, so a timing oracle on it is worth closing even though the payoff for an
     * attacker is modest. `String.equals` short-circuits on the first differing byte.
     */
    private fun requireInternalToken(req: Request) {
        val expected = config.telemetryInternalToken
            ?: throw ApiError.Unauthorized("Internal ingestion is not configured")
        val presented = req.header("X-Telemetry-Token")
            ?: req.header("Authorization")?.removePrefix("Bearer ")?.trim()
            ?: throw ApiError.Unauthorized("Internal token required")
        if (!java.security.MessageDigest.isEqual(
                presented.toByteArray(Charsets.UTF_8), expected.toByteArray(Charsets.UTF_8))) {
            throw ApiError.Unauthorized("Invalid internal token")
        }
    }

    // ── Handlers ──────────────────────────────────────────────────────────────

    private fun ingest(req: Request, source: String): Response {
        val batch = mapper.readValue(req.body ?: "{}", IngestBatchRequest::class.java)
        val result = ingestion!!.ingestBatch(batch, sourceService = source)
        return Response.ok(mapOf(
            "accepted" to result.accepted,
            "rejected" to result.rejected,
            "errors" to result.errors,
        ))
    }

    private fun filters(req: Request): DashboardFilters {
        val env = req.query("environment")
        return DashboardFilters(
            environment = if (env == "all") null else env,
            dateFrom = req.query("dateFrom")?.let { Instant.parse(it) }
                ?: Instant.now().minus(7, ChronoUnit.DAYS),
            dateTo = req.query("dateTo")?.let { Instant.parse(it) } ?: Instant.now(),
            workspaceId = req.query("workspaceId"),
        )
    }

    private fun summary(req: Request): Response {
        val f = filters(req)
        return Response.ok(mapOf(
            "business" to query!!.businessSummary(f),
            "users" to query.userSummary(f),
            "timeseries" to query.dailyActivity(f),
            "filters" to mapOf(
                "environment" to (f.environment ?: "all"),
                "dateFrom" to f.dateFrom.toString(),
                "dateTo" to f.dateTo.toString(),
            ),
        ))
    }

    private fun business(req: Request): Response {
        val f = filters(req)
        return Response.ok(mapOf(
            "summary" to query!!.businessSummary(f),
            "onboardingFunnel" to query.onboardingFunnel(f),
            "topEvents" to query.topEvents(f),
        ))
    }

    private fun engineeringSnapshot(req: Request): Response {
        val env = req.query("environment")?.takeIf { it != "all" }
        return Response.ok(mapOf(
            "services" to engineering!!.latestSnapshots(env),
            "openIncidents" to engineering.openIncidents(env),
            // The fleet and run dashboards live in Grafana now; this points there
            // rather than reimplementing them against Postgres.
            "grafanaUrl" to (System.getenv("GRAFANA_URL") ?: ""),
        ))
    }

    private fun users(req: Request): Response {
        val f = filters(req)
        return Response.ok(mapOf(
            "summary" to query!!.userSummary(f),
            "onboardingFunnel" to query.onboardingFunnel(f),
        ))
    }

    /**
     * Monetisation is deliberately off; the schema exists and the endpoint says so.
     *
     * Reproduced verbatim from the standalone service rather than dropped, because a
     * dashboard that 404s reads as broken, whereas one that says "disabled" reads as a
     * decision. `revenue_events` and `revenue_daily_rollups` are scaffolded and empty.
     */
    private fun revenue(req: Request): Response = Response.ok(mapOf(
        "monetizationEnabled" to false,
        "message" to "Revenue telemetry schema is ready. Monetization is disabled.",
        "schemaStatus" to "inactive_scaffolded",
        "metrics" to mapOf(
            "mrr" to "disabled", "arr" to "disabled", "paidWorkspaces" to "disabled",
            "conversion" to "disabled", "churnRate" to "disabled",
        ),
        "note" to "Revenue telemetry will activate when monetization is enabled. " +
            "See revenue_events and revenue_daily_rollups tables for the schema.",
    ))

    private fun architect(req: Request): Response =
        Response.ok(mapOf("architectFunnel" to query!!.architectFunnel(filters(req))))

    private fun workflows(req: Request): Response = Response.ok(mapOf(
        "workflowEvents" to query!!.topEvents(filters(req))
            .filter { it.category in listOf("workflow", "run", "simulation", "real_execution") },
    ))

    /**
     * Side-by-side comparison across the three deployments, always over the last week.
     *
     * Ignores the request's date filters, as the original did: this view answers "does
     * stage look like prod", which is a question about the recent past specifically.
     */
    private fun environments(req: Request): Response {
        val now = Instant.now()
        val from = now.minus(7, ChronoUnit.DAYS)
        val comparison = listOf("dev", "stage", "prod").map { env ->
            val f = DashboardFilters(environment = env, dateFrom = from, dateTo = now)
            mapOf(
                "environment" to env,
                "business" to query!!.businessSummary(f),
                "users" to query.userSummary(f),
            )
        }
        return Response.ok(mapOf("environments" to comparison))
    }
}
