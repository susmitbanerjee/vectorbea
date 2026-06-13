package com.vectorbea.api.beta

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.api.api.context
import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.users.AppUserRepository
import com.vectorbea.api.telemetry.TelemetryClient
import java.net.URI
import java.util.Base64
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
    private val telemetry: TelemetryClient? = null,
) {
    private val log    = org.slf4j.LoggerFactory.getLogger(BetaRoutes::class.java)
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
        val existingApplication = (principal.email ?: user?.email)
            ?.let { runCatching { betaRepo.findApplicationByEmail(it) }.getOrNull() }
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
            "applicationStatus"    to existingApplication?.status,
            "alreadySubmitted"     to (existingApplication != null),
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
        val sourceAppUrl = appUrlForRequest(req)

        // Block re-submission if an application already exists for this email
        val existing = betaRepo.findApplicationByEmail(email)
        if (existing != null) {
            betaRepo.updateBetaApplicationSourceUrlByEmail(email, sourceAppUrl)
            val msg = when (existing.status) {
                "waitlisted" -> "Your application is under evaluation. We review every request manually and will reach out soon."
                "approved"   -> "Your application has already been approved. Please sign in to access Vectorbea."
                "rejected"   -> "Your application was not accepted at this time. Contact us if you have questions."
                "disabled"   -> "Your account has been disabled. Contact support."
                else         -> "An application already exists for this email. We will be in touch."
            }
            return Response.ok(mapOf(
                "id"               to existing.id.toString(),
                "status"           to existing.status,
                "alreadySubmitted" to true,
                "message"          to msg,
            ))
        }

        val application = betaRepo.upsertBetaApplication(
            email           = email,
            supabaseUserId  = principal.supabaseUserId?.let { runCatching { UUID.fromString(it) }.getOrNull() },
            appUserId       = principal.appUserId,
            fullName        = body["fullName"] as? String,
            company         = body["company"] as? String,
            role            = body["role"] as? String,
            useCase         = body["useCase"] as? String,
            currentTools    = body["currentTools"] as? String,
            painPoint       = body["painPoint"] as? String,
            workflowsPerWeek = body["workflowsPerWeek"] as? String,
            teamSize        = body["teamSize"] as? String,
            byokReady       = body["byokReady"] as? Boolean,
            sourceAppUrl    = sourceAppUrl,
        )

        // Send admin notification email via Resend (best-effort — never block the response)
        runCatching { sendBetaApplicationAdminEmail(email, body, sourceAppUrl) }
            .onFailure { log.warn("[beta] admin notification email failed: {}", it.message) }

        // Full structured application data for the telemetry funnel.
        // Free-text fields are truncated; the use case itself stays out of
        // telemetry (only its length) — it can contain sensitive detail.
        telemetry?.track("beta_application_submitted", "beta",
            appUserId = principal.appUserId.toString(),
            properties = mapOf(
                "company"          to (body["company"] as? String)?.take(120),
                "role"             to (body["role"] as? String)?.take(120),
                "workflowsPerWeek" to (body["workflowsPerWeek"] as? String)?.take(40),
                "teamSize"         to (body["teamSize"] as? String)?.take(40),
                "byokReady"        to (body["byokReady"] as? Boolean ?: false),
                "currentTools"     to (body["currentTools"] as? String)?.take(200),
                "painPoint"        to (body["painPoint"] as? String)?.take(200),
                "useCaseLength"    to ((body["useCase"] as? String)?.length ?: 0),
            ))

        return Response.created(mapOf(
            "id"      to application.id.toString(),
            "status"  to application.status,
            "message" to "Application received. Vectorbea is currently invite-only. We review every workspace manually.",
        ))
    }

    private fun sendAdminNotification(applicantEmail: String, body: Map<String, Any?>) {
        val resendKey = System.getenv("RESEND_API_KEY") ?: return
        val adminEmails = config.adminEmails.ifEmpty {
            listOfNotNull(System.getenv("SUPPORT_EMAIL"), System.getenv("ADMIN_EMAIL"))
                .flatMap { it.split(",") }
                .map { it.trim() }
                .filter { it.isNotEmpty() }
                .toSet()
        }.ifEmpty { return }
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
        app?.email?.let { email ->
            runCatching { sendBetaDecisionEmail(email, approved = true, sourceAppUrl = app.sourceAppUrl) }
                .onFailure { log.warn("[beta] approval email failed: {}", it.message) }
        }

        telemetry?.track("beta_application_approved", "beta",
            appUserId = app?.appUserId?.toString(),
            properties = mapOf("applicationId" to id.toString()))

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
        app?.email?.let { email ->
            runCatching { sendBetaDecisionEmail(email, approved = false, sourceAppUrl = app.sourceAppUrl) }
                .onFailure { log.warn("[beta] rejection email failed: {}", it.message) }
        }

        telemetry?.track("beta_application_rejected", "beta",
            properties = mapOf("applicationId" to id.toString()))

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

    private fun sendBetaApplicationAdminEmail(applicantEmail: String, body: Map<String, Any?>, sourceAppUrl: String?) {
        val resendKey = System.getenv("RESEND_API_KEY") ?: return
        val adminEmails = config.adminEmails.ifEmpty { return }
        val appUrl = canonicalAppUrl(sourceAppUrl) ?: defaultAppUrl()
        val reviewUrl = "$appUrl/admin/beta/applications"

        val fullName = body["fullName"] as? String ?: "Not provided"
        val company = body["company"] as? String ?: "Not provided"
        val role = body["role"] as? String ?: "Not provided"
        val useCase = body["useCase"] as? String ?: "Not provided"
        val tools = body["currentTools"] as? String ?: "Not provided"
        val pain = body["painPoint"] as? String ?: "Not provided"
        val runs = body["workflowsPerWeek"] as? String ?: "Not provided"
        val teamSize = body["teamSize"] as? String ?: "Not provided"
        val byokReady = (body["byokReady"] as? Boolean) ?: false

        fun row(label: String, value: String) =
            """<tr><td style="padding:6px 14px 6px 0;color:#6B7280;font-size:13px;vertical-align:top;white-space:nowrap;">${escapeHtml(label)}</td><td style="padding:6px 0;color:#0B0D0F;font-size:13px;">${escapeHtml(value)}</td></tr>"""

        val html = """
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:620px;color:#0B0D0F;">
            ${logoHtml(appUrl)}
            <p style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#6B7280;margin:0 0 8px;">Beta access request</p>
            <h2 style="font-size:22px;line-height:1.25;margin:0 0 18px;">${escapeHtml(fullName)} wants access</h2>
            <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px;">
              ${row("Email", applicantEmail)}
              ${row("Environment", config.appEnv)}
              ${row("Company", company)}
              ${row("Role", role)}
              ${row("Runs per week", runs)}
              ${row("Team size", teamSize)}
              ${row("Current tools", tools)}
              ${row("Pain point", pain)}
              ${row("BYOK ready", if (byokReady) "Yes" else "No")}
            </table>
            <div style="white-space:pre-wrap;border:1px solid #E0E3E6;border-radius:10px;padding:14px;font-size:13px;line-height:1.6;color:#374151;margin:0 0 18px;">${escapeHtml(useCase.take(1000))}</div>
            <p style="margin:0 0 18px;">
              <a href="$reviewUrl" style="background:#0B0D0F;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Review application</a>
            </p>
            <p style="font-size:12px;color:#6B7280;margin:0;">Open the admin panel to approve or reject this request.</p>
            </div>
        """.trimIndent()

        val text = """
            New beta access request

            Name: $fullName
            Email: $applicantEmail
            Environment: ${config.appEnv}
            Company: $company
            Role: $role
            Runs per week: $runs
            Team size: $teamSize
            Current tools: $tools
            Pain point: $pain
            BYOK ready: ${if (byokReady) "Yes" else "No"}

            Use case:
            $useCase

            Review application:
            $reviewUrl
        """.trimIndent()

        val res = sendResendEmail(
            resendKey = resendKey,
            to = adminEmails.toList(),
            subject = "New beta application: $fullName ($applicantEmail)",
            html = html,
            text = text,
            includeLogoAttachment = true,
        )
        log.info("[beta] admin notification sent to {} HTTP {}", adminEmails, res.statusCode())
    }

    private fun sendBetaDecisionEmail(email: String, approved: Boolean, sourceAppUrl: String?) {
        val resendKey = System.getenv("RESEND_API_KEY") ?: return
        val appUrl = canonicalAppUrl(sourceAppUrl) ?: defaultAppUrl()
        val subject = if (approved) "Welcome to Vectorbea" else "Vectorbea access request update"
        val body = if (approved) {
            """
            <p style="font-size:16px;line-height:1.6;color:#374151;margin:0 0 18px;">Your Vectorbea access request has been approved.</p>
            <p style="font-size:16px;line-height:1.6;color:#374151;margin:0 0 22px;">You can now sign in and start with your default workspace.</p>
            <p style="margin:0;"><a href="$appUrl/signin" style="background:#0B0D0F;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:700;display:inline-block;">Open Vectorbea</a></p>
            """.trimIndent()
        } else {
            """
            <p style="font-size:16px;line-height:1.6;color:#374151;margin:0 0 18px;">Thank you for your interest in Vectorbea.</p>
            <p style="font-size:16px;line-height:1.6;color:#374151;margin:0;">We are sorry, but we cannot approve your access request right now.</p>
            """.trimIndent()
        }
        val html = """
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;color:#0B0D0F;">
            ${logoHtml(appUrl)}
            <h2 style="font-size:22px;line-height:1.25;margin:0 0 16px;">${if (approved) "Welcome to Vectorbea" else "Access request update"}</h2>
            $body
            </div>
        """.trimIndent()
        val text = if (approved) {
            "Your Vectorbea access request has been approved.\n\nSign in here:\n$appUrl/signin"
        } else {
            "Thank you for your interest in Vectorbea.\n\nWe are sorry, but we cannot approve your access request right now."
        }

        sendResendEmail(
            resendKey = resendKey,
            to = listOf(email),
            subject = subject,
            html = html,
            text = text,
            includeLogoAttachment = true,
        )
    }

    private fun sendResendEmail(
        resendKey: String,
        to: List<String>,
        subject: String,
        html: String,
        text: String,
        includeLogoAttachment: Boolean = false,
    ): java.net.http.HttpResponse<String> {
        val payload = mutableMapOf<String, Any>(
            "from" to (System.getenv("EMAIL_FROM") ?: System.getenv("FROM_EMAIL") ?: "Vectorbea <noreply@vectorbea.com>"),
            "to" to to,
            "subject" to subject,
            "html" to html,
            "text" to text,
        )
        if (includeLogoAttachment) {
            payload["attachments"] = listOf(mapOf(
                "filename" to "vectorbea-logo.svg",
                "content" to LOGO_SVG_BASE64,
            ))
        }

        val http = java.net.http.HttpClient.newHttpClient()
        val req = java.net.http.HttpRequest.newBuilder()
            .uri(java.net.URI.create("https://api.resend.com/emails"))
            .header("Content-Type", "application/json")
            .header("Authorization", "Bearer $resendKey")
            .POST(java.net.http.HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)))
            .timeout(java.time.Duration.ofSeconds(10))
            .build()
        return http.send(req, java.net.http.HttpResponse.BodyHandlers.ofString())
    }

    private fun appUrlForRequest(req: Request): String =
        canonicalAppUrl(req.header("x-vectorbea-app-url"))
            ?: canonicalAppUrl(req.header("origin"))
            ?: defaultAppUrl()

    private fun defaultAppUrl(): String =
        canonicalAppUrl(System.getenv("APP_URL"))
            ?: canonicalAppUrl(System.getenv("NEXT_PUBLIC_APP_URL"))
            ?: "https://app.vectorbea.com"

    private fun canonicalAppUrl(raw: String?): String? {
        val value = raw?.trim()?.trimEnd('/')?.takeIf { it.isNotBlank() } ?: return null
        val uri = runCatching { URI.create(if ("://" in value) value else "https://$value") }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase()?.takeIf { it == "https" || it == "http" } ?: return null
        val host = uri.host?.lowercase() ?: return null
        if (!isAllowedAppHost(host)) return null
        val port = uri.port
        val portPart = if (port > 0 && !((scheme == "https" && port == 443) || (scheme == "http" && port == 80))) ":$port" else ""
        return "$scheme://$host$portPart"
    }

    private fun isAllowedAppHost(host: String): Boolean =
        host == "localhost" ||
            host == "127.0.0.1" ||
            host == "vectorbea.com" ||
            host.endsWith(".vectorbea.com") ||
            host == "vectorbea.app" ||
            host.endsWith(".vectorbea.app")

    private fun logoHtml(appUrl: String): String =
        """<p style="margin:0 0 18px;"><img src="$appUrl/icon.svg" width="32" height="32" alt="Vectorbea" style="display:block;border:0;border-radius:8px;" /></p>"""

    private fun escapeHtml(value: String): String =
        value.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace("\"", "&quot;")

    private fun requireAdmin(req: Request): com.vectorbea.api.auth.AuthPrincipal {
        val principal = req.principal ?: throw ApiError.Unauthorized("Authentication required")
        val user = userRepo.findById(principal.appUserId)
        val email = principal.email ?: user?.email
        if (user?.isPlatformAdmin != true && !config.isAdmin(email)) {
            throw ApiError.Forbidden("Admin access required")
        }
        return principal
    }

    companion object {
        private val LOGO_SVG_BASE64 = Base64.getEncoder().encodeToString(
            """
            <svg width="64" height="64" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="32" height="32" rx="8" fill="#0B0D0F"/>
              <g stroke="#FFFFFF" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                <ellipse cx="11.6" cy="11.4" rx="3" ry="2.1" fill="#00A65A" fill-opacity="0.9"/>
                <ellipse cx="20.4" cy="11.4" rx="3" ry="2.1" fill="#00A65A" fill-opacity="0.9"/>
                <ellipse cx="16" cy="18" rx="4" ry="5" fill="#007F4E"/>
                <path d="M12.4 16.4h7.2"/>
                <path d="M12.2 19h7.6"/>
                <path d="M12.8 21.6h6.4"/>
                <path d="M14.2 12.8 13 10" stroke-opacity="0.85"/>
                <path d="M17.8 12.8 19 10" stroke-opacity="0.85"/>
              </g>
            </svg>
            """.trimIndent().toByteArray(Charsets.UTF_8)
        )
    }
}
