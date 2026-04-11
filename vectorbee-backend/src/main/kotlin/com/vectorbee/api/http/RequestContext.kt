package com.vectorbee.api.http

import com.vectorbee.api.auth.rbac.WorkspaceRole
import java.util.UUID

/**
 * Immutable bag of security principals attached to every inbound request by
 * [com.vectorbee.api.auth.AuthFilter].
 *
 * After the schema migration from flat-org to Org → Workspace:
 * - [workspaceId]   is the authoritative scope for all engineering assets.
 * - [workspaceRole] is the privilege level of the presenting API key.
 * - [organizationId] is retained as a read-only denormalized pointer for
 *   billing / org-level queries; it is NOT used for access-control decisions.
 *
 * All three fields are null on unauthenticated (public) routes.
 */
data class RequestContext(
    val workspaceId: UUID? = null,
    val workspaceRole: WorkspaceRole? = null,
    // Kept for billing lookups — do not gate on this for security checks.
    val organizationId: UUID? = null,
)
