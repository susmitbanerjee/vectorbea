package com.vectorbea.api.billing

import org.slf4j.LoggerFactory
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID

/**
 * The default, and what runs until there is a bank account.
 *
 * ── IT IS A COMPLETE IMPLEMENTATION, NOT A STUB ─────────────────────────────
 * Every method succeeds, mints a plausible local identifier, and advances the
 * subscription's period like a real provider would. That is the difference
 * between "billing is off" and "billing is unfinished": with this in place the
 * whole domain — subscriptions, invoices, lifecycle, entitlement changes, the
 * UI — runs end to end and is testable, and switching to Stripe later changes
 * one environment variable rather than starting a project.
 *
 * ── WHY IT DOES NOT THROW ───────────────────────────────────────────────────
 * A no-op that threw would make every caller branch on whether billing is
 * configured, and one of those branches would eventually be wrong. Succeeding
 * silently means the calling code is identical in every deployment, which is
 * what makes the tests that run against it meaningful for the live providers.
 *
 * ── AND WHY IT CHARGES NOBODY ───────────────────────────────────────────────
 * `vb_noop_*` identifiers are recognisable on sight and in a log, and they match
 * nothing at either real provider. If this is ever wired to a live account by
 * mistake, every subsequent provider call fails with "no such object" rather
 * than doing something plausible with somebody's money.
 */
class NoopBillingProvider : BillingProvider {

    private val log = LoggerFactory.getLogger(NoopBillingProvider::class.java)

    override val id = "noop"
    override val isLive = false

    override fun ensureCustomer(request: CustomerRequest): BillingResult<String> {
        val existing = request.existingExternalId
        if (existing != null) return BillingResult.Success(existing)
        return BillingResult.Success("vb_noop_cus_${short()}")
    }

    override fun createSubscription(request: SubscriptionRequest): BillingResult<ProviderSubscription> {
        val now = Instant.now()
        val trialEnd = request.trialDays?.takeIf { it > 0 }?.let { now.plus(it.toLong(), ChronoUnit.DAYS) }
        log.info("[billing:noop] subscription for account={} price={} qty={}",
            request.accountId, request.externalPriceId, request.quantity)
        return BillingResult.Success(
            ProviderSubscription(
                externalId = "vb_noop_sub_${short()}",
                /* Mirrors a real provider: a subscription with a trial starts in
                   `trialing`, not `active`. A test that only ever saw `active`
                   here would not exercise the trial arm of the lifecycle. */
                status = if (trialEnd != null) "trialing" else "active",
                currentPeriodStart = now,
                currentPeriodEnd = now.plus(30, ChronoUnit.DAYS),
                trialEnd = trialEnd,
            )
        )
    }

    override fun changeSubscriptionPlan(
        externalSubscriptionId: String,
        request: SubscriptionRequest,
        prorate: Boolean,
    ): BillingResult<ProviderSubscription> {
        val now = Instant.now()
        /* Keeps the id, like Stripe and unlike Razorpay. The caller must not
           depend on either — it stores whatever comes back — and testing against
           this provider therefore does not prove the caller handles a changed
           id. `RazorpayBillingProvider` is where that is exercised. */
        return BillingResult.Success(
            ProviderSubscription(
                externalId = externalSubscriptionId,
                status = "active",
                currentPeriodStart = now,
                currentPeriodEnd = now.plus(30, ChronoUnit.DAYS),
                trialEnd = null,
            )
        )
    }

    override fun cancelSubscription(
        externalSubscriptionId: String,
        immediately: Boolean,
    ): BillingResult<ProviderSubscription> {
        val now = Instant.now()
        return BillingResult.Success(
            ProviderSubscription(
                externalId = externalSubscriptionId,
                status = if (immediately) "canceled" else "active",
                currentPeriodStart = null,
                currentPeriodEnd = if (immediately) now else now.plus(30, ChronoUnit.DAYS),
                trialEnd = null,
                cancelAtPeriodEnd = !immediately,
            )
        )
    }

    override fun createSetupSession(request: SetupSessionRequest): BillingResult<HostedSession> =
        BillingResult.Success(
            HostedSession(
                /* A local placeholder, not a provider URL. The UI renders it as
                   "billing is not configured" rather than opening a page that
                   would 404 — a dead link is worse than an honest empty state. */
                url = null,
                clientSecret = "vb_noop_seti_${short()}",
                expiresAt = Instant.now().plus(1, ChronoUnit.HOURS),
            )
        )

    override fun detachPaymentMethod(externalPaymentMethodId: String): BillingResult<Unit> =
        BillingResult.Success(Unit)

    override fun reportUsage(request: UsageReportRequest): BillingResult<String?> {
        log.debug("[billing:noop] usage {} = {} for {}",
            request.metric, request.quantity, request.externalSubscriptionId)
        return BillingResult.Success("vb_noop_usage_${short()}")
    }

    /**
     * False, always.
     *
     * A no-op that accepted every webhook would be an unauthenticated write path
     * into the billing schema in every deployment that has not configured a
     * provider — which is all of them today. Returning false means an unsigned
     * request is refused, and the only cost is that nothing can deliver webhooks
     * to a system with no provider, which is correct.
     */
    override fun verifyWebhook(rawBody: String, headers: Map<String, String>): Boolean = false

    override fun parseWebhook(rawBody: String, headers: Map<String, String>): ProviderEvent? = null

    private fun short() = UUID.randomUUID().toString().replace("-", "").take(14)
}
