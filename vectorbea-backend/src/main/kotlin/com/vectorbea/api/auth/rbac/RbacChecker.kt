package com.vectorbea.api.auth.rbac

import com.sun.net.httpserver.HttpExchange
import com.vectorbea.api.http.HttpException
import com.vectorbea.api.http.requestContext
import java.util.UUID

/**
 * Asserts that the authenticated principal holds at least [minimumRole] in
 * the workspace bound to this request.
 *
 * Call this at the top of any controller handler that requires elevated
 * privileges.  If the check fails, [HttpException] is thrown and the
 * [com.vectorbea.api.http.Router] will serialise it as a JSON error response
 * before any business logic runs.
 *
 * Usage:
 * ```kotlin
 * fun create(exchange: HttpExchange) {
 *     exchange.requireWorkspaceRole(WorkspaceRole.EDITOR)
 *     // ... safe to proceed
 * }
 * ```
 *
 * Error semantics:
 * - No auth context at all          → 401 Unauthorized
 * - Authenticated but role too low  → 403 Forbidden
 */
fun HttpExchange.requireWorkspaceRole(minimumRole: WorkspaceRole) {
    val ctx = requestContext()

    // A null workspaceRole means the filter never ran (route is unprotected)
    // or the token was invalid — treat as unauthenticated.
    val actualRole = ctx.workspaceRole
        ?: throw HttpException(401, "Unauthorized")

    if (!actualRole.satisfies(minimumRole)) {
        throw HttpException(
            403,
            "Forbidden: this action requires the ${minimumRole.name} role " +
                "(caller has ${actualRole.name})"
        )
    }
}

/**
 * Returns the authenticated workspace ID, or throws 401 if unavailable.
 * Use instead of `requestContext().workspaceId!!` to get a clear error.
 */
fun HttpExchange.requireWorkspaceId() =
    requestContext().workspaceId
        ?: throw HttpException(401, "Unauthorized")

fun HttpExchange.requireUserId(): UUID =
    requestContext().userId
        ?: throw HttpException(401, "Unauthorized")
