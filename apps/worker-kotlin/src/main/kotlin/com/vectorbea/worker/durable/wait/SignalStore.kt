package com.vectorbea.worker.durable.wait

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.logging.logger
import java.sql.ResultSet
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Information delivered into a run after it started.
 *
 * ── THE CASE THIS EXISTS FOR ────────────────────────────────────────────────
 * An incident automation run is active and a second alert arrives for the same
 * service. Today a run takes input at start and never again, so the only
 * options are to start a second run that does not know about the first, or to
 * lose the alert.
 *
 * ── ORDERED BY A SEQUENCE, NOT BY A TIMESTAMP ───────────────────────────────
 * Two alerts can arrive in the same millisecond. `created_at` ties, and a run
 * that read its signals by time would see two different orderings on two reads —
 * which for an incident run means acting on the second alert's severity and then
 * the first's. The per-run sequence is allocated by the insert, from the run's
 * own maximum, so an order exists and is the same for every reader.
 *
 * ── DELIVERED, NOT DELETED ──────────────────────────────────────────────────
 * `consumed_at` is set rather than the row removed, because "what did this run
 * know, and when" is the first question an incident review asks. Retention
 * removes them with the run — a deletion, not a filter (invariant 10).
 */
open class SignalStore(private val dataSource: DataSource) {

    private val log = logger()
    private val mapper = jacksonObjectMapper()

    data class Signal(
        val id: UUID,
        val runId: UUID,
        val workspaceId: UUID,
        val sequence: Int,
        val name: String,
        val payloadJson: String,
        val createdAt: Instant,
        val sentBy: String?,
        val consumedAt: Instant?,
    ) {
        /** The shape a run's step sees. Sanitized by the writer, never re-read raw. */
        fun asObservation(mapper: com.fasterxml.jackson.databind.ObjectMapper): Map<String, Any?> = mapOf(
            "signal" to name,
            "sequence" to sequence,
            "receivedAt" to createdAt.toString(),
            "payload" to runCatching { mapper.readValue(payloadJson, Any::class.java) }
                .getOrDefault(emptyMap<String, Any>()),
        )
    }

    /** Why a signal could not be accepted. Each maps to a distinct API response. */
    sealed class SendResult {
        data class Accepted(val signal: Signal, val resolvedWaitId: UUID?) : SendResult()

        /** The same `dedupeKey` was already accepted. Returns the original. */
        data class Duplicate(val signal: Signal) : SendResult()

        /**
         * The run has finished. Rejected loudly rather than stored:
         * a signal delivered to a terminal run will never be read, and accepting
         * it would tell the caller their alert reached something.
         */
        data class RunTerminal(val status: String) : SendResult()

        data class RunNotFound(val runId: UUID) : SendResult()
    }

    /**
     * Append a signal.
     *
     * ── THE SEQUENCE AND THE TERMINAL CHECK ARE ONE TRANSACTION ─────────────
     * A run can reach a terminal state between the check and the insert, and a
     * signal written after that is a signal nothing will ever read. Both
     * statements run under one connection with the run row locked `FOR UPDATE`,
     * so the terminal check is still true when the row lands.
     */
    open fun send(
        runId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        name: String,
        payloadJson: String,
        sentByUserId: UUID?,
        sentByApiKeyId: UUID?,
        source: String,
        dedupeKey: String?,
    ): SendResult = dataSource.connection.use { conn ->
        conn.autoCommit = false
        try {
            val status = conn.prepareStatement(
                "SELECT status FROM agent_runs WHERE id = ? AND workspace_id = ? FOR UPDATE"
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, workspaceId)
                st.executeQuery().use { rs -> if (rs.next()) rs.getString("status") else null }
            } ?: run {
                conn.rollback()
                return@use SendResult.RunNotFound(runId)
            }

            if (status !in LIVE_STATUSES) {
                conn.rollback()
                return@use SendResult.RunTerminal(status)
            }

            /* An earlier delivery with the same key is the same signal. An
               alerting system that retries on a timeout would otherwise deliver
               one alert twice, and a run acting on it twice is the bug. */
            if (dedupeKey != null) {
                existingByDedupe(conn, runId, dedupeKey)?.let {
                    conn.rollback()
                    return@use SendResult.Duplicate(it)
                }
            }

            val signal = conn.prepareStatement(
                """INSERT INTO run_signals
                     (workspace_id, environment_id, run_id, sequence, name, payload_json,
                      sent_by_user_id, sent_by_api_key_id, source, dedupe_key)
                   VALUES (?,?,?,
                           (SELECT COALESCE(MAX(sequence), 0) + 1 FROM run_signals WHERE run_id = ?),
                           ?, ?::jsonb, ?, ?, ?, ?)
                   RETURNING $COLUMNS"""
            ).use { st ->
                st.setObject(1, workspaceId)
                st.setObject(2, environmentId)
                st.setObject(3, runId)
                st.setObject(4, runId)
                st.setString(5, name)
                st.setString(6, payloadJson)
                st.setObject(7, sentByUserId)
                st.setObject(8, sentByApiKeyId)
                st.setString(9, source)
                st.setString(10, dedupeKey)
                st.executeQuery().use { rs -> if (rs.next()) map(rs) else null }
            } ?: run {
                conn.rollback()
                return@use SendResult.RunNotFound(runId)
            }

            conn.commit()
            SendResult.Accepted(signal, resolvedWaitId = null)
        } catch (e: Exception) {
            conn.rollback()
            /* A unique violation on the dedupe index is a concurrent duplicate,
               not a failure: two retries of one delivery raced and both are the
               same signal. Read the winner back and report it as a duplicate. */
            val dup = dedupeKey?.let { key ->
                runCatching { dataSource.connection.use { c -> existingByDedupe(c, runId, key) } }
                    .getOrNull()
            }
            if (dup != null) SendResult.Duplicate(dup) else throw e
        } finally {
            conn.autoCommit = true
        }
    }

    /**
     * Unconsumed signals for a run, oldest first.
     *
     * Read at every step boundary, so it is one indexed lookup on a partial index
     * over unconsumed rows — which is empty for the overwhelming majority of runs
     * and therefore costs a bounded index probe rather than a scan.
     */
    open fun pending(runId: UUID, limit: Int = 50): List<Signal> = try {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT $COLUMNS FROM run_signals
                   WHERE run_id = ? AND consumed_at IS NULL
                   ORDER BY sequence LIMIT ?"""
            ).use { st ->
                st.setObject(1, runId); st.setInt(2, limit)
                st.executeQuery().use { rs -> buildList { while (rs.next()) add(map(rs)) } }
            }
        }
    } catch (e: Exception) {
        log.error("[signal] pending lookup failed for run {}: {}", runId, e.message)
        emptyList()
    }

    /**
     * Mark signals delivered.
     *
     * A CAS on `consumed_at IS NULL`, so a run that reads its signals on two
     * concurrent branches delivers each exactly once — the second update finds
     * nothing and the branch sees an empty list, which is correct: the signal was
     * delivered, once, to the run.
     */
    open fun consume(ids: List<UUID>, waitId: UUID?): Int {
        if (ids.isEmpty()) return 0
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE run_signals
                          SET consumed_at = now(), consumed_wait_id = ?
                        WHERE id = ANY (?) AND consumed_at IS NULL"""
                ).use { st ->
                    st.setObject(1, waitId)
                    st.setArray(2, conn.createArrayOf("uuid", ids.toTypedArray()))
                    st.executeUpdate()
                }
            }
        } catch (e: Exception) {
            log.error("[signal] consume failed: {}", e.message)
            0
        }
    }

    /** Runs with at least one unconsumed signal. The reconciler's seventh arm. */
    open fun runsWithPendingSignals(limit: Int): List<UUID> = try {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT DISTINCT s.run_id
                     FROM run_signals s
                     JOIN agent_runs r ON r.id = s.run_id
                    WHERE s.consumed_at IS NULL
                      AND r.status IN ('waiting_for_event', 'waiting_for_approval',
                                       'waiting_for_child', 'waiting_for_timer')
                    LIMIT ?"""
            ).use { st ->
                st.setInt(1, limit)
                st.executeQuery().use { rs ->
                    buildList { while (rs.next()) add(rs.getObject(1, UUID::class.java)) }
                }
            }
        }
    } catch (e: Exception) {
        log.error("[signal] pending-runs sweep failed: {}", e.message)
        emptyList()
    }

    private fun existingByDedupe(
        conn: java.sql.Connection,
        runId: UUID,
        dedupeKey: String,
    ): Signal? = conn.prepareStatement(
        "SELECT $COLUMNS FROM run_signals WHERE run_id = ? AND dedupe_key = ?"
    ).use { st ->
        st.setObject(1, runId); st.setString(2, dedupeKey)
        st.executeQuery().use { rs -> if (rs.next()) map(rs) else null }
    }

    private fun map(rs: ResultSet) = Signal(
        id = rs.getObject("id", UUID::class.java),
        runId = rs.getObject("run_id", UUID::class.java),
        workspaceId = rs.getObject("workspace_id", UUID::class.java),
        sequence = rs.getInt("sequence"),
        name = rs.getString("name"),
        payloadJson = rs.getString("payload_json") ?: "{}",
        createdAt = rs.getTimestamp("created_at").toInstant(),
        sentBy = rs.getString("sent_by_user_id") ?: rs.getString("sent_by_api_key_id"),
        consumedAt = rs.getTimestamp("consumed_at")?.toInstant(),
    )

    companion object {
        private const val COLUMNS = """
            id, workspace_id, environment_id, run_id, sequence, name, payload_json,
            sent_by_user_id, sent_by_api_key_id, source, dedupe_key, created_at,
            consumed_at, consumed_wait_id
        """

        /**
         * Statuses from which a run can still read a signal.
         *
         * ── AN ALLOW-LIST, NOT A DENY-LIST, AND THAT MATTERS ────────────────
         * The obvious spelling is `status NOT IN ('succeeded','failed',
         * 'cancelled')`, which is what two other places in the runtime say. It is
         * wrong here, because a ceiling breach is terminal under FIVE more names
         * — `cost_limit_exceeded`, `step_limit_exceeded`, `token_limit_exceeded`,
         * `duration_limit_exceeded`, `payload_limit_exceeded` — and `RunCeilings`
         * is free to add a sixth. A deny-list would accept a signal into a run
         * that hit its cost ceiling and report it delivered.
         *
         * Listing what is LIVE fails the safe way: a status this does not know
         * about is treated as terminal and the caller is told so, rather than
         * silently accepting a signal nothing will ever read.
         */
        val LIVE_STATUSES = setOf(
            "queued", "claimed", "running", "yielded", "recovering",
            "waiting_for_approval", "waiting_for_child", "waiting_for_timer",
            "waiting_for_event",
        )
    }
}
