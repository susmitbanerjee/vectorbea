package com.vectorbea.api.billing

import com.fasterxml.jackson.databind.JsonNode
import org.slf4j.LoggerFactory
import java.time.Instant

/**
 * Razorpay, for India.
 *
 * ── THE FOUR PLACES IT DIVERGES FROM STRIPE ─────────────────────────────────
 * These are why the interface exists, and each would have been invisible if only
 * Stripe had been implemented.
 *
 *  1. A SUBSCRIPTION'S PLAN IS FIXED AT CREATION. There is no "change the
 *     price". An upgrade cancels and creates, so [changeSubscriptionPlan]
 *     returns a DIFFERENT external id — which is exactly why the interface
 *     returns the id rather than assuming the caller already has it. A caller
 *     that kept the old one would stop receiving webhooks for the live
 *     subscription and would look fine until the next invoice.
 *
 *  2. SIGNATURES ARE OVER THE BODY ALONE. `X-Razorpay-Signature` is
 *     `HMAC-SHA256(rawBody)` with no timestamp — so there is no replay window to
 *     enforce, and a captured body stays valid forever. The
 *     `UNIQUE(provider, external_event_id)` constraint in V063 is therefore the
 *     ONLY defence against a replayed webhook here, which is worth knowing
 *     before anybody considers relaxing it.
 *
 *  3. MONEY IS PAISE, AND QUOTED GST-INCLUSIVE. Which is why
 *     `plan_prices.tax_behavior` exists rather than one platform-wide
 *     assumption.
 *
 *  4. USAGE IS AN ADD-ON, NOT A METER. Razorpay has no usage-record concept —
 *     see [reportUsage] for how that is handled honestly rather than pretended
 *     away.
 *
 * ── JSON, NOT FORM ENCODING ─────────────────────────────────────────────────
 * The opposite of Stripe. Form-encoded bodies get a 400 here, and the two APIs
 * disagreeing about something this basic is a small but perfect illustration of
 * why the calling code must not know which provider it is talking to.
 */
class RazorpayBillingProvider(
    private val keyId: String,
    private val keySecret: String,
    private val webhookSecret: String,
    private val apiBase: String = System.getenv("RAZORPAY_API_BASE") ?: "https://api.razorpay.com/v1",
) : BillingProvider {

    private val log = LoggerFactory.getLogger(RazorpayBillingProvider::class.java)

    override val id = "razorpay"

    private fun headers(): Map<String, String> = mapOf(
        "Authorization" to ProviderHttp.basicAuth(keyId, keySecret),
    )

    private fun json(value: Any): String = ProviderHttp.mapper.writeValueAsString(value)

    // ── Customers ─────────────────────────────────────────────────────────────

    override fun ensureCustomer(request: CustomerRequest): BillingResult<String> {
        request.existingExternalId?.let { return BillingResult.Success(it) }

        val body = json(buildMap<String, Any?> {
            put("name", request.name ?: request.email ?: request.accountId)
            put("email", request.email)
            /* Razorpay 400s on a duplicate email unless told not to. Without
               this, a customer who left and came back could never be recreated,
               and the failure would look like a bug in us. */
            put("fail_existing", "0")
            put("notes", mapOf("vectorbea_account_id" to request.accountId))
        })

        return ProviderHttp.post("$apiBase/customers", headers(), body, JSON)
            .map { it.json().path("id").asText() }
    }

    // ── Subscriptions ─────────────────────────────────────────────────────────

    override fun createSubscription(request: SubscriptionRequest): BillingResult<ProviderSubscription> {
        val body = json(buildMap<String, Any?> {
            put("plan_id", request.externalPriceId)
            put("customer_id", request.externalCustomerId)
            put("quantity", request.quantity)
            /* Razorpay counts billing cycles rather than running until
               cancelled. 120 months is "indefinite" in practice; a subscription
               that silently ended after 12 cycles would look like unexplained
               churn. */
            put("total_count", 120)
            put("customer_notify", 1)
            request.trialDays?.takeIf { it > 0 }?.let {
                put("start_at", Instant.now().plusSeconds(it * 86_400L).epochSecond)
            }
            put("notes", mapOf(
                "vectorbea_account_id" to request.accountId,
                "vectorbea_idempotency" to request.idempotencyKey,
            ))
        })

        return ProviderHttp.post("$apiBase/subscriptions", headers(), body, JSON)
            .map { toSubscription(it.json()) }
    }

    /**
     * Cancel and recreate, because Razorpay cannot change a subscription's plan.
     *
     * ── THE RETURNED ID IS A NEW ONE ────────────────────────────────────────
     * This is the divergence the interface was shaped around. The caller stores
     * whatever comes back and must not assume the id it passed in is still live.
     *
     * ── AND THE ORDER IS CREATE-THEN-CANCEL ─────────────────────────────────
     * Deliberately, and it is the only safe order. Cancelling first and then
     * failing to create would leave the customer with NO subscription — an
     * upgrade that silently downgraded them to nothing. Creating first risks a
     * brief overlap of two, which is a reconcilable billing artefact rather than
     * a loss of service.
     *
     * When the cancel fails, the overlap is logged at ERROR with both ids so a
     * human can undo one. A customer being double-billed for a day and refunded
     * is recoverable; a customer whose plan vanished mid-upgrade is not.
     */
    override fun changeSubscriptionPlan(
        externalSubscriptionId: String,
        request: SubscriptionRequest,
        prorate: Boolean,
    ): BillingResult<ProviderSubscription> {
        val created = createSubscription(request)
        if (created is BillingResult.Failure) return created

        val cancelled = cancelSubscription(externalSubscriptionId, immediately = true)
        if (cancelled is BillingResult.Failure) {
            log.error(
                "[billing:razorpay] created {} but could not cancel {} — account {} now has TWO " +
                    "live subscriptions and will be double-billed until this is undone: {}",
                created.getOrNull()?.externalId, externalSubscriptionId,
                request.accountId, cancelled.message,
            )
        }
        return created
    }

    override fun cancelSubscription(
        externalSubscriptionId: String,
        immediately: Boolean,
    ): BillingResult<ProviderSubscription> {
        val body = json(mapOf("cancel_at_cycle_end" to if (immediately) 0 else 1))
        return ProviderHttp.post(
            "$apiBase/subscriptions/$externalSubscriptionId/cancel", headers(), body, JSON,
        ).map { toSubscription(it.json()) }
    }

    // ── Payment methods ───────────────────────────────────────────────────────

    override fun createSetupSession(request: SetupSessionRequest): BillingResult<HostedSession> {
        /* The customer read confirms the id is live before the UI is told to go
           ahead. A stale customer id would otherwise fail later, during checkout,
           in front of somebody trying to pay us. */
        val exists = ProviderHttp.get("$apiBase/customers/${request.externalCustomerId}", headers())
        if (exists is BillingResult.Failure) return exists

        /* And then nothing to hand back, honestly. Razorpay authorises a payment
           instrument as PART of subscribing rather than in a separate setup step,
           so there is no hosted URL for "add a card" on its own. The UI reads
           `url == null` and offers the subscribe flow instead of a "manage
           payment methods" button that would lead nowhere. */
        return BillingResult.Success(HostedSession(url = null, clientSecret = null, expiresAt = null))
    }

    override fun detachPaymentMethod(externalPaymentMethodId: String): BillingResult<Unit> =
        /* Razorpay tokens are revoked from the customer portal, not the API.
           Returning a permanent failure rather than pretending: a silent success
           would leave a customer believing a mandate was cancelled when it was
           not, and the next debit would prove otherwise. */
        BillingResult.Failure(
            "Razorpay payment instruments are revoked from the customer portal, not the API",
            retryable = false,
        )

    // ── Usage ─────────────────────────────────────────────────────────────────

    /**
     * Razorpay has no usage-record API, and this says so rather than inventing one.
     *
     * Metered charges there are ADD-ONS created against a subscription, and an
     * add-on is a CHARGE rather than a running total. Creating one per report
     * would bill the period's total again on every retry — precisely the
     * double-charge §6 forbids, and it would be invisible until an invoice.
     *
     * So nothing is reported, the local meter stays authoritative, and
     * `usage_reports` records the attempt as `skipped`. The reconciler treats a
     * provider with no metered API as "nothing to compare" rather than as drift,
     * so this does not generate a permanent false alert either.
     *
     * The honest path when metered billing is needed on Razorpay is an invoice
     * line added at period close, which belongs with invoicing and not inside a
     * usage report.
     */
    override fun reportUsage(request: UsageReportRequest): BillingResult<String?> {
        log.debug("[billing:razorpay] usage not reported for {} — no metered API; " +
            "local meters remain authoritative", request.externalSubscriptionId)
        return BillingResult.Success(null)
    }

    // ── Webhooks ──────────────────────────────────────────────────────────────

    /** `HMAC-SHA256(rawBody)`, hex, compared in constant time. See §2 above. */
    override fun verifyWebhook(rawBody: String, headers: Map<String, String>): Boolean {
        val presented = headers["x-razorpay-signature"] ?: return false
        val expected = ProviderHttp.hmacSha256Hex(webhookSecret, rawBody)
        return ProviderHttp.constantTimeEquals(presented, expected)
    }

    override fun parseWebhook(rawBody: String, headers: Map<String, String>): ProviderEvent? {
        val root = runCatching { ProviderHttp.mapper.readTree(rawBody) }.getOrNull() ?: return null
        val rawType = root.path("event").asText("")

        /* Razorpay does not put an event id in the body — it is in a header, and
           older deliveries have none at all. Falling back to a digest of the body
           keeps the key DETERMINISTIC: the same redelivered payload produces the
           same key, which is exactly what the UNIQUE constraint needs. A random
           id here would defeat idempotency entirely. */
        val externalId = headers["x-razorpay-event-id"]
            ?: ProviderHttp.hmacSha256Hex(webhookSecret, rawBody).take(40)

        val occurredAt = root.path("created_at").takeIf { it.isNumber }
            ?.let { Instant.ofEpochSecond(it.asLong()) }

        val payload = root.path("payload")
        val sub = payload.path("subscription").path("entity")
        val inv = payload.path("invoice").path("entity")

        val type = when (rawType) {
            "subscription.activated", "subscription.charged",
            "subscription.updated", "subscription.authenticated",
            "subscription.pending", "subscription.halted" -> BillingEventType.SUBSCRIPTION_UPDATED
            "subscription.cancelled", "subscription.completed" -> BillingEventType.SUBSCRIPTION_CANCELED
            "invoice.paid" -> BillingEventType.INVOICE_PAID
            else -> return ProviderEvent(
                externalEventId = externalId,
                // Recognised envelope, unhandled type. Stored and ignored so it
                // can be replayed once a handler exists — never guessed at.
                type = "",
                occurredAt = occurredAt,
                rawType = rawType,
            )
        }

        return ProviderEvent(
            externalEventId = externalId,
            type = type,
            occurredAt = occurredAt,
            accountId = sub.path("notes").path("vectorbea_account_id").asText(null),
            externalCustomerId = sub.path("customer_id").asText(null),
            externalSubscriptionId = sub.path("id").asText(null)
                ?: inv.path("subscription_id").asText(null),
            subscription = if (sub.hasNonNull("id")) toSubscription(sub) else null,
            invoice = if (inv.hasNonNull("id")) toInvoice(inv) else null,
            paymentMethod = null,
            rawType = rawType,
        )
    }

    // ── Mapping ───────────────────────────────────────────────────────────────

    private fun toSubscription(json: JsonNode) = ProviderSubscription(
        externalId = json.path("id").asText(),
        status = mapStatus(json.path("status").asText("")),
        currentPeriodStart = epoch(json.path("current_start")),
        currentPeriodEnd = epoch(json.path("current_end")),
        /* Razorpay expresses a trial as a DEFERRED START rather than a trial
           end, which is why this reads a field Stripe would call something
           else. A future `start_at` is the trial. */
        trialEnd = epoch(json.path("start_at"))?.takeIf { it.isAfter(Instant.now()) },
        cancelAtPeriodEnd = json.path("status").asText() == "cancelled" &&
            epoch(json.path("ended_at")) == null,
    )

    /**
     * Razorpay's statuses to ours.
     *
     * `halted` is the one worth naming: it means retries have been exhausted
     * after repeated failures, which is a dunning END-STATE and not a
     * cancellation. Mapping it to `canceled` would terminate a subscription the
     * customer can still rescue by paying.
     */
    private fun mapStatus(rz: String): String = when (rz) {
        "created", "authenticated" -> "incomplete"
        "active" -> "active"
        "pending", "halted" -> "past_due"
        "cancelled", "completed", "expired" -> "canceled"
        else -> "incomplete"
    }

    private fun toInvoice(json: JsonNode): ProviderInvoice {
        val total = json.path("amount").asLong(0)
        val tax = json.path("tax_amount").asLong(0)
        return ProviderInvoice(
            externalId = json.path("id").asText(),
            number = json.path("invoice_number").asText(null),
            /* Paise, INR in practice. Uppercased because our CHECK requires it
               and Razorpay returns lowercase. */
            currency = json.path("currency").asText("INR").uppercase(),
            subtotalMinor = total - tax,
            taxMinor = tax,
            totalMinor = total,
            amountPaidMinor = json.path("amount_paid").asLong(0),
            status = when (json.path("status").asText("")) {
                "paid" -> "paid"
                "issued" -> "open"
                "cancelled", "expired" -> "void"
                else -> "draft"
            },
            periodStart = epoch(json.path("billing_start")),
            periodEnd = epoch(json.path("billing_end")),
            issuedAt = epoch(json.path("issued_at")),
            paidAt = epoch(json.path("paid_at")),
            hostedUrl = json.path("short_url").asText(null),
            pdfUrl = null,
            externalSubscriptionId = json.path("subscription_id").asText(null),
        )
    }

    private fun epoch(node: JsonNode): Instant? =
        node.takeIf { it.isNumber && it.asLong() > 0 }?.let { Instant.ofEpochSecond(it.asLong()) }

    private companion object {
        const val JSON = "application/json"
    }
}
