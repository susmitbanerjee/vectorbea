package com.vectorbea.api.auth

import java.util.UUID

/**
 * Server-side verified identity for the current request.
 *
 * This is ONLY constructed after the Supabase JWT has been cryptographically
 * verified by [JwtVerifier].  Values in this object are authoritative.
 *
 * [authorizedWorkspaceIds] is loaded from the database (workspace_members table)
 * and represents the set of workspaces this user is permitted to access.
 * The client-supplied X-Workspace-Id header is checked against this set before
 * any data is returned.
 */
data class AuthPrincipal(
    /** Supabase user ID — from verified JWT `sub` claim. */
    val supabaseUserId: String,
    /** Internal app user ID (UUID primary key of app_users table). */
    val appUserId: UUID,
    /** User email — from verified JWT. */
    val email: String?,
    /** Workspace IDs this user is authorized to access (loaded from workspace_members). */
    val authorizedWorkspaceIds: Set<UUID>,
)
