package com.vectorbea.worker.replay

import com.vectorbea.worker.logging.logger
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import javax.sql.DataSource

/**
 * The recording a replay reads from, and the rule that makes replay meaningful.
 *
 * THE RULE
 * --------
 * During replay, **any attempt to make an external call is a hard error.**
 *
 * Not a fallthrough to a live call. Not a warning. An exception that fails the
 * replay loudly, by name, pointing at the node. This is the single most important
 * decision in this file, and it is worth being explicit about why:
 *
 * A replay that quietly falls through to the provider when it cannot find a
 * recording is *worse than no replay at all*. It looks like it worked. It costs
 * money the user was told it would not cost. It returns a different answer while
 * claiming to be a faithful reproduction. And it hides the actual defect — an
 * incomplete recording — behind a green tick.
 *
 * When this throws, the message means: this run is not replayable, here is the
 * node where the recording runs out. That is information the operator wants
 * immediately, not information they discover from a billing anomaly.
 *
 * PARTIAL REPLAY
 * --------------
 * [replayUntilNode] softens the rule at a boundary the user chose, not at a
 * boundary we discovered by accident. Up to and including that node, recorded
 * values are returned and external calls are forbidden. After it, [isLive] is
 * true and execution proceeds normally with real calls. The distinction is that
 * the user asked for the divergence and knows what it costs.
 */
class ReplayContext(
    private val dataSource: DataSource,
    /** The run being replayed FROM — the original, not the new replay run. */
    val sourceRunId: UUID,
    /**
     * Partial-replay boundary. Nodes up to and including this one come from the
     * recording; nodes after it run live. Null replays everything.
     */
    val replayUntilNode: String? = null,
) {
    private val log = logger()

    /**
     * Thrown when replay needs a recording that is not there.
     *
     * Deliberately not a subclass of the executors' own failure types: it must not
     * be caught by a node's retry policy and turned into a live call, which is
     * exactly the fallthrough this class exists to prevent.
     */
    class NotReplayableException(
        val nodeId: String,
        val reason: String,
    ) : RuntimeException(
        "Cannot replay node '$nodeId': $reason. This run is not fully replayable — " +
            "it was executed before complete call recording, or a recording failed to " +
            "persist. Use Retry to execute it for real, or Re-run for a fresh execution."
    )

    /** A recorded provider call, as replay hands it back. */
    data class RecordedCall(
        val responseBody: String,
        val modelId: String,
        val modelVersion: String?,
        val finishReason: String?,
        val tokensIn: Int?,
        val tokensOut: Int?,
        val outcome: String,
        val errorSanitized: String?,
    )

    /**
     * Per-node call cursor.
     *
     * An agent node makes several calls in one attempt, and they must be handed
     * back in the order they were made. A single counter would interleave two
     * nodes running in parallel branches and give each the other's answers.
     */
    private val cursors = ConcurrentHashMap<String, AtomicInteger>()

    /** Journal cursors, one per kind, for the same reason. */
    private val valueCursors = ConcurrentHashMap<String, AtomicInteger>()

    /** Nodes replay has already reached, so the boundary check is honest about order. */
    private val seenNodes = ConcurrentHashMap.newKeySet<String>()

    @Volatile private var pastBoundary = false

    /**
     * Whether this node executes live rather than from the recording.
     *
     * The boundary is *inclusive*: the named node itself is replayed, and
     * everything after it is live. That matches how a user describes it — "replay
     * up to the classifier, then let it run" means they want to see the
     * classifier's recorded answer and diverge after.
     */
    fun isLive(nodeId: String): Boolean {
        if (replayUntilNode == null) return false
        if (pastBoundary) return true
        seenNodes.add(nodeId)
        if (nodeId == replayUntilNode) {
            // This node still replays; everything after it is live.
            pastBoundary = true
            log.info("[replay] boundary reached at node {} — subsequent nodes execute live", nodeId)
            return false
        }
        return false
    }

    /**
     * The next recorded response for this node.
     *
     * @throws NotReplayableException when the recording has no answer. See the
     *         class doc for why this throws rather than falling through.
     */
    fun nextModelCall(nodeId: String, attemptGroup: Int): RecordedCall {
        val idx = cursors.computeIfAbsent(nodeId) { AtomicInteger(0) }.getAndIncrement()
        val row = runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT response_body::text, response_body_key, model_id, model_version,
                              finish_reason, tokens_in, tokens_out, outcome, error_sanitized
                         FROM model_calls
                        WHERE run_id = ? AND node_id = ? AND attempt_number = ? AND call_index = ?"""
                ).use { stmt ->
                    stmt.setObject(1, sourceRunId)
                    stmt.setString(2, nodeId)
                    stmt.setInt(3, attemptGroup)
                    stmt.setInt(4, idx)
                    stmt.executeQuery().use { rs ->
                        if (!rs.next()) null else {
                            val inline = rs.getString(1)
                            val key = rs.getString(2)
                            val body = inline ?: key?.let { PostgresBlobStore(dataSource).get(it) }
                            if (body == null) null else RecordedCall(
                                responseBody = body,
                                modelId = rs.getString("model_id"),
                                modelVersion = rs.getString("model_version"),
                                finishReason = rs.getString("finish_reason"),
                                tokensIn = rs.getObject("tokens_in") as? Int,
                                tokensOut = rs.getObject("tokens_out") as? Int,
                                outcome = rs.getString("outcome"),
                                errorSanitized = rs.getString("error_sanitized"),
                            )
                        }
                    }
                }
            }
        }.getOrElse { e ->
            throw NotReplayableException(nodeId, "reading the recording failed: ${e.message}")
        }

        return row ?: throw NotReplayableException(
            nodeId,
            "no recorded model call at attempt $attemptGroup, call index $idx of source run $sourceRunId")
    }

    /**
     * The next journalled value of this kind.
     *
     * Returns null rather than throwing, and the caller decides. A missing
     * timestamp is a lesser failure than a missing model response — the run may
     * not embed it in any output — so forcing a hard failure would make old runs
     * unreplayable for a value nothing observed. The byte-identical test is what
     * catches the case where it did matter.
     */
    fun nextValue(kind: String): String? {
        val idx = valueCursors.computeIfAbsent(kind) { AtomicInteger(0) }.getAndIncrement()
        return runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT value FROM recorded_values
                        WHERE run_id = ? AND kind = ? AND sequence = ?"""
                ).use { stmt ->
                    stmt.setObject(1, sourceRunId)
                    stmt.setString(2, kind)
                    stmt.setInt(3, idx)
                    stmt.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
                }
            }
        }.getOrNull()
    }

    /**
     * Refuse an external call.
     *
     * Called from the outbound path when a replay is active. Exists as its own
     * method so the refusal is greppable and there is exactly one place the rule
     * is enforced.
     */
    fun refuseExternalCall(nodeId: String, what: String): Nothing {
        log.error("[replay] node {} attempted an external call ({}) during replay — refusing",
            nodeId, what)
        throw NotReplayableException(nodeId,
            "it attempted a live $what call during replay, which means the recording is incomplete")
    }

    /** How many calls the recording holds — for the "is this replayable" precheck. */
    fun recordedCallCount(): Int = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement("SELECT count(*)::int FROM model_calls WHERE run_id = ?").use { stmt ->
                stmt.setObject(1, sourceRunId)
                stmt.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else 0 }
            }
        }
    }.getOrDefault(0)
}
