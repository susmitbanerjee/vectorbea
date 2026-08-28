package com.vectorbea.worker.events

import com.vectorbea.worker.logging.logger
import io.lettuce.core.pubsub.StatefulRedisPubSubConnection
import java.sql.PreparedStatement
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Writes run events to Postgres and publishes them on a Redis Pub/Sub channel.
 *
 * Thread-safety: all public methods are synchronised on the DataSource and
 * Lettuce connection (both thread-safe by design).
 *
 * Sequence: assigned under a `FOR UPDATE` lock on the run's `agent_runs` row,
 * held for the same transaction as the INSERT. The in-memory lock below only
 * covers writers inside THIS process; the row lock is what makes the assignment
 * safe against the API, which appends to the same run from another process.
 *
 * SECURITY: [RunEvent.metadataJsonSanitized] and [RunEvent.errorJsonSanitized]
 * must already be sanitized by the caller — this class stores them as-is.
 * Raw error messages, stack traces, and input payloads must NEVER be stored.
 *
 * Redis channel: `run-events:{runId}`
 */
open class RunEventStore(
    private val dataSource: DataSource,
    private val pubSub: StatefulRedisPubSubConnection<String, String>,
) {
    private val log = logger()

    /**
     * Per-run in-memory locks for serializing event sequence assignment.
     * Acquired before requesting a DB connection to avoid pool exhaustion.
     */
    private val runLocks = java.util.concurrent.ConcurrentHashMap<UUID, java.util.concurrent.locks.ReentrantLock>()

    /**
     * Immutable event to persist and publish.
     *
     * Only [title], [summary], [metadataJsonSanitized], and [errorJsonSanitized]
     * are safe to include in the message — all must be pre-sanitized.
     */
    data class RunEvent(
        val runId: UUID,
        val workspaceId: UUID,
        val environmentId: UUID,
        val type: EventType,
        val status: String,
        val source: String = "worker",
        val title: String? = null,
        val summary: String? = null,
        val durationMs: Long? = null,
        val stepId: String? = null,
        val agentId: UUID? = null,
        val modelName: String? = null,
        val tokenCount: Int? = null,
        val estimatedCost: Double? = null,
        val correlationId: String? = null,
        val traceId: String? = null,
        val retryAttempt: Int? = null,
        /** Must be sanitized — no secrets, no raw error details */
        val metadataJsonSanitized: String? = null,
        /** Must be sanitized — no stack traces, no connection strings */
        val errorJsonSanitized: String? = null,
    )

    enum class EventType(val value: String) {
        RUN_STARTED("RUN_STARTED"),
        RUN_SUCCEEDED("RUN_SUCCEEDED"),
        RUN_FAILED("RUN_FAILED"),
        RUN_CANCELLED("RUN_CANCELLED"),
        // Step-level events
        STEP_SCHEDULED("STEP_SCHEDULED"),
        STEP_STARTED("STEP_STARTED"),
        STEP_INPUT_RESOLVED("STEP_INPUT_RESOLVED"),
        STEP_INPUT_VALIDATED("STEP_INPUT_VALIDATED"),
        STEP_COMPLETED("STEP_COMPLETED"),
        STEP_FAILED("STEP_FAILED"),
        STEP_SKIPPED("STEP_SKIPPED"),
        // Data mapping events
        INPUT_MAPPING_STARTED("INPUT_MAPPING_STARTED"),
        INPUT_MAPPING_COMPLETED("INPUT_MAPPING_COMPLETED"),
        INPUT_MAPPING_FAILED("INPUT_MAPPING_FAILED"),
        OUTPUT_EXTRACTION_STARTED("OUTPUT_EXTRACTION_STARTED"),
        OUTPUT_EXTRACTION_COMPLETED("OUTPUT_EXTRACTION_COMPLETED"),
        OUTPUT_EXTRACTION_FAILED("OUTPUT_EXTRACTION_FAILED"),
        STEP_OUTPUT_VALIDATED("STEP_OUTPUT_VALIDATED"),
        STEP_SCHEMA_VALIDATION_FAILED("STEP_SCHEMA_VALIDATION_FAILED"),
        // Transform-specific
        TRANSFORM_STARTED("TRANSFORM_STARTED"),
        TRANSFORM_COMPLETED("TRANSFORM_COMPLETED"),
        // Control-flow events
        BRANCH_EVALUATED("BRANCH_EVALUATED"),
        PARALLEL_STARTED("PARALLEL_STARTED"),
        PARALLEL_BRANCH_STARTED("PARALLEL_BRANCH_STARTED"),
        PARALLEL_BRANCH_COMPLETED("PARALLEL_BRANCH_COMPLETED"),
        JOIN_WAITING("JOIN_WAITING"),
        JOIN_COMPLETED("JOIN_COMPLETED"),
        // Checkpoint / approval
        CHECKPOINT_CREATED("CHECKPOINT_CREATED"),
        APPROVAL_REQUESTED("APPROVAL_REQUESTED"),
        NODE_TYPE_UNSUPPORTED("NODE_TYPE_UNSUPPORTED"),
        // Connector events
        CONNECTION_RESOLVED("CONNECTION_RESOLVED"),
        CONNECTION_VALIDATION_FAILED("CONNECTION_VALIDATION_FAILED"),
        SECRET_MISSING("SECRET_MISSING"),
        // LLM events
        LLM_CALL_STARTED("LLM_CALL_STARTED"),
        LLM_CALL_COMPLETED("LLM_CALL_COMPLETED"),
        // HTTP events
        HTTP_REQUEST_PREPARED("HTTP_REQUEST_PREPARED"),
        HTTP_REQUEST_STARTED("HTTP_REQUEST_STARTED"),
        HTTP_REQUEST_COMPLETED("HTTP_REQUEST_COMPLETED"),
        // DB read events
        DB_QUERY_PREPARED("DB_QUERY_PREPARED"),
        DB_QUERY_STARTED("DB_QUERY_STARTED"),
        DB_QUERY_COMPLETED("DB_QUERY_COMPLETED"),
        // DB write events
        DB_WRITE_PREPARED("DB_WRITE_PREPARED"),
        DB_WRITE_COMPLETED("DB_WRITE_COMPLETED"),
        // Tool call events
        TOOL_CALL_STARTED("TOOL_CALL_STARTED"),
        TOOL_CALL_COMPLETED("TOOL_CALL_COMPLETED"),
        TOOL_CALL_FAILED("TOOL_CALL_FAILED"),
        // Agent events
        AGENT_STARTED("AGENT_STARTED"),
        AGENT_COMPLETED("AGENT_COMPLETED"),
        AGENT_FAILED("AGENT_FAILED"),
        // Durable control operations
        RETRY_REQUESTED("RETRY_REQUESTED"),
        RETRY_STARTED("RETRY_STARTED"),
        REPLAY_CREATED("REPLAY_CREATED"),
        REPLAY_STARTED("REPLAY_STARTED"),
        APPROVAL_APPROVED("APPROVAL_APPROVED"),
        APPROVAL_REJECTED("APPROVAL_REJECTED"),
        RUN_CANCELLATION_REQUESTED("RUN_CANCELLATION_REQUESTED"),
        RUN_CANCELLED_CLEANLY("RUN_CANCELLED_CLEANLY"),
        // Legacy node-level events (kept for backward compat)
        NODE_STARTED("NODE_STARTED"),
        NODE_SUCCEEDED("NODE_SUCCEEDED"),
        NODE_FAILED("NODE_FAILED"),
        NODE_SKIPPED("NODE_SKIPPED"),
        WORKER_CLAIMED("WORKER_CLAIMED"),
        // Durable execution — history limits
        HISTORY_LIMIT_WARNING("HISTORY_LIMIT_WARNING"),
        CONTINUE_AS_NEW_RECOMMENDED("CONTINUE_AS_NEW_RECOMMENDED"),
        CONTINUE_AS_NEW_REQUESTED("CONTINUE_AS_NEW_REQUESTED"),
        CONTINUE_AS_NEW_STARTED("CONTINUE_AS_NEW_STARTED"),
        CONTINUE_AS_NEW_COMPLETED("CONTINUE_AS_NEW_COMPLETED"),
        RUN_CONTINUED_AS_NEW("RUN_CONTINUED_AS_NEW"),
        // Durable execution — timers
        TIMER_SCHEDULED("TIMER_SCHEDULED"),
        TIMER_FIRED("TIMER_FIRED"),
        TIMER_CANCELLED("TIMER_CANCELLED"),
        // Durable execution — leases + crash recovery
        RUN_LEASE_ACQUIRED("RUN_LEASE_ACQUIRED"),
        RUN_LEASE_RENEWED("RUN_LEASE_RENEWED"),
        RUN_LEASE_EXPIRED("RUN_LEASE_EXPIRED"),
        RUN_RECOVERY_STARTED("RUN_RECOVERY_STARTED"),
        RUN_RECOVERY_COMPLETED("RUN_RECOVERY_COMPLETED"),
        // Durable execution — failure incidents
        FAILURE_INCIDENT_CREATED("FAILURE_INCIDENT_CREATED"),
        // Durable execution — cooperative yielding (durable, low-frequency timeline events)
        RUN_YIELDED("RUN_YIELDED"),
        RUN_REENQUEUED("RUN_REENQUEUED"),
        /**
         * A run picked up again from its checkpoint — after an approval decision, a
         * timer, or a yield.
         *
         * Not RETRY_STARTED, which is what this used to be. Nothing had failed and
         * nothing was being re-attempted, but the UI grades severity by name
         * (`LogsTab`: any type containing "RETRY" renders `warn`), so approving a run
         * and watching it continue normally produced a warning on the timeline and the
         * question "why is it retrying?". The web layer has understood RUN_RESUMED all
         * along — badge, icon, label, compact styling — and only the worker never sent
         * one.
         */
        RUN_RESUMED("RUN_RESUMED"),
        // Scheduling-fairness signals. NOTE: these are operational and HIGH-FREQUENCY
        // under load — they are exposed ONLY via metrics/logs (WorkerMetrics.tenantThrottled
        // / poolSaturated) and MUST NOT be appendEvent'd to run_events per poll.
        // Kept here only so a deliberate, rate-limited timeline write could opt in later.
        TENANT_THROTTLED("TENANT_THROTTLED"),
        POOL_SATURATED("POOL_SATURATED"),
        // Agent Brain — iterative loop events
        AGENT_ITERATION_STARTED("AGENT_ITERATION_STARTED"),
        AGENT_ACTION_SELECTED("AGENT_ACTION_SELECTED"),
        AGENT_TOOL_SELECTED("AGENT_TOOL_SELECTED"),
        AGENT_TOOL_NOT_ALLOWED("AGENT_TOOL_NOT_ALLOWED"),
        AGENT_OBSERVATION_RECORDED("AGENT_OBSERVATION_RECORDED"),
        AGENT_MEMORY_UPDATED("AGENT_MEMORY_UPDATED"),
        AGENT_REFLECTION_CREATED("AGENT_REFLECTION_CREATED"),
        AGENT_FINAL_OUTPUT_CREATED("AGENT_FINAL_OUTPUT_CREATED"),
        AGENT_OUTPUT_VALIDATED("AGENT_OUTPUT_VALIDATED"),
        AGENT_OUTPUT_SCHEMA_INVALID("AGENT_OUTPUT_SCHEMA_INVALID"),
        AGENT_BUDGET_EXCEEDED("AGENT_BUDGET_EXCEEDED"),
        AGENT_MAX_ITERATIONS_REACHED("AGENT_MAX_ITERATIONS_REACHED"),
        AGENT_INVALID_ACTION("AGENT_INVALID_ACTION"),
        AGENT_APPROVAL_REQUESTED("AGENT_APPROVAL_REQUESTED"),
        AGENT_PLAN_CREATED("AGENT_PLAN_CREATED"),
    }

    /**
     * Insert the event into `run_events` and publish to Redis.
     * Returns the assigned sequence number.
     *
     * This method is intentionally not transactional with the caller's DB
     * operations — events are appended on a best-effort basis. If the DB
     * write succeeds but Redis publish fails, the event is still persisted.
     */
    open fun appendEvent(event: RunEvent): Int {
        val seq = insertEvent(event)
        publishEvent(event, seq)
        return seq
    }

    /**
     * Drop the per-run sequence lock once a run reaches a terminal state.
     * Without this the lock map grows for the lifetime of the JVM.
     */
    open fun forgetRun(runId: UUID) {
        runLocks.remove(runId)
    }

    // ── DB insert ─────────────────────────────────────────────────────────────

    /**
     * Insert the event, serialized per run via an in-memory ReentrantLock.
     *
     * WHY in-memory locks instead of advisory locks or retries:
     *
     * - Retries: `SELECT MAX(sequence)+1` races under concurrency; 5 retries at
     *   10-50ms are insufficient when 4 branches emit events simultaneously.
     *
     * - Advisory locks (pg_advisory_xact_lock): holds a DB connection while
     *   waiting for the lock. With a 5-connection pool and 4 parallel branches
     *   each trying to acquire the same advisory lock, the pool exhausts before
     *   all branches get connections — causing connection-timeout failures that
     *   silently kill 3 of 4 parallel agent branches.
     *
     * - In-memory ReentrantLock per run_id: the lock is acquired BEFORE a
     *   DB connection is requested. Only one thread needs a connection at a time
     *   for events from the same run, so the 5-connection pool is never
     *   exhausted by event writes. Zero dropped events, no deadlock.
     */
    private fun insertEvent(event: RunEvent): Int {
        // Get (or create) the per-run lock — ~48 bytes per entry; evicted on run
        // completion via [forgetRun].
        val lock = runLocks.computeIfAbsent(event.runId) { java.util.concurrent.locks.ReentrantLock() }
        lock.lock()
        try {
            // The in-memory lock serializes writers within THIS worker only.
            // If another worker writes events for the same run concurrently
            // (e.g. a brief lease handover), the UNIQUE(run_id, sequence)
            // constraint trips — retry with a freshly read sequence instead
            // of dropping the event.
            var lastError: Exception? = null
            repeat(3) { attempt ->
                try {
                    return doInsert(event)
                } catch (e: java.sql.SQLException) {
                    if (e.sqlState == "23505") { // unique_violation — sequence race with another worker
                        lastError = e
                        log.warn("[events] sequence conflict, retrying ({}/3) [runId={}, type={}]",
                            attempt + 1, event.runId, event.type.value)
                    } else throw e
                }
            }
            throw lastError ?: IllegalStateException("event insert failed after retries")
        } catch (e: Exception) {
            log.error("[events] failed to insert event [runId={}, type={}]: {}",
                event.runId, event.type.value, e.message)
            throw e
        } finally {
            lock.unlock()
        }
    }

    private fun doInsert(event: RunEvent): Int {
        return dataSource.connection.use { conn ->
            conn.autoCommit = false
            try {
                /*
                 * ── SERIALIZE THE SEQUENCE ACROSS PROCESSES, NOT JUST THREADS ──
                 *
                 * `runLocks` orders event writers within this worker, and it is the
                 * right tool for that (see [insertEvent]). It says nothing about the
                 * API, which appends to `run_events` for the same run from a different
                 * JVM — a cancel, an approval decision, a manual replay. Both sides ran
                 * `SELECT MAX(sequence)+1` under READ COMMITTED, so both could read the
                 * same MAX and both insert the same number: one won and the other took
                 * a 23505 that the retry below papered over, at the cost of a warning
                 * per cancelled run and an extra round trip.
                 *
                 * Where the constraint is absent — after V028 the partitioned table
                 * carries only a plain index on (run_id, sequence) — nothing trips at
                 * all and the duplicate is simply written, which breaks the
                 * `?afterSequence=` cursor the run timeline pages on: two events share a
                 * number and one of them is never delivered to the open stream.
                 *
                 * The row lock removes the race rather than detecting it. It costs
                 * nothing extra to hold: the UPDATE below already locks this same row
                 * for the rest of the transaction, so this only takes that lock sooner.
                 * Both writers take it in the same order and touch no other row, so
                 * there is no cycle to deadlock on.
                 */
                lockRun(conn, event.runId)
                val seq = nextSequence(conn, event.runId)
                conn.prepareStatement(INSERT_SQL).use { stmt ->
                    bindInsert(stmt, event, seq)
                    stmt.executeUpdate()
                }
                // Update history tracking counters on agent_runs
                val estimatedSize = estimateEventSize(event)
                conn.prepareStatement("""
                    UPDATE agent_runs
                    SET history_event_count = history_event_count + 1,
                        history_size_bytes  = history_size_bytes + ?,
                        updated_at          = now()
                    WHERE id = ?
                """.trimIndent()).use { stmt ->
                    stmt.setLong(1, estimatedSize)
                    stmt.setObject(2, event.runId)
                    stmt.executeUpdate()
                }
                conn.commit()
                log.debug("[events] inserted event [runId={}, type={}, seq={}, estimatedSize={}]",
                    event.runId, event.type.value, seq, estimatedSize)
                seq
            } catch (e: Exception) {
                conn.rollback()
                throw e
            } finally {
                conn.autoCommit = true
            }
        }
    }

    /**
     * Rough estimate of the serialized size of an event in bytes.
     * Used for history_size_bytes tracking — precision not required.
     */
    private fun estimateEventSize(event: RunEvent): Long {
        var size = 200L  // base overhead: column names, types, timestamps, UUID fields
        size += event.type.value.length
        size += event.status.length
        size += event.title?.length ?: 0
        size += event.summary?.length ?: 0
        size += event.metadataJsonSanitized?.length ?: 0
        size += event.errorJsonSanitized?.length ?: 0
        return size.coerceAtLeast(100)
    }

    /**
     * Take the run's `agent_runs` row lock, so sequence assignment for this run is
     * serialized cluster-wide.
     *
     * A missing row (a run deleted mid-flight) locks nothing and is not an error here:
     * the event still gets written on a best-effort basis, exactly as before, and the
     * unique-violation retry in [insertEvent] remains the backstop for that case.
     */
    private fun lockRun(conn: java.sql.Connection, runId: UUID) {
        conn.prepareStatement("SELECT 1 FROM agent_runs WHERE id = ? FOR UPDATE").use { stmt ->
            stmt.setObject(1, runId)
            stmt.executeQuery().use { /* the lock is the point; the row is not read */ }
        }
    }

    private fun nextSequence(conn: java.sql.Connection, runId: UUID): Int {
        conn.prepareStatement(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM run_events WHERE run_id = ?"
        ).use { stmt ->
            stmt.setObject(1, runId)
            stmt.executeQuery().use { rs ->
                rs.next()
                return rs.getInt(1)
            }
        }
    }

    private fun bindInsert(stmt: PreparedStatement, event: RunEvent, seq: Int) {
        var i = 1
        stmt.setObject(i++, event.runId)
        stmt.setObject(i++, event.workspaceId)
        stmt.setObject(i++, event.environmentId)
        stmt.setInt(i++, seq)
        stmt.setString(i++, event.type.value)
        stmt.setString(i++, event.status)
        stmt.setString(i++, event.source)
        stmt.setTimestamp(i++, Timestamp.from(Instant.now()))
        setNullableLong(stmt, i++, event.durationMs)
        setNullableString(stmt, i++, event.stepId)
        setNullableUuid(stmt, i++, event.agentId)
        setNullableString(stmt, i++, event.modelName)
        setNullableString(stmt, i++, event.title)
        setNullableString(stmt, i++, event.summary)
        setNullableInt(stmt, i++, event.tokenCount)
        setNullableDouble(stmt, i++, event.estimatedCost)
        setNullableString(stmt, i++, event.correlationId)
        setNullableString(stmt, i++, event.traceId)
        setNullableInt(stmt, i++, event.retryAttempt)
        setNullableJsonb(stmt, i++, event.metadataJsonSanitized)
        setNullableJsonb(stmt, i, event.errorJsonSanitized)
    }

    // ── Redis publish ─────────────────────────────────────────────────────────

    private fun publishEvent(event: RunEvent, seq: Int) {
        val channel = "run-events:${event.runId}"
        // Minimal envelope — no secrets, no raw payload
        val message = buildString {
            append("{")
            append(""""type":"${event.type.value}"""")
            append(""","status":"${event.status}"""")
            append(""","sequence":$seq""")
            append(""","runId":"${event.runId}"""")
            if (event.title != null) append(""","title":${jsonString(event.title)}""")
            if (event.summary != null) append(""","summary":${jsonString(event.summary)}""")
            append("}")
        }

        try {
            pubSub.sync().publish(channel, message)
            log.debug("[events] published to channel [{}] type={}", channel, event.type.value)
        } catch (e: Exception) {
            // Publish failure is non-fatal — event is already persisted in DB
            log.warn("[events] failed to publish to Redis [channel={}]: {}", channel, e.message)
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun setNullableString(stmt: PreparedStatement, i: Int, v: String?) =
        if (v != null) stmt.setString(i, v) else stmt.setNull(i, java.sql.Types.VARCHAR)

    private fun setNullableLong(stmt: PreparedStatement, i: Int, v: Long?) =
        if (v != null) stmt.setLong(i, v) else stmt.setNull(i, java.sql.Types.BIGINT)

    private fun setNullableInt(stmt: PreparedStatement, i: Int, v: Int?) =
        if (v != null) stmt.setInt(i, v) else stmt.setNull(i, java.sql.Types.INTEGER)

    private fun setNullableDouble(stmt: PreparedStatement, i: Int, v: Double?) =
        if (v != null) stmt.setDouble(i, v) else stmt.setNull(i, java.sql.Types.NUMERIC)

    private fun setNullableUuid(stmt: PreparedStatement, i: Int, v: UUID?) =
        if (v != null) stmt.setObject(i, v) else stmt.setNull(i, java.sql.Types.OTHER)

    private fun setNullableJsonb(stmt: PreparedStatement, i: Int, v: String?) {
        if (v != null) {
            val pgObj = org.postgresql.util.PGobject().apply { type = "jsonb"; value = v }
            stmt.setObject(i, pgObj)
        } else {
            stmt.setNull(i, java.sql.Types.OTHER)
        }
    }

    /** Minimal JSON string escaping for the publish envelope. */
    private fun jsonString(s: String): String =
        "\"${s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "").take(500)}\""

    companion object {
        private val INSERT_SQL = """
            INSERT INTO run_events (
                run_id, workspace_id, environment_id, sequence,
                type, status, source, timestamp,
                duration_ms, step_id, agent_id, model_name,
                title, summary, token_count, estimated_cost,
                correlation_id, trace_id, retry_attempt,
                metadata_json_sanitized, error_json_sanitized
            ) VALUES (
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?
            )
        """.trimIndent()
    }
}
