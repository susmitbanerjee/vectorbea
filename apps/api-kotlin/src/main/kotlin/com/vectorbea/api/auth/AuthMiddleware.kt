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
    /**
     * Authenticates `vb_`-prefixed API keys. Null leaves key auth unavailable,
     * which is the correct state for a deployment that has not enabled it.
     */
    private val apiKeys: com.vectorbea.api.entitlements.ApiKeyService? = null,
) {
    private val log = LoggerFactory.getLogger(AuthMiddleware::class.java)

    /** Mirrors `ApiKeyService`'s prefix. A key is greppable in a leaked log. */
    private val API_KEY_PREFIX = "vb_"

    /** Paths that never require authentication. */
    private val publicPaths = setOf(
        "/healthz", "/health", "/metrics", "/version",
        "/api/bootstrap", "/api/network/check",
        /* Webhooks carry no JWT — a provider has no session. They are
           authenticated by SIGNATURE instead, verified before anything is stored
           (see `WebhookProcessor`), which is a stronger check than a bearer
           token because it also proves the body was not altered. */
        "/api/billing/webhooks/",
        /*
         * Tool completion callbacks, for the same reason as the billing webhooks
         * above and with a different proof.
         *
         * A video-generation service reporting that a six-minute render finished
         * has no session, no API key, and no workspace — and never will. The
         * authentication is the token in the PATH: `HMAC(server key, wait_key)`,
         * unguessable without the server key, naming exactly one wait, which
         * carries the workspace that scopes everything the route then does.
         *
         * A leaked token therefore compromises the completion of one job and
         * nothing else — it cannot read, cannot list, and cannot reach another
         * workspace. `ToolCallbackRoutes` rate-limits per token so the endpoint
         * is not a way to probe for valid ones.
         */
        "/api/tool-callbacks/",
        /*
         * Workflow webhooks. Stripe, GitHub and a customer's own service have no
         * session and never will; the 32-byte token in the path addresses one
         * endpoint and the signature over the raw body authenticates the sender.
         *
         * Unlike the billing webhooks above, the signing secret is per endpoint
         * and chosen by the customer, so a compromise reaches exactly one
         * workflow in one workspace. `WebhookRoutes` rate-limits per token, and
         * the delivery still passes the workspace's plan quota underneath —
         * an unauthenticated path into the run queue is bounded twice.
         */
        "/api/hooks/",
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

        /*
         * ── API KEY, BEFORE THE JWT PATH ────────────────────────────────────
         *
         * Distinguished by the `vb_` prefix rather than by trying the JWT first
         * and falling back: a key is not a malformed JWT, and running it through
         * the verifier would produce a misleading "invalid or expired token" for
         * a credential that is neither.
         *
         * WHAT THIS DOES NOT DO is grant anything the UI would not. The key
         * yields a principal whose `authorizedWorkspaceIds` is exactly the one
         * workspace the key names, so `RequestContext` verifies it the same way
         * it verifies a browser session, and every entitlement check downstream
         * resolves from that workspace. There is no API-specific enforcement path
         * to keep in step with the UI's, because there is no second path at all.
         */
        if (token.startsWith(API_KEY_PREFIX)) {
            val keys = apiKeys
                ?: throw ApiError.Unauthorized("API key authentication is not enabled")
            return authenticateApiKey(request, token, keys)
        }

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
            workspaceRoles         = profile.workspaceRoles,
            betaStatus             = profile.betaStatus,
            isPlatformAdmin        = profile.isPlatformAdmin || config?.isAdmin(claims.email) == true,
        )

        log.debug("[auth] authenticated sub={} betaStatus={} workspaces={}",
            claims.sub, profile.betaStatus, profile.authorizedWorkspaceIds.size)
        return request.copy(principal = principal)
    }

    /**
     * Turn a valid key into a principal scoped to exactly one workspace.
     *
     * ── THE ACTOR IS THE KEY'S, NOT A SUPERUSER ─────────────────────────────
     * A key created by a guest `acts_as` that guest, so its runs are charged to
     * that guest's member spend cap. Minting a key is therefore not a way out of
     * a budget somebody set for you — which is the whole reason `acts_as_user_id`
     * exists rather than the key simply being "the workspace".
     *
     * A key with no actor gets `appUserId = the key's own id`. That is
     * deliberate and slightly unusual: it is a stable, non-null identity that
     * belongs to no member, so the run is attributable in the audit while
     * counting against nobody's personal cap — and it can never collide with a
     * real `app_users.id`, because the two come from different tables.
     *
     * The role is `developer`: enough to run and to build, never enough to
     * change members, billing or other keys. A credential that can mint more
     * credentials is a credential that cannot be contained after a leak.
     */
    private fun authenticateApiKey(
        request: Request,
        token: String,
        keys: com.vectorbea.api.entitlements.ApiKeyService,
    ): Request {
        val resolved = keys.authenticate(token)   // throws InvalidApiKey

        val actorId = resolved.actsAsUserId ?: resolved.id
        val principal = AuthPrincipal(
            supabaseUserId         = "apikey:${resolved.id}",
            appUserId              = actorId,
            email                  = null,
            authorizedWorkspaceIds = setOf(resolved.workspaceId),
            workspaceRoles         = mapOf(resolved.workspaceId to "developer"),
            /* A key exists only inside an approved workspace — the beta gate was
               applied to the human who created it. Re-gating here would break
               every integration the moment a key outlived its creator's session. */
            betaStatus             = "approved",
            isPlatformAdmin        = false,
        )

        log.debug("[auth] authenticated api key {} for workspace {}", resolved.id, resolved.workspaceId)
        return request.copy(
            principal = principal,
            apiKeyId = resolved.id,
            apiKeyRateLimit = resolved.rateLimitPerMinute,
        )
    }

    private fun extractBearerToken(req: Request): String? {
        val header = req.header("authorization") ?: return null
        if (!header.startsWith("Bearer ", ignoreCase = true)) return null
        return header.substring(7).trim().takeIf { it.isNotEmpty() }
    }
}
