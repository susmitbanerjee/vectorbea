package com.vectorbea.worker.durable

import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.queue.WorkflowRunJob
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.sql.DataSource

/**
 * Background loop that detects worker-crashed runs and re-enqueues them.
 *
 * A run is stale if:
 *   - status = 'running'
 *   - no valid lease in run_leases (lease expired or missing)
 *
 * Recovery action:
 *   1. Mark run status = 'recovering'
 *   2. Emit RUN_RECOVERY_STARTED event
 *   3. Enqueue RESUME_RUN from latest checkpoint
 *   4. New worker picks it up, takes lease, resumes from checkpoint
 *
 * Run check interval: WORKER_CRASH_CHECK_INTERVAL_MS (default 60s).
 */
class CrashRecoveryLoop(
    private val dataSource: DataSource,
    private val eventStore: RunEventStore,
    private val leaseManager: RunLeaseManager,
    private val enqueueJob: (WorkflowRunJob) -> Unit,
    private val pollIntervalMs: Long = (System.getenv("WORKER_CRASH_CHECK_INTERVAL_MS") ?: "60000").toLong(),
) {
    private val log = logger()
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "crash-recovery").also { it.isDaemon = true }
    }
    private var future: ScheduledFuture<*>? = null

    fun start() {
        if (running.compareAndSet(false, true)) {
            future = executor.scheduleWithFixedDelay(::tick, 30_000L, pollIntervalMs, TimeUnit.MILLISECONDS)
            log.info("[recovery-loop] started (interval={}ms)", pollIntervalMs)
        }
    }

    fun stop() {
        running.set(false)
        future?.cancel(false)
        executor.shutdown()
    }

    private fun tick() {
        if (!running.get()) return
        try {
            val stale = leaseManager.findStaleRuns(limit = 10)
            if (stale.isEmpty()) return
            com.vectorbea.worker.metrics.WorkerMetrics.leaseExpiryTotal
                .inc("crash_recovery", delta = stale.size.toLong())
            log.warn("[recovery-loop] found {} stale runs", stale.size)
            stale.forEach { recover(it) }
        } catch (e: Exception) {
            log.error("[recovery-loop] tick failed: {}", e.message)
        }
    }

    private fun recover(stale: RunLeaseManager.StaleLease) {
        try {
            log.warn("[recovery-loop] recovering runId={} lastWorker={}", stale.runId, stale.lastWorker)

            // Mark as recovering
            val updated = markRecovering(stale.runId)
            if (!updated) {
                log.debug("[recovery-loop] run {} already not running — skip", stale.runId)
                return
            }

            eventStore.appendEvent(RunEventStore.RunEvent(
                runId = stale.runId,
                workspaceId = stale.workspaceId,
                environmentId = stale.environmentId,
                type = RunEventStore.EventType.RUN_RECOVERY_STARTED,
                status = "recovering",
                source = "crash-recovery-loop",
                title = "Run recovery started",
                summary = "Worker lease expired. Recovering from latest checkpoint. LastWorker=${stale.lastWorker}",
            ))

            // Enqueue RESUME_RUN from latest checkpoint
            enqueueJob(WorkflowRunJob(
                streamMessageId = "",
                jobType = WorkflowRunJob.JobType.RESUME_RUN,
                runId = stale.runId,
                workflowId = stale.workflowId,
                triggeredBy = "crash-recovery",
                inputJson = "{}",
                retryCount = 0,
                nodeId = null,
                checkpointId = null,
                workspaceId = stale.workspaceId,
            ))
            log.info("[recovery-loop] enqueued RESUME_RUN for runId={}", stale.runId)
        } catch (e: Exception) {
            log.error("[recovery-loop] recovery failed runId={}: {}", stale.runId, e.message)
        }
    }

    private fun markRecovering(runId: UUID): Boolean {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "UPDATE agent_runs SET status='recovering', updated_at=now() WHERE id=? AND status IN ('running','yielded')"
            ).use { stmt ->
                stmt.setObject(1, runId)
                return stmt.executeUpdate() > 0
            }
        }
    }
}
