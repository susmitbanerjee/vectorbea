package com.vectorbea.api.routes

import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.db.Database
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import java.time.Instant

/**
 * Health and readiness endpoints.
 *
 * GET /health
 *   Returns basic service liveness. Always 200 if the process is up.
 *   Does NOT check DB — use /ready for infrastructure checks.
 *
 * GET /ready
 *   Returns readiness with a "checks" map containing each infrastructure component.
 *   Responds 503 if any required check fails.
 *
 *   Shape:
 *   {
 *     "status": "ok" | "error",
 *     "checks": {
 *       "database": { "ok": true, "latencyMs": 3 }
 *     }
 *   }
 */
class HealthRoutes(
    private val config: AppConfig,
    private val database: Database? = null,
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
        val checks = mutableMapOf<String, CheckResult>()
        var allOk = true

        // Database check — only if DB is configured
        if (database != null) {
            val ping = database.pingResult()
            val result = CheckResult(ok = ping.ok, latencyMs = ping.latencyMs, error = ping.error)
            checks["database"] = result
            if (!ping.ok) allOk = false
        }

        val status = if (allOk) "ok" else "error"
        val body = ReadyResponse(status = status, checks = checks)
        return if (allOk) Response.ok(body) else Response.json(503, body)
    }

    // ── Response shapes ───────────────────────────────────────────────────────

    data class HealthResponse(
        val status: String,
        val service: String,
        val time: String,
        val version: String,
    )

    data class CheckResult(
        val ok: Boolean,
        val latencyMs: Long?,
        val error: String? = null,
    )

    data class ReadyResponse(
        val status: String,
        val checks: Map<String, CheckResult>,
    )
}
