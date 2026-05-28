package com.vectorbea.api.routes

import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.metrics.MetricsRegistry

/**
 * Exposes the internal Prometheus text exposition at GET /metrics.
 *
 * The endpoint is intentionally unauthenticated but should be firewalled in
 * production (accessible only from the monitoring scraper's subnet).
 *
 * No PII is present in metrics — label values are method names, status classes,
 * and normalised path patterns (no IDs).
 */
class MetricsRoutes {

    fun register(router: Router) {
        router.get("/metrics", ::scrape)
    }

    private fun scrape(@Suppress("UNUSED_PARAMETER") req: com.vectorbea.api.http.Request): Response {
        val body = MetricsRegistry.scrape()
        return Response(
            status = 200,
            body = body,
            headers = mapOf(
                // OpenMetrics content type — Prometheus and compatible scrapers accept both
                "Content-Type" to "text/plain; version=0.0.4; charset=utf-8",
                "Cache-Control" to "no-cache, no-store",
            ),
        )
    }
}
