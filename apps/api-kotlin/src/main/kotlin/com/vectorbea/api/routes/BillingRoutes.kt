package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.billing.BillingProviderRegistry
import com.vectorbea.api.billing.BillingRepository
import com.vectorbea.api.billing.BillingService
import com.vectorbea.api.billing.WebhookProcessor
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.toJson
import org.slf4j.LoggerFactory

/**
 * The billing surface: what a plan costs, what this account is on, and the four
 * actions that change it.
 *
 * ── EVERY PRICE COMES FROM `plan_prices` ────────────────────────────────────
 * Nothing here or in the UI hardcodes an amount. The plan-comparison endpoint
 * returns minor units and a currency code and the client formats them, so
 * re-pricing is an UPDATE and a price on a screen can never disagree with the
 * invoice.
 *
 * ── AND NO CLIENT CLAIM ABOUT A PLAN IS TRUSTED ─────────────────────────────
 * The request body carries a plan CODE. It never carries a price, an amount, an
 * entitlement or a currency: the price is looked up for the account's own
 * currency, and the entitlements come from the catalogue. A caller can ask to be
 * on Pro; they cannot say what Pro costs or includes.
 *
 * ── BEHIND A FLAG THAT IS OFF ───────────────────────────────────────────────
 * The routes are always registered — an endpoint that only exists when a flag is
 * on is an endpoint nobody tests. What the flag gates is the UI. With no provider
 * configured every action runs against the noop provider and changes our schema
 * without charging anybody, which is exactly what makes the whole thing testable
 * before there is a bank account.
 */
class BillingRoutes(
    private val repo: BillingRepository,
    private val service: BillingService,
    private val providers: BillingProviderRegistry,
    private val webhooks: WebhookProcessor,
) {
    private val log = LoggerFactory.getLogger(BillingRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/billing", ::summary)
        router.get("/api/billing/plans", ::plans)
        router.get("/api/billing/invoices", ::invoices)
        router.get("/api/billing/payment-methods", ::paymentMethods)

        router.post("/api/billing/subscribe", ::subscribe)
        router.post("/api/billing/change-plan", ::changePlan)
        router.post("/api/billing/cancel", ::cancel)
        router.post("/api/billing/setup-session", ::setupSession)

        /* Public — a provider has no JWT. Authenticated by SIGNATURE instead,
           which `WebhookProcessor` verifies before anything is stored. The path
           sits under `/api/billing/webhooks` and is listed in AuthMiddleware's
           public set for exactly that reason. */
        router.post("/api/billing/webhooks/:provider", ::webhook)
    }

    // ── Reads ─────────────────────────────────────────────────────────────────

    /**
     * Everything the billing screen needs, in one call.
     *
     * Includes the dunning state with DATES, because §5's "warnings" have to say
     * when — and the date has to come from the same function the enforcement
     * uses or the two will disagree.
     */
    private fun summary(req: Request): Response {
        val ctx = req.context()
        val account = repo.accountForWorkspace(ctx.workspaceId)
            ?: throw ApiError.NotFound("Billing account")

        val sub = repo.liveSubscription(account.id)
        val dunning = repo.dunningState(account.id)
        val provider = providers.forAccount(account)

        return Response.ok(mapOf(
            "accountId" to account.id.toString(),
            "planCode" to account.planCode,
            "currency" to account.currency,
            "country" to account.country,
            /* So the UI can say "billing is not configured" honestly rather than
               rendering a subscribe button that would do nothing visible. */
            "providerLive" to provider.isLive,
            "subscription" to sub?.let {
                mapOf(
                    "id" to it.id.toString(),
                    "planCode" to it.planCode,
                    "status" to it.status,
                    "quantity" to it.quantity,
                    "trialEnd" to it.trialEnd?.toString(),
                    "currentPeriodStart" to it.currentPeriodStart?.toString(),
                    "currentPeriodEnd" to it.currentPeriodEnd?.toString(),
                    "cancelAtPeriodEnd" to it.cancelAtPeriodEnd,
                )
            },
            "dunning" to mapOf(
                "stage" to dunning.stage,
                "daysPastDue" to dunning.daysPastDue,
                "nextStepAt" to dunning.nextStepAt?.toString(),
                "restricted" to dunning.restricted,
            ),
        ))
    }

    /**
     * The plan comparison, priced in the account's currency.
     *
     * Minor units and a currency code, never a formatted string: formatting is
     * the client's job and a server-rendered "₹1,999" cannot be localised by it.
     */
    private fun plans(req: Request): Response {
        val ctx = req.context()
        val account = repo.accountForWorkspace(ctx.workspaceId)
        val currency = req.query("currency")?.uppercase()
            ?: account?.currency
            ?: service.defaultCurrencyFor(account?.country)
        val interval = req.query("interval") ?: "month"

        val prices = repo.pricesFor(currency, interval)
        return Response.ok(mapOf(
            "currency" to currency,
            "interval" to interval,
            "plans" to prices.map {
                mapOf(
                    "planCode" to it.planCode,
                    "unitAmountMinor" to it.unitAmountMinor,
                    "currency" to it.currency,
                    "interval" to it.interval,
                    "taxBehavior" to it.taxBehavior,
                )
            },
            /* So the page can mark the current one without a second call, and
               without the client deciding what "current" means. */
            "currentPlanCode" to account?.planCode,
        ))
    }

    private fun invoices(req: Request): Response {
        val account = repo.accountForWorkspace(req.context().workspaceId)
            ?: throw ApiError.NotFound("Billing account")
        return Response.ok(mapOf("invoices" to repo.invoices(account.id)))
    }

    private fun paymentMethods(req: Request): Response {
        val account = repo.accountForWorkspace(req.context().workspaceId)
            ?: throw ApiError.NotFound("Billing account")
        return Response.ok(mapOf("paymentMethods" to repo.paymentMethods(account.id)))
    }

    // ── Actions ───────────────────────────────────────────────────────────────

    private data class PlanBody(val planCode: String?, val interval: String?, val trialDays: Int?)

    private fun subscribe(req: Request): Response {
        val account = repo.accountForWorkspace(req.context().workspaceId)
            ?: throw ApiError.NotFound("Billing account")
        val body = req.bodyAs<PlanBody>()
        val plan = body.planCode?.trim()?.takeIf { it.isNotEmpty() }
            ?: throw ApiError.ValidationError("'planCode' is required")

        val sub = service.subscribe(account.id, plan, body.interval ?: "month", body.trialDays)
        return Response.ok(mapOf("subscriptionId" to sub.id.toString(), "status" to sub.status))
    }

    private fun changePlan(req: Request): Response {
        val account = repo.accountForWorkspace(req.context().workspaceId)
            ?: throw ApiError.NotFound("Billing account")
        val body = req.bodyAs<PlanBody>()
        val plan = body.planCode?.trim()?.takeIf { it.isNotEmpty() }
            ?: throw ApiError.ValidationError("'planCode' is required")

        val sub = service.changePlan(account.id, plan, body.interval ?: "month")
        return Response.ok(mapOf(
            "subscriptionId" to sub.id.toString(),
            "planCode" to sub.planCode,
            "status" to sub.status,
        ))
    }

    private fun cancel(req: Request): Response {
        val account = repo.accountForWorkspace(req.context().workspaceId)
            ?: throw ApiError.NotFound("Billing account")

        data class Body(val immediately: Boolean?)
        val immediately = runCatching { req.bodyAs<Body>().immediately }.getOrNull() ?: false

        val sub = service.cancel(account.id, immediately)
        return Response.ok(mapOf(
            "status" to sub.status,
            "cancelAtPeriodEnd" to sub.cancelAtPeriodEnd,
            "endsAt" to sub.currentPeriodEnd?.toString(),
            "message" to if (immediately)
                "Your subscription has ended."
            else
                "Your subscription will end on ${sub.currentPeriodEnd?.toString()?.take(10)}. " +
                    "You keep everything until then.",
        ))
    }

    private fun setupSession(req: Request): Response {
        val account = repo.accountForWorkspace(req.context().workspaceId)
            ?: throw ApiError.NotFound("Billing account")

        data class Body(val returnUrl: String?)
        val returnUrl = runCatching { req.bodyAs<Body>().returnUrl }.getOrNull()
            ?: throw ApiError.ValidationError("'returnUrl' is required")

        val session = service.setupSession(account.id, returnUrl)
        return Response.ok(mapOf(
            /* A URL or a client secret — never anything a card would touch. The
               browser goes to the provider's own hosted element from here. */
            "url" to session.url,
            "clientSecret" to session.clientSecret,
            "expiresAt" to session.expiresAt?.toString(),
        ))
    }

    // ── Webhook ───────────────────────────────────────────────────────────────

    /**
     * Receive a webhook.
     *
     * ── ALWAYS 200 EXCEPT ON A BAD SIGNATURE ────────────────────────────────
     * A provider retries anything that is not a 2xx, with backoff, for days. So
     * an event we stored and deliberately ignored must return 200 — returning
     * anything else would have the provider redeliver an event we have already
     * decided about, forever.
     *
     * A bad signature returns 400 and stores nothing: that is not a delivery
     * problem, it is an unauthenticated request, and the provider should not
     * retry it.
     *
     * A handler failure returns 500 ON PURPOSE, so the provider does retry —
     * that is the only free redelivery mechanism we have, and the idempotency
     * record makes the retry safe.
     */
    private fun webhook(req: Request): Response {
        val providerId = req.pathParams["provider"] ?: ""
        val provider = providers.byId(providerId)

        if (!provider.isLive) {
            /* No provider configured, so nothing can legitimately be delivering
               to us. 404 rather than 200: a 200 would tell whoever is probing
               that the endpoint is real and listening. */
            log.warn("[billing] webhook for unconfigured provider '{}'", providerId)
            throw ApiError.NotFound("Webhook endpoint")
        }

        /* THE RAW BODY. Not re-serialised, not parsed and rebuilt — the exact
           bytes, or the signature will not verify. */
        val outcome = webhooks.handle(provider, req.body, req.headers)

        return when (outcome) {
            WebhookProcessor.Outcome.REJECTED ->
                Response(400, toJson(mapOf("error" to "invalid signature")),
                    mapOf("Content-Type" to "application/json; charset=utf-8"))

            WebhookProcessor.Outcome.FAILED ->
                Response(500, toJson(mapOf("error" to "handler failed; please redeliver")),
                    mapOf("Content-Type" to "application/json; charset=utf-8"))

            else -> Response.ok(mapOf("received" to true, "outcome" to outcome.name.lowercase()))
        }
    }
}
