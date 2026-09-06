package com.vectorbea.api.billing

import org.slf4j.LoggerFactory
import java.math.BigDecimal
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Tells the provider what was used, and then checks that it stuck.
 *
 * ── IDEMPOTENT IN BOTH DIRECTIONS ───────────────────────────────────────────
 * §6: "a replayed webhook or a retried report must not double-charge". The
 * webhook side is `WebhookProcessor`; this is the outbound half, and it has two
 * independent protections:
 *
 *  1. THE KEY IS DERIVED, NOT GENERATED. `account:period:metric:quantity` —
 *     computed from the facts, so a retry presents the SAME key and both the
 *     `usage_reports` unique constraint and the provider's own idempotency
 *     deduplicate it. A generated UUID would be different every time and would
 *     defeat the entire mechanism. Same rule as the run ledger, same reason.
 *
 *  2. THE REPORT IS ABSOLUTE, NOT INCREMENTAL. Each report states the period's
 *     TOTAL. A lost report is corrected by the next one; a duplicated report
 *     writes the same total and changes nothing. Sending deltas would make every
 *     retry a double charge and every lost report a permanent undercount — and
 *     neither would be visible until an invoice.
 *
 * ── AND IT READS THE S1 LEDGER, NOT A SECOND AGGREGATION ────────────────────
 * `billing_reportable_usage()` sums `usage_records`. What gets billed is exactly
 * what was metered: one row per run, replays excluded, resumes counted once. A
 * second aggregation path here would be a second opinion about revenue, and the
 * two would diverge quietly.
 */
class UsageReporter(
    private val ds: DataSource,
    private val repo: BillingRepository,
    private val providers: BillingProviderRegistry,
) {
    private val log = LoggerFactory.getLogger(UsageReporter::class.java)

    data class Result(val attempted: Int, val reported: Int, val skipped: Int, val failed: Int)

    /**
     * Report every account's current-period usage.
     *
     * Safe to run as often as you like: an unchanged total produces the same
     * idempotency key, the insert conflicts, and nothing is sent.
     */
    fun reportAll(): Result {
        var attempted = 0; var reported = 0; var skipped = 0; var failed = 0

        for (accountId in accountsWithSubscriptions()) {
            val account = repo.account(accountId) ?: continue
            val sub = repo.liveSubscription(accountId) ?: continue
            val provider = providers.forAccount(account)

            for ((metric, quantity, periodStart) in reportableUsage(accountId)) {
                attempted++
                when (report(account, sub, provider, metric, quantity, periodStart)) {
                    ReportOutcome.REPORTED -> reported++
                    ReportOutcome.ALREADY -> skipped++
                    ReportOutcome.SKIPPED -> skipped++
                    ReportOutcome.FAILED -> failed++
                }
            }
        }

        if (attempted > 0) {
            log.info("[billing] usage: {} attempted, {} reported, {} skipped, {} failed",
                attempted, reported, skipped, failed)
        }
        return Result(attempted, reported, skipped, failed)
    }

    private enum class ReportOutcome { REPORTED, ALREADY, SKIPPED, FAILED }

    private fun report(
        account: BillingRepository.Account,
        sub: BillingRepository.Subscription,
        provider: BillingProvider,
        metric: String,
        quantity: Long,
        periodStart: Instant,
    ): ReportOutcome {
        val key = idempotencyKey(account.id, periodStart, metric, quantity)

        /* Claim the key first. If the insert conflicts, this exact total for this
           exact period has already been reported and there is nothing to do —
           which is what makes running this every five minutes free. */
        val claimed = claim(account.id, sub.id, periodStart, metric, quantity, provider.id, key)
        if (!claimed) return ReportOutcome.ALREADY

        val externalSub = sub.externalId
        if (externalSub == null || !provider.isLive) {
            /* Nothing to tell: no provider subscription, or the noop provider.
               Marked `skipped` rather than `failed` so the reconciler does not
               treat an unconfigured deployment as drift forever. */
            mark(key, provider.id, "skipped", null, null)
            return ReportOutcome.SKIPPED
        }

        val result = provider.reportUsage(
            UsageReportRequest(
                externalSubscriptionId = externalSub,
                metric = metric,
                quantity = quantity,
                periodStart = periodStart,
                idempotencyKey = key,
            )
        )

        return when (result) {
            is BillingResult.Success -> {
                mark(key, provider.id, "reported", result.value, null)
                ReportOutcome.REPORTED
            }
            is BillingResult.Failure -> {
                /* A retryable failure RELEASES the key, so the next sweep tries
                   again. A permanent one keeps it marked failed — retrying a
                   "no such subscription" forever would hide a real configuration
                   error behind a queue that never drains. */
                if (result.retryable) {
                    release(key, provider.id, result.message)
                } else {
                    mark(key, provider.id, "failed", null, result.message)
                }
                log.warn("[billing] usage report failed for {} {}: {} ({})",
                    account.id, metric, result.message,
                    if (result.retryable) "will retry" else "permanent")
                ReportOutcome.FAILED
            }
        }
    }

    /**
     * The key, derived from the facts.
     *
     * Includes the QUANTITY, so a period whose total has changed produces a new
     * key and is reported again — while an unchanged total is deduplicated. That
     * is the property that makes "report the total, often" both correct and
     * cheap.
     */
    private fun idempotencyKey(accountId: UUID, periodStart: Instant, metric: String, quantity: Long) =
        "$accountId:${periodStart.epochSecond}:$metric:$quantity"

    // ── Reconciliation ────────────────────────────────────────────────────────

    /**
     * Compare what we last reported against what our meters say, and record the
     * difference (§6).
     *
     * ── WHY THIS IS NOT OPTIONAL ────────────────────────────────────────────
     * A usage report that quietly stopped succeeding looks exactly like a quiet
     * month. Revenue simply does not arrive, and nothing anywhere is red. The
     * only signal is the gap between the local meter and what the provider was
     * told, which is what this writes down.
     *
     * `unreported` is kept distinct from `drift`: never having told the provider
     * anything is a different problem from having told it something wrong, and
     * they have different fixes.
     */
    fun reconcile(): Int {
        var flagged = 0

        for (accountId in accountsWithSubscriptions()) {
            val account = repo.account(accountId) ?: continue
            val provider = providers.forAccount(account)

            for ((metric, local, periodStart) in reportableUsage(accountId)) {
                val reported = lastReported(accountId, periodStart, metric)
                val drift = local - (reported ?: 0L)

                val status = when {
                    /* A provider with no metered API was never sent anything and
                       never will be. Treating that as drift would produce a
                       permanent false alert on every Razorpay account. */
                    !provider.isLive -> "ok"
                    reported == null -> "unreported"
                    drift != 0L -> "drift"
                    else -> "ok"
                }

                recordReconciliation(accountId, periodStart, metric, local, reported ?: 0L, drift, status)

                if (status != "ok") {
                    flagged++
                    log.warn("[billing] {} {} for account {}: local={} reported={} drift={}",
                        status, metric, accountId, local, reported ?: 0L, drift)
                }
            }
        }

        if (flagged > 0) {
            log.error("[billing] reconciliation flagged {} account/metric pairs — " +
                "usage may be under-reported and revenue lost", flagged)
        }
        return flagged
    }

    // ── Queries ───────────────────────────────────────────────────────────────

    /** A data class already destructures; the hand-written operators were dead. */
    private data class Usage(val metric: String, val quantity: Long, val periodStart: Instant)

    private fun reportableUsage(accountId: UUID): List<Usage> = ds.connection.use { c ->
        c.prepareStatement("SELECT metric, quantity, period_start FROM billing_reportable_usage(?)")
            .use { st ->
                st.setObject(1, accountId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(Usage(
                            rs.getString("metric"),
                            /* Ceiling, not truncation. A provider billed against
                               a truncated figure gets the last fractional unit of
                               every period free — small per account, and exactly
                               the kind of systematic leak nobody notices. */
                            Math.ceil(rs.getBigDecimal("quantity").toDouble()).toLong(),
                            rs.getTimestamp("period_start").toInstant(),
                        ))
                    }
                }
            }
    }

    private fun accountsWithSubscriptions(): List<UUID> = ds.connection.use { c ->
        c.prepareStatement(
            """SELECT DISTINCT billing_account_id FROM subscriptions
                WHERE status IN ('trialing','active','past_due')"""
        ).use { st ->
            st.executeQuery().use { rs ->
                buildList { while (rs.next()) add(rs.getObject(1, UUID::class.java)) }
            }
        }
    }

    private fun lastReported(accountId: UUID, periodStart: Instant, metric: String): Long? =
        ds.connection.use { c ->
            c.prepareStatement(
                """SELECT quantity FROM usage_reports
                    WHERE billing_account_id = ? AND period_start = ? AND metric = ?
                      AND status = 'reported'
                    ORDER BY reported_at DESC NULLS LAST LIMIT 1"""
            ).use { st ->
                st.setObject(1, accountId)
                st.setTimestamp(2, Timestamp.from(periodStart))
                st.setString(3, metric)
                st.executeQuery().use { rs ->
                    if (rs.next()) rs.getBigDecimal(1).toLong() else null
                }
            }
        }

    private fun claim(
        accountId: UUID, subscriptionId: UUID, periodStart: Instant,
        metric: String, quantity: Long, provider: String, key: String,
    ): Boolean = ds.connection.use { c ->
        c.prepareStatement(
            """INSERT INTO usage_reports
                 (billing_account_id, subscription_id, period_start, metric,
                  quantity, provider, idempotency_key, status)
               VALUES (?,?,?,?,?,?,?,'pending')
               ON CONFLICT (provider, idempotency_key) DO NOTHING
               RETURNING id"""
        ).use { st ->
            st.setObject(1, accountId); st.setObject(2, subscriptionId)
            st.setTimestamp(3, Timestamp.from(periodStart))
            st.setString(4, metric)
            st.setBigDecimal(5, BigDecimal.valueOf(quantity))
            st.setString(6, provider); st.setString(7, key)
            st.executeQuery().use { rs -> rs.next() }
        }
    }

    private fun mark(key: String, provider: String, status: String, externalId: String?, error: String?) {
        ds.connection.use { c ->
            c.prepareStatement(
                """UPDATE usage_reports
                      SET status = ?, external_usage_id = ?, error = ?,
                          reported_at = CASE WHEN ? = 'reported' THEN now() ELSE reported_at END
                    WHERE provider = ? AND idempotency_key = ?"""
            ).use { st ->
                st.setString(1, status); st.setString(2, externalId)
                st.setString(3, error?.take(500)); st.setString(4, status)
                st.setString(5, provider); st.setString(6, key)
                st.executeUpdate()
            }
        }
    }

    /**
     * Give the key back after a retryable failure.
     *
     * Deleting rather than marking, so the next sweep's `claim` succeeds and the
     * report is genuinely attempted again. Marking it `failed` and leaving it
     * would make the unique constraint block every future attempt at the same
     * total — the retry would be silently permanent.
     */
    private fun release(key: String, provider: String, error: String) {
        ds.connection.use { c ->
            c.prepareStatement(
                "DELETE FROM usage_reports WHERE provider = ? AND idempotency_key = ? AND status = 'pending'"
            ).use { st -> st.setString(1, provider); st.setString(2, key); st.executeUpdate() }
        }
        log.debug("[billing] released usage key {} for retry: {}", key, error)
    }

    private fun recordReconciliation(
        accountId: UUID, periodStart: Instant, metric: String,
        local: Long, reported: Long, drift: Long, status: String,
    ) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement(
                    """INSERT INTO billing_reconciliations
                         (billing_account_id, period_start, metric,
                          local_quantity, reported_quantity, drift, status)
                       VALUES (?,?,?,?,?,?,?)"""
                ).use { st ->
                    st.setObject(1, accountId)
                    st.setTimestamp(2, Timestamp.from(periodStart))
                    st.setString(3, metric)
                    st.setBigDecimal(4, BigDecimal.valueOf(local))
                    st.setBigDecimal(5, BigDecimal.valueOf(reported))
                    st.setBigDecimal(6, BigDecimal.valueOf(drift))
                    st.setString(7, status)
                    st.executeUpdate()
                }
            }
        }.onFailure { log.warn("[billing] could not record reconciliation: {}", it.message) }
    }
}
