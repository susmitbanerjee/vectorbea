package com.vectorbea.worker.runtime

import com.vectorbea.worker.logging.logger
import java.util.UUID
import javax.sql.DataSource

/**
 * Consumption metering, at the terminal transition.
 *
 * ── WHY THE WORKER METERS AT ALL ────────────────────────────────────────────
 * The API meters `runs` when a run is admitted, because admission is what the
 * run quota governs. Tokens and agent minutes are not known then — they are the
 * result of running — so they are metered here, from the figures the CAS has
 * just written to `agent_runs`.
 *
 * ── ONE RUN COUNTS ONCE ─────────────────────────────────────────────────────
 * Two protections, and each would be sufficient on its own:
 *
 *  1. This is called from `onTerminalTransition`, which runs only for the thread
 *     that WON the status CAS. A redelivered message loses the CAS and never
 *     reaches here.
 *  2. `meter_run_usage` keys on the RUN id and OVERWRITES rather than
 *     incrementing. So even if it were called a hundred times, the ledger would
 *     hold one row per metric, carrying the run's absolute totals.
 *
 * Belt and braces, deliberately: S4 bills from this ledger, and a double-counted
 * run is a double charge. The CAS is a runtime property that a future refactor
 * could weaken; the primary key is a schema property that it cannot.
 *
 * ── THE FIGURES COME FROM THE ROW, NOT FROM KOTLIN ──────────────────────────
 * One statement, reading `token_count` and `duration_ms` off `agent_runs` and
 * passing them straight back into the meter. Nothing is carried in memory
 * between the CAS and the ledger, so the ledger cannot disagree with the row a
 * customer sees on the run page — which is the class of bug that makes an
 * invoice indefensible.
 *
 * ── AND A REPLAY METERS ZERO ────────────────────────────────────────────────
 * Enforced inside `meter_run_usage`, not here. A replay makes no provider calls,
 * and charging one would bill a debugging session — the same rule the dashboards
 * already apply.
 *
 * ── NEVER FAILS A RUN ───────────────────────────────────────────────────────
 * Errors are swallowed and logged at WARN. `reconcile_run_usage()` repairs a
 * lost write; a run failed for a ledger error repairs nothing.
 */
class RunUsageMeter(private val dataSource: DataSource?) {

    private val log = logger()

    /**
     * Meter one terminal run.
     *
     * Takes and releases exactly ONE connection, and must be called with none
     * held — see the hold-and-wait note on `RunProcessor.onTerminalTransition`.
     */
    fun meterTerminal(runId: UUID) {
        val ds = dataSource ?: return
        try {
            ds.connection.use { conn ->
                conn.prepareStatement(SQL).use { stmt ->
                    stmt.setObject(1, runId)
                    stmt.queryTimeout = 3
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) {
                            log.debug("[usage] metered run {} tokens={} minutes={}",
                                runId, rs.getBoolean(1), rs.getBoolean(2))
                        }
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[usage] terminal metering failed for run {}: {}", runId, e.message)
        }
    }

    private companion object {
        /**
         * Agent minutes are metered only for the agent classes.
         *
         * A `short` transform that takes four seconds is not an agent minute, and
         * counting it as one would make the quota measure wall-clock time rather
         * than the scarce resource it exists to ration. The classes named here
         * are exactly the ones `ExecutionClass` routes to the agent pools.
         *
         * `duration_ms` and not `now() - started_at`: the CAS has already frozen
         * the duration on the row, and re-deriving it here would give a resumed
         * run a different figure on every attempt — which is precisely the
         * instability that makes an overwrite unsafe.
         */
        val SQL = """
            SELECT meter_run_usage(r.id, 'tokens', COALESCE(r.token_count, 0)::numeric) AS tokens,
                   CASE WHEN r.execution_class IN ('agent','agent.child','agent.interactive')
                        THEN meter_run_usage(r.id, 'agent_minutes',
                                             COALESCE(r.duration_ms, 0)::numeric / 60000.0)
                        ELSE false
                   END AS minutes
              FROM agent_runs r
             WHERE r.id = ?
        """.trimIndent()
    }
}
