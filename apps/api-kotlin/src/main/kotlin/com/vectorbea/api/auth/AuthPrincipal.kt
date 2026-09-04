package com.vectorbea.api.auth

import java.util.UUID

/**
 * Server-side verified identity for the current request.
 * Only constructed after the Supabase JWT has been cryptographically verified.
 */
data class AuthPrincipal(
    val supabaseUserId: String,
    val appUserId: UUID,
    val email: String?,
    val authorizedWorkspaceIds: Set<UUID>,
    /** Workspace id -> role. See [AppUserRepository.UserProfile.workspaceRoles]. */
    val workspaceRoles: Map<UUID, String> = emptyMap(),
    val betaStatus: String = "waitlisted",
    val isPlatformAdmin: Boolean = false,
) {
    val isApproved: Boolean get() = betaStatus == "approved" || isPlatformAdmin
    val isDisabled: Boolean get() = betaStatus == "disabled"

    /**
     * This principal's role in [workspaceId], or null when not a member.
     *
     * Falls back to `viewer` for a membership row with an unrecognised role
     * rather than to nothing: an unknown role must mean LESS access, never a
     * bypass. A platform admin is not special-cased here — cross-tenant reach is
     * granted explicitly on the admin routes, not implicitly everywhere.
     */
    fun roleIn(workspaceId: UUID): String? =
        if (workspaceId in authorizedWorkspaceIds) (workspaceRoles[workspaceId] ?: "viewer") else null

    /** The permissions this principal holds in [workspaceId]. Empty when not a member. */
    fun permissionsIn(workspaceId: UUID): Set<Permission> =
        roleIn(workspaceId)?.let { permissionsForRole(it) } ?: emptySet()

    fun can(permission: Permission, workspaceId: UUID): Boolean =
        permission in permissionsIn(workspaceId)
}
