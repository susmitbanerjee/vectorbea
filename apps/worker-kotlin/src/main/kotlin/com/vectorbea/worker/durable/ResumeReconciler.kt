package com.vectorbea.worker.durable

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.queue.WorkflowRunJob
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.sql.DataSource

/**
 * The runs nobody is coming back for.
 *
 * ── THE BUG THIS EXISTS FOR, AS FOUND ───────────────────────────────────────
 * `ApprovalRoutes` records the decision durably, then enqueues `RESUME_RUN`
 * inside a `runCatching { }.onFailure { log }`, then returns 200 with "Run will
 * resume shortly". If Redis hiccups, the decision is stored, the caller has been
 * told it worked, and nothing will ever resume the run. It is worse than that:
 * the enqueue sits inside `if (q != null && run != null)`, so an unwired
 * repository skips it silently.
 *
 * And `CrashRecoveryLoop` cannot rescue it, because `findStaleRuns` scans
 * `status IN ('running','yielded')` — a parked run is invisible to the thing
 * whose job is finding abandoned runs.
 *
 * ── FOUR PARKINGS, ONE SWEEP ────────────────────────────────────────────────
 * P0 enumerated every status a run can park in, and the same shape appears four
 * times. Dispatched children add the fourth:
 *
 * | Parked in | The gap |
 * |---|---|
 * | `waiting_for_approval` | decision stored, enqueue swallowed |
 * | `waiting_for_child` | last child terminal, parent's resume enqueue swallowed |
 * | `recovering` | `CrashRecoveryLoop` marks the status BEFORE it enqueues, and does not scan `recovering` — so the recovery loop can strand the run it is rescuing |
 * | `waiting_for_timer` | `TimerScheduler` marks the timer `fired` BEFORE it enqueues, and `findDueTimers` requires `scheduled` — so a failed enqueue is never retried |
 *
 * Four bugs, one failure mode: **a durable state change followed by a
 * best-effort enqueue.** One reconciler, because four would drift and because
 * the fifth trigger somebody adds next year should be a row in a query rather
 * than a new loop.
 *
 * ── WHY THIS NEEDS NO STATE-MACHINE CHANGE ──────────────────────────────────
 * `RunProcessor` already accepts all five statuses as resumable
 * (`fromStatuses = ['waiting_for_approval','recovering','waiting_for_timer','yielded','queued']`).
 * So this is a sweep and an enqueue, and nothing else: no new status, no new
 * transition, no CAS this does not already make.
 *
 * ── IDEMPOTENT ──────────────────────────────────────────────────────────────
 * Re-enqueueing a resume for a run that is already running is harmless: the
 * processor's status CAS refuses it, because the run is no longer in a resumable
 * status. That is what makes it safe to run this on every worker on a short
 * interval, and safe for the reconciler to race the real enqueue it is backing
 * up. Duplicate resumes are the expected steady state, not an error.
 */
class ResumeReconciler(
    private val dataSource: DataSource,
    /** Puts the job on the run's own class stream. Same seam the yield path uses. */
    private val enqueue: (WorkflowRunJob) -> Unit,
    private val pollIntervalMs: Long = SWEEP_INTERVAL_MS,
    /**
     * How long a run must have been parked before it is a candidate.
     *
     * Not zero: the ordinary enqueue is in flight for a moment after the status
     * change, and sweeping immediately would race every healthy resume and do
     * the work twice for no reason. Long enough that only genuinely stuck runs
     * are seen; short enough that a stuck run is measured in seconds.
     */
    private val minParkedMs: Long = MIN_PARKED_MS,
    private val batchSize: Int = 25,
    private val maxAttempts: Int = MAX_ATTEMPTS,
) {
    private val log = logger()
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "resume-reconciler").also { it.isDaemon = true }
    }
    private var future: ScheduledFuture<*>? = null

    companion object {
        val SWEEP_INTERVAL_MS: Long =
            System.getenv("RESUME_RECONCILER_INTERVAL_MS")?.toLongOrNull() ?: 30_000L
        val MIN_PARKED_MS: Long =
            System.getenv("RESUME_RECONCILER_MIN_PARKED_MS")?.toLongOrNull() ?: 20_000L
        val MAX_ATTEMPTS: Int =
            System.getenv("RESUME_RECONCILER_MAX_ATTEMPTS")?.toIntOrNull() ?: 6
        val ENABLED: Boolean =
            System.getenv("RESUME_RECONCILER_ENABLED")?.lowercase() != "false"
    }

    /** Why a run needs reconciling. The `reason` column, and a metric label. */
    enum class Reason(val wire: String) {
        APPROVAL_RESOLVED("approval_resolved"),
        CHILDREN_TERMINAL("children_terminal"),
        RECOVERING_STRANDED("recovering_stranded"),
        TIMER_FIRED("timer_fired"),
    }

    data class Stuck(
        val runId: UUID,
        val workspaceId: UUID,
        val workflowId: UUID,
        val reason: Reason,
        val attempts: Int,
    )

    fun start() {
        if (!ENABLED) {
            log.warn("[reconciler] DISABLED. A stored approval whose enqueue fails will strand " +
                "its run — this is the only thing that recovers it.")
            return
        }
        if (running.compareAndSet(false, true)) {
            future = executor.scheduleWithFixedDelay(
                ::tick, pollIntervalMs, pollIntervalMs, TimeUnit.MILLISECONDS)
            log.info("[reconciler] started (interval={}ms, minParked={}ms, maxAttempts={})",
                pollIntervalMs, minParkedMs, maxAttempts)
        }
    }

    fun stop() {
        running.set(false)
        future?.cancel(false)
        executor.shutdown()
    }

    /** One sweep. Public so a test can drive it without waiting for the schedule. */
    fun tick(): Int {
        return try {
            val stuck = findStuck()
            if (stuck.isEmpty()) return 0
            log.warn("[reconciler] {} run(s) parked with nothing coming: {}",
                stuck.size, stuck.groupingBy { it.reason.wire }.eachCount())
            stuck.count { reconcile(it) }
        } catch (e: Exception) {
            log.error("[reconciler] sweep failed: {}", e.message)
            0
        }
    }

    /**
     * Every run parked past [minParkedMs] whose reason to wait is already gone.
     *
     * ── ONE QUERY, FOUR PREDICATES ──────────────────────────────────────────
     * A UNION rather than four sweeps, so one index scan over the parked runs
     * answers all four questions and the batch limit means the same thing for
     * all of them. Four queries would let one noisy reason starve the others out
     * of every batch.
     *
     * The dead-letter filter is a LEFT JOIN rather than a NOT EXISTS so the
     * attempt count comes back in the same row — the caller needs it for the
     * backoff, and a second lookup per run would make a sweep O(batch) queries.
     */
    fun findStuck(): List<Stuck> = dataSource.connection.use { conn ->
        conn.prepareStatement(SWEEP_SQL).use { st ->
            st.setLong(1, minParkedMs)
            st.setLong(2, minParkedMs)
            st.setLong(3, minParkedMs)
            st.setLong(4, minParkedMs)
            st.setInt(5, maxAttempts)
            st.setInt(6, batchSize)
            st.executeQuery().use { rs ->
                val out = mutableListOf<Stuck>()
                while (rs.next()) out += Stuck(
                    runId = rs.getObject("id", UUID::class.java),
                    workspaceId = rs.getObject("workspace_id", UUID::class.java),
                    workflowId = rs.getObject("workflow_id", UUID::class.java),
                    reason = Reason.entries.first { it.wire == rs.getString("reason") },
                    attempts = rs.getInt("attempts"),
                )
                out
            }
        }
    }

    /**
     * Record the attempt, then enqueue.
     *
     * THAT ORDER, deliberately, and it is the opposite of the bug this class
     * exists for. The four broken paths all change durable state and then
     * enqueue, so a failed enqueue leaves state claiming the work is done. Here
     * the durable record is only ever "we tried", which is true whether or not
     * the enqueue succeeds — and if it fails, the count still went up, so the
     * retry budget is real rather than a number that resets on every crash.
     */
    private fun reconcile(s: Stuck): Boolean {
        val attempt = recordAttempt(s)
        if (attempt > maxAttempts) {
            deadLetter(s, "resume could not be enqueued after $maxAttempts attempts")
            return false
        }
        return try {
            enqueue(WorkflowRunJob(
                streamMessageId = "",
                jobType = WorkflowRunJob.JobType.RESUME_RUN,
                runId = s.runId,
                workflowId = s.workflowId,
                triggeredBy = "resume-reconciler:${s.reason.wire}",
                inputJson = "{}",
                retryCount = 0,
                nodeId = null,
                checkpointId = null,
                workspaceId = s.workspaceId,
            ))
            WorkerMetrics.resumeReconciled.inc(s.reason.wire)
            log.info("[reconciler] re-enqueued RESUME_RUN runId={} reason={} attempt={}",
                s.runId, s.reason.wire, attempt)
            true
        } catch (e: Exception) {
            recordError(s.runId, e.message?.take(500))
            WorkerMetrics.resumeReconcileFailed.inc(s.reason.wire)
            log.error("[reconciler] enqueue failed runId={} attempt={}/{}: {}",
                s.runId, attempt, maxAttempts, e.message)
            false
        }
    }

    /** Upsert the attempt row and return the new count. */
    private fun recordAttempt(s: Stuck): Int = dataSource.connection.use { conn ->
        conn.prepareStatement(
            """INSERT INTO run_resume_attempts (run_id, workspace_id, reason, attempts, last_attempt_at)
               VALUES (?,?,?,1,now())
               ON CONFLICT (run_id) DO UPDATE
                 SET attempts = run_resume_attempts.attempts + 1,
                     last_attempt_at = now(),
                     reason = EXCLUDED.reason
               RETURNING attempts"""
        ).use { st ->
            st.setObject(1, s.runId); st.setObject(2, s.workspaceId); st.setString(3, s.reason.wire)
            st.executeQuery().use { rs -> if (rs.next()) rs.getInt(1) else 1 }
        }
    }

    private fun recordError(runId: UUID, error: String?) = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement("UPDATE run_resume_attempts SET last_error=? WHERE run_id=?")
                .use { it.setString(1, error); it.setObject(2, runId); it.executeUpdate() }
        }
    }

    /**
     * Give up, loudly and durably.
     *
     * The row is KEPT and marked, not deleted: it is the only record that a run
     * was parked and could not be revived, and deleting it would return the run
     * to the next sweep and restart the whole cycle. The run stays parked rather
     * than being failed — a run that cannot be RESUMED has not necessarily
     * failed, and marking it so would tell a user their work was lost when it is
     * sitting there recoverable by hand.
     */
    private fun deadLetter(s: Stuck, why: String) = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "UPDATE run_resume_attempts SET dead_lettered_at=now(), last_error=? WHERE run_id=?"
            ).use { it.setString(1, why); it.setObject(2, s.runId); it.executeUpdate() }
        }
        WorkerMetrics.resumeDeadLettered.inc(s.reason.wire)
        log.error("[reconciler] DEAD-LETTERED runId={} reason={} — {}. The run is still parked " +
            "and can be resumed by hand; it will not be swept again.", s.runId, s.reason.wire, why)
    }
}

/**
 * The sweep.
 *
 * Each arm answers "is this run's reason to wait already gone?". They are
 * deliberately conservative — a run is only a candidate when the thing it waits
 * for has demonstrably resolved, so a healthy parked run is never touched.
 */
private val SWEEP_SQL = """
WITH parked AS (
    SELECT r.id, r.workspace_id, r.workflow_id, r.status, r.updated_at
      FROM agent_runs r
     WHERE r.status IN ('waiting_for_approval','waiting_for_child','recovering','waiting_for_timer')
),
candidates AS (
    -- 1. A decision is on file and the run is still waiting for it.
    SELECT p.id, p.workspace_id, p.workflow_id, 'approval_resolved' AS reason
      FROM parked p
     WHERE p.status = 'waiting_for_approval'
       AND p.updated_at < now() - make_interval(secs => ? / 1000.0)
       AND EXISTS (
             SELECT 1 FROM run_approvals a
              WHERE a.run_id = p.id
                AND a.status IN ('APPROVED','REJECTED','EXPIRED','CANCELLED'))

    UNION ALL

    -- 2. Every dispatched child has reached a terminal state, and the parent is
    --    still parked on them. A parent with NO children is excluded: it is
    --    waiting for children it has not created yet, which is a different bug
    --    and not one a resume fixes.
    SELECT p.id, p.workspace_id, p.workflow_id, 'children_terminal' AS reason
      FROM parked p
     WHERE p.status = 'waiting_for_child'
       AND p.updated_at < now() - make_interval(secs => ? / 1000.0)
       AND EXISTS (SELECT 1 FROM agent_runs c WHERE c.parent_run_id = p.id)
       AND NOT EXISTS (
             SELECT 1 FROM agent_runs c
              WHERE c.parent_run_id = p.id
                AND c.status NOT IN ('succeeded','failed','cancelled'))

    UNION ALL

    -- 3. CrashRecoveryLoop marked it 'recovering' and then failed to enqueue.
    --    Nothing scans this status, so without this arm the recovery loop can
    --    permanently strand the run it was rescuing.
    SELECT p.id, p.workspace_id, p.workflow_id, 'recovering_stranded' AS reason
      FROM parked p
     WHERE p.status = 'recovering'
       AND p.updated_at < now() - make_interval(secs => ? / 1000.0)

    UNION ALL

    -- 4. TimerScheduler marked the timer 'fired' and then failed to enqueue.
    --    findDueTimers requires 'scheduled', so it will never retry.
    SELECT p.id, p.workspace_id, p.workflow_id, 'timer_fired' AS reason
      FROM parked p
     WHERE p.status = 'waiting_for_timer'
       AND p.updated_at < now() - make_interval(secs => ? / 1000.0)
       AND EXISTS (
             SELECT 1 FROM workflow_timers t
              WHERE t.run_id = p.id AND t.status = 'fired')
)
SELECT c.id, c.workspace_id, c.workflow_id, c.reason,
       COALESCE(a.attempts, 0) AS attempts
  FROM candidates c
  LEFT JOIN run_resume_attempts a ON a.run_id = c.id
 WHERE a.dead_lettered_at IS NULL
   -- A FETCH FILTER, NOT THE BOUND. `reconcile` checks the attempt count after
   -- incrementing it, and that check is what actually stops the retry; a
   -- mutation test confirmed removing this line changes no outcome. It is kept
   -- because it keeps rows about to be dead-lettered out of the batch, which
   -- would otherwise crowd out runs that can still be rescued.
   AND COALESCE(a.attempts, 0) <= ?
 ORDER BY c.id
 LIMIT ?
""".trimIndent()
