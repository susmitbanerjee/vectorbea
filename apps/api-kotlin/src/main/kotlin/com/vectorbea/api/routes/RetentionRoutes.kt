package com.vectorbea.api.routes

import com.vectorbea.api.api.context
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import org.slf4j.LoggerFactory
import java.sql.Timestamp
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import javax.sql.DataSource

/**
 * What this workspace keeps, until when, and what it can do about it.
 *
 * ── WHY THE DATES ARE COMPUTED SERVER-SIDE ──────────────────────────────────
 * §4 asks for "clear in-product messaging with dates", and a date the client
 * derives is a date that can disagree with the deleter. The sweeper's cutoff is
 * `now() - days`; if the page subtracted its own days from its own clock, a
 * customer in another timezone reading a cached response would be told a
 * different day from the one the job will act on. So every date here is the one
 * the job will use, computed from the same policy function the job calls.
 *
 * ── THE HEARTBEAT IS PUBLIC, THE REST IS WORKSPACE-SCOPED ───────────────────
 * `/health/retention` answers "did the job run" for the fleet and needs no
 * credentials, because the thing that asks is an uptime check. Everything else
 * here goes through `req.context()`, which has already verified the workspace
 * against the caller's memberships.
 *
 * ── AND WHY THERE IS NO "RESTORE" ───────────────────────────────────────────
 * Because retention is a deletion, not a filter. Once the sweep has run, the
 * rows are gone from Postgres and the only copy is the export bundle. The
 * honest surface for that is a download, which is what `exports` below is —
 * not an undelete button that would work for a week and then quietly stop.
 */
class RetentionRoutes(private val ds: DataSource) {

    private val log = LoggerFactory.getLogger(RetentionRoutes::class.java)

    /** Mirrors `RetentionEntity` in the worker. Two services, no shared module. */
    private val entities = listOf("runs", "events", "traces", "payloads", "archives")

    private val labels = mapOf(
        "runs" to "Run history",
        "events" to "Run events",
        "traces" to "Traces and spans",
        "payloads" to "Prompts and payloads",
        "archives" to "Warm-tier archives",
    )

    fun register(router: Router) {
        router.get("/api/retention", ::policy)
        router.get("/api/retention/deletions", ::deletions)
        router.get("/api/retention/exports", ::listExports)
        router.post("/api/retention/exports", ::requestExport)
        /* `/health/...` and NOT `/api/health/...`, deliberately: AuthMiddleware
           treats `/health` as a public PREFIX, so this path is reachable without
           a JWT and `/api/health/retention` would not be. An alert has no
           credentials. It carries no tenant data — a timestamp and fleet-wide
           counts, nothing per-customer. */
        router.get("/health/retention", ::health)
    }

    // ── GET /api/retention ────────────────────────────────────────────────────

    private fun policy(req: Request): Response {
        val ctx = req.context()

        val rows = ds.connection.use { c ->
            entities.map { entity ->
                val (days, source) = c.prepareStatement(
                    "SELECT days, source FROM retention_effective_days(?, ?)"
                ).use { st ->
                    st.setObject(1, ctx.workspaceId); st.setString(2, entity)
                    st.executeQuery().use { rs ->
                        if (rs.next()) rs.getInt("days") to rs.getString("source") else 0 to "plan"
                    }
                }

                val state = c.prepareStatement(
                    """SELECT effective_days, previous_days, changed_at, grace_until, notified_at
                         FROM workspace_retention_state WHERE workspace_id = ? AND entity = ?"""
                ).use { st ->
                    st.setObject(1, ctx.workspaceId); st.setString(2, entity)
                    st.executeQuery().use { rs ->
                        if (!rs.next()) null else mapOf(
                            "planDays" to rs.getInt("effective_days"),
                            "previousDays" to (rs.getObject("previous_days") as? Int),
                            "changedAt" to rs.getTimestamp("changed_at")?.toInstant()?.toString(),
                            "graceUntil" to rs.getTimestamp("grace_until")?.toInstant()?.toString(),
                            "notifiedAt" to rs.getTimestamp("notified_at")?.toInstant()?.toString(),
                        )
                    }
                }

                val graceUntil = (state?.get("graceUntil") as? String)?.let { Instant.parse(it) }
                val inGrace = source == "grace" && graceUntil != null && graceUntil.isAfter(Instant.now())

                buildMap<String, Any?> {
                    put("entity", entity)
                    put("label", labels[entity] ?: entity)
                    put("days", days)
                    put("source", source)
                    /* THE date: everything older than this goes on the next
                       sweep. The same arithmetic the sweeper does, so the page
                       and the job cannot disagree. */
                    put("deletesBefore", Instant.now().minus(days.toLong(), ChronoUnit.DAYS).toString())
                    put("inGrace", inGrace)
                    if (inGrace) {
                        put("graceUntil", graceUntil.toString())
                        put("planDays", state?.get("planDays"))
                        put("previousDays", state?.get("previousDays"))
                        put("changedAt", state?.get("changedAt"))
                        /* What the window becomes when grace ends, and when the
                           first deletion under it will happen. A downgrade
                           warning without this is a warning nobody can plan
                           around. */
                        put("afterGraceDeletesBefore",
                            graceUntil.minus((state?.get("planDays") as? Int ?: days).toLong(), ChronoUnit.DAYS)
                                .toString())
                    }
                }
            }
        }

        val storage = ds.connection.use { c ->
            c.prepareStatement("SELECT entity, rows, bytes FROM workspace_storage_bytes(?)").use { st ->
                st.setObject(1, ctx.workspaceId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(mapOf(
                            "entity" to rs.getString("entity"),
                            "rows" to rs.getLong("rows"),
                            "bytes" to rs.getLong("bytes"),
                        ))
                    }
                }
            }
        }

        return Response.ok(mapOf(
            "workspaceId" to ctx.workspaceId.toString(),
            "entities" to rows,
            "storage" to storage,
            /* Estimated, and the response says so rather than letting a page
               render it as a bill. See workspace_storage_bytes's comment. */
            "storageIsEstimate" to true,
        ))
    }

    // ── GET /api/retention/deletions ──────────────────────────────────────────

    /**
     * What was deleted, under which policy, when (§7).
     *
     * Workspace-scoped: a tenant may read their own deletions and nobody else's.
     * The platform-wide rows (a partition drop, an archive retirement) carry a
     * null workspace and are deliberately NOT returned here — they are fleet
     * operations, and exposing them would tell one customer when another's data
     * moved.
     */
    private fun deletions(req: Request): Response {
        val ctx = req.context()
        val limit = req.query("limit")?.toIntOrNull()?.coerceIn(1, 500) ?: 100

        val rows = ds.connection.use { c ->
            c.prepareStatement(
                """SELECT entity, policy_days, policy_source, plan_code, cutoff, scope,
                          rows_deleted, bytes_freed, export_key, deleted_at
                     FROM retention_deletions
                    WHERE workspace_id = ?
                    ORDER BY deleted_at DESC
                    LIMIT ?"""
            ).use { st ->
                st.setObject(1, ctx.workspaceId)
                st.setInt(2, limit)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(mapOf(
                            "entity" to rs.getString("entity"),
                            "label" to (labels[rs.getString("entity")] ?: rs.getString("entity")),
                            "policyDays" to rs.getInt("policy_days"),
                            "policySource" to rs.getString("policy_source"),
                            "plan" to rs.getString("plan_code"),
                            "cutoff" to rs.getTimestamp("cutoff").toInstant().toString(),
                            "scope" to rs.getString("scope"),
                            "rowsDeleted" to rs.getLong("rows_deleted"),
                            "bytesFreed" to rs.getLong("bytes_freed"),
                            /* Whether a bundle was written first. Null is a real
                               answer — data already archived needs no second
                               copy — and it is the first thing an auditor asks. */
                            "exportKey" to rs.getString("export_key"),
                            "deletedAt" to rs.getTimestamp("deleted_at").toInstant().toString(),
                        ))
                    }
                }
            }
        }
        return Response.ok(mapOf("deletions" to rows))
    }

    // ── Exports ───────────────────────────────────────────────────────────────

    private fun listExports(req: Request): Response {
        val ctx = req.context()
        val rows = ds.connection.use { c ->
            c.prepareStatement(
                """SELECT id, kind, entities, period_start, period_end, status,
                          row_count, byte_count, error, created_at, expires_at
                     FROM workspace_exports
                    WHERE workspace_id = ?
                    ORDER BY created_at DESC
                    LIMIT 50"""
            ).use { st ->
                st.setObject(1, ctx.workspaceId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(mapOf(
                            "id" to rs.getObject("id", UUID::class.java).toString(),
                            "kind" to rs.getString("kind"),
                            "entities" to ((rs.getArray("entities")?.array as? Array<*>)?.map { it.toString() }
                                ?: emptyList<String>()),
                            "periodStart" to rs.getTimestamp("period_start")?.toInstant()?.toString(),
                            "periodEnd" to rs.getTimestamp("period_end")?.toInstant()?.toString(),
                            "status" to rs.getString("status"),
                            "rowCount" to rs.getLong("row_count"),
                            "byteCount" to rs.getLong("byte_count"),
                            "error" to rs.getString("error"),
                            "createdAt" to rs.getTimestamp("created_at").toInstant().toString(),
                            "expiresAt" to rs.getTimestamp("expires_at")?.toInstant()?.toString(),
                        ))
                    }
                }
            }
        }
        return Response.ok(mapOf("exports" to rows))
    }

    /**
     * Queue an export. Returns immediately with an id to poll.
     *
     * The API does not stream the bundle itself: it can be gigabytes, and an
     * HTTP request held open for the duration is a request that dies to a proxy
     * timeout halfway through and leaves a half-written object. So the row is
     * written `queued`, a worker claims it, and the client watches `status`.
     *
     * ONE RUNNING EXPORT PER WORKSPACE. Not a rate limit dressed up: a customer
     * who clicks twice would otherwise pay for two identical multi-gigabyte
     * scans of the same rows, and the second bundle is worth nothing.
     */
    private fun requestExport(req: Request): Response {
        val ctx = req.context()

        data class Body(val entities: List<String>? = null, val from: String? = null, val to: String? = null)
        val body = runCatching {
            req.body.takeIf { it.isNotBlank() }?.let { req.bodyAs<Body>() }
        }.getOrNull() ?: Body()

        val requested = (body.entities ?: listOf("runs", "events", "traces"))
            .filter { it in entities }
            .ifEmpty { listOf("runs", "events", "traces") }

        val from = body.from?.let { runCatching { Instant.parse(it) }.getOrNull() }
        val to = body.to?.let { runCatching { Instant.parse(it) }.getOrNull() } ?: Instant.now()

        return ds.connection.use { c ->
            val inFlight = c.prepareStatement(
                """SELECT id FROM workspace_exports
                    WHERE workspace_id = ? AND status IN ('queued','running')
                    LIMIT 1"""
            ).use { st ->
                st.setObject(1, ctx.workspaceId)
                st.executeQuery().use { rs -> if (rs.next()) rs.getObject(1, UUID::class.java) else null }
            }
            if (inFlight != null) {
                throw ApiError.Conflict(
                    "An export is already running for this workspace. Wait for it to finish, " +
                        "then start another.")
            }

            val id = c.prepareStatement(
                """INSERT INTO workspace_exports
                     (workspace_id, kind, entities, period_start, period_end, status, requested_by_user_id)
                   VALUES (?, 'on_demand', ?, ?, ?, 'queued', ?)
                   RETURNING id"""
            ).use { st ->
                st.setObject(1, ctx.workspaceId)
                st.setArray(2, c.createArrayOf("text", requested.toTypedArray()))
                st.setObject(3, from?.let { Timestamp.from(it) })
                st.setObject(4, Timestamp.from(to))
                st.setObject(5, req.principal?.appUserId)
                st.executeQuery().use { rs -> rs.next(); rs.getObject(1, UUID::class.java) }
            }

            log.info("[export] queued export {} for workspace {}", id, ctx.workspaceId)
            Response(
                status = 202,
                body = com.vectorbea.api.http.toJson(mapOf(
                    "id" to id.toString(),
                    "status" to "queued",
                    "entities" to requested,
                )),
                headers = mapOf("Content-Type" to "application/json; charset=utf-8"),
            )
        }
    }

    // ── GET /api/health/retention ─────────────────────────────────────────────

    /**
     * Did the retention job run, and how long ago (§6).
     *
     * ── WHY THIS IS A 503 AND NOT A FIELD ───────────────────────────────────
     * "A retention job that silently stopped is how you discover storage growth
     * three months late." A health endpoint that returns 200 with
     * `{"stale": true}` needs somebody to have written an alert rule on that
     * field. One that returns 503 is picked up by the uptime check that already
     * exists — the one nobody has to remember to configure.
     *
     * Two distinct failures, reported separately, because the fixes differ:
     *   stale     nothing has SUCCEEDED inside the window. The job is stopped,
     *             crashing, or never started.
     *   stuck     a sweep has been `running` for longer than any sweep should
     *             take. It holds the Redis lock, so nothing else can start —
     *             which looks exactly like "stale" from the outside and is not.
     */
    private fun health(req: Request): Response {
        val staleAfterHours = System.getenv("RETENTION_STALE_AFTER_HOURS")?.toLongOrNull() ?: 26L

        data class Snapshot(
            val lastSuccess: Instant?, val lastStatus: String?, val running: Int,
            val oldestRunningMinutes: Long?, val rows: Long, val bytes: Long,
        )

        val snap = ds.connection.use { c ->
            c.prepareStatement(
                """SELECT (SELECT max(finished_at) FROM retention_sweeps WHERE status='succeeded') AS last_success,
                          (SELECT status FROM retention_sweeps ORDER BY started_at DESC LIMIT 1) AS last_status,
                          (SELECT count(*)::int FROM retention_sweeps WHERE status='running')     AS running,
                          (SELECT EXTRACT(EPOCH FROM (now() - min(started_at)))/60
                             FROM retention_sweeps WHERE status='running')                        AS oldest_running_min,
                          (SELECT COALESCE(sum(rows_deleted),0) FROM retention_sweeps
                            WHERE finished_at > now() - interval '7 days')                        AS rows_7d,
                          (SELECT COALESCE(sum(bytes_freed),0) FROM retention_sweeps
                            WHERE finished_at > now() - interval '7 days')                        AS bytes_7d"""
            ).use { st ->
                st.queryTimeout = 5
                st.executeQuery().use { rs ->
                    rs.next()
                    Snapshot(
                        lastSuccess = rs.getTimestamp("last_success")?.toInstant(),
                        lastStatus = rs.getString("last_status"),
                        running = rs.getInt("running"),
                        oldestRunningMinutes = rs.getObject("oldest_running_min")
                            ?.let { (it as Number).toLong() },
                        rows = rs.getLong("rows_7d"),
                        bytes = rs.getLong("bytes_7d"),
                    )
                }
            }
        }

        val ageHours = snap.lastSuccess?.let { ChronoUnit.HOURS.between(it, Instant.now()) }
        val stale = ageHours == null || ageHours > staleAfterHours
        // Twice the sweeper's default 600s budget, plus room for a slow batch.
        val stuck = (snap.oldestRunningMinutes ?: 0L) > 30L

        val body = mapOf(
            "status" to when {
                stuck -> "stuck"
                stale -> "stale"
                else -> "ok"
            },
            "lastSuccessAt" to snap.lastSuccess?.toString(),
            "lastSuccessAgeHours" to ageHours,
            "staleAfterHours" to staleAfterHours,
            "lastSweepStatus" to snap.lastStatus,
            "sweepsRunning" to snap.running,
            "oldestRunningMinutes" to snap.oldestRunningMinutes,
            "rowsDeleted7d" to snap.rows,
            "bytesFreed7d" to snap.bytes,
            "message" to when {
                stuck -> "A retention sweep has been running for ${snap.oldestRunningMinutes} minutes " +
                    "and holds the sweep lock. Nothing else can start until it finishes or its lock expires."
                ageHours == null -> "No retention sweep has ever succeeded."
                stale -> "The last successful retention sweep was ${ageHours}h ago, " +
                    "past the ${staleAfterHours}h threshold. Storage will grow until it runs."
                else -> "Last successful sweep ${ageHours}h ago."
            },
        )

        return if (stale || stuck) {
            Response(
                status = 503,
                body = com.vectorbea.api.http.toJson(body),
                headers = mapOf("Content-Type" to "application/json; charset=utf-8"),
            )
        } else Response.ok(body)
    }
}
