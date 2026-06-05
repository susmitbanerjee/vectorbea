package com.vectorbea.api.beta

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.api.api.context
import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.users.AppUserRepository
import java.util.UUID

/**
 * Beta access routes — available to authenticated but unapproved users.
 * GET  /api/beta/status
 * POST /api/beta/apply
 * Admin:
 * GET  /api/admin/beta/applications
 * POST /api/admin/beta/applications/:id/approve
 * POST /api/admin/beta/applications/:id/reject
 * POST /api/admin/beta/workspaces/:wsId/enable-real-execution
 * POST /api/admin/beta/workspaces/:wsId/disable
 * GET  /api/admin/beta/workspaces/:wsId/usage
 */
class BetaRoutes(
    private val betaRepo: BetaAccessRepository,
    private val userRepo: AppUserRepository,
    private val config: AppConfig,
) {
    private val mapper = jacksonObjectMapper()

    fun register(router: Router) {
        // Public beta routes (require auth but NOT beta approval)
        router.get( "/api/beta/status", ::getBetaStatus)
        router.post("/api/beta/apply",  ::applyForBeta)

        // Admin-only routes
        router.get( "/api/admin/beta/applications",                                ::listApplications)
        router.post("/api/admin/beta/applications/:id/approve",                    ::approveApplication)
        router.post("/api/admin/beta/applications/:id/reject",                     ::rejectApplication)
        router.post("/api/admin/beta/workspaces/:wsId/enable-real-execution",      ::enableRealExecution)
        router.post("/api/admin/beta/workspaces/:wsId/disable",                    ::disableWorkspace)
        router.get( "/api/admin/beta/workspaces/:wsId/usage",                      ::getWorkspaceUsage)
    }

    // ── GET /api/beta/status ──────────────────────────────────────────────────

    private fun getBetaStatus(req: Request): Response {
        val principal = req.principal ?: throw ApiError.Unauthorized("Authentication required")
        val user = userRepo.findById(principal.appUserId)
        val betaStatus = user?.betaStatus ?: "waitlisted"
        val canAccess  = betaStatus == "approved"

        // Workspace is optional for beta status — waitlisted users have no workspace yet
        val wsId = runCatching { req.context().workspaceId }.getOrNull()
        val controls   = wsId?.let { runCatching { betaRepo.getWorkspaceBetaControls(it) }.getOrNull() }
        val policy     = wsId?.let { runCatching { betaRepo.getUsagePolicy(it) }.getOrNull() }
        val runsToday  = wsId?.let { runCatching { betaRepo.getDailyRunCount(it) }.getOrDefault(0) } ?: 0
        val usageToday = wsId?.let { runCatching { betaRepo.getDailyUsage(it) }.getOrNull() }

        val maxRuns      = policy?.maxRunsPerDay ?: config.betaDefaultMaxRunsPerDay
        val maxWorkflows = policy?.maxWorkflows   ?: config.betaDefaultMaxWorkflows
        val maxSteps     = policy?.maxStepsPerWorkflow ?: config.betaDefaultMaxStepsPerWorkflow

        return Response.ok(mapOf(
            "betaStatus"           to betaStatus,
            "canAccessProduct"     to canAccess,
            "canRunSimulation"     to (canAccess && (controls?.simulationEnabled ?: true)),
            "canRunRealExecution"  to (canAccess && (controls?.realExecutionEnabled ?: false)),
            "executionMode"        to (controls?.executionMode ?: "simulation_only"),
            "workspaceStatus"      to (controls?.accessStatus ?: "pending"),
            // Limits
            "maxRunsPerDay"        to maxRuns,
            "maxWorkflows"         to maxWorkflows,
            "maxStepsPerWorkflow"  to maxSteps,
            "maxTeamMembers"       to (policy?.maxTeamMembers ?: 1),
            "maxLlmProviders"      to (policy?.maxLlmProviders ?: 1),
            "logRetentionDays"     to (policy?.logRetentionDays ?: 7),
            "allowSchedules"       to (policy?.allowSchedules ?: false),
            "allowWebhooks"        to (policy?.allowWebhooks ?: false),
            "allowIterativeAgents" to (policy?.allowIterativeAgents ?: false),
            // Actual usage today
            "runsToday"            to runsToday,
            "simulationRunsToday"  to (usageToday?.simulationRuns ?: 0),
            "realRunsToday"        to (usageToday?.realRuns ?: 0),
            "llmCallsToday"        to (usageToday?.llmCalls ?: 0),
            "aiArchitectRequestsToday" to (usageToday?.aiArchitectRequests ?: 0),
            "message"              to when (betaStatus) {
                "approved"   -> "Your account is approved. Welcome to Vectorbea private beta."
                "waitlisted" -> "Application received. Vectorbea is currently invite-only. We review every workspace manually."
                "rejected"   -> "Your application was not accepted at this time."
                "disabled"   -> "Your account has been disabled. Contact support."
                else         -> "Application received."
            },
        ))
    }

    // ── POST /api/beta/apply ──────────────────────────────────────────────────

    private fun applyForBeta(req: Request): Response {
        val principal = req.principal ?: throw ApiError.Unauthorized("Authentication required")
        val body = req.bodyAs<Map<String, Any?>>()
        val email = (body["email"] as? String ?: principal.email ?: "").trim()
        if (email.isBlank()) throw ApiError.ValidationError("email is required")

        val application = betaRepo.upsertBetaApplication(
            email           = email,
            supabaseUserId  = principal.supabaseUserId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
            appUserId       = principal.appUserId,
            fullName        = body["fullName"] as? String,
            company         = body["company"] as? String,
            useCase         = body["useCase"] as? String,
            currentTools    = body["currentTools"] as? String,
            painPoint       = body["painPoint"] as? String,
            workflowsPerWeek = body["workflowsPerWeek"] as? String,
            teamSize        = body["teamSize"] as? String,
            byokReady       = body["byokReady"] as? Boolean,
        )

        // Send admin notification email via Resend (best-effort — never block the response)
        runCatching { sendAdminNotification(email, body) }
            .onFailure { log.warn("[beta] admin notification email failed: {}", it.message) }

        return Response.created(mapOf(
            "id"      to application.id.toString(),
            "status"  to application.status,
            "message" to "Application received. Vectorbea is currently invite-only. We review every workspace manually.",
        ))
    }

    private fun sendAdminNotification(applicantEmail: String, body: Map<String, Any?>) {
        val resendKey = System.getenv("RESEND_API_KEY") ?: return
        val adminEmails = config.adminEmails.ifEmpty { return }
        val appUrl      = System.getenv("APP_URL") ?: System.getenv("NEXT_PUBLIC_APP_URL") ?: "https://app.vectorbea.com"

        val fullName  = body["fullName"]  as? String ?: "—"
        val company   = body["company"]   as? String ?: "—"
        val useCase   = body["useCase"]   as? String ?: "—"
        val byokReady = (body["byokReady"] as? Boolean) ?: false

        val html = """
            <h2>New Vectorbea Beta Application</h2>
            <table style="border-collapse:collapse;font-size:14px;">
              <tr><td style="padding:4px 12px 4px 0;color:#666;"><b>Name</b></td><td>$fullName</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#666;"><b>Email</b></td><td>$applicantEmail</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#666;"><b>Company</b></td><td>$company</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#666;"><b>Use case</b></td><td>${useCase.take(300)}</td></tr>
              <tr><td style="padding:4px 12px 4px 0;color:#666;"><b>BYOK ready</b></td><td>${if (byokReady) "Yes" else "No"}</td></tr>
            </table>
            <p style="margin-top:16px;">
              <a href="$appUrl/admin/beta/applications" style="background:#D97706;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:600;">
                Review in admin panel
              </a>
            </p>
        """.trimIndent()

        val payload = mapper.writeValueAsString(mapOf(
            "from"    to "Vectorbea <noreply@vectorbea.com>",
            "to"      to adminEmails.toList(),
            "subject" to "New beta application: $fullName ($applicantEmail)",
            "html"    to html,
        ))

        val http = java.net.http.HttpClient.newHttpClient()
        val req  = java.net.http.HttpRequest.newBuilder()
            .uri(java.net.URI.create("https://api.resend.com/emails"))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer $resendKey")
            .POST(java.net.http.HttpRequest.BodyPublishers.ofString(payload))
            .timeout(java.time.Duration.ofSeconds(10))
            .build()
        val res = http.send(req, java.net.http.HttpResponse.BodyHandlers.ofString())
        log.info("[beta] admin notification sent to {} → HTTP {}", adminEmails, res.statusCode())
    }

    // ── Admin: list applications ──────────────────────────────────────────────

    private fun listApplications(req: Request): Response {
        requireAdmin(req)
        val status = req.query("status")
        val apps = betaRepo.listBetaApplications(status)
        return Response.ok(mapOf(
            "applications" to apps.map { mapOf(
                "id"          to it.id.toString(),
                "email"       to it.email,
                "fullName"    to it.fullName,
                "company"     to it.companyName,
                "useCase"     to it.useCase,
                "status"      to it.status,
                "createdAt"   to it.createdAt.toString(),
            )},
            "total" to apps.size,
        ))
    }

    // ── Admin: approve application ────────────────────────────────────────────

    private fun approveApplication(req: Request): Response {
        val adminPrincipal = requireAdmin(req)
        val id   = UUID.fromString(req.pathParam("id"))
        val body = req.bodyAs<Map<String, Any?>>()

        betaRepo.updateBetaApplicationStatus(id, "approved", adminPrincipal.appUserId,
            body["reason"] as? String)

        // Mark app_user as approved if linked
        val apps = betaRepo.listBetaApplications()
        val app  = apps.find { it.id == id }
        if (app?.appUserId != null) {
            userRepo.setBetaStatus(app.appUserId, "approved")
            // Ensure workspace controls exist and are approved
            val wsId = userRepo.getPrimaryWorkspaceId(app.appUserId)
            if (wsId != null) {
                betaRepo.ensureWorkspaceBetaControls(wsId)
                betaRepo.ensureUsagePolicy(wsId)
            }
        }

        return Response.ok(mapOf("id" to id.toString(), "status" to "approved",
            "message" to "Application approved. User can now access the product."))
    }

    // ── Admin: reject application ─────────────────────────────────────────────

    private fun rejectApplication(req: Request): Response {
        val adminPrincipal = requireAdmin(req)
        val id   = UUID.fromString(req.pathParam("id"))
        val body = req.bodyAs<Map<String, Any?>>()
        betaRepo.updateBetaApplicationStatus(id, "rejected", adminPrincipal.appUserId,
            body["reason"] as? String)
        val apps = betaRepo.listBetaApplications()
        val app  = apps.find { it.id == id }
        if (app?.appUserId != null) userRepo.setBetaStatus(app.appUserId, "rejected")
        return Response.ok(mapOf("id" to id.toString(), "status" to "rejected"))
    }

    // ── Admin: enable real execution ──────────────────────────────────────────

    private fun enableRealExecution(req: Request): Response {
        val adminPrincipal = requireAdmin(req)
        val wsId   = UUID.fromString(req.pathParam("wsId"))
        val body   = req.bodyAs<Map<String, Any?>>()
        val enable = (body["enabled"] as? Boolean) ?: true
        betaRepo.setRealExecutionEnabled(wsId, enable, adminPrincipal.appUserId)
        return Response.ok(mapOf(
            "workspaceId"          to wsId.toString(),
            "realExecutionEnabled" to enable,
            "message"              to if (enable) "Real execution enabled for workspace." else "Real execution disabled."
        ))
    }

    // ── Admin: disable workspace ──────────────────────────────────────────────

    private fun disableWorkspace(req: Request): Response {
        val adminPrincipal = requireAdmin(req)
        val wsId   = UUID.fromString(req.pathParam("wsId"))
        val body   = req.bodyAs<Map<String, Any?>>()
        betaRepo.disableWorkspace(wsId, body["reason"] as? String, adminPrincipal.appUserId)
        return Response.ok(mapOf("workspaceId" to wsId.toString(), "status" to "disabled"))
    }

    // ── Admin: workspace usage ────────────────────────────────────────────────

    private fun getWorkspaceUsage(req: Request): Response {
        requireAdmin(req)
        val wsId    = UUID.fromString(req.pathParam("wsId"))
        val controls = betaRepo.getWorkspaceBetaControls(wsId)
        val policy   = betaRepo.getUsagePolicy(wsId)
        val runsToday = betaRepo.getDailyRunCount(wsId)
        return Response.ok(mapOf(
            "workspaceId"          to wsId.toString(),
            "accessStatus"         to (controls?.accessStatus ?: "unknown"),
            "executionMode"        to (controls?.executionMode ?: "unknown"),
            "realExecutionEnabled" to (controls?.realExecutionEnabled ?: false),
            "runsToday"            to runsToday,
            "maxRunsPerDay"        to (policy?.maxRunsPerDay ?: config.betaDefaultMaxRunsPerDay),
            "maxWorkflows"         to (policy?.maxWorkflows ?: config.betaDefaultMaxWorkflows),
        ))
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun requireAdmin(req: Request): com.vectorbea.api.auth.AuthPrincipal {
        val principal = req.principal ?: throw ApiError.Unauthorized("Authentication required")
        val user = userRepo.findById(principal.appUserId)
        val email = principal.email ?: user?.email
        if (user?.isPlatformAdmin != true && !config.isAdmin(email)) {
            throw ApiError.Forbidden("Admin access required")
        }
        return principal
    }
}
