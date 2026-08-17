package com.vectorbea.api.routes

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.queue.WorkflowRunJob
import com.vectorbea.api.queue.JobType
import org.slf4j.LoggerFactory
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Durable execution API routes:
 *
 *   GET  /api/runs/:runId/history-stats    — event count, size, warning flags
 *   POST /api/runs/:runId/continue-as-new  — create continuation run
 *   GET  /api/runs/:runId/continuations    — list continuation chain
 *   POST /api/runs/:runId/recover          — manually trigger crash recovery
 */
class DurableRunRoutes(
    private val ds: DataSource,
    private val queue: WorkflowQueue?,
) {
    private val log = LoggerFactory.getLogger(DurableRunRoutes::class.java)
    private val mapper = jacksonObjectMapper()

    fun register(router: Router) {
        router.get("/api/runs/:runId/history-stats",   ::historyStats)
        router.post("/api/runs/:runId/continue-as-new", ::continueAsNew)
        router.get("/api/runs/:runId/continuations",   ::listContinuations)
        router.post("/api/runs/:runId/recover",        ::recoverRun)
    }

    // ── GET /api/runs/:runId/history-stats ────────────────────────────────────

    private fun historyStats(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("runId")
        val stats = loadHistoryStats(runId, ctx.workspaceId)
            ?: throw ApiError.NotFound("Run")
        return Response.ok(stats)
    }

    // ── POST /api/runs/:runId/continue-as-new ─────────────────────────────────

    private fun continueAsNew(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("runId")

        data class Body(
            val carryState: Boolean = true,
            val stateKeys: List<String> = emptyList(),
            val reason: String = "manual",
            val useLatestWorkflowVersion: Boolean = false,
        )
        val body = try { mapper.readValue(req.body, Body::class.java) }
        catch (_: Exception) { Body() }

        val run = loadRun(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")

        // Must not be already continued or terminal (except CONTINUING_AS_NEW)
        if (run.continuedToRunId != null) throw ApiError.Conflict("Run already has a continuation")
        if (run.status in setOf("continued_as_new", "cancelled")) {
            throw ApiError.Conflict("Run status '${run.status}' cannot be continued")
        }

        // Determine workflow version to use
        val workflowVersionId = if (body.useLatestWorkflowVersion) {
            latestVersionId(run.workflowId, ctx.workspaceId) ?: run.workflowVersionId
        } else run.workflowVersionId

        // Build compact continuation state from last checkpoint
        val stateJson = buildContinuationState(run, body.stateKeys)

        // Create the new run
        val newRunId = UUID.randomUUID()
        val continuationSeq = run.continuationSequence + 1

        ds.connection.use { conn ->
            // Create new run row
            conn.prepareStatement("""
                INSERT INTO agent_runs
                  (id, workspace_id, environment_id, workflow_id, workflow_version_id,
                   status, trigger_type, creation_mode, input_json,
                   idempotency_key, continued_from_run_id, continuation_sequence)
                VALUES (?,?,?,?,?, 'queued','manual','native', ?::jsonb, null, ?,?)
            """.trimIndent()).use { stmt ->
                stmt.setObject(1, newRunId)
                stmt.setObject(2, ctx.workspaceId)
                stmt.setObject(3, run.environmentId)
                stmt.setObject(4, run.workflowId)
                stmt.setObject(5, workflowVersionId)
                // Persist the carried-over state AS the new run's input so the DB is
                // the source of truth (the worker can load it without the Redis message
                // carrying a large payload).
                stmt.setString(6, stateJson)
                stmt.setObject(7, runId)
                stmt.setInt(8, continuationSeq)
                stmt.executeUpdate()
            }

            // Record continuation
            conn.prepareStatement("""
                INSERT INTO run_continuations
                  (workspace_id, environment_id, old_run_id, new_run_id,
                   workflow_id, workflow_version_id, continuation_sequence, reason, state_json_sanitized)
                VALUES (?,?,?,?,?,?,?,?,?::jsonb)
            """.trimIndent()).use { stmt ->
                stmt.setObject(1, ctx.workspaceId)
                stmt.setObject(2, run.environmentId)
                stmt.setObject(3, runId)
                stmt.setObject(4, newRunId)
                stmt.setObject(5, run.workflowId)
                stmt.setObject(6, workflowVersionId)
                stmt.setInt(7, continuationSeq)
                stmt.setString(8, body.reason)
                stmt.setString(9, stateJson)
                stmt.executeUpdate()
            }

            // Mark old run as continued_as_new + link to new run
            conn.prepareStatement("""
                UPDATE agent_runs SET
                  status = 'continued_as_new',
                  continued_to_run_id = ?,
                  completed_at = now(),
                  updated_at = now()
                WHERE id = ? AND workspace_id = ?
            """.trimIndent()).use { stmt ->
                stmt.setObject(1, newRunId)
                stmt.setObject(2, runId)
                stmt.setObject(3, ctx.workspaceId)
                stmt.executeUpdate()
            }
        }

        // Enqueue the new run
        if (queue != null) {
            queue.enqueue(WorkflowRunJob(
                runId = newRunId.toString(),
                workspaceId = ctx.workspaceId.toString(),
                environmentId = run.environmentId.toString(),
                workflowId = run.workflowId.toString(),
                workflowVersionId = workflowVersionId.toString(),
                jobType = JobType.START_RUN,
                inputJson = stateJson,
                // Same workflow version as the run being continued, so the class
                // is identical by construction — inherit rather than re-derive.
                executionClass = com.vectorbea.api.queue.ExecutionClass.fromWire(run.executionClass),
            ))
        }

        log.info("[durable] continue-as-new oldRun={} newRun={} seq={} reason={}", runId, newRunId, continuationSeq, body.reason)

        return Response(status = 201, body = mapper.writeValueAsString(mapOf(
            "oldRunId" to runId.toString(),
            "newRunId" to newRunId.toString(),
            "continuationSequence" to continuationSeq,
            "status" to "CONTINUED_AS_NEW",
        )), headers = mapOf("Content-Type" to "application/json; charset=utf-8"))
    }

    // ── GET /api/runs/:runId/continuations ────────────────────────────────────

    private fun listContinuations(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("runId")
        val continuations = ds.connection.use { conn ->
            conn.prepareStatement("""
                SELECT c.*, ar_new.status AS new_run_status
                FROM run_continuations c
                JOIN agent_runs ar_new ON ar_new.id = c.new_run_id
                WHERE c.workspace_id = ? AND (c.old_run_id = ? OR c.new_run_id = ?)
                ORDER BY c.continuation_sequence
            """.trimIndent()).use { stmt ->
                stmt.setObject(1, ctx.workspaceId)
                stmt.setObject(2, runId)
                stmt.setObject(3, runId)
                val rs = stmt.executeQuery()
                val list = mutableListOf<Map<String, Any?>>()
                while (rs.next()) {
                    list.add(mapOf(
                        "id" to rs.getString("id"),
                        "oldRunId" to rs.getString("old_run_id"),
                        "newRunId" to rs.getString("new_run_id"),
                        "continuationSequence" to rs.getInt("continuation_sequence"),
                        "reason" to rs.getString("reason"),
                        "newRunStatus" to rs.getString("new_run_status"),
                        "createdAt" to rs.getTimestamp("created_at")?.toInstant()?.toString(),
                    ))
                }
                list
            }
        }
        return Response.ok(continuations)
    }

    // ── POST /api/runs/:runId/recover ─────────────────────────────────────────

    private fun recoverRun(req: Request): Response {
        val ctx = req.context()
        val runId = req.pathUUID("runId")
        val run = loadRun(runId, ctx.workspaceId) ?: throw ApiError.NotFound("Run")

        if (run.status !in setOf("running", "recovering")) {
            throw ApiError.Conflict("Run status '${run.status}' cannot be manually recovered")
        }

        if (queue != null) {
            queue.enqueue(WorkflowRunJob(
                runId = runId.toString(),
                workspaceId = ctx.workspaceId.toString(),
                environmentId = run.environmentId.toString(),
                workflowId = run.workflowId.toString(),
                workflowVersionId = run.workflowVersionId.toString(),
                jobType = JobType.RESUME_RUN,
                executionClass = com.vectorbea.api.queue.ExecutionClass.fromWire(run.executionClass),
            ))
        }

        return Response.ok(mapOf("runId" to runId.toString(), "action" to "RESUME_ENQUEUED"))
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private data class RunRow(
        val id: UUID, val workspaceId: UUID, val environmentId: UUID,
        val workflowId: UUID, val workflowVersionId: UUID,
        val status: String, val continuedToRunId: UUID?, val continuationSequence: Int,
        /** Stored routing class; null on rows written before V020. */
        val executionClass: String? = null,
    )

    private fun loadRun(runId: UUID, workspaceId: UUID): RunRow? {
        ds.connection.use { conn ->
            conn.prepareStatement(
                """SELECT id, workspace_id, environment_id, workflow_id, workflow_version_id,
                   status, continued_to_run_id, continuation_sequence, execution_class
                   FROM agent_runs WHERE id = ? AND workspace_id = ?"""
            ).use { stmt ->
                stmt.setObject(1, runId); stmt.setObject(2, workspaceId)
                val rs = stmt.executeQuery()
                if (!rs.next()) return null
                return RunRow(
                    id = UUID.fromString(rs.getString("id")),
                    workspaceId = UUID.fromString(rs.getString("workspace_id")),
                    environmentId = UUID.fromString(rs.getString("environment_id")),
                    workflowId = UUID.fromString(rs.getString("workflow_id")),
                    workflowVersionId = UUID.fromString(rs.getString("workflow_version_id")),
                    status = rs.getString("status"),
                    continuedToRunId = rs.getString("continued_to_run_id")?.let { UUID.fromString(it) },
                    continuationSequence = rs.getInt("continuation_sequence"),
                    executionClass = rs.getString("execution_class"),
                )
            }
        }
    }

    private fun loadHistoryStats(runId: UUID, workspaceId: UUID): Map<String, Any?>? {
        ds.connection.use { conn ->
            conn.prepareStatement(
                """SELECT history_event_count, history_size_bytes, history_warning_issued,
                   continue_as_new_recommended, continue_as_new_required,
                   continued_from_run_id, continued_to_run_id, continuation_sequence
                   FROM agent_runs WHERE id = ? AND workspace_id = ?"""
            ).use { stmt ->
                stmt.setObject(1, runId); stmt.setObject(2, workspaceId)
                val rs = stmt.executeQuery()
                if (!rs.next()) return null
                return mapOf(
                    "runId" to runId.toString(),
                    "eventCount" to rs.getInt("history_event_count"),
                    "sizeBytes" to rs.getLong("history_size_bytes"),
                    "warningIssued" to rs.getBoolean("history_warning_issued"),
                    "continueAsNewRecommended" to rs.getBoolean("continue_as_new_recommended"),
                    "continueAsNewRequired" to rs.getBoolean("continue_as_new_required"),
                    "continuedFromRunId" to rs.getString("continued_from_run_id"),
                    "continuedToRunId" to rs.getString("continued_to_run_id"),
                    "continuationSequence" to rs.getInt("continuation_sequence"),
                )
            }
        }
    }

    private fun latestVersionId(workflowId: UUID, workspaceId: UUID): UUID? {
        ds.connection.use { conn ->
            conn.prepareStatement(
                "SELECT current_version_id FROM workflows WHERE id = ? AND workspace_id = ?"
            ).use { stmt ->
                stmt.setObject(1, workflowId); stmt.setObject(2, workspaceId)
                val rs = stmt.executeQuery()
                if (!rs.next()) return null
                return rs.getString("current_version_id")?.let { UUID.fromString(it) }
            }
        }
    }

    private fun buildContinuationState(run: RunRow, stateKeys: List<String>): String {
        // Build compact continuation input from latest checkpoint outputs
        // Does NOT copy full event history — only carries necessary state
        val state = mutableMapOf<String, Any?>(
            "_continuation" to mapOf(
                "fromRunId" to run.id.toString(),
                "sequence" to run.continuationSequence + 1,
                "reason" to "continue_as_new",
            )
        )
        // TODO: if stateKeys provided, load those specific step outputs from run_checkpoints
        // For now: empty state (workflow receives minimal continuation context)
        return mapper.writeValueAsString(state)
    }
}
