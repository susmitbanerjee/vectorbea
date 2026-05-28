package com.vectorbea.api.api

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.repository.PageParams
import java.util.UUID

/**
 * Per-request workspace + environment scope parsed from HTTP headers.
 *
 * Every endpoint that touches workspace data requires:
 *   X-Workspace-Id:   UUID of the calling workspace
 *   X-Environment-Id: UUID of the environment within that workspace (optional for some list ops)
 *
 * These headers replace authentication until a real auth layer is wired.
 * All repository queries are scoped to [workspaceId] — cross-workspace access
 * is prevented at the query level (every SQL has `AND workspace_id = ?`).
 */
data class RequestContext(
    val workspaceId: UUID,
    val environmentId: UUID?,
) {
    /** Throws [ApiError.ValidationError] if [environmentId] is null. */
    fun requireEnvironmentId(): UUID = environmentId
        ?: throw ApiError.ValidationError("X-Environment-Id header is required")
}

/**
 * Parse workspace + environment UUIDs from HTTP headers.
 * For SSE endpoints (where browsers cannot send custom headers via EventSource),
 * falls back to query parameters `workspaceId` and `environmentId`.
 */
fun Request.context(): RequestContext {
    // Header takes priority; query param is the SSE fallback
    val wsRaw = header("x-workspace-id")
        ?: query("workspaceId")
        ?: throw ApiError.ValidationError("X-Workspace-Id header (or workspaceId query param) is required")
    val workspaceId = wsRaw.toUUIDOrError("X-Workspace-Id")

    val envRaw = header("x-environment-id") ?: query("environmentId")
    val environmentId = envRaw?.toUUIDOrError("X-Environment-Id")

    return RequestContext(workspaceId = workspaceId, environmentId = environmentId)
}

/** Parse [PageParams] from `limit` + `offset` query params (default: limit=50, offset=0). */
fun Request.pageParams(defaultLimit: Int = 50, maxLimit: Int = 100): PageParams {
    val limit = query("limit")?.toIntOrNull()?.coerceIn(1, maxLimit) ?: defaultLimit
    val offset = query("offset")?.toIntOrNull()?.coerceAtLeast(0) ?: 0
    // PageParams uses page/pageSize internally; adapt from flat offset
    val page = if (limit > 0) offset / limit + 1 else 1
    return PageParams(page = page, pageSize = limit)
}

private fun String.toUUIDOrError(fieldName: String): UUID = try {
    UUID.fromString(this.trim())
} catch (_: IllegalArgumentException) {
    throw ApiError.ValidationError("$fieldName must be a valid UUID, got: $this")
}

/** Parse a path param as a UUID or throw 400. */
fun Request.pathUUID(name: String): UUID {
    val raw = pathParam(name)
    return try {
        UUID.fromString(raw)
    } catch (_: IllegalArgumentException) {
        throw ApiError.ValidationError("Path parameter '$name' must be a valid UUID, got: $raw")
    }
}
