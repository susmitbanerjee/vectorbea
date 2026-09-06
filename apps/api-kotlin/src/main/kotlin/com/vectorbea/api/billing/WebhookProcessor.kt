package com.vectorbea.api.billing

import org.slf4j.LoggerFactory
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Webhooks in: verified, recorded exactly once, applied in the right order, and
 * never guessed at.
 *
 * ── THE FOUR RULES, AND THE FAILURE EACH ONE PREVENTS ───────────────────────
 *
 * VERIFY FIRST, over the RAW body. An unverified webhook is an unauthenticated
 * write into the billing schema — anybody who learns the URL could mark an
 * invoice paid. The raw bytes matter: a body parsed and re-serialised will not
 * verify at either provider, and the resulting failure looks like an attack
 * rather than a bug in our own plumbing.
 *
 * RECORD BEFORE APPLYING. The row is inserted, then the handler runs. A crash
 * between the two leaves a `received` row that the redelivery finds — and
 * because the insert is what deduplicates, a redelivery arriving DURING the
 * handler is rejected rather than running the handler twice concurrently.
 *
 * IDEMPOTENT ON THE PROVIDER'S EVENT ID. `UNIQUE (provider, external_event_id)`
 * and an `ON CONFLICT DO NOTHING` that reports whether it inserted. Not a
 * check-then-insert: two retries can arrive concurrently and both pass a check.
 *
 * NEVER INFER. An unrecognised type is stored with status `ignored` and logged.
 * It is not guessed from its name, not partially applied, and not dropped. Same
 * discipline as `decideOnApproval`: anything unrecognised means wait. The row
 * stays, so the event can be replayed once a handler exists.
 */
class WebhookProcessor(
    private val ds: DataSource,
    private val repo: BillingRepository,
) {
    private val log = LoggerFactory.getLogger(WebhookProcessor::class.java)

    enum class Outcome {
        /** Applied. */
        PROCESSED,
        /** Seen before. The whole point — a duplicate changes nothing. */
        DUPLICATE,
        /** Recognised envelope, type we do not handle. Stored, not applied. */
        IGNORED,
        /** Older than what the row already reflects. Stored, not applied. */
        STALE,
        /** Signature did not verify. Nothing was stored. */
        REJECTED,
        /** Handler threw. Stored as failed so it can be retried or inspected. */
        FAILED,
    }

    /**
     * Handle one delivery.
     *
     * [rawBody] must be the bytes exactly as received — see the header.
     */
    fun handle(provider: BillingProvider, rawBody: String, headers: Map<String, String>): Outcome {
        if (!provider.verifyWebhook(rawBody, headers)) {
            /* Nothing is stored for an unverified body. Storing it would give an
               unauthenticated caller a way to fill a table, and there is nothing
               to learn from a payload we cannot attribute. */
            log.warn("[billing] rejected {} webhook: signature did not verify", provider.id)
            return Outcome.REJECTED
        }

        val event = provider.parseWebhook(rawBody, headers)
        if (event == null) {
            log.warn("[billing] {} webhook verified but unparseable — ignoring", provider.id)
            return Outcome.IGNORED
        }

        val inserted = record(provider.id, event, rawBody)
        if (!inserted) {
            /* THE DUPLICATE PATH. A redelivered event reaches here and returns
               without touching a single row. */
            log.info("[billing] duplicate {} event {} — ignored", provider.id, event.externalEventId)
            return Outcome.DUPLICATE
        }

        if (event.type.isEmpty() || event.type !in BillingEventType.ALL) {
            markEvent(provider.id, event.externalEventId, "ignored", null)
            log.info("[billing] {} event {} of type '{}' is not handled — stored and ignored",
                provider.id, event.externalEventId, event.rawType)
            return Outcome.IGNORED
        }

        return try {
            val outcome = apply(provider.id, event)
            markEvent(provider.id, event.externalEventId,
                if (outcome == Outcome.STALE) "stale" else "processed", null)
            outcome
        } catch (e: Exception) {
            log.error("[billing] handler failed for {} event {}: {}",
                provider.id, event.externalEventId, e.message)
            markEvent(provider.id, event.externalEventId, "failed", e.message?.take(500))
            Outcome.FAILED
        }
    }

    // ── Applying ──────────────────────────────────────────────────────────────

    private fun apply(providerId: String, event: ProviderEvent): Outcome {
        val accountId = resolveAccount(providerId, event)
        if (accountId == null) {
            /* A webhook for something we have no record of. NOT an error — a
               subscription created directly in a provider dashboard produces
               exactly this, and inferring an account from it would attach
               somebody's payment to a guess. */
            log.warn("[billing] {} event {} names no account we know — stored, not applied",
                providerId, event.externalEventId)
            return Outcome.IGNORED
        }

        return when (event.type) {
            BillingEventType.SUBSCRIPTION_UPDATED,
            BillingEventType.SUBSCRIPTION_CANCELED -> applySubscription(providerId, accountId, event)

            BillingEventType.INVOICE_FINALIZED,
            BillingEventType.INVOICE_PAID,
            BillingEventType.INVOICE_PAYMENT_FAILED -> applyInvoice(providerId, accountId, event)

            BillingEventType.PAYMENT_METHOD_ATTACHED -> {
                event.paymentMethod?.let {
                    /* Default when it is the first: a customer who has just added
                       their only card should not have to also choose it. */
                    val first = repo.paymentMethods(accountId).isEmpty()
                    repo.upsertPaymentMethod(accountId, providerId, it, makeDefault = first)
                }
                Outcome.PROCESSED
            }

            BillingEventType.PAYMENT_METHOD_DETACHED -> {
                event.paymentMethod?.let { repo.removePaymentMethod(providerId, it.externalId) }
                Outcome.PROCESSED
            }

            else -> Outcome.IGNORED
        }
    }

    /**
     * Apply a subscription state change, declining anything stale.
     *
     * ── OUT-OF-ORDER IS THE NORMAL CASE, NOT THE EDGE ───────────────────────
     * Providers reorder. A `subscription.updated` describing an active
     * subscription can arrive AFTER the `.deleted` that cancelled it, and
     * applying it would resurrect a subscription the customer ended — and start
     * billing them again.
     *
     * `applyProviderSubscription` refuses an update whose `occurred_at` predates
     * what the row was last updated from, and returns false. The event is then
     * recorded as `stale` rather than `processed`, so "we ignored this
     * deliberately" is distinguishable from "we never received it".
     */
    private fun applySubscription(providerId: String, accountId: UUID, event: ProviderEvent): Outcome {
        val incoming = event.subscription ?: return Outcome.IGNORED
        val existing = event.externalSubscriptionId
            ?.let { repo.subscriptionByExternalId(providerId, it) }
            ?: repo.liveSubscription(accountId)

        if (existing == null) {
            /* A subscription we have never seen. Recorded rather than refused:
               it is real, the customer is being billed for it, and refusing to
               record it would leave our schema disagreeing with the money. */
            repo.createSubscription(
                accountId = accountId,
                planCode = repo.account(accountId)?.planCode ?: "free",
                planPriceId = null,
                provider = providerId,
                externalId = incoming.externalId,
                status = incoming.status,
                quantity = 1,
                trialEnd = incoming.trialEnd,
                periodStart = incoming.currentPeriodStart,
                periodEnd = incoming.currentPeriodEnd,
            )
            return Outcome.PROCESSED
        }

        val applied = repo.applyProviderSubscription(existing.id, incoming, event.occurredAt)
        if (!applied) return Outcome.STALE

        /* ── THE ONE PLACE ENTITLEMENTS MOVE ─────────────────────────────────
           A cancellation does NOT drop the plan here: §5 says cancellation runs
           to period end, and `billing_settle_ended_subscriptions()` does that on
           a schedule. Dropping it now would take away access somebody has paid
           for, on the day they cancelled.

           A past_due does not drop the plan either — the dunning schedule sets
           `billing_restricted_at`, which refuses new runs and never touches
           retention. A failed card must not delete data. */
        if (incoming.status == "active" || incoming.status == "trialing") {
            repo.applyPlanToAccount(accountId, existing.planCode, incoming.status)
        }
        return Outcome.PROCESSED
    }

    private fun applyInvoice(providerId: String, accountId: UUID, event: ProviderEvent): Outcome {
        val inv = event.invoice ?: return Outcome.IGNORED
        val sub = inv.externalSubscriptionId?.let { repo.subscriptionByExternalId(providerId, it) }
        repo.upsertInvoice(accountId, sub?.id, providerId, inv)
        return Outcome.PROCESSED
    }

    /**
     * Which account this event belongs to.
     *
     * Three routes, most specific first: our own id in the provider's metadata,
     * then the external customer id, then the subscription. Metadata first
     * because it is the only one that cannot be ambiguous — it is our id,
     * written by us.
     */
    private fun resolveAccount(providerId: String, event: ProviderEvent): UUID? {
        event.accountId?.let { raw ->
            runCatching { UUID.fromString(raw) }.getOrNull()?.let { id ->
                if (repo.account(id) != null) return id
            }
        }
        event.externalCustomerId?.let { cus ->
            repo.accountByExternalCustomer(providerId, cus)?.let { return it }
        }
        event.externalSubscriptionId?.let { sub ->
            repo.subscriptionByExternalId(providerId, sub)?.let { return it.accountId }
        }
        return null
    }

    // ── The idempotency record ────────────────────────────────────────────────

    /**
     * Insert the event, or report that it was already there.
     *
     * `ON CONFLICT DO NOTHING` with a `RETURNING`: the returning row is present
     * only when the insert actually happened, which makes "did I insert this"
     * a property of the statement rather than a second query that could race.
     */
    private fun record(providerId: String, event: ProviderEvent, rawBody: String): Boolean =
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO billing_events
                     (provider, external_event_id, type, occurred_at,
                      signature_verified, payload, status)
                   VALUES (?, ?, ?, ?, true, ?::jsonb, 'received')
                   ON CONFLICT (provider, external_event_id) DO NOTHING
                   RETURNING id"""
            ).use { st ->
                st.setString(1, providerId)
                st.setString(2, event.externalEventId)
                st.setString(3, event.rawType)
                st.setObject(4, event.occurredAt?.let { Timestamp.from(it) })
                st.setString(5, rawBody)
                st.executeQuery().use { rs -> rs.next() }
            }
        }

    private fun markEvent(providerId: String, externalEventId: String, status: String, error: String?) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement(
                    """UPDATE billing_events
                          SET status = ?, processed_at = now(), error = ?
                        WHERE provider = ? AND external_event_id = ?"""
                ).use { st ->
                    st.setString(1, status); st.setString(2, error)
                    st.setString(3, providerId); st.setString(4, externalEventId)
                    st.executeUpdate()
                }
            }
        }.onFailure { log.warn("[billing] could not mark event {}: {}", externalEventId, it.message) }
    }
}
