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

        val fleetStatus = when {
            live.isEmpty() -> "down"          // nothing is executing anything
            stale.isNotEmpty() -> "degraded"  // we have lost at least one worker
            capacity > 0 && active >= capacity -> "saturated"
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
            "thresholds" to mapOf(
                "healthySeconds" to HEALTHY_SECONDS,
                "staleSeconds" to STALE_SECONDS,
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
