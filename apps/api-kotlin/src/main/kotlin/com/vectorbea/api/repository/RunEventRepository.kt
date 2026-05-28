package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbStringOrNull
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Repository for run_events.
 * [append] writes lifecycle events from the API (RUN_CREATED, RUN_QUEUED).
 * The workflow executor writes execution events; [listByRun] reads all of them.
 * All sanitized fields (*_json_sanitized) are already scrubbed — safe to return.
 */
data class RunEvent(
    val id: UUID,
    val runId: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val sequence: Int,
    val type: String,
    val status: String,
    val source: String,
    val timestamp: Instant,
    val durationMs: Long?,
    val stepId: String?,
    val agentId: UUID?,
    val toolId: UUID?,
    val connectionId: UUID?,
    val modelName: String?,
    val parentEventId: UUID?,
    val correlationId: String?,
    val traceId: String?,
    val retryAttempt: Int?,
    val checkpointId: UUID?,
    val title: String?,
    val summary: String?,
    /** Already sanitized — safe to return to clients */
    val inputJsonSanitized: String?,
    val outputJsonSanitized: String?,
    val metadataJsonSanitized: String?,
    val errorJsonSanitized: String?,
    val tokenCount: Int?,
    val estimatedCost: Double?,
    val createdAt: Instant,
)

data class AppendEventRequest(
    val runId: UUID,
    val workspaceId: UUID,
    val environmentId: UUID,
    val type: String,
    val status: String,
    val source: String,
    val title: String? = null,
    val summary: String? = null,
    val correlationId: String? = null,
)

open class RunEventRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(RunEventRepository::class.java)

    private val cols = """
        id, run_id, workspace_id, environment_id, sequence, type, status, source,
        timestamp, duration_ms, step_id, agent_id, tool_id, connection_id, model_name,
        parent_event_id, correlation_id, trace_id, retry_attempt, checkpoint_id,
        title, summary, input_json_sanitized, output_json_sanitized,
        metadata_json_sanitized, error_json_sanitized, token_count, estimated_cost, created_at
    """.trimIndent()

    /**
     * Insert a lifecycle event for a run.
     * Sequence is assigned inside a transaction: MAX(sequence)+1 to avoid races.
     * Returns the newly inserted [RunEvent].
     */
    open fun append(req: AppendEventRequest): RunEvent {
        val conn = dataSource.connection
        return conn.use { c ->
            val prev = c.autoCommit
            c.autoCommit = false
            try {
                val seq = c.prepareStatement(
                    "SELECT COALESCE(MAX(sequence), 0) + 1 FROM run_events WHERE run_id = ?"
                ).use { s ->
                    s.setObject(1, req.runId)
                    s.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
                }
                val event = c.prepareStatement(
                    """
                    INSERT INTO run_events
                        (run_id, workspace_id, environment_id, sequence, type, status,
                         source, title, summary, correlation_id, timestamp)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, now())
                    RETURNING $cols
                    """.trimIndent()
                ).use { s ->
                    s.setObject(1, req.runId)
                    s.setObject(2, req.workspaceId)
                    s.setObject(3, req.environmentId)
                    s.setInt(4, seq)
                    s.setString(5, req.type)
                    s.setString(6, req.status)
                    s.setString(7, req.source)
                    s.setString(8, req.title)
                    s.setString(9, req.summary)
                    s.setString(10, req.correlationId)
                    s.executeQuery().use { rs ->
                        rs.next()
                        mapRow(rs)
                    }
                }
                c.commit()
                event
            } catch (e: Exception) {
                c.rollback()
                throw e
            } finally {
                c.autoCommit = prev
            }
        }
    }

    open fun listByRun(
        runId: UUID,
        workspaceId: UUID,
        afterSequence: Int? = null,
        type: String? = null,
        params: PageParams = PageParams(),
    ): Page<RunEvent> {
        val filters = buildList {
            add("run_id = ?")
            add("workspace_id = ?")
            if (afterSequence != null) add("sequence > ?")
            if (type != null) add("type = ?")
        }
        val where = "WHERE ${filters.joinToString(" AND ")}"
        val bindBase: (java.sql.PreparedStatement) -> Unit = {
            var i = 1
            it.setUuid(i++, runId)
            it.setUuid(i++, workspaceId)
            if (afterSequence != null) it.setInt(i++, afterSequence)
            if (type != null) it.setString(i++, type)
        }
        return queryPage(
            sql = "SELECT $cols FROM run_events $where ORDER BY sequence ASC",
            countSql = "SELECT COUNT(*) FROM run_events $where",
            params = params,
            bind = { bindBase(this) },
            mapRow = ::mapRow,
        )
    }

    private fun mapRow(rs: java.sql.ResultSet) = RunEvent(
        id = rs.uuid("id"),
        runId = rs.uuid("run_id"),
        workspaceId = rs.uuid("workspace_id"),
        environmentId = rs.uuid("environment_id"),
        sequence = rs.getInt("sequence"),
        type = rs.getString("type"),
        status = rs.getString("status"),
        source = rs.getString("source"),
        timestamp = rs.instant("timestamp"),
        durationMs = rs.getObject("duration_ms") as? Long,
        stepId = rs.getString("step_id"),
        agentId = rs.uuidOrNull("agent_id"),
        toolId = rs.uuidOrNull("tool_id"),
        connectionId = rs.uuidOrNull("connection_id"),
        modelName = rs.getString("model_name"),
        parentEventId = rs.uuidOrNull("parent_event_id"),
        correlationId = rs.getString("correlation_id"),
        traceId = rs.getString("trace_id"),
        retryAttempt = rs.getObject("retry_attempt") as? Int,
        checkpointId = rs.uuidOrNull("checkpoint_id"),
        title = rs.getString("title"),
        summary = rs.getString("summary"),
        inputJsonSanitized = rs.getJsonbStringOrNull("input_json_sanitized"),
        outputJsonSanitized = rs.getJsonbStringOrNull("output_json_sanitized"),
        metadataJsonSanitized = rs.getJsonbStringOrNull("metadata_json_sanitized"),
        errorJsonSanitized = rs.getJsonbStringOrNull("error_json_sanitized"),
        tokenCount = rs.getObject("token_count") as? Int,
        estimatedCost = (rs.getObject("estimated_cost") as? java.math.BigDecimal)?.toDouble(),
        createdAt = rs.instant("created_at"),
    )
}
