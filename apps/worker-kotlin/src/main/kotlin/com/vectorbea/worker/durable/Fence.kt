package com.vectorbea.worker.durable

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import java.util.UUID

/**
 * The authority a worker holds over one run, and the check that it still holds it.
 *
 * WHAT THIS PREVENTS
 * ------------------
 * A worker can lose its lease without noticing. It GC-pauses, or its network
 * blips, or it simply takes longer than the lease TTL; the lease expires, another
 * worker legitimately claims the run and starts executing. Now two workers
 * believe they own the same run, and the first one is still writing — appending
 * events, storing step outputs, moving the run's status.
 *
 * Fencing makes that impossible to do *silently*. Every write carries the lease
 * token, so a write from the fenced worker matches zero rows. Zero rows is not a
 * retryable error and must never be treated as one — it is the database saying
 * "you are not in charge of this run any more" (09 §6.3).
 *
 * THE RULE, AND IT HAS NO EXCEPTIONS
 * ----------------------------------
 * Zero rows affected means: **abandon the work, log it, do not retry, do not
 * write anywhere else.** Retrying would be a second worker fighting the rightful
 * owner. Writing "somewhere else" — an event, a metric row, a checkpoint — is the
 * same violation in a different table.
 *
 * [FencedOutException] exists so this cannot be swallowed by a `catch (e:
 * Exception)` that turns it into a retry. It is checked for explicitly at the
 * boundary and ends the run's processing on this worker.
 */
data class Fence(
    val runId: UUID,
    val workerId: String,
    /** The token from `run_leases`. Null only in tests and unfenced legacy paths. */
    val leaseToken: String?,
) {
    val isEnforced: Boolean get() = leaseToken != null

    companion object {
        private val log = logger("com.vectorbea.worker.durable.Fence")

        /** An unenforced fence, for tests and code paths that hold no lease. */
        fun unfenced(runId: UUID, workerId: String) = Fence(runId, workerId, null)
    }

    /**
     * Assert that a fenced write actually applied.
     *
     * @param rowsAffected what the UPDATE/INSERT returned
     * @param what         the table or operation, for the log and the metric
     * @throws FencedOutException when the write matched nothing and the fence is
     *         enforced — i.e. this worker has been superseded.
     */
    fun assertWrote(rowsAffected: Int, what: String) {
        if (rowsAffected > 0 || !isEnforced) return

        WorkerMetrics.fencedWriteTotal.inc(what)
        log.warn(
            "[fence] FENCED OUT on '{}' [runId={}, worker={}] — another worker holds this lease. " +
                "Abandoning: no retry, no further writes.",
            what, runId, workerId,
        )
        throw FencedOutException(runId, workerId, what)
    }

    /**
     * Non-throwing variant, for best-effort writes where losing the race is
     * expected and harmless — a run event appended during shutdown, say.
     * Still counted, because a rising rate means the same thing either way.
     *
     * @return true if the write applied.
     */
    fun observedWrite(rowsAffected: Int, what: String): Boolean {
        if (rowsAffected > 0) return true
        if (isEnforced) {
            WorkerMetrics.fencedWriteTotal.inc(what)
            log.debug("[fence] fenced write on '{}' [runId={}] — skipped", what, runId)
        }
        return false
    }
}

/**
 * Thrown when a write is rejected because the worker no longer holds the lease.
 *
 * Deliberately not an `IOException` or anything a retry loop would recognise:
 * this is not a transient failure and retrying it is exactly the wrong response.
 * The correct handling is to stop processing the run on this worker and let the
 * worker that legitimately holds the lease continue.
 */
class FencedOutException(
    val runId: UUID,
    val workerId: String,
    val operation: String,
) : Exception(
    "Worker $workerId was fenced out of run $runId during '$operation' — " +
        "another worker holds the lease. Work abandoned, not retried."
)
