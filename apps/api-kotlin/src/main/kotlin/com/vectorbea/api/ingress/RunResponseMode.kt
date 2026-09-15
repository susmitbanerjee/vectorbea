package com.vectorbea.api.ingress

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.repository.AgentRun
import com.vectorbea.api.repository.RunRepository
import org.slf4j.LoggerFactory
import java.time.Duration
import java.util.UUID

/**
 * How the caller wants the answer.
 *
 * ── THREE MODES BECAUSE THERE ARE THREE CALLERS ─────────────────────────────
 * Not three flavours of the same thing. Each exists because the other two are
 * wrong for somebody:
 *
 *   ASYNC   The default, and the only honest one for work that takes minutes.
 *           Returns an id. Everything else is a poll or a stream away.
 *
 *   SYNC    Someone is awaiting a function call. They want a value, and a run
 *           id is not a value — it is homework. This mode is what makes a
 *           Vectorbea workflow usable inside an `await`, which is the shape
 *           every SDK, every serverless handler and every MCP tool call has.
 *
 *   STREAM  Someone is watching. A progress bar cannot be built from a final
 *           result, and polling for one produces a UI that lurches.
 *
 * ── SYNC DEGRADES, IT DOES NOT HANG ─────────────────────────────────────────
 * The one rule that makes sync safe: past its deadline it returns the run id
 * with 202, exactly as async would. It never holds the connection open hoping.
 * A caller who asked for sync and got 202 has lost nothing — they hold the same
 * id async would have given them immediately, and every other endpoint works on
 * it. Hanging instead would burn one of their connection-pool slots and one of
 * ours until a proxy killed it, which is how a slow workflow becomes an outage
 * in a caller's unrelated service.
 */
enum class RunResponseMode(val wire: String) {
    ASYNC("async"),
    SYNC("sync"),
    STREAM("stream");

    companion object {
        private val BY_WIRE = entries.associateBy { it.wire }

        /**
         * Read the requested mode.
         *
         * @throws ApiError.ValidationError for a value that is not one of the
         *   three. Falling back to async would silently ignore a caller who
         *   typed `synchronous` and leave them waiting for a result that is
         *   never coming.
         */
        fun parse(value: String?): RunResponseMode {
            if (value.isNullOrBlank()) return ASYNC
            return BY_WIRE[value.lowercase()] ?: throw ApiError.ValidationError(
                "`mode` must be one of ${entries.joinToString(", ") { it.wire }}."
            )
        }
    }
}

/**
 * Waits for a run to finish, for as long as the caller is willing to.
 *
 * ── WHY THIS POLLS ──────────────────────────────────────────────────────────
 * There is a Redis pub/sub channel per run and the SSE endpoint uses it. This
 * does not, deliberately: sync mode has to work when Redis is down, because it
 * is the mode a customer's production code path depends on, and degrading it to
 * "cannot wait right now" during a cache outage would take their service down
 * with ours. Polling one indexed row every 250 ms for at most a minute is
 * cheap, and it is the same read the caller would be doing themselves.
 *
 * The interval backs off, because most runs that are not done in two seconds
 * are not done in ten either, and a caller waiting sixty seconds should not
 * cost 240 queries.
 */
class SyncRunWaiter(private val runRepo: RunRepository) {

    private val log = LoggerFactory.getLogger(SyncRunWaiter::class.java)

    companion object {
        /** Terminal statuses. A run in one of these will not change again. */
        val TERMINAL = setOf(
            "succeeded", "completed", "failed", "cancelled", "timed_out",
            "enqueue_failed", "ceiling_exceeded",
        )

        val DEFAULT_TIMEOUT: Duration = Duration.ofSeconds(30)

        /**
         * The longest a caller may ask to wait.
         *
         * Bounded by what sits in front of this API, not by taste: load
         * balancers and reverse proxies idle out around 60 s, and a limit above
         * the proxy's would produce a dropped connection instead of a clean 202
         * — the caller loses the run id and has no way to find their run.
         */
        val MAX_TIMEOUT: Duration = Duration.ofSeconds(55)

        private val FIRST_INTERVAL = Duration.ofMillis(100)
        private val MAX_INTERVAL = Duration.ofMillis(1_000)
    }

    /** What the wait produced. */
    sealed interface Outcome {
        /** The run reached a terminal state within the deadline. */
        data class Finished(val run: AgentRun) : Outcome

        /**
         * The deadline passed first. The run is still going, and the caller gets
         * its id — the async answer, arrived at late.
         */
        data class StillRunning(val run: AgentRun?, val waitedMs: Long) : Outcome
    }

    /**
     * @param requested what the caller asked for; clamped, not rejected. Asking
     *   for five minutes is a reasonable thing to want and an unreasonable thing
     *   to get, and refusing the request outright teaches nothing — the response
     *   says how long it actually waited.
     */
    fun await(runId: UUID, workspaceId: UUID, requested: Duration?): Outcome {
        val budget = (requested ?: DEFAULT_TIMEOUT).coerceIn(Duration.ofMillis(1), MAX_TIMEOUT)
        val startedAt = System.nanoTime()
        val deadline = startedAt + budget.toNanos()

        var interval = FIRST_INTERVAL
        var last: AgentRun? = null

        while (true) {
            last = runCatching { runRepo.findById(runId, workspaceId) }.getOrElse {
                /* A read failure is not a reason to lie about the outcome. Hand
                   back the id and let the caller poll — the run is unaffected. */
                log.warn("[sync] run read failed for {}: {}", runId, it.message)
                null
            }
            if (last != null && last.status in TERMINAL) return Outcome.Finished(last)

            val remaining = deadline - System.nanoTime()
            if (remaining <= 0) break

            val sleepNanos = minOf(interval.toNanos(), remaining)
            try {
                Thread.sleep(sleepNanos / 1_000_000, (sleepNanos % 1_000_000).toInt())
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
                break
            }
            interval = minOf(interval.multipliedBy(2), MAX_INTERVAL)
        }

        return Outcome.StillRunning(last, (System.nanoTime() - startedAt) / 1_000_000)
    }
}
