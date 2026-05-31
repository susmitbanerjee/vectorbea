package com.vectorbea.worker.durable

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.queue.WorkflowRunJob
import io.lettuce.core.RedisClient
import io.lettuce.core.api.sync.RedisCommands
import java.sql.Timestamp
import java.time.Duration
import java.time.Instant
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.sql.DataSource

/**
 * Durable timer scheduler for workflow sleep/timer nodes.
 *
 * Instead of blocking a worker thread, timer nodes:
 *   1. Write a row to workflow_timers with fire_at timestamp
 *   2. Set run status to WAITING_FOR_TIMER
 *   3. Release the worker
 *
 * This scheduler loop periodically scans for due timers,
 * fires them by enqueuing RESUME_RUN jobs, and marks them fired.
 *
 * Redis lock prevents duplicate firing across multiple workers.
 */
class TimerScheduler(
    private val dataSource: DataSource,
    private val enqueueJob: (WorkflowRunJob) -> Unit,
    private val redisCommands: RedisCommands<String, String>?,
    private val pollIntervalMs: Long = 15_000L,
    private val lockTtlSeconds: Long = 30L,
) {
    private val log = logger()
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "timer-scheduler").also { it.isDaemon = true }
    }
    private var future: ScheduledFuture<*>? = null
    private val LOCK_KEY = "vectorbea:timer-scheduler:lock"

    fun start() {
        if (running.compareAndSet(false, true)) {
            future = executor.scheduleWithFixedDelay(::tick, 5_000L, pollIntervalMs, TimeUnit.MILLISECONDS)
            log.info("[timers] scheduler started (pollInterval={}ms)", pollIntervalMs)
        }
    }

    fun stop() {
        running.set(false)
        future?.cancel(false)
        executor.shutdown()
        log.info("[timers] scheduler stopped")
    }

    /**
     * Schedule a durable timer for [runId] at [fireAt].
     * Worker calls this instead of sleeping.
     */
    fun scheduleTimer(
        runId: UUID, workspaceId: UUID, environmentId: UUID, workflowId: UUID,
        nodeId: String, fireAt: Instant, payloadJson: String = "{}",
    ): UUID {
        val timerId = UUID.randomUUID()
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """INSERT INTO workflow_timers
                   (id, workspace_id, environment_id, run_id, workflow_id, node_id, fire_at, status, payload_json_sanitized)
                   VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?::jsonb)"""
            ).use { stmt ->
                stmt.setObject(1, timerId)
                stmt.setObject(2, workspaceId)
                stmt.setObject(3, environmentId)
                stmt.setObject(4, runId)
                stmt.setObject(5, workflowId)
                stmt.setString(6, nodeId)
                stmt.setTimestamp(7, Timestamp.from(fireAt))
                stmt.setString(8, payloadJson)
                stmt.executeUpdate()
            }
        }
        log.info("[timers] scheduled timerId={} runId={} nodeId={} fireAt={}", timerId, runId, nodeId, fireAt)
        return timerId
    }

    /** Cancel a pending timer (e.g., when run is cancelled). */
    fun cancelTimer(runId: UUID) {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "UPDATE workflow_timers SET status='cancelled', fired_at=now() WHERE run_id=? AND status='scheduled'"
            ).use { stmt ->
                stmt.setObject(1, runId)
                val n = stmt.executeUpdate()
                if (n > 0) log.info("[timers] cancelled {} timers for runId={}", n, runId)
            }
        }
    }

    // ── Internal tick ─────────────────────────────────────────────────────────

    private fun tick() {
        if (!running.get()) return
        try {
            // Distributed lock so only one worker fires timers at a time
            if (!acquireLock()) return
            try {
                fireDueTimers()
            } finally {
                releaseLock()
            }
        } catch (e: Exception) {
            log.error("[timers] tick failed: {}", e.message)
        }
    }

    private fun fireDueTimers() {
        val due = findDueTimers(limit = 50)
        if (due.isEmpty()) return
        log.info("[timers] firing {} due timers", due.size)
        due.forEach { timer ->
            try {
                markFired(timer.id)
                // Enqueue RESUME_RUN — worker will resume from checkpoint at the timer node
                enqueueJob(WorkflowRunJob(
                    streamMessageId = "",   // not from stream — synthesized
                    jobType = WorkflowRunJob.JobType.RESUME_RUN,
                    runId = timer.runId,
                    workflowId = timer.workflowId,
                    triggeredBy = "timer:${timer.id}",
                    inputJson = "{}",
                    retryCount = 0,
                    nodeId = timer.nodeId,
                    checkpointId = null,
                    workspaceId = timer.workspaceId,
                ))
                log.info("[timers] fired timerId={} runId={} nodeId={}", timer.id, timer.runId, timer.nodeId)
            } catch (e: Exception) {
                log.error("[timers] failed to fire timerId={}: {}", timer.id, e.message)
            }
        }
    }

    private data class TimerRow(
        val id: UUID, val runId: UUID, val workspaceId: UUID,
        val workflowId: UUID, val nodeId: String,
    )

    private fun findDueTimers(limit: Int): List<TimerRow> {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """SELECT t.id, t.run_id, t.workspace_id, t.workflow_id, t.node_id
                   FROM workflow_timers t
                   JOIN agent_runs ar ON ar.id = t.run_id
                   WHERE t.status = 'scheduled'
                     AND t.fire_at <= now()
                     AND ar.status = 'waiting_for_timer'
                   ORDER BY t.fire_at ASC
                   LIMIT $limit"""
            ).use { stmt ->
                val rs = stmt.executeQuery()
                val list = mutableListOf<TimerRow>()
                while (rs.next()) {
                    list.add(TimerRow(
                        id = UUID.fromString(rs.getString("id")),
                        runId = UUID.fromString(rs.getString("run_id")),
                        workspaceId = UUID.fromString(rs.getString("workspace_id")),
                        workflowId = UUID.fromString(rs.getString("workflow_id")),
                        nodeId = rs.getString("node_id"),
                    ))
                }
                list
            }
        }
    }

    private fun markFired(timerId: UUID) {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "UPDATE workflow_timers SET status='fired', fired_at=now() WHERE id=? AND status='scheduled'"
            ).use { stmt ->
                stmt.setObject(1, timerId)
                stmt.executeUpdate()
            }
        }
    }

    private fun acquireLock(): Boolean {
        if (redisCommands == null) return true  // no Redis — single-worker mode
        return try {
            val result = redisCommands.set(LOCK_KEY, "1",
                io.lettuce.core.SetArgs().nx().ex(lockTtlSeconds))
            result == "OK"
        } catch (e: Exception) {
            log.warn("[timers] lock acquire failed: {}", e.message)
            false
        }
    }

    private fun releaseLock() {
        try { redisCommands?.del(LOCK_KEY) } catch (_: Exception) {}
    }
}
