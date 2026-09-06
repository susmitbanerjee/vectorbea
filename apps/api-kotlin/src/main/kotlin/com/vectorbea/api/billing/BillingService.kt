package com.vectorbea.api.billing

import com.vectorbea.api.errors.ApiError
import org.slf4j.LoggerFactory
import java.util.UUID

/**
 * Subscribe, upgrade, downgrade, cancel — with our schema written first.
 *
 * ── THE ORDER OF WRITES IS THE DESIGN ───────────────────────────────────────
 * Provider first, then us. That is deliberate and it is the opposite of the
 * durability rule elsewhere in this codebase, so it is worth saying why.
 *
 * Everywhere else, a row with no message is recoverable and a message with no
 * row is not. Here it inverts: a subscription at the provider with no row of
 * ours is recoverable — the webhook that follows carries the full state and
 * `WebhookProcessor` creates the row. A row of ours with no subscription at the
 * provider is not: the customer would be entitled to a plan nobody is charging
 * them for, and nothing would ever correct it.
 *
 * ── NEVER TRUST A CLIENT CLAIM ABOUT A PLAN ─────────────────────────────────
 * Nothing in this file takes a price, an amount or an entitlement from the
 * caller. The client names a PLAN CODE and an interval; the price is looked up
 * from `plan_prices` for the account's own currency. A caller asking to subscribe
 * to "pro at 1 cent" is asking for a plan code and getting the catalogue's price.
 */
class BillingService(
    private val ds: javax.sql.DataSource,
    private val repo: BillingRepository,
    private val providers: BillingProviderRegistry,
) {
    private val log = LoggerFactory.getLogger(BillingService::class.java)

    /**
     * The default currency for a country.
     *
     * §7 decides currency at signup. India gets INR because Razorpay settles in
     * INR and a rupee price is a decision rather than a conversion; everywhere
     * else defaults to USD until somebody asks for more.
     */
    fun defaultCurrencyFor(country: String?): String = when (country?.uppercase()) {
        "IN" -> "INR"
        else -> "USD"
    }

    /** Razorpay for India, Stripe elsewhere — the routing §1 and §7 imply. */
    fun defaultProviderFor(country: String?): String = when (country?.uppercase()) {
        "IN" -> "razorpay"
        else -> "stripe"
    }

    // ── Subscribe ─────────────────────────────────────────────────────────────

    /**
     * Start a subscription for [accountId] on [planCode].
     *
     * Refuses rather than guesses when the account has no currency: currency is
     * decided at signup, and inventing one here would produce an account whose
     * price came from a default nobody chose.
     */
    fun subscribe(
        accountId: UUID,
        planCode: String,
        interval: String = "month",
        trialDays: Int? = null,
    ): BillingRepository.Subscription {
        val account = repo.account(accountId) ?: throw ApiError.NotFound("Billing account")

        if (repo.liveSubscription(accountId) != null) {
            throw ApiError.Conflict(
                "This account already has a subscription. Change the plan instead of starting a second one.")
        }

        val currency = account.currency
            ?: throw ApiError.ValidationError(
                "This account has no billing currency yet. Set the billing country and currency first.")

        val provider = providers.forAccount(account)
        val price = repo.price(planCode, currency, interval, provider.id)
            ?: throw ApiError.ValidationError(
                "The $planCode plan has no price in $currency. Pricing is set per currency; " +
                    "contact us if you need this one.")

        // Customer first — a subscription with no customer is an error at both
        // providers, and creating it here means one round trip rather than a
        // failure the caller has to interpret.
        val customerId = when (val r = provider.ensureCustomer(CustomerRequest(
            accountId = accountId.toString(),
            email = account.billingEmail,
            name = account.name,
            country = account.country,
            currency = currency,
            taxId = account.taxId,
            taxIdType = account.taxIdType,
            existingExternalId = account.externalCustomerId,
        ))) {
            is BillingResult.Success -> r.value
            is BillingResult.Failure -> throw providerError(r)
        }
        if (account.externalCustomerId != customerId) {
            repo.setExternalCustomer(accountId, provider.id, customerId)
        }

        val created = when (val r = provider.createSubscription(SubscriptionRequest(
            accountId = accountId.toString(),
            externalCustomerId = customerId,
            externalPriceId = price.externalPriceId ?: "noop_price_${price.id}",
            quantity = account.seats,
            trialDays = trialDays,
            currency = currency,
            /* Derived, so a retried subscribe presents the same key and the
               provider deduplicates rather than creating a second subscription
               the customer would be billed for twice. */
            idempotencyKey = "sub:$accountId:$planCode:$interval",
        ))) {
            is BillingResult.Success -> r.value
            is BillingResult.Failure -> throw providerError(r)
        }

        val id = repo.createSubscription(
            accountId = accountId,
            planCode = planCode,
            planPriceId = price.id,
            provider = provider.id,
            externalId = created.externalId,
            status = created.status,
            quantity = account.seats,
            trialEnd = created.trialEnd,
            periodStart = created.currentPeriodStart,
            periodEnd = created.currentPeriodEnd,
        )

        /* Entitlements move now for a trial or an active subscription, and NOT
           for `incomplete` — which is what Stripe returns until the first payment
           succeeds. Granting a plan on `incomplete` would hand out Pro to anybody
           who started a checkout and abandoned it. */
        if (created.status == "active" || created.status == "trialing") {
            repo.applyPlanToAccount(accountId, planCode, created.status)
        }

        log.info("[billing] account {} subscribed to {} ({} via {})",
            accountId, planCode, created.status, provider.id)
        return repo.liveSubscription(accountId) ?: error("subscription $id vanished after creation")
    }

    // ── Change plan ───────────────────────────────────────────────────────────

    /**
     * Upgrade or downgrade.
     *
     * ── UPGRADES APPLY NOW; DOWNGRADES APPLY AT PERIOD END ──────────────────
     * An upgrade is something the customer wants immediately and has agreed to
     * pay for, so it is prorated and the entitlement moves at once.
     *
     * A downgrade is not applied immediately, and that is a deliberate product
     * decision with a technical consequence: dropping the plan mid-period would
     * shorten RETENTION, and S2's sweeper would then delete traces the customer
     * had already paid to keep. Waiting for period end means the plan change goes
     * through the same path a cancellation does, where the downgrade grace
     * already protects the data.
     */
    fun changePlan(accountId: UUID, planCode: String, interval: String = "month"): BillingRepository.Subscription {
        val account = repo.account(accountId) ?: throw ApiError.NotFound("Billing account")
        val sub = repo.liveSubscription(accountId)
            ?: throw ApiError.ValidationError("This account has no subscription to change.")

        val currency = account.currency
            ?: throw ApiError.ValidationError("This account has no billing currency yet.")

        val provider = providers.forAccount(account)
        val newPrice = repo.price(planCode, currency, interval, provider.id)
            ?: throw ApiError.ValidationError("The $planCode plan has no price in $currency.")
        val currentPrice = repo.price(sub.planCode, currency, interval, provider.id)

        val isUpgrade = (currentPrice?.unitAmountMinor ?: 0) < newPrice.unitAmountMinor

        val externalId = sub.externalId
        if (externalId != null && provider.isLive) {
            val changed = when (val r = provider.changeSubscriptionPlan(
                externalId,
                SubscriptionRequest(
                    accountId = accountId.toString(),
                    externalCustomerId = account.externalCustomerId ?: "",
                    externalPriceId = newPrice.externalPriceId ?: "noop_price_${newPrice.id}",
                    quantity = account.seats,
                    trialDays = null,
                    currency = currency,
                    idempotencyKey = "chg:$accountId:$planCode:$interval",
                ),
                prorate = isUpgrade,
            )) {
                is BillingResult.Success -> r.value
                is BillingResult.Failure -> throw providerError(r)
            }

            /* THE EXTERNAL ID MAY HAVE CHANGED. Razorpay cancels and recreates,
               so storing whatever came back is not defensive — it is the only
               correct thing to do, and keeping the old id would silently detach
               this account from its own webhooks. */
            repo.applyProviderSubscription(sub.id, changed, occurredAt = null)
        }

        updatePlanCode(sub.id, planCode, newPrice.id)

        if (isUpgrade) {
            repo.applyPlanToAccount(accountId, planCode, sub.status)
            log.info("[billing] account {} upgraded {} -> {}", accountId, sub.planCode, planCode)
        } else {
            /* The entitlement stays until period end. `billing_settle_ended_...`
               does not cover a downgrade, so the plan is recorded on the
               subscription and applied when the period rolls — see
               `applyScheduledDowngrades`. */
            log.info("[billing] account {} scheduled downgrade {} -> {} at period end",
                accountId, sub.planCode, planCode)
        }

        return repo.liveSubscription(accountId) ?: sub
    }

    // ── Cancel ────────────────────────────────────────────────────────────────

    /**
     * Cancel, at period end by default (§5).
     *
     * The entitlement is untouched here. `billing_settle_ended_subscriptions()`
     * moves the account to `free` once `current_period_end` passes, which in turn
     * opens S2's retention grace — so a customer who cancels keeps both their
     * plan and their data for the period they paid for, and then gets the normal
     * downgrade protection.
     */
    fun cancel(accountId: UUID, immediately: Boolean = false): BillingRepository.Subscription {
        val account = repo.account(accountId) ?: throw ApiError.NotFound("Billing account")
        val sub = repo.liveSubscription(accountId)
            ?: throw ApiError.ValidationError("This account has no subscription to cancel.")

        val provider = providers.forAccount(account)
        val externalId = sub.externalId

        if (externalId != null && provider.isLive) {
            when (val r = provider.cancelSubscription(externalId, immediately)) {
                is BillingResult.Success -> repo.applyProviderSubscription(sub.id, r.value, null)
                is BillingResult.Failure -> throw providerError(r)
            }
        } else {
            markCancelling(sub.id, immediately)
        }

        if (immediately) {
            repo.applyPlanToAccount(accountId, "free", "canceled")
        }

        log.info("[billing] account {} cancelled ({})",
            accountId, if (immediately) "immediately" else "at period end")
        return repo.liveSubscription(accountId) ?: sub
    }

    // ── Payment methods ───────────────────────────────────────────────────────

    /**
     * A hosted session for adding a payment method.
     *
     * The only way to add one. There is no endpoint that accepts a card number,
     * and there is nowhere in the schema to put one — which is what keeps this
     * out of PCI scope structurally rather than by policy.
     */
    fun setupSession(accountId: UUID, returnUrl: String): HostedSession {
        val account = repo.account(accountId) ?: throw ApiError.NotFound("Billing account")
        val provider = providers.forAccount(account)

        val customerId = when (val r = provider.ensureCustomer(CustomerRequest(
            accountId = accountId.toString(),
            email = account.billingEmail,
            name = account.name,
            country = account.country,
            currency = account.currency,
            existingExternalId = account.externalCustomerId,
        ))) {
            is BillingResult.Success -> r.value
            is BillingResult.Failure -> throw providerError(r)
        }

        return when (val r = provider.createSetupSession(
            SetupSessionRequest(accountId.toString(), customerId, returnUrl,
                account.currency ?: "USD")
        )) {
            is BillingResult.Success -> r.value
            is BillingResult.Failure -> throw providerError(r)
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * A provider failure, as an API error the caller can act on.
     *
     * Retryable becomes 503 and permanent becomes 422, because the two ask
     * different things of the caller: try again shortly, versus this will never
     * work as asked. The provider's own message is included — it is written for
     * a developer and is usually the fastest route to the actual problem — but
     * never its raw error object, which can carry ids we do not want to echo.
     */
    private fun providerError(f: BillingResult.Failure): ApiError =
        if (f.retryable) {
            ApiError.ServiceUnavailable(
                "The payment provider is not responding. Nothing was charged — please try again shortly.")
        } else {
            ApiError.UnprocessableEntity("The payment provider refused this request: ${f.message}")
        }

    /**
     * The SUBSCRIPTION's record of what it is for — not the account's
     * entitlement.
     *
     * The two move at different times, and conflating them is how a scheduled
     * downgrade grants the lower plan immediately. `applyPlanToAccount` is the
     * only thing that changes what a customer can do.
     */
    private fun updatePlanCode(subscriptionId: UUID, planCode: String, priceId: UUID) {
        exec(
            "UPDATE subscriptions SET plan_code = ?, plan_price_id = ?, updated_at = now() WHERE id = ?",
            planCode, priceId, subscriptionId,
        )
    }

    private fun markCancelling(subscriptionId: UUID, immediately: Boolean) {
        exec(
            """UPDATE subscriptions
                  SET cancel_at_period_end = ?, canceled_at = now(),
                      status = CASE WHEN ? THEN 'canceled' ELSE status END,
                      ended_at = CASE WHEN ? THEN now() ELSE ended_at END,
                      updated_at = now()
                WHERE id = ?""",
            !immediately, immediately, immediately, subscriptionId,
        )
    }

    private fun exec(sql: String, vararg args: Any?) {
        ds.connection.use { c ->
            c.prepareStatement(sql).use { st ->
                args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
                st.executeUpdate()
            }
        }
    }
}
