package com.vectorbea.api.queue

import org.slf4j.LoggerFactory
import java.util.UUID
import javax.sql.DataSource

/**
 * Weighted fair queueing, in one column.
 *
 * THE PROBLEM WITH FIFO
 * ---------------------
 * A tenant who submits 500 runs ahead of a tenant who submits one gets all 500
 * served first. That is what a stream gives you, and it is why S01 test 4 showed
 * a quiet tenant completing nothing while a flooder completed fifty.
 *
 * THE MECHANISM
 * -------------
 * Each workspace has a virtual clock. Every enqueue stamps the run with a
 * virtual finish time and pushes the clock forward by the run's cost:
 *
 *     fair_vtime = GREATEST(vclock, now_epoch) + (est_cost / plan_weight)
 *     vclock     = fair_vtime
 *
 * Ordering by `fair_vtime` then interleaves tenants automatically. The flooder's
 * 500th run carries a vtime 500 cost-units in the future; the quiet tenant's
 * single run carries one near `now` and is served next. No round-robin
 * bookkeeping, no per-tenant queues — one indexed column.
 *
 * `GREATEST(vclock, now_epoch)` is the part that matters most and is easiest to
 * miss. Without it, a tenant who flooded an hour ago and went quiet would still
 * carry a clock far in the future and be starved long after their burst ended.
 * Clamping to `now` means an idle tenant always re-enters at the front, which is
 * exactly the behaviour a fair scheduler should have.
 *
 * `plan_weight` divides the increment: a weight-2.0 tenant advances their clock
 * half as fast and is therefore served about twice as often under contention.
 *
 * ── WHERE THE WEIGHT COMES FROM (S3) ────────────────────────────────────────
 * The plan, via `workspace_scheduling_weight()`, which reads the
 * `scheduling_priority` entitlement and falls back to the pre-S3
 * `workspace_usage_policies.plan_weight` when a workspace has no entitlement.
 *
 * This is a NUMBER IN AN EXISTING MECHANISM, not a new lane. Nothing about the
 * ordering, the clamp to `now`, or the claim changes; a paid tenant's clock
 * simply advances more slowly, so their run does not queue behind a free-tier
 * batch. Adding a priority lane per tier would have been a second scheduler with
 * its own starvation modes — the weight already interleaves correctly, and it
 * degrades to today's behaviour for any workspace whose plan says nothing.
 *
 * The function is resolved in the database rather than passed in, because this
 * statement must stay ONE statement: reading the weight in Kotlin first would
 * put a round trip between reading the clock and advancing it, which is the race
 * the single `UPDATE ... RETURNING` exists to close.
 *
 * ── AND WHERE THE RUN'S OWN PRIORITY COMES IN (T5) ────────────────────
 * The plan weight answers "which TENANT goes first". It cannot answer "which of
 * this tenant's runs goes first", and an SRE team's Sev1 and their nightly batch
 * job live in the same workspace — so a second divisor, `run_priority_weight`
 * (V068), discounts the clock cost by the run's own priority.
 *
 * Weighting rather than a strict lane, deliberately. `priority DESC` in the
 * claim is already a strict ordering, and a strict ordering ALONE starves: a
 * service producing one Sev1 a minute would stop batch work entirely and nobody
 * would notice until a nightly job had not run for a week. A discount makes a
 * Sev1 jump the queue repeatedly and cheaply while a batch run that has been
 * waiting still eventually holds the lowest vtime and is served. Both are kept:
 * `priority DESC` gives an unambiguous answer for a genuine emergency, and the
 * weight is what makes the ordinary spread of priorities behave.
 */
object FairOrdering {

    private val log = LoggerFactory.getLogger(FairOrdering::class.java)

    /**
     * The boundary between ordinary traffic and the priority lane.
     *
     * Mirrors `PostgresClaim.PRIORITY_LANE_FLOOR` in the worker. Duplicated
     * rather than shared because the two modules have no common artifact, and a
     * shared-constants module for one integer would be worse than two lines that
     * name each other. If one moves, the claim silently stops preempting — so the
     * lane test in scripts/load/priority-lane.mjs is what holds them together.
     */
    const val PRIORITY_LANE_FLOOR = 50

    /** Priority stamped on a run from a `priority_lane` workspace. */
    const val PRIORITY_LANE_VALUE: Short = 100

    /**
     * Relative cost by execution class.
     *
     * Deliberately coarse. The point is to stop an agent run counting the same as
     * a transform against a tenant's clock — a precise estimate is neither
     * available at trigger nor necessary, since only the ratios matter.
     */
    fun estimatedCost(executionClass: ExecutionClass): Double = when (executionClass) {
        ExecutionClass.AGENT -> 10.0   // seconds of LLM latency, typically
        /* A child is an agent loop and costs a tenant the same. Charging it less
           because it is "internal" would let a fan-out buy ten agents for the
           price of one against the fair clock, which is the exact arbitrage the
           depth penalty exists to close. */
        ExecutionClass.AGENT_CHILD -> 10.0
        ExecutionClass.AGENT_INTERACTIVE -> 10.0
        ExecutionClass.LONG -> 5.0
        ExecutionClass.SHORT -> 1.0
        ExecutionClass.SYSTEM -> 0.0   // operational work never charges a tenant
    }

    data class Placement(val fairVtime: Double, val priority: Short)

    /**
     * Compute the run's place in the fair queue and advance the workspace clock,
     * atomically.
     *
     * One statement, so two concurrent triggers for the same workspace cannot both
     * read the same clock and receive the same vtime — which would put them in an
     * arbitrary order and let a burst of parallel submissions bypass the weighting
     * entirely. The `UPDATE … RETURNING` takes a row lock for the duration.
     *
     * Never throws: a scheduling hint must not be able to fail a trigger. On error
     * the caller falls back to `now`, which degrades to FIFO for that one run.
     */
    fun placeAndAdvance(
        dataSource: DataSource,
        workspaceId: UUID,
        executionClass: ExecutionClass,
        /**
         * The run's own priority, 0–100, already clamped to what the workspace
         * may ask for — see `RunIngress.priorityFor`. Defaults to 0, which
         * reproduces the pre-T5 behaviour exactly: the divisor is 1.0 and the
         * priority stamped on the row is the workspace lane's, as before.
         */
        priority: Short = 0,
    ): Placement {
        val cost = estimatedCost(executionClass)
        return try {
            dataSource.connection.use { conn ->
                conn.prepareStatement(
                    """
                    WITH policy AS (
                        SELECT workspace_scheduling_weight(?) AS weight,
                               COALESCE((SELECT bool_or(priority_lane)
                                           FROM workspace_usage_policies
                                          WHERE workspace_id = ?), false) AS priority_lane
                    )
                    UPDATE workspaces w
                       SET vclock = GREATEST(w.vclock, EXTRACT(EPOCH FROM now()))
                                    + (? / (GREATEST((SELECT weight FROM policy), 0.01)
                                            * run_priority_weight(?)))
                     WHERE w.id = ?
                    RETURNING w.vclock, (SELECT priority_lane FROM policy) AS priority_lane
                    """.trimIndent()
                ).use { stmt ->
                    stmt.setObject(1, workspaceId)
                    stmt.setObject(2, workspaceId)
                    stmt.setDouble(3, cost)
                    stmt.setShort(4, priority)
                    stmt.setObject(5, workspaceId)
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) {
                            val vtime = rs.getDouble("vclock")
                            // The demo lane: runtime-configurable, no deploy.
                            val lane: Short = if (rs.getBoolean("priority_lane")) PRIORITY_LANE_VALUE else 0
                            /*
                             * The higher of the two. A priority-lane workspace
                             * keeps stamping 100 on everything, which is what it
                             * pays for and what the lane test asserts; a run that
                             * asked for more than its workspace's floor keeps what
                             * it asked for. Neither can lower the other.
                             */
                            Placement(vtime, maxOf(lane, priority))
                        } else {
                            log.warn("[fair] workspace {} not found — falling back to now", workspaceId)
                            Placement(nowEpoch(), priority)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            log.warn("[fair] could not place run for workspace {} — falling back to FIFO: {}",
                workspaceId, e.message)
            /* FIFO for this one run, but it keeps its priority: `priority DESC`
               still orders the claim, so a Sev1 placed during a database blip is
               delayed rather than demoted. */
            Placement(nowEpoch(), priority)
        }
    }

    private fun nowEpoch(): Double = System.currentTimeMillis() / 1000.0
}
