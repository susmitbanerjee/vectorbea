package com.vectorbea.worker.runtime

import com.vectorbea.worker.logging.logger
import java.sql.Connection
import java.util.UUID
import javax.sql.DataSource

/**
 * Maintains the Checkpoint Ribbon summary on `agent_runs`.
 *
 * WHY A DENORMALISATION AT ALL
 * ----------------------------
 * The Ribbon renders per-node commit state inline on every Runs row. 163 rows
 * naively means 163 queries against `run_checkpoints` + `step_executions`. One
 * JSONB column read renders it at any scale, and `node_committed / node_total`
 * answers *"8 of 12 committed — retry costs 4 steps"* with no join at all.
 *
 * THE RULE THAT KEEPS IT HONEST
 * -----------------------------
 * **The ribbon is written in the same transaction as the node transition it
 * describes.** Never a follow-up write, never a periodic rebuild.
 *
 * That is not a stylistic preference. A denormalised summary updated separately
 * from the thing it summarises drifts the first time a worker dies between the
 * two writes — and it drifts *silently*, because nothing reads the authoritative
 * tables to notice. The Runs page then shows "8 of 12 committed" for a run that
 * committed 9, and the retry dialog quotes the wrong price. Sharing the
 * transaction makes drift impossible rather than unlikely: either both writes
 * land or neither does.
 *
 * Every method here therefore takes a [Connection] rather than opening its own.
 * The signature is the enforcement.
 *
 * THE 200-ENTRY CAP
 * -----------------
 * Beyond ~200 nodes the Ribbon collapses to segments in the UI anyway, so storing
 * more costs bytes on every Runs-page read and buys nothing. The cap keeps the
 * FIRST 200 rather than the last: the beginning of a run is where a reader looks
 * to understand what it did, and a graph that large is generated rather than
 * hand-drawn, so its tail is repetitive.
 */
object RibbonWriter {

    private val log = logger("RibbonWriter")

    /** Cap beyond which the UI collapses to segments regardless. */
    const val MAX_ENTRIES = 200

    /**
     * The states a node can be in on the Ribbon.
     *
     * `recovered` is distinct from `committed` on purpose: a node that failed and
     * was recovered did commit, but the reader needs to see that it took two
     * attempts. Collapsing it into `committed` hides exactly the thing someone
     * opening the Ribbon is looking for.
     */
    enum class State(val wire: String) {
        COMMITTED("committed"),
        EXECUTING("executing"),
        GATED("gated"),
        FAILED("failed"),
        PENDING("pending"),
        SKIPPED("skipped"),
        RECOVERED("recovered"),
    }

    /**
     * Record a node transition on the ribbon.
     *
     * Upsert semantics keyed on the node id: a node moves `executing → committed`
     * and must occupy ONE ribbon entry throughout, not accumulate one per
     * transition. Done in SQL rather than by read-modify-write in Kotlin so two
     * parallel branches transitioning at once cannot lose each other's update.
     *
     * @param conn the transaction the node transition itself is being written in.
     */
    fun recordTransition(
        conn: Connection,
        runId: UUID,
        nodeId: String,
        state: State,
        durationMs: Long? = null,
    ) {
        try {
            // The entry is built here rather than in SQL: a `CASE WHEN ? IS NULL`
            // to decide whether to include `ms` needs the same value bound three
            // times, and a parameter list that repeats itself is a parameter list
            // that gets mis-ordered.
            val entry = if (durationMs != null)
                """{"n":${jsonStr(nodeId)},"s":"${state.wire}","ms":$durationMs}"""
            else
                """{"n":${jsonStr(nodeId)},"s":"${state.wire}"}"""

            conn.prepareStatement(UPSERT_SQL).use { stmt ->
                stmt.setObject(1, runId)     // existing
                stmt.setString(2, entry)     // incoming entry
                stmt.setString(3, nodeId)    // incoming node id
                stmt.setInt(4, MAX_ENTRIES)  // cap
                stmt.setObject(5, runId)     // target row
                stmt.executeUpdate()
            }
        } catch (e: Exception) {
            // Rethrown, deliberately, unlike most of this codebase's best-effort
            // writes. This shares a transaction with the node transition: swallowing
            // the failure would commit the transition without the ribbon and
            // reintroduce exactly the drift the shared transaction exists to
            // prevent. Better to fail the transition and retry both.
            log.error("[ribbon] failed to record {} for run {} node {}", state.wire, runId, nodeId, e)
            throw e
        }
    }

    /**
     * Set the denominator once the graph is known.
     *
     * Separate from [recordTransition] because it happens once per run, at load,
     * and because `node_total` must be the graph's node count rather than "how
     * many nodes we have seen so far" — a run that fails at node 3 of 12 must
     * still read "3 of 12", not "3 of 3".
     */
    fun setNodeTotal(conn: Connection, runId: UUID, total: Int) {
        try {
            conn.prepareStatement(
                "UPDATE agent_runs SET node_total = ? WHERE id = ? AND node_total IS DISTINCT FROM ?"
            ).use { stmt ->
                stmt.setInt(1, total)
                stmt.setObject(2, runId)
                stmt.setInt(3, total)
                stmt.executeUpdate()
            }
        } catch (e: Exception) {
            log.warn("[ribbon] could not set node_total for run {}: {}", runId, e.message)
        }
    }

    /**
     * Flip every entry still marked `executing` on a run that has just stopped.
     *
     * A node records `executing` when it starts and its terminal state when it
     * ends, so the only way an `executing` entry survives is that the run died
     * between the two — a worker crash, a lease expiry, an error thrown outside
     * the node's own failure handling. Left alone, that cell breathes forever on
     * a run that finished hours ago, which is worse than showing nothing: it says
     * work is in flight when no worker is holding the run.
     *
     * Best-effort and never throws: this runs while a failure is already being
     * recorded, and a run must not fail to be marked failed because its summary
     * could not be tidied.
     */
    fun sealExecuting(dataSource: DataSource, runId: UUID, state: State = State.FAILED) {
        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """
                    UPDATE agent_runs r
                       SET ribbon_json = (
                               SELECT COALESCE(jsonb_agg(
                                          CASE WHEN e.value->>'s' = 'executing'
                                               THEN jsonb_set(e.value, '{s}', to_jsonb(?::text))
                                               ELSE e.value END
                                          ORDER BY e.ordinality), '[]'::jsonb)
                                 FROM jsonb_array_elements(r.ribbon_json)
                                      WITH ORDINALITY AS e(value, ordinality)
                           ),
                           updated_at = now()
                     WHERE r.id = ?
                       AND EXISTS (
                           SELECT 1 FROM jsonb_array_elements(r.ribbon_json) x
                            WHERE x->>'s' = 'executing'
                       )
                    """.trimIndent()
                ).use { stmt ->
                    stmt.setString(1, state.wire)
                    stmt.setObject(2, runId)
                    stmt.executeUpdate()
                }
            }
        } catch (e: Exception) {
            log.warn("[ribbon] could not seal executing entries for run {}: {}", runId, e.message)
        }
    }

    /** Convenience for callers that are not already inside a transaction. */
    fun recordTransition(
        dataSource: DataSource,
        runId: UUID,
        nodeId: String,
        state: State,
        durationMs: Long? = null,
    ) = dataSource.connection.use { recordTransition(it, runId, nodeId, state, durationMs) }

    /**
     * Upsert one node's ribbon entry and recompute the committed count.
     *
     * All in one statement so it is atomic against concurrent branch transitions.
     * The steps:
     *
     *   `existing`  — the current array, exploded to rows with their positions so
     *                 ordering survives the round trip. Array order IS execution
     *                 order and the Ribbon renders left to right.
     *   `merged`    — the incoming entry replaces the matching node id, or is
     *                 appended if new. `WHERE NOT EXISTS` rather than a join so an
     *                 empty array still produces the first entry.
     *   the UPDATE  — writes the capped array and derives `node_committed` from it
     *                 rather than incrementing a counter. A derived count cannot
     *                 disagree with the array it is derived from; an incremented
     *                 one can, and eventually does.
     */
    private val UPSERT_SQL = """
        WITH existing AS (
            SELECT e.value AS entry, e.ordinality AS pos
              FROM agent_runs r,
                   LATERAL jsonb_array_elements(r.ribbon_json) WITH ORDINALITY AS e(value, ordinality)
             WHERE r.id = ?
        ),
        incoming AS (
            SELECT ?::jsonb AS entry, ?::text AS node_id
        ),
        merged AS (
            -- Replace in place when the node is already on the ribbon: a node
            -- moving executing -> committed must occupy ONE entry, not accumulate
            -- one per transition.
            SELECT CASE WHEN e.entry->>'n' = i.node_id THEN i.entry ELSE e.entry END AS entry,
                   e.pos
              FROM existing e CROSS JOIN incoming i
            UNION ALL
            -- Append when it is new. A large `pos` puts it last without needing to
            -- know the current length; NOT EXISTS rather than a join so an empty
            -- ribbon still yields its first entry.
            SELECT i.entry, 1000000 + COALESCE((SELECT MAX(pos) FROM existing), 0)
              FROM incoming i
             WHERE NOT EXISTS (SELECT 1 FROM existing e WHERE e.entry->>'n' = i.node_id)
        ),
        capped AS (
            SELECT jsonb_agg(entry ORDER BY pos) AS ribbon
              FROM (SELECT entry, pos FROM merged ORDER BY pos LIMIT ?) t
        )
        UPDATE agent_runs r
           SET ribbon_json = COALESCE((SELECT ribbon FROM capped), '[]'::jsonb),
               -- Derived from the array, never incremented. A derived count cannot
               -- disagree with the array it comes from; an incremented one can, and
               -- eventually does.
               node_committed = (
                   SELECT count(*)::int
                     FROM jsonb_array_elements(COALESCE((SELECT ribbon FROM capped), '[]'::jsonb)) x
                    WHERE x->>'s' IN ('committed', 'recovered')
               ),
               updated_at = now()
         WHERE r.id = ?
    """.trimIndent()

    private fun jsonStr(s: String) =
        "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
}
