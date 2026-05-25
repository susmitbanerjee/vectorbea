package com.vectorbea.api.routes

import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.db.Database
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.redis.RedisProvider
import java.time.Instant

/**
 * Health and readiness endpoints.
 *
 * GET /health
 *   Returns basic service liveness. Always 200 if the process is up.
 *   Does NOT check DB or Redis — use /ready for infrastructure checks.
 *
 * GET /ready
 *   Returns infrastructure readiness. Checks DB and Redis.
 *
 *   Status semantics:
 *     "ok"       — all configured checks passed
 *     "degraded" — non-critical check failed (Redis missing in local/dev)
 *     "error"    — critical check failed → HTTP 503
 *
 *   Shape:
 *   {
 *     "status": "ok" | "degraded" | "error",
 *     "checks": {
 *       "db":    "ok" | "error",
 *       "redis": "ok" | "error" | "disabled"
 *     }
 *   }
 *
 *   HTTP codes:
 *     200 — status ok or degraded (degraded means non-critical path)
 *     503 — status error (required infra is down)
 */
class HealthRoutes(
    private val config: AppConfig,
    private val database: Database? = null,
    private val redis: RedisProvider? = null,
) {

    fun register(router: Router) {
        router.get("/health", ::health)
        router.get("/ready", ::ready)
    }

    private fun health(@Suppress("UNUSED_PARAMETER") req: Request): Response =
        Response.ok(
            HealthResponse(
                status = "ok",
                service = "vectorbea-api",
                time = Instant.now().toString(),
                version = config.version,
            )
        )

    private fun ready(@Suppress("UNUSED_PARAMETER") req: Request): Response {
        val checks = mutableMapOf<String, String>()
        var hasError = false
        var hasDegraded = false

        // ── Database check ────────────────────────────────────────────────────
        if (database != null) {
            val ping = database.pingResult()
            checks["db"] = if (ping.ok) "ok" else "error"
            if (!ping.ok) hasError = true
        } else {
            checks["db"] = "disabled"
            // DB not configured — always an error (DB is required)
            hasError = true
        }

        // ── Redis check ───────────────────────────────────────────────────────
        if (redis != null) {
            val ping = redis.pingResult()
            checks["redis"] = if (ping.ok) "ok" else "error"
            if (!ping.ok) {
                // Redis failure is degraded in local/dev, hard error in production
                if (config.isProduction) hasError = true else hasDegraded = true
            }
        } else {
            checks["redis"] = "disabled"
            if (config.isProduction) {
                // Redis required in production
                hasError = true
            } else {
                hasDegraded = true
            }
        }

        val status = when {
            hasError -> "error"
            hasDegraded -> "degraded"
            else -> "ok"
        }

        val body = ReadyResponse(status = status, checks = checks)
        // 503 only for hard errors; degraded still returns 200 so load balancers pass traffic
        return if (hasError) Response.json(503, body) else Response.ok(body)
    }

    // ── Response shapes ───────────────────────────────────────────────────────

    data class HealthResponse(
        val status: String,
        val service: String,
        val time: String,
        val version: String,
    )

    data class ReadyResponse(
        val status: String,
        val checks: Map<String, String>,
    )
}
