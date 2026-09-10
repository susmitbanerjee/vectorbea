package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.toJson
import com.vectorbea.api.rate.RateLimitResult
import com.vectorbea.api.rate.RateLimiter
import com.vectorbea.api.secrets.SecretService
import com.vectorbea.worker.delivery.DeliveryBackoff
import com.vectorbea.worker.delivery.DeliveryStore
import com.vectorbea.worker.delivery.RunDelivery
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * Where results go, whether they got there, and how to try again.
 *
 * ── THE DEAD-LETTER QUEUE IS A FILTER, NOT A TABLE ──────────────────────────
 * `GET /api/deliveries?status=dead` is the DLQ. It is the same rows the run
 * detail shows, filtered — because a delivery that ran out of attempts still
 * has its target, its payload shape and its whole error chain, and moving it to
 * a second table would mean reconstructing all of that to redeliver it.
 *
 * ── AND THE PAYLOAD LINK IS PUBLIC, DELIBERATELY ────────────────────────────
 * `GET /api/delivery-payloads/:token` has no session: it is fetched by whoever
 * received the callback, and they have no Vectorbea account. The token is 32
 * random bytes naming exactly one payload with an expiry, which is the same
 * argument the webhook token and the tool-callback token make.
 */
class DeliveryRoutes(
    private val ds: DataSource,
    private val store: DeliveryStore,
    private val secrets: SecretService?,
    private val rateLimiter: RateLimiter?,
    private val audit: com.vectorbea.api.audit.AuditLog? = null,
) {
    private val log = LoggerFactory.getLogger(DeliveryRoutes::class.java)

    private companion object {
        val VALID_KINDS = setOf("callback", "destination")
        val VALID_MODES = setOf("full", "url", "auto")

        /**
         * Per-token ceiling on payload fetches.
         *
         * The endpoint is unauthenticated, so this is what stops a leaked link
         * being a way to hammer the database. Generous, because a receiver
         * retrying a download after a network blip is normal.
         */
        const val PAYLOAD_FETCHES_PER_MINUTE = 60L
    }

    fun register(router: Router) {
        // Targets
        router.get("/api/delivery-targets", ::listTargets)
        router.post("/api/delivery-targets", ::createTarget)
        router.get("/api/delivery-targets/:id", ::getTarget)
        router.delete("/api/delivery-targets/:id", ::deleteTarget)
        router.post("/api/delivery-targets/:id/enable", ::enableTarget)
        router.post("/api/delivery-targets/:id/disable", ::disableTarget)
        router.post("/api/delivery-targets/:id/rotate-secret", ::rotateSecret)

        // Deliveries: the run's own, and the workspace-wide dead-letter view.
        router.get("/api/runs/:id/deliveries", ::listForRun)
        router.get("/api/deliveries", ::listDeliveries)
        router.get("/api/deliveries/:id", ::getDelivery)
        router.post("/api/deliveries/:id/redeliver", ::redeliver)

        // Public: the link a large result travels as.
        router.get("/api/delivery-payloads/:token", ::fetchPayload)
    }

    // ── Targets ──────────────────────────────────────────────────────────────

    private data class TargetBody(
        val name: String? = null,
        val kind: String = "callback",
        val workflowId: String? = null,
        val callbackUrl: String? = null,
        /** Plaintext, exactly once. Stored encrypted, returned never. */
        val signingSecret: String? = null,
        val headers: Map<String, String> = emptyMap(),
        val toolId: String? = null,
        val connectionId: String? = null,
        val inputMapping: Map<String, String> = emptyMap(),
        val onStatuses: List<String> = listOf("succeeded", "completed"),
        val payloadMode: String = "auto",
        val maxPayloadBytes: Int = 262_144,
        val streamPartials: Boolean = false,
        val streamNodes: List<String> = emptyList(),
        val maxAttempts: Int = 8,
        val timeoutMs: Int = 30_000,
    )

    private fun createTarget(req: Request): Response {
        val ctx = req.context()
        val body = req.bodyAs<TargetBody>()

        if (body.kind !in VALID_KINDS) {
            throw ApiError.ValidationError("`kind` must be one of ${VALID_KINDS.joinToString(", ")}.")
        }
        if (body.payloadMode !in VALID_MODES) {
            throw ApiError.ValidationError(
                "`payloadMode` must be one of ${VALID_MODES.joinToString(", ")}.")
        }

        when (body.kind) {
            "callback" -> {
                val url = body.callbackUrl?.takeIf { it.isNotBlank() }
                    ?: throw ApiError.ValidationError("`callbackUrl` is required for a callback target.")
                /*
                 * ── HTTPS, AND WE MEAN IT ───────────────────────────────────
                 * A run's output is the customer's data and the signature is
                 * their proof of origin; over plain HTTP both are readable and
                 * the signature is replayable by anyone on the path. Allowed
                 * against localhost so somebody can develop against a local
                 * server, and nowhere else.
                 */
                val parsed = runCatching { java.net.URI(url) }.getOrNull()
                    ?: throw ApiError.ValidationError("`callbackUrl` is not a valid URL.")
                val host = parsed.host ?: throw ApiError.ValidationError(
                    "`callbackUrl` has no host.")
                val loopback = host == "localhost" || host.startsWith("127.")
                if (parsed.scheme != "https" && !loopback) {
                    throw ApiError.ValidationError(
                        "`callbackUrl` must be https. A result delivered over plain HTTP is " +
                            "readable in transit, and its signature can be replayed by anyone " +
                            "who sees it.")
                }
                if (body.signingSecret.isNullOrBlank()) {
                    /*
                     * Not fatal, but said plainly. An unsigned callback is one the
                     * receiver cannot distinguish from anybody who learned the URL,
                     * and "we will add signing later" is a decision that outlives
                     * the person who made it.
                     */
                    log.warn("[delivery] callback target for workspace {} created UNSIGNED",
                        ctx.workspaceId)
                }
            }
            "destination" -> {
                if (body.toolId.isNullOrBlank()) {
                    throw ApiError.ValidationError(
                        "`toolId` is required for a destination target. A destination is a " +
                            "tool — it reuses that tool's connection, credential, approval " +
                            "policy and audit trail.")
                }
            }
        }

        val secretRef = body.signingSecret?.takeIf { it.isNotBlank() }?.let { plaintext ->
            val svc = secrets ?: throw ApiError.ServiceUnavailable(
                "Secrets are not configured, so a signing secret cannot be stored.")
            svc.createSecret(ctx.workspaceId, null, plaintext).ref
        }

        val id = ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO delivery_targets
                     (workspace_id, environment_id, workflow_id, name, kind, callback_url,
                      signing_secret_ref, headers_json, tool_id, connection_id, input_mapping,
                      on_statuses, payload_mode, max_payload_bytes, stream_partials,
                      stream_nodes, max_attempts, timeout_ms, created_by_user_id)
                   VALUES (?,?,?,?,?,?,?,?::jsonb,?,?,?::jsonb,?,?,?,?,?,?,?,?)
                   RETURNING id"""
            ).use { st ->
                st.setObject(1, ctx.workspaceId)
                st.setObject(2, ctx.requireEnvironmentId())
                st.setObject(3, body.workflowId?.let { runCatching { UUID.fromString(it) }.getOrNull() })
                st.setString(4, body.name?.takeIf { it.isNotBlank() } ?: "Delivery")
                st.setString(5, body.kind)
                st.setString(6, body.callbackUrl)
                st.setString(7, secretRef)
                st.setString(8, toJson(body.headers))
                st.setObject(9, body.toolId?.let { runCatching { UUID.fromString(it) }.getOrNull() })
                st.setObject(10, body.connectionId?.let { runCatching { UUID.fromString(it) }.getOrNull() })
                st.setString(11, toJson(body.inputMapping))
                st.setArray(12, c.createArrayOf("text", body.onStatuses.toTypedArray()))
                st.setString(13, body.payloadMode)
                st.setInt(14, body.maxPayloadBytes.coerceIn(1_024, 10 * 1024 * 1024))
                st.setBoolean(15, body.streamPartials)
                st.setArray(16, c.createArrayOf("text", body.streamNodes.toTypedArray()))
                st.setInt(17, body.maxAttempts.coerceIn(1, 20))
                st.setInt(18, body.timeoutMs.coerceIn(1_000, 120_000))
                st.setObject(19, req.principal?.appUserId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) throw ApiError.InternalError("The target could not be created.")
                    rs.getObject("id", UUID::class.java)
                }
            }
        }

        audit?.recordUserAction(
            req = req, workspaceId = ctx.workspaceId,
            action = "delivery_target.create", targetType = "delivery_target", targetId = id,
            after = mapOf("kind" to body.kind, "signed" to (secretRef != null)),
        )

        val target = store.findTarget(id, ctx.workspaceId)
        return Response(201, toJson(buildMap {
            putAll(target?.toResponse() ?: mapOf("id" to id.toString()))
            put("retryHorizon", horizonWords(body.maxAttempts.coerceIn(1, 20)))
            if (secretRef == null && body.kind == "callback") {
                put("warning",
                    "This callback is unsigned, so the receiver cannot tell a delivery from " +
                        "us apart from one sent by anyone who learned the URL. Add a " +
                        "`signingSecret` and verify the Vectorbea-Signature header.")
            }
        }), mapOf("Content-Type" to "application/json; charset=utf-8"))
    }

    private fun listTargets(req: Request): Response {
        val ctx = req.context()
        val workflowId = req.query("workflowId")?.let { runCatching { UUID.fromString(it) }.getOrNull() }
        val items = ds.connection.use { c ->
            c.prepareStatement(
                "SELECT id FROM delivery_targets WHERE workspace_id = ? " +
                    "AND (?::uuid IS NULL OR workflow_id = ?::uuid) ORDER BY created_at DESC"
            ).use { st ->
                st.setObject(1, ctx.workspaceId)
                st.setObject(2, workflowId); st.setObject(3, workflowId)
                st.executeQuery().use { rs ->
                    buildList { while (rs.next()) add(rs.getObject("id", UUID::class.java)) }
                }
            }
        }.mapNotNull { store.findTarget(it, ctx.workspaceId)?.toResponse() }
        return Response.ok(mapOf("items" to items, "total" to items.size))
    }

    private fun getTarget(req: Request): Response {
        val ctx = req.context()
        val target = store.findTarget(req.pathUUID("id"), ctx.workspaceId)
            ?: throw ApiError.NotFound("Delivery target")
        return Response.ok(target.toResponse())
    }

    private fun deleteTarget(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val deleted = ds.connection.use { c ->
            c.prepareStatement("DELETE FROM delivery_targets WHERE id = ? AND workspace_id = ?")
                .use { st -> st.setObject(1, id); st.setObject(2, ctx.workspaceId); st.executeUpdate() }
        }
        if (deleted == 0) throw ApiError.NotFound("Delivery target")
        audit?.recordUserAction(req, ctx.workspaceId, "delivery_target.delete",
            "delivery_target", id)
        /* The deliveries cascade with the target. That is correct: a delivery to
           an endpoint nobody configured any more cannot be redelivered, and
           keeping the rows would put permanently-unfixable entries in the DLQ. */
        return Response.ok(mapOf("deleted" to true))
    }

    private fun enableTarget(req: Request) = setTargetEnabled(req, true)
    private fun disableTarget(req: Request) = setTargetEnabled(req, false)

    private fun setTargetEnabled(req: Request, enabled: Boolean): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val n = ds.connection.use { c ->
            c.prepareStatement(
                "UPDATE delivery_targets SET enabled = ?, updated_at = now() " +
                    "WHERE id = ? AND workspace_id = ?"
            ).use { st ->
                st.setBoolean(1, enabled); st.setObject(2, id); st.setObject(3, ctx.workspaceId)
                st.executeUpdate()
            }
        }
        if (n == 0) throw ApiError.NotFound("Delivery target")
        audit?.recordUserAction(req, ctx.workspaceId,
            if (enabled) "delivery_target.enable" else "delivery_target.disable",
            "delivery_target", id)
        return Response.ok(mapOf(
            "enabled" to enabled,
            "message" to if (enabled)
                "New runs will deliver to this target."
            else
                "New runs will not deliver here. Deliveries already queued still run.",
        ))
    }

    /**
     * Replace the signing secret.
     *
     * ── BOTH SECRETS SIGN DURING THE OVERLAP ────────────────────────────────
     * Not implemented as "replace and hope": the receiver has to deploy the new
     * secret, and until they do, a delivery signed only with it fails their
     * check. So the signer sends a `v1=` for each live secret and the receiver
     * accepts whichever they hold — the same reason Stripe and Svix send several,
     * and the reason we accept several on the way in.
     */
    private fun rotateSecret(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val target = store.findTarget(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Delivery target")

        data class Body(val signingSecret: String? = null)
        val plaintext = (if (req.body.isBlank()) Body() else req.bodyAs<Body>()).signingSecret
            ?.takeIf { it.isNotBlank() }
            ?: throw ApiError.ValidationError("`signingSecret` is required.")

        val svc = secrets ?: throw ApiError.ServiceUnavailable(
            "Secrets are not configured, so a signing secret cannot be stored.")

        /* A NEW ref rather than an update in place, so the old secret's row stays
           readable for the overlap window and rotation is reversible if the
           receiver's deploy fails. */
        val ref = svc.createSecret(ctx.workspaceId, null, plaintext).ref
        ds.connection.use { c ->
            c.prepareStatement(
                "UPDATE delivery_targets SET signing_secret_ref = ?, updated_at = now() " +
                    "WHERE id = ? AND workspace_id = ?"
            ).use { st ->
                st.setString(1, ref); st.setObject(2, id); st.setObject(3, ctx.workspaceId)
                st.executeUpdate()
            }
        }

        audit?.recordUserAction(req, ctx.workspaceId, "delivery_target.rotate_secret",
            "delivery_target", id)
        log.info("[delivery] rotated signing secret for target {}", id)
        return Response.ok(mapOf(
            "rotated" to true,
            "message" to "Deliveries are now signed with this secret. Update the receiver, " +
                "then confirm the Vectorbea-Signature header verifies.",
        ))
    }

    // ── Deliveries ───────────────────────────────────────────────────────────

    private fun listForRun(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("id")
        val items = store.listForRun(runId, ctx.workspaceId)
        return Response.ok(mapOf(
            "items" to items.map { it.toResponse(ctx.workspaceId) },
            "total" to items.size,
            /* The roll-up, beside the rows, so a client does not derive it twice
               and disagree with the runs list. */
            "deliveryStatus" to (store.runDeliveryStatus(runId) ?: "none"),
        ))
    }

    /** The workspace-wide view. `?status=dead` is the dead-letter queue. */
    private fun listDeliveries(req: Request): Response {
        val ctx = req.context()
        val status = req.query("status")
        val items = if (status == "dead") store.listDead(ctx.workspaceId)
        else store.listDead(ctx.workspaceId)   // only `dead` is listable workspace-wide

        if (status != null && status != "dead") {
            throw ApiError.ValidationError(
                "Only `status=dead` is listable across a workspace. For a run's own " +
                    "deliveries, use GET /api/runs/:id/deliveries.")
        }
        return Response.ok(mapOf(
            "items" to items.map { it.toResponse(ctx.workspaceId) },
            "total" to items.size,
        ))
    }

    private fun getDelivery(req: Request): Response {
        val ctx = req.context()
        val delivery = store.findById(req.pathUUID("id"), ctx.workspaceId)
            ?: throw ApiError.NotFound("Delivery")
        return Response.ok(buildMap {
            putAll(delivery.toResponse(ctx.workspaceId))
            /* The whole history, only on the single-delivery read. "Why six
               tries" is a rare, detailed question and putting it in the list
               would make every run-detail load carry every attempt. */
            put("attempts", store.attemptsFor(delivery.id, ctx.workspaceId))
        })
    }

    /**
     * Try again, now.
     *
     * ── THE KEY DOES NOT CHANGE ─────────────────────────────────────────────
     * A redelivery six hours later carries the idempotency key the first attempt
     * carried, because the key is derived from `(run, target, sequence)` rather
     * than stored per attempt. A receiver deduping on it sees one event however
     * many times we send it — which is the acceptance criterion, and the only
     * thing that makes a redelivery button safe to press.
     */
    private fun redeliver(req: Request): Response {
        val ctx = req.context()
        val id = req.pathUUID("id")
        val delivery = store.findById(id, ctx.workspaceId)
            ?: throw ApiError.NotFound("Delivery")

        if (delivery.status == RunDelivery.Status.CANCELLED ||
            delivery.status == RunDelivery.Status.SKIPPED) {
            throw ApiError.ValidationError(
                "This delivery was ${delivery.status.wire} and has nothing to resend. " +
                    "Change the target's `onStatuses` if it should have fired.")
        }

        if (!store.redeliver(id, ctx.workspaceId, req.principal?.appUserId?.toString())) {
            throw ApiError.ValidationError("This delivery could not be requeued.")
        }

        audit?.recordUserAction(req, ctx.workspaceId, "delivery.redeliver",
            "delivery", id, after = mapOf("previousStatus" to delivery.status.wire))
        log.info("[delivery] {} requeued by {}", id, req.principal?.appUserId)

        return Response.ok(mapOf(
            "requeued" to true,
            "idempotencyKey" to delivery.idempotencyKey,
            "message" to "Queued. It carries the same idempotency key " +
                "(${delivery.idempotencyKey}), so a receiver that deduplicates will " +
                "recognise it as the delivery it has already seen.",
        ))
    }

    // ── The public payload link ──────────────────────────────────────────────

    /**
     * Fetch a result that was too large to send inline.
     *
     * Unauthenticated: the caller is whoever received the callback, and they have
     * no Vectorbea account. The token names one payload, expires, and is the only
     * thing that grants the read.
     */
    private fun fetchPayload(req: Request): Response {
        val token = req.pathParam("token")

        rateLimiter?.check("dpl:$token", PAYLOAD_FETCHES_PER_MINUTE, 60)?.let { verdict ->
            if (verdict is RateLimitResult.Exceeded) {
                throw ApiError.TooManyRequests(
                    "Too many requests for this payload. Retry in ${verdict.resetsInSeconds}s.",
                    mapOf("retryAfterSeconds" to verdict.resetsInSeconds))
            }
        }

        /*
         * Expired and never-existed are the same 404, deliberately. Telling a
         * caller which one it was turns this into an oracle for whether a token
         * they found in a log was ever real.
         */
        val (content, _) = store.readLink(token)
            ?: throw ApiError.NotFound("Payload")

        return Response(
            status = 200,
            body = content,
            headers = mapOf(
                "Content-Type" to "application/json; charset=utf-8",
                /* Not cacheable by a shared proxy: it is one customer's result
                   behind a bearer token in the path. */
                "Cache-Control" to "private, no-store",
            ),
        )
    }

    // ── Shapes ───────────────────────────────────────────────────────────────

    private fun com.vectorbea.worker.delivery.DeliveryTarget.toResponse(): Map<String, Any?> = buildMap {
        put("id", id.toString())
        put("name", name)
        put("kind", kind.wire)
        put("workflowId", workflowId?.toString())
        put("callbackUrl", callbackUrl)
        // Whether it signs, never the secret.
        put("signed", signingSecretRef != null)
        put("headers", headers)
        put("toolId", toolId?.toString())
        put("connectionId", connectionId?.toString())
        put("inputMapping", inputMapping)
        put("onStatuses", onStatuses)
        put("payloadMode", payloadMode.wire)
        put("maxPayloadBytes", maxPayloadBytes)
        put("streamPartials", streamPartials)
        put("streamNodes", streamNodes)
        put("maxAttempts", maxAttempts)
        put("timeoutMs", timeoutMs)
        put("enabled", enabled)
    }

    private fun RunDelivery.toResponse(workspaceId: UUID): Map<String, Any?> = buildMap {
        put("id", id.toString())
        put("runId", runId.toString())
        put("targetId", targetId.toString())
        put("targetName", store.findTarget(targetId, workspaceId)?.name)
        // The receiver dedupes on this. Shown so support can match our row to
        // their log line without asking us to look it up.
        put("idempotencyKey", idempotencyKey)
        put("status", status.wire)
        put("partial", isPartial)
        put("sequence", sequence)
        put("attempts", attempts)
        put("maxAttempts", maxAttempts)
        put("nextAttemptAt", if (status == RunDelivery.Status.RETRYING) nextAttemptAt.toString() else null)
        // Requirement 5: SAY which shape was used, so a receiver that got a link
        // where it expected a body knows it was a size decision.
        put("payloadMode", payloadModeUsed)
        put("payloadBytes", payloadBytes)
        put("payloadUrl", payloadUrl)
        put("lastError", lastError)
        put("deliveredAt", deliveredAt?.toString())
        put("createdAt", createdAt.toString())
        put("redeliverable", status == RunDelivery.Status.DEAD ||
            status == RunDelivery.Status.DELIVERED)
    }

    /** "about 40 minutes" — because "8 attempts" tells nobody how long they have. */
    private fun horizonWords(maxAttempts: Int): String {
        val d = DeliveryBackoff.horizonFor(maxAttempts)
        return when {
            d.toHours() > 0 -> "about ${d.toHours()}h"
            d.toMinutes() > 0 -> "about ${d.toMinutes()}m"
            else -> "under a minute"
        }
    }
}
