package com.vectorbea.api.queue

import com.vectorbea.api.metrics.AppMetrics
import org.slf4j.LoggerFactory

/**
 * The queue, once the queue is a table.
 *
 * Enqueueing is a no-op here, and that is the whole point of §3. The caller has
 * already committed `agent_runs` with `status='queued'`, `execution_class` and
 * `fair_vtime`; that row **is** the queue entry. The `notify_run_queued()` trigger
 * added in V023 fires `pg_notify` on the same commit, so workers are woken by the
 * database rather than by a second write to a second system.
 *
 * WHAT THIS DELETES
 * -----------------
 * The two-system enqueue had a window nothing could close: the row commits, then
 * the XADD fails, and the run sits `queued` with no message until crash recovery
 * notices. `TypedStreamsWorkflowQueue` handles that by flipping the run to
 * `enqueue_failed` — correct, but it is handling a failure mode that only exists
 * because there were two systems. One write, one transaction, no window.
 *
 * MODES
 * -----
 * Selected by `QUEUE_MODE`:
 *
 *   `redis` (default)  [TypedStreamsWorkflowQueue] alone. Deploying this code
 *                      changes nothing until someone sets the variable.
 *   `dual`             both. New runs are visible to claim-mode workers *and*
 *                      mirrored onto the streams for workers not yet cut over.
 *                      Duplicate execution is prevented where it always was — a
 *                      run lease is an atomic compare-and-set, so whichever
 *                      transport arrives second loses.
 *   `postgres`         this alone. Redis keeps its real jobs: rate limiting,
 *                      caching, pub/sub for live run updates, distributed locks.
 */
class PostgresClaimQueue(
    /**
     * Set in `dual` mode. Every job is also written to its typed stream so a
     * worker still running `WORKER_CLAIM_MODE=redis` continues to see it.
     */
    private val mirror: WorkflowQueue? = null,
) : WorkflowQueue {

    private val log = LoggerFactory.getLogger(PostgresClaimQueue::class.java)

    override fun enqueue(job: WorkflowRunJob): String {
        AppMetrics.enqueuedByClass.inc(job.executionClass.wire, job.jobType.name)

        if (mirror == null) {
            // No message ID exists, because no message exists. The run id is the
            // stable handle for everything downstream, so return it rather than a
            // fabricated stream offset that would later be parsed as one.
            log.debug("[queue] run {} queued in Postgres (class={}) — no XADD",
                job.runId, job.executionClass.wire)
            return job.runId
        }

        // Dual mode: mirror onto the stream, best-effort.
        //
        // Best-effort is right this time, and is the reverse of the legacy mirror's
        // reasoning. There, the stream was authoritative and the mirror optional;
        // here the *row* is authoritative and already committed, so a failed XADD
        // costs nothing — a claim-mode worker picks the run up regardless. Failing
        // the trigger for it would be strictly worse than doing nothing.
        return try {
            mirror.enqueue(job)
        } catch (e: Exception) {
            log.warn("[queue] dual-mode mirror XADD failed for run {} — the run is " +
                "queued in Postgres and will still be claimed: {}", job.runId, e.message)
            job.runId
        }
    }

    companion object {
        /** `redis` · `dual` · `postgres`. Anything unrecognised reads as `redis`. */
        fun mode(): String = (System.getenv("QUEUE_MODE") ?: "redis").lowercase()
    }
}
