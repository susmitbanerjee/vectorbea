package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.api.requireField
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.runner.RunnerReport
import com.vectorbea.api.runner.RunnerStore
import java.time.Instant
import java.util.UUID

/**
 * Managing runner pools, from the customer's side of the browser.
 *
 * ── THE OPERATOR QUESTIONS THIS SURFACE ANSWERS ─────────────────────────────
 * A self-hosted runner is a thing a customer deploys into infrastructure we
 * cannot see, and when it does not work the failure is invisible from both
 * ends: their runs sit queued, and we have nothing to tell them because the
 * process that should have picked them up never connected. So the pool listing
 * carries two counts — live runners and queued runs — and "0 live, 40 queued"
 * is the whole diagnosis.
 */
class RunnerPoolRoutes(
    private val runners: RunnerStore,
    private val audit: com.vectorbea.api.audit.AuditLog? = null,
) {

    fun register(router: Router) {
        router.get("/api/runner-pools", ::list)
        router.post("/api/runner-pools", ::create)
        router.post("/api/runner-pools/:id/tokens", ::mintToken)
    }

    private data class CreatePoolBody(
        val name: String? = null,
        val location: String? = null,
        /** `strict` (default) or `metadata_plus_errors`. */
        val payloadPolicy: String? = null,
    )

    private fun list(req: Request): Response {
        val ctx = req.context()
        return Response.ok(mapOf("items" to runners.listPools(ctx.workspaceId)))
    }

    private fun create(req: Request): Response {
        val ctx = req.context()
        val body = req.bodyAs<CreatePoolBody>()
        val name = requireField(body.name, "name").trim()
        if (name.isEmpty() || name.length > 120) {
            throw ApiError.ValidationError("`name` must be between 1 and 120 characters.")
        }

        val policy = (body.payloadPolicy ?: "strict").lowercase().trim()
        if (policy !in POLICIES) {
            throw ApiError.ValidationError(
                "`payloadPolicy` must be one of ${POLICIES.joinToString(", ")}. `strict` keeps " +
                    "everything inside your network. `metadata_plus_errors` additionally sends " +
                    "us sanitized error text, which makes a failed run supportable — and is a " +
                    "real widening, because an error message can carry a fragment of the data " +
                    "that caused it."
            )
        }

        val slug = name.lowercase().replace(Regex("[^a-z0-9]+"), "-").trim('-')
            .ifBlank { "pool" }.take(80)

        val id = runners.createPool(
            workspaceId = ctx.workspaceId,
            name = name,
            slug = "$slug-${UUID.randomUUID().toString().take(6)}",
            locationLabel = body.location?.take(120),
            payloadPolicy = policy,
            createdBy = req.principal?.appUserId,
        )

        audit?.recordUserAction(
            req, ctx.workspaceId,
            com.vectorbea.api.audit.AuditLog.Action.CONNECTION_UPDATE,
            targetType = "runner_pool", targetId = id,
            after = mapOf("name" to name, "payloadPolicy" to policy),
        )

        return Response(201, com.vectorbea.api.http.toJson(mapOf(
            "id" to id.toString(),
            "name" to name,
            "payloadPolicy" to policy,
            "nextStep" to "Mint a token for this pool, then start a runner with " +
                "VECTORBEA_RUNNER_TOKEN set to it. Nothing will execute in this pool until a " +
                "runner connects.",
        )), mapOf("Content-Type" to "application/json; charset=utf-8"))
    }

    private data class TokenBody(val name: String? = null, val expiresInDays: Int? = null)

    /**
     * Mint a token. The secret is shown ONCE.
     *
     * Not because it is fashionable: this token is destined for a config file or
     * a Kubernetes secret in infrastructure we cannot see, and a value we can
     * re-display is a value sitting in our database in a form somebody can read
     * off a support call.
     */
    private fun mintToken(req: Request): Response {
        val ctx = req.context()
        val poolId = req.pathUUID("id")
        val body = req.bodyAs<TokenBody>()

        val name = (body.name ?: "runner token").trim().take(120)
        val expiresAt = body.expiresInDays
            ?.coerceIn(1, 3650)
            ?.let { Instant.now().plusSeconds(it * 86_400L) }

        val minted = runners.mintToken(
            workspaceId = ctx.workspaceId,
            poolId = poolId,
            name = name,
            expiresAt = expiresAt,
            createdBy = req.principal?.appUserId,
        )

        audit?.recordUserAction(
            req, ctx.workspaceId,
            com.vectorbea.api.audit.AuditLog.Action.CONNECTION_UPDATE,
            targetType = "runner_token", targetId = minted.id,
            after = mapOf("poolId" to poolId.toString(), "prefix" to minted.prefix),
        )

        return Response(201, com.vectorbea.api.http.toJson(mapOf(
            "id" to minted.id.toString(),
            "prefix" to minted.prefix,
            /* The only time this value exists outside the runner's config. */
            "token" to minted.secret,
            "expiresAt" to expiresAt?.toString(),
            "warning" to "This is the only time the token is shown. Store it where your runner " +
                "will read it; if it is lost, mint another and revoke this one.",
        )), mapOf("Content-Type" to "application/json; charset=utf-8"))
    }

    private companion object {
        val POLICIES = setOf(
            RunnerReport.PayloadPolicy.STRICT.wire,
            RunnerReport.PayloadPolicy.METADATA_PLUS_ERRORS.wire,
        )
    }
}
