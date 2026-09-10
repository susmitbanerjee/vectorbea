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
        /*
         * A webhook delivery. Public and principal-less by design, so `check`
         * already returns early — but a sender that happens to hold a session
         * cookie would otherwise be measured against WORKFLOW_WRITE and refused
         * for a delivery that has nothing to do with editing a workflow. Named
         * here so the exemption is a decision rather than a side effect of one.
         */
        "/api/hooks/:token",
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

        /* Exporting is a BULK EXTRACTION of every run, event and trace the
           workspace holds, so it sits with the governance surfaces rather than
           the build ones. A developer can already read any single run; handing
           the whole history out as one downloadable object is a different act,
           and the person accountable for it is an admin. */
        "POST /api/retention/exports"                to Permission.WORKSPACE_WRITE,

        /* ── API keys and member budgets: the admin floor ────────────────────
           A key can spend the workspace's whole allowance and, when minted
           without an actor, is attributable to nobody. A member budget decides
           how much of the host's money a guest may burn. Both are governance
           decisions about somebody else's money, which is the admin's job and
           not a developer's — and a developer who could mint an unattributed key
           would have a way around the member cap set for them. */
        "POST /api/api-keys"                         to Permission.WORKSPACE_WRITE,
        /* Rotating a key mints a live credential and narrowing its limit changes
           what an integration can do. Both are workspace administration, held to
           the same floor as minting one. */
        "POST /api/api-keys/:id/rotate"              to Permission.WORKSPACE_WRITE,
        "PUT /api/api-keys/:id/rate-limit"           to Permission.WORKSPACE_WRITE,

        /*
         * A webhook is a trigger, so it is classified with the schedule that is
         * its closest relative rather than with the workflow it starts. Somebody
         * trusted to change when a workflow runs is not automatically trusted to
         * change what it does.
         *
         * The replay is a RUN, not a write: it starts one. Whoever may press Run
         * may replay a delivery, and whoever may not, may not.
         */
        "POST /api/webhooks"                         to Permission.SCHEDULE_WRITE,
        "DELETE /api/webhooks/:id"                   to Permission.SCHEDULE_WRITE,
        "POST /api/webhooks/:id/enable"              to Permission.SCHEDULE_WRITE,
        "POST /api/webhooks/:id/disable"             to Permission.SCHEDULE_WRITE,
        "POST /api/webhooks/:id/rotate"              to Permission.SCHEDULE_WRITE,
        "POST /api/webhooks/:id/deliveries/:deliveryId/replay" to Permission.WORKFLOW_RUN,

        /* An event trigger is a trigger, classified with its siblings above. */
        "POST /api/event-triggers"                   to Permission.SCHEDULE_WRITE,
        "DELETE /api/event-triggers/:id"             to Permission.SCHEDULE_WRITE,
        "POST /api/event-triggers/:id/enable"        to Permission.SCHEDULE_WRITE,
        "POST /api/event-triggers/:id/disable"       to Permission.SCHEDULE_WRITE,

        /*
         * An MCP tool call starts a run, so it is WORKFLOW_RUN — the same
         * permission pressing Run in the UI needs. A key that may not run a
         * workflow must not be able to run one by asking in JSON-RPC.
         */
        "POST /api/mcp"                              to Permission.WORKFLOW_RUN,

        /*
         * Where a workspace's results go is a settings decision — it names an
         * external endpoint and stores a credential — so it sits with workspace
         * administration rather than with workflow editing.
         *
         * Redelivery is WORKFLOW_RUN: it sends a customer's data to a third
         * party, which is closer to running something than to reading it.
         */
        "POST /api/delivery-targets"                 to Permission.WORKSPACE_WRITE,
        "DELETE /api/delivery-targets/:id"           to Permission.WORKSPACE_WRITE,
        "POST /api/delivery-targets/:id/enable"      to Permission.WORKSPACE_WRITE,
        "POST /api/delivery-targets/:id/disable"     to Permission.WORKSPACE_WRITE,
        "POST /api/delivery-targets/:id/rotate-secret" to Permission.WORKSPACE_WRITE,
        "POST /api/deliveries/:id/redeliver"         to Permission.WORKFLOW_RUN,
        "DELETE /api/api-keys/:id"                   to Permission.WORKSPACE_WRITE,
        "PUT /api/workspaces/member-budget/:userId"  to Permission.WORKSPACE_WRITE,

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
        // Deleting destroys the record rather than closing it, so it sits one
        // tier above acknowledging: an incident is the evidence of an outage.
        "DELETE /api/failure-incidents/:id"              to Permission.WORKFLOW_DELETE,
        "POST /api/failure-incidents/delete-resolved"    to Permission.WORKFLOW_DELETE,
        "POST /api/incidents/dead-letters/:id/acknowledge" to Permission.RUN_CANCEL,

        // ── Connections hold credentials and blast radius: admin and up ──────
        "POST /api/connections"                      to Permission.CONNECTION_WRITE,
        "PATCH /api/connections/:id"                 to Permission.CONNECTION_WRITE,
        "DELETE /api/connections/:id"                to Permission.CONNECTION_DELETE,
        "POST /api/connections/:id/rotate-secret"    to Permission.SECRET_WRITE,
        /* A negotiated rate moves every cost figure the connection produces, and
           budget ceilings are measured against those figures — so setting one is
           a connection write, not a read dressed up as configuration. */
        "PUT /api/connections/:id/prices"            to Permission.CONNECTION_WRITE,
        /* A runner pool decides where a workflow's data is allowed to execute,
           and a token is a credential for a machine outside our network. Both
           are administrative, not authoring. */
        "POST /api/runner-pools"                     to Permission.CONNECTION_WRITE,
        "POST /api/runner-pools/:id/tokens"          to Permission.SECRET_WRITE,
        "DELETE /api/connections/:id/prices/:priceId" to Permission.CONNECTION_WRITE,
        // Testing reaches a third party with the workspace's credentials, so it
        // is a connection act rather than a read — but it changes nothing, so
        // it sits at CONNECTION_TEST rather than WRITE.
        "POST /api/connections/:id/test"             to Permission.CONNECTION_TEST,
        "POST /api/connections/test-http-request"    to Permission.CONNECTION_TEST,
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
