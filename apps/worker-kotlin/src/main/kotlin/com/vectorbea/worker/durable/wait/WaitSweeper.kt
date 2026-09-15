package com.vectorbea.worker.durable.wait

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.observability.metrics.ScheduledJobHealth
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.net.OutboundHttp
import com.vectorbea.worker.queue.WorkflowRunJob
import com.vectorbea.worker.tools.http.AsyncToolProtocol
import com.vectorbea.worker.tools.http.ResponseExtractor
import com.vectorbea.worker.tools.httpspec.HttpToolSpec
import java.net.URI
import java.net.http.HttpRequest
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.sql.DataSource

/**
 * Polls what needs polling, and gives up on what has run out of time.
 *
 * ── THE ACCEPTANCE CRITERION THIS IS ────────────────────────────────────────
 * "A callback that never arrives times out with a legible reason, not a
 * permanently parked run." Nothing else in the system can produce that: a
 * callback is by definition something that did not happen, so the only thing
 * that can notice is a sweep.
 *
 * ── TWO JOBS, ONE SWEEP, FOR THE RECONCILER'S REASON ────────────────────────
 * Polling and timing out are the same query — "waits whose next thing is due" —
 * and splitting them into two loops would mean two schedules, two lock
 * acquisitions and two chances for one to be disabled while the other runs. The
 * reconciler made this argument first and it holds here.
 *
 * ── AND IT DOES NOT DUPLICATE THE RECONCILER ────────────────────────────────
 * This resolves waits. `ResumeReconciler` re-enqueues runs whose resume was
 * lost. They overlap by one line — this enqueues a resume after resolving, and
 * if that enqueue fails the reconciler's `wait_resolved` arm picks it up. That
 * is the same durable-state-then-best-effort-enqueue shape the reconciler exists
 * for, so it is handled the same way rather than made an exception.
 */
class WaitSweeper(
    private val dataSource: DataSource,
    private val waits: WaitStore,
    private val enqueue: (WorkflowRunJob) -> Unit,
    private val connectionResolver: ConnectionResolver? = null,
    private val pollIntervalMs: Long = SWEEP_INTERVAL_MS,
    private val batchSize: Int = 50,
) {
    private val log = logger()
    private val mapper = ObjectMapper()
    private val running = AtomicBoolean(false)
    private val executor = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "wait-sweeper").also { it.isDaemon = true }
    }
    private var future: ScheduledFuture<*>? = null

    companion object {
        const val JOB_NAME = "wait-sweeper"

        val SWEEP_INTERVAL_MS: Long =
            System.getenv("WAIT_SWEEPER_INTERVAL_MS")?.toLongOrNull() ?: 15_000L
        val ENABLED: Boolean =
            System.getenv("WAIT_SWEEPER_ENABLED")?.lowercase() != "false"

        /** A poll response is small by construction. A large one is a wrong URL. */
        private const val POLL_RESPONSE_LIMIT = 256L * 1024
        private const val POLL_TIMEOUT_MS = 15_000L
    }

    fun start() {
        if (!ENABLED) {
            log.warn("[wait-sweeper] DISABLED. A callback that never arrives will park its " +
                "run until something else notices — this is the thing that notices.")
            return
        }
        if (running.compareAndSet(false, true)) {
            ScheduledJobHealth.register(JOB_NAME, pollIntervalMs)
            future = executor.scheduleWithFixedDelay(
                { ScheduledJobHealth.record(JOB_NAME) { tick() } },
                pollIntervalMs, pollIntervalMs, TimeUnit.MILLISECONDS)
            log.info("[wait-sweeper] started (interval={}ms)", pollIntervalMs)
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
            val due = waits.dueWaits(batchSize)
            if (due.isEmpty()) return 0
            var handled = 0
            for (wait in due) {
                handled += if (isExpired(wait)) {
                    if (expire(wait)) 1 else 0
                } else {
                    if (poll(wait)) 1 else 0
                }
            }
            handled
        } catch (e: Exception) {
            log.error("[wait-sweeper] sweep failed: {}", e.message)
            ScheduledJobHealth.markPassFailed()
            0
        }
    }

    private fun isExpired(wait: RunWait): Boolean {
        val deadline = wait.timeoutAt ?: return false
        if (!deadline.isBefore(java.time.Instant.now())) return false
        return true
    }

    /**
     * Give up, with a reason somebody can act on.
     *
     * ── WHAT MAKES IT LEGIBLE ───────────────────────────────────────────────
     * The message names the job handle when there is one, says how long it
     * waited, and says whether anything was ever polled. "This tool waited six
     * minutes and the provider never called back (job `vid_8812`); 0 polls were
     * attempted because the tool declares no status URL" is a sentence somebody
     * can act on. "The run timed out" is not.
     */
    private fun expire(wait: RunWait): Boolean {
        val waitedMs = java.time.Duration.between(wait.createdAt, java.time.Instant.now()).toMillis()
        val why = buildString {
            /*
             * The ELAPSED time and the DEADLINE, separately.
             *
             * These were one number — "within the wait's ${'$'}{elapsed}s limit" — which
             * reads correctly only when they happen to agree. They do not when an
             * operator shortens a deadline on a wait already parked, and they did
             * not in the test that found this: a wait created seconds ago whose
             * deadline had passed reported "the wait's 0s limit", which is both
             * wrong and the sort of number that sends somebody looking for a
             * configuration bug that is not there.
             */
            append("Waited ${waitedMs / 1000}s")
            wait.timeoutAt?.let { append(", past a deadline of $it") }
            append(". ")
            when (wait.kind) {
                WaitKind.ASYNC_TOOL -> {
                    wait.externalRef?.let { append("The provider's job id was $it. ") }
                    append(
                        if (wait.pollUrl != null)
                            "It was polled ${wait.pollAttempts} time(s) and never reported " +
                                "completion. The job may still be running at the provider."
                        else if (wait.callbackToken != null)
                            "This tool relies on a completion callback and none arrived. " +
                                "Check that the provider can reach this deployment, or give " +
                                "the tool a status URL to poll as a fallback."
                        else
                            "This tool declared no way to check on the job."
                    )
                }

                WaitKind.SIGNAL, WaitKind.AGENT_WAIT ->
                    append("No '${wait.signalName ?: "matching"}' signal was sent to this run. " +
                        "Send one with POST /api/runs/{id}/signals, or raise the wait's timeout.")

                WaitKind.APPROVAL ->
                    append("Nobody decided the approval in time.")
            }
        }

        if (!waits.timeOut(wait.id, why)) {
            /* Lost the race: a callback or a poll resolved it in the moment
               between the sweep reading it and this write. Correct outcome, and
               the run is already being resumed by the winner. */
            return false
        }

        waits.recordWaitedTime(wait.runId, waitedMs)
        WorkerMetrics.runSuspendedTotal.inc("${wait.kind.wire}_timeout")
        log.warn("[wait-sweeper] TIMED OUT wait={} kind={} run={} after={}ms — {}",
            wait.id, wait.kind.wire, wait.runId, waitedMs, why)
        emitTimeout(wait, why, waitedMs)
        resumeRun(wait, "wait_timeout")
        return true
    }

    /**
     * Ask the provider whether it is done.
     *
     * ── THE CLAIM COMES FIRST ───────────────────────────────────────────────
     * `claimPoll` moves `poll_next_at` forward before the request goes out, so
     * two workers sweeping the same second do not both poll. A worker that
     * crashes after claiming costs one delayed poll, which is the right way for
     * this to fail.
     */
    private fun poll(wait: RunWait): Boolean {
        val url = wait.pollUrl ?: return false

        if (wait.pollMaxAttempts != null && wait.pollAttempts >= wait.pollMaxAttempts) {
            /*
             * Out of polls but not out of time. The wait is NOT resolved here: its
             * deadline is the authority on when to give up, and a callback may
             * still arrive. What stops is the polling — `poll_next_at` is cleared
             * so this wait leaves the sweep's poll arm and is only picked up again
             * when it expires.
             */
            stopPolling(wait.id)
            log.info("[wait-sweeper] poll budget spent wait={} attempts={} — waiting on the " +
                "callback or the deadline now", wait.id, wait.pollAttempts)
            return false
        }

        if (!waits.claimPoll(wait.id)) return false

        val response = try {
            val builder = HttpRequest.newBuilder().uri(URI.create(url))
            applyPollAuth(wait, builder)
            builder.method("GET", HttpRequest.BodyPublishers.noBody())
            OutboundHttp.send(builder, totalCallMs = POLL_TIMEOUT_MS,
                maxResponseBytes = POLL_RESPONSE_LIMIT)
        } catch (e: Exception) {
            /*
             * A failed poll is not a failed job. The provider may be briefly
             * unreachable while the render is going perfectly well, so this is
             * logged and left: the next poll is already scheduled and the deadline
             * is still the backstop.
             */
            log.info("[wait-sweeper] poll failed wait={} attempt={}: {} — will retry",
                wait.id, wait.pollAttempts + 1, e.javaClass.simpleName)
            return false
        }

        if (response.statusCode !in 200..299) {
            log.info("[wait-sweeper] poll returned HTTP {} wait={} — will retry",
                response.statusCode, wait.id)
            return false
        }

        val body = runCatching { mapper.readTree(response.body) }.getOrNull() ?: return false
        val spec = pollSpecOf(wait) ?: return false

        return when (AsyncToolProtocol.verdictOf(
            body, spec.statusPath, spec.completedValues, spec.failedValues)) {
            AsyncToolProtocol.Verdict.STILL_WORKING -> false

            AsyncToolProtocol.Verdict.COMPLETED -> {
                val payload = AsyncToolProtocol.payloadAt(body, spec.resultPath)
                if (waits.resolve(wait.id, RunWait.Resolution.COMPLETED,
                        mapper.writeValueAsString(payload), "wait-sweeper:poll")) {
                    finish(wait, "completed")
                    true
                } else false
            }

            AsyncToolProtocol.Verdict.FAILED -> {
                val message = spec.errorPath
                    ?.let { ResponseExtractor.atPath(body, it)?.asText() }
                    ?: "The provider reported that the job failed."
                if (waits.resolve(wait.id, RunWait.Resolution.FAILED,
                        mapper.writeValueAsString(mapOf("error" to message.take(1_000))),
                        "wait-sweeper:poll")) {
                    finish(wait, "failed")
                    true
                } else false
            }
        }
    }

    /**
     * Authenticate the poll with the connection the submit used.
     *
     * The sweeper runs long after the step that submitted, so nothing is
     * inherited: the connection is resolved fresh and its credential applied,
     * exactly as the resolver did. Without a connection resolver — a worker built
     * without one, which happens only in tests — the poll goes out unauthenticated
     * and will usually 401, which is logged and retried rather than treated as a
     * failed job.
     */
    private fun applyPollAuth(wait: RunWait, builder: HttpRequest.Builder) {
        val connectionId = wait.pollConnectionId ?: return
        val resolver = connectionResolver ?: return
        runCatching {
            val resolved = resolver.resolve(connectionId, wait.workspaceId, expectedType = "http")
            resolved.secret?.takeIf { !it.isCleared() }?.useOnce { raw ->
                /* The legacy mapping, deliberately: the poll must send whatever the
                   submit sent, and the submit used the connection's own auth type
                   when the spec said `inherit`. A poll authenticating differently
                   from its submit is a 401 that looks like a lost job. */
                when (val auth = com.vectorbea.worker.tools.httpspec.HttpAuthSpec
                    .fromLegacyAuthType(resolved.record.authType,
                        resolved.record.configJson["username"] as? String)) {
                    is com.vectorbea.worker.tools.httpspec.HttpAuthSpec.ApiKeyHeader ->
                        builder.header(auth.header, raw)
                    is com.vectorbea.worker.tools.httpspec.HttpAuthSpec.Bearer ->
                        builder.header(auth.header, "${auth.prefix} $raw".trim())
                    is com.vectorbea.worker.tools.httpspec.HttpAuthSpec.Basic ->
                        builder.header("Authorization", "Basic " + java.util.Base64.getEncoder()
                            .encodeToString("${auth.username}:$raw".toByteArray()))
                    else -> Unit
                }
            }
        }.onFailure {
            log.debug("[wait-sweeper] could not authenticate poll for wait {}: {}",
                wait.id, it.javaClass.simpleName)
        }
    }

    /** The poll rules, read back off the wait's metadata. */
    private fun pollSpecOf(wait: RunWait): HttpToolSpec.PollSpec? = runCatching {
        val meta = mapper.readTree(
            dataSource.connection.use { conn ->
                conn.prepareStatement("SELECT metadata_json FROM run_waits WHERE id = ?")
                    .use { st -> st.setObject(1, wait.id)
                        st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else "{}" } }
            }
        )
        val poll = meta.get("poll") ?: return@runCatching HttpToolSpec.PollSpec(url = wait.pollUrl ?: "")
        HttpToolSpec.PollSpec(
            url = wait.pollUrl ?: "",
            statusPath = poll.path("statusPath").asText("status"),
            completedValues = poll.path("completedValues").map { it.asText().lowercase() }
                .ifEmpty { listOf("succeeded", "completed", "success", "done", "finished") },
            failedValues = poll.path("failedValues").map { it.asText().lowercase() }
                .ifEmpty { listOf("failed", "error", "cancelled", "canceled", "expired") },
            resultPath = poll.get("resultPath")?.asText()?.takeIf { it.isNotBlank() },
            errorPath = poll.get("errorPath")?.asText()?.takeIf { it.isNotBlank() },
        )
    }.getOrNull()

    private fun stopPolling(waitId: UUID) = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "UPDATE run_waits SET poll_next_at = NULL, updated_at = now() WHERE id = ?"
            ).use { st -> st.setObject(1, waitId); st.executeUpdate() }
        }
    }

    private fun finish(wait: RunWait, outcome: String) {
        val waitedMs = java.time.Duration.between(wait.createdAt, java.time.Instant.now()).toMillis()
        waits.recordWaitedTime(wait.runId, waitedMs)
        log.info("[wait-sweeper] RESOLVED wait={} kind={} run={} outcome={} after={}ms",
            wait.id, wait.kind.wire, wait.runId, outcome, waitedMs)
        resumeRun(wait, "wait_$outcome")
    }

    /**
     * Wake the run.
     *
     * Best-effort, and the failure is covered: the wait is already durably
     * resolved, so `ResumeReconciler`'s `wait_resolved` arm finds a run parked on
     * a wait that is no longer waiting and re-enqueues. That is the same
     * durable-state-then-enqueue shape the reconciler exists for, handled the
     * same way rather than made an exception.
     */
    private fun resumeRun(wait: RunWait, reason: String) {
        runCatching {
            enqueue(WorkflowRunJob(
                streamMessageId = "",
                jobType = WorkflowRunJob.JobType.RESUME_RUN,
                runId = wait.runId,
                workflowId = wait.workflowId ?: wait.runId,
                triggeredBy = "wait-sweeper:$reason",
                inputJson = "{}",
                retryCount = 0,
                nodeId = null,
                checkpointId = null,
                workspaceId = wait.workspaceId,
            ))
        }.onFailure {
            log.error("[wait-sweeper] resume enqueue failed run={} — the reconciler will " +
                "backstop: {}", wait.runId, it.message)
        }
    }

    private fun emitTimeout(wait: RunWait, why: String, waitedMs: Long) = runCatching {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """INSERT INTO run_events
                     (run_id, workspace_id, environment_id, type, status, source,
                      title, summary, step_id, duration_ms)
                   VALUES (?,?,?,?,?,?,?,?,?,?)"""
            ).use { st ->
                st.setObject(1, wait.runId)
                st.setObject(2, wait.workspaceId)
                st.setObject(3, wait.environmentId)
                st.setString(4, "RUN_WAIT_TIMED_OUT")
                st.setString(5, "failed")
                st.setString(6, "wait-sweeper")
                st.setString(7, "Wait timed out: ${wait.label ?: wait.kind.wire}")
                st.setString(8, why.take(1_000))
                st.setString(9, wait.nodeId)
                st.setLong(10, waitedMs)
                st.executeUpdate()
            }
        }
    }.onFailure {
        /* The timeout is already durable on the wait row and the run is being
           resumed; a missing timeline entry is a degraded trace, not a lost
           outcome. Logged so it is not silent. */
        log.warn("[wait-sweeper] could not write timeout event for run {}: {}",
            wait.runId, it.message)
    }
}
