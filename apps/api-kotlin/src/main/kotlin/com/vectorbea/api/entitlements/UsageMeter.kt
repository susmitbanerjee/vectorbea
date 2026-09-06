package com.vectorbea.api.entitlements

import org.slf4j.LoggerFactory
import java.math.BigDecimal
import java.util.UUID
import javax.sql.DataSource

/**
 * The billing ledger's write side.
 *
 * ── ONE RUN COUNTS ONCE ─────────────────────────────────────────────────────
 * The key is the RUN id. Not an event, not a message, not a sequence number —
 * the run. That is the only identifier that survives every path a single run can
 * take through the system:
 *
 *   resume        the run row is the same row; the step re-executes from
 *                 iteration 1 and the meter writes the same key
 *   retry         same
 *   redelivery    a duplicate queue message reaches a terminal transition that
 *                 has already happened; the meter writes the same key
 *   reconcile     the backfill sweep writes the same key
 *
 * S4 bills from `usage_records`, so a double-counted run is a double CHARGE, and
 * a charge is much harder to take back than it was to make. Keying on anything
 * that changes between attempts — an iteration number, a timestamp, a fresh
 * UUID — reintroduces every one of the four paths above.
 *
 * ── AND THE WRITE IS AN OVERWRITE ───────────────────────────────────────────
 * Every call stores the ABSOLUTE value for that run, never a delta. `runs` is
 * always 1. `tokens` and `agent_minutes` are the run's totals as currently
 * known, so a resume that did more work overwrites with a larger figure and
 * stays exact, while a redelivery overwrites with the same figure and changes
 * nothing. `quantity = quantity + ?` would double on every redelivery and be
 * undetectable afterwards.
 *
 * ── A REPLAY METERS ZERO ────────────────────────────────────────────────────
 * Not by a check here — by `meter_run_usage()` refusing to write a row for a run
 * whose `execution_mode_kind` is 'replay'. In the function rather than in this
 * class because the worker meters too, and a rule enforced in one caller is a
 * rule the other caller will eventually break. It is the same rule the
 * dashboards already apply (`ReplayNotCountedTest`), enforced where the ledger
 * cannot disagree with them.
 *
 * ── METERING NEVER FAILS A RUN ──────────────────────────────────────────────
 * Every method swallows its errors and returns false. A ledger write is not
 * worth a customer's run: `reconcile_run_usage()` backfills anything lost, and
 * an under-count that gets repaired is strictly better than a failed run that
 * does not.
 */
class UsageMeter(
    private val dataSource: DataSource,
    private val resolver: EntitlementResolver? = null,
) {
    private val log = LoggerFactory.getLogger(UsageMeter::class.java)

    /**
     * Count a run against its workspace's account.
     *
     * Called once, immediately after the run row is created — not at completion.
     * Admission is what the quota governs, so the ledger and the check have to
     * measure the same event: metering at completion would let an account queue
     * a thousand runs against a spent quota because none of them had finished
     * yet.
     */
    fun meterRunAdmitted(runId: UUID, accountId: UUID? = null): Boolean =
        meter(runId, "runs", BigDecimal.ONE)
            .also { if (it && accountId != null) resolver?.invalidateUsage(accountId) }

    /** Provider tokens consumed by the run, as an absolute total. */
    fun meterTokens(runId: UUID, tokens: Long): Boolean =
        meter(runId, "tokens", BigDecimal.valueOf(tokens))

    /** Wall-clock minutes of agent execution, as an absolute total. */
    fun meterAgentMinutes(runId: UUID, minutes: Double): Boolean =
        meter(runId, "agent_minutes", BigDecimal.valueOf(minutes))

    /**
     * BigDecimal, not Double, and the type is load-bearing twice over.
     *
     * `meter_run_usage`'s third parameter is `numeric`. JDBC sends a Kotlin
     * `Double` as `float8`, and Postgres has no IMPLICIT cast from float8 to
     * numeric — only an assignment cast — so function resolution fails and the
     * call throws. This class swallows its errors on purpose (a ledger write is
     * never worth a customer's run), so the symptom was not an exception
     * anywhere: it was every run metering silently to nothing, and an invoice of
     * zero. `EntitlementAcceptanceTest` is what found it.
     *
     * It is also the right type on its own merits. This is money-adjacent, the
     * column is `numeric(20,4)`, and a float that survives one round trip
     * through a ledger is a rounding difference somebody has to explain.
     */
    private fun meter(runId: UUID, metric: String, quantity: BigDecimal): Boolean = try {
        dataSource.connection.use { conn ->
            conn.prepareStatement("SELECT meter_run_usage(?, ?, ?)").use { st ->
                st.setObject(1, runId)
                st.setString(2, metric)
                st.setBigDecimal(3, quantity)
                st.queryTimeout = 3
                st.executeQuery().use { rs -> rs.next() && rs.getBoolean(1) }
            }
        }
    } catch (e: Exception) {
        // WARN and not ERROR: reconcile_run_usage() repairs this, and paging on
        // a metering blip that self-heals is how a real page gets ignored.
        log.warn("[usage] meter failed run={} metric={}: {}", runId, metric, e.message)
        false
    }
}
