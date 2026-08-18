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
        // Two registries: the API's own, which predates observability-kotlin, and the
        // shared one that new metrics register in. Rendered together because Prometheus
        // scrapes one endpoint per target and does not care that the process has two
        // internal collections. The local one is being migrated (D35), not kept.
        val body = MetricsRegistry.scrape() +
            com.vectorbea.observability.metrics.MetricsRegistry.scrape()
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
