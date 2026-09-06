package com.vectorbea.api.billing

import com.fasterxml.jackson.databind.JsonNode
import org.slf4j.LoggerFactory
import java.time.Instant

/**
 * Stripe, for everywhere that is not India.
 *
 * ── WHAT STRIPE DOES THAT RAZORPAY DOES NOT ─────────────────────────────────
 * Reading this beside `RazorpayBillingProvider` is the fastest way to see why
 * the interface is shaped as it is.
 *
 *   · A subscription's price changes IN PLACE. `changeSubscriptionPlan` returns
 *     the same external id, and proration is a parameter.
 *   · Webhooks are signed as `HMAC-SHA256(timestamp + "." + rawBody)` with the
 *     timestamp in the same header, and the timestamp must be checked or an old
 *     valid-looking body can be replayed forever.
 *   · Tax is Stripe Tax, enabled per subscription with `automatic_tax[enabled]`;
 *     we compute nothing.
 *   · Metered usage goes to a subscription ITEM, not the subscription, so the
 *     item id has to be found before usage can be reported.
 *
 * ── FORM-ENCODED, NOT JSON ──────────────────────────────────────────────────
 * Stripe's API takes `application/x-www-form-urlencoded` with bracket notation
 * for nesting (`items[0][price]`). Not a preference — sending JSON gets a 400.
 */
class StripeBillingProvider(
    private val secretKey: String,
    private val webhookSecret: String,
    private val apiBase: String = System.getenv("STRIPE_API_BASE") ?: "https://api.stripe.com/v1",
    /**
     * How far out of date a signature timestamp may be.
     *
     * Five minutes is Stripe's own recommendation. Without it a body captured
     * once can be replayed indefinitely, because the signature over it stays
     * valid — the timestamp is the only thing that expires.
     */
    private val toleranceSeconds: Long = 300,
) : BillingProvider {

    private val log = LoggerFactory.getLogger(StripeBillingProvider::class.java)

    override val id = "stripe"

    private fun headers(idempotencyKey: String? = null): Map<String, String> = buildMap {
        put("Authorization", ProviderHttp.basicAuth(secretKey, ""))
        put("Stripe-Version", API_VERSION)
        /* Stripe deduplicates on this for 24 hours, which is what makes a retried
           create safe. Ours is derived from the facts, so a retry presents the
           same key rather than a fresh one. */
        if (idempotencyKey != null) put("Idempotency-Key", idempotencyKey)
    }

    // ── Customers ─────────────────────────────────────────────────────────────

    override fun ensureCustomer(request: CustomerRequest): BillingResult<String> {
        request.existingExternalId?.let { return BillingResult.Success(it) }

        val body = ProviderHttp.formEncode(buildMap {
            put("email", request.email)
            put("name", request.name)
            /* OUR account id, so any object at Stripe can be traced back without
               a lookup table we would have to keep in step. */
            put("metadata[vectorbea_account_id]", request.accountId)
            request.country?.let { put("address[country]", it) }
        })

        return ProviderHttp.post(
            "$apiBase/customers",
            headers(idempotencyKey = "cus:${request.accountId}"),
            body,
            FORM,
        ).map { it.json().path("id").asText() }
    }

    // ── Subscriptions ─────────────────────────────────────────────────────────

    override fun createSubscription(request: SubscriptionRequest): BillingResult<ProviderSubscription> {
        val body = ProviderHttp.formEncode(buildMap {
            put("customer", request.externalCustomerId)
            put("items[0][price]", request.externalPriceId)
            put("items[0][quantity]", request.quantity.toString())
            request.trialDays?.takeIf { it > 0 }?.let { put("trial_period_days", it.toString()) }
            /* Stripe Tax. We compute no tax ourselves anywhere — §7 says Stripe
               handles international, and a second opinion about VAT is a
               liability rather than a feature. */
            put("automatic_tax[enabled]", "true")
            put("metadata[vectorbea_account_id]", request.accountId)
            /* So a failed first payment lands in `past_due` and the dunning
               schedule takes over, rather than the subscription being deleted. */
            put("payment_behavior", "default_incomplete")
            put("proration_behavior", "create_prorations")
        })

        return ProviderHttp.post(
            "$apiBase/subscriptions", headers(request.idempotencyKey), body, FORM,
        ).map { toSubscription(it.json()) }
    }

    override fun changeSubscriptionPlan(
        externalSubscriptionId: String,
        request: SubscriptionRequest,
        prorate: Boolean,
    ): BillingResult<ProviderSubscription> {
        /* The item has to be found first: Stripe changes a subscription's price
           by updating its ITEM, and the item id is not the subscription id. This
           is the one place the provider needs a read before a write, and it is
           on an explicit user action rather than any hot path. */
        val current = ProviderHttp.get("$apiBase/subscriptions/$externalSubscriptionId", headers())
        val itemId = when (current) {
            is BillingResult.Failure -> return current
            is BillingResult.Success ->
                current.value.json().path("items").path("data").firstOrNull()?.path("id")?.asText()
                    ?: return BillingResult.Failure(
                        "subscription $externalSubscriptionId has no items to change",
                        retryable = false)
        }

        val body = ProviderHttp.formEncode(mapOf(
            "items[0][id]" to itemId,
            "items[0][price]" to request.externalPriceId,
            "items[0][quantity]" to request.quantity.toString(),
            "proration_behavior" to if (prorate) "create_prorations" else "none",
        ))

        return ProviderHttp.post(
            "$apiBase/subscriptions/$externalSubscriptionId",
            headers(request.idempotencyKey), body, FORM,
        ).map { toSubscription(it.json()) }
    }

    override fun cancelSubscription(
        externalSubscriptionId: String,
        immediately: Boolean,
    ): BillingResult<ProviderSubscription> =
        if (immediately) {
            /* DELETE, not POST. Stripe distinguishes cancel-now from
               cancel-at-period-end by the VERB — posting `cancel_at_period_end:
               false` would merely clear a pending cancellation and leave the
               subscription running, which is the opposite of what was asked. */
            ProviderHttp.delete("$apiBase/subscriptions/$externalSubscriptionId", headers())
                .map { toSubscription(it.json()) }
        } else {
            ProviderHttp.post(
                "$apiBase/subscriptions/$externalSubscriptionId",
                headers(),
                ProviderHttp.formEncode(mapOf("cancel_at_period_end" to "true")),
                FORM,
            ).map { toSubscription(it.json()) }
        }

    // ── Payment methods ───────────────────────────────────────────────────────

    override fun createSetupSession(request: SetupSessionRequest): BillingResult<HostedSession> {
        val body = ProviderHttp.formEncode(mapOf(
            "customer" to request.externalCustomerId,
            "mode" to "setup",
            "success_url" to request.returnUrl,
            "cancel_url" to request.returnUrl,
        ))
        return ProviderHttp.post("$apiBase/checkout/sessions", headers(), body, FORM)
            .map { res ->
                val json = res.json()
                HostedSession(
                    /* Stripe's HOSTED page. Card details are entered there, in
                       the customer's browser, and never reach us — which is what
                       keeps this out of PCI scope. */
                    url = json.path("url").asText(null),
                    clientSecret = json.path("client_secret").asText(null),
                    expiresAt = json.path("expires_at").takeIf { it.isNumber }
                        ?.let { Instant.ofEpochSecond(it.asLong()) },
                )
            }
    }

    override fun detachPaymentMethod(externalPaymentMethodId: String): BillingResult<Unit> =
        ProviderHttp.post("$apiBase/payment_methods/$externalPaymentMethodId/detach",
            headers(), "", FORM).map { }

    // ── Usage ─────────────────────────────────────────────────────────────────

    override fun reportUsage(request: UsageReportRequest): BillingResult<String?> {
        /* Usage attaches to a subscription ITEM. Finding it costs a read, which
           is acceptable here: this runs on a schedule, not on a request path. */
        val current = ProviderHttp.get(
            "$apiBase/subscriptions/${request.externalSubscriptionId}", headers())
        val itemId = when (current) {
            is BillingResult.Failure -> return current
            is BillingResult.Success ->
                current.value.json().path("items").path("data")
                    .firstOrNull { it.path("price").path("recurring").path("usage_type").asText() == "metered" }
                    ?.path("id")?.asText()
                    // Not a failure: a flat-rate subscription has no metered item
                    // and nothing to report. Retrying would never succeed.
                    ?: return BillingResult.Success(null)
        }

        val body = ProviderHttp.formEncode(mapOf(
            "quantity" to request.quantity.toString(),
            "timestamp" to request.periodStart.epochSecond.toString(),
            /* `set`, not `increment`. The request carries the period's TOTAL, so
               a duplicate report writes the same total and changes nothing —
               which is what makes a retry safe. `increment` would double-charge
               on every redelivery. */
            "action" to "set",
        ))

        return ProviderHttp.post(
            "$apiBase/subscription_items/$itemId/usage_records",
            headers(request.idempotencyKey), body, FORM,
        ).map { it.json().path("id").asText(null) }
    }

    // ── Webhooks ──────────────────────────────────────────────────────────────

    /**
     * Verify `Stripe-Signature`.
     *
     * The header is `t=<unix>,v1=<hex>,v1=<hex>` — several signatures during a
     * secret rotation, and ANY may match. Checking only the first would break
     * every rotation, silently, at the worst possible time.
     */
    override fun verifyWebhook(rawBody: String, headers: Map<String, String>): Boolean {
        val header = headers["stripe-signature"] ?: return false
        val parts = header.split(",").mapNotNull {
            val kv = it.trim().split("=", limit = 2)
            if (kv.size == 2) kv[0] to kv[1] else null
        }
        val timestamp = parts.firstOrNull { it.first == "t" }?.second ?: return false
        val signatures = parts.filter { it.first == "v1" }.map { it.second }
        if (signatures.isEmpty()) return false

        // Replay window. The signature over an old body stays valid forever;
        // the timestamp is the only thing that expires.
        val age = runCatching { Instant.now().epochSecond - timestamp.toLong() }.getOrNull() ?: return false
        if (kotlin.math.abs(age) > toleranceSeconds) {
            log.warn("[billing:stripe] webhook rejected: timestamp {}s out of tolerance", age)
            return false
        }

        val expected = ProviderHttp.hmacSha256Hex(webhookSecret, "$timestamp.$rawBody")
        return signatures.any { ProviderHttp.constantTimeEquals(it, expected) }
    }

    override fun parseWebhook(rawBody: String, headers: Map<String, String>): ProviderEvent? {
        val root = runCatching { ProviderHttp.mapper.readTree(rawBody) }.getOrNull() ?: return null
        val externalId = root.path("id").asText(null) ?: return null
        val rawType = root.path("type").asText("")
        val obj = root.path("data").path("object")
        val occurredAt = root.path("created").takeIf { it.isNumber }
            ?.let { Instant.ofEpochSecond(it.asLong()) }

        /* An exhaustive `when` over the types we handle, and null for everything
           else. NOT a prefix match on the name: `customer.subscription.paused`
           and `customer.subscription.updated` both start the same way and mean
           different things, and guessing is the failure §4 forbids. */
        val type = when (rawType) {
            "customer.subscription.created",
            "customer.subscription.updated" -> BillingEventType.SUBSCRIPTION_UPDATED
            "customer.subscription.deleted" -> BillingEventType.SUBSCRIPTION_CANCELED
            "invoice.finalized" -> BillingEventType.INVOICE_FINALIZED
            "invoice.paid", "invoice.payment_succeeded" -> BillingEventType.INVOICE_PAID
            "invoice.payment_failed" -> BillingEventType.INVOICE_PAYMENT_FAILED
            "payment_method.attached" -> BillingEventType.PAYMENT_METHOD_ATTACHED
            "payment_method.detached" -> BillingEventType.PAYMENT_METHOD_DETACHED
            else -> return ProviderEvent(
                externalEventId = externalId,
                // Recognised envelope, unhandled type. Stored and ignored so it
                // can be replayed once a handler exists.
                type = "",
                occurredAt = occurredAt,
                rawType = rawType,
            )
        }

        return ProviderEvent(
            externalEventId = externalId,
            type = type,
            occurredAt = occurredAt,
            accountId = obj.path("metadata").path("vectorbea_account_id").asText(null),
            externalCustomerId = obj.path("customer").asText(null),
            externalSubscriptionId = when {
                rawType.startsWith("customer.subscription") -> obj.path("id").asText(null)
                else -> obj.path("subscription").asText(null)
            },
            subscription = if (rawType.startsWith("customer.subscription")) toSubscription(obj) else null,
            invoice = if (rawType.startsWith("invoice")) toInvoice(obj) else null,
            paymentMethod = if (rawType.startsWith("payment_method")) toPaymentMethod(obj) else null,
            rawType = rawType,
        )
    }

    // ── Mapping ───────────────────────────────────────────────────────────────

    private fun toSubscription(json: JsonNode) = ProviderSubscription(
        externalId = json.path("id").asText(),
        status = mapStatus(json.path("status").asText("")),
        currentPeriodStart = epoch(json.path("current_period_start")),
        currentPeriodEnd = epoch(json.path("current_period_end")),
        trialEnd = epoch(json.path("trial_end")),
        cancelAtPeriodEnd = json.path("cancel_at_period_end").asBoolean(false),
    )

    /**
     * Stripe's statuses to ours.
     *
     * `unpaid` maps to `past_due` rather than `canceled`: Stripe uses it for a
     * subscription whose invoices have stopped being attempted, which is a
     * dunning state and not an ended one. Mapping it to `canceled` would end
     * somebody's subscription over a retry policy.
     */
    private fun mapStatus(stripe: String): String = when (stripe) {
        "trialing" -> "trialing"
        "active" -> "active"
        "past_due", "unpaid" -> "past_due"
        "canceled" -> "canceled"
        "incomplete", "incomplete_expired", "paused" -> "incomplete"
        else -> "incomplete"
    }

    private fun toInvoice(json: JsonNode) = ProviderInvoice(
        externalId = json.path("id").asText(),
        number = json.path("number").asText(null),
        currency = json.path("currency").asText("usd").uppercase(),
        subtotalMinor = json.path("subtotal").asLong(0),
        taxMinor = json.path("tax").asLong(0),
        totalMinor = json.path("total").asLong(0),
        amountPaidMinor = json.path("amount_paid").asLong(0),
        status = json.path("status").asText("draft"),
        periodStart = epoch(json.path("period_start")),
        periodEnd = epoch(json.path("period_end")),
        issuedAt = epoch(json.path("created")),
        paidAt = if (json.path("status").asText() == "paid") epoch(json.path("status_transitions").path("paid_at")) else null,
        hostedUrl = json.path("hosted_invoice_url").asText(null),
        pdfUrl = json.path("invoice_pdf").asText(null),
        externalSubscriptionId = json.path("subscription").asText(null),
    )

    private fun toPaymentMethod(json: JsonNode): ProviderPaymentMethod {
        val card = json.path("card")
        return ProviderPaymentMethod(
            externalId = json.path("id").asText(),
            kind = json.path("type").asText("card"),
            brand = card.path("brand").asText(null),
            /* Four digits, and nothing else is read. There is no branch here
               that could ever reach a full number — Stripe does not send one. */
            last4 = card.path("last4").asText(null)?.take(4),
            expMonth = card.path("exp_month").takeIf { it.isNumber }?.asInt(),
            expYear = card.path("exp_year").takeIf { it.isNumber }?.asInt(),
            displayLabel = null,
        )
    }

    private fun epoch(node: JsonNode): Instant? =
        node.takeIf { it.isNumber && it.asLong() > 0 }?.let { Instant.ofEpochSecond(it.asLong()) }

    private companion object {
        const val FORM = "application/x-www-form-urlencoded"
        /* Pinned. An unpinned version means Stripe can change a response shape
           under a running deployment, and the first symptom would be a mapping
           silently returning null for a field that moved. */
        const val API_VERSION = "2024-06-20"
    }
}
