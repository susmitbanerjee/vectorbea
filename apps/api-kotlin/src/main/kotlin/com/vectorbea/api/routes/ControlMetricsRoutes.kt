package com.vectorbea.api.routes

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import org.slf4j.LoggerFactory
import javax.sql.DataSource

/**
 * The Control page's numbers, from the same source the dashboards use.
 *
 * §6 of the observability brief: "Dogfooding your own observability is both a
 * correctness check and a strong investor story." The correctness check is the real
 * reason. If the Control page computes queue depth with its own query and Grafana
 * computes it from `job_queue_depth`, the two will eventually disagree — and when they
 * do, you will not know which one is lying. Having one of them be a customer-facing
 * page makes that a support ticket rather than a curiosity.
 *
 * WHY THIS QUERIES POSTGRES RATHER THAN PROMETHEUS
 * ------------------------------------------------
 * The obvious design is to proxy Prometheus. It is wrong here for two reasons:
 *
 *  1. Prometheus is scraped every 15 seconds. A user pressing Run and then looking at
 *     Control expects to see their run, not to wait for the next scrape. "Queued: 0"
 *     immediately after queueing something is a bug report.
 *  2. It makes the product's UI depend on the monitoring stack being up. The
 *     monitoring stack is one box with no replication (see ops/monitoring). A customer
 *     page that goes blank when the metrics box reboots is a bad trade.
 *
 * So the queries below are the SAME QUERIES the worker's metrics sampler runs — same
 * predicates, same grouping — executed live. They are kept identical deliberately: this
 * is one definition of "queue depth" implemented twice for two latency requirements,
 * not two definitions. If one changes, both must.
 *
 * WHAT IS ACTUALLY DIFFERENT
 * --------------------------
 * Worker-local numbers (in-flight per worker, free slots) cannot come from Postgres —
 * they live in the worker's memory. Those come from `worker_heartbeats`, which the
 * fleet already maintains, and are therefore as fresh as the heartbeat interval rather
 * than instantaneous. The response says which is which via `freshness`, because a
 * number whose staleness is unstated is a number that will be misread.
 */
class ControlMetricsRoutes(private val ds: DataSource) {
    private val log = LoggerFactory.getLogger(ControlMetricsRoutes::class.java)

    fun register(router: Router) {
        router.get("/api/control/metrics") { req -> metrics(req) }
    }

    private fun metrics(req: Request): Response {
        val workspaceId = req.principal?.let { req.header("X-Workspace-Id") }
            ?: req.header("X-Workspace-Id")
            ?: throw ApiError.ValidationError("X-Workspace-Id is required")

        return ds.connection.use { conn ->
            // ── Queue depth ───────────────────────────────────────────────────
            // Identical predicate and bucketing to the worker's job_queue_depth
            // sampler. Scoped to the caller's workspace, because this is a customer
            // page: a tenant must not learn how much work another tenant has queued.
            val queue = mutableListOf<Map<String, Any?>>()
            var queuedTotal = 0L
            conn.prepareStatement(
                """SELECT CASE WHEN priority >= 100 THEN 'priority' ELSE 'normal' END AS priority,
                          COUNT(*) AS depth
                     FROM agent_runs
                    WHERE status = 'queued' AND workspace_id = ?::uuid
                    GROUP BY 1"""
            ).use { stmt ->
                stmt.setString(1, workspaceId)
                stmt.queryTimeout = 3
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        val depth = rs.getLong("depth")
                        queuedTotal += depth
                        queue += mapOf("priority" to rs.getString("priority"), "depth" to depth)
                    }
                }
            }

            // ── This workspace's in-flight work ───────────────────────────────
            // From run_leases, which is the authoritative record of what is executing —
            // the same table the hard admission gate reads. A run counted here is a run
            // holding a permit somewhere.
            var inFlight = 0L
            val byClass = mutableMapOf<String, Long>()
            conn.prepareStatement(
                """SELECT COALESCE(r.execution_class, 'unknown') AS class, COUNT(*) AS n
                     FROM run_leases l
                     JOIN agent_runs r ON r.id = l.run_id
                    WHERE l.workspace_id = ?::uuid AND l.expires_at > now()
                    GROUP BY 1"""
            ).use { stmt ->
                stmt.setString(1, workspaceId)
                stmt.queryTimeout = 3
                stmt.executeQuery().use { rs ->
                    while (rs.next()) {
                        val n = rs.getLong("n")
                        inFlight += n
                        byClass[rs.getString("class")] = n
                    }
                }
            }

            // ── Fleet capacity ────────────────────────────────────────────────
            // Not workspace-scoped, and deliberately coarse: a tenant may see whether
            // the fleet is busy, because that explains their wait. They may not see the
            // per-worker breakdown, which is operator information.
            var workersAlive = 0L
            var slotsTotal = 0L
            var slotsUsed = 0L
            runCatching {
                // `workers`, the same table GET /api/status reads. Not a second fleet
                // view with its own idea of what "alive" means — 60s matches the
                // heartbeat interval times a small margin, so a worker mid-GC is not
                // reported as dead.
                conn.prepareStatement(
                    """SELECT COUNT(*) AS workers,
                              COALESCE(SUM(capacity), 0) AS total,
                              COALESCE(SUM(active_tasks), 0) AS used
                         FROM workers
                        WHERE last_heartbeat_at > now() - INTERVAL '60 seconds'"""
                ).use { stmt ->
                    stmt.queryTimeout = 3
                    stmt.executeQuery().use { rs ->
                        if (rs.next()) {
                            workersAlive = rs.getLong("workers")
                            slotsTotal = rs.getLong("total")
                            slotsUsed = rs.getLong("used")
                        }
                    }
                }
            }.onFailure {
                // Capacity is context, not the answer. A workspace's own queue and
                // in-flight numbers are still correct and still worth returning, so a
                // failure here degrades the response rather than failing it.
                log.warn("[control] fleet capacity unavailable: {}", it.message)
            }

            // ── The workspace's limits, so the UI can explain a wait ──────────
            var maxConcurrent: Long? = null
            runCatching {
                conn.prepareStatement(
                    "SELECT max_concurrent_runs FROM workspace_usage_policies WHERE workspace_id = ?::uuid"
                ).use { stmt ->
                    stmt.setString(1, workspaceId)
                    stmt.queryTimeout = 3
                    stmt.executeQuery().use { rs -> if (rs.next()) maxConcurrent = rs.getLong(1) }
                }
            }

            val atOwnLimit = maxConcurrent != null && inFlight >= maxConcurrent!!
            val fleetFull = slotsTotal > 0 && slotsUsed >= slotsTotal

            Response.ok(mapOf(
                "workspace" to mapOf(
                    "queued" to queuedTotal,
                    "queueByPriority" to queue,
                    "inFlight" to inFlight,
                    "inFlightByClass" to byClass,
                    "maxConcurrentRuns" to maxConcurrent,
                    "utilisation" to maxConcurrent?.let {
                        if (it > 0) (inFlight.toDouble() / it).coerceAtMost(1.0) else null
                    },
                ),
                "fleet" to mapOf(
                    "workersAlive" to workersAlive,
                    "slotsTotal" to slotsTotal,
                    "slotsAvailable" to (slotsTotal - slotsUsed).coerceAtLeast(0),
                ),
                // The reason a run is waiting, decided here rather than inferred in the
                // browser from three numbers. Copy rules: state what happened and what
                // the user can do — "Something went wrong" is never acceptable, and
                // neither is a status page that shows numbers without an interpretation.
                "waitReason" to when {
                    queuedTotal == 0L -> null
                    atOwnLimit -> "You are running the maximum $maxConcurrent runs at once. " +
                        "Queued runs start as current ones finish."
                    fleetFull -> "All workers are busy. Your runs will start as capacity frees up."
                    else -> "Runs are queued and starting shortly."
                },
                "freshness" to mapOf(
                    // Stated explicitly, because the two halves of this response have
                    // genuinely different staleness and a reader who assumes otherwise
                    // will misdiagnose.
                    "workspace" to "live",
                    "fleet" to "up to 15s (worker heartbeat interval)",
                ),
            ))
        }
    }
}
