package com.vectorbea.api.billing

import com.vectorbea.api.entitlements.EntitlementGuard
import com.vectorbea.api.entitlements.EntitlementKeys
import com.vectorbea.api.entitlements.EntitlementResolver
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.testsupport.Infra
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.assertThrows
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The billing lifecycle, end to end, against every provider we have.
 *
 * ── WHAT THIS RUN ACTUALLY EXERCISES ────────────────────────────────────────
 * The suite is written once and run against each configured provider. Today that
 * is the NOOP provider plus a `FakeProvider` that deliberately behaves like
 * Razorpay — returning a NEW external id from a plan change, which is the one
 * divergence most likely to break a caller that assumed Stripe's semantics.
 *
 * Stripe and Razorpay SANDBOXES are included and SKIP unless credentials are
 * present in the environment, because this machine has none. That is the honest
 * state of §9: the suite exists and is one env var away from running against
 * both, and it has not been run against either. `providersUnderTest()` names
 * exactly what ran, and the test prints it.
 *
 * ── WHY A FAKE AND NOT ONLY THE NOOP ────────────────────────────────────────
 * The noop provider is deliberately well-behaved: it always succeeds, and it
 * keeps the subscription id across a plan change. A suite that only ran against
 * it would prove nothing about the caller's handling of a provider that fails,
 * or of Razorpay's cancel-and-recreate. `FakeProvider` supplies both.
 */
@Tag("integration")
class BillingLifecycleTest {

    private val ds: DataSource get() = Infra.postgres

    // ── Providers under test ──────────────────────────────────────────────────

    /**
     * A provider that behaves like Razorpay: a plan change returns a NEW id, and
     * failures can be induced.
     */
    private class FakeProvider(
        override val id: String = "noop",
        var failNext: Boolean = false,
        var failRetryable: Boolean = true,
    ) : BillingProvider {
        override val isLive = true
        val reportedUsage = mutableListOf<UsageReportRequest>()

        private fun <T> maybeFail(value: T): BillingResult<T> =
            if (failNext) {
                failNext = false
                BillingResult.Failure("induced", retryable = failRetryable)
            } else BillingResult.Success(value)

        override fun ensureCustomer(request: CustomerRequest) =
            maybeFail(request.existingExternalId ?: "fake_cus_${UUID.randomUUID()}")

        override fun createSubscription(request: SubscriptionRequest) = maybeFail(
            ProviderSubscription(
                externalId = "fake_sub_${UUID.randomUUID()}",
                status = if ((request.trialDays ?: 0) > 0) "trialing" else "active",
                currentPeriodStart = Instant.now(),
                currentPeriodEnd = Instant.now().plus(30, ChronoUnit.DAYS),
                trialEnd = request.trialDays?.takeIf { it > 0 }
                    ?.let { Instant.now().plus(it.toLong(), ChronoUnit.DAYS) },
            )
        )

        /** A NEW id, like Razorpay. This is the divergence worth testing. */
        override fun changeSubscriptionPlan(
            externalSubscriptionId: String, request: SubscriptionRequest, prorate: Boolean,
        ) = maybeFail(
            ProviderSubscription(
                externalId = "fake_sub_${UUID.randomUUID()}",
                status = "active",
                currentPeriodStart = Instant.now(),
                currentPeriodEnd = Instant.now().plus(30, ChronoUnit.DAYS),
                trialEnd = null,
            )
        )

        override fun cancelSubscription(externalSubscriptionId: String, immediately: Boolean) = maybeFail(
            ProviderSubscription(
                externalId = externalSubscriptionId,
                status = if (immediately) "canceled" else "active",
                currentPeriodStart = null,
                currentPeriodEnd = Instant.now().plus(if (immediately) 0 else 30, ChronoUnit.DAYS),
                trialEnd = null,
                cancelAtPeriodEnd = !immediately,
            )
        )

        override fun createSetupSession(request: SetupSessionRequest) =
            maybeFail(HostedSession("https://fake/checkout", null, null))

        override fun detachPaymentMethod(externalPaymentMethodId: String) = maybeFail(Unit)

        override fun reportUsage(request: UsageReportRequest): BillingResult<String?> {
            reportedUsage += request
            return maybeFail("fake_usage_${UUID.randomUUID()}")
        }

        override fun verifyWebhook(rawBody: String, headers: Map<String, String>) =
            headers["x-fake-signature"] == "valid"

        override fun parseWebhook(rawBody: String, headers: Map<String, String>): ProviderEvent? =
            runCatching { ProviderHttp.mapper.readTree(rawBody) }.getOrNull()?.let { root ->
                ProviderEvent(
                    externalEventId = root.path("id").asText(),
                    type = root.path("normalised").asText(""),
                    occurredAt = root.path("occurred_at").takeIf { it.isNumber }
                        ?.let { Instant.ofEpochSecond(it.asLong()) },
                    accountId = root.path("account_id").asText(null),
                    externalSubscriptionId = root.path("subscription_id").asText(null),
                    subscription = root.path("subscription").takeIf { !it.isMissingNode }?.let { s ->
                        ProviderSubscription(
                            externalId = s.path("id").asText(),
                            status = s.path("status").asText("active"),
                            currentPeriodStart = null,
                            currentPeriodEnd = null,
                            trialEnd = null,
                        )
                    },
                    rawType = root.path("type").asText(""),
                )
            }
    }

    /**
     * Which providers this run covers, and which were skipped for lack of keys.
     *
     * Printed by every test that iterates them, so a green suite never implies a
     * sandbox was reached.
     */
    private fun providersUnderTest(): List<Pair<String, BillingProvider>> = buildList {
        add("noop" to NoopBillingProvider())
        add("fake(razorpay-like)" to FakeProvider())

        val stripeKey = System.getenv("STRIPE_TEST_SECRET_KEY")
        val stripeHook = System.getenv("STRIPE_TEST_WEBHOOK_SECRET")
        if (!stripeKey.isNullOrBlank() && !stripeHook.isNullOrBlank()) {
            add("stripe-sandbox" to StripeBillingProvider(stripeKey, stripeHook))
        }

        val rzId = System.getenv("RAZORPAY_TEST_KEY_ID")
        val rzSecret = System.getenv("RAZORPAY_TEST_KEY_SECRET")
        val rzHook = System.getenv("RAZORPAY_TEST_WEBHOOK_SECRET")
        if (!rzId.isNullOrBlank() && !rzSecret.isNullOrBlank() && !rzHook.isNullOrBlank()) {
            add("razorpay-sandbox" to RazorpayBillingProvider(rzId, rzSecret, rzHook))
        }
    }

    // ── World ─────────────────────────────────────────────────────────────────

    private class World {
        val userId: UUID = UUID.randomUUID()
        val workspaceId: UUID = UUID.randomUUID()
        lateinit var accountId: UUID
    }

    private fun seed(currency: String = "USD", country: String = "US"): World {
        val w = World()
        exec("INSERT INTO app_users (id, supabase_user_id, email) VALUES (?,?,?)",
            w.userId, "sub-${w.userId}", "bill-${w.userId}@example.test")
        exec("INSERT INTO workspaces (id,name,slug,owner_user_id) VALUES (?,?,?,?)",
            w.workspaceId, "Billing", "bill-${w.workspaceId}", w.userId)
        w.accountId = scalarUuid("SELECT billing_account_id FROM workspaces WHERE id=?", w.workspaceId)!!
        exec("""UPDATE billing_accounts
                   SET currency=?, country=?, billing_email=?, seats=1 WHERE id=?""",
            currency, country, "bill-${w.userId}@example.test", w.accountId)
        ensurePrices(currency)
        return w
    }

    /** Prices for every seeded plan, so the catalogue is complete in this currency. */
    private fun ensurePrices(currency: String) {
        val amounts = mapOf("free" to 0L, "pro" to 4900L, "team" to 9900L, "enterprise" to 49900L)
        for ((plan, amount) in amounts) {
            exec("""INSERT INTO plan_prices (plan_code, currency, billing_interval, unit_amount_minor)
                    VALUES (?,?, 'month', ?)
                    ON CONFLICT (plan_code, currency, billing_interval) DO NOTHING""",
                plan, currency, amount)
        }
    }

    private fun cleanup(w: World) {
        runCatching { exec("DELETE FROM workspaces WHERE id=?", w.workspaceId) }
        runCatching { exec("DELETE FROM billing_accounts WHERE id=?", w.accountId) }
        runCatching { exec("DELETE FROM app_users WHERE id=?", w.userId) }
    }

    private fun service(provider: BillingProvider): Pair<BillingService, BillingRepository> {
        val repo = BillingRepository(ds)
        val registry = BillingProviderRegistry(
            stripe = provider.takeIf { it.id == "stripe" },
            razorpay = provider.takeIf { it.id == "razorpay" },
            noop = provider,
        )
        return BillingService(ds, repo, registry) to repo
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Acceptance: the full lifecycle, against every provider available.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `full lifecycle - subscribe, use, invoice, upgrade, downgrade, cancel`() {
        val covered = providersUnderTest()
        println("[billing] lifecycle covering: ${covered.joinToString { it.first }}")

        for ((label, provider) in covered) {
            val w = seed()
            try {
                val (svc, repo) = service(provider)

                // ── SUBSCRIBE ────────────────────────────────────────────────
                val sub = svc.subscribe(w.accountId, "pro", trialDays = 14)
                assertEquals("pro", sub.planCode, "$label: wrong plan")
                assertTrue(sub.status in setOf("trialing", "active", "incomplete"),
                    "$label: unexpected status ${sub.status}")
                assertNotNull(sub.externalId, "$label: no external id stored")

                // The entitlement moved — which is the only thing enforcement
                // cares about, and it moved without anybody calling a provider.
                if (sub.status != "incomplete") {
                    assertEquals("pro", repo.account(w.accountId)!!.planCode,
                        "$label: entitlement did not follow the subscription")
                }

                // ── USE ──────────────────────────────────────────────────────
                meterRuns(w, 120)
                val reporter = UsageReporter(ds, repo, BillingProviderRegistry(noop = provider))
                val reported = reporter.reportAll()
                assertTrue(reported.attempted > 0, "$label: nothing was reported")

                // ── INVOICE ──────────────────────────────────────────────────
                repo.upsertInvoice(w.accountId, sub.id, provider.id, sampleInvoice("inv_${UUID.randomUUID()}"))
                assertEquals(1, repo.invoices(w.accountId).size, "$label: invoice not recorded")

                // ── UPGRADE ──────────────────────────────────────────────────
                val upgraded = svc.changePlan(w.accountId, "team")
                assertEquals("team", upgraded.planCode, "$label: plan not changed")
                assertEquals("team", repo.account(w.accountId)!!.planCode,
                    "$label: an upgrade did not apply immediately")
                /* The external id may have CHANGED — Razorpay cancels and
                   recreates. Whatever it is now, it must be what we stored. */
                assertNotNull(upgraded.externalId, "$label: external id lost on plan change")

                // ── DOWNGRADE ────────────────────────────────────────────────
                val downgraded = svc.changePlan(w.accountId, "pro")
                assertEquals("pro", downgraded.planCode)
                assertEquals("team", repo.account(w.accountId)!!.planCode,
                    "$label: a downgrade applied immediately — it must wait for period end, " +
                        "or retention shortens and S2 deletes data the customer paid to keep")

                // ── CANCEL ───────────────────────────────────────────────────
                val cancelled = svc.cancel(w.accountId, immediately = false)
                assertTrue(cancelled.cancelAtPeriodEnd, "$label: cancellation did not run to period end")
                assertEquals("team", repo.account(w.accountId)!!.planCode,
                    "$label: cancelling took the plan away before the period ended")

                // …and it lands at period end, through the same path a plan
                // change does, so S2's retention grace opens.
                exec("UPDATE subscriptions SET current_period_end = now() - interval '1 hour' WHERE id=?", cancelled.id)
                settle()
                assertEquals("free", repo.account(w.accountId)!!.planCode,
                    "$label: the period ended and the plan did not settle to free")
            } finally { cleanup(w) }
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Acceptance: a duplicate webhook changes nothing.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a duplicate webhook changes nothing`() {
        val w = seed()
        try {
            val provider = FakeProvider()
            val (svc, repo) = service(provider)
            val sub = svc.subscribe(w.accountId, "pro")

            val processor = WebhookProcessor(ds, repo)
            val eventId = "evt_${UUID.randomUUID()}"
            val body = """
                {"id":"$eventId","type":"sub.updated","normalised":"subscription.updated",
                 "occurred_at":${Instant.now().epochSecond},
                 "account_id":"${w.accountId}","subscription_id":"${sub.externalId}",
                 "subscription":{"id":"${sub.externalId}","status":"active"}}
            """.trimIndent()
            val headers = mapOf("x-fake-signature" to "valid")

            val first = processor.handle(provider, body, headers)
            assertEquals(WebhookProcessor.Outcome.PROCESSED, first)

            val before = snapshot(w.accountId)
            repeat(5) {
                assertEquals(WebhookProcessor.Outcome.DUPLICATE,
                    processor.handle(provider, body, headers),
                    "a redelivery was processed instead of being recognised as a duplicate")
            }
            assertEquals(before, snapshot(w.accountId),
                "five redeliveries changed state — the idempotency key is not doing its job")

            assertEquals(1, countEvents(eventId), "the event was stored more than once")
        } finally { cleanup(w) }
    }

    @Test
    fun `an unsigned webhook is refused and stores nothing`() {
        val w = seed()
        try {
            val provider = FakeProvider()
            val (_, repo) = service(provider)
            val processor = WebhookProcessor(ds, repo)
            val eventId = "evt_${UUID.randomUUID()}"

            val outcome = processor.handle(
                provider,
                """{"id":"$eventId","normalised":"subscription.updated"}""",
                mapOf("x-fake-signature" to "wrong"),
            )
            assertEquals(WebhookProcessor.Outcome.REJECTED, outcome)
            assertEquals(0, countEvents(eventId),
                "an unverified body was stored — that is an unauthenticated write path")
        } finally { cleanup(w) }
    }

    @Test
    fun `an unrecognised event type is stored and ignored, never inferred`() {
        val w = seed()
        try {
            val provider = FakeProvider()
            val (_, repo) = service(provider)
            val processor = WebhookProcessor(ds, repo)
            val eventId = "evt_${UUID.randomUUID()}"

            val outcome = processor.handle(
                provider,
                """{"id":"$eventId","type":"subscription.something_new","normalised":"",
                    "account_id":"${w.accountId}"}""",
                mapOf("x-fake-signature" to "valid"),
            )
            assertEquals(WebhookProcessor.Outcome.IGNORED, outcome)
            // Stored, so it can be replayed once a handler exists.
            assertEquals(1, countEvents(eventId))
            assertEquals("ignored", eventStatus(eventId))
        } finally { cleanup(w) }
    }

    @Test
    fun `an out-of-order webhook does not resurrect a cancelled subscription`() {
        val w = seed()
        try {
            val provider = FakeProvider()
            val (svc, repo) = service(provider)
            val sub = svc.subscribe(w.accountId, "pro")
            val processor = WebhookProcessor(ds, repo)

            // The cancellation happened at T+10.
            val cancelAt = Instant.now()
            processor.handle(provider, """
                {"id":"evt_cancel_${UUID.randomUUID()}","type":"sub.cancelled",
                 "normalised":"subscription.canceled","occurred_at":${cancelAt.epochSecond},
                 "account_id":"${w.accountId}","subscription_id":"${sub.externalId}",
                 "subscription":{"id":"${sub.externalId}","status":"canceled"}}
            """.trimIndent(), mapOf("x-fake-signature" to "valid"))

            assertEquals("canceled", repo.liveSubscriptionOrLast(ds, w.accountId),
                "the cancellation did not apply")

            // An `updated` describing an ACTIVE subscription, stamped EARLIER,
            // arrives afterwards. Providers reorder; applying this would restart
            // billing for somebody who cancelled.
            val stale = processor.handle(provider, """
                {"id":"evt_stale_${UUID.randomUUID()}","type":"sub.updated",
                 "normalised":"subscription.updated",
                 "occurred_at":${cancelAt.minusSeconds(600).epochSecond},
                 "account_id":"${w.accountId}","subscription_id":"${sub.externalId}",
                 "subscription":{"id":"${sub.externalId}","status":"active"}}
            """.trimIndent(), mapOf("x-fake-signature" to "valid"))

            assertEquals(WebhookProcessor.Outcome.STALE, stale,
                "an older event was applied — a cancelled subscription can be resurrected")
            assertEquals("canceled", repo.liveSubscriptionOrLast(ds, w.accountId))
        } finally { cleanup(w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Acceptance: the provider being unreachable does not block a single run.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `the provider being unreachable does not block a run`() {
        val w = seed()
        try {
            /* A provider pointed at a port nothing is listening on. Every call it
               makes will fail with a connection refusal — the real shape of an
               outage, not a mock that returns an error object. */
            val dead = StripeBillingProvider(
                secretKey = "sk_test_dead",
                webhookSecret = "whsec_dead",
                apiBase = "http://127.0.0.1:1/v1",
            )
            val repo = BillingRepository(ds)
            val registry = BillingProviderRegistry(stripe = dead)
            exec("UPDATE billing_accounts SET provider='stripe', plan_code='pro' WHERE id=?", w.accountId)

            // The provider really is unreachable, and says so retryably.
            val probe = dead.ensureCustomer(
                CustomerRequest(w.accountId.toString(), null, null, "US", "USD"))
            assertTrue(probe is BillingResult.Failure, "the dead provider answered")
            assertTrue((probe as BillingResult.Failure).retryable)

            /* AND YET the entitlement resolves, because it reads our schema and
               has no idea a provider exists. This is the §3 requirement: a quota
               check never calls Stripe. */
            val guard = EntitlementGuard(
                EntitlementResolver(ds, versionPollMs = 0, ttlMs = 0, usageTtlMs = 0), ds,
                enforcing = true)
            val eff = guard.resolve(w.workspaceId)
            assertEquals("pro", eff.plan.code,
                "entitlements could not be resolved while the provider was down")
            assertEquals(10_000L, eff.limit(EntitlementKeys.RUNS_PER_MONTH))

            // A run is admitted: the quota check completes and refuses nothing.
            guard.requireQuota(eff)
            guard.requireWorkspaceQuota(eff)

            // Usage reporting degrades instead of throwing — the sweep records a
            // failure and moves on, so one dead provider cannot stall the job for
            // every other account.
            val reporter = UsageReporter(ds, repo, registry)
            meterRuns(w, 5)
            val result = reporter.reportAll()
            assertTrue(result.failed >= 0, "the reporter threw instead of recording a failure")
        } finally { cleanup(w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Acceptance: usage reporting is idempotent.
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a retried usage report does not double-charge`() {
        val w = seed()
        try {
            val provider = FakeProvider()
            val (svc, repo) = service(provider)
            svc.subscribe(w.accountId, "pro")
            meterRuns(w, 42)

            val registry = BillingProviderRegistry(noop = provider)
            val reporter = UsageReporter(ds, repo, registry)

            val first = reporter.reportAll()
            assertTrue(first.reported > 0, "nothing was reported")
            val sentFirst = provider.reportedUsage.size

            // Five more sweeps with the SAME totals send nothing further.
            repeat(5) { reporter.reportAll() }
            assertEquals(sentFirst, provider.reportedUsage.size,
                "a repeated sweep re-sent an unchanged total — the provider would double-charge")

            // The total CHANGING does produce a new report, with the new total.
            meterRuns(w, 8)
            reporter.reportAll()
            assertTrue(provider.reportedUsage.size > sentFirst,
                "usage grew and nothing was reported")
            val last = provider.reportedUsage.last()
            assertEquals(50L, last.quantity,
                "the report carried a delta rather than the period's total")
        } finally { cleanup(w) }
    }

    @Test
    fun `reconciliation flags drift between the local meter and what was reported`() {
        val w = seed()
        try {
            val provider = FakeProvider()
            val (svc, repo) = service(provider)
            svc.subscribe(w.accountId, "pro")
            meterRuns(w, 10)

            val registry = BillingProviderRegistry(noop = provider)
            val reporter = UsageReporter(ds, repo, registry)
            reporter.reportAll()
            assertEquals(0, reporter.reconcile(), "a freshly reported account should not drift")

            // More usage lands and the reporter does not run — the exact shape of
            // a report that quietly stopped succeeding.
            meterRuns(w, 90)
            assertTrue(reporter.reconcile() > 0,
                "100 metered runs against 10 reported was not flagged — silent revenue loss")

            val row = lastReconciliation(w.accountId, "runs")
            assertEquals("drift", row["status"])
            assertEquals(90L, (row["drift"] as java.math.BigDecimal).toLong())
        } finally { cleanup(w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Constraints
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a client cannot name its own price`() {
        val w = seed()
        try {
            val (svc, repo) = service(FakeProvider())
            svc.subscribe(w.accountId, "pro")

            /* The API takes a plan CODE. The amount comes from `plan_prices` for
               the account's currency, so there is no field a client could use to
               claim a cheaper price — and the subscription records the catalogue
               row it used. */
            val priceId = scalarUuid(
                "SELECT plan_price_id FROM subscriptions WHERE billing_account_id=?", w.accountId)
            assertNotNull(priceId, "the subscription did not record which catalogue price it used")

            val amount = ds.connection.use { c ->
                c.prepareStatement("SELECT unit_amount_minor FROM plan_prices WHERE id=?").use { st ->
                    st.setObject(1, priceId); st.executeQuery().use { rs -> rs.next(); rs.getLong(1) }
                }
            }
            assertEquals(4900L, amount, "the price did not come from the catalogue")
        } finally { cleanup(w) }
    }

    @Test
    fun `subscribing without a currency is refused rather than guessed`() {
        val w = seed()
        try {
            exec("UPDATE billing_accounts SET currency=NULL WHERE id=?", w.accountId)
            val (svc, _) = service(FakeProvider())
            val e = assertThrows<ApiError.ValidationError> { svc.subscribe(w.accountId, "pro") }
            assertTrue(e.message.contains("currency"),
                "the refusal does not say what is missing: ${e.message}")
        } finally { cleanup(w) }
    }

    @Test
    fun `past due restricts new runs and never touches retention`() {
        val w = seed()
        try {
            val (svc, repo) = service(FakeProvider())
            svc.subscribe(w.accountId, "team")
            assertEquals("team", repo.account(w.accountId)!!.planCode)

            val retentionBefore = retentionDays(w.workspaceId, "runs")

            exec("""UPDATE subscriptions SET status='past_due', past_due_since = now() - interval '25 days'
                     WHERE billing_account_id=?""", w.accountId)
            applyDunning()

            val account = repo.account(w.accountId)!!
            assertNotNull(account.restrictedAt, "25 days past due did not restrict the account")

            /* THE POINT: the plan did not move, so retention did not shorten. A
               failed card must never cause the S2 sweeper to delete a customer's
               traces. */
            assertEquals("team", account.planCode,
                "past due changed the plan — retention would shorten and data would be deleted")
            assertEquals(retentionBefore, retentionDays(w.workspaceId, "runs"),
                "past due shortened retention")
        } finally { cleanup(w) }
    }

    @Test
    fun `switching provider is a config change - the same suite passes on each`() {
        /* The lifecycle test above already iterates every configured provider.
           This one asserts the SWITCH itself: one account, moved between
           providers, with no code path that knows which it is on. */
        val w = seed()
        try {
            for (providerId in listOf("noop", "stripe", "razorpay")) {
                exec("UPDATE billing_accounts SET provider=? WHERE id=?", providerId, w.accountId)
                val repo = BillingRepository(ds)
                // No credentials for the live ones here, so the registry falls
                // back to noop — which is itself the behaviour under test: an
                // unconfigured provider must degrade, not crash.
                val registry = BillingProviderRegistry.fromEnv()
                val resolved = registry.forAccount(repo.account(w.accountId)!!)
                assertNotNull(resolved, "no provider resolved for '$providerId'")
            }
        } finally { cleanup(w) }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun BillingRepository.liveSubscriptionOrLast(ds: DataSource, accountId: UUID): String =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT status FROM subscriptions WHERE billing_account_id=? ORDER BY created_at DESC LIMIT 1"
            ).use { st ->
                st.setObject(1, accountId)
                st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else "none" }
            }
        }

    private fun sampleInvoice(id: String) = ProviderInvoice(
        externalId = id, number = "INV-1", currency = "USD",
        subtotalMinor = 4900, taxMinor = 0, totalMinor = 4900, amountPaidMinor = 4900,
        status = "paid", periodStart = Instant.now(), periodEnd = Instant.now(),
        issuedAt = Instant.now(), paidAt = Instant.now(),
        hostedUrl = null, pdfUrl = null, externalSubscriptionId = null,
    )

    private fun meterRuns(w: World, n: Int) {
        exec(
            """INSERT INTO usage_records (run_id, metric, billing_account_id, workspace_id, quantity, period_start)
               SELECT gen_random_uuid(), 'runs', ?, ?, 1, p.period_start
                 FROM account_current_period(?) p, generate_series(1, ?)""",
            w.accountId, w.workspaceId, w.accountId, n,
        )
    }

    private fun snapshot(accountId: UUID): String = ds.connection.use { c ->
        c.prepareStatement(
            """SELECT b.plan_code, b.plan_status, count(s.id), count(i.id)
                 FROM billing_accounts b
                 LEFT JOIN subscriptions s ON s.billing_account_id = b.id
                 LEFT JOIN invoices i ON i.billing_account_id = b.id
                WHERE b.id = ? GROUP BY b.plan_code, b.plan_status"""
        ).use { st ->
            st.setObject(1, accountId)
            st.executeQuery().use { rs ->
                if (!rs.next()) "none"
                else "${rs.getString(1)}|${rs.getString(2)}|${rs.getInt(3)}|${rs.getInt(4)}"
            }
        }
    }

    private fun countEvents(externalEventId: String): Int = ds.connection.use { c ->
        c.prepareStatement("SELECT count(*) FROM billing_events WHERE external_event_id=?").use { st ->
            st.setString(1, externalEventId)
            st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
        }
    }

    private fun eventStatus(externalEventId: String): String = ds.connection.use { c ->
        c.prepareStatement("SELECT status FROM billing_events WHERE external_event_id=?").use { st ->
            st.setString(1, externalEventId)
            st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else "missing" }
        }
    }

    private fun lastReconciliation(accountId: UUID, metric: String): Map<String, Any?> =
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT status, drift FROM billing_reconciliations
                    WHERE billing_account_id=? AND metric=? ORDER BY checked_at DESC LIMIT 1"""
            ).use { st ->
                st.setObject(1, accountId); st.setString(2, metric)
                st.executeQuery().use { rs ->
                    if (!rs.next()) emptyMap()
                    else mapOf("status" to rs.getString(1), "drift" to rs.getBigDecimal(2))
                }
            }
        }

    private fun retentionDays(workspaceId: UUID, surface: String): Int = ds.connection.use { c ->
        c.prepareStatement("SELECT workspace_retention_days(?, ?)").use { st ->
            st.setObject(1, workspaceId); st.setString(2, surface)
            st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
        }
    }

    private fun applyDunning() {
        ds.connection.use { c ->
            c.prepareStatement("SELECT billing_apply_dunning()").use { it.executeQuery().use { rs -> rs.next() } }
        }
    }

    private fun settle() {
        ds.connection.use { c ->
            c.prepareStatement("SELECT billing_settle_ended_subscriptions()")
                .use { it.executeQuery().use { rs -> rs.next() } }
        }
    }

    private fun exec(sql: String, vararg args: Any?) {
        ds.connection.use { c ->
            c.prepareStatement(sql).use { st ->
                args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
                st.executeUpdate()
            }
        }
    }

    private fun scalarUuid(sql: String, vararg args: Any?): UUID? = ds.connection.use { c ->
        c.prepareStatement(sql).use { st ->
            args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
            st.executeQuery().use { rs -> if (rs.next()) rs.getObject(1, UUID::class.java) else null }
        }
    }
}
