package com.vectorbea.telemetry.http

import com.vectorbea.telemetry.config.TelemetryConfig
import com.vectorbea.telemetry.db.Database

class HealthRoutes(
    private val config: TelemetryConfig,
    private val database: Database?,
) {
    fun register(router: Router) {
        router.get("/health") { req ->
            Response.ok(req.exchange, mapOf(
                "status" to "ok",
                "service" to "vectorbea-telemetry",
                "version" to config.version,
                "env" to config.vectorbeaEnv,
            ))
        }

        router.get("/ready") { req ->
            val dbCheck = database?.pingResult()
            val ready = dbCheck?.ok != false
            val status = if (ready) 200 else 503
            Response.json(req.exchange, status, mapOf(
                "ready" to ready,
                "database" to (dbCheck?.let { mapOf("ok" to it.ok, "latencyMs" to it.latencyMs, "error" to it.error) }
                    ?: mapOf("ok" to false, "error" to "not configured")),
                "auth" to mapOf("configured" to (config.jwtSecret != null)),
                "internalToken" to mapOf("configured" to (config.internalToken != null)),
            ))
        }
    }
}
