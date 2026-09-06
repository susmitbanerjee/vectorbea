package com.vectorbea.api.billing

import org.slf4j.LoggerFactory
import java.math.BigDecimal
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Our billing schema. The only thing anything reads to answer a question.
 *
 * ── EVERY READ IS LOCAL; NO METHOD HERE TALKS TO A PROVIDER ─────────────────
 * That is the §3 requirement made structural: this class has no
 * [BillingProvider] field and could not call one if it wanted to. Webhooks push
 * state in; enforcement, the UI and the invoice history all read out. A provider
 * outage is invisible here.
 *
 * ── AND ENTITLEMENTS ARE UPDATED THROUGH ONE COLUMN ─────────────────────────
 * [applyPlanToAccount] writes `billing_accounts.plan_code`, which is what S3's
 * resolver reads. Billing does not touch `plan_entitlements`, does not maintain
 * a parallel notion of what a plan includes, and cannot disagree with the
 * catalogue — because it does not have an opinion about it.
 */
class BillingRepository(private val ds: DataSource) {

    private val log = LoggerFactory.getLogger(BillingRepository::class.java)

    // ── Accounts ──────────────────────────────────────────────────────────────

    data class Account(
        val id: UUID,
        val name: String,
        val planCode: String,
        val provider: String,
        val currency: String?,
        val country: String?,
        val billingEmail: String?,
        val externalCustomerId: String?,
        val taxId: String?,
        val taxIdType: String?,
        val restrictedAt: Instant?,
        val seats: Int,
    )

    fun account(accountId: UUID): Account? = ds.connection.use { c ->
        c.prepareStatement(
            """SELECT id, name, plan_code, provider, currency, country, billing_email,
                      external_customer_id, tax_id, tax_id_type, billing_restricted_at, seats
                 FROM billing_accounts WHERE id = ?"""
        ).use { st ->
            st.setObject(1, accountId)
            st.executeQuery().use { rs -> if (rs.next()) mapAccount(rs) else null }
        }
    }

    fun accountForWorkspace(workspaceId: UUID): Account? = ds.connection.use { c ->
        c.prepareStatement(
            """SELECT b.id, b.name, b.plan_code, b.provider, b.currency, b.country, b.billing_email,
                      b.external_customer_id, b.tax_id, b.tax_id_type, b.billing_restricted_at, b.seats
                 FROM workspaces w JOIN billing_accounts b ON b.id = w.billing_account_id
                WHERE w.id = ?"""
        ).use { st ->
            st.setObject(1, workspaceId)
            st.executeQuery().use { rs -> if (rs.next()) mapAccount(rs) else null }
        }
    }

    fun accountByExternalCustomer(provider: String, externalCustomerId: String): UUID? =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT id FROM billing_accounts WHERE provider = ? AND external_customer_id = ?"
            ).use { st ->
                st.setString(1, provider); st.setString(2, externalCustomerId)
                st.executeQuery().use { rs -> if (rs.next()) rs.getObject(1, UUID::class.java) else null }
            }
        }

    fun setExternalCustomer(accountId: UUID, provider: String, externalCustomerId: String) {
        exec("""UPDATE billing_accounts
                   SET provider = ?, external_customer_id = ?, updated_at = now()
                 WHERE id = ?""", provider, externalCustomerId, accountId)
    }

    /**
     * Set the account's billing identity, once.
     *
     * ── CURRENCY IS IMMUTABLE ONCE SET ──────────────────────────────────────
     * `COALESCE(currency, ?)` rather than an overwrite. §7 decides currency at
     * signup, and letting it change later produces an account whose invoice
     * history is in two currencies and whose lifetime value needs an FX rate to
     * compute. Changing it is a support action that ends one subscription and
     * starts another, because that is genuinely what it is.
     */
    fun setBillingIdentity(
        accountId: UUID, currency: String?, country: String?, email: String?,
        taxId: String?, taxIdType: String?,
    ) {
        exec("""UPDATE billing_accounts
                   SET currency      = COALESCE(currency, ?),
                       country       = COALESCE(?, country),
                       billing_email = COALESCE(?, billing_email),
                       tax_id        = COALESCE(?, tax_id),
                       tax_id_type   = COALESCE(?, tax_id_type),
                       updated_at    = now()
                 WHERE id = ?""",
            currency, country, email, taxId, taxIdType, accountId)
    }

    /**
     * The ONE write that changes what a customer is entitled to.
     *
     * S3's resolver reads `plan_code`; nothing else here does. Keeping it to one
     * method means "how does billing change entitlements" has a single answer,
     * and a future handler that needed a different one would have to justify it
     * here rather than reaching into the column from somewhere else.
     */
    fun applyPlanToAccount(accountId: UUID, planCode: String, status: String) {
        exec("""UPDATE billing_accounts
                   SET plan_code = ?, plan_status = ?, updated_at = now()
                 WHERE id = ?""", planCode, status, accountId)
        log.info("[billing] account {} -> plan {} ({})", accountId, planCode, status)
    }

    // ── Plans and prices ──────────────────────────────────────────────────────

    data class PlanPrice(
        val id: UUID,
        val planCode: String,
        val currency: String,
        val interval: String,
        val unitAmountMinor: Long,
        val taxBehavior: String,
        val externalPriceId: String?,
    )

    /** The price of a plan in a currency, with the provider's id for it. */
    fun price(planCode: String, currency: String, interval: String, provider: String): PlanPrice? =
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT p.id, p.plan_code, p.currency, p.billing_interval,
                          p.unit_amount_minor, p.tax_behavior, r.external_price_id
                     FROM plan_prices p
                     LEFT JOIN provider_price_refs r
                            ON r.plan_price_id = p.id AND r.provider = ?
                    WHERE p.plan_code = ? AND p.currency = ? AND p.billing_interval = ?
                      AND p.active"""
            ).use { st ->
                st.setString(1, provider); st.setString(2, planCode)
                st.setString(3, currency); st.setString(4, interval)
                st.executeQuery().use { rs -> if (rs.next()) mapPrice(rs) else null }
            }
        }

    /** Every live price in one currency — what the plan-comparison page renders. */
    fun pricesFor(currency: String, interval: String = "month"): List<PlanPrice> =
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT p.id, p.plan_code, p.currency, p.billing_interval,
                          p.unit_amount_minor, p.tax_behavior, NULL AS external_price_id
                     FROM plan_prices p
                     JOIN plans pl ON pl.code = p.plan_code
                    WHERE p.currency = ? AND p.billing_interval = ? AND p.active
                      AND pl.is_public AND pl.archived_at IS NULL
                    ORDER BY pl.sort_order"""
            ).use { st ->
                st.setString(1, currency); st.setString(2, interval)
                st.executeQuery().use { rs -> buildList { while (rs.next()) add(mapPrice(rs)) } }
            }
        }

    // ── Subscriptions ─────────────────────────────────────────────────────────

    data class Subscription(
        val id: UUID,
        val accountId: UUID,
        val planCode: String,
        val provider: String,
        val externalId: String?,
        val status: String,
        val quantity: Int,
        val trialEnd: Instant?,
        val currentPeriodStart: Instant?,
        val currentPeriodEnd: Instant?,
        val cancelAtPeriodEnd: Boolean,
        val pastDueSince: Instant?,
    )

    fun liveSubscription(accountId: UUID): Subscription? = ds.connection.use { c ->
        c.prepareStatement(
            """SELECT * FROM subscriptions
                WHERE billing_account_id = ?
                  AND status IN ('trialing','active','past_due','incomplete')
                ORDER BY created_at DESC LIMIT 1"""
        ).use { st ->
            st.setObject(1, accountId)
            st.executeQuery().use { rs -> if (rs.next()) mapSubscription(rs) else null }
        }
    }

    fun subscriptionByExternalId(provider: String, externalId: String): Subscription? =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT * FROM subscriptions WHERE provider = ? AND external_subscription_id = ?"
            ).use { st ->
                st.setString(1, provider); st.setString(2, externalId)
                st.executeQuery().use { rs -> if (rs.next()) mapSubscription(rs) else null }
            }
        }

    fun createSubscription(
        accountId: UUID, planCode: String, planPriceId: UUID?, provider: String,
        externalId: String?, status: String, quantity: Int,
        trialEnd: Instant?, periodStart: Instant?, periodEnd: Instant?,
    ): UUID = ds.connection.use { c ->
        c.prepareStatement(
            """INSERT INTO subscriptions
                 (billing_account_id, plan_code, plan_price_id, provider,
                  external_subscription_id, status, quantity, trial_end,
                  current_period_start, current_period_end)
               VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id"""
        ).use { st ->
            st.setObject(1, accountId); st.setString(2, planCode)
            st.setObject(3, planPriceId); st.setString(4, provider)
            st.setString(5, externalId); st.setString(6, status)
            st.setInt(7, quantity)
            st.setObject(8, trialEnd?.let { Timestamp.from(it) })
            st.setObject(9, periodStart?.let { Timestamp.from(it) })
            st.setObject(10, periodEnd?.let { Timestamp.from(it) })
            st.executeQuery().use { rs -> rs.next(); rs.getObject(1, UUID::class.java) }
        }
    }

    /**
     * Apply a provider's view of a subscription to ours.
     *
     * ── OUT-OF-ORDER TOLERANCE LIVES HERE ───────────────────────────────────
     * [occurredAt] is the PROVIDER's timestamp for the event carrying this
     * state, and it is compared against `last_event_at` — the provider's
     * timestamp on the last event we applied. Provider clock against provider
     * clock.
     *
     * The first version compared it against our own `updated_at` and was wrong
     * twice over: two different clocks, measuring two different things. It also
     * failed immediately, because a row written a millisecond ago has an
     * `updated_at` LATER than the `occurred_at` of the event about to arrive
     * describing it — so every first webhook was rejected as stale.
     *
     * An event with no timestamp is applied. Some providers omit it, and
     * refusing everything undated would mean refusing every event from one of
     * them.
     *
     * Returns false when the update was declined as stale, so the caller records
     * the event as `stale` rather than `processed` — "we ignored this
     * deliberately" and "we never saw it" are different operational facts.
     */
    fun applyProviderSubscription(
        subscriptionId: UUID,
        sub: ProviderSubscription,
        occurredAt: Instant?,
    ): Boolean = ds.connection.use { c ->
        c.prepareStatement(
            """UPDATE subscriptions
                  SET status = ?,
                      external_subscription_id = COALESCE(?, external_subscription_id),
                      current_period_start = COALESCE(?, current_period_start),
                      current_period_end   = COALESCE(?, current_period_end),
                      trial_end            = COALESCE(?, trial_end),
                      cancel_at_period_end = ?,
                      past_due_since = CASE
                          WHEN ? = 'past_due' THEN COALESCE(past_due_since, now())
                          ELSE NULL END,
                      canceled_at = CASE WHEN ? = 'canceled' THEN COALESCE(canceled_at, now())
                                         ELSE canceled_at END,
                      last_event_at = COALESCE(?::timestamptz, last_event_at),
                      updated_at = now()
                WHERE id = ?
                  -- Provider clock against provider clock. An undated event is
                  -- applied; an event older than the last one we applied is not.
                  AND (?::timestamptz IS NULL
                       OR last_event_at IS NULL
                       OR ?::timestamptz >= last_event_at)"""
        ).use { st ->
            st.setString(1, sub.status)
            st.setString(2, sub.externalId)
            st.setObject(3, sub.currentPeriodStart?.let { Timestamp.from(it) })
            st.setObject(4, sub.currentPeriodEnd?.let { Timestamp.from(it) })
            st.setObject(5, sub.trialEnd?.let { Timestamp.from(it) })
            st.setBoolean(6, sub.cancelAtPeriodEnd)
            st.setString(7, sub.status)
            st.setString(8, sub.status)
            val ts = occurredAt?.let { Timestamp.from(it) }
            st.setObject(9, ts)                 // last_event_at
            st.setObject(10, subscriptionId)
            st.setObject(11, ts)                // staleness guard
            st.setObject(12, ts)
            st.executeUpdate() > 0
        }
    }

    // ── Invoices ──────────────────────────────────────────────────────────────

    /**
     * Insert or update an invoice from a provider event.
     *
     * `ON CONFLICT (provider, external_invoice_id)` makes a duplicate webhook a
     * no-op update rather than a second invoice — which is the difference
     * between a redelivery being harmless and a customer seeing their bill
     * twice.
     */
    fun upsertInvoice(accountId: UUID, subscriptionId: UUID?, provider: String, inv: ProviderInvoice) {
        exec(
            """INSERT INTO invoices
                 (billing_account_id, subscription_id, number, currency,
                  subtotal_minor, tax_minor, total_minor, amount_paid_minor,
                  status, period_start, period_end, issued_at, paid_at,
                  provider, external_invoice_id, hosted_url, pdf_url)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
               -- The index is PARTIAL (`WHERE external_invoice_id IS NOT NULL`),
               -- so the predicate has to be repeated here or Postgres cannot
               -- match it: "there is no unique or exclusion constraint matching
               -- the ON CONFLICT specification".
               ON CONFLICT (provider, external_invoice_id)
                    WHERE external_invoice_id IS NOT NULL DO UPDATE
                 SET status            = EXCLUDED.status,
                     amount_paid_minor = EXCLUDED.amount_paid_minor,
                     total_minor       = EXCLUDED.total_minor,
                     tax_minor         = EXCLUDED.tax_minor,
                     subtotal_minor    = EXCLUDED.subtotal_minor,
                     paid_at           = COALESCE(EXCLUDED.paid_at, invoices.paid_at),
                     hosted_url        = COALESCE(EXCLUDED.hosted_url, invoices.hosted_url),
                     pdf_url           = COALESCE(EXCLUDED.pdf_url, invoices.pdf_url),
                     updated_at        = now()""",
            accountId, subscriptionId, inv.number, inv.currency,
            inv.subtotalMinor, inv.taxMinor, inv.totalMinor, inv.amountPaidMinor,
            inv.status,
            inv.periodStart?.let { Timestamp.from(it) },
            inv.periodEnd?.let { Timestamp.from(it) },
            inv.issuedAt?.let { Timestamp.from(it) },
            inv.paidAt?.let { Timestamp.from(it) },
            provider, inv.externalId, inv.hostedUrl, inv.pdfUrl,
        )
    }

    fun invoices(accountId: UUID, limit: Int = 50): List<Map<String, Any?>> =
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT id, number, currency, subtotal_minor, tax_minor, total_minor,
                          amount_paid_minor, status, period_start, period_end,
                          issued_at, paid_at, hosted_url, pdf_url
                     FROM invoices WHERE billing_account_id = ?
                    ORDER BY COALESCE(issued_at, created_at) DESC LIMIT ?"""
            ).use { st ->
                st.setObject(1, accountId); st.setInt(2, limit)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(mapOf(
                            "id" to rs.getObject("id", UUID::class.java).toString(),
                            "number" to rs.getString("number"),
                            "currency" to rs.getString("currency"),
                            "subtotalMinor" to rs.getLong("subtotal_minor"),
                            "taxMinor" to rs.getLong("tax_minor"),
                            "totalMinor" to rs.getLong("total_minor"),
                            "amountPaidMinor" to rs.getLong("amount_paid_minor"),
                            "status" to rs.getString("status"),
                            "periodStart" to rs.getTimestamp("period_start")?.toInstant()?.toString(),
                            "periodEnd" to rs.getTimestamp("period_end")?.toInstant()?.toString(),
                            "issuedAt" to rs.getTimestamp("issued_at")?.toInstant()?.toString(),
                            "paidAt" to rs.getTimestamp("paid_at")?.toInstant()?.toString(),
                            "hostedUrl" to rs.getString("hosted_url"),
                            "pdfUrl" to rs.getString("pdf_url"),
                        ))
                    }
                }
            }
        }

    // ── Payment methods ───────────────────────────────────────────────────────

    fun upsertPaymentMethod(accountId: UUID, provider: String, pm: ProviderPaymentMethod, makeDefault: Boolean) {
        ds.connection.use { c ->
            if (makeDefault) {
                c.prepareStatement(
                    "UPDATE payment_methods SET is_default = false WHERE billing_account_id = ?"
                ).use { st -> st.setObject(1, accountId); st.executeUpdate() }
            }
            c.prepareStatement(
                """INSERT INTO payment_methods
                     (billing_account_id, provider, external_payment_method_id, kind,
                      brand, last4, exp_month, exp_year, display_label, is_default)
                   VALUES (?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT (provider, external_payment_method_id) DO UPDATE
                     SET brand = EXCLUDED.brand, last4 = EXCLUDED.last4,
                         exp_month = EXCLUDED.exp_month, exp_year = EXCLUDED.exp_year,
                         display_label = EXCLUDED.display_label,
                         is_default = EXCLUDED.is_default,
                         removed_at = NULL"""
            ).use { st ->
                st.setObject(1, accountId); st.setString(2, provider)
                st.setString(3, pm.externalId); st.setString(4, pm.kind)
                st.setString(5, pm.brand)
                /* Truncated on the way in as well as CHECK-constrained in the
                   schema. Two guards for the same thing, because the cost of
                   either failing is a card number in our database. */
                st.setString(6, pm.last4?.take(4))
                st.setObject(7, pm.expMonth)
                st.setObject(8, pm.expYear)
                st.setString(9, pm.displayLabel)
                st.setBoolean(10, makeDefault)
                st.executeUpdate()
            }
        }
    }

    fun removePaymentMethod(provider: String, externalId: String) {
        exec("""UPDATE payment_methods SET removed_at = now(), is_default = false
                 WHERE provider = ? AND external_payment_method_id = ? AND removed_at IS NULL""",
            provider, externalId)
    }

    fun paymentMethods(accountId: UUID): List<Map<String, Any?>> = ds.connection.use { c ->
        c.prepareStatement(
            """SELECT id, kind, brand, last4, exp_month, exp_year, display_label, is_default
                 FROM payment_methods
                WHERE billing_account_id = ? AND removed_at IS NULL
                ORDER BY is_default DESC, created_at DESC"""
        ).use { st ->
            st.setObject(1, accountId)
            st.executeQuery().use { rs ->
                buildList {
                    while (rs.next()) add(mapOf(
                        "id" to rs.getObject("id", UUID::class.java).toString(),
                        "kind" to rs.getString("kind"),
                        "brand" to rs.getString("brand"),
                        "last4" to rs.getString("last4"),
                        "expMonth" to (rs.getObject("exp_month") as? Number)?.toInt(),
                        "expYear" to (rs.getObject("exp_year") as? Number)?.toInt(),
                        "label" to rs.getString("display_label"),
                        "isDefault" to rs.getBoolean("is_default"),
                    ))
                }
            }
        }
    }

    // ── Dunning ───────────────────────────────────────────────────────────────

    data class DunningState(
        val stage: String,
        val daysPastDue: Int,
        val nextStepAt: Instant?,
        val restricted: Boolean,
    )

    fun dunningState(accountId: UUID): DunningState = ds.connection.use { c ->
        c.prepareStatement(
            "SELECT stage, days_past_due, next_step_at, restricted FROM billing_dunning_state(?)"
        ).use { st ->
            st.setObject(1, accountId)
            st.executeQuery().use { rs ->
                if (!rs.next()) DunningState("current", 0, null, false)
                else DunningState(
                    rs.getString("stage"),
                    rs.getInt("days_past_due"),
                    rs.getTimestamp("next_step_at")?.toInstant(),
                    rs.getBoolean("restricted"),
                )
            }
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun exec(sql: String, vararg args: Any?) {
        ds.connection.use { c ->
            c.prepareStatement(sql).use { st ->
                args.forEachIndexed { i, a -> st.setObject(i + 1, a) }
                st.executeUpdate()
            }
        }
    }

    private fun mapAccount(rs: ResultSet) = Account(
        id = rs.getObject("id", UUID::class.java),
        name = rs.getString("name"),
        planCode = rs.getString("plan_code"),
        provider = rs.getString("provider"),
        currency = rs.getString("currency"),
        country = rs.getString("country"),
        billingEmail = rs.getString("billing_email"),
        externalCustomerId = rs.getString("external_customer_id"),
        taxId = rs.getString("tax_id"),
        taxIdType = rs.getString("tax_id_type"),
        restrictedAt = rs.getTimestamp("billing_restricted_at")?.toInstant(),
        seats = rs.getInt("seats"),
    )

    private fun mapPrice(rs: ResultSet) = PlanPrice(
        id = rs.getObject("id", UUID::class.java),
        planCode = rs.getString("plan_code"),
        currency = rs.getString("currency"),
        interval = rs.getString("billing_interval"),
        unitAmountMinor = rs.getLong("unit_amount_minor"),
        taxBehavior = rs.getString("tax_behavior"),
        externalPriceId = rs.getString("external_price_id"),
    )

    private fun mapSubscription(rs: ResultSet) = Subscription(
        id = rs.getObject("id", UUID::class.java),
        accountId = rs.getObject("billing_account_id", UUID::class.java),
        planCode = rs.getString("plan_code"),
        provider = rs.getString("provider"),
        externalId = rs.getString("external_subscription_id"),
        status = rs.getString("status"),
        quantity = rs.getInt("quantity"),
        trialEnd = rs.getTimestamp("trial_end")?.toInstant(),
        currentPeriodStart = rs.getTimestamp("current_period_start")?.toInstant(),
        currentPeriodEnd = rs.getTimestamp("current_period_end")?.toInstant(),
        cancelAtPeriodEnd = rs.getBoolean("cancel_at_period_end"),
        pastDueSince = rs.getTimestamp("past_due_since")?.toInstant(),
    )
}
