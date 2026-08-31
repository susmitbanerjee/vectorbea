package com.vectorbea.worker.durable.archive

import java.time.Duration
import java.time.Instant
import java.util.UUID

/**
 * Which runs' spans reach the warm tier, and which are sampled out.
 *
 * ── WHY THIS IS A RETENTION DECISION AND NOT A WRITE-TIME ONE ───────────────
 * The obvious place to sample is `SpanWriter.emit` — drop the span and never pay
 * for the row. It cannot satisfy the rule that matters:
 *
 *     "NEVER sample a run that had a failed step, an approval, or a budget clamp."
 *
 * At write time, the span that proves a run was interesting arrives AFTER the
 * spans that would already have been dropped. A run can look ordinary for
 * twenty-nine minutes and fail in the thirtieth, and by then the evidence
 * explaining the failure is gone — which is precisely the run somebody is about
 * to ask about. No latch, grace window or buffer fixes that; the information
 * simply does not exist yet when the decision has to be made.
 *
 * Deciding at the ARCHIVE boundary makes the rule absolute, because by then the
 * run has finished and every fact about it is known. It also keeps the other
 * §12.1 rule intact: nothing is ever DELETEd from Postgres. Sampling reduces what
 * is written to the warm tier; the hot tier still holds everything until its
 * partition is dropped whole.
 *
 * The cost is honest and worth naming: this does NOT reduce span write volume in
 * Postgres. That is what batching, payload offload and content addressing are
 * for.
 *
 * ── DETERMINISTIC, BECAUSE THE EXPORT IS RETRYABLE ──────────────────────────
 * The decision is a hash of the run id, never a random draw. An export that
 * crashes half way is retried, and a sampler that flipped a coin would produce a
 * different file the second time — so the object and the row count recorded
 * beside it would disagree, and no reader could tell which was wrong.
 */
class TraceSampler(
    /** Per-workspace keep rate, 0.0–1.0. Missing means keep everything. */
    private val rateFor: (UUID) -> Double,
    /**
     * Runs younger than this are always kept.
     *
     * "100% of runs under 60s old" — a run created a minute ago is one somebody
     * is probably looking at right now, and it may not even have finished.
     */
    private val graceWindow: Duration = Duration.ofSeconds(
        System.getenv("TRACE_SAMPLE_GRACE_SECONDS")?.toLongOrNull() ?: 60L),
    /**
     * Below this duration a successful run is kept regardless of rate.
     *
     * "Sample successful LONG runs". Short runs are the bulk by count and a
     * rounding error by span volume, so sampling them costs coverage and saves
     * nothing.
     */
    private val longRun: Duration = Duration.ofSeconds(
        System.getenv("TRACE_SAMPLE_LONG_RUN_SECONDS")?.toLongOrNull() ?: 60L),
) {

    /**
     * Everything the decision depends on. All of it knowable only once the run
     * has finished, which is the whole argument for deciding here.
     */
    data class RunFacts(
        val runId: UUID,
        val workspaceId: UUID,
        /** `agent_runs.status`. */
        val status: String,
        val createdAt: Instant,
        val durationMs: Long?,
        /** A span or step that failed, anywhere in the run. */
        val hadFailedStep: Boolean,
        /** An approval was requested — someone looked at this run, or will. */
        val hadApproval: Boolean,
        /** A child budget was clamped to fit its parent. */
        val hadBudgetClamp: Boolean,
    )

    /** KEEP always carries the reason, because "why is this run in the archive" is a real question. */
    sealed class Decision {
        data class Keep(val reason: String) : Decision()
        data class SampledOut(val rate: Double) : Decision()

        val kept: Boolean get() = this is Keep
    }

    /**
     * The rules, in order. Every KEEP is unconditional — reaching the sampled
     * branch means none of them applied.
     */
    fun decide(f: RunFacts, now: Instant = Instant.now()): Decision {
        // 1. Recent. Possibly still running, and certainly still being watched.
        if (Duration.between(f.createdAt, now) < graceWindow) return Decision.Keep("recent")

        // 2. Anything that is not a clean success. Failed, cancelled, timed out,
        //    ceiling-exceeded, still running — all kept. `succeeded` is the ONLY
        //    status that can be sampled, so a status added later is kept by
        //    default rather than silently discarded.
        if (f.status != "succeeded") return Decision.Keep("status=${f.status}")

        // 3. The three notable-events rules, verbatim from §12.1. These are the
        //    runs someone will ask about.
        if (f.hadFailedStep) return Decision.Keep("had a failed step")
        if (f.hadApproval) return Decision.Keep("had an approval")
        if (f.hadBudgetClamp) return Decision.Keep("had a budget clamp")

        // 4. Short. Cheap to keep, and sampling it saves nothing worth having.
        val ms = f.durationMs
        if (ms == null || ms < longRun.toMillis()) return Decision.Keep("short run")

        // 5. Eligible. Now, and only now, does the rate apply.
        val rate = rateFor(f.workspaceId).coerceIn(0.0, 1.0)
        if (rate >= 1.0) return Decision.Keep("rate=1.0")
        return if (bucket(f.runId) < rate) Decision.Keep("sampled in") else Decision.SampledOut(rate)
    }

    /**
     * A stable [0,1) position for a run id.
     *
     * The low 53 bits of the id's own bits, which are random for a v4 UUID.
     * `hashCode()` would have been the obvious choice and is wrong: it is a
     * 32-bit XOR fold with visible structure, so at small rates the kept set
     * correlates with how the ids were generated rather than being uniform.
     */
    private fun bucket(runId: UUID): Double {
        val mixed = runId.mostSignificantBits * 31 xor runId.leastSignificantBits
        return (mixed ushr 11).toDouble() / (1L shl 53).toDouble()
    }

    companion object {
        /**
         * Rates from `workspace_usage_policies`, cached for the life of the object.
         *
         * The archiver is constructed per maintenance tick and reads each
         * workspace once per partition, so a cache with no expiry is right here:
         * a rate change takes effect on the next tick, and re-reading it per run
         * would be a query per run for a value that changes once a quarter.
         *
         * A workspace with no policy row, or a failed read, means 1.0 — keep
         * everything. Sampling must fail towards keeping data.
         */
        fun fromDatabase(
            dataSource: javax.sql.DataSource,
            /**
             * Overridable because the EXPORT caller needs it at zero.
             *
             * The grace window protects a run somebody is watching in the debugger
             * from being pruned. `RunTraceExporter` runs at terminal, when every
             * run is inside that window, so leaving it at sixty seconds would keep
             * every run and the workspace's rate would never apply. See
             * `RunTraceExporter.samplerForExport`.
             */
            graceWindow: Duration = Duration.ofSeconds(
                System.getenv("TRACE_SAMPLE_GRACE_SECONDS")?.toLongOrNull() ?: 60L),
        ): TraceSampler {
            val cache = java.util.concurrent.ConcurrentHashMap<UUID, Double>()
            return TraceSampler(graceWindow = graceWindow, rateFor = { ws ->
                cache.computeIfAbsent(ws) {
                    runCatching {
                        dataSource.connection.use { c ->
                            c.prepareStatement(
                                "SELECT trace_sample_rate FROM workspace_usage_policies WHERE workspace_id = ?"
                            ).use { st ->
                                st.setObject(1, ws)
                                st.executeQuery().use { rs ->
                                    if (rs.next()) rs.getBigDecimal(1)?.toDouble() ?: 1.0 else 1.0
                                }
                            }
                        }
                    }.getOrDefault(1.0)
                }
            })
        }
    }
}
