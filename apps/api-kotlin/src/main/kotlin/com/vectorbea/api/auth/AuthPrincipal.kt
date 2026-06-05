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
    val betaStatus: String = "waitlisted",
    val isPlatformAdmin: Boolean = false,
) {
    val isApproved: Boolean get() = betaStatus == "approved" || isPlatformAdmin
    val isDisabled: Boolean get() = betaStatus == "disabled"
}
