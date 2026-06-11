package com.vectorbea.api.api

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.repository.PageParams
import java.util.UUID

/**
 * Per-request workspace + environment scope, derived from verified auth.
 *
 * When the request carries a verified AuthPrincipal (JWT-authenticated):
 *   - The requested X-Workspace-Id is VERIFIED against authorizedWorkspaceIds.
 *   - Wrong workspace -> HTTP 403 Forbidden.
 *   - Single workspace and no header present -> auto-selected.
 *
 * When there is no principal (local dev / no SUPABASE_URL configured):
 *   - The workspace header is trusted as-is.
 *
 * All repository queries must receive workspaceId from this object.
 * NEVER pass a workspace ID from user input without going through this context.
 */
data class RequestContext(
    val workspaceId: UUID,
    val environmentId: UUID?,
) {
    fun requireEnvironmentId(): UUID = environmentId
        ?: throw ApiError.ValidationError("X-Environment-Id header is required")
}

fun Request.context(): RequestContext {
    val principal = this.principal

    val wsRaw: String? = header("x-workspace-id") ?: query("workspaceId")

    val workspaceId: UUID = if (principal != null) {
        // JWT-authenticated: verify workspace against authorized memberships
        if (wsRaw != null) {
            val requested = wsRaw.toUUIDOrError("X-Workspace-Id")
            if (requested !in principal.authorizedWorkspaceIds) {
                throw ApiError.Forbidden(
                    "You are not a member of workspace $wsRaw"
                )
            }
            requested
        } else {
            when (principal.authorizedWorkspaceIds.size) {
                0 -> throw ApiError.Forbidden("Your account has no workspace memberships")
                1 -> principal.authorizedWorkspaceIds.first()
                else -> throw ApiError.ValidationError(
                    "X-Workspace-Id header is required when your account belongs to multiple workspaces"
                )
            }
        }
    } else {
        // Dev / auth-disabled: trust header directly
        wsRaw?.toUUIDOrError("X-Workspace-Id")
            ?: throw ApiError.ValidationError(
                "X-Workspace-Id header (or workspaceId query param) is required"
            )
    }

    val envRaw = header("x-environment-id") ?: query("environmentId")
    val environmentId = envRaw?.toUUIDOrError("X-Environment-Id")

    return RequestContext(workspaceId = workspaceId, environmentId = environmentId)
}

fun Request.pageParams(defaultLimit: Int = 50, maxLimit: Int = 100): PageParams {
    val limit = query("limit")?.toIntOrNull()?.coerceIn(1, maxLimit) ?: defaultLimit
    val offset = query("offset")?.toIntOrNull()?.coerceAtLeast(0) ?: 0
    val page = if (limit > 0) offset / limit + 1 else 1
    return PageParams(page = page, pageSize = limit)
}

private fun String.toUUIDOrError(fieldName: String): UUID = try {
    UUID.fromString(this.trim())
} catch (_: IllegalArgumentException) {
    throw ApiError.ValidationError("$fieldName must be a valid UUID, got: $this")
}

fun Request.pathUUID(name: String): UUID {
    val raw = pathParam(name)
    return try {
        UUID.fromString(raw)
    } catch (_: IllegalArgumentException) {
        throw ApiError.ValidationError("Path parameter '$name' must be a valid UUID, got: $raw")
    }
}
