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
    private val requestedEnvironmentId: UUID? = environmentId,
) {
    /**
     * The environment this write belongs to, ALWAYS inside [workspaceId].
     *
     * THE BUG THIS CLOSES. `X-Environment-Id` used to be taken on trust and used
     * verbatim. The only endpoint that ever handed a client an environment id was
     * `GET /api/bootstrap`, which returned the OLDEST workspace's first
     * environment regardless of who asked — so every account that did not happen
     * to own that workspace was holding another tenant's environment id. Sending
     * it wrote rows with a foreign `environment_id`, which read back as an empty
     * screen; refusing to send it produced `400 X-Environment-Id header is
     * required` and the UI reported "the agent might be created in a different
     * tenant" and declined to register anything at all.
     *
     * Both halves are wrong, and both are fixed here rather than in the client:
     *
     *   - a foreign environment id is REFUSED (403) instead of written, and
     *   - a MISSING one is resolved to this workspace's own default instead of
     *     failing, so a brand-new workspace can create its first tool.
     *
     * [EnvironmentScope.resolver] is installed once at boot in `Main`. When it is
     * absent (unit tests that build a router by hand) the old header-only
     * behaviour stands, so nothing that used to work stops working.
     */
    fun requireEnvironmentId(): UUID {
        val resolve = EnvironmentScope.resolver
            ?: return requestedEnvironmentId
                ?: throw ApiError.ValidationError("X-Environment-Id header is required")
        return resolve(workspaceId, requestedEnvironmentId)
    }
}

/**
 * Workspace-scoped environment resolution, installed once at boot.
 *
 * A global rather than a constructor parameter for the same reason
 * `Router.authorize` is one: the alternative is threading an
 * `EnvironmentRepository` through all twenty-odd route classes, and a rule that
 * has to be re-wired at every call site is a rule that gets missed at one.
 */
object EnvironmentScope {
    /**
     * `(workspaceId, requestedEnvironmentId) -> environmentId`.
     *
     * Must throw [ApiError.Forbidden] when the requested id belongs to another
     * workspace, and must return this workspace's default when it is null.
     */
    @Volatile
    var resolver: ((UUID, UUID?) -> UUID)? = null
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

    // Environments are a legacy storage partition, not request scope. Keep a
    // well-formed legacy value available only to hand-built route tests whose
    // router has no server-side resolver; production reads are always scoped
    // by the verified workspace and production writes resolve their partition
    // from that workspace.
    val envRaw = header("x-environment-id") ?: query("environmentId")
    val requestedEnvironmentId = envRaw?.trim()?.let {
        runCatching { UUID.fromString(it) }.getOrNull()
    }

    return RequestContext(
        workspaceId = workspaceId,
        environmentId = null,
        requestedEnvironmentId = requestedEnvironmentId,
    )
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
