package com.vectorbea.worker.durable.wait

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.logging.logger
import java.sql.ResultSet
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Creates, finds and resolves waits.
 *
 * ── EVERY WRITE THAT ENDS A WAIT IS A CAS ───────────────────────────────────
 * `resolve`, `timeOut` and `cancel` all carry `AND status = 'waiting'` and
 * report whether they changed a row. That single predicate is what makes the
 * duplicated-callback acceptance criterion true: the second delivery updates
 * zero rows, learns it lost, and is acknowledged without resuming the run a
 * second time. It is also what makes a poll racing a callback safe — whichever
 * arrives first wins, and the loser is a no-op rather than a second resume.
 *
 * ── AND `open` IS AN UPSERT ON THE DURABLE KEY ──────────────────────────────
 * `ON CONFLICT (run_id, wait_key) DO NOTHING` plus a read-back. A step that
 * re-executes on resume computes the same key and gets its existing wait rather
 * than a second one — the same rule the approval gate follows by keying on
 * `(runId, nodeId)`, expressed once here instead of per call site.
 */
open class WaitStore(private val dataSource: DataSource) {

    private val log = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        /**
         * The longest a wait may be asked to last.
         *
         * A wait with no deadline is a run parked forever, which is the failure
         * the brief names explicitly: "a callback that never comes must not park
         * a run forever". [open] refuses to create one without a timeout and
         * clamps to this, so an unbounded wait is not expressible rather than
         * merely discouraged.
         *
         * Seven days by default: long enough for a human task in another system
         * or an overnight batch, short enough that a forgotten run is noticed
         * within a support cycle.
         */
        val MAX_WAIT_MS: Long =
            System.getenv("RUN_WAIT_MAX_MS")?.toLongOrNull() ?: Duration.ofDays(7).toMillis()

        val DEFAULT_WAIT_MS: Long =
            System.getenv("RUN_WAIT_DEFAULT_MS")?.toLongOrNull() ?: Duration.ofHours(1).toMillis()

        private const val COLUMNS = """
            id, workspace_id, environment_id, run_id, workflow_id, node_id,
            attempt_group, kind, wait_key, status, label, signal_name, external_ref,
            callback_token, poll_url, poll_connection_id, poll_next_at,
            poll_interval_ms, poll_attempts, poll_max_attempts, timeout_at,
            created_at, resolution, resolution_json, resolved_at, resolved_by
        """
    }

    /** Everything needed to park. */
    data class OpenRequest(
        val workspaceId: UUID,
        val environmentId: UUID,
        val runId: UUID,
        val workflowId: UUID?,
        val nodeId: String,
        val attemptGroup: Int,
        val kind: WaitKind,
        val label: String?,
        val signalName: String? = null,
        val externalRef: String? = null,
        val pollUrl: String? = null,
        val pollConnectionId: UUID? = null,
        val pollIntervalMs: Int? = null,
        val pollMaxAttempts: Int? = null,
        val timeoutMs: Long? = null,
        val metadata: Map<String, Any?> = emptyMap(),
        /** Offer a callback URL. Only meaningful when a secret is configured. */
        val withCallback: Boolean = false,
    )

    /**
     * Park, or find the wait this step already opened.
     *
     * [OpenResult.created] is false when the row already existed, which is the
     * ordinary case on resume and is not an error. Callers use it to decide
     * whether to submit the job to the provider again — they must not.
     */
    data class OpenResult(val wait: RunWait, val created: Boolean)

    open fun open(req: OpenRequest): OpenResult {
        val waitKey = RunWait.keyFor(req.runId, req.nodeId, req.attemptGroup)
        val token = if (req.withCallback)
            RunWait.callbackTokenFor(waitKey, RunWait.callbackSecret()) else null

        /*
         * The deadline is clamped rather than validated, and defaulted rather
         * than required. A caller that forgets is the case this is protecting
         * against, so refusing would push the decision back to exactly the code
         * that got it wrong; a clamp cannot be forgotten.
         */
        val timeoutMs = (req.timeoutMs ?: DEFAULT_WAIT_MS).coerceIn(1_000L, MAX_WAIT_MS)
        val timeoutAt = Instant.now().plusMillis(timeoutMs)
        val pollNextAt = req.pollIntervalMs?.let { Instant.now().plusMillis(it.toLong()) }

        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """INSERT INTO run_waits
                     (workspace_id, environment_id, run_id, workflow_id, node_id,
                      attempt_group, kind, wait_key, status, label, signal_name,
                      external_ref, callback_token, poll_url, poll_connection_id,
                      poll_next_at, poll_interval_ms, poll_max_attempts, timeout_at,
                      metadata_json)
                   VALUES (?,?,?,?,?,?,?,?, 'waiting', ?,?,?,?,?,?,?,?,?,?, ?::jsonb)
                   ON CONFLICT (run_id, wait_key) DO NOTHING"""
            ).use { st ->
                st.setObject(1, req.workspaceId)
                st.setObject(2, req.environmentId)
                st.setObject(3, req.runId)
                st.setObject(4, req.workflowId)
                st.setString(5, req.nodeId)
                st.setInt(6, req.attemptGroup)
                st.setString(7, req.kind.wire)
                st.setString(8, waitKey)
                st.setString(9, req.label)
                st.setString(10, req.signalName)
                st.setString(11, req.externalRef)
                st.setString(12, token)
                st.setString(13, req.pollUrl)
                st.setObject(14, req.pollConnectionId)
                st.setTimestamp(15, pollNextAt?.let { Timestamp.from(it) })
                if (req.pollIntervalMs == null) st.setNull(16, java.sql.Types.INTEGER)
                else st.setInt(16, req.pollIntervalMs)
                if (req.pollMaxAttempts == null) st.setNull(17, java.sql.Types.INTEGER)
                else st.setInt(17, req.pollMaxAttempts)
                st.setTimestamp(18, Timestamp.from(timeoutAt))
                /* Sanitized by the caller. Invariant 4: the store writes what it
                   is given, so a provider response must never reach it. */
                st.setString(19, mapper.writeValueAsString(req.metadata))
                st.executeUpdate()
            }
        }

        val wait = findByKey(req.runId, waitKey)
            ?: error("wait ${waitKey.take(12)} vanished immediately after insert")
        val created = wait.createdAt.isAfter(Instant.now().minusSeconds(5))
        return OpenResult(wait, created)
    }

    // ── Reading ──────────────────────────────────────────────────────────────

    open fun findByKey(runId: UUID, waitKey: String): RunWait? = queryOne(
        "SELECT $COLUMNS FROM run_waits WHERE run_id = ? AND wait_key = ?",
    ) { st -> st.setObject(1, runId); st.setString(2, waitKey) }

    open fun findById(id: UUID, workspaceId: UUID): RunWait? = queryOne(
        "SELECT $COLUMNS FROM run_waits WHERE id = ? AND workspace_id = ?",
    ) { st -> st.setObject(1, id); st.setObject(2, workspaceId) }

    /**
     * The wait a callback token addresses.
     *
     * NOT workspace-scoped, and that is deliberate rather than an oversight: the
     * caller is an external provider that has no workspace context and never
     * will. The token IS the authorisation — an unguessable HMAC that names
     * exactly one wait — and the row it finds carries the workspace, which every
     * subsequent action is scoped by. A workspace parameter here would have to
     * come from the untrusted request, which is worse than not having one.
     */
    open fun findByCallbackToken(token: String): RunWait? = queryOne(
        "SELECT $COLUMNS FROM run_waits WHERE callback_token = ?",
    ) { st -> st.setString(1, token) }

    open fun activeWaits(runId: UUID): List<RunWait> = query(
        "SELECT $COLUMNS FROM run_waits WHERE run_id = ? AND status = 'waiting' ORDER BY created_at",
    ) { st -> st.setObject(1, runId) }

    /** Parked waits a named signal would satisfy, oldest first. */
    open fun waitsForSignal(runId: UUID, signalName: String): List<RunWait> = query(
        """SELECT $COLUMNS FROM run_waits
           WHERE run_id = ? AND status = 'waiting' AND signal_name = ?
           ORDER BY created_at""",
    ) { st -> st.setObject(1, runId); st.setString(2, signalName) }

    // ── Ending a wait ────────────────────────────────────────────────────────

    /**
     * Resolve, exactly once.
     *
     * Returns false when the wait was already resolved, timed out or cancelled —
     * which is the duplicated-callback case, and is a normal outcome rather than
     * an error. The caller acknowledges the delivery either way; what it must not
     * do is enqueue a second resume.
     */
    open fun resolve(
        waitId: UUID,
        resolution: RunWait.Resolution,
        resolutionJson: String?,
        resolvedBy: String,
    ): Boolean = dataSource.connection.use { conn ->
        conn.prepareStatement(
            """UPDATE run_waits
                  SET status = CASE WHEN ? = 'timeout' THEN 'timed_out' ELSE 'resolved' END,
                      resolution = ?, resolution_json = ?::jsonb,
                      resolved_at = now(), resolved_by = ?, updated_at = now()
                WHERE id = ? AND status = 'waiting'"""
        ).use { st ->
            st.setString(1, resolution.wire)
            st.setString(2, resolution.wire)
            st.setString(3, resolutionJson)
            st.setString(4, resolvedBy.take(200))
            st.setObject(5, waitId)
            st.executeUpdate() > 0
        }
    }

    /** Give up on a wait whose deadline passed. A CAS, like every other ending. */
    open fun timeOut(waitId: UUID, why: String): Boolean = resolve(
        waitId, RunWait.Resolution.TIMEOUT,
        mapper.writeValueAsString(mapOf("reason" to why.take(400))),
        "runtime:timeout",
    )

    /**
     * Cancel every wait a run holds.
     *
     * Called when the run reaches a terminal state by any route. Without it a
     * cancelled run leaves parked waits that the reconciler would keep sweeping
     * and the callback endpoint would keep accepting — resolving a wait on a run
     * that has already finished, which then resumes nothing and looks like a
     * silent failure.
     */
    open fun cancelAllForRun(runId: UUID, why: String): Int = dataSource.connection.use { conn ->
        conn.prepareStatement(
            """UPDATE run_waits
                  SET status = 'cancelled', resolution = 'cancelled',
                      resolution_json = ?::jsonb, resolved_at = now(),
                      resolved_by = 'runtime:run_terminal', updated_at = now()
                WHERE run_id = ? AND status = 'waiting'"""
        ).use { st ->
            st.setString(1, mapper.writeValueAsString(mapOf("reason" to why.take(400))))
            st.setObject(2, runId)
            st.executeUpdate()
        }
    }

    // ── Polling ──────────────────────────────────────────────────────────────

    /**
     * Claim the next poll slot for a wait, so two workers do not poll it at once.
     *
     * The `poll_next_at <= now()` predicate in the UPDATE is the claim: whichever
     * worker's statement lands first moves the deadline forward and gets true;
     * the other sees zero rows. Cheaper than a lock, and it degrades correctly —
     * a worker that crashes after claiming simply delays one poll by an interval.
     */
    open fun claimPoll(waitId: UUID): Boolean = dataSource.connection.use { conn ->
        conn.prepareStatement(
            """UPDATE run_waits
                  SET poll_attempts = poll_attempts + 1,
                      poll_next_at = now() + make_interval(secs => COALESCE(poll_interval_ms, 30000) / 1000.0),
                      updated_at = now()
                WHERE id = ? AND status = 'waiting'
                  AND poll_next_at IS NOT NULL AND poll_next_at <= now()"""
        ).use { st -> st.setObject(1, waitId); st.executeUpdate() > 0 }
    }

    /** Waits whose poll is due, or whose deadline has passed. Drives the sweep. */
    open fun dueWaits(limit: Int): List<RunWait> = query(
        """SELECT $COLUMNS FROM run_waits
            WHERE status = 'waiting'
              AND ( (poll_next_at IS NOT NULL AND poll_next_at <= now())
                 OR (timeout_at   IS NOT NULL AND timeout_at   <= now()) )
            ORDER BY COALESCE(poll_next_at, timeout_at)
            LIMIT ?""",
    ) { st -> st.setInt(1, limit) }

    /** Record the provider's handle once a submit returns it. */
    open fun attachHandle(waitId: UUID, handle: String, pollUrl: String?): Boolean =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """UPDATE run_waits
                      SET external_ref = ?, poll_url = COALESCE(?, poll_url), updated_at = now()
                    WHERE id = ? AND status = 'waiting'"""
            ).use { st ->
                st.setString(1, handle.take(500))
                st.setString(2, pollUrl)
                st.setObject(3, waitId)
                st.executeUpdate() > 0
            }
        }

    /**
     * Add the time a resolved wait spent parked to the run's reported total.
     *
     * Reported, never charged. `active_ms` is the budget and it does not tick
     * while parked (see `RunCeilings`: "ACTIVE TIME, NOT WALL TIME"), so this is
     * only what the timeline draws to explain the gap between two ticks.
     */
    open fun recordWaitedTime(runId: UUID, waitedMs: Long) = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "UPDATE agent_runs SET waiting_ms = waiting_ms + ? WHERE id = ?"
            ).use { st -> st.setLong(1, waitedMs.coerceAtLeast(0)); st.setObject(2, runId); st.executeUpdate() }
        }
    }.onFailure { log.debug("[wait] could not record waited time for {}: {}", runId, it.message) }

    // ── Plumbing ─────────────────────────────────────────────────────────────

    private fun query(sql: String, bind: (java.sql.PreparedStatement) -> Unit): List<RunWait> =
        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(sql).use { st ->
                    bind(st)
                    st.executeQuery().use { rs ->
                        buildList { while (rs.next()) add(map(rs)) }
                    }
                }
            }
        } catch (e: Exception) {
            log.error("[wait] query failed: {}", e.message)
            emptyList()
        }

    private fun queryOne(sql: String, bind: (java.sql.PreparedStatement) -> Unit): RunWait? =
        query(sql, bind).firstOrNull()

    private fun map(rs: ResultSet) = RunWait(
        id = rs.getObject("id", UUID::class.java),
        workspaceId = rs.getObject("workspace_id", UUID::class.java),
        environmentId = rs.getObject("environment_id", UUID::class.java),
        runId = rs.getObject("run_id", UUID::class.java),
        workflowId = rs.getObject("workflow_id", UUID::class.java),
        nodeId = rs.getString("node_id"),
        attemptGroup = rs.getInt("attempt_group"),
        kind = WaitKind.of(rs.getString("kind")) ?: WaitKind.SIGNAL,
        waitKey = rs.getString("wait_key"),
        status = RunWait.Status.of(rs.getString("status")),
        label = rs.getString("label"),
        signalName = rs.getString("signal_name"),
        externalRef = rs.getString("external_ref"),
        callbackToken = rs.getString("callback_token"),
        pollUrl = rs.getString("poll_url"),
        pollConnectionId = rs.getObject("poll_connection_id", UUID::class.java),
        pollNextAt = rs.getTimestamp("poll_next_at")?.toInstant(),
        pollIntervalMs = rs.getObject("poll_interval_ms")?.let { (it as Number).toInt() },
        pollAttempts = rs.getInt("poll_attempts"),
        pollMaxAttempts = rs.getObject("poll_max_attempts")?.let { (it as Number).toInt() },
        timeoutAt = rs.getTimestamp("timeout_at")?.toInstant(),
        createdAt = rs.getTimestamp("created_at").toInstant(),
        resolution = RunWait.Resolution.of(rs.getString("resolution")),
        resolutionJson = rs.getString("resolution_json"),
        resolvedAt = rs.getTimestamp("resolved_at")?.toInstant(),
        resolvedBy = rs.getString("resolved_by"),
    )
}
