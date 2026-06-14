package com.vectorbea.api.schedule

import com.vectorbea.api.queue.JobType
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.queue.WorkflowRunJob
import com.vectorbea.api.repository.AppendEventRequest
import com.vectorbea.api.repository.CreateRunRequest
import com.vectorbea.api.repository.RunEventRepository
import com.vectorbea.api.repository.RunRepository
import com.vectorbea.api.repository.WorkflowRepository
import org.slf4j.LoggerFactory
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Fires cron-based workflow schedules.
 *
 * Every [pollIntervalMs] it scans for due schedules and, for each, atomically
 * claims it (advancing next_fire_at to the next cron occurrence) before triggering
 * a run. The claim is a guarded UPDATE, so when several API instances run this loop
 * each schedule fires exactly once — no external lock required.
 *
 * Firing mirrors a manual trigger: create a queued run, append lifecycle events,
 * and enqueue a START_RUN job for the worker.
 */
class WorkflowScheduler(
    private val schedules: ScheduleRepository,
    private val workflowRepo: WorkflowRepository,
    private val runRepo: RunRepository,
    private val eventRepo: RunEventRepository,
    private val queue: WorkflowQueue,
    private val pollIntervalMs: Long = 30_000L,
) {
    private val log = LoggerFactory.getLogger(WorkflowScheduler::class.java)
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "workflow-scheduler").also { it.isDaemon = true }
    }
    private var future: ScheduledFuture<*>? = null

    fun start() {
        if (running.compareAndSet(false, true)) {
            future = executor.scheduleWithFixedDelay(::tick, 10_000L, pollIntervalMs, TimeUnit.MILLISECONDS)
            log.info("[scheduler] cron scheduler started (pollInterval={}ms)", pollIntervalMs)
        }
    }

    fun stop() {
        running.set(false)
        future?.cancel(false)
        executor.shutdown()
        log.info("[scheduler] cron scheduler stopped")
    }

    private fun tick() {
        if (!running.get()) return
        try {
            val now = Instant.now()
            val due = schedules.listDue(now, limit = 100)
            if (due.isEmpty()) return
            log.info("[scheduler] {} schedule(s) due", due.size)
            for (s in due) {
                val zone = runCatching { ZoneId.of(s.timezone) }.getOrDefault(ZoneOffset.UTC)
                val nextFire = runCatching { CronExpression.parse(s.cronExpression).nextAfter(now, zone) }.getOrNull()
                if (nextFire == null) {
                    log.warn("[scheduler] schedule {} has an invalid/never cron '{}' — parking it",
                        s.id, s.cronExpression)
                }
                // Atomically claim: only the winner advances next_fire_at and fires.
                if (!schedules.claimAndAdvance(s.id, threshold = now, firedAt = now, nextFireAt = nextFire)) continue
                try {
                    fire(s)
                } catch (e: Exception) {
                    log.error("[scheduler] firing schedule {} failed: {}", s.id, e.message)
                }
            }
        } catch (e: Exception) {
            log.error("[scheduler] tick failed: {}", e.message)
        }
    }

    private fun fire(s: Schedule) {
        val wf = workflowRepo.findById(s.workflowId, s.workspaceId)
        if (wf == null) {
            log.warn("[scheduler] workflow {} not found — removing schedule {}", s.workflowId, s.id)
            runCatching { schedules.deleteForWorkflow(s.workflowId) }
            return
        }
        if (wf.status == "archived") {
            log.info("[scheduler] workflow {} is archived — skipping scheduled run", s.workflowId)
            return
        }
        val versionId = wf.currentVersionId
        if (versionId == null) {
            log.warn("[scheduler] workflow {} has no current version — skipping scheduled run", s.workflowId)
            return
        }

        val run = runRepo.create(CreateRunRequest(
            workspaceId = s.workspaceId,
            environmentId = s.environmentId,
            workflowId = s.workflowId,
            workflowVersionId = versionId,
            triggerType = "schedule",
            inputJson = "{}",
        ))

        runCatching {
            eventRepo.append(AppendEventRequest(run.id, s.workspaceId, s.environmentId,
                "RUN_CREATED", "queued", "scheduler", "Run created", "Triggered by cron schedule"))
            eventRepo.append(AppendEventRequest(run.id, s.workspaceId, s.environmentId,
                "RUN_QUEUED", "queued", "scheduler", "Run queued", "Job placed on workflow queue"))
        }

        try {
            queue.enqueue(WorkflowRunJob(
                runId = run.id.toString(),
                workspaceId = s.workspaceId.toString(),
                environmentId = s.environmentId.toString(),
                workflowId = s.workflowId.toString(),
                workflowVersionId = versionId.toString(),
                jobType = JobType.START_RUN,
                inputJson = "{}",
                reason = "schedule",
            ))
            log.info("[scheduler] fired schedule {} → run {} (workflow {})", s.id, run.id, s.workflowId)
        } catch (e: Exception) {
            runCatching { runRepo.updateStatus(run.id, s.workspaceId, "enqueue_failed") }
            log.error("[scheduler] enqueue failed for schedule {} run {}: {}", s.id, run.id, e.message)
        }
    }
}
