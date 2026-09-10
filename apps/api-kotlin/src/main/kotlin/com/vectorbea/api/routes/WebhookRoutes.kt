package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.rate.RateLimitResult
import com.vectorbea.api.rate.RateLimiter
import com.vectorbea.api.repository.PageParams
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.api.webhook.Webhook
import com.vectorbea.api.webhook.WebhookDelivery
import com.vectorbea.api.webhook.WebhookIngress
import com.vectorbea.api.webhook.WebhookRepository
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * Webhook triggers: the public endpoint, the management CRUD, and the replay.
 *
 * ── THE PUBLIC ENDPOINT IS THE UNUSUAL ONE ──────────────────────────────────
 * `POST /api/hooks/:token` has no session, no workspace header and no principal
 * — a webhook sender has none of those. The token in the path is the entire
 * addressing and authorization story, which is why it is 32 random bytes, why
 * it is never returned in a list response, and why the signature check on top
 * of it is not optional for anything that matters.
 *
 * It is also, therefore, an unauthenticated write path into the run queue. Two
 * things bound it: a per-token rate limit before the database is touched at
 * all, and the ordinary plan quota underneath, because the delivery goes
 * through [com.vectorbea.api.ingress.RunIngress] like every other ingress.
 */
class WebhookRoutes(
    private val webhooks: WebhookRepository,
    private val delivery: WebhookIngress,
    private val secrets: SecretService?,
    private val rateLimiter: RateLimiter?,
) {
    private val log = LoggerFactory.getLogger(WebhookRoutes::class.java)

    private companion object {
        /**
         * Per-token ceiling.
         *
         * High enough for a busy repository or a Shopify store at peak; low
         * enough that one misconfigured sender in a retry loop cannot fill the
         * queue. Keyed on the TOKEN rather than the IP because a sender
         * legitimately calls from many addresses, and because the bound that
         * matters is per endpoint.
         */
        const val DELIVERIES_PER_MINUTE = 600L

        /** A body larger than this is not a webhook, it is a file upload. */
        const val MAX_BODY_BYTES = 1024 * 1024

        val VALID_SCHEMES = setOf(
            "none", "hmac_sha256", "github", "stripe", "slack", "shopify", "svix")
    }

    fun register(router: Router) {
        // Public. Registered in AuthMiddleware.publicPaths.
        router.post("/api/hooks/:token", ::receive)

        // Management. Ordinary authenticated routes.
        router.get("/api/webhooks", ::list)
        router.post("/api/webhooks", ::create)
        router.get("/api/webhooks/:id", ::get)
        router.delete("/api/webhooks/:id", ::delete)
        router.post("/api/webhooks/:id/enable", ::enable)
        router.post("/api/webhooks/:id/disable", ::disable)
        router.post("/api/webhooks/:id/rotate", ::rotate)

        // The debugging surface.
        router.get("/api/webhooks/:id/deliveries", ::listDeliveries)
        router.post("/api/webhooks/:id/deliveries/:deliveryId/replay", ::replay)
    }

    // ── The public endpoint ──────────────────────────────────────────────────

    private fun receive(req: Request): Response {
        val token = req.pathParam("token")

        /*
         * Rate limit BEFORE the lookup. This endpoint is unauthenticated, so the
         * lookup is the thing an attacker would make us do a million times; and a
         * sender in a retry loop should be told to slow down without costing a
         * query per attempt.
         */
        rateLimiter?.check("hook:$token", DELIVERIES_PER_MINUTE, 60)?.let { verdict ->
            if (verdict is RateLimitResult.Exceeded) {
                throw ApiError.TooManyRequests(
                    "Too many deliveries to this webhook. Retry in " +
                        "${verdict.resetsInSeconds}s.",
                    mapOf("retryAfterSeconds" to verdict.resetsInSeconds),
                )
            }
        }

        if (req.body.toByteArray().size > MAX_BODY_BYTES) {
            throw ApiError.ValidationError(
                "The delivery body is over ${MAX_BODY_BYTES / 1024} KB. A webhook carries " +
                    "the fact that something happened; send a reference to the bulk instead."
            )
        }

        /*
         * An unknown token is a flat 404 with no detail. The token has 256 bits
         * of entropy, so enumeration is not the threat — but saying anything more
         * than "no" turns this into an oracle for whether a token that somebody
         * found in a log is still live.
         */
        val webhook = webhooks.findByToken(token) ?: throw ApiError.NotFound("Webhook")

        val outcome = delivery.deliver(
            webhook = webhook,
            rawBody = req.body,
            headers = req.headers,
        )

        return Response(
            status = outcome.httpStatus,
            body = com.vectorbea.api.http.toJson(buildMap {
                put("received", true)
                put("outcome", outcome.outcome)
                put("message", outcome.message)
                outcome.runId?.let { put("runId", it.toString()) }
                outcome.deliveryId?.let { put("deliveryId", it.toString()) }
            }),
            headers = mapOf("Content-Type" to "application/json; charset=utf-8"),
        )
    }

    // ── Management ───────────────────────────────────────────────────────────

    private data class CreateBody(
        val workflowId: String? = null,
        val name: String? = null,
        val signatureScheme: String = "hmac_sha256",
        /** The signing secret, in plaintext, exactly once. Stored encrypted. */
        val signingSecret: String? = null,
        val signatureHeader: String? = null,
        val timestampHeader: String? = null,
        val toleranceSeconds: Int = 300,
        val inputMapping: Map<String, String> = emptyMap(),
        val eventTypePath: String? = null,
        val eventTypes: List<String> = emptyList(),
        val dedupeHeader: String? = null,
        val dedupePath: String? = null,
        /**
         * A path naming the THING the run works — `alert.labels.service` — as
         * opposed to `dedupePath`/`dedupeHeader`, which name the delivery.
         *
         * The first two stop one delivery running twice. This stops two
         * different alerts about one service starting two incident runs, and
         * what happens instead is the workflow's `dedupPolicy`.
         */
        val runDedupPath: String? = null,
        /** 0–100, or absent to take the workflow's default. */
        val runPriority: Int? = null,
    )

    private fun create(req: Request): Response {
        val ctx = req.context()
        val body = req.bodyAs<CreateBody>()

        val workflowId = body.workflowId?.let {
            runCatching { UUID.fromString(it) }.getOrNull()
        } ?: throw ApiError.ValidationError("`workflowId` is required and must be a UUID.")

        if (body.runPriority != null && body.runPriority !in 0..100) {
            throw ApiError.ValidationError(
                "`runPriority` must be between 0 and 100. 0 is batch, 50 is normal, 100 is the " +
                    "priority lane; a workspace without that entitlement is clamped below it."
            )
        }

        if (body.signatureScheme !in VALID_SCHEMES) {
            throw ApiError.ValidationError(
                "`signatureScheme` must be one of ${VALID_SCHEMES.joinToString(", ")}.")
        }

        /*
         * A scheme with no secret cannot verify anything, and an endpoint that
         * silently accepts everything while the UI says it is protected is worse
         * than one that never claimed to be. `none` is the way to say "I know",
         * and it is a deliberate, recorded choice.
         */
        if (body.signatureScheme != "none" && body.signingSecret.isNullOrBlank()) {
            throw ApiError.ValidationError(
                "`signingSecret` is required for the '${body.signatureScheme}' scheme. " +
                    "Use `signatureScheme: \"none\"` to accept unsigned deliveries, which " +
                    "means anyone with the URL can start runs.")
        }

        val secretRef = body.signingSecret?.takeIf { it.isNotBlank() }?.let { plaintext ->
            val svc = secrets ?: throw ApiError.ServiceUnavailable(
                "Secrets are not configured, so a signing secret cannot be stored.")
            svc.createSecret(ctx.workspaceId, null, plaintext).ref
        }

        val hook = webhooks.create(
            workspaceId = ctx.workspaceId,
            environmentId = ctx.requireEnvironmentId(),
            workflowId = workflowId,
            name = body.name?.takeIf { it.isNotBlank() } ?: "Webhook",
            signatureScheme = body.signatureScheme,
            signingSecretRef = secretRef,
            signatureHeader = body.signatureHeader,
            timestampHeader = body.timestampHeader,
            toleranceSeconds = body.toleranceSeconds.coerceIn(0, 3_600),
            inputMapping = body.inputMapping,
            eventTypePath = body.eventTypePath,
            eventTypes = body.eventTypes,
            dedupeHeader = body.dedupeHeader,
            dedupePath = body.dedupePath,
            runDedupPath = body.runDedupPath?.takeIf { it.isNotBlank() },
            runPriority = body.runPriority?.toShort(),
            createdByUserId = req.principal?.appUserId,
        )

        log.info("[webhook] created {} for workflow {}", hook.id, workflowId)
        /* The URL is returned HERE and nowhere else. A list endpoint that
           returned it would put a live credential in every screenshot of the
           webhooks page. */
        return Response(201, com.vectorbea.api.http.toJson(
            hook.toResponse(includeUrl = true)),
            mapOf("Content-Type" to "application/json; charset=utf-8"))
    }

    private fun list(req: Request): Response {
        val ctx = req.context()
        val workflowId = req.query("workflowId")?.let {
            runCatching { UUID.fromString(it) }.getOrNull()
        }
        val items = webhooks.listForWorkspace(ctx.workspaceId, workflowId)
        return Response.ok(mapOf(
            "items" to items.map { it.toResponse(includeUrl = false) },
            "total" to items.size,
        ))
    }

    private fun get(req: Request): Response {
        val ctx = req.context()
        val hook = webhooks.findById(req.pathUUID("id"), ctx.workspaceId)
            ?: throw ApiError.NotFound("Webhook")
        return Response.ok(hook.toResponse(includeUrl = false))
    }

    private fun delete(req: Request): Response {
        val ctx = req.context()
        if (!webhooks.delete(req.pathUUID("id"), ctx.workspaceId)) {
            throw ApiError.NotFound("Webhook")
        }
        return Response.ok(mapOf("deleted" to true))
    }

    private fun enable(req: Request) = setEnabled(req, true)
    private fun disable(req: Request) = setEnabled(req, false)

    private fun setEnabled(req: Request, enabled: Boolean): Response {
        val ctx = req.context()
        if (!webhooks.setEnabled(req.pathUUID("id"), ctx.workspaceId, enabled)) {
            throw ApiError.NotFound("Webhook")
        }
        return Response.ok(mapOf("enabled" to enabled))
    }

    /**
     * Mint a new token. The old URL stops working immediately.
     *
     * No overlap, unlike an API key rotation: a webhook URL lives in exactly one
     * third-party console and the operator is looking at both screens. An
     * overlap here would just be a second live credential for longer.
     */
    private fun rotate(req: Request): Response {
        val ctx = req.context()
        val token = webhooks.rotateToken(req.pathUUID("id"), ctx.workspaceId)
            ?: throw ApiError.NotFound("Webhook")
        return Response.ok(mapOf(
            "url" to urlFor(token),
            "message" to "The previous URL stopped working. Update the sender now.",
        ))
    }

    // ── Deliveries and replay ────────────────────────────────────────────────

    private fun listDeliveries(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        webhooks.findById(id, ctx.workspaceId) ?: throw ApiError.NotFound("Webhook")

        val page = webhooks.listDeliveries(
            webhookId = id,
            workspaceId = ctx.workspaceId,
            params = PageParams(
                page = req.query("page")?.toIntOrNull()?.coerceAtLeast(1) ?: 1,
                pageSize = req.query("pageSize")?.toIntOrNull()?.coerceIn(1, 100) ?: 25,
            ),
            outcome = req.query("outcome"),
        )
        return Response.ok(com.vectorbea.api.repository.Page(
            items = page.items.map { it.toResponse() },
            total = page.total, page = page.page, pageSize = page.pageSize,
        ))
    }

    /**
     * Re-run a stored delivery.
     *
     * ── WHY THIS IS THE FEATURE, NOT A CONVENIENCE ──────────────────────────
     * The loop for getting a webhook right is: send one, see what arrived, fix
     * the mapping, send another. Without replay the second step requires asking
     * a third party to redeliver — which GitHub allows, Stripe allows for some
     * events, and most senders do not allow at all. With it, the loop is
     * entirely inside Vectorbea and takes seconds.
     *
     * The signature is not re-verified: it was verified when the delivery
     * arrived, the body is the one we stored, and the operator's own
     * authorization is what authorizes this. Re-verifying would fail every
     * timestamped scheme, because the delivery is now old on purpose.
     */
    private fun replay(req: Request): Response {
        val ctx = req.context()
        val hookId = req.pathUUID("id")
        val hook = webhooks.findById(hookId, ctx.workspaceId)
            ?: throw ApiError.NotFound("Webhook")

        val original = webhooks.findDelivery(req.pathUUID("deliveryId"), ctx.workspaceId)
            ?: throw ApiError.NotFound("Delivery")
        if (original.webhookId != hookId) throw ApiError.NotFound("Delivery")

        val body = original.bodyText ?: throw ApiError.ValidationError(
            "This delivery has no stored body, so there is nothing to replay. " +
                "Bodies over ${WebhookRepository.MAX_STORED_BODY / 1024} KB are truncated.")

        val outcome = delivery.deliver(
            webhook = hook,
            rawBody = body,
            headers = original.headers.entries.mapNotNull { (k, v) ->
                v?.let { k to it.toString() } }.toMap(),
            replayOf = original.id,
            replayedBy = req.principal?.appUserId,
        )

        log.info("[webhook] replayed delivery {} → {}", original.id, outcome.outcome)
        return Response(outcome.httpStatus, com.vectorbea.api.http.toJson(buildMap {
            put("replayed", true)
            put("outcome", outcome.outcome)
            put("message", outcome.message)
            outcome.runId?.let { put("runId", it.toString()) }
        }), mapOf("Content-Type" to "application/json; charset=utf-8"))
    }

    // ── Shapes ───────────────────────────────────────────────────────────────

    private fun Webhook.toResponse(includeUrl: Boolean): Map<String, Any?> = buildMap {
        put("id", id.toString())
        put("workflowId", workflowId.toString())
        put("name", name)
        put("signatureScheme", signatureScheme)
        put("signed", signingSecretRef != null)
        put("signatureHeader", signatureHeader)
        put("timestampHeader", timestampHeader)
        put("toleranceSeconds", toleranceSeconds)
        put("inputMapping", inputMapping)
        put("eventTypePath", eventTypePath)
        put("eventTypes", eventTypes)
        put("dedupeHeader", dedupeHeader)
        put("dedupePath", dedupePath)
        put("runDedupPath", runDedupPath)
        put("runPriority", runPriority?.toInt())
        put("enabled", enabled)
        put("createdAt", createdAt.toString())
        // The token is a live credential. It appears once, on create, and on
        // rotate — never in a list, so the webhooks page can be screenshotted.
        if (includeUrl) put("url", urlFor(token))
    }

    private fun WebhookDelivery.toResponse(): Map<String, Any?> = mapOf(
        "id" to id.toString(),
        "receivedAt" to receivedAt.toString(),
        "outcome" to outcome,
        "detail" to detail,
        "headers" to headers,
        "body" to bodyText,
        "bodyBytes" to bodyBytes,
        "eventType" to eventType,
        "dedupeKey" to dedupeKey,
        "runId" to runId?.toString(),
        "replayOfId" to replayOfId?.toString(),
        "replayable" to (bodyText != null),
    )

    /**
     * The address a sender is given.
     *
     * `PUBLIC_API_BASE_URL` is the origin the platform is reachable at. Without
     * it the path is returned alone rather than a wrong absolute URL — a
     * confidently incorrect `http://localhost:8080/...` pasted into Stripe is a
     * worse failure than a relative path somebody has to complete.
     */
    private fun urlFor(token: String): String {
        val base = System.getenv("PUBLIC_API_BASE_URL")?.trimEnd('/')
        return if (base.isNullOrBlank()) "/api/hooks/$token" else "$base/api/hooks/$token"
    }
}
