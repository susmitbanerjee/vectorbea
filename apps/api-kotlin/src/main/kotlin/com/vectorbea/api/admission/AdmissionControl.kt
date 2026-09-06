package com.vectorbea.api.admission

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.queue.ExecutionClass
import com.vectorbea.api.queue.FairOrdering
import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * The decision made before a run is accepted.
 *
 * THE POINT
 * ---------
 * A user who sees "you're #47 in queue, about 3 minutes" trusts the system. A
 * user whose run sits in `queued` silently for twenty minutes writes a bad
 * review. Both are the same amount of waiting; only one of them is honest about
 * it.
 *
 * So this never returns "accepted" without also returning what accepting means.
 * Under load the answer is a position and an ETA, not silence.
 *
 * THE FOUR OUTCOMES
 * -----------------
 * | Condition                    | Outcome                                  |
 * |------------------------------|------------------------------------------|
 * | queue depth < 100            | accept, expect immediate execution       |
 * | 100 ≤ depth ≤ 500            | accept, return queue position and ETA    |
 * | workspace over its own cap   | reject 429 — your runs are the reason     |
 * | global depth > 2000          | reject 503 — unless in the priority lane |
 *
 * Ordering matters: the workspace check runs before the global one. A tenant at
 * their own cap should be told *that*, even during a platform-wide surge, because
 * it is the constraint they can act on. Telling them "the platform is busy" when
 * their own eight runs are the problem sends them to the wrong support article.
 *
 * WHERE THE WORKSPACE CAP COMES FROM (S3)
 * ---------------------------------------
 * The workspace's PLAN, resolved through its billing account — never the plan of
 * whoever pressed Run. A Pro member triggering a run inside a Free workspace is
 * held to Free's concurrency, and the refusal names Free. `workspace_limit()`
 * does the resolution inside the snapshot statement so the active count and the
 * ceiling are read at the same instant.
 *
 * The monthly QUOTA is checked before this, in `RunRoutes`, and not here: a quota
 * is account-scoped and a concurrency cap is workspace-scoped, and folding two
 * different subjects into one snapshot would make the refusal ambiguous about
 * which one the caller hit.
 *
 * WHY THIS IS CHEAP
 * -----------------
 * Two aggregate queries against indexes that already exist for the claim
 * (`agent_runs_claim_idx`, `agent_runs_tenant_load_idx`). Under the load the
 * thresholds describe, that is a handful of milliseconds against index-only
 * scans of the in-flight set — which stays small no matter how much run history
 * accumulates.
 */
class AdmissionControl(
    private val dataSource: DataSource,
    private val thresholds: Thresholds = Thresholds.fromEnv(),
) {
    private val log = LoggerFactory.getLogger(AdmissionControl::class.java)

    data class Thresholds(
        /** Below this, a run is expected to start immediately and no ETA is offered. */
        val immediateBelow: Int,
        /** Between [immediateBelow] and this, accept but tell the caller where they are. */
        val queuedBelow: Int,
        /** Above this, shed non-priority load. */
        val globalReject: Int,
    ) {
        companion object {
            fun fromEnv() = Thresholds(
                immediateBelow = env("ADMISSION_IMMEDIATE_BELOW", 100),
                queuedBelow = env("ADMISSION_QUEUED_BELOW", 500),
                globalReject = env("ADMISSION_GLOBAL_REJECT", 2_000),
            )

            private fun env(name: String, default: Int) =
                System.getenv(name)?.toIntOrNull() ?: default
        }
    }

    /**
     * What the caller is told when the run is accepted.
     *
     * [position] and [etaSeconds] are null in the immediate case — offering an ETA
     * of "0 seconds" for a run that is about to start reads as a system under
     * strain when it is not.
     */
    data class Admitted(
        val queueDepth: Int,
        val position: Int?,
        val etaSeconds: Int?,
        val degraded: Boolean,
    ) {
        fun toResponseFields(): Map<String, Any?> = buildMap {
            put("queueDepth", queueDepth)
            if (position != null) put("queuePosition", position)
            if (etaSeconds != null) put("etaSeconds", etaSeconds)
            if (degraded) {
                put("degraded", true)
                // No ETA means nothing has completed recently enough to measure a
                // rate. Say where they are and stop, rather than reaching for
                // "in a few moments" — a vague promise made without data is
                // exactly the reassurance that turns into a complaint.
                put("message", if (etaSeconds != null)
                    "The queue is busy. Your run is accepted and will start in about ${humanize(etaSeconds)}."
                else
                    "The queue is busy. Your run is accepted and is position $position in the queue.")
            }
        }
    }

    /** A snapshot of the queue, taken once and reused for every decision below. */
    private data class Snapshot(
        val globalDepth: Int,
        val classDepth: Int,
        val workspaceActive: Int,
        val workspaceQueued: Int,
        val workspaceLimit: Int,
        val throughputPerSecond: Double,
    )

    /**
     * Decide, and either return what to tell the caller or throw the rejection.
     *
     * Throws rather than returning a sealed result because every caller's
     * behaviour on rejection is identical — abandon the request with a structured
     * error — and the existing [ApiError] path already renders those correctly.
     *
     * **Fails open.** If the snapshot query fails, the run is admitted. An
     * admission check that cannot reach the database must not become an outage of
     * its own: the claim still enforces the per-tenant cap atomically, so the
     * worst case here is a run that queues when it could have been rejected
     * politely.
     */
    fun admit(
        workspaceId: UUID,
        executionClass: ExecutionClass,
        priority: Short,
        /**
         * The plan governing the WORKSPACE, so a concurrency refusal can name it
         * and the upgrade path rather than being a bare number.
         *
         * Passed in rather than resolved here because the caller has already
         * resolved it for the quota check, and resolving twice would let the two
         * refusals in one request disagree about which plan they are talking
         * about. Optional so a caller without entitlements wired still works —
         * the sentence degrades, nothing breaks.
         */
        plan: com.vectorbea.api.entitlements.PlanSummary? = null,
    ): Admitted {
        val snap = try {
            snapshot(workspaceId, executionClass)
        } catch (e: Exception) {
            log.warn("[admission] snapshot failed for workspace {} — admitting: {}", workspaceId, e.message)
            return Admitted(queueDepth = 0, position = null, etaSeconds = null, degraded = false)
        }

        // ── The workspace's own ceiling ───────────────────────────────────────
        // Checked first: it is the constraint the caller can do something about.
        if (snap.workspaceActive >= snap.workspaceLimit) {
            throw ApiError.WorkspaceConcurrencyLimit(
                limit = snap.workspaceLimit,
                active = snap.workspaceActive,
                queued = snap.workspaceQueued,
                planCode = plan?.code,
                planName = plan?.name,
                upgradeToName = plan?.upgradeToName,
                upgradeUrl = plan?.upgradeUrl,
            )
        }

        // ── Global load shedding ──────────────────────────────────────────────
        // The demo lane stays open. That is the entire reason the lane exists: the
        // moment the platform is under enough load to shed traffic is exactly the
        // moment a demo must still work.
        if (snap.globalDepth > thresholds.globalReject && priority < FairOrdering.PRIORITY_LANE_FLOOR) {
            log.warn("[admission] shedding: global depth {} > {} (workspace {})",
                snap.globalDepth, thresholds.globalReject, workspaceId)
            throw ApiError.QueueSaturated(
                globalDepth = snap.globalDepth,
                threshold = thresholds.globalReject,
            )
        }

        // ── Accepted ──────────────────────────────────────────────────────────
        if (snap.classDepth < thresholds.immediateBelow) {
            return Admitted(snap.classDepth, position = null, etaSeconds = null, degraded = false)
        }

        // Busy: accept, but say where they are and roughly how long. The position
        // is approximate by one — the run does not exist yet — and deliberately so:
        // computing it after the insert would need a second round trip to tell the
        // caller something they can refresh from the queue-position endpoint.
        val position = snap.classDepth + 1
        val eta = etaFor(position, snap.throughputPerSecond)
        return Admitted(
            queueDepth = snap.classDepth,
            position = position,
            etaSeconds = eta,
            degraded = snap.classDepth >= thresholds.immediateBelow,
        )
    }

    private fun snapshot(workspaceId: UUID, executionClass: ExecutionClass): Snapshot =
        dataSource.connection.use { conn ->
            conn.prepareStatement(SNAPSHOT_SQL).use { stmt ->
                stmt.setString(1, executionClass.wire)
                stmt.setObject(2, workspaceId)   // ws_active
                stmt.setObject(3, workspaceId)   // ws_queued
                stmt.setObject(4, workspaceId)   // workspace_limit(...)
                stmt.setObject(5, workspaceId)   // its policy fallback
                stmt.setString(6, executionClass.wire)
                stmt.executeQuery().use { rs ->
                    if (!rs.next()) return Snapshot(0, 0, 0, 0, DEFAULT_WORKSPACE_LIMIT, 0.0)
                    Snapshot(
                        globalDepth = rs.getInt("global_depth"),
                        classDepth = rs.getInt("class_depth"),
                        workspaceActive = rs.getInt("ws_active"),
                        workspaceQueued = rs.getInt("ws_queued"),
                        workspaceLimit = rs.getInt("ws_limit"),
                        throughputPerSecond = rs.getDouble("rate"),
                    )
                }
            }
        }

    /**
     * ETA from measured throughput, not from a model.
     *
     * A model of "n runs × average duration ÷ pool size" is wrong the moment the
     * fleet is resized, a pool is retuned, or the workload shifts from short to
     * agent. Completions per second over the last five minutes tracks all three
     * automatically, and is the only figure that stays honest across a deploy.
     *
     * Null when nothing has completed recently: an ETA computed from no data is a
     * guess, and printing a guess is how you lose the trust the ETA existed to
     * build.
     */
    private fun etaFor(position: Int, ratePerSecond: Double): Int? =
        if (ratePerSecond > 0.0001) Math.ceil(position / ratePerSecond).toInt() else null

    companion object {
        /** Matches the worker's `MAX_ACTIVE_RUNS_PER_TENANT` default. */
        private const val DEFAULT_WORKSPACE_LIMIT = 2

        private fun humanize(seconds: Int): String = when {
            seconds < 60 -> "$seconds seconds"
            seconds < 3600 -> "${seconds / 60} minute${if (seconds / 60 == 1) "" else "s"}"
            else -> "${seconds / 3600} hour${if (seconds / 3600 == 1) "" else "s"}"
        }

        /**
         * One statement for the whole decision.
         *
         * Five scalar subqueries rather than five round trips: the thresholds are
         * compared against each other, so reading them at different instants would
         * let a run be rejected for a global surge that had already passed while
         * being admitted against a workspace count that had not.
         */
        private val SNAPSHOT_SQL = """
            SELECT
                (SELECT count(*)::int FROM agent_runs
                  WHERE status IN ('queued','yielded'))                    AS global_depth,
                (SELECT count(*)::int FROM agent_runs
                  WHERE status IN ('queued','yielded')
                    AND execution_class = ?)                               AS class_depth,
                (SELECT count(*)::int FROM agent_runs
                  WHERE workspace_id = ? AND status IN ('claimed','running')) AS ws_active,
                (SELECT count(*)::int FROM agent_runs
                  WHERE workspace_id = ? AND status IN ('queued','yielded'))  AS ws_queued,
                -- S3: the ceiling comes from the workspace's PLAN, resolved
                -- through its billing account. The pre-S3
                -- workspace_usage_policies value is the fallback for a
                -- workspace whose plan says nothing about the key, which keeps
                -- a hand-tuned tenant working if a seed row is ever missing.
                --
                -- Resolved in SQL rather than passed in because this whole
                -- snapshot is deliberately one statement: reading the limit
                -- separately would compare an active count taken at one instant
                -- against a limit read at another.
                workspace_limit(
                    ?, 'max_concurrent_runs',
                    (SELECT COALESCE(MAX(max_concurrent_runs), $DEFAULT_WORKSPACE_LIMIT)::int
                       FROM workspace_usage_policies WHERE workspace_id = ?)
                )                                                          AS ws_limit,
                (SELECT count(*)::float / 300.0 FROM agent_runs
                  WHERE execution_class = ?
                    AND completed_at > now() - interval '5 minutes')       AS rate
        """.trimIndent()
    }
}
