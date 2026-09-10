package com.vectorbea.api.ingress

import com.vectorbea.api.errors.ApiError
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * One live run per key.
 *
 * ── WHY THIS IS NOT `idempotency_key` ───────────────────────────────────────
 * They answer different questions and the difference is at the boundary:
 *
 *   idempotency key   "is this the same REQUEST?" — deduplicates a client's
 *                     retry. Expires on a 24-hour clock whether or not the run
 *                     finished.
 *   dedup key         "is something already working on this THING?" — lives for
 *                     exactly as long as its run does, because the moment an
 *                     incident closes, a new alert for the same service should
 *                     start a new incident.
 *
 * Two alerts for the same service must not start two incident runs. That is not
 * a nicety for event-driven work; it is the difference between an incident
 * channel with one run in it and one with forty.
 *
 * ── AND WHY THE INDEX DOES THE WORK ─────────────────────────────────────────
 * Two alerts for one service arriving in the same second is the NORMAL case —
 * it is what a flapping check produces — so a SELECT-then-INSERT loses the race
 * exactly when it matters. `agent_runs_dedup_live_unique` (V068) is a partial
 * unique index over the live statuses: at most one non-terminal run per key,
 * enforced by the database, freed atomically when the run ends.
 *
 * This class is what happens when that index says no.
 */
class RunDedup(private val dataSource: DataSource) {

    private val log = LoggerFactory.getLogger(RunDedup::class.java)

    /** What the workflow wants done when the key is taken. */
    enum class Policy(val wire: String) {
        /**
         * Tell the caller which run already owns it.
         *
         * The default, because it is the only one that cannot silently do the
         * wrong thing: the caller always learns what happened and can decide.
         */
        REJECT("reject"),

        /**
         * Deliver the new input to the live run as a signal.
         *
         * A second alert becomes more information about the incident already
         * being worked, rather than a second incident. Requires the run to be
         * listening — see `workflows.dedup_join_signal`.
         */
        JOIN("join"),

        /**
         * Cancel the live run and start a new one.
         *
         * For a trigger where only the latest input matters — a re-deploy
         * superseding the one before it. Costly and irreversible, which is why
         * it is never the default.
         */
        SUPERSEDE("supersede");

        companion object {
            fun of(value: String?): Policy =
                entries.firstOrNull { it.wire == value } ?: REJECT
        }
    }

    /** The live run holding a key, if there is one. */
    data class Holder(val runId: UUID, val status: String)

    /**
     * Who holds this key right now.
     *
     * Advisory: between this read and the insert the holder may finish, or a
     * concurrent caller may take the key. The index is what actually decides —
     * this exists so a `join` or a `supersede` knows what it is acting on, and
     * so a `reject` can name the run rather than saying "taken".
     */
    fun holderOf(workspaceId: UUID, workflowId: UUID, key: String): Holder? = runCatching {
        dataSource.connection.use { c ->
            c.prepareStatement(
                """SELECT id, status FROM agent_runs
                    WHERE workspace_id = ? AND workflow_id = ? AND dedup_key = ?
                      AND status IN ($LIVE_STATUS_SQL)
                    ORDER BY created_at DESC LIMIT 1"""
            ).use { st ->
                st.setObject(1, workspaceId); st.setObject(2, workflowId); st.setString(3, key)
                st.executeQuery().use { rs ->
                    if (rs.next()) Holder(rs.getObject("id", UUID::class.java), rs.getString("status"))
                    else null
                }
            }
        }
    }.getOrElse {
        /*
         * A read failure must not refuse the run. The index still enforces the
         * invariant on the way in, so the worst case is a caller getting the
         * database's own conflict error instead of our sentence — degraded, not
         * wrong.
         */
        log.warn("[dedup] holder lookup failed for key: {}", it.message)
        null
    }

    /**
     * Turn the index's refusal into the answer the policy asks for.
     *
     * Called when the INSERT hit `agent_runs_dedup_live_unique`, which is the
     * authoritative "somebody got there first".
     */
    fun onCollision(
        policy: Policy,
        workspaceId: UUID,
        workflowId: UUID,
        key: String,
    ): ApiError {
        val holder = holderOf(workspaceId, workflowId, key)
        if (holder == null) {
            /*
             * The holder finished between the failed insert and this read. The
             * caller should simply try again — telling them a run holds the key
             * when none does would send them looking for it.
             */
            return ApiError.Conflict(
                "Another run briefly held the deduplication key '$key' and has just " +
                    "finished. Retry, and this run will start.")
        }
        return ApiError.Conflict(
            "A run is already working on '$key' (${holder.runId}, ${holder.status}). " +
                when (policy) {
                    Policy.REJECT ->
                        "This workflow's deduplication policy is `reject`, so no second run " +
                            "was started. Set the policy to `join` to deliver this input to " +
                            "the run instead, or to `supersede` to replace it."
                    /* Reached only when the join or the supersede itself failed —
                       the successful paths never produce an error. */
                    Policy.JOIN ->
                        "The input could not be delivered to it as a signal. Retry, or check " +
                            "that the run is still accepting signals."
                    Policy.SUPERSEDE ->
                        "It could not be cancelled, so no replacement was started. Retry."
                },
        )
    }

    /**
     * Whether a failure came from the dedup index rather than from anything else.
     *
     * Matched on the CONSTRAINT NAME, not the message: Postgres localises the
     * message, and matching on English text is a bug that appears only on a
     * server with a different `lc_messages`.
     */
    fun isDedupCollision(e: Throwable): Boolean {
        var cause: Throwable? = e
        while (cause != null) {
            if (cause is java.sql.SQLException) {
                /* 23505 = unique_violation. The constraint name distinguishes this
                   index from the idempotency table's primary key, which is a
                   different conflict with a different answer. */
                if (cause.sqlState == "23505" &&
                    cause.message?.contains(INDEX_NAME) == true) return true
            }
            cause = cause.cause
        }
        return false
    }

    companion object {
        const val INDEX_NAME = "agent_runs_dedup_live_unique"

        /**
         * The statuses a run holds its key in.
         *
         * ── MUST MATCH THE INDEX, AND `SignalStore.LIVE_STATUSES` ───────────
         * The index decides who holds a key; this decides who we SAY holds it;
         * and `SignalStore` decides who can be signalled. If they disagree, a
         * `join` can be refused a signal by a run that is still holding the key —
         * an input silently dropped, which is the worst outcome available here.
         *
         * `RunDedupTest` asserts all three agree rather than trusting this note.
         *
         * `cancellation_requested` is NOT live for this purpose. A run on its way
         * out has no claim on the key — and `supersede`, which cancels the holder
         * and then starts a run, would otherwise lose the race to the very run it
         * had just cancelled.
         */
        val LIVE_STATUSES = listOf(
            "queued", "claimed", "running", "yielded", "recovering",
            "waiting_for_approval", "waiting_for_event", "waiting_for_timer",
            "waiting_for_child",
        )

        private val LIVE_STATUS_SQL = LIVE_STATUSES.joinToString(",") { "'$it'" }
    }
}
