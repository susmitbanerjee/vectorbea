package com.vectorbea.api.routes

import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import java.time.Instant

/**
 * Health and readiness endpoints.
 *
 * GET /health
 *   Returns basic service liveness. Always 200 if the process is up.
 *   Does NOT check DB/Redis — use /ready for infrastructure checks.
 *
 * GET /ready
 *   Returns readiness with a "checks" map.
 *   Currently returns ok with empty checks (DB/Redis not yet wired).
 *   Phase 2: will add DB ping and Redis ping sub-checks; if any fail → 503.
 */
class HealthRoutes(private val config: AppConfig) {

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

    private fun ready(@Suppress("UNUSED_PARAMETER") req: Request): Response =
        Response.ok(
            ReadyResponse(
                status = "ok",
                checks = emptyMap(),
                // Phase 2 will populate this with:
                // "database" -> CheckResult("ok" / "error", latencyMs),
                // "redis"    -> CheckResult("ok" / "error", latencyMs),
            )
        )

    // ── Response shapes ───────────────────────────────────────────────────────

    data class HealthResponse(
        val status: String,
        val service: String,
        val time: String,
        val version: String,
    )

    data class ReadyResponse(
        val status: String,
        val checks: Map<String, Any>,
    )
}
