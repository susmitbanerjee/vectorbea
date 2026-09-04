package com.vectorbea.worker.durable

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import kotlinx.coroutines.delay
import java.security.MessageDigest
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Makes an at-least-once queue safe for operations that must happen once.
 *
 * THE WINDOW THIS CLOSES
 * ----------------------
 * Between "the email was sent" and "we recorded that the email was sent" there
 * is a gap. A crash in that gap leaves the side effect done and the system
 * believing it is not, so the redelivery sends it again. The customer gets two
 * emails; nobody files a bug, they file a complaint.
 *
 * The fix is to record the *intent* before the call and the *result* after it,
 * under a key that a retry will compute identically:
 *
 *   1. INSERT `in_flight` with a unique key
 *   2. conflict on `succeeded` → return the stored response, skip the call
 *   3. conflict on `in_flight`  → someone is mid-call; wait, back off, re-check
 *   4. perform the call, store the response, mark `succeeded`
 *   5. on failure mark `failed`, which permits a genuine retry
 *
 * WHY THE KEY USES attempt_group AND NOT attempt
 * ----------------------------------------------
 * This is the part that is easy to get subtly wrong. `attempt` increments on
 * every automatic retry, so a key derived from it would be different on each
 * retry — every retry would miss the dedupe and send the email again. The
 * mechanism would look present and do nothing.
 *
 * `attempt_group` increments only when a human asks for the work to happen again.
 * So retries of one logical operation share a key and dedupe, while a deliberate
 * re-run gets a fresh key and *does* send a second email — which is what the user
 * asked for.
 */
class SideEffectGuard(
    private val dataSource: DataSource,
    private val workerId: String,
) {
    private val log = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        /** How long an `in_flight` row may sit before we assume its worker died. */
        private val STALE_IN_FLIGHT_MS =
            System.getenv("SIDE_EFFECT_STALE_MS")?.toLongOrNull() ?: 120_000L

        /** Backoff schedule while waiting on another attempt's in-flight call. */
        private val WAIT_BACKOFF_MS = longArrayOf(100, 250, 500, 1_000, 2_000, 4_000)

        /**
         * Deterministic idempotency key.
         *
         * SHA-256 over the tuple, hex-truncated: stable across processes and JVM
         * versions (unlike `hashCode`), collision-resistant, and short enough to
         * pass to a provider as a header. Prefixed so a key is recognisable in a
         * provider's dashboard during an incident.
         */
        fun keyFor(runId: UUID, nodeId: String, attemptGroup: Int): String {
            val material = "$runId|$nodeId|$attemptGroup"
            val digest = MessageDigest.getInstance("SHA-256").digest(material.toByteArray())
            return "vb_" + digest.joinToString("") { "%02x".format(it) }.take(40)
        }
    }

    /** What the guard decided, and the response if the call had already happened. */
    sealed class Outcome {
        /** Safe to perform the call. Report the result via [SideEffectGuard.complete] / [fail]. */
        data class Proceed(val key: String, val sideEffectId: UUID) : Outcome()

        /** Already done. Do NOT call. Replay [response] as this node's result. */
        data class AlreadyDone(val key: String, val response: String?) : Outcome()

        /**
         * Another attempt held the call in flight and never finished, and it is
         * not safe to guess which way it went. The node fails rather than risk a
         * duplicate; a human decides from the `side_effects` row.
         */
        data class Undetermined(val key: String, val reason: String) : Outcome()
    }

    /**
     * Reserve the right to perform one external side effect.
     *
     * Suspending because step 3 waits, and waiting must not cost a thread now
     * that execution slots are permits.
     */
    suspend fun begin(
        workspaceId: UUID,
        runId: UUID,
        nodeId: String,
        attemptGroup: Int,
        effectType: String,
        target: String?,
        leaseToken: String?,
    ): Outcome {
        val key = keyFor(runId, nodeId, attemptGroup)

        for (attempt in 0..WAIT_BACKOFF_MS.size) {
            when (val r = tryInsert(workspaceId, runId, nodeId, key, attemptGroup, effectType, target, leaseToken)) {
                is Outcome.Proceed -> return r

                is Outcome.AlreadyDone -> {
                    // The proof the mechanism works. In a chaos test this is
                    // non-zero; in steady state it is near zero.
                    WorkerMetrics.sideEffectDedupeTotal.inc(effectType)
                    log.info("[side-effect] DEDUPED — {} for run {} node {} already succeeded; " +
                        "returning stored response, call skipped", effectType, runId, nodeId)
                    return r
                }

                is Outcome.Undetermined -> {
                    if (attempt >= WAIT_BACKOFF_MS.size) {
                        WorkerMetrics.sideEffectUndeterminedTotal.inc(effectType)
                        return r
                    }
                    // An in_flight row: another attempt is mid-call. Wait rather
                    // than race it — a duplicate email is worse than a slow one.
                    delay(WAIT_BACKOFF_MS[attempt])
                }
            }
        }
        return Outcome.Undetermined(key, "exhausted wait for in-flight side effect")
    }

    private fun tryInsert(
        workspaceId: UUID, runId: UUID, nodeId: String, key: String,
        attemptGroup: Int, effectType: String, target: String?, leaseToken: String?,
    ): Outcome {
        val id = UUID.randomUUID()
        dataSource.connection.use { conn ->
            // Claim the key. ON CONFLICT DO NOTHING makes this a pure test-and-set:
            // exactly one attempt across the whole fleet gets the row.
            val inserted = conn.prepareStatement(
                """
                INSERT INTO side_effects
                    (id, workspace_id, run_id, node_id, idempotency_key, effect_type,
                     target, status, worker_id, lease_token, attempt_group)
                VALUES (?,?,?,?,?,?,?, 'in_flight', ?,?,?)
                ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
                """.trimIndent()
            ).use { stmt ->
                stmt.setObject(1, id); stmt.setObject(2, workspaceId)
                stmt.setObject(3, runId); stmt.setString(4, nodeId)
                stmt.setString(5, key); stmt.setString(6, effectType)
                stmt.setString(7, target); stmt.setString(8, workerId)
                stmt.setString(9, leaseToken); stmt.setInt(10, attemptGroup)
                stmt.executeUpdate()
            }
            if (inserted > 0) return Outcome.Proceed(key, id)

            // Lost the race — inspect the winner.
            conn.prepareStatement(
                """SELECT id, status, response_json,
                          EXTRACT(EPOCH FROM (now() - started_at)) * 1000 AS age_ms
                     FROM side_effects
                    WHERE workspace_id = ? AND idempotency_key = ?"""
            ).use { stmt ->
                stmt.setObject(1, workspaceId); stmt.setString(2, key)
                stmt.executeQuery().use { rs ->
                    if (!rs.next()) {
                        // Vanishingly rare: deleted between our INSERT and this
                        // SELECT. Retry the whole thing.
                        return Outcome.Undetermined(key, "row disappeared, retrying")
                    }
                    val status = rs.getString("status")
                    val response = rs.getString("response_json")
                    val ageMs = rs.getDouble("age_ms").toLong()
                    val existingId = UUID.fromString(rs.getString("id"))

                    return when (status) {
                        "succeeded" -> Outcome.AlreadyDone(key, response)

                        // A genuine failure is retryable — take the row over.
                        "failed" -> {
                            val taken = conn.prepareStatement(
                                """UPDATE side_effects
                                      SET status='in_flight', worker_id=?, started_at=now(),
                                          error_json=NULL, updated_at=now()
                                    WHERE id=? AND status='failed'"""
                            ).use { u ->
                                u.setString(1, workerId); u.setObject(2, existingId); u.executeUpdate()
                            }
                            if (taken > 0) Outcome.Proceed(key, existingId)
                            else Outcome.Undetermined(key, "lost race re-claiming failed row")
                        }

                        else -> {
                            // in_flight. If it is fresh, someone is genuinely
                            // mid-call and we wait. If it is stale, its worker
                            // died — and we still do NOT assume the call did not
                            // happen, because a crash after the provider
                            // received the request looks identical from here.
                            if (ageMs > STALE_IN_FLIGHT_MS) {
                                Outcome.Undetermined(key,
                                    "a previous attempt died mid-call ${ageMs}ms ago; " +
                                        "the external effect may or may not have happened. " +
                                        "Refusing to repeat it — resolve side_effects row $existingId manually.")
                            } else {
                                Outcome.Undetermined(key, "another attempt is in flight")
                            }
                        }
                    }
                }
            }
        }
    }

    /** Record success and store the response for future dedupe hits. */
    fun complete(sideEffectId: UUID, response: String?) {
        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE side_effects
                          SET status='succeeded', response_json=?::jsonb,
                              completed_at=now(), updated_at=now()
                        WHERE id=?"""
                ).use { stmt ->
                    stmt.setString(1, response?.let { safeJson(it) })
                    stmt.setObject(2, sideEffectId)
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) {
            // The call already happened. Failing to record it means the next
            // attempt sees in_flight and refuses rather than duplicating —
            // degraded, but on the safe side.
            log.error("[side-effect] could not record success for {} — the effect DID happen: {}",
                sideEffectId, e.message)
        }
    }

    /** Record a genuine failure, which permits a legitimate retry. */
    fun fail(sideEffectId: UUID, error: String) {
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE side_effects
                          SET status='failed', error_json=?::jsonb,
                              completed_at=now(), updated_at=now()
                        WHERE id=?"""
                ).use { stmt ->
                    stmt.setString(1, mapper.writeValueAsString(mapOf("error" to error.take(2000))))
                    stmt.setObject(2, sideEffectId)
                    stmt.executeUpdate()
                }
            }
        }.onFailure { log.warn("[side-effect] could not record failure for {}: {}", sideEffectId, it.message) }
    }

    /** Wrap a non-JSON response so the JSONB column always parses. */
    private fun safeJson(raw: String): String =
        try {
            mapper.readTree(raw); raw
        } catch (_: Exception) {
            mapper.writeValueAsString(mapOf("raw" to raw.take(100_000)))
        }
}
