package com.vectorbea.api.webhook

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.ingress.RunIngress
import com.vectorbea.api.ingress.TriggerActor
import com.vectorbea.api.ingress.TriggerSource
import com.vectorbea.api.secrets.SecretService
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID

/**
 * One delivery, from arrival to run.
 *
 * ── SEVEN OUTCOMES, AND SIX OF THEM ARE NOT A RUN ───────────────────────────
 * This is the shape of the thing: a webhook endpoint spends most of its life
 * NOT starting runs, and every one of those decisions is a thing somebody will
 * later need explained. So each step names its outcome, every outcome is
 * recorded, and the sender is told which one happened in terms they can act on:
 *
 *   rejected_disabled   somebody switched it off
 *   rejected_signature  the signature did not verify
 *   rejected_stale      it verified, but it is a replay of an old delivery
 *   filtered            a real event of a type this workflow does not want
 *   duplicate           the sender redelivered; we already have it
 *   rejected_mapping    every mapped field missed — almost always a path typo
 *   accepted            a run
 *
 * "The webhook doesn't work" is otherwise unanswerable, because all seven look
 * identical from outside: no run appeared.
 */
class WebhookIngress(
    private val webhooks: WebhookRepository,
    private val ingress: RunIngress,
    private val secrets: SecretService?,
) {
    private val log = LoggerFactory.getLogger(WebhookIngress::class.java)
    private val mapper = ObjectMapper()

    /** What happened, and what the sender should be told. */
    data class Outcome(
        val httpStatus: Int,
        val outcome: String,
        val message: String,
        val runId: UUID? = null,
        val deliveryId: UUID? = null,
    )

    /**
     * @param replayOf set when an operator is replaying a stored delivery. It
     *   bypasses the dedup constraint — a replay deliberately reuses the
     *   original's key and must not be refused as a duplicate of itself — and it
     *   skips signature verification, because the signature was over a body we
     *   are re-sending and the operator's own authorization is what authorizes
     *   this one.
     */
    fun deliver(
        webhook: Webhook,
        rawBody: String,
        headers: Map<String, String>,
        now: Instant = Instant.now(),
        replayOf: UUID? = null,
        replayedBy: UUID? = null,
    ): Outcome {
        val safeHeaders = SignatureVerifier.sanitizeHeaders(headers)

        fun record(outcome: String, detail: String, runId: UUID? = null,
                   dedupeKey: String? = null, eventType: String? = null): UUID? =
            webhooks.recordDelivery(
                webhookId = webhook.id, workspaceId = webhook.workspaceId,
                outcome = outcome, detail = detail, headers = safeHeaders,
                body = rawBody, dedupeKey = dedupeKey, eventType = eventType,
                runId = runId, replayOfId = replayOf, replayedByUserId = replayedBy)

        // ── 1. Switched off ──────────────────────────────────────────────────
        if (!webhook.enabled) {
            record("rejected_disabled", "The webhook is disabled.")
            /* 410, not 404: the endpoint existed and the sender's configuration is
               not wrong. GitHub and Stripe both back off on a 410, which is the
               behaviour we want from a hook somebody deliberately turned off. */
            return Outcome(410, "rejected_disabled",
                "This webhook is disabled. Enable it in Vectorbea to start accepting deliveries.")
        }

        // ── 2. Signature ─────────────────────────────────────────────────────
        if (replayOf == null) {
            val secret = webhook.signingSecretRef?.let { ref ->
                runCatching { secrets?.resolveSecretForRuntime(ref, webhook.workspaceId) }
                    .getOrElse {
                        log.error("[webhook] secret {} could not be resolved: {}", ref, it.message)
                        null
                    }
            }
            when (val verdict = SignatureVerifier.verify(
                scheme = webhook.signatureScheme,
                rawBody = rawBody,
                headers = headers,
                secret = secret,
                signatureHeader = webhook.signatureHeader,
                timestampHeader = webhook.timestampHeader,
                toleranceSeconds = webhook.toleranceSeconds,
                now = now,
            )) {
                is SignatureVerifier.Result.Valid -> Unit

                is SignatureVerifier.Result.Invalid -> {
                    /* The DETAIL goes in the log, where the workspace owner can
                       read it. The SENDER gets a flat sentence: telling an
                       unauthenticated caller which part of their forgery was
                       wrong is a signing oracle. */
                    record("rejected_signature", "Signature check failed: ${verdict.reason}")
                    return Outcome(401, "rejected_signature",
                        "The signature could not be verified.")
                }

                is SignatureVerifier.Result.Stale -> {
                    record("rejected_stale",
                        "Signed correctly but ${verdict.ageSeconds}s old, outside the " +
                            "${verdict.toleranceSeconds}s tolerance.")
                    return Outcome(401, "rejected_stale",
                        "This delivery is outside the accepted time window.")
                }
            }
        }

        // ── 3. Parse ─────────────────────────────────────────────────────────
        val body: JsonNode = runCatching { mapper.readTree(rawBody.ifBlank { "{}" }) }
            .getOrElse {
                record("error", "The body is not valid JSON.")
                return Outcome(400, "error", "The request body is not valid JSON.")
            }

        val eventType = PayloadMapper.stringAt(body, webhook.eventTypePath)
        val dedupeKey = dedupeKeyFor(webhook, body, headers)

        // ── 4. Filter ────────────────────────────────────────────────────────
        if (webhook.eventTypes.isNotEmpty()) {
            if (eventType == null || eventType !in webhook.eventTypes) {
                record("filtered",
                    "Event type '${eventType ?: "(none)"}' is not in the accepted list " +
                        "(${webhook.eventTypes.joinToString(", ")}).",
                    dedupeKey = dedupeKey, eventType = eventType)
                /* 200, not 4xx. The sender did nothing wrong and a 4xx would make
                   a well-behaved one retry an event we will never want. */
                return Outcome(200, "filtered",
                    "Accepted and ignored: this webhook does not act on '${eventType ?: "untyped"}' events.")
            }
        }

        // ── 5. Dedup ─────────────────────────────────────────────────────────
        //
        // The insert IS the dedup check — a unique index on (webhook, key) — so
        // two concurrent redeliveries cannot both get through. A read-then-write
        // would let them, and a redelivery storm is exactly when both arrive at
        // once.
        val deliveryId = record("accepted", "Verified; starting a run.",
            dedupeKey = dedupeKey, eventType = eventType)
        if (deliveryId == null && dedupeKey != null) {
            log.info("[webhook] duplicate delivery hook={} key={}", webhook.id, dedupeKey)
            return Outcome(200, "duplicate",
                "Already received. No second run was started.")
        }

        // ── 6. Map ───────────────────────────────────────────────────────────
        val inputs = when (val mapped = PayloadMapper.map(body, webhook.inputMapping)) {
            is PayloadMapper.Result.Mapped -> mapped.inputs
            is PayloadMapper.Result.Empty -> {
                val detail = "None of the mapped paths matched this payload: " +
                    mapped.missingPaths.joinToString(", ") + ". Check the paths against a " +
                    "real delivery in the log."
                deliveryId?.let {
                    webhooks.recordDelivery(
                        webhookId = webhook.id, workspaceId = webhook.workspaceId,
                        outcome = "rejected_mapping", detail = detail, headers = safeHeaders,
                        body = rawBody, dedupeKey = null, eventType = eventType,
                        runId = null, replayOfId = deliveryId)
                }
                /* 200: the sender's payload was fine and retrying will not change
                   the mapping. The fix is in Vectorbea, and it is in the log. */
                return Outcome(200, "rejected_mapping", detail)
            }
        }

        // ── 7. Run ───────────────────────────────────────────────────────────
        return try {
            val started = ingress.start(RunIngress.Request(
                workspaceId = webhook.workspaceId,
                workflowId = webhook.workflowId,
                environmentId = webhook.environmentId,
                inputJson = mapper.writeValueAsString(inputs),
                source = TriggerSource.WEBHOOK,
                /* No user: a delivery from Stripe is not any member's spend. */
                actor = TriggerActor(triggerRef = webhook.id),
                /*
                 * The delivery id, so a redelivery that somehow passes the dedup
                 * index — a sender that changes its own event id on retry, which
                 * several do — still cannot produce two runs.
                 */
                idempotencyKey = deliveryId?.let { "webhook:$it" },
                /*
                 * The THING, not the message. `dedupeKeyFor` above stops one
                 * delivery running twice; this stops two different alerts about
                 * the same service starting two incident runs, which is the case
                 * that actually reaches an on-call engineer at 3am.
                 */
                dedupKey = PayloadMapper.stringAt(body, webhook.runDedupPath)
                    ?.takeIf { it.isNotBlank() },
                priority = webhook.runPriority,
                reason = "Delivered by ${webhook.name}" +
                    (eventType?.let { " ($it)" } ?: ""),
            ))
            deliveryId?.let { webhooks.attachRun(it, started.runId) }
            Outcome(202, "accepted", "Accepted. A run has been queued.",
                runId = started.runId, deliveryId = deliveryId)
        } catch (e: ApiError) {
            /*
             * Quota, concurrency, an archived workflow. Recorded against the
             * delivery so the owner sees the plan message rather than an absence,
             * and returned as the ingress's own status so a sender that retries
             * on 429 keeps its backoff.
             */
            deliveryId?.let {
                webhooks.recordDelivery(
                    webhookId = webhook.id, workspaceId = webhook.workspaceId,
                    outcome = if (e.httpStatus == 429) "rejected_quota" else "error",
                    detail = e.message, headers = safeHeaders, body = rawBody,
                    dedupeKey = null, eventType = eventType, runId = null,
                    replayOfId = deliveryId)
            }
            Outcome(e.httpStatus, "rejected_quota", e.message, deliveryId = deliveryId)
        }
    }

    /**
     * The key a redelivery shares with its original.
     *
     * Header first, then body path, then nothing. GitHub puts it in
     * `X-GitHub-Delivery`; Stripe puts the event id in the body. A webhook with
     * neither configured has no dedup — which is honest, and is why the setup UI
     * should push people to configure one.
     */
    private fun dedupeKeyFor(
        webhook: Webhook,
        body: JsonNode,
        headers: Map<String, String>,
    ): String? {
        webhook.dedupeHeader?.lowercase()?.let { headers[it] }?.takeIf { it.isNotBlank() }
            ?.let { return it }
        return PayloadMapper.stringAt(body, webhook.dedupePath)?.takeIf { it.isNotBlank() }
    }
}
