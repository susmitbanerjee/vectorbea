package com.vectorbea.api.billing

import org.slf4j.LoggerFactory

/**
 * Which provider serves which account — the "switching providers is a config
 * change" requirement, made concrete.
 *
 * ── PER-ACCOUNT, NOT GLOBAL ─────────────────────────────────────────────────
 * `billing_accounts.provider` decides, because both providers run at once:
 * Razorpay for India, Stripe everywhere else. A single global setting would make
 * that impossible and would have to be discovered the week India launched.
 *
 * ── AND EVERYTHING IS OPTIONAL ──────────────────────────────────────────────
 * A provider with no credentials is not constructed, and an account naming it
 * falls back to [NoopBillingProvider]. That is what lets the whole system ship
 * switched off: no keys, no live provider, every call succeeds inertly, and the
 * domain still exercises end to end.
 *
 * The fallback is logged at WARN once per lookup rather than silently, because
 * "we thought billing was live" is a discovery that should not wait for a
 * missing invoice.
 */
class BillingProviderRegistry(
    private val stripe: BillingProvider? = null,
    private val razorpay: BillingProvider? = null,
    private val noop: BillingProvider = NoopBillingProvider(),
) {
    private val log = LoggerFactory.getLogger(BillingProviderRegistry::class.java)

    /** True when at least one live provider is configured. */
    val anyLive: Boolean get() = stripe != null || razorpay != null

    fun byId(id: String?): BillingProvider = when (id) {
        "stripe" -> stripe ?: fallback("stripe")
        "razorpay" -> razorpay ?: fallback("razorpay")
        else -> noop
    }

    fun forAccount(account: BillingRepository.Account): BillingProvider = byId(account.provider)

    private fun fallback(requested: String): BillingProvider {
        log.warn("[billing] account asks for '{}' but it is not configured — using noop. " +
            "No money will move. Set the provider's credentials to enable it.", requested)
        return noop
    }

    companion object {
        /**
         * Build from the environment.
         *
         * ── OFF UNLESS FULLY CONFIGURED ─────────────────────────────────────
         * A provider needs BOTH its API credentials and its webhook secret
         * before it is constructed. Half-configured is the dangerous state: with
         * an API key and no webhook secret, subscriptions would be created at the
         * provider and every state change afterwards would be rejected as
         * unsigned — money moving with no record of it moving.
         *
         * So a missing webhook secret disables the provider entirely, loudly.
         */
        fun fromEnv(): BillingProviderRegistry {
            val log = LoggerFactory.getLogger(BillingProviderRegistry::class.java)

            val stripeKey = System.getenv("STRIPE_SECRET_KEY")?.takeIf { it.isNotBlank() }
            val stripeHook = System.getenv("STRIPE_WEBHOOK_SECRET")?.takeIf { it.isNotBlank() }
            val stripe = when {
                stripeKey != null && stripeHook != null -> StripeBillingProvider(stripeKey, stripeHook)
                stripeKey != null -> {
                    log.error("[billing] STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is not — " +
                        "Stripe is DISABLED. Half-configured means charges with no record of them.")
                    null
                }
                else -> null
            }

            val rzId = System.getenv("RAZORPAY_KEY_ID")?.takeIf { it.isNotBlank() }
            val rzSecret = System.getenv("RAZORPAY_KEY_SECRET")?.takeIf { it.isNotBlank() }
            val rzHook = System.getenv("RAZORPAY_WEBHOOK_SECRET")?.takeIf { it.isNotBlank() }
            val razorpay = when {
                rzId != null && rzSecret != null && rzHook != null ->
                    RazorpayBillingProvider(rzId, rzSecret, rzHook)
                rzId != null -> {
                    log.error("[billing] RAZORPAY_KEY_ID is set but the secret or webhook secret is " +
                        "not — Razorpay is DISABLED.")
                    null
                }
                else -> null
            }

            if (stripe == null && razorpay == null) {
                log.info("[billing] no provider configured — running on noop. " +
                    "The billing domain is live and inert; nothing will be charged.")
            }
            return BillingProviderRegistry(stripe, razorpay)
        }
    }
}
