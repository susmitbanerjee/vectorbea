package com.vectorbea.api.billing

import com.vectorbea.observability.metrics.ScheduledJobHealth
import org.slf4j.LoggerFactory
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.sql.DataSource

/**
 * The four things billing has to do on a clock.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 * `MigrationFunctionCallersTest` caught its absence: `billing_apply_dunning()`
 * was defined in V063 and called by nothing. Without it the dunning schedule is
 * decorative — accounts go past due, the warnings never escalate, nothing is
 * ever restricted, and the only symptom is revenue quietly not arriving.
 *
 * That is the fourth time this repo has shipped a scheduled SQL function with no
 * caller (V028 twice, V046 once, now this), which is why the test exists and why
 * it is worth more than the ten minutes it costs.
 *
 * ── WHAT IT RUNS, AND IN THIS ORDER ─────────────────────────────────────────
 *  1. SETTLE  cancelled subscriptions whose period has ended → account to `free`,
 *             which opens S2's retention grace on the next sweep.
 *  2. DUNNING apply the past-due schedule → `billing_restricted_at`.
 *  3. REPORT  usage to the provider, idempotently.
 *  4. RECONCILE local meters against what was reported, and alert on drift.
 *
 * Settle before dunning: an account whose subscription just ended should not be
 * restricted for being past due on a subscription that no longer exists.
 * Report before reconcile, so the reconciliation compares against the freshest
 * report rather than flagging drift the sweep was about to fix.
 *
 * ── AND IT IS INERT WITHOUT SUBSCRIPTIONS ───────────────────────────────────
 * Every operation is scoped to accounts that have one. On a deployment with no
 * provider configured there are none, so this does nothing at all — which is why
 * it defaults ON rather than following the usual off-by-default rule. Gating it
 * separately would mean "turn billing on" is two switches, and the one people
 * forget is the one that collects money.
 */
class BillingScheduler(
    private val ds: DataSource,
    private val reporter: UsageReporter,
    private val providers: BillingProviderRegistry,
    private val enabled: Boolean =
        System.getenv("BILLING_JOBS_ENABLED")?.lowercase() != "false",
    private val intervalMs: Long =
        System.getenv("BILLING_JOBS_INTERVAL_MS")?.toLongOrNull() ?: 3_600_000L,
) {
    private val log = LoggerFactory.getLogger(BillingScheduler::class.java)
    private val running = AtomicBoolean(false)
    private var future: ScheduledFuture<*>? = null

    private val executor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "billing-scheduler").also { it.isDaemon = true }
    }

    private companion object { const val JOB_NAME = "billing-scheduler" }

    fun start() {
        if (!enabled) {
            log.info("[billing] scheduled jobs disabled by BILLING_JOBS_ENABLED=false")
            return
        }
        if (!running.compareAndSet(false, true)) return
        ScheduledJobHealth.register(JOB_NAME, intervalMs)
        future = executor.scheduleWithFixedDelay(
            { ScheduledJobHealth.record(JOB_NAME) { tick() } },
            90_000L, intervalMs, TimeUnit.MILLISECONDS)
        log.info("[billing] scheduler started (interval={}ms, liveProvider={})",
            intervalMs, providers.anyLive)
    }

    fun stop() {
        running.set(false)
        future?.cancel(false)
        executor.shutdown()
    }

    /** One pass. Public so a test — and an operator — can force it. */
    fun tick(): Summary {
        val settled = call("billing_settle_ended_subscriptions")
        val restricted = call("billing_apply_dunning")

        /* Usage and reconciliation only matter once somebody is paying. Skipping
           them keeps the log quiet on a deployment that has no provider, rather
           than reporting "0 attempted" every hour until nobody reads it. */
        val usage = if (providers.anyLive) reporter.reportAll() else UsageReporter.Result(0, 0, 0, 0)
        val drift = if (providers.anyLive) reporter.reconcile() else 0

        if (settled > 0 || restricted > 0 || usage.reported > 0 || drift > 0) {
            log.info("[billing] pass: {} settled, {} dunning changes, {} usage reports, {} drifting",
                settled, restricted, usage.reported, drift)
        }
        if (drift > 0) {
            /* ERROR rather than WARN: drift means usage is not reaching the
               provider, which is revenue silently not being collected. It is the
               one outcome here that needs somebody to look today. */
            log.error("[billing] {} account/metric pairs are drifting — usage may be " +
                "under-reported. See billing_reconciliations.", drift)
        }

        return Summary(settled, restricted, usage.reported, drift)
    }

    data class Summary(
        val settled: Int,
        val dunningChanges: Int,
        val usageReported: Int,
        val driftFlagged: Int,
    )

    /**
     * Call a maintenance function that returns a count.
     *
     * Never throws: a billing job that failed and took the scheduler thread with
     * it would stop every later pass, and the first symptom would be a month of
     * un-dunned accounts.
     */
    private fun call(function: String): Int = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("SELECT $function()").use { st ->
                st.queryTimeout = 60
                st.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else 0 }
            }
        }
    }.getOrElse {
        log.error("[billing] {} failed: {}", function, it.message)
        0
    }
}
