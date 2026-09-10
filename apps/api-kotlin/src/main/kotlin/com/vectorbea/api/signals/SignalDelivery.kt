package com.vectorbea.api.signals

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.mapper
import com.vectorbea.api.queue.ExecutionClass
import com.vectorbea.api.queue.JobType
import com.vectorbea.api.queue.WorkflowQueue
import com.vectorbea.api.queue.WorkflowRunJob
import com.vectorbea.api.rate.RateLimitResult
import com.vectorbea.api.rate.RateLimiter
import com.vectorbea.worker.durable.wait.RunWait
import com.vectorbea.worker.durable.wait.SignalStore
import com.vectorbea.worker.durable.wait.WaitStore
import java.util.UUID
import javax.sql.DataSource

/**
 * Getting information into a live run, once.
 *
 * ── WHY THIS IS NOT INSIDE `SignalRoutes` ANY MORE ──────────────────────────
 * Because there is now a second caller. `RunIngress` needs it: a workflow whose
 * deduplication policy is `join` turns a second alert for a service into a
 * signal on the incident run that is already open, and that is the same
 * delivery — append durably, resolve a matching wait by CAS, enqueue the resume.
 *
 * Reimplementing three of those four steps at the ingress is the failure this
 * codebase keeps writing down: `WorkflowScheduler` reimplemented the half of
 * admission it remembered and scheduled runs skipped every plan check for
 * months. The half that would have been forgotten here is the WAKE — a joined
 * signal would land in `run_signals` and the run would sit parked on
 * `waiting_for_event` until the reconciler swept it, minutes later, for an
 * incident. It would have looked like it worked.
 *
 * ── AND WHY THE RATE LIMIT LIVES HERE, NOT AT THE ROUTE ─────────────────────
 * An unbounded signal stream is a denial of service against one run, and the
 * ingress join path does not pass through the run-creation limiter at all — a
 * `join` deliberately decides BEFORE the idempotency claim and before admission,
 * because it starts nothing. So the limit has to sit on the delivery itself, or
 * a flapping check with one dedup key is an unlimited signal firehose into one
 * run through an endpoint that never counts it.
 */
class SignalDelivery(
    private val dataSource: DataSource,
    private val signals: SignalStore,
    private val waits: WaitStore,
    private val queue: WorkflowQueue?,
    private val rateLimiter: RateLimiter?,
) {

    /**
     * What happened, in the terms the caller has to answer in.
     *
     * The `SendResult` is passed through rather than collapsed to a boolean:
     * the route turns each into a distinct status code, and the ingress needs to
     * tell "delivered" from "the run finished underneath me", because the second
     * one means it should start a run after all.
     */
    data class Outcome(
        val result: SignalStore.SendResult,
        /** The wait this signal resolved, if the run was parked on one. */
        val resolvedWaitId: UUID? = null,
    ) {
        /** True when the run has the information — including as a duplicate. */
        val delivered: Boolean
            get() = result is SignalStore.SendResult.Accepted ||
                result is SignalStore.SendResult.Duplicate
    }

    /**
     * Append the signal, resolve a wait if one matches, and wake the run.
     *
     * Throws only [ApiError.TooManyRequests], from the limiter. Everything else
     * is reported in the [Outcome]: a signal to a finished run is an answer, not
     * an exception, and both callers have something sensible to do with it.
     */
    fun deliver(
        runId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        name: String,
        payloadJson: String,
        sentByUserId: UUID? = null,
        sentByApiKeyId: UUID? = null,
        source: String,
        dedupeKey: String? = null,
    ): Outcome {
        enforceRateLimit(workspaceId, runId)

        val result = signals.send(
            runId = runId,
            workspaceId = workspaceId,
            environmentId = environmentId,
            name = name,
            payloadJson = payloadJson,
            sentByUserId = sentByUserId,
            sentByApiKeyId = sentByApiKeyId,
            source = source,
            dedupeKey = dedupeKey?.take(200),
        )

        return if (result is SignalStore.SendResult.Accepted)
            Outcome(result, wakeIfParked(runId, workspaceId, name, result.signal))
        else Outcome(result)
    }

    /**
     * Bound the stream.
     *
     * ── AN UNBOUNDED SIGNAL STREAM IS A DENIAL OF SERVICE AGAINST ONE RUN ───
     * Every signal to a parked run resolves a wait and enqueues a resume, and
     * every signal to a running run is read at its next step boundary. A caller
     * in a loop could therefore make one run consume a worker permanently while
     * making no progress — and the run is a tenant's own, so a global limit would
     * not catch it.
     *
     * The limit is therefore PER RUN as well as per workspace: a busy workspace
     * with a hundred runs is fine, and a hundred signals into one run is not.
     */
    fun enforceRateLimit(workspaceId: UUID, runId: UUID) {
        val limiter = rateLimiter ?: return
        listOf(
            "signal:run:$runId" to PER_RUN_PER_MINUTE,
            "signal:ws:$workspaceId" to PER_WORKSPACE_PER_MINUTE,
        ).forEach { (key, max) ->
            val result = limiter.check(key, max, 60)
            if (result is RateLimitResult.Exceeded) {
                throw ApiError.TooManyRequests(
                    if (key.startsWith("signal:run:"))
                        "This run has received $max signals in the last minute, which is its " +
                            "limit. A run that spends its time taking delivery makes no progress."
                    else
                        "This workspace has sent $max signals in the last minute, which is its limit.",
                    mapOf("retryAfterSeconds" to result.resetsInSeconds, "limit" to max),
                )
            }
        }
    }

    /**
     * Resolve a matching wait, and wake the run.
     *
     * ── THE CAS DECIDES, NOT THIS CODE ──────────────────────────────────────
     * `waitsForSignal` can return several — a run may hold more than one wait on
     * the same name across branches — and `resolve` is a compare-and-set on
     * `status = 'waiting'`. The first one that wins is the one this signal
     * satisfies; the rest are untouched and keep waiting for their own. Two
     * signals racing to satisfy one wait is the same story from the other side:
     * one wins, one is stored for the step boundary.
     *
     * The signal is marked CONSUMED only when a wait actually resolved. Otherwise
     * it stays pending and is delivered at the next step boundary, which is what
     * the run needs — and is why a signal sent to a running run is never lost.
     */
    private fun wakeIfParked(
        runId: UUID,
        workspaceId: UUID,
        name: String,
        signal: SignalStore.Signal,
    ): UUID? {
        val candidates = runCatching { waits.waitsForSignal(runId, name) }.getOrDefault(emptyList())
        for (wait in candidates) {
            val payload = mapper.writeValueAsString(
                mapOf("signal" to name, "sequence" to signal.sequence,
                      "payload" to runCatching { mapper.readValue(signal.payloadJson, Any::class.java) }
                          .getOrDefault(emptyMap<String, Any>()))
            )
            if (!waits.resolve(
                    wait.id,
                    RunWait.Resolution.SIGNAL,
                    payload,
                    "signal:$name",
                )
            ) continue

            signals.consume(listOf(signal.id), wait.id)

            /*
             * Best-effort, and covered. The wait is already durably resolved, so a
             * lost enqueue is exactly the shape `ResumeReconciler`'s
             * `wait_resolved` arm exists for — the same failure the reconciler was
             * built after four other paths got it wrong.
             */
            runCatching {
                queue?.enqueue(resumeJobFor(wait, workspaceId, "signal"))
            }
            return wait.id
        }
        return null
    }

    /**
     * The resume job for a run woken by a signal.
     *
     * `executionClass` is READ from the run rather than re-derived: a
     * continuation belongs on the same stream as the run it continues, and
     * defaulting it to the system pool would take a slot that timer resumes and
     * cancellations need to stay unstarvable. `ApprovalRoutes` makes exactly this
     * argument for exactly this reason.
     */
    private fun resumeJobFor(
        wait: RunWait,
        workspaceId: UUID,
        reason: String,
    ): WorkflowRunJob {
        val details = runDetails(wait.runId, workspaceId)
        return WorkflowRunJob(
            runId = wait.runId.toString(),
            workspaceId = workspaceId.toString(),
            environmentId = wait.environmentId.toString(),
            workflowId = details.first,
            workflowVersionId = details.second,
            jobType = JobType.RESUME_RUN,
            reason = reason,
            executionClass = ExecutionClass.fromWire(details.third),
        )
    }

    private fun runDetails(runId: UUID, workspaceId: UUID): Triple<String, String, String?> =
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                "SELECT workflow_id, workflow_version_id, execution_class " +
                    "FROM agent_runs WHERE id = ? AND workspace_id = ?"
            ).use { st ->
                st.setObject(1, runId); st.setObject(2, workspaceId)
                st.executeQuery().use { rs ->
                    if (rs.next()) Triple(
                        rs.getString("workflow_id"),
                        rs.getString("workflow_version_id"),
                        rs.getString("execution_class"),
                    ) else Triple(runId.toString(), runId.toString(), null)
                }
            }
        }

    companion object {
        val PER_RUN_PER_MINUTE: Long =
            System.getenv("SIGNAL_RATE_PER_RUN_PER_MIN")?.toLongOrNull() ?: 60
        val PER_WORKSPACE_PER_MINUTE: Long =
            System.getenv("SIGNAL_RATE_PER_WORKSPACE_PER_MIN")?.toLongOrNull() ?: 600
    }
}
