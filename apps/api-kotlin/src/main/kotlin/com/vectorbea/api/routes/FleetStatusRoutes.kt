package com.vectorbea.api.routes

import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import org.slf4j.LoggerFactory
import java.time.Instant
import java.time.temporal.ChronoUnit
import javax.sql.DataSource

/**
 * `GET /api/status` — real fleet health for the Control page.
 *
 * The `workers` table has carried `capacity`, `active_tasks` and
 * `last_heartbeat_at` since V001 and §6.5 describes it as unused telemetry. It
 * was worse than unused: V006 made `workers.workspace_id NOT NULL` while the
 * worker's heartbeat UPSERT never supplied it, so **every heartbeat write failed
 * from V006 onward** — silently, because the failure is caught and logged at WARN
 * and the loop continues. V021 restores the column to nullable and the heartbeat
 * writes for the first time since.
 *
 * This endpoint turns those rows into the three things an operator asks during an
 * incident:
 *
 *   - **liveness** — which workers are beating, and which have gone quiet
 *   - **load** — how many slots each is using
 *   - **headroom** — how much capacity the fleet has left before queueing starts
 *
 * Liveness is derived from heartbeat age rather than the worker's self-reported
 * `status`, because a worker that has crashed cannot update its own status. The
 * last thing a dead worker says is "idle".
 */
class FleetStatusRoutes(private val dataSource: DataSource) {

    private val log = LoggerFactory.getLogger(FleetStatusRoutes::class.java)

    companion object {
        /**
         * Heartbeat interval is 15 s. Two missed beats is a plausible GC pause or
         * a slow scrape; three is a worker in trouble.
         */
        private const val HEALTHY_SECONDS = 45L

        /** Beyond this, treat the worker as gone rather than merely late. */
        private const val STALE_SECONDS = 120L

        /**
         * Queue depth at which the platform tells users it is busy.
         *
         * Mirrors AdmissionControl's thresholds so the Control page and the
         * trigger endpoint agree. A status page reporting "healthy" while runs
         * are being told they are #200 in queue is worse than no status page.
         */
        private val DEGRADED_DEPTH =
            System.getenv("ADMISSION_IMMEDIATE_BELOW")?.toIntOrNull() ?: 100
        private val SHEDDING_DEPTH =
            System.getenv("ADMISSION_GLOBAL_REJECT")?.toIntOrNull() ?: 2_000
    }

    fun register(router: Router) {
        router.get("/api/status") { req -> status(req) }
    }

    private fun status(req: Request): Response = try {
        val workers = queryWorkers()
        val now = Instant.now()

        val live = workers.filter { it.ageSeconds != null && it.ageSeconds <= HEALTHY_SECONDS }
        val degraded = workers.filter {
            it.ageSeconds != null && it.ageSeconds > HEALTHY_SECONDS && it.ageSeconds <= STALE_SECONDS
        }
        val stale = workers.filter { it.ageSeconds == null || it.ageSeconds > STALE_SECONDS }

        // Capacity accounting counts LIVE workers only. A stale worker's slots are
        // not headroom — nothing will schedule onto them — and including them
        // would report a fleet as healthy precisely while it was losing workers.
        val capacity = live.sumOf { it.capacity }
        val active = live.sumOf { it.activeTasks }
        val headroom = (capacity - active).coerceAtLeast(0)

        // Queue depth is the half of "system health" the workers cannot report.
        // A fleet at 20% utilisation with 4,000 runs queued is not healthy — it is
        // being throttled by per-tenant caps — and a status derived from worker
        // heartbeats alone would call it healthy and be wrong in the direction
        // that matters.
        val queue = runCatching { queryQueue() }.getOrDefault(QueueDepth())

        val fleetStatus = when {
            live.isEmpty() -> "down"                      // nothing is executing anything
            queue.total > SHEDDING_DEPTH -> "shedding"    // non-priority work is being rejected
            stale.isNotEmpty() -> "degraded"              // we have lost at least one worker
            capacity > 0 && active >= capacity -> "saturated"
            queue.total >= DEGRADED_DEPTH -> "busy"       // accepting, but with a visible wait
            degraded.isNotEmpty() -> "degraded"
            else -> "healthy"
        }

        Response.ok(mapOf(
            "status" to fleetStatus,
            "observedAt" to now.toString(),
            "fleet" to mapOf(
                "workers" to workers.size,
                "live" to live.size,
                "degraded" to degraded.size,
                "stale" to stale.size,
                "capacity" to capacity,
                "activeTasks" to active,
                "headroom" to headroom,
                "utilization" to if (capacity > 0) (active.toDouble() / capacity) else 0.0,
            ),
            "workers" to workers.map { w ->
                mapOf(
                    "id" to w.id,
                    "name" to w.name,
                    "liveness" to when {
                        w.ageSeconds == null || w.ageSeconds > STALE_SECONDS -> "stale"
                        w.ageSeconds > HEALTHY_SECONDS -> "degraded"
                        else -> "live"
                    },
                    "reportedStatus" to w.status,
                    "queue" to w.queue,
                    "capacity" to w.capacity,
                    "activeTasks" to w.activeTasks,
                    "headroom" to (w.capacity - w.activeTasks).coerceAtLeast(0),
                    "heartbeatAgeSeconds" to w.ageSeconds,
                    "lastHeartbeatAt" to w.lastHeartbeatAt?.toString(),
                    "version" to w.version,
                    "region" to w.region,
                )
            },
            "queue" to mapOf(
                "depth" to queue.total,
                "inFlight" to queue.inFlight,
                "byClass" to queue.byClass,
                "oldestQueuedSeconds" to queue.oldestSeconds,
                "throughputPerMinute" to queue.completedLastMinute,
            ),
            // What a user is currently being told, so the Control page can show the
            // same sentence the trigger endpoint is returning rather than inventing
            // its own wording for the same state.
            "degradation" to mapOf(
                "state" to fleetStatus,
                // Whether a trigger will succeed — NOT whether it will execute.
                // With no workers, runs are still accepted and queued; they simply
                // do not run. Conflating the two would have the Control page tell
                // users the API is rejecting them when it is not, and the fix for
                // "nothing is executing" is not the fix for "my request was
                // refused".
                "acceptingRuns" to (queue.total <= SHEDDING_DEPTH),
                "sheddingNonPriority" to (queue.total > SHEDDING_DEPTH),
                "message" to when (fleetStatus) {
                    "down" -> "No workers are running. Runs are being queued but nothing is executing them."
                    "shedding" -> "The platform is at capacity. New runs outside the priority lane are " +
                        "being rejected; queued runs are unaffected."
                    "saturated" -> "Every worker slot is busy. New runs are accepted and will start as " +
                        "slots free up."
                    "busy" -> "The queue is deeper than usual. New runs are accepted and return a " +
                        "position and an estimate."
                    "degraded" -> "At least one worker is unhealthy. Capacity is reduced but runs are " +
                        "still executing."
                    else -> "All workers are healthy and the queue is clear."
                },
            ),
            "thresholds" to mapOf(
                "healthySeconds" to HEALTHY_SECONDS,
                "staleSeconds" to STALE_SECONDS,
                "degradedQueueDepth" to DEGRADED_DEPTH,
                "sheddingQueueDepth" to SHEDDING_DEPTH,
            ),
        ))
    } catch (e: Exception) {
        log.error("[status] fleet query failed", e)
        Response(
            status = 503,
            body = """{"status":"unknown","error":"Fleet status unavailable"}""",
            headers = mapOf("Content-Type" to "application/json"),
        )
    }

    private data class WorkerRow(
        val id: String,
        val name: String?,
        val status: String?,
        val queue: String?,
        val capacity: Int,
        val activeTasks: Int,
        val lastHeartbeatAt: Instant?,
        val ageSeconds: Long?,
        val version: String?,
        val region: String?,
    )

    /**
     * Every worker seen in the last hour, not just the live ones.
     *
     * A worker that stopped beating ten minutes ago is the single most useful row
     * on this endpoint — filtering to healthy workers would hide exactly the
     * event an operator opened the page to find.
     */
    /** Queue state, from the run table the claim reads. */
    private data class QueueDepth(
        val total: Int = 0,
        val inFlight: Int = 0,
        val byClass: Map<String, Int> = emptyMap(),
        val oldestSeconds: Long? = null,
        val completedLastMinute: Int = 0,
    )

    /**
     * One statement.
     *
     * `oldestQueuedSeconds` is the number to alert on: depth alone cannot tell a
     * healthy backlog moving fast from a stuck queue, and a run that has been
     * waiting eleven minutes is a support ticket regardless of how many are
     * behind it.
     */
    private fun queryQueue(): QueueDepth = dataSource.connection.use { conn ->
        val byClass = mutableMapOf<String, Int>()
        var total = 0
        conn.prepareStatement(
            """SELECT execution_class, count(*)::int AS n
                 FROM agent_runs WHERE status IN ('queued','yielded')
                GROUP BY execution_class"""
        ).use { stmt ->
            stmt.executeQuery().use { rs ->
                while (rs.next()) {
                    val n = rs.getInt("n")
                    byClass[rs.getString("execution_class") ?: "short"] = n
                    total += n
                }
            }
        }
        conn.prepareStatement(
            """SELECT (SELECT count(*)::int FROM agent_runs
                        WHERE status IN ('claimed','running'))            AS in_flight,
                      (SELECT EXTRACT(EPOCH FROM (now() - MIN(created_at)))::bigint
                         FROM agent_runs WHERE status IN ('queued','yielded')) AS oldest,
                      (SELECT count(*)::int FROM agent_runs
                        WHERE completed_at > now() - interval '1 minute')  AS done"""
        ).use { stmt ->
            stmt.executeQuery().use { rs ->
                if (rs.next()) {
                    val oldest = rs.getLong("oldest").takeIf { !rs.wasNull() }
                    return QueueDepth(total, rs.getInt("in_flight"), byClass, oldest, rs.getInt("done"))
                }
            }
        }
        QueueDepth(total, 0, byClass)
    }

    private fun queryWorkers(): List<WorkerRow> {
        val cutoff = Instant.now().minus(1, ChronoUnit.HOURS)
        dataSource.connection.use { conn ->
            conn.prepareStatement(
                """
                SELECT id, name, status, queue, capacity, active_tasks,
                       last_heartbeat_at, version, region
                  FROM workers
                 WHERE last_heartbeat_at IS NULL OR last_heartbeat_at >= ?
                 ORDER BY last_heartbeat_at DESC NULLS LAST
                """.trimIndent()
            ).use { stmt ->
                stmt.setTimestamp(1, java.sql.Timestamp.from(cutoff))
                stmt.executeQuery().use { rs ->
                    val out = mutableListOf<WorkerRow>()
                    val now = Instant.now()
                    while (rs.next()) {
                        val hb = rs.getTimestamp("last_heartbeat_at")?.toInstant()
                        out += WorkerRow(
                            id = rs.getString("id"),
                            name = rs.getString("name"),
                            status = rs.getString("status"),
                            queue = rs.getString("queue"),
                            capacity = rs.getInt("capacity"),
                            activeTasks = rs.getInt("active_tasks"),
                            lastHeartbeatAt = hb,
                            ageSeconds = hb?.let { ChronoUnit.SECONDS.between(it, now) },
                            version = rs.getString("version"),
                            region = rs.getString("region"),
                        )
                    }
                    return out
                }
            }
        }
    }
}
