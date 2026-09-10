package com.vectorbea.worker.queue

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import java.util.UUID
import javax.sql.DataSource

/**
 * The claim. One statement, and it replaces XREADGROUP entirely.
 *
 * WHAT THIS DELETES
 * -----------------
 * `RunLeaseManager.acquire` was already the real mutual-exclusion primitive;
 * Redis Streams was a notification layer that also hoarded messages. Moving the
 * decision into Postgres removes, rather than adds:
 *
 *   - the Pending Entries List, and every message stranded in one
 *   - XAUTOCLAIM and its idle-timeout tuning
 *   - the second crash-recovery path that could disagree with the lease sweep
 *   - a failure mode where Upstash eviction silently loses work
 *
 * And it makes four things possible that streams structurally cannot do, all of
 * which the UI already promises: priority lanes, weighted fairness, queue
 * position, and class routing as one indexed predicate.
 *
 * ADMISSION IS NOW PART OF THE CLAIM
 * ----------------------------------
 * S03's admission was a short-TTL cache consulted before the claim, plus a
 * check-after-lease to catch what the cache let through. Both existed because
 * the decision and the claim were separate steps that could disagree.
 *
 * Here the tenant-load join is *inside* the same statement that takes the row,
 * under `FOR UPDATE SKIP LOCKED`. There is no window to be stale in: a run is
 * only claimed if its workspace was under its cap at the instant of claiming.
 * The advisory cache can be deleted (see SharedTenantAdmission's note).
 *
 * WHY `SKIP LOCKED` RATHER THAN A LOCK
 * ------------------------------------
 * Twenty workers claiming concurrently must not serialise behind one another.
 * `SKIP LOCKED` lets each walk past rows another worker is already taking, so N
 * workers claim N disjoint batches in parallel with no coordination. That is the
 * property that makes this scale out at all.
 */
class PostgresClaim(
    private val dataSource: DataSource,
    private val workerId: String,
) {
    private val log = logger()

    companion object {
        /**
         * The boundary between ordinary traffic and the priority lane.
         *
         * A threshold rather than a boolean so intermediate priorities remain
         * available later (an enterprise tier at 50, say) without another
         * migration. [FairOrdering] stamps 100 for a priority-lane workspace and
         * 0 for everyone else.
         */
        const val PRIORITY_LANE_FLOOR = 50

        /**
         * The claim.
         *
         * `tenant_load` counts what a workspace is *actually* occupying, which is
         * not the same as what it holds leases for.
         *
         * The lease is taken by RunProcessor, milliseconds after the claim. Count
         * leases alone and that gap is a hole straight through the limit: the loop
         * claims its 2, submits them, comes back before either has leased, sees
         * `active_total = 0`, and claims 2 more. Measured, that was 8 concurrent
         * runs for one workspace against a cap of 2 — the per-tenant limit
         * re-broken in a new place.
         *
         * So a run counts while it is `claimed` or `running` AND either holds a
         * live lease or was claimed within the grace window. The lease keeps the
         * self-healing property — a dead worker's lease expires and the run stops
         * counting, with nobody cleaning up — and the grace window covers the
         * moments before the lease exists.
         *
         * Per-class caps as well as the total: a workspace at its agent cap must
         * still be able to run short work, which a single `max_concurrent_runs`
         * check would prevent.
         *
         * `COALESCE(p.*, default)` throughout, because a policy row is optional
         * and a workspace without one must still be claimable under the platform
         * defaults rather than silently unschedulable.
         *
         * THE PER-TENANT WINDOW — the part that is easy to get wrong
         * ----------------------------------------------------------
         * A plain `active_total < cap` predicate is evaluated once, against the
         * load as it stood when the statement began. Every row in the batch then
         * passes it, so a batch of 8 hands one workspace 8 slots against a cap of
         * 2. Measured, exactly that: peak per-tenant concurrency 7 with the cap
         * set to 2. The limit was not enforced; it was merely consulted.
         *
         * `ROW_NUMBER() PARTITION BY workspace_id` makes the check ordinal instead
         * of boolean: a workspace's Nth-best queued run is claimable only while
         * N ≤ its remaining headroom. The cap then holds *within* a batch as well
         * as across batches, which is what "per-tenant limit" has to mean.
         *
         * Window functions cannot coexist with `FOR UPDATE` at the same query
         * level, hence three CTEs: rank, cut to the budget, then lock the
         * survivors with `SKIP LOCKED`. The lock is still what makes two replicas
         * disjoint; it just happens one level down.
         */
        private val CLAIM_SQL = """
            WITH tenant_load AS (
                SELECT ar.workspace_id,
                       count(*) AS active_total,
                       count(*) FILTER (WHERE ar.execution_class = ?) AS active_class
                  FROM agent_runs ar
                  LEFT JOIN run_leases rl ON rl.run_id = ar.id AND rl.expires_at > now()
                 WHERE ar.status IN ('claimed', 'running')
                   AND (rl.run_id IS NOT NULL
                        OR ar.claimed_at > now() - make_interval(secs => ?))
                 GROUP BY ar.workspace_id
            ),
            candidates AS (
                SELECT r.id, r.priority, r.fair_vtime,
                       ROW_NUMBER() OVER (
                           PARTITION BY r.workspace_id
                           ORDER BY r.priority DESC, r.fair_vtime
                       ) AS rn_in_tenant,
                       LEAST(
                           COALESCE(p.max_concurrent_runs, ?) - COALESCE(tl.active_total, 0),
                           COALESCE(
                               CASE ?
                                 WHEN 'agent' THEN p.max_concurrent_agent_runs
                                 WHEN 'long'  THEN p.max_concurrent_long_runs
                                 WHEN 'short' THEN p.max_concurrent_short_runs
                                 ELSE 2147483647
                               END, ?) - COALESCE(tl.active_class, 0)
                       ) AS headroom
                  FROM agent_runs r
                  LEFT JOIN workspace_usage_policies p ON p.workspace_id = r.workspace_id
                  LEFT JOIN tenant_load tl ON tl.workspace_id = r.workspace_id
                 WHERE r.status IN ('queued', 'yielded')
                   AND r.execution_class = ?
                   AND r.priority >= ?
                   /*
                    * ── A RUN PINNED TO A CUSTOMER'S NETWORK IS NOT OURS ─────
                    *
                    * The single most consequential line in this statement. A
                    * workflow with `runner_pool_id` set has been declared to
                    * execute inside the customer's perimeter — usually because a
                    * procurement review said so — and a platform worker claiming
                    * it would execute their prompts and their tool results on our
                    * infrastructure. Not a degraded experience: the guarantee
                    * they bought, broken, silently, with no error anywhere.
                    *
                    * Expressed here rather than as a filter after the claim,
                    * because a filter after the claim has already read the row
                    * and would still have to hand it back. `agent_runs_platform_
                    * claimable_idx` (V072) is the matching partial index, so this
                    * is not a scan.
                    */
                   AND r.runner_pool_id IS NULL
                 ORDER BY r.priority DESC, r.fair_vtime
                 LIMIT ?
            ),
            eligible AS (
                SELECT id FROM candidates
                 WHERE rn_in_tenant <= headroom
                 ORDER BY priority DESC, fair_vtime
                 LIMIT ?
            ),
            claimable AS (
                SELECT r.id
                  FROM agent_runs r
                 WHERE r.id IN (SELECT id FROM eligible)
                   AND r.status IN ('queued', 'yielded')
                   /* Re-checked on the locked row. The candidate scan and this
                      are separate reads, and the gap between them is exactly
                      where a re-pinned run would slip through. */
                   AND r.runner_pool_id IS NULL
                   FOR UPDATE SKIP LOCKED
            )
            UPDATE agent_runs r
               SET status = 'claimed', claimed_by = ?, claimed_at = now(),
                   delivery_attempts = r.delivery_attempts + 1, updated_at = now()
              FROM claimable c
             WHERE r.id = c.id
            RETURNING r.id, r.workspace_id, r.workflow_id, r.workflow_version_id,
                      r.environment_id, r.input_json, r.execution_class, r.priority,
                      r.delivery_attempts, r.status
        """.trimIndent()
    }

    /** A run taken off the queue, ready to execute. */
    data class ClaimedRun(
        val runId: UUID,
        val workspaceId: UUID,
        val workflowId: UUID,
        val workflowVersionId: UUID,
        val environmentId: UUID,
        val inputJson: String,
        val executionClass: WorkerJobType,
        val priority: Int,
        val deliveryAttempts: Int,
    ) {
        /**
         * The claimed run as a job, so everything downstream — RunProcessor,
         * the durability guards, the metrics — is unchanged by where the work
         * came from. The transport swap stops at this boundary.
         */
        fun toJob(): WorkflowRunJob = WorkflowRunJob(
            // No stream message: nothing to XACK, because there is no stream.
            streamMessageId = "",
            jobType = WorkflowRunJob.JobType.START_RUN,
            runId = runId,
            workflowId = workflowId,
            triggeredBy = com.vectorbea.worker.runtime.RunProcessor.PG_CLAIM_SOURCE,
            inputJson = inputJson,
            retryCount = (deliveryAttempts - 1).coerceAtLeast(0),
            nodeId = null,
            checkpointId = null,
            workspaceId = workspaceId,
        )
    }

    /**
     * Claim up to [batchSize] runs of [executionClass].
     *
     * @param batchSize should be the pool's FREE permit count — claiming more
     *        than can be started recreates, in Postgres, exactly the hoarding
     *        this change removes from Redis.
     * @param priorityFloor claim only runs at or above this priority. This is how
     *        the reserved lane is enforced: see [PRIORITY_LANE_FLOOR].
     */
    /**
     * How deep to scan for candidates before the per-tenant cut.
     *
     * The cut can discard nearly everything: one workspace flooding 50 runs
     * contributes at most `headroom` of them, so scanning only `batchSize` rows
     * would return a single run and leave the pool idle while five other tenants
     * waited. Twenty times the batch, capped, keeps the scan an index range read
     * while being deep enough to find the runs behind a flood.
     */
    private fun candidateWindow(batchSize: Int): Int = (batchSize * 20).coerceIn(64, 1_000)

    /**
     * How long a `claimed` row counts against its tenant without a lease.
     *
     * Matches [reclaimStale]'s threshold on purpose: a row stops counting at
     * exactly the moment it becomes eligible to be reclaimed, so there is no
     * interval in which a run is both invisible to the limit and invisible to
     * recovery.
     */
    private val staleClaimSeconds: Int =
        System.getenv("CLAIM_STALE_SECONDS")?.toIntOrNull() ?: 120

    fun claim(
        executionClass: WorkerJobType,
        batchSize: Int,
        defaultTotalCap: Int,
        defaultClassCap: Int,
        priorityFloor: Int = 0,
    ): List<ClaimedRun> {
        if (batchSize <= 0) return emptyList()
        val cls = executionClass.name.lowercase()
        val startedAt = System.nanoTime()

        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(CLAIM_SQL).use { stmt ->
                    stmt.setString(1, cls)              // tenant_load class filter
                    stmt.setInt(2, staleClaimSeconds)   // claimed-but-not-yet-leased grace
                    stmt.setInt(3, defaultTotalCap)
                    stmt.setString(4, cls)              // CASE selector
                    stmt.setInt(5, defaultClassCap)
                    stmt.setString(6, cls)              // candidates class predicate
                    stmt.setInt(7, priorityFloor)
                    stmt.setInt(8, candidateWindow(batchSize))
                    stmt.setInt(9, batchSize)
                    stmt.setString(10, workerId)
                    stmt.executeQuery().use { rs ->
                        val out = mutableListOf<ClaimedRun>()
                        while (rs.next()) {
                            out += ClaimedRun(
                                runId = UUID.fromString(rs.getString("id")),
                                workspaceId = UUID.fromString(rs.getString("workspace_id")),
                                workflowId = UUID.fromString(rs.getString("workflow_id")),
                                workflowVersionId = UUID.fromString(rs.getString("workflow_version_id")),
                                environmentId = UUID.fromString(rs.getString("environment_id")),
                                inputJson = rs.getString("input_json") ?: "{}",
                                executionClass = executionClass,
                                priority = rs.getInt("priority"),
                                deliveryAttempts = rs.getInt("delivery_attempts"),
                            )
                        }
                        WorkerMetrics.claimDurationSeconds.observeSeconds(
                            (System.nanoTime() - startedAt) / 1_000_000_000.0, cls)
                        WorkerMetrics.claimedTotal.inc(cls, delta = out.size.toLong())
                        out
                    }
                }
            }
        } catch (e: Exception) {
            WorkerMetrics.claimDurationSeconds.observeSeconds(
                (System.nanoTime() - startedAt) / 1_000_000_000.0, "error")
            log.warn("[claim] failed for class {}: {}", cls, e.message)
            emptyList()
        }
    }

    /**
     * Release a claim without executing — the run goes back on the queue.
     *
     * Used when the worker cannot start the run after all (shutting down, or a
     * guard refused it). Returning it to `queued` rather than leaving it
     * `claimed` is what stops a claim becoming a leak.
     */
    fun release(runId: UUID) {
        runCatching {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """UPDATE agent_runs
                          SET status='queued', claimed_by=NULL, claimed_at=NULL, updated_at=now()
                        WHERE id=? AND status='claimed' AND claimed_by=?"""
                ).use { stmt ->
                    stmt.setObject(1, runId); stmt.setString(2, workerId)
                    stmt.executeUpdate()
                }
            }
        }.onFailure { log.warn("[claim] release failed for {}: {}", runId, it.message) }
    }

    /**
     * Return runs stuck in `claimed` to the queue.
     *
     * A worker that dies between claiming and acquiring its lease leaves a run
     * `claimed` with no lease — invisible to the lease sweep, which only looks at
     * `running`. This is the one recovery path that gap needs, and it is the same
     * sweep rather than a second mechanism: bounded, idempotent, and safe to run
     * on every worker.
     *
     * @return number of runs recovered.
     */
    fun reclaimStale(staleAfterSeconds: Int = 120): Int = try {
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """UPDATE agent_runs
                      SET status='queued', claimed_by=NULL, claimed_at=NULL, updated_at=now()
                    WHERE status='claimed'
                      AND claimed_at < now() - make_interval(secs => ?)
                      AND NOT EXISTS (
                            SELECT 1 FROM run_leases rl
                             WHERE rl.run_id = agent_runs.id AND rl.expires_at > now())"""
            ).use { stmt ->
                stmt.setInt(1, staleAfterSeconds)
                stmt.executeUpdate()
            }
        }.also {
            if (it > 0) {
                WorkerMetrics.claimReclaimedTotal.inc(delta = it.toLong())
                log.info("[claim] recovered {} run(s) stuck in 'claimed' with no live lease", it)
            }
        }
    } catch (e: Exception) {
        log.warn("[claim] stale reclaim failed: {}", e.message)
        0
    }
}
