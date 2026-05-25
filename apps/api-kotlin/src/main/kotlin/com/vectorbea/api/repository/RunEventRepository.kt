package com.vectorbea.api.repository

import com.vectorbea.api.db.getJsonbString
import com.vectorbea.api.db.getJsonbStringOrNull
import com.vectorbea.api.db.setJsonb
import com.vectorbea.api.db.toJsonb
import com.vectorbea.api.db.transaction
import org.slf4j.LoggerFactory
import java.sql.PreparedStatement
import java.sql.Types
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

data class RunEvent(
    val id: UUID,
    val runId: UUID,
    val workspaceId: UUID,
    val sequence: Int,
    val eventType: String,
    /** Payload must never contain secrets or connection strings */
    val payloadJson: String,
    val agentId: UUID?,
    val toolId: UUID?,
    val stepId: String?,
    val durationMs: Int?,
    val tokenUsageJson: String?,
    val createdAt: Instant,
)

data class CreateRunEventRequest(
    val runId: UUID,
    val workspaceId: UUID,
    val sequence: Int,
    val eventType: String,
    /** Caller is responsible for stripping secrets before populating payload */
    val payload: Map<String, Any> = emptyMap(),
    val agentId: UUID? = null,
    val toolId: UUID? = null,
    val stepId: String? = null,
    val durationMs: Int? = null,
    val tokenUsage: Map<String, Any>? = null,
)

class RunEventRepository(dataSource: DataSource) : BaseRepository(dataSource) {
    override val log = LoggerFactory.getLogger(RunEventRepository::class.java)

    private val cols = """
        id, run_id, workspace_id, sequence, event_type, payload_json,
        agent_id, tool_id, step_id, duration_ms, token_usage_json, created_at
    """.trimIndent()

    fun findById(id: UUID, workspaceId: UUID): RunEvent? = queryOne(
        "SELECT $cols FROM run_events WHERE id = ? AND workspace_id = ?",
        { setUuid(1, id); setUuid(2, workspaceId) },
        ::mapRow,
    )

    fun listByRun(
        runId: UUID,
        workspaceId: UUID,
        eventType: String? = null,
        afterSequence: Int? = null,
        params: PageParams = PageParams(),
    ): Page<RunEvent> {
        val filters = buildList {
            add("run_id = ?")
            add("workspace_id = ?")
            if (eventType != null) add("event_type = ?")
            if (afterSequence != null) add("sequence > ?")
        }
        val where = "WHERE ${filters.joinToString(" AND ")}"
        val bindBase: (java.sql.PreparedStatement) -> Unit = {
            var i = 1
            it.setUuid(i++, runId)
            it.setUuid(i++, workspaceId)
            if (eventType != null) it.setString(i++, eventType)
            if (afterSequence != null) it.setInt(i++, afterSequence)
        }
        return queryPage(
            sql = "SELECT $cols FROM run_events $where ORDER BY sequence ASC LIMIT ? OFFSET ?",
            countSql = "SELECT COUNT(*) FROM run_events $where",
            params = params,
            bind = {
                bindBase(this)
                setInt(filters.size + 1, params.limit)
                setInt(filters.size + 2, params.offset)
            },
            mapRow = ::mapRow,
        )
    }

    fun create(req: CreateRunEventRequest): RunEvent = executeReturning(
        """
        INSERT INTO run_events (
            run_id, workspace_id, sequence, event_type, payload_json,
            agent_id, tool_id, step_id, duration_ms, token_usage_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING $cols
        """.trimIndent(),
        {
            setUuid(1, req.runId)
            setUuid(2, req.workspaceId)
            setInt(3, req.sequence)
            setString(4, req.eventType)
            setJsonb(5, req.payload)
            setUuidOrNull(6, req.agentId)
            setUuidOrNull(7, req.toolId)
            setString(8, req.stepId)
            if (req.durationMs != null) setInt(9, req.durationMs) else setNull(9, Types.INTEGER)
            if (req.tokenUsage != null) setJsonb(10, req.tokenUsage) else setNull(10, Types.OTHER)
        },
        ::mapRow,
    )

    /** Returns the next sequence number for a run (MAX + 1, or 1 if no events yet). */
    fun nextSequence(runId: UUID, workspaceId: UUID): Int =
        query(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM run_events WHERE run_id = ? AND workspace_id = ?",
            { setUuid(1, runId); setUuid(2, workspaceId) },
        ) { rs -> rs.getInt(1) }.first()

    /** Bulk-insert events; returns inserted count. Uses a transaction internally. */
    fun createBatch(events: List<CreateRunEventRequest>): Int {
        if (events.isEmpty()) return 0
        var count = 0
        dataSource.transaction { conn ->
            val insertSql = """
                INSERT INTO run_events (
                    run_id, workspace_id, sequence, event_type, payload_json,
                    agent_id, tool_id, step_id, duration_ms, token_usage_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """.trimIndent()
            conn.prepareStatement(insertSql).use { stmt ->
                for (req in events) {
                    // Use setObject directly to avoid ambiguity with BaseRepository extension methods
                    stmt.setObject(1, req.runId)
                    stmt.setObject(2, req.workspaceId)
                    stmt.setInt(3, req.sequence)
                    stmt.setString(4, req.eventType)
                    stmt.setObject(5, toJsonb(req.payload))
                    if (req.agentId != null) stmt.setObject(6, req.agentId) else stmt.setNull(6, Types.OTHER)
                    if (req.toolId != null) stmt.setObject(7, req.toolId) else stmt.setNull(7, Types.OTHER)
                    stmt.setString(8, req.stepId)
                    if (req.durationMs != null) stmt.setInt(9, req.durationMs) else stmt.setNull(9, Types.INTEGER)
                    if (req.tokenUsage != null) stmt.setObject(10, toJsonb(req.tokenUsage)) else stmt.setNull(10, Types.OTHER)
                    stmt.addBatch()
                }
                count = stmt.executeBatch().sum()
            }
        }
        return count
    }

    private fun mapRow(rs: java.sql.ResultSet) = RunEvent(
        id = rs.uuid("id"),
        runId = rs.uuid("run_id"),
        workspaceId = rs.uuid("workspace_id"),
        sequence = rs.getInt("sequence"),
        eventType = rs.getString("event_type"),
        payloadJson = rs.getJsonbString("payload_json"),
        agentId = rs.uuidOrNull("agent_id"),
        toolId = rs.uuidOrNull("tool_id"),
        stepId = rs.getString("step_id"),
        durationMs = rs.getObject("duration_ms") as? Int,
        tokenUsageJson = rs.getJsonbStringOrNull("token_usage_json"),
        createdAt = rs.instant("created_at"),
    )
}
