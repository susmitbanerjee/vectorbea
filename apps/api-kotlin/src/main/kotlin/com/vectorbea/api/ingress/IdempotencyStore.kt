package com.vectorbea.api.ingress

import com.vectorbea.api.errors.ApiError
import org.slf4j.LoggerFactory
import java.security.MessageDigest
import java.sql.SQLException
import java.time.Duration
import java.util.UUID
import javax.sql.DataSource

/**
 * Claims on a run-creation idempotency key.
 *
 * ── WHAT WAS WRONG WITH THE OLD ONE ─────────────────────────────────────────
 * `checkIdempotency` was a Redis GET and `recordIdempotency` a SETEX, run at
 * opposite ends of a ~200-line handler. Three ways that starts a second run:
 *
 *   1. GET-then-SET is not atomic, so two concurrent POSTs with the same key
 *      both miss and both create a run. That is not an exotic race — it is the
 *      normal shape of a client retrying a timeout, where the first request is
 *      still in flight.
 *   2. The record happened AFTER the enqueue, so the entire admission sequence
 *      — quota, rate limit, placement, insert — was unguarded. The retry lands
 *      inside that window by construction, because the window is why it retried.
 *   3. `redis` is nullable here. With Redis down the check silently did nothing,
 *      so the guarantee disappeared during exactly the incident that produced
 *      the retries.
 *
 * ── SO: CLAIM FIRST, IN POSTGRES ────────────────────────────────────────────
 * `INSERT ... ON CONFLICT DO NOTHING` is one atomic statement. The winner gets
 * a claim and goes on to create the run; the loser reads the row back and
 * returns the original run id. The claim is taken BEFORE quota and admission,
 * so the guarded window covers the whole sequence.
 *
 * A refused run releases its claim ([release]) — a quota rejection must not
 * make the key unusable for the next 24 hours, or a client that retries after
 * upgrading their plan gets a duplicate error instead of a run.
 */
open class IdempotencyStore(private val dataSource: DataSource) {

    private val log = LoggerFactory.getLogger(IdempotencyStore::class.java)

    companion object {
        /** Matches the TTL the Redis implementation promised, so no client's expectation moves. */
        val WINDOW: Duration = Duration.ofHours(24)

        /** Long enough to be unguessable, short enough to be a header. */
        const val MAX_KEY_LENGTH = 255

        /**
         * How long a caller may wait for the winner to finish creating the run.
         *
         * The loser of the race arrives while the winner is between its claim and
         * its insert — milliseconds, normally. Waiting briefly turns a confusing
         * "in flight, try again" into the right answer; waiting long would hold a
         * request thread hostage to somebody else's slow insert.
         */
        val IN_FLIGHT_WAIT: Duration = Duration.ofSeconds(2)

        /**
         * What the caller asked for, reduced to a comparison.
         *
         * Hashed rather than stored: the input is caller data of unbounded size,
         * and keeping a second copy of every run's input would give this table a
         * retention question it has no business having.
         */
        fun fingerprint(workflowId: UUID, environmentId: UUID, inputJson: String): String {
            val material = "$workflowId|$environmentId|$inputJson"
            return MessageDigest.getInstance("SHA-256")
                .digest(material.toByteArray())
                .joinToString("") { "%02x".format(it) }
        }
    }

    /** The outcome of trying to claim a key. */
    sealed interface Claim {
        /** This caller owns the key and must go on to create the run. */
        data class Won(val key: String) : Claim

        /** Somebody already created this run. Return it and do nothing else. */
        data class AlreadyRan(val runId: UUID) : Claim

        /**
         * The key is claimed, the run does not exist yet, and waiting did not
         * help. The caller is told to retry — which is honest, and is the only
         * answer that cannot produce a second run.
         */
        data object InFlight : Claim
    }

    /**
     * Take the key, or find out who has it.
     *
     * @throws ApiError.Conflict when the key is reused with a different request.
     *   That is a client bug and it must be loud: returning the first run's id
     *   for a genuinely different request would tell the caller their second
     *   request happened when it did not.
     */
    open fun claim(
        workspaceId: UUID,
        key: String,
        fingerprint: String,
        triggerType: String,
    ): Claim {
        if (key.length > MAX_KEY_LENGTH) {
            throw ApiError.ValidationError(
                "The idempotency key is longer than $MAX_KEY_LENGTH characters. " +
                    "Use a request id or a UUID."
            )
        }

        val inserted = try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """INSERT INTO run_idempotency_keys
                         (workspace_id, idempotency_key, request_fingerprint, trigger_type, expires_at)
                       VALUES (?,?,?,?, now() + make_interval(secs => ?))
                       ON CONFLICT (workspace_id, idempotency_key) DO NOTHING"""
                ).use { st ->
                    st.setObject(1, workspaceId)
                    st.setString(2, key)
                    st.setString(3, fingerprint)
                    st.setString(4, triggerType)
                    st.setDouble(5, WINDOW.seconds.toDouble())
                    st.executeUpdate() > 0
                }
            }
        } catch (e: SQLException) {
            /*
             * ── FAIL OPEN, LOUDLY ───────────────────────────────────────────
             * A database that cannot take the claim is an outage, and refusing
             * every run during it would turn a degraded idempotency guarantee
             * into a total one. The run proceeds without protection, and the log
             * line says so — which is strictly better than the old behaviour,
             * where the same failure was silent because Redis was optional.
             */
            log.error("[idempotency] claim failed for workspace {} — proceeding UNGUARDED: {}",
                workspaceId, e.message)
            return Claim.Won(key)
        }

        if (inserted) return Claim.Won(key)

        // Somebody else holds it. Who, and for what?
        val existing = read(workspaceId, key)
            ?: return Claim.Won(key)   // Expired and swept between our insert and this read.

        if (existing.fingerprint != fingerprint) {
            throw ApiError.Conflict(
                "This idempotency key was already used for a different request. " +
                    "Use a new key, or resend the original request unchanged."
            )
        }

        existing.runId?.let { return Claim.AlreadyRan(it) }

        /* The winner is mid-insert. Give it a moment — this is a race measured in
           milliseconds, and returning "retry" for it would make the common
           concurrent-retry case fail for no reason. */
        val deadline = System.nanoTime() + IN_FLIGHT_WAIT.toNanos()
        while (System.nanoTime() < deadline) {
            Thread.sleep(50)
            read(workspaceId, key)?.runId?.let { return Claim.AlreadyRan(it) }
        }
        return Claim.InFlight
    }

    /** Attach the run to a claim this caller won. */
    open fun complete(workspaceId: UUID, key: String, runId: UUID) {
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE run_idempotency_keys SET run_id = ?
                        WHERE workspace_id = ? AND idempotency_key = ? AND run_id IS NULL"""
                ).use { st ->
                    st.setObject(1, runId); st.setObject(2, workspaceId); st.setString(3, key)
                    st.executeUpdate()
                }
            }
        }.onFailure {
            /* The run exists and is running; the claim is orphaned. It expires in
               24 hours and a retry in the meantime gets `InFlight`, which is a
               poor answer but not a duplicate one. Never fail a live run for this. */
            log.error("[idempotency] could not attach run {} to key: {}", runId, it.message)
        }
    }

    /**
     * Give the key back after a refusal.
     *
     * A quota rejection, a concurrency limit, a failed enqueue — none of those
     * started a run, so none of them should burn the key. Without this, a client
     * refused for being over quota would upgrade, retry with the same key, and
     * be told it was a duplicate of a run that never existed.
     */
    open fun release(workspaceId: UUID, key: String) {
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    "DELETE FROM run_idempotency_keys " +
                        "WHERE workspace_id = ? AND idempotency_key = ? AND run_id IS NULL"
                ).use { st ->
                    st.setObject(1, workspaceId); st.setString(2, key); st.executeUpdate()
                }
            }
        }.onFailure { log.warn("[idempotency] release failed: {}", it.message) }
    }

    /**
     * Delete expired claims.
     *
     * A DELETE, not a `WHERE expires_at > now()` on the read path — invariant 10.
     * A filter would leave every key ever used sitting in the table, and the
     * uniqueness constraint would then refuse a key the client is entitled to
     * reuse.
     */
    open fun sweepExpired(limit: Int = 5_000): Int = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """DELETE FROM run_idempotency_keys
                    WHERE (workspace_id, idempotency_key) IN (
                        SELECT workspace_id, idempotency_key FROM run_idempotency_keys
                         WHERE expires_at <= now() LIMIT ?)"""
            ).use { st -> st.setInt(1, limit); st.executeUpdate() }
        }
    }.getOrElse {
        log.warn("[idempotency] sweep failed: {}", it.message)
        0
    }

    private data class Row(val runId: UUID?, val fingerprint: String)

    private fun read(workspaceId: UUID, key: String): Row? = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "SELECT run_id, request_fingerprint FROM run_idempotency_keys " +
                    "WHERE workspace_id = ? AND idempotency_key = ? AND expires_at > now()"
            ).use { st ->
                st.setObject(1, workspaceId); st.setString(2, key)
                st.executeQuery().use { rs ->
                    if (rs.next()) Row(
                        runId = rs.getObject("run_id")?.let { it as UUID },
                        fingerprint = rs.getString("request_fingerprint"),
                    ) else null
                }
            }
        }
    }.getOrNull()
}
