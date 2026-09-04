package com.vectorbea.worker.durable

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.queue.WorkflowRunJob
import java.util.UUID
import javax.sql.DataSource

/**
 * Poison-job protection.
 *
 * THE FAILURE MODE
 * ----------------
 * A job that crashes its worker does not stay crashed. The lease expires, the
 * message is reclaimed, another worker picks it up and dies the same way. One
 * malformed payload takes down the fleet, one worker at a time, indefinitely —
 * and because each individual crash looks like an infrastructure blip, it is
 * usually diagnosed as one.
 *
 * The cure is a counter with a ceiling. Past `max_attempts` the job stops being
 * redelivered and lands in `dead_letters` instead, with enough context to
 * diagnose it *without reproducing the crash*: the full payload, every error
 * across every attempt, and which workers it killed.
 *
 * WHY THE COUNTER LIVES IN POSTGRES
 * ---------------------------------
 * The Redis message carries a `retryCount`, but an XAUTOCLAIM reclaim replays
 * the original fields — so a job redelivered by reclaim comes back with the same
 * count it had the first time and the ceiling is never reached. The authoritative
 * count is `agent_runs.delivery_attempts`, incremented on claim.
 */
class DeadLetterStore(
    private val dataSource: DataSource,
    private val workerId: String,
    val maxAttempts: Int = System.getenv("WORKER_MAX_DELIVERY_ATTEMPTS")?.toIntOrNull() ?: 5,
) {
    private val log = logger()
    private val mapper = jacksonObjectMapper()

    /**
     * Count this delivery and report whether the job has exhausted its attempts.
     *
     * Called at claim, before execution — the point of the exercise is to stop
     * *before* running a job that has already killed several workers.
     *
     * @return the new attempt count, or null if the run row is missing.
     */
    fun recordDelivery(runId: UUID): Int? = try {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """UPDATE agent_runs
                      SET delivery_attempts = delivery_attempts + 1, updated_at = now()
                    WHERE id = ?
                RETURNING delivery_attempts"""
            ).use { stmt ->
                stmt.setObject(1, runId)
                stmt.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else null }
            }
        }
    } catch (e: Exception) {
        // Never block execution on the counter. Failing open risks one extra
        // delivery; failing closed would stall healthy runs on a transient blip.
        log.warn("[dead-letter] could not record delivery for {}: {}", runId, e.message)
        null
    }

    fun isExhausted(attempts: Int?): Boolean = attempts != null && attempts > maxAttempts

    /**
     * Move a job to the dead-letter table and mark the run terminal.
     *
     * The error chain is assembled from `run_events` rather than passed in: by
     * definition the interesting failures happened on workers that are no longer
     * around to tell us about them, and the events they wrote before dying are
     * the only record left.
     */
    fun deadLetter(
        job: WorkflowRunJob,
        attempts: Int,
        reason: String,
        lastError: String?,
    ): UUID? = try {
        val errorChain = collectErrorChain(job.runId, lastError)
        val id = UUID.randomUUID()

        dataSource.connection.use { conn ->
            conn.autoCommit = false
            try {
                conn.prepareStatement(
                    """
                    INSERT INTO dead_letters
                        (id, workspace_id, environment_id, run_id, workflow_id, job_type,
                         execution_class, payload_json, error_chain_json, attempts,
                         max_attempts, reason, worker_context_json, status)
                    VALUES (?,?,?,?,?,?,?,?::jsonb,?::jsonb,?,?,?,?::jsonb,'new')
                    """.trimIndent()
                ).use { stmt ->
                    stmt.setObject(1, id)
                    stmt.setObject(2, job.workspaceId)
                    stmt.setObject(3, null)
                    stmt.setObject(4, job.runId)
                    stmt.setObject(5, job.workflowId)
                    stmt.setString(6, job.jobType.name)
                    stmt.setString(7, null)
                    stmt.setString(8, mapper.writeValueAsString(job.toStreamFields()))
                    stmt.setString(9, mapper.writeValueAsString(errorChain))
                    stmt.setInt(10, attempts)
                    stmt.setInt(11, maxAttempts)
                    stmt.setString(12, reason)
                    stmt.setString(13, mapper.writeValueAsString(mapOf(
                        "detectedByWorker" to workerId,
                        "detectedAt" to java.time.Instant.now().toString(),
                        "streamMessageId" to job.streamMessageId,
                        "jvm" to System.getProperty("java.version"),
                    )))
                    stmt.executeUpdate()
                }

                // Terminal state, so nothing re-enqueues it and the Runs page
                // stops showing it as pending forever.
                conn.prepareStatement(
                    """UPDATE agent_runs
                          SET status = 'failed', dead_lettered_at = now(),
                              completed_at = COALESCE(completed_at, now()), updated_at = now()
                        WHERE id = ? AND status NOT IN ('succeeded','cancelled')"""
                ).use { stmt ->
                    stmt.setObject(1, job.runId)
                    stmt.executeUpdate()
                }

                conn.commit()
            } catch (e: Exception) {
                conn.rollback(); throw e
            } finally {
                conn.autoCommit = true
            }
        }

        WorkerMetrics.deadLetterTotal.inc(reason)
        log.error(
            "[dead-letter] run {} moved to dead_letters after {} attempts (max {}) — reason={}. " +
                "It will NOT be redelivered. Surfaced in Incidents as {}.",
            job.runId, attempts, maxAttempts, reason, id,
        )
        id
    } catch (e: Exception) {
        log.error("[dead-letter] FAILED to dead-letter run {} — it may keep being redelivered: {}",
            job.runId, e.message, e)
        null
    }

    /**
     * Every failure this run has recorded, oldest first.
     *
     * One error tells you the last failure. The chain tells you whether it is
     * deterministic — which is the difference between a poison payload and a
     * flaky dependency, and therefore between "fix the data" and "fix the
     * integration".
     */
    private fun collectErrorChain(runId: UUID, lastError: String?): List<Map<String, Any?>> {
        val chain = mutableListOf<Map<String, Any?>>()
        try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """SELECT created_at, type, status, step_id, summary, error_json_sanitized
                         FROM run_events
                        WHERE run_id = ?
                          AND (status = 'failed' OR type IN ('RUN_FAILED','STEP_FAILED'))
                        ORDER BY created_at ASC
                        LIMIT 50"""
                ).use { stmt ->
                    stmt.setObject(1, runId)
                    stmt.executeQuery().use { rs ->
                        while (rs.next()) {
                            chain += mapOf(
                                "at" to rs.getTimestamp("created_at")?.toInstant()?.toString(),
                                "type" to rs.getString("type"),
                                "stepId" to rs.getString("step_id"),
                                "summary" to rs.getString("summary")?.take(500),
                                "error" to rs.getString("error_json_sanitized")?.take(2000),
                            )
                        }
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[dead-letter] could not read error chain for {}: {}", runId, e.message)
        }
        if (lastError != null) {
            chain += mapOf(
                "at" to java.time.Instant.now().toString(),
                "type" to "FINAL_ATTEMPT",
                "error" to lastError.take(2000),
                "worker" to workerId,
            )
        }
        return chain
    }
}
