package com.vectorbea.telemetry.http

import com.vectorbea.telemetry.analytics.AnalyticsIngestionService
import com.vectorbea.telemetry.analytics.IngestBatchRequest
import com.vectorbea.telemetry.auth.TelemetryAuthMiddleware

class IngestionRoutes(
    private val auth: TelemetryAuthMiddleware,
    private val ingestionService: AnalyticsIngestionService,
) {
    fun register(router: Router) {
        // User-authenticated ingestion (frontend or SDK)
        router.post("/api/telemetry/events") { req ->
            val claims = auth.requireAuth(req) ?: return@post
            val batch = req.bodyAs<IngestBatchRequest>()
            val result = ingestionService.ingestBatch(batch, sourceService = "user-client")
            Response.ok(req.exchange, mapOf(
                "accepted" to result.accepted,
                "rejected" to result.rejected,
                "errors" to result.errors,
            ))
        }

        // Internal service-to-service ingestion (api-kotlin, worker-kotlin)
        router.post("/internal/telemetry/events") { req ->
            if (!auth.requireInternalToken(req)) return@post
            val sourceService = req.header("X-Source-Service") ?: "internal"
            val batch = req.bodyAs<IngestBatchRequest>()
            val result = ingestionService.ingestBatch(batch, sourceService = sourceService)
            Response.ok(req.exchange, mapOf(
                "accepted" to result.accepted,
                "rejected" to result.rejected,
                "errors" to result.errors,
            ))
        }
    }
}
