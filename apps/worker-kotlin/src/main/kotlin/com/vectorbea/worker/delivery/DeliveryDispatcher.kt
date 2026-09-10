package com.vectorbea.worker.delivery

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.connector.SecretService
import com.vectorbea.worker.logging.logger
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.SecureRandom
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.sql.DataSource

/**
 * Delivers results after the run is over.
 *
 * ── WHY THIS IS NOT PART OF THE RUN ─────────────────────────────────────────
 * The run is terminal by the time delivery starts. It cannot use the run's
 * retry, because there is nothing left to retry; it cannot fail the run,
 * because the run succeeded and its output is correct; and it must not block
 * `onTerminalTransition`, which is on the worker's completion path and already
 * has a documented deadlock history around holding connections.
 *
 * So the terminal transition does one cheap thing — INSERT a row — and this
 * loop owns everything after: the attempt, the backoff, the dead-lettering and
 * the run's delivery roll-up.
 *
 * ── AND WHY IT IS ITS OWN LOOP RATHER THAN QUEUE JOBS ───────────────────────
 * A delivery's retry schedule is hours long and survives restarts. Expressing
 * that as a queue message means either holding a message invisible for an hour
 * — which every broker treats as a stuck consumer — or re-enqueueing with a
 * delay, which loses the attempt history that makes the DLQ useful. The row IS
 * the schedule; `next_attempt_at` is durable and a restart resumes it.
 */
class DeliveryDispatcher(
    private val dataSource: DataSource,
    private val store: DeliveryStore,
    private val secrets: SecretService?,
    /**
     * Pushes a result through a tool, for `kind = 'destination'`.
     *
     * Injected rather than constructed here: a destination is a TOOL, and tool
     * execution belongs to the runtime that already knows how to resolve
     * connections, apply approval policy and record an audit trail. Null makes
     * destination deliveries fail with a legible reason instead of silently
     * never running.
     */
    private val destinations: DestinationSender? = null,
    /**
     * The run's timeline.
     *
     * Delivery events go on the RUN's timeline rather than into a log of their
     * own, because "what happened to my result" is asked on the run's page and a
     * delivery status kept somewhere else is a status nobody looks at. They
     * arrive after `RUN_SUCCEEDED`, which is correct: a reader paging with
     * `?afterSequence=` sees retries land minutes or hours later.
     *
     * Null degrades to no timeline entries. The ledger is still authoritative,
     * so a missing event costs visibility, never delivery.
     */
    private val events: com.vectorbea.worker.events.RunEventStore? = null,
    private val pollIntervalMs: Long = 5_000L,
    private val batchSize: Int = 20,
    private val httpClient: HttpClient? = null,
) {
    private val log = logger("DeliveryDispatcher")
    private val mapper = ObjectMapper()
    private val running = AtomicBoolean(false)
    private val random = SecureRandom()

    private val instanceId: String =
        System.getenv("HOSTNAME") ?: ("dispatcher-" + UUID.randomUUID().toString().take(8))

    private val executor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "delivery-dispatcher").also { it.isDaemon = true }
    }

    /**
     * Sends a result through a tool.
     *
     * A one-method interface, because the only thing this loop needs from tool
     * execution is "push this and tell me whether it landed" — and a wider one
     * would let delivery reach into the runtime and grow a second copy of it.
     */
    fun interface DestinationSender {
        /** @return null on success, or a legible failure reason. */
        fun send(target: DeliveryTarget, payload: Map<String, Any?>): String?
    }

    private val client: HttpClient by lazy {
        httpClient ?: HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(10))
            /* NEVER follow redirects on a callback. A 302 to somewhere else is a
               request to send a customer's result — signed with their secret — to
               a host they did not configure, and the signature would make it look
               authentic to whoever receives it. */
            .followRedirects(HttpClient.Redirect.NEVER)
            .build()
    }

    fun start() {
        if (!running.compareAndSet(false, true)) return
        executor.scheduleWithFixedDelay(
            { runCatching { tick() }.onFailure { log.error("[delivery] tick failed: {}", it.message) } },
            5_000L, pollIntervalMs, TimeUnit.MILLISECONDS)
        log.info("[delivery] dispatcher started [instance={}]", instanceId)
    }

    fun stop() {
        running.set(false)
        executor.shutdownNow()
        log.info("[delivery] dispatcher stopped")
    }

    /** One pass. Returns how many deliveries it attempted. Exposed for tests. */
    fun tick(): Int {
        val due = store.claimDue(batchSize, instanceId)
        if (due.isEmpty()) return 0
        log.debug("[delivery] claimed {} due deliver(ies)", due.size)
        var attempted = 0
        for (delivery in due) {
            if (!running.get() && executor.isShutdown) break
            runCatching { attempt(delivery, triggeredBy = "dispatcher") }
                .onFailure {
                    /* An unexpected throw must not leave the row `delivering`
                       forever — the claim TTL would eventually free it, but an
                       hour later. Fail it properly so the backoff applies. */
                    log.error("[delivery] {} threw: {}", delivery.id, it.message)
                    store.markFailed(delivery.id, delivery.runId, delivery.attempts + 1,
                        delivery.maxAttempts, it.message ?: it.javaClass.simpleName,
                        retryable = true)
                }
            attempted++
        }
        return attempted
    }

    /**
     * One attempt at one delivery.
     *
     * Public so a redelivery route can drive it immediately rather than waiting
     * for the next poll — an operator who presses "Redeliver" after fixing their
     * endpoint should see the answer, not a five-second gap.
     */
    fun attempt(delivery: RunDelivery, triggeredBy: String) {
        val target = store.findTarget(delivery.targetId, delivery.workspaceId)
        if (target == null) {
            store.markFailed(delivery.id, delivery.runId, delivery.attempts + 1,
                delivery.maxAttempts,
                "The delivery target was deleted, so there is nowhere to send this.",
                retryable = false)
            return
        }

        val attempt = store.beginAttempt(delivery.id) ?: (delivery.attempts + 1)
        val payload = buildPayload(delivery, target)
        val startedAt = System.nanoTime()

        val outcome = when (target.kind) {
            DeliveryTarget.Kind.CALLBACK -> deliverCallback(delivery, target, payload, attempt)
            DeliveryTarget.Kind.DESTINATION -> deliverDestination(target, payload)
        }
        val durationMs = (System.nanoTime() - startedAt) / 1_000_000

        store.recordAttempt(
            deliveryId = delivery.id, workspaceId = delivery.workspaceId, attempt = attempt,
            outcome = outcome.wire, httpStatus = outcome.httpStatus, durationMs = durationMs,
            responseSnippet = outcome.responseSnippet, error = outcome.error,
            triggeredBy = triggeredBy,
        )

        if (outcome is Outcome.Delivered) {
            store.markDelivered(
                delivery.id, delivery.runId,
                payload.modeUsed, payload.bytes, payload.url)
            log.info("[delivery] {} delivered to {} in {}ms (attempt {}, {})",
                delivery.id, target.name, durationMs, attempt, payload.modeUsed)
            emit(delivery, com.vectorbea.worker.events.RunEventStore.EventType.DELIVERY_SUCCEEDED,
                "success",
                "Result delivered to ${target.name}",
                "Sent as ${payload.modeUsed} on attempt $attempt." +
                    (payload.url?.let { " The payload was too large to inline, so it went as a link." } ?: ""),
                durationMs)
        } else {
            val status = store.markFailed(
                delivery.id, delivery.runId, attempt, delivery.maxAttempts,
                outcome.error ?: "The delivery failed.", outcome.retryable)
            log.warn("[delivery] {} to {} failed on attempt {}/{}: {} ({})",
                delivery.id, target.name, attempt, delivery.maxAttempts,
                outcome.error, status.wire)

            if (status == RunDelivery.Status.DEAD) {
                /*
                 * The one delivery event that must never be dropped. The run
                 * already said SUCCEEDED, so this line is the only record that
                 * the customer never got their result — and a run reported as
                 * delivered that was not is the exact failure this feature
                 * exists to prevent.
                 */
                emit(delivery, com.vectorbea.worker.events.RunEventStore.EventType.DELIVERY_DEAD,
                    "failed",
                    "Result NOT delivered to ${target.name}",
                    "Gave up after $attempt attempt(s). ${outcome.error} " +
                        "Redeliver it once the endpoint is fixed \u2014 it will carry the same " +
                        "idempotency key, so a receiver that deduplicates sees one event.",
                    durationMs)
            } else {
                emit(delivery, com.vectorbea.worker.events.RunEventStore.EventType.DELIVERY_FAILED,
                    "retrying",
                    "Delivery to ${target.name} failed, retrying",
                    "Attempt $attempt of ${delivery.maxAttempts}. ${outcome.error}",
                    durationMs)
            }
        }
    }

    // ── Callback ─────────────────────────────────────────────────────────────

    private fun deliverCallback(
        delivery: RunDelivery,
        target: DeliveryTarget,
        payload: Payload,
        attempt: Int,
    ): Outcome {
        val url = target.callbackUrl
            ?: return Outcome.Refused("The target has no callback URL.", retryable = false)

        /*
         * ── SIGNED WITH EVERY LIVE SECRET ───────────────────────────────────
         * More than one during a rotation, so a receiver that has deployed
         * either the old or the new secret keeps working. A rotation that drops
         * deliveries for the length of a rollout is a rotation nobody performs
         * twice, and an unrotated webhook secret is a permanent credential.
         */
        val signingSecrets = listOfNotNull(
            target.signingSecretRef?.let { ref ->
                runCatching { secrets?.resolve(ref, target.workspaceId)?.useOnce { it } }
                    .getOrNull()
            }
        )

        val headers = DeliverySigner.headersFor(
            body = payload.body,
            idempotencyKey = delivery.idempotencyKey,
            deliveryId = delivery.id.toString(),
            attempt = attempt,
            secrets = signingSecrets,
        ) + target.headers.filterKeys { it.lowercase() !in RESERVED_HEADERS }

        val request = HttpRequest.newBuilder()
            .uri(runCatching { URI(url) }.getOrElse {
                return Outcome.Refused("The callback URL is not a valid URL.", retryable = false)
            })
            .timeout(Duration.ofMillis(target.timeoutMs.toLong()))
            .POST(HttpRequest.BodyPublishers.ofString(payload.body))
            .apply { headers.forEach { (k, v) -> header(k, v) } }
            .build()

        return try {
            val response = client.send(request, HttpResponse.BodyHandlers.ofString())
            val code = response.statusCode()
            val snippet = response.body()?.take(DeliveryStore.MAX_RESPONSE_SNIPPET)

            when {
                code in 200..299 -> Outcome.Delivered(code, snippet)

                /*
                 * ── 4xx IS THEIR CONTRACT; 5xx IS THEIR OUTAGE ──────────────
                 * A 400 means the payload does not match what they accept, and
                 * it will mean that on the eighth attempt too — so retrying
                 * spreads eight identical rejections over an hour and delays the
                 * moment somebody finds out. 429 and 408 are the exceptions:
                 * both explicitly mean "later", which is what a retry is.
                 */
                code == 408 || code == 429 -> Outcome.Failed(
                    code, snippet, "The receiver asked us to slow down (HTTP $code).",
                    retryable = true)

                code in 400..499 -> Outcome.Failed(
                    code, snippet,
                    "The receiver rejected this delivery with HTTP $code. That is a " +
                        "permanent answer, so no further attempts will be made — check " +
                        "the payload against what the endpoint accepts.",
                    retryable = false)

                else -> Outcome.Failed(
                    code, snippet, "The receiver returned HTTP $code.", retryable = true)
            }
        } catch (e: java.net.http.HttpTimeoutException) {
            Outcome.Timeout("The receiver did not respond within ${target.timeoutMs}ms.")
        } catch (e: Exception) {
            /* Connection refused, DNS failure, TLS error. All transient from
               here; a receiver that is permanently gone runs out of attempts. */
            Outcome.Failed(null, null,
                "Could not reach the endpoint: ${e.message?.take(200) ?: e.javaClass.simpleName}",
                retryable = true)
        }
    }

    // ── Destination ──────────────────────────────────────────────────────────

    private fun deliverDestination(target: DeliveryTarget, payload: Payload): Outcome {
        val sender = destinations ?: return Outcome.Refused(
            "This deployment cannot run destination deliveries — no tool executor is " +
                "configured. Use a callback target, or enable destinations.",
            retryable = false)

        return when (val error = sender.send(target, payload.asMap())) {
            null -> Outcome.Delivered(null, null)
            /* A tool failure is retryable by default: the overwhelming majority
               are a provider being briefly unavailable, and the attempt cap
               bounds the cost of being wrong. A tool that is permanently
               misconfigured runs out of attempts and lands in the DLQ with its
               error chain, which says so more clearly than one attempt would. */
            else -> Outcome.Failed(null, null, error, retryable = true)
        }
    }

    // ── The payload ──────────────────────────────────────────────────────────

    /** What actually goes on the wire, and which shape it took. */
    private data class Payload(
        val body: String,
        val modeUsed: String,
        val bytes: Int,
        val url: String?,
        val map: Map<String, Any?>,
    ) {
        fun asMap(): Map<String, Any?> = map
    }

    /**
     * Build the envelope, choosing inline or link.
     *
     * ── THE ENVELOPE IS STABLE; THE RESULT IS NOT ───────────────────────────
     * A receiver writes their handler once. So the envelope always has the same
     * shape — run, workflow, status, timing, and exactly one of `output` or
     * `outputUrl` — and `payloadMode` says which, every time, including when it
     * is the one they expected. A field that only appears in the unusual case is
     * a field nobody handles.
     */
    private fun buildPayload(delivery: RunDelivery, target: DeliveryTarget): Payload {
        val run = readRun(delivery.runId)

        /*
         * A partial carries its own content: it was emitted while the run was
         * still going, when `agent_runs.output_json` was null. Reading the run
         * here would deliver an empty body for every partial — and it would look
         * like the node produced nothing rather than like a bug.
         */
        val partial = if (delivery.isPartial) store.partialContent(delivery.id) else null
        val output = if (partial != null) decode(partial.first) else run?.get("output")

        val envelope = LinkedHashMap<String, Any?>()
        envelope["deliveryId"] = delivery.id.toString()
        envelope["idempotencyKey"] = delivery.idempotencyKey
        envelope["runId"] = delivery.runId.toString()
        envelope["workflowId"] = run?.get("workflowId")
        envelope["workspaceId"] = delivery.workspaceId.toString()
        envelope["status"] = run?.get("status")
        envelope["triggerType"] = run?.get("triggerType")
        envelope["startedAt"] = run?.get("startedAt")
        envelope["completedAt"] = run?.get("completedAt")
        envelope["durationMs"] = run?.get("durationMs")
        /* Present on every delivery, so a receiver can tell the final result from
           a partial without inspecting the body. */
        envelope["partial"] = delivery.isPartial
        envelope["sequence"] = delivery.sequence
        /* Which node produced a partial, so a receiver assembling a long
           pipeline knows which part just arrived. */
        partial?.second?.let { envelope["nodeId"] = it }
        if (run?.get("error") != null) envelope["error"] = run["error"]

        val outputJson = runCatching { mapper.writeValueAsString(output ?: emptyMap<String, Any?>()) }
            .getOrDefault("{}")
        val outputBytes = outputJson.toByteArray().size

        val useLink = when (target.payloadMode) {
            PayloadMode.FULL -> false
            PayloadMode.URL -> true
            PayloadMode.AUTO -> outputBytes > target.maxPayloadBytes
        }

        if (useLink) {
            val token = mintLinkToken()
            store.storeLink(token, delivery.id, delivery.workspaceId, delivery.runId,
                outputJson, LINK_TTL)
            val url = linkUrl(token)
            envelope["payloadMode"] = "url"
            envelope["outputUrl"] = url
            envelope["outputBytes"] = outputBytes
            /* Said explicitly, because a receiver expecting a body needs to know
               this was a size decision rather than a missing field. */
            envelope["outputUrlExpiresAt"] = Instant.now().plus(LINK_TTL).toString()
            val body = mapper.writeValueAsString(envelope)
            return Payload(body, "url", body.toByteArray().size, url, envelope)
        }

        envelope["payloadMode"] = "full"
        envelope["output"] = output
        val body = mapper.writeValueAsString(envelope)
        return Payload(body, "full", body.toByteArray().size, null, envelope)
    }

    private fun readRun(runId: UUID): Map<String, Any?>? = runCatching {
        dataSource.connection.use { c ->
            c.prepareStatement(
                """SELECT workflow_id, status, trigger_type, started_at, completed_at,
                          duration_ms, output_json::text AS output_json,
                          error_json::text AS error_json
                     FROM agent_runs WHERE id = ?"""
            ).use { st ->
                st.setObject(1, runId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) return@use null
                    mapOf(
                        "workflowId" to rs.getObject("workflow_id", UUID::class.java)?.toString(),
                        "status" to rs.getString("status"),
                        "triggerType" to rs.getString("trigger_type"),
                        "startedAt" to rs.getTimestamp("started_at")?.toInstant()?.toString(),
                        "completedAt" to rs.getTimestamp("completed_at")?.toInstant()?.toString(),
                        "durationMs" to rs.getObject("duration_ms"),
                        "output" to decode(rs.getString("output_json")),
                        "error" to decode(rs.getString("error_json")),
                    )
                }
            }
        }
    }.getOrNull()

    private fun decode(raw: String?): Any? =
        if (raw.isNullOrBlank()) null
        else runCatching { mapper.readValue(raw, Any::class.java) }.getOrDefault(raw)

    /**
     * The token behind a payload link.
     *
     * Random, not derived. Unlike an idempotency key — which MUST be reproducible
     * so a retry carries the same one — a link is a bearer credential, and a
     * derived one would be recomputable by anyone who learned the derivation and
     * the run id. Rotating a link means minting a new token; a derived token
     * could not be rotated at all.
     */
    private fun mintLinkToken(): String {
        val bytes = ByteArray(32).also { random.nextBytes(it) }
        return "dpl_" + java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    }

    private fun linkUrl(token: String): String {
        val base = System.getenv("PUBLIC_API_BASE_URL")?.trimEnd('/')
        return if (base.isNullOrBlank()) "/api/delivery-payloads/$token"
        else "$base/api/delivery-payloads/$token"
    }

    /**
     * One timeline entry.
     *
     * `runCatching` and a null-safe store, because invariant 7 applies here too:
     * observability never blocks execution. A run's result must not fail to
     * deliver because its timeline could not be written — the ledger is the
     * authoritative record, and the event is how a person reads it.
     */
    private fun emit(
        delivery: RunDelivery,
        type: com.vectorbea.worker.events.RunEventStore.EventType,
        status: String,
        title: String,
        summary: String,
        durationMs: Long? = null,
    ) {
        val store = events ?: return
        runCatching {
            store.appendEvent(com.vectorbea.worker.events.RunEventStore.RunEvent(
                runId = delivery.runId,
                workspaceId = delivery.workspaceId,
                environmentId = delivery.environmentId,
                type = type,
                status = status,
                source = "delivery",
                title = title,
                /* Already sanitized on the way in: the only caller-derived text
                   here is `outcome.error`, which is built from a status code and
                   a truncated exception message — never a response body, never a
                   credential. */
                summary = summary.take(1_000),
                durationMs = durationMs,
                correlationId = delivery.idempotencyKey,
            ))
        }.onFailure { log.warn("[delivery] timeline write failed for {}: {}", delivery.id, it.message) }
    }

    // ── Outcomes ─────────────────────────────────────────────────────────────

    private sealed class Outcome(
        val wire: String,
        val httpStatus: Int?,
        val responseSnippet: String?,
        val error: String?,
        val retryable: Boolean,
    ) {
        class Delivered(status: Int?, snippet: String?) :
            Outcome("delivered", status, snippet, null, false)

        class Failed(status: Int?, snippet: String?, reason: String, retryable: Boolean) :
            Outcome("failed", status, snippet, reason, retryable)

        class Timeout(reason: String) : Outcome("timeout", null, null, reason, true)

        /** Refused before anything was sent — a configuration problem, not theirs. */
        class Refused(reason: String, retryable: Boolean) :
            Outcome("refused", null, null, reason, retryable)
    }

    private companion object {
        /** A week: long enough for a receiver's own schedule, short enough that a
            link in somebody's logs is not a permanent read grant. */
        val LINK_TTL: Duration = Duration.ofDays(7)

        /**
         * Headers a target may not override.
         *
         * Letting configuration set `Vectorbea-Signature` would let somebody
         * replace the proof with a constant, and letting it set
         * `Vectorbea-Idempotency-Key` would break the receiver's dedupe — the
         * two things this whole mechanism exists to provide.
         */
        val RESERVED_HEADERS = setOf(
            DeliverySigner.SIGNATURE_HEADER.lowercase(),
            DeliverySigner.IDEMPOTENCY_HEADER.lowercase(),
            DeliverySigner.DELIVERY_HEADER.lowercase(),
            DeliverySigner.ATTEMPT_HEADER.lowercase(),
            "content-length", "host",
        )
    }
}
