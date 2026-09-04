package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.api.pathUUID
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.observability.failures.FailureClass
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import javax.sql.DataSource

/**
 * The failures page: the taxonomy as an operating picture rather than a label.
 *
 * ── WHAT A PER-RUN CLASS CANNOT TELL YOU ────────────────────────────────────
 * On one run, "AUTH — reconnect Salesforce" is a helpful sentence. Across a
 * workspace it is the difference between forty tickets and one expired
 * credential, and between "the product is flaky" and "one prompt is wrong".
 *
 * ── THE GROUPING IS THE POINT ───────────────────────────────────────────────
 * Not by severity, not by frequency — by OWNER. CONFIG and INPUT are the
 * workflow builder's queue, AUTH is the admin's, INFRA is ours. A list sorted by
 * count tells four people to read the same list and work out which lines are
 * theirs; grouped by owner, each of them has a queue.
 *
 * ── EVERY QUERY IS AN AGGREGATE ─────────────────────────────────────────────
 * The page is specified to load in under a second on a hundred thousand runs, so
 * nothing here reads rows and counts them in Kotlin. Every figure is a GROUP BY
 * against `agent_runs_failures_idx`, which covers (workspace, window) and carries
 * the class as an INCLUDE column.
 */
class FailureRoutes(
    private val dataSource: DataSource,
) {
    fun register(router: Router) {
        router.get("/api/workspaces/:id/failures", ::failures)
    }

    /** Windows the page offers. Bounded, because "all time" is a table scan. */
    private val WINDOWS = mapOf(
        "24h" to 1L, "7d" to 7L, "30d" to 30L, "90d" to 90L,
    )

    /**
     * A run whose class is written but that nothing could classify.
     *
     * Rendered as its own row rather than dropped. A failures page that silently
     * omits what it cannot categorise reports tidy numbers that do not add up to
     * the failures the workspace actually had — and the size of this row is the
     * honest measure of how good the taxonomy currently is.
     */
    private val UNCLASSIFIED = "UNCLASSIFIED"

    private fun failures(req: Request): Response {
        val ctx = req.context()
        val workspaceId = req.pathUUID("id")
        /* The path id must be the caller's own workspace. A workspace id in a URL
           is not an authorisation, and this endpoint aggregates everything that
           workspace ever did. */
        if (workspaceId != ctx.workspaceId) {
            throw com.vectorbea.api.errors.ApiError.NotFound("Workspace")
        }

        val windowKey = req.query("window")?.takeIf { it in WINDOWS } ?: "7d"
        val days = WINDOWS.getValue(windowKey)
        val now = Instant.now()
        val from = now.minus(days, ChronoUnit.DAYS)
        /* The previous window of equal length, for the trend. Same length, so a
           7-day trend compares like with like rather than this week against the
           month before it. */
        val prevFrom = from.minus(days, ChronoUnit.DAYS)

        val current = countsByClass(workspaceId, from, now)
        val previous = countsByClass(workspaceId, prevFrom, from)
        val total = current.values.sum()

        return Response.ok(mapOf(
            "workspaceId" to workspaceId.toString(),
            "window" to windowKey,
            "from" to from.toString(),
            "to" to now.toString(),
            "totalFailures" to total,

            /* ── BY CLASS, with the trend against the same length of time. */
            "byClass" to current.entries
                .sortedByDescending { it.value }
                .map { (cls, count) ->
                    val before = previous[cls] ?: 0
                    mapOf(
                        "class" to cls,
                        "count" to count,
                        "previousCount" to before,
                        /* Null rather than a percentage when there is nothing to
                           compare against: "+100%" from a base of zero is a
                           number that reads as a trend and is not one. */
                        "changePct" to if (before == 0L) null
                            else Math.round(((count - before) * 100.0) / before),
                        "owner" to ownerOf(cls),
                        "summary" to summaryOf(cls),
                        "retry" to retryOf(cls),
                        "rendersAsError" to (cls != FailureClass.BUDGET.name),
                        "shareOfTotal" to if (total == 0L) 0.0 else count.toDouble() / total,
                    )
                },

            /* ── BY OWNER. The queue each person actually has. */
            "byOwner" to current.entries
                .groupBy { ownerOf(it.key) }
                .map { (owner, entries) ->
                    mapOf(
                        "owner" to owner,
                        "count" to entries.sumOf { it.value },
                        "classes" to entries.sortedByDescending { it.value }
                            .map { mapOf("class" to it.key, "count" to it.value) },
                    )
                }
                .sortedByDescending { it["count"] as Long },

            "byWorkflow" to byWorkflow(workspaceId, from, now),
            "byAgent" to byAgent(workspaceId, from, now),
            "recurring" to recurring(workspaceId, from, now),
            "budgetPressure" to budgetPressure(workspaceId, from, now),
            "traceCompleteness" to traceCompleteness(workspaceId, from, now),
        ))
    }

    // ── Aggregates ───────────────────────────────────────────────────────────

    /**
     * Failures by class in a window.
     *
     * One GROUP BY, index-only. Every failed run has exactly one non-null
     * `failure_class` (the worker writes UNCLASSIFIED when nothing could
     * classify it), so these counts sum to the window's failures with nothing
     * dropped and nothing double-counted.
     */
    private fun countsByClass(ws: UUID, from: Instant, to: Instant): Map<String, Long> =
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """SELECT failure_class, COUNT(*) AS n
                         FROM agent_runs
                        WHERE workspace_id = ?
                          AND created_at >= ? AND created_at < ?
                          AND failure_class IS NOT NULL
                          AND $NOT_A_REPLAY
                        GROUP BY failure_class"""
                ).use { st ->
                    st.setObject(1, ws)
                    st.setTimestamp(2, java.sql.Timestamp.from(from))
                    st.setTimestamp(3, java.sql.Timestamp.from(to))
                    st.executeQuery().use { rs ->
                        buildMap { while (rs.next()) put(rs.getString(1), rs.getLong(2)) }
                    }
                }
            }
        }.getOrDefault(emptyMap())

    /**
     * By workflow, so one bad prompt is a pattern and not forty tickets.
     *
     * Capped at the worst twenty. A workspace with three hundred workflows has a
     * long tail nobody scrolls, and the tail is not where the answer is.
     */
    private fun byWorkflow(ws: UUID, from: Instant, to: Instant): List<Map<String, Any?>> =
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """SELECT r.workflow_id,
                              COALESCE(w.name, 'deleted workflow') AS workflow_name,
                              r.failure_class,
                              COUNT(*) AS n,
                              MAX(r.id::text) AS sample_run_id
                         FROM agent_runs r
                         LEFT JOIN workflows w ON w.id = r.workflow_id
                        WHERE r.workspace_id = ?
                          AND r.created_at >= ? AND r.created_at < ?
                          AND r.failure_class IS NOT NULL
                          AND $NOT_A_REPLAY_R
                        GROUP BY r.workflow_id, w.name, r.failure_class
                        ORDER BY n DESC
                        LIMIT 20"""
                ).use { st ->
                    st.setObject(1, ws)
                    st.setTimestamp(2, java.sql.Timestamp.from(from))
                    st.setTimestamp(3, java.sql.Timestamp.from(to))
                    st.executeQuery().use { rs ->
                        buildList {
                            while (rs.next()) add(mapOf(
                                "workflowId" to rs.getString("workflow_id"),
                                "workflowName" to rs.getString("workflow_name"),
                                "class" to rs.getString("failure_class"),
                                "count" to rs.getLong("n"),
                                /* Every row is one click from a real run's Debug
                                   tab. A count with no example is a statistic; a
                                   count with a run behind it is a starting point. */
                                "sampleRunId" to rs.getString("sample_run_id"),
                                "owner" to ownerOf(rs.getString("failure_class")),
                            ))
                        }
                    }
                }
            }
        }.getOrDefault(emptyList())

    /**
     * By agent, the peer of by-workflow.
     *
     * ── WHY THIS IS NOT DERIVED FROM THE RUN ────────────────────────────────
     * A run has one failure class; a run can activate six agents. Attributing the
     * run's class to every agent in it would blame five agents that did their job,
     * and attributing it to none would make a bad prompt invisible. So this reads
     * the ACTIVATIONS: each one carries its own status and its own class, written
     * by the same taxonomy at the same boundary.
     *
     * The window is still the RUN's window, joined for it, so "last 7 days" means
     * the same seven days in every section of this page. The replay exclusion
     * comes along with that join for free, which is the other reason to make it.
     *
     * Runs with no agents contribute nothing here, and that is correct: an HTTP
     * node that 500s is a failure of the workflow, not of an agent. The class and
     * workflow sections are where it is counted.
     */
    /* `internal` rather than private: this one is worth testing against the real
       query. Every other aggregate here reads `agent_runs` alone, but this one
       joins activations to runs, and the join is where "attribute the run's class
       to every agent in it" would creep back in. A test that re-types the SQL
       cannot catch that. */
    internal fun byAgent(ws: UUID, from: Instant, to: Instant): List<Map<String, Any?>> =
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """SELECT a.agent_id,
                              COALESCE(ag.name, 'deleted agent') AS agent_name,
                              COALESCE(a.failure_class, '$UNCLASSIFIED') AS failure_class,
                              COUNT(*)                      AS n,
                              COUNT(DISTINCT a.run_id)      AS runs,
                              COUNT(DISTINCT r.workflow_id) AS workflows,
                              MAX(a.run_id::text)           AS sample_run_id
                         FROM agent_activations a
                         JOIN agent_runs r
                           ON r.id = a.run_id
                          AND r.workspace_id = a.workspace_id
                         LEFT JOIN agents ag ON ag.id = a.agent_id
                        WHERE a.workspace_id = ?
                          AND r.created_at >= ? AND r.created_at < ?
                          AND a.status = 'failed'
                          AND $NOT_A_REPLAY_R
                        GROUP BY a.agent_id, ag.name, a.failure_class
                        ORDER BY n DESC
                        LIMIT 20"""
                ).use { st ->
                    st.setObject(1, ws)
                    st.setTimestamp(2, java.sql.Timestamp.from(from))
                    st.setTimestamp(3, java.sql.Timestamp.from(to))
                    st.executeQuery().use { rs ->
                        buildList {
                            while (rs.next()) {
                                val cls = rs.getString("failure_class")
                                add(mapOf(
                                    "agentId" to rs.getString("agent_id"),
                                    "agentName" to rs.getString("agent_name"),
                                    "class" to cls,
                                    "owner" to ownerOf(cls),
                                    "count" to rs.getLong("n"),
                                    /* Activations and runs are different numbers.
                                       One run that retried an agent four times is
                                       four failed activations in one run, and the
                                       reader needs to see both to know which. */
                                    "runs" to rs.getLong("runs"),
                                    "workflows" to rs.getInt("workflows"),
                                    "sampleRunId" to rs.getString("sample_run_id"),
                                ))
                            }
                        }
                    }
                }
            }
        }.getOrDefault(emptyList())

    /**
     * The same thing failing over and over, ranked.
     *
     * ── WHY THE SIGNATURE IS (class, step, error) AND NOT THE MESSAGE ───────
     * One expired credential across forty runs must be ONE row. Grouping on the
     * error text alone would split it the moment a message carried a timestamp or
     * a request id; grouping on the class alone would merge every AUTH failure in
     * the workspace into one uninformative line.
     *
     * The step id is what makes it specific — "crm.search kept returning 403" —
     * and it comes off the root-cause span, which is the one span per run that
     * already answers "where".
     */
    private fun recurring(ws: UUID, from: Instant, to: Instant): List<Map<String, Any?>> =
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """SELECT r.failure_class,
                              COALESCE(s.step_id, '(unattributed)') AS step_id,
                              COALESCE(s.name, '(unknown)')         AS step_name,
                              s.kind,
                              COUNT(*)            AS n,
                              COUNT(DISTINCT r.workflow_id) AS workflows,
                              MAX(r.id::text)     AS sample_run_id,
                              MAX(r.created_at)   AS last_seen
                         FROM agent_runs r
                         JOIN run_spans s
                           ON s.run_id = r.id
                          AND s.workspace_id = r.workspace_id
                          AND s.is_root_cause
                        WHERE r.workspace_id = ?
                          AND r.created_at >= ? AND r.created_at < ?
                          AND r.failure_class IS NOT NULL
                          AND $NOT_A_REPLAY_R
                        GROUP BY r.failure_class, s.step_id, s.name, s.kind
                       HAVING COUNT(*) > 1
                        ORDER BY n DESC
                        LIMIT 20"""
                ).use { st ->
                    st.setObject(1, ws)
                    st.setTimestamp(2, java.sql.Timestamp.from(from))
                    st.setTimestamp(3, java.sql.Timestamp.from(to))
                    st.executeQuery().use { rs ->
                        buildList {
                            while (rs.next()) {
                                val cls = rs.getString("failure_class")
                                add(mapOf(
                                    "class" to cls,
                                    "owner" to ownerOf(cls),
                                    "stepId" to rs.getString("step_id"),
                                    "stepName" to rs.getString("step_name"),
                                    "kind" to rs.getString("kind"),
                                    "count" to rs.getLong("n"),
                                    /* Across how many workflows. One credential
                                       breaking six workflows reads differently
                                       from one workflow failing six times. */
                                    "workflows" to rs.getInt("workflows"),
                                    "sampleRunId" to rs.getString("sample_run_id"),
                                    "lastSeen" to rs.getTimestamp("last_seen")?.toInstant()?.toString(),
                                ))
                            }
                        }
                    }
                }
            }
        }.getOrDefault(emptyList())

    /**
     * Workflows regularly finishing near a ceiling — about to start failing.
     *
     * ── WHY THIS IS ON THE FAILURES PAGE AT ALL ─────────────────────────────
     * These runs SUCCEEDED. They are here because a workflow that habitually
     * finishes at 92% of its budget is not healthy, it is one slightly longer
     * input away from a BUDGET row above — and the only moment that is cheap to
     * fix is before it starts failing.
     *
     * 85% is the threshold the page is specified around. Runs below it are not
     * pressure, they are headroom.
     */
    private fun budgetPressure(ws: UUID, from: Instant, to: Instant): List<Map<String, Any?>> =
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """WITH ceiling AS (
                         SELECT COALESCE(p.max_cost_cents_per_run, 100)::float AS max_cost
                           FROM workspaces w
                           LEFT JOIN workspace_usage_policies p ON p.workspace_id = w.id
                          WHERE w.id = ?
                       )
                       SELECT r.workflow_id,
                              COALESCE(w.name, 'deleted workflow') AS workflow_name,
                              COUNT(*) AS runs,
                              COUNT(*) FILTER (
                                WHERE r.estimated_cost * 100.0 >= ceiling.max_cost * 0.85
                              ) AS near_ceiling,
                              MAX(r.estimated_cost) * 100.0 AS peak_cents,
                              MAX(ceiling.max_cost) AS ceiling_cents,
                              MAX(r.id::text) AS sample_run_id
                         FROM agent_runs r
                         CROSS JOIN ceiling
                         LEFT JOIN workflows w ON w.id = r.workflow_id
                        WHERE r.workspace_id = ?
                          AND r.created_at >= ? AND r.created_at < ?
                          AND r.status = 'succeeded'
                          AND r.estimated_cost IS NOT NULL
                          AND $NOT_A_REPLAY_R
                        GROUP BY r.workflow_id, w.name
                       HAVING COUNT(*) FILTER (
                                WHERE r.estimated_cost * 100.0 >= MAX(ceiling.max_cost) * 0.85
                              ) > 0
                        ORDER BY near_ceiling DESC
                        LIMIT 10"""
                ).use { st ->
                    st.setObject(1, ws); st.setObject(2, ws)
                    st.setTimestamp(3, java.sql.Timestamp.from(from))
                    st.setTimestamp(4, java.sql.Timestamp.from(to))
                    st.executeQuery().use { rs ->
                        buildList {
                            while (rs.next()) {
                                val runs = rs.getLong("runs")
                                val near = rs.getLong("near_ceiling")
                                add(mapOf(
                                    "workflowId" to rs.getString("workflow_id"),
                                    "workflowName" to rs.getString("workflow_name"),
                                    "runs" to runs,
                                    "nearCeiling" to near,
                                    "sharePct" to if (runs == 0L) 0 else Math.round((near * 100.0) / runs),
                                    "peakCents" to rs.getDouble("peak_cents"),
                                    "ceilingCents" to rs.getDouble("ceiling_cents"),
                                    "sampleRunId" to rs.getString("sample_run_id"),
                                ))
                            }
                        }
                    }
                }
            }
        }.getOrDefault(emptyList())

    /**
     * How much of this workspace's tracing is intact.
     *
     * ── WHY IT BELONGS ON THIS PAGE AND NOWHERE ELSE ────────────────────────
     * If a meaningful share of runs lost spans, every number above is computed
     * from partial evidence — the class of a failure comes from its root-cause
     * span, and a run that dropped that span is classified from what survived.
     * Putting this in a corner of a settings screen would let somebody read the
     * whole page without learning that it might be wrong.
     */
    private fun traceCompleteness(ws: UUID, from: Instant, to: Instant): Map<String, Any?> =
        runCatching {
            dataSource.connection.use { c ->
                c.prepareStatement(
                    """SELECT COUNT(*) AS runs,
                              COUNT(*) FILTER (WHERE COALESCE(dropped_spans,0) > 0) AS partial,
                              COALESCE(SUM(dropped_spans), 0) AS dropped
                         FROM agent_runs
                        WHERE workspace_id = ?
                          AND created_at >= ? AND created_at < ?
                          AND $NOT_A_REPLAY"""
                ).use { st ->
                    st.setObject(1, ws)
                    st.setTimestamp(2, java.sql.Timestamp.from(from))
                    st.setTimestamp(3, java.sql.Timestamp.from(to))
                    st.executeQuery().use { rs ->
                        if (!rs.next()) return@use emptyMap<String, Any?>()
                        val runs = rs.getLong("runs")
                        val partial = rs.getLong("partial")
                        val share = if (runs == 0L) 0.0 else partial.toDouble() / runs
                        mapOf(
                            "runs" to runs,
                            "partialRuns" to partial,
                            "droppedSpans" to rs.getLong("dropped"),
                            "partialShare" to share,
                            /* One in a hundred is noise; one in twenty starts
                               undermining the classification above it, which is
                               the only reason this figure is on this page. */
                            "undermines" to (share >= 0.05),
                        )
                    }
                }
            }
        }.getOrDefault(emptyMap())

    // ── The taxonomy, resolved ───────────────────────────────────────────────
    //
    // From `observability-kotlin`, which is where the class, its owner and its
    // plain-language summary already live — the failure panel on a single run
    // reads the same table, so a class cannot mean one thing there and another
    // here.

    private fun classOf(name: String): FailureClass? =
        runCatching { FailureClass.valueOf(name) }.getOrNull()

    private fun ownerOf(name: String): String =
        classOf(name)?.owner
            /* UNCLASSIFIED has no owner in the taxonomy, and inventing one would
               put runs in somebody's queue on the strength of a guess. It is
               OURS until it is classified — the gap is a platform problem. */
            ?: if (name == UNCLASSIFIED) "Platform" else "Unassigned"

    private fun summaryOf(name: String): String =
        classOf(name)?.summary
            ?: if (name == UNCLASSIFIED)
                "This run failed and nothing could classify why. That is a gap in " +
                "the taxonomy, not in the workflow."
            else "No description for this class."

    private fun retryOf(name: String): String =
        classOf(name)?.retry?.humanAnswer ?: "Unknown — this failure was not classified."

    companion object {
        /**
         * Replays are not failures the workspace had.
         *
         * Same predicate as the dashboard's, and for the same reason: a replay of
         * a failed run is a debugging action, and counting it would mean the more
         * carefully an incident is investigated, the worse the workspace looks.
         */
        private const val NOT_A_REPLAY =
            "(COALESCE(trigger_type,'') <> 'replay' " +
            " AND COALESCE(execution_mode_kind,'') <> 'replay' " +
            " AND source_run_id IS NULL)"

        /**
         * The same predicate, qualified, for every query that aliases agent_runs.
         *
         * Unqualified it happens to resolve today, because none of the joined
         * tables has a column of the same name. That is a coincidence and not a
         * guarantee — the day `workflows` gains a `source_run_id`, an unqualified
         * reference becomes an ambiguous-column error at runtime in a query the
         * failures page cannot render without.
         */
        private const val NOT_A_REPLAY_R =
            "(COALESCE(r.trigger_type,'') <> 'replay' " +
            " AND COALESCE(r.execution_mode_kind,'') <> 'replay' " +
            " AND r.source_run_id IS NULL)"
    }
}
