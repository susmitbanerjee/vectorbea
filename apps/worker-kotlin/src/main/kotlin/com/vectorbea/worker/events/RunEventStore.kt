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
 * Sequence: obtained atomically via `SELECT COALESCE(MAX(sequence),0)+1 …`
 * inside the same transaction as the INSERT, preventing duplicates under
 * concurrent workers.
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

    // ── DB insert ─────────────────────────────────────────────────────────────

    private fun insertEvent(event: RunEvent): Int {
        return dataSource.connection.use { conn ->
            // Atomic sequence: MAX(sequence)+1 scoped to the run, inside one txn
            conn.autoCommit = false
            try {
                val seq = nextSequence(conn, event.runId)

                conn.prepareStatement(INSERT_SQL).use { stmt ->
                    bindInsert(stmt, event, seq)
                    stmt.executeUpdate()
                }

                conn.commit()
                log.debug("[events] inserted event [runId={}, type={}, seq={}]",
                    event.runId, event.type.value, seq)
                seq
            } catch (e: Exception) {
                conn.rollback()
                log.error("[events] failed to insert event [runId={}, type={}]: {}",
                    event.runId, event.type.value, e.message)
                throw e
            } finally {
                conn.autoCommit = true
            }
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
