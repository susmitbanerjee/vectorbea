package com.vectorbea.api.billing

import java.time.Instant

/**
 * Everything we need a payment provider to do, and nothing about how.
 *
 * ── WHY THIS IS AN INTERFACE FROM DAY ONE ───────────────────────────────────
 * Two providers are needed, not one: Razorpay for India, Stripe internationally.
 * An interface with a single implementation is a guess about what varies; with
 * two it is a fact, and the differences show up immediately rather than in six
 * months as a rewrite. The three that actually shaped this file:
 *
 *   · SIGNATURES. Stripe signs `timestamp.body` with HMAC-SHA256 and puts both
 *     in one header; Razorpay signs the body alone. Both need the RAW bytes, so
 *     [verifyWebhook] takes a String and not a parsed object — a body that has
 *     been through Jackson and back does not verify.
 *   · SUBSCRIPTION SEMANTICS. Stripe changes a subscription's price in place;
 *     Razorpay's plan is fixed at creation and a change is a new subscription.
 *     [changeSubscriptionPlan] therefore returns a possibly-NEW external id, and
 *     callers must store it rather than assuming it is the one they had.
 *   · USAGE. Stripe has metered subscription items; Razorpay has add-ons. Both
 *     collapse to "here is the period's total for this metric", which is what
 *     [reportUsage] takes — and stating a TOTAL rather than a delta is what
 *     makes a retry safe at either.
 *
 * ── NOTHING HERE IS ON A READ PATH ──────────────────────────────────────────
 * No method on this interface is called to answer "what is this workspace
 * entitled to". Entitlements come from our schema, which webhooks update. That
 * is the §3 requirement, and it is why a provider outage cannot stop a run: the
 * only code that talks to a provider is code that is already changing something.
 *
 * ── EVERY METHOD MAY FAIL, AND SAYS SO IN ITS TYPE ──────────────────────────
 * [BillingResult] rather than exceptions, because "the provider is down" is an
 * ordinary outcome here and the caller's response differs per call: a failed
 * subscription creation is shown to the user, a failed usage report is retried
 * by the next sweep, and a failed webhook acknowledgement makes the provider
 * redeliver. Exceptions would collapse three decisions into one catch block.
 */
interface BillingProvider {

    /** `stripe` | `razorpay` | `noop`. Matches the CHECK constraints in V063. */
    val id: String

    /** False for [NoopBillingProvider]; a caller can skip work it knows is inert. */
    val isLive: Boolean get() = true

    // ── Customers ─────────────────────────────────────────────────────────────

    /**
     * Ensure a customer exists at the provider for this account.
     *
     * Idempotent by our account id, which every provider supports as metadata or
     * as a reference. Called before anything else — a subscription with no
     * customer is a provider error at both.
     */
    fun ensureCustomer(request: CustomerRequest): BillingResult<String>

    // ── Subscriptions ─────────────────────────────────────────────────────────

    fun createSubscription(request: SubscriptionRequest): BillingResult<ProviderSubscription>

    /**
     * Move a subscription to a different price.
     *
     * MAY RETURN A DIFFERENT EXTERNAL ID. Stripe mutates in place; Razorpay
     * cancels and recreates. A caller that assumed the id was stable would keep
     * a dead reference and stop receiving webhooks for the live subscription.
     */
    fun changeSubscriptionPlan(
        externalSubscriptionId: String,
        request: SubscriptionRequest,
        prorate: Boolean,
    ): BillingResult<ProviderSubscription>

    /**
     * Cancel, at period end unless [immediately].
     *
     * At period end is the default and the product behaviour (§5): a customer who
     * has paid for the month keeps the month.
     */
    fun cancelSubscription(
        externalSubscriptionId: String,
        immediately: Boolean = false,
    ): BillingResult<ProviderSubscription>

    // ── Payment methods ───────────────────────────────────────────────────────

    /**
     * A short-lived URL or client secret for the provider's HOSTED element.
     *
     * The only payment-method method there is, deliberately. There is no
     * `attachCard(number, cvv)` and there never will be: card details go to the
     * provider in the customer's browser and never traverse our servers, which
     * is what keeps us out of PCI scope. What comes back is a token, delivered
     * by webhook.
     */
    fun createSetupSession(request: SetupSessionRequest): BillingResult<HostedSession>

    fun detachPaymentMethod(externalPaymentMethodId: String): BillingResult<Unit>

    // ── Usage ─────────────────────────────────────────────────────────────────

    /**
     * Report the period's TOTAL for one metric.
     *
     * A total, never a delta — see the file header. [idempotencyKey] is derived
     * from the facts by the caller, so a retry presents the same key and the
     * provider deduplicates it.
     */
    fun reportUsage(request: UsageReportRequest): BillingResult<String?>

    // ── Webhooks ──────────────────────────────────────────────────────────────

    /**
     * Verify a webhook signature over the RAW body.
     *
     * Takes the exact bytes as received. A body that has been parsed and
     * re-serialised will not verify at either provider — key order and whitespace
     * both change the HMAC — and the resulting "invalid signature" looks like an
     * attack rather than a bug in our own plumbing.
     */
    fun verifyWebhook(rawBody: String, headers: Map<String, String>): Boolean

    /**
     * Normalise a raw webhook into our vocabulary.
     *
     * Returns null when the event is not one we handle. That is not a failure —
     * it is the §4 rule: an unrecognised event is logged and ignored, never
     * inferred from its name. Providers add event types without asking.
     */
    fun parseWebhook(rawBody: String, headers: Map<String, String>): ProviderEvent?
}

// ── Requests ─────────────────────────────────────────────────────────────────

data class CustomerRequest(
    /** OUR account id. Sent as metadata so a provider object can be traced back. */
    val accountId: String,
    val email: String?,
    val name: String?,
    val country: String?,
    val currency: String?,
    val taxId: String? = null,
    val taxIdType: String? = null,
    val existingExternalId: String? = null,
)

data class SubscriptionRequest(
    val accountId: String,
    val externalCustomerId: String,
    /** The provider's id for our `plan_prices` row. Never our own id. */
    val externalPriceId: String,
    val quantity: Int = 1,
    val trialDays: Int? = null,
    val currency: String,
    /** Ours, so a webhook can be traced back without a lookup table. */
    val idempotencyKey: String,
)

data class SetupSessionRequest(
    val accountId: String,
    val externalCustomerId: String,
    val returnUrl: String,
    val currency: String,
)

data class UsageReportRequest(
    val externalSubscriptionId: String,
    /** `runs` | `agent_minutes` | `tokens`. Matches `usage_records.metric`. */
    val metric: String,
    /** The period's TOTAL, not a delta. */
    val quantity: Long,
    val periodStart: Instant,
    /** Derived from the facts, so a retry is the same key. */
    val idempotencyKey: String,
)

// ── Responses ────────────────────────────────────────────────────────────────

data class ProviderSubscription(
    val externalId: String,
    /** Already mapped to OUR vocabulary — see `subscriptions.status` in V063. */
    val status: String,
    val currentPeriodStart: Instant?,
    val currentPeriodEnd: Instant?,
    val trialEnd: Instant?,
    val cancelAtPeriodEnd: Boolean = false,
)

data class HostedSession(
    /** Where to send the browser, or the client secret its element needs. */
    val url: String?,
    val clientSecret: String?,
    val expiresAt: Instant?,
)

/**
 * A webhook, in our vocabulary.
 *
 * [externalEventId] is the idempotency key and [occurredAt] is the ordering
 * authority — both come from the provider, because ours would be assigned at
 * arrival and arrival order is exactly what cannot be trusted.
 */
data class ProviderEvent(
    val externalEventId: String,
    /** One of [BillingEventType]'s constants, or null for "recognised shape, unhandled type". */
    val type: String,
    val occurredAt: Instant?,
    val accountId: String? = null,
    val externalCustomerId: String? = null,
    val externalSubscriptionId: String? = null,
    val subscription: ProviderSubscription? = null,
    val invoice: ProviderInvoice? = null,
    val paymentMethod: ProviderPaymentMethod? = null,
    val rawType: String,
)

data class ProviderInvoice(
    val externalId: String,
    val number: String?,
    val currency: String,
    val subtotalMinor: Long,
    val taxMinor: Long,
    val totalMinor: Long,
    val amountPaidMinor: Long,
    val status: String,
    val periodStart: Instant?,
    val periodEnd: Instant?,
    val issuedAt: Instant?,
    val paidAt: Instant?,
    val hostedUrl: String?,
    val pdfUrl: String?,
    val externalSubscriptionId: String?,
)

data class ProviderPaymentMethod(
    val externalId: String,
    val kind: String,
    val brand: String?,
    /** At most four characters. There is nowhere to put more, by design. */
    val last4: String?,
    val expMonth: Int?,
    val expYear: Int?,
    val displayLabel: String?,
)

/** The event types we handle. Anything else is stored and ignored, never guessed. */
object BillingEventType {
    const val SUBSCRIPTION_UPDATED = "subscription.updated"
    const val SUBSCRIPTION_CANCELED = "subscription.canceled"
    const val INVOICE_FINALIZED = "invoice.finalized"
    const val INVOICE_PAID = "invoice.paid"
    const val INVOICE_PAYMENT_FAILED = "invoice.payment_failed"
    const val PAYMENT_METHOD_ATTACHED = "payment_method.attached"
    const val PAYMENT_METHOD_DETACHED = "payment_method.detached"

    val ALL = setOf(
        SUBSCRIPTION_UPDATED, SUBSCRIPTION_CANCELED,
        INVOICE_FINALIZED, INVOICE_PAID, INVOICE_PAYMENT_FAILED,
        PAYMENT_METHOD_ATTACHED, PAYMENT_METHOD_DETACHED,
    )
}

// ── Result ───────────────────────────────────────────────────────────────────

/**
 * Success, or a failure that says whether retrying could help.
 *
 * [Failure.retryable] is the field that matters. A 5xx or a timeout is
 * retryable and the next sweep will pick it up; a 400 "no such price" is not,
 * and retrying it forever would hide a configuration error behind a queue that
 * never drains.
 */
sealed class BillingResult<out T> {
    data class Success<T>(val value: T) : BillingResult<T>()
    data class Failure(
        val message: String,
        val retryable: Boolean,
        val providerCode: String? = null,
        val cause: Throwable? = null,
    ) : BillingResult<Nothing>()

    fun getOrNull(): T? = (this as? Success)?.value
    val succeeded: Boolean get() = this is Success

    inline fun <R> map(f: (T) -> R): BillingResult<R> = when (this) {
        is Success -> Success(f(value))
        is Failure -> this
    }
}
