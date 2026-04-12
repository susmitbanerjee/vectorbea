package com.vectorbea.api.http

import com.vectorbea.api.auth.rbac.WorkspaceRole
import java.util.UUID

/**
 * Immutable bag of security principals attached to every inbound request by
 * [com.vectorbea.api.auth.AuthFilter].
 *
 * After the schema migration from flat-org to Org -> Workspace:
 * - [workspaceId] is the authoritative scope for engineering assets.
 * - [workspaceRole] is the privilege level of the presenting API key.
 * - [userId] is the authenticated end-user when the caller forwards it.
 * - [organizationId] is retained as a denormalized pointer for billing lookups.
 *
 * All fields are null on unauthenticated routes.
 */
data class RequestContext(
    val workspaceId: UUID? = null,
    val workspaceRole: WorkspaceRole? = null,
    val userId: UUID? = null,
    val organizationId: UUID? = null,
)
