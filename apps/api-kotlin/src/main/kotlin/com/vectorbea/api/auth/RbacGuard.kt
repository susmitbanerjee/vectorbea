package com.vectorbea.api.auth

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * Role enforcement for workspace-scoped routes.
 *
 * THE PERMISSION MODEL EXISTED AND NOTHING CALLED IT. `Permission.kt` has
 * described the four roles since it was written, but `permissionsForRole` had
 * zero call sites: `RequestContext` verified MEMBERSHIP — "are you in this
 * workspace" — and never the role. So every member of a workspace, viewer
 * included, could create and delete workflows, agents, tools and connections.
 * Demoting somebody to viewer changed what the UI offered them and nothing
 * about what the API would accept.
 *
 * WHY A TABLE AND NOT A LINE IN EVERY HANDLER. Fifty handlers each carrying
 * their own `require(...)` is fifty chances to forget one, and a forgotten one
 * is invisible — it looks exactly like a route that is meant to be open. The
 * mapping below is the whole policy in one screen, which is also what makes it
 * reviewable.
 *
 * DENY BY DEFAULT ON WRITES. A mutating route with no entry does not fall
 * through to "allowed" — it requires the developer floor. A route added
 * tomorrow is therefore safe before anybody remembers this file exists, and the
 * failure mode of forgetting is a refused write rather than a silent hole.
 *
 * READS ARE NOT GATED HERE. Every role from viewer up can read everything in a
 * workspace it belongs to, so GET is settled by membership alone — which
 * `RequestContext` already enforces.
 */
object RbacGuard {

    private val log = LoggerFactory.getLogger(RbacGuard::class.java)

    /** Mutating routes that are NOT workspace-scoped, so no role applies. */
    private val WORKSPACE_EXEMPT = setOf(
        "/api/workspaces",   // creating a workspace: there is no workspace to have a role in
        "/api/bootstrap",    // first-run wiring, before any membership exists
        "/api/beta/apply",   // an applicant is by definition not a member yet
        "/api/telemetry/events",
    )

    /**
     * Explicit permission per mutating route.
     *
     * Keys are "METHOD pathPattern", matching the pattern as registered on the
     * router so the lookup cannot drift from the route.
     */
    private val ROUTE_PERMISSIONS: Map<String, Permission> = mapOf(
        // ── Build surface: developer and up ──────────────────────────────────
        "POST /api/workflows"                        to Permission.WORKFLOW_WRITE,
        "PATCH /api/workflows/:id"                   to Permission.WORKFLOW_WRITE,
        "DELETE /api/workflows/:id"                  to Permission.WORKFLOW_DELETE,
        "POST /api/workflows/:id/versions"           to Permission.WORKFLOW_WRITE,
        "PUT /api/workflows/:id/contracts/:nodeId"   to Permission.WORKFLOW_WRITE,
        "POST /api/workflows/:id/contracts/:nodeId/infer" to Permission.WORKFLOW_WRITE,
        "POST /api/workflows/:id/contracts/:nodeId/test"  to Permission.WORKFLOW_RUN,

        "POST /api/agents"                           to Permission.AGENT_WRITE,
        "PATCH /api/agents/:id"                      to Permission.AGENT_WRITE,
        "DELETE /api/agents/:id"                     to Permission.AGENT_DELETE,

        "POST /api/tools"                            to Permission.TOOL_WRITE,
        "PATCH /api/tools/:id"                       to Permission.TOOL_WRITE,
        "DELETE /api/tools/:id"                      to Permission.TOOL_DELETE,
        "POST /api/tools/test-unsaved"               to Permission.TOOL_WRITE,

        // ── Running: developer and up ────────────────────────────────────────
        "POST /api/workflows/:workflowId/run"        to Permission.WORKFLOW_RUN,
        "POST /api/workflows/:workflowId/runs/debug" to Permission.WORKFLOW_RUN,
        "POST /api/runs/:id/cancel"                  to Permission.RUN_CANCEL,
        "POST /api/runs/:id/retry"                   to Permission.WORKFLOW_RUN,
        "POST /api/runs/:id/retry-node"              to Permission.WORKFLOW_RUN,
        "POST /api/runs/:id/replay"                  to Permission.WORKFLOW_RUN,
        "POST /api/runs/:id/rerun"                   to Permission.WORKFLOW_RUN,
        "POST /api/runs/purge-queued"                to Permission.RUN_CANCEL,
        "POST /api/runs/:runId/continue-as-new"      to Permission.WORKFLOW_RUN,
        "POST /api/runs/:runId/recover"              to Permission.WORKFLOW_RUN,

        // ── Approvals: deciding is a developer act, not an admin one ─────────
        "POST /api/approvals/:id/approve"            to Permission.APPROVAL_DECIDE,
        "POST /api/approvals/:id/reject"             to Permission.APPROVAL_DECIDE,
        "POST /api/approvals/:id/decide"             to Permission.APPROVAL_DECIDE,

        // ── Incidents: acknowledging is triage, developer and up ─────────────
        "POST /api/failure-incidents/:id/mark-resolved"  to Permission.RUN_CANCEL,
        "POST /api/failure-incidents/mark-all-resolved"  to Permission.RUN_CANCEL,
        "POST /api/incidents/dead-letters/:id/acknowledge" to Permission.RUN_CANCEL,

        // ── Connections hold credentials and blast radius: admin and up ──────
        "POST /api/connections"                      to Permission.CONNECTION_WRITE,
        "PATCH /api/connections/:id"                 to Permission.CONNECTION_WRITE,
        "DELETE /api/connections/:id"                to Permission.CONNECTION_DELETE,
        "POST /api/connections/:id/rotate-secret"    to Permission.SECRET_WRITE,
        // Testing reaches a third party with the workspace's credentials, so it
        // is a connection act rather than a read — but it changes nothing, so
        // it sits at CONNECTION_TEST rather than WRITE.
        "POST /api/connections/:id/test"             to Permission.CONNECTION_TEST,
        "POST /api/connections/test-unsaved"         to Permission.CONNECTION_TEST,
        "POST /api/connections/schema-preview"       to Permission.CONNECTION_TEST,
        "POST /api/connections/:id/schema-preview"   to Permission.CONNECTION_TEST,

        // ── Schedules make a workflow run unattended: admin and up ───────────
        "PATCH /api/schedules/:id"                   to Permission.SCHEDULE_WRITE,
        "POST /api/schedules"                        to Permission.SCHEDULE_WRITE,
        "DELETE /api/schedules/:id"                  to Permission.SCHEDULE_WRITE,

        // ── The architect builds workflows, agents and tools ─────────────────
        "POST /api/architect/sessions"                                 to Permission.WORKFLOW_WRITE,
        "POST /api/architect/sessions/:id/generate-plan"               to Permission.WORKFLOW_WRITE,
        "POST /api/architect/sessions/:id/revise-plan"                 to Permission.WORKFLOW_WRITE,
        "POST /api/architect/sessions/:id/approve-plan"                to Permission.WORKFLOW_WRITE,
        "POST /api/architect/sessions/:id/generate-tools"              to Permission.TOOL_WRITE,
        "POST /api/architect/sessions/:id/generate-agents"             to Permission.AGENT_WRITE,
        "POST /api/architect/sessions/:id/create-workflow"             to Permission.WORKFLOW_WRITE,
        "POST /api/architect/sessions/:id/connection-requirements/:reqId/use-simulation" to Permission.WORKFLOW_WRITE,
        // Binding a real connection into a plan is a credential decision.
        "POST /api/architect/sessions/:id/connection-requirements/:reqId/bind-existing" to Permission.CONNECTION_WRITE,
        "POST /api/architect/sessions/:id/connection-requirements/:reqId/test"          to Permission.CONNECTION_TEST,
    )

    /** The floor for a mutating route nobody has classified yet. */
    private val UNCLASSIFIED_WRITE = Permission.WORKFLOW_WRITE

    private val MUTATING = setOf("POST", "PUT", "PATCH", "DELETE")

    /**
     * Refuse the request when the caller's role does not carry the permission.
     *
     * No principal means auth is disabled (local development, no JWT_SECRET),
     * which is the same condition under which `RequestContext` already trusts
     * the workspace header outright. Enforcing roles on top of an identity the
     * server did not verify would be theatre.
     */
    fun check(request: Request, method: String, pathPattern: String) {
        val principal = request.principal ?: return
        if (method !in MUTATING) return
        if (pathPattern in WORKSPACE_EXEMPT) return

        val required = ROUTE_PERMISSIONS["$method $pathPattern"] ?: UNCLASSIFIED_WRITE

        val workspaceId = when (val target = resolveWorkspace(request, principal)) {
            is Target.Resolved -> target.id
            // A workspace this principal is not a member of. `RequestContext`
            // also refuses this, but the guard does NOT defer to it: relying on
            // the handler to run the membership check is the same assumption
            // that left every write unguarded in the first place.
            Target.Foreign -> throw ApiError.Forbidden("You are not a member of this workspace")
            // No header, and the principal has several workspaces — which
            // workspace this would act on is genuinely undetermined, and
            // `RequestContext` raises the precise validation error for it.
            Target.Undetermined -> return
        }

        if (principal.can(required, workspaceId)) return

        val role = principal.roleIn(workspaceId) ?: "none"
        log.info(
            "[rbac] refused {} {} for user={} workspace={} role={} needs={}",
            method, pathPattern, principal.appUserId, workspaceId, role, required,
        )
        throw ApiError.Forbidden(
            "Your role in this workspace (${role.replaceFirstChar { it.uppercase() }}) cannot do this. " +
                "It needs ${minimumRoleFor(required)}. Ask an owner or admin to change your role.",
        )
    }

    /** What the request is acting on — the three cases are handled differently. */
    private sealed interface Target {
        data class Resolved(val id: UUID) : Target
        /** Named a workspace this principal is not an active member of. */
        data object Foreign : Target
        /** Cannot be pinned down here; the handler's context resolution will say why. */
        data object Undetermined : Target
    }

    /**
     * The workspace this request is acting on.
     *
     * Mirrors `Request.context()` rather than calling it, because that function
     * throws with wording the handler owns. The distinction that matters is
     * between "not yours" — which is refused here and now — and "unclear",
     * which is a validation error the handler raises precisely.
     */
    private fun resolveWorkspace(request: Request, principal: AuthPrincipal): Target {
        val raw = request.header("x-workspace-id") ?: request.query("workspaceId")
        if (raw != null) {
            val parsed = runCatching { UUID.fromString(raw.trim()) }.getOrNull()
                ?: return Target.Undetermined // malformed: the handler reports the bad UUID
            return if (parsed in principal.authorizedWorkspaceIds) Target.Resolved(parsed) else Target.Foreign
        }
        // No header. One membership is unambiguous; zero or several are not.
        return principal.authorizedWorkspaceIds.singleOrNull()
            ?.let { Target.Resolved(it) }
            ?: Target.Undetermined
    }

    /** The lowest role that carries [permission], for the refusal message. */
    private fun minimumRoleFor(permission: Permission): String = when {
        permission in permissionsForRole("viewer") -> "Viewer"
        permission in permissionsForRole("developer") -> "Developer"
        permission in permissionsForRole("admin") -> "Admin"
        else -> "Owner"
    }
}
