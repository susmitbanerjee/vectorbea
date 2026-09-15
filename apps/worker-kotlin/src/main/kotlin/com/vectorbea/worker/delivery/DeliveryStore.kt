package com.vectorbea.worker.delivery

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.logging.logger
import java.sql.ResultSet
import java.time.Duration
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * The delivery ledger.
 *
 * ── ONE TABLE FOR THE QUEUE, THE HISTORY AND THE DEAD LETTERS ───────────────
 * `run_deliveries` is all three. A delivery that runs out of attempts becomes
 * `status = 'dead'` and stays exactly where it was, with its target, its
 * payload shape, its attempt count and its error chain intact — so redelivering
 * it is an UPDATE, not a reconstruction.
 *
 * The alternative shape, a separate dead-letter table, needs the row copied on
 * the way in and joined back on the way out. That join is the bug: the symptom
 * is a redelivery that sends the wrong payload to the right endpoint, and it
 * only appears once a workspace has more than one target.
 */
open class DeliveryStore(private val dataSource: DataSource) {

    private val log = logger("DeliveryStore")
    private val mapper = ObjectMapper()

    companion object {
        /**
         * How long a claimed delivery may stay claimed before another dispatcher
         * takes it.
         *
         * Longer than the largest allowed request timeout (120s), so a dispatcher
         * that is simply slow is not overtaken mid-request and the receiver does
         * not get two copies inside one attempt. Short enough that a dispatcher
         * killed mid-attempt does not park a delivery for an hour.
         */
        val CLAIM_TTL: Duration = Duration.ofMinutes(5)

        /** A response body is evidence, not content. Enough to see the shape. */
        const val MAX_RESPONSE_SNIPPET = 2_000

        /** Errors accumulate per attempt; the chain must not grow without bound. */
        const val MAX_ERROR_CHAIN = 20
    }

    // ── Targets ──────────────────────────────────────────────────────────────

    /**
     * Every target that wants this run.
     *
     * Workflow-specific targets and environment-wide ones together: a workspace
     * with one archival destination should not have to attach it to forty
     * workflows, and a workflow with its own callback should still get the
     * archive.
     */
    open fun targetsFor(
        workspaceId: UUID,
        environmentId: UUID,
        workflowId: UUID,
    ): List<DeliveryTarget> = query(
        """SELECT $TARGET_COLUMNS FROM delivery_targets
            WHERE workspace_id = ? AND environment_id = ? AND enabled
              AND (workflow_id IS NULL OR workflow_id = ?)
            ORDER BY created_at""",
        { st ->
            st.setObject(1, workspaceId); st.setObject(2, environmentId)
            st.setObject(3, workflowId)
        }, ::mapTarget)

    open fun findTarget(id: UUID, workspaceId: UUID): DeliveryTarget? = queryOne(
        "SELECT $TARGET_COLUMNS FROM delivery_targets WHERE id = ? AND workspace_id = ?",
        { st -> st.setObject(1, id); st.setObject(2, workspaceId) }, ::mapTarget)

    // ── Enqueue ──────────────────────────────────────────────────────────────

    /**
     * Queue a delivery.
     *
     * ── IDEMPOTENT BY CONSTRUCTION ──────────────────────────────────────────
     * `ON CONFLICT (run_id, target_id, sequence) DO NOTHING`. The caller is
     * `onTerminalTransition`, which the status CAS already makes run once per
     * run — but "already" is doing a lot of work in a distributed system, and a
     * duplicate here is a duplicate callback to a customer's endpoint. Two
     * guarantees, cheaply.
     *
     * Returns null when the delivery already existed, which the caller reads as
     * "somebody else queued it" rather than as a failure.
     */
    open fun enqueue(
        workspaceId: UUID,
        environmentId: UUID,
        runId: UUID,
        target: DeliveryTarget,
        sequence: Int = 0,
        isPartial: Boolean = false,
    ): UUID? = queryOne(
        """INSERT INTO run_deliveries
             (workspace_id, environment_id, run_id, target_id, idempotency_key,
              sequence, is_partial, max_attempts)
           VALUES (?,?,?,?,?,?,?,?)
           ON CONFLICT (run_id, target_id, sequence) DO NOTHING
           RETURNING id""",
        { st ->
            st.setObject(1, workspaceId); st.setObject(2, environmentId)
            st.setObject(3, runId); st.setObject(4, target.id)
            st.setString(5, RunDelivery.keyFor(runId, target.id, sequence))
            st.setInt(6, sequence); st.setBoolean(7, isPartial)
            st.setInt(8, target.maxAttempts)
        }) { rs -> rs.getObject("id", UUID::class.java) }

    /**
     * Queue every delivery a finished run owes.
     *
     * ── CALLED FROM THE TERMINAL TRANSITION, AND CHEAP ON PURPOSE ───────────
     * `onTerminalTransition` is on the worker's completion path and has a
     * documented deadlock history around holding connections. So this reads the
     * run once, reads its targets once, and INSERTs — it does not deliver
     * anything. The dispatcher owns everything after.
     *
     * @return how many deliveries were queued. Zero is the common case and not a
     *   failure: most workspaces configure no targets at all.
     */
    open fun enqueueForRun(runId: UUID, status: String): Int {
        val run = queryOne(
            "SELECT workspace_id, environment_id, workflow_id FROM agent_runs WHERE id = ?",
            { st -> st.setObject(1, runId) },
        ) { rs ->
            Triple(
                rs.getObject("workspace_id", UUID::class.java),
                rs.getObject("environment_id", UUID::class.java),
                rs.getObject("workflow_id", UUID::class.java),
            )
        } ?: return 0

        val (workspaceId, environmentId, workflowId) = run
        val targets = targetsFor(workspaceId, environmentId, workflowId)
        if (targets.isEmpty()) return 0

        var queued = 0
        for (target in targets) {
            if (target.wants(status)) {
                if (enqueue(workspaceId, environmentId, runId, target) != null) queued++
            } else {
                /* Recorded rather than omitted. "Why did my Slack message not
                   arrive" needs an answer in the UI, and the honest one is often
                   "because you configured this target for successes only". */
                skip(workspaceId, environmentId, runId, target,
                    "The run ended as '$status', which this target does not deliver on " +
                        "(${target.onStatuses.joinToString(", ")}).")
            }
        }

        /* Set the roll-up now, so a run with queued deliveries shows `pending`
           immediately rather than `none` until the first attempt lands. */
        runCatching {
            dataSource.connection.use { c -> refreshRunStatus(c, runId) }
        }
        return queued
    }

    /**
     * Emit a partial, mid-run.
     *
     * ── WHY A SIX-HOUR PIPELINE NEEDS THIS ─────────────────────────
     * A run that emits nothing until it finishes is indistinguishable from one
     * that is stuck, and the customer cannot start work on the first half of a
     * result they will not see for hours. So a target may stream: each named
     * node's output is delivered as it commits, and the terminal delivery still
     * arrives at the end with the whole thing.
     *
     * The partial CARRIES its content, because `agent_runs.output_json` is still
     * null while the run is going — the terminal delivery reads the run, and a
     * partial cannot.
     *
     * The sequence is the node's commit order, so the idempotency key differs per
     * partial and a receiver can order them. Sequence 0 is reserved for the
     * terminal delivery, which is why partials start at 1.
     */
    open fun enqueuePartial(
        workspaceId: UUID,
        environmentId: UUID,
        runId: UUID,
        target: DeliveryTarget,
        sequence: Int,
        nodeId: String,
        outputJson: String,
    ): UUID? = queryOne(
        """INSERT INTO run_deliveries
             (workspace_id, environment_id, run_id, target_id, idempotency_key,
              sequence, is_partial, max_attempts, partial_output_json, partial_node_id)
           VALUES (?,?,?,?,?,?,TRUE,?,?::jsonb,?)
           ON CONFLICT (run_id, target_id, sequence) DO NOTHING
           RETURNING id""",
        { st ->
            st.setObject(1, workspaceId); st.setObject(2, environmentId)
            st.setObject(3, runId); st.setObject(4, target.id)
            st.setString(5, RunDelivery.keyFor(runId, target.id, sequence))
            st.setInt(6, sequence.coerceAtLeast(1))
            st.setInt(7, target.maxAttempts)
            st.setString(8, outputJson)
            st.setString(9, nodeId.take(200))
        }) { rs -> rs.getObject("id", UUID::class.java) }

    /**
     * The content a partial carries, or null for a terminal delivery.
     *
     * Read separately from the delivery row because it is large and only the
     * dispatcher needs it — putting it on every `listForRun` would send every
     * partial's payload to the run detail screen.
     */
    open fun partialContent(deliveryId: UUID): Pair<String, String?>? = queryOne(
        "SELECT partial_output_json::text AS content, partial_node_id " +
            "FROM run_deliveries WHERE id = ? AND partial_output_json IS NOT NULL",
        { st -> st.setObject(1, deliveryId) },
    ) { rs -> rs.getString("content") to rs.getString("partial_node_id") }

    /**
     * Targets that stream, for this run's workflow.
     *
     * Read per committed node, which sounds expensive and is not: it is one
     * indexed query returning almost always zero rows, because streaming is off
     * by default. The alternative — caching the answer on the run — would mean a
     * target enabled mid-run is ignored until the next one.
     */
    open fun streamingTargetsFor(
        workspaceId: UUID, environmentId: UUID, workflowId: UUID,
    ): List<DeliveryTarget> =
        targetsFor(workspaceId, environmentId, workflowId).filter { it.streamPartials }

    /**
     * Record that a target deliberately did not fire.
     *
     * A run that failed, with a target configured only for success, has no
     * delivery — and the absence must be a recorded decision rather than a gap.
     * Otherwise "why did my Slack message not arrive" has no answer in the UI,
     * and the honest one is "because you configured it for successes".
     */
    open fun skip(
        workspaceId: UUID, environmentId: UUID, runId: UUID,
        target: DeliveryTarget, reason: String,
    ) {
        execute(
            """INSERT INTO run_deliveries
                 (workspace_id, environment_id, run_id, target_id, idempotency_key,
                  status, last_error, max_attempts)
               VALUES (?,?,?,?,?, 'skipped', ?, ?)
               ON CONFLICT (run_id, target_id, sequence) DO NOTHING""",
        ) { st ->
            st.setObject(1, workspaceId); st.setObject(2, environmentId)
            st.setObject(3, runId); st.setObject(4, target.id)
            st.setString(5, RunDelivery.keyFor(runId, target.id, 0))
            st.setString(6, reason.take(500)); st.setInt(7, target.maxAttempts)
        }
    }

    // ── The dispatcher's loop ────────────────────────────────────────────────

    /**
     * Claim up to [limit] deliveries that are due.
     *
     * The claim is the UPDATE's own predicate, so two dispatchers cannot take
     * the same row: whichever statement lands first flips the status and the
     * other sees zero rows. Cheaper than a lock, and it degrades correctly —
     * a dispatcher that dies holding a claim loses it after [CLAIM_TTL].
     */
    open fun claimDue(limit: Int, claimedBy: String): List<RunDelivery> = query(
        """UPDATE run_deliveries SET
             status = 'delivering', claimed_at = now(), claimed_by = ?, updated_at = now()
           WHERE id IN (
               SELECT id FROM run_deliveries
                WHERE (status IN ('pending','retrying') AND next_attempt_at <= now())
                   OR (status = 'delivering'
                       AND claimed_at < now() - make_interval(secs => ?))
                ORDER BY next_attempt_at
                LIMIT ?
                FOR UPDATE SKIP LOCKED)
           RETURNING $DELIVERY_COLUMNS""",
        { st ->
            st.setString(1, claimedBy)
            st.setDouble(2, CLAIM_TTL.seconds.toDouble())
            st.setInt(3, limit)
        }, ::mapDelivery)

    /** An attempt is starting. */
    open fun beginAttempt(deliveryId: UUID): Int? = queryOne(
        """UPDATE run_deliveries SET
             attempts = attempts + 1,
             first_attempt_at = COALESCE(first_attempt_at, now()),
             updated_at = now()
           WHERE id = ? RETURNING attempts""",
        { st -> st.setObject(1, deliveryId) }) { rs -> rs.getInt("attempts") }

    /**
     * It landed.
     *
     * The run's roll-up is refreshed in the SAME statement batch, so a crash
     * cannot leave a delivered delivery under a run that still says `pending` —
     * which would show a customer an undelivered result that is sitting in their
     * inbox.
     */
    open fun markDelivered(
        deliveryId: UUID, runId: UUID,
        payloadMode: String, payloadBytes: Int, payloadUrl: String?,
    ) {
        dataSource.connection.use { c ->
            c.prepareStatement(
                """UPDATE run_deliveries SET
                     status = 'delivered', delivered_at = now(), claimed_at = NULL,
                     payload_mode_used = ?, payload_bytes = ?, payload_url = ?,
                     last_error = NULL, updated_at = now()
                   WHERE id = ?"""
            ).use { st ->
                st.setString(1, payloadMode); st.setInt(2, payloadBytes)
                st.setString(3, payloadUrl); st.setObject(4, deliveryId)
                st.executeUpdate()
            }
            refreshRunStatus(c, runId)
        }
    }

    /**
     * It did not land.
     *
     * Schedules the next attempt, or gives up. Giving up is a status, not a
     * deletion: the row stays in the dead-letter queue with everything needed to
     * try again by hand.
     */
    open fun markFailed(
        deliveryId: UUID,
        runId: UUID,
        attempt: Int,
        maxAttempts: Int,
        error: String,
        retryable: Boolean,
    ): RunDelivery.Status {
        /*
         * A non-retryable failure is dead immediately. Retrying a 400 eight times
         * is eight identical rejections spread over an hour, and it delays the
         * moment a person finds out their payload does not match the contract.
         */
        val exhausted = !retryable || attempt >= maxAttempts
        val next = if (exhausted) null else DeliveryBackoff.nextDelay(attempt)

        dataSource.connection.use { c ->
            c.prepareStatement(
                """UPDATE run_deliveries SET
                     status = ?, claimed_at = NULL, last_error = ?,
                     next_attempt_at = COALESCE(now() + make_interval(secs => ?), next_attempt_at),
                     /* Append, then keep the last N. `WITH ORDINALITY` is what
                        makes "the last N" expressible: `jsonb_array_elements`
                        alone has no order to slice on, and an unbounded chain
                        grows a row by an error per attempt forever. */
                     error_chain_json = (
                         SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]'::jsonb)
                           FROM jsonb_array_elements(
                                    error_chain_json || jsonb_build_array(
                                        jsonb_build_object(
                                            'attempt', ?::int, 'at', now(), 'error', ?::text))
                                ) WITH ORDINALITY AS chain(e, ord)
                          WHERE ord > GREATEST(jsonb_array_length(error_chain_json) + 1 - ?::int, 0)
                     ),
                     updated_at = now()
                   WHERE id = ?"""
            ).use { st ->
                st.setString(1, if (exhausted) "dead" else "retrying")
                st.setString(2, error.take(1_000))
                if (next != null) st.setDouble(3, next.seconds.toDouble())
                else st.setNull(3, java.sql.Types.DOUBLE)
                st.setInt(4, attempt)
                st.setString(5, error.take(500))
                st.setInt(6, MAX_ERROR_CHAIN)
                st.setObject(7, deliveryId)
                st.executeUpdate()
            }
            refreshRunStatus(c, runId)
        }

        if (exhausted) {
            log.warn("[delivery] {} is dead after {} attempt(s): {}", deliveryId, attempt, error)
        }
        return if (exhausted) RunDelivery.Status.DEAD else RunDelivery.Status.RETRYING
    }

    /** Every attempt, for the history a person reads when asking "why six tries". */
    open fun recordAttempt(
        deliveryId: UUID, workspaceId: UUID, attempt: Int,
        outcome: String, httpStatus: Int?, durationMs: Long,
        responseSnippet: String?, error: String?, triggeredBy: String,
    ) {
        runCatching {
            execute(
                """INSERT INTO delivery_attempts
                     (delivery_id, workspace_id, attempt, duration_ms, outcome,
                      http_status, response_snippet, error, triggered_by)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
            ) { st ->
                st.setObject(1, deliveryId); st.setObject(2, workspaceId)
                st.setInt(3, attempt); st.setInt(4, durationMs.toInt())
                st.setString(5, outcome)
                if (httpStatus != null) st.setInt(6, httpStatus) else st.setNull(6, java.sql.Types.INTEGER)
                st.setString(7, responseSnippet?.take(MAX_RESPONSE_SNIPPET))
                st.setString(8, error?.take(1_000))
                st.setString(9, triggeredBy)
            }
        }.onFailure {
            /* The attempt history is evidence, not control flow. Losing a row
               costs a line in a debugging view; failing the delivery for it would
               cost the customer their result. */
            log.warn("[delivery] could not record attempt for {}: {}", deliveryId, it.message)
        }
    }

    // ── Redelivery ───────────────────────────────────────────────────────────

    /**
     * Put a dead delivery back in the queue.
     *
     * ── THE ATTEMPT COUNT RESETS; THE IDEMPOTENCY KEY DOES NOT ──────────────
     * The count resets because an operator pressing the button is making a new
     * decision — usually after fixing the receiver — and inheriting eight spent
     * attempts would give them one try. The key does not, because the receiver's
     * dedupe has to see this as the same event it saw six hours ago. That is the
     * acceptance criterion, and it is why the key is derived rather than stored
     * per attempt.
     */
    open fun redeliver(deliveryId: UUID, workspaceId: UUID, byUser: String?): Boolean {
        val updated = dataSource.connection.use { c ->
            val n = c.prepareStatement(
                """UPDATE run_deliveries SET
                     status = 'pending', attempts = 0, next_attempt_at = now(),
                     claimed_at = NULL, claimed_by = NULL, last_error = NULL,
                     error_chain_json = error_chain_json ||
                         jsonb_build_array(jsonb_build_object(
                             'attempt', 0, 'at', now(),
                             'error', ?)),
                     updated_at = now()
                   WHERE id = ? AND workspace_id = ?
                     AND status IN ('dead','delivered','retrying')"""
            ).use { st ->
                st.setString(1, "Redelivery requested by ${byUser ?: "an operator"}")
                st.setObject(2, deliveryId); st.setObject(3, workspaceId)
                st.executeUpdate()
            }
            if (n > 0) {
                c.prepareStatement("SELECT run_id FROM run_deliveries WHERE id = ?").use { st ->
                    st.setObject(1, deliveryId)
                    st.executeQuery().use { rs ->
                        if (rs.next()) refreshRunStatus(c, rs.getObject("run_id", UUID::class.java))
                    }
                }
            }
            n
        }
        return updated > 0
    }

    /** Stop delivering for a run — its target was deleted, or the run was purged. */
    open fun cancelForRun(runId: UUID, why: String): Int = execute(
        """UPDATE run_deliveries SET status = 'cancelled', last_error = ?, updated_at = now()
            WHERE run_id = ? AND status IN ('pending','retrying','delivering')""",
    ) { st -> st.setString(1, why.take(500)); st.setObject(2, runId) }

    // ── Reads ────────────────────────────────────────────────────────────────

    open fun findById(id: UUID, workspaceId: UUID): RunDelivery? = queryOne(
        "SELECT $DELIVERY_COLUMNS FROM run_deliveries WHERE id = ? AND workspace_id = ?",
        { st -> st.setObject(1, id); st.setObject(2, workspaceId) }, ::mapDelivery)

    open fun listForRun(runId: UUID, workspaceId: UUID): List<RunDelivery> = query(
        "SELECT $DELIVERY_COLUMNS FROM run_deliveries WHERE run_id = ? AND workspace_id = ? " +
            "ORDER BY sequence, created_at",
        { st -> st.setObject(1, runId); st.setObject(2, workspaceId) }, ::mapDelivery)

    /** The dead-letter queue, as an operator opens it. */
    open fun listDead(workspaceId: UUID, limit: Int = 100): List<RunDelivery> = query(
        "SELECT $DELIVERY_COLUMNS FROM run_deliveries WHERE workspace_id = ? AND status = 'dead' " +
            "ORDER BY updated_at DESC LIMIT $limit",
        { st -> st.setObject(1, workspaceId) }, ::mapDelivery)

    open fun attemptsFor(deliveryId: UUID, workspaceId: UUID): List<Map<String, Any?>> = query(
        """SELECT attempt, started_at, duration_ms, outcome, http_status,
                  response_snippet, error, triggered_by
             FROM delivery_attempts WHERE delivery_id = ? AND workspace_id = ?
            ORDER BY attempt""",
        { st -> st.setObject(1, deliveryId); st.setObject(2, workspaceId) },
    ) { rs ->
        mapOf(
            "attempt" to rs.getInt("attempt"),
            "startedAt" to rs.getTimestamp("started_at")?.toInstant()?.toString(),
            "durationMs" to rs.getObject("duration_ms"),
            "outcome" to rs.getString("outcome"),
            "httpStatus" to rs.getObject("http_status"),
            "responseSnippet" to rs.getString("response_snippet"),
            "error" to rs.getString("error"),
            "triggeredBy" to rs.getString("triggered_by"),
        )
    }

    /** The current roll-up, without recomputing it. */
    open fun runDeliveryStatus(runId: UUID): String? = queryOne(
        "SELECT delivery_status FROM agent_runs WHERE id = ?",
        { st -> st.setObject(1, runId) }) { rs -> rs.getString("delivery_status") }

    // ── Payload links ────────────────────────────────────────────────────────

    /**
     * Store the payload behind a link, for a result too big to send.
     *
     * Returns the token, which the caller turns into a URL. Content lives here
     * rather than being referenced into the payload store because that store is
     * CONTENT-ADDRESSED: two runs producing identical output share a ref, so a
     * link to one would be a link to every run that produced the same answer.
     */
    open fun storeLink(
        token: String, deliveryId: UUID, workspaceId: UUID, runId: UUID,
        contentJson: String, ttl: Duration,
    ) {
        execute(
            """INSERT INTO delivery_payload_links
                 (token, delivery_id, workspace_id, run_id, content_json, content_bytes, expires_at)
               VALUES (?,?,?,?,?::jsonb,?, now() + make_interval(secs => ?))
               ON CONFLICT (token) DO UPDATE SET
                 content_json = EXCLUDED.content_json,
                 expires_at = EXCLUDED.expires_at""",
        ) { st ->
            st.setString(1, token); st.setObject(2, deliveryId)
            st.setObject(3, workspaceId); st.setObject(4, runId)
            st.setString(5, contentJson); st.setInt(6, contentJson.toByteArray().size)
            st.setDouble(7, ttl.seconds.toDouble())
        }
    }

    /** Read a payload link, and count the read. */
    open fun readLink(token: String): Pair<String, UUID>? = queryOne(
        """UPDATE delivery_payload_links
             SET fetch_count = fetch_count + 1, last_fetched_at = now()
           WHERE token = ? AND expires_at > now()
           RETURNING content_json::text, run_id""",
        { st -> st.setString(1, token) },
    ) { rs -> rs.getString(1) to rs.getObject("run_id", UUID::class.java) }

    /**
     * Delete expired links.
     *
     * A DELETE, not a read-time predicate — invariant 10. A filter leaves every
     * result Vectorbea has ever delivered sitting in a table, still billed and
     * one forgotten `WHERE` from being served.
     */
    open fun sweepExpiredLinks(limit: Int = 5_000): Int = execute(
        "DELETE FROM delivery_payload_links WHERE token IN (" +
            "SELECT token FROM delivery_payload_links WHERE expires_at <= now() LIMIT ?)",
    ) { st -> st.setInt(1, limit) }

    // ── Plumbing ─────────────────────────────────────────────────────────────

    /** The roll-up, on a connection the caller already holds. */
    private fun refreshRunStatus(conn: java.sql.Connection, runId: UUID) {
        runCatching {
            conn.prepareStatement("SELECT refresh_run_delivery_status(?)").use { st ->
                st.setObject(1, runId); st.execute()
            }
        }.onFailure { log.warn("[delivery] roll-up failed for run {}: {}", runId, it.message) }
    }

    private fun <T> query(
        sql: String,
        bind: (java.sql.PreparedStatement) -> Unit,
        map: (ResultSet) -> T,
    ): List<T> = dataSource.connection.use { c ->
        c.prepareStatement(sql).use { st ->
            bind(st)
            st.executeQuery().use { rs -> buildList { while (rs.next()) add(map(rs)) } }
        }
    }

    private fun <T> queryOne(
        sql: String,
        bind: (java.sql.PreparedStatement) -> Unit,
        map: (ResultSet) -> T,
    ): T? = dataSource.connection.use { c ->
        c.prepareStatement(sql).use { st ->
            bind(st)
            st.executeQuery().use { rs -> if (rs.next()) map(rs) else null }
        }
    }

    private fun execute(sql: String, bind: (java.sql.PreparedStatement) -> Unit): Int =
        dataSource.connection.use { c ->
            c.prepareStatement(sql).use { st -> bind(st); st.executeUpdate() }
        }

    @Suppress("UNCHECKED_CAST")
    private fun readStringMap(raw: String?): Map<String, String> = runCatching {
        if (raw.isNullOrBlank()) emptyMap()
        else (mapper.readValue(raw, Map::class.java) as Map<String, Any?>)
            .mapNotNull { (k, v) -> v?.let { k.toString() to it.toString() } }.toMap()
    }.getOrDefault(emptyMap())

    private fun textArray(rs: ResultSet, col: String): List<String> = runCatching {
        (rs.getArray(col)?.array as? Array<*>)?.mapNotNull { it?.toString() } ?: emptyList()
    }.getOrDefault(emptyList())

    private fun mapTarget(rs: ResultSet) = DeliveryTarget(
        id = rs.getObject("id", UUID::class.java),
        workspaceId = rs.getObject("workspace_id", UUID::class.java),
        environmentId = rs.getObject("environment_id", UUID::class.java),
        workflowId = rs.getObject("workflow_id", UUID::class.java),
        name = rs.getString("name"),
        kind = DeliveryTarget.Kind.of(rs.getString("kind")),
        callbackUrl = rs.getString("callback_url"),
        signingSecretRef = rs.getString("signing_secret_ref"),
        headers = readStringMap(rs.getString("headers_json")),
        toolId = rs.getObject("tool_id", UUID::class.java),
        connectionId = rs.getObject("connection_id", UUID::class.java),
        inputMapping = readStringMap(rs.getString("input_mapping")),
        onStatuses = textArray(rs, "on_statuses"),
        payloadMode = PayloadMode.of(rs.getString("payload_mode")),
        maxPayloadBytes = rs.getInt("max_payload_bytes"),
        streamPartials = rs.getBoolean("stream_partials"),
        streamNodes = textArray(rs, "stream_nodes"),
        maxAttempts = rs.getInt("max_attempts"),
        timeoutMs = rs.getInt("timeout_ms"),
        enabled = rs.getBoolean("enabled"),
    )

    private fun mapDelivery(rs: ResultSet) = RunDelivery(
        id = rs.getObject("id", UUID::class.java),
        workspaceId = rs.getObject("workspace_id", UUID::class.java),
        environmentId = rs.getObject("environment_id", UUID::class.java),
        runId = rs.getObject("run_id", UUID::class.java),
        targetId = rs.getObject("target_id", UUID::class.java),
        idempotencyKey = rs.getString("idempotency_key"),
        sequence = rs.getInt("sequence"),
        isPartial = rs.getBoolean("is_partial"),
        status = RunDelivery.Status.of(rs.getString("status")),
        attempts = rs.getInt("attempts"),
        maxAttempts = rs.getInt("max_attempts"),
        nextAttemptAt = rs.getTimestamp("next_attempt_at")?.toInstant() ?: Instant.EPOCH,
        payloadModeUsed = rs.getString("payload_mode_used"),
        payloadBytes = rs.getObject("payload_bytes") as? Int,
        payloadUrl = rs.getString("payload_url"),
        lastError = rs.getString("last_error"),
        deliveredAt = rs.getTimestamp("delivered_at")?.toInstant(),
        createdAt = rs.getTimestamp("created_at")?.toInstant() ?: Instant.EPOCH,
    )
}

private const val TARGET_COLUMNS = """
    id, workspace_id, environment_id, workflow_id, name, kind, callback_url,
    signing_secret_ref, headers_json, tool_id, connection_id, input_mapping,
    on_statuses, payload_mode, max_payload_bytes, stream_partials, stream_nodes,
    max_attempts, timeout_ms, enabled"""

private const val DELIVERY_COLUMNS = """
    id, workspace_id, environment_id, run_id, target_id, idempotency_key, sequence,
    is_partial, status, attempts, max_attempts, next_attempt_at, payload_mode_used,
    payload_bytes, payload_url, last_error, delivered_at, created_at"""
