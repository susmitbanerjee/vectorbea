package com.vectorbea.api.auth

import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.users.AppUserRepository
import org.slf4j.LoggerFactory

/**
 * Pre-routing authentication middleware.
 *
 * Called by [com.vectorbea.api.http.HttpServer] for every incoming request BEFORE
 * the router dispatches to a handler.
 *
 * When [jwtVerifier] is non-null (production / Supabase configured):
 *   1. Extracts `Authorization: Bearer <token>` header.
 *   2. Verifies the Supabase JWT — signature, expiry, issuer.
 *   3. Upserts the user in `app_users` and loads their `workspace_members`.
 *   4. Attaches an [AuthPrincipal] to the request.
 *
 * When [jwtVerifier] is null (local dev, no SUPABASE_URL configured):
 *   - Auth is bypassed.
 *   - The request proceeds without a principal.
 *   - `RequestContext.context()` then falls back to trusting the X-Workspace-Id header.
 *
 * Public paths (health, metrics, version) are always allowed without authentication.
 */
class AuthMiddleware(
    private val jwtVerifier: JwtVerifier?,
    private val userRepo: AppUserRepository?,
    private val config: AppConfig? = null,
) {
    private val log = LoggerFactory.getLogger(AuthMiddleware::class.java)

    /** Paths that never require authentication. */
    private val publicPaths = setOf(
        "/healthz", "/health", "/metrics", "/version",
        "/api/bootstrap", "/api/network/check",
    )

    /**
     * Authenticate the request.
     *
     * @return The request with [Request.principal] set if auth succeeded, or the
     *         original request unchanged if auth is disabled.
     * @throws ApiError.Unauthorized if a token is required but missing or invalid.
     */
    fun authenticate(request: Request): Request {
        // Always skip auth for public paths
        if (request.path in publicPaths || publicPaths.any { request.path.startsWith(it) }) {
            return request
        }

        if (jwtVerifier == null || userRepo == null) {
            // Auth disabled — dev/local mode
            return request
        }

        val token = extractBearerToken(request)
            ?: throw ApiError.Unauthorized(
                "Authorization: Bearer <supabase_access_token> header is required"
            )

        // Verify JWT — throws AuthException (→ 401) on any verification failure
        val claims = try {
            jwtVerifier.verify(token)
        } catch (e: AuthException) {
            log.warn("[auth] JWT verification failed: {}", e.message)
            throw ApiError.Unauthorized("Invalid or expired token")
        }

        // Upsert user + load workspace memberships from database
        val profile = try {
            userRepo.resolveUser(
                supabaseUserId = claims.sub,
                email          = claims.email,
                fullName       = claims.fullName,
                avatarUrl      = claims.avatarUrl,
            )
        } catch (e: Exception) {
            log.error("[auth] Failed to resolve user sub={}: {}", claims.sub, e.message)
            throw ApiError.Unauthorized("Failed to resolve user identity")
        }

        val principal = AuthPrincipal(
            supabaseUserId         = claims.sub,
            appUserId              = profile.id,
            email                  = claims.email,
            authorizedWorkspaceIds = profile.authorizedWorkspaceIds,
            betaStatus             = profile.betaStatus,
            isPlatformAdmin        = profile.isPlatformAdmin || config?.isAdmin(claims.email) == true,
        )

        log.debug("[auth] authenticated sub={} betaStatus={} workspaces={}",
            claims.sub, profile.betaStatus, profile.authorizedWorkspaceIds.size)
        return request.copy(principal = principal)
    }

    private fun extractBearerToken(req: Request): String? {
        val header = req.header("authorization") ?: return null
        if (!header.startsWith("Bearer ", ignoreCase = true)) return null
        return header.substring(7).trim().takeIf { it.isNotEmpty() }
    }
}
