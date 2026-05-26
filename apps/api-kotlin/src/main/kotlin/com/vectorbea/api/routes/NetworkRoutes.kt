package com.vectorbea.api.routes

import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router

/**
 * Network information routes.
 *
 * GET /api/network/outbound-ips — returns the outbound IP(s) of this service,
 * read from VECTORBEA_OUTBOUND_IPS env var.
 *
 * This allows users to whitelist the service's IPs at remote providers.
 */
class NetworkRoutes {

    fun register(router: Router) {
        router.get("/api/network/outbound-ips", ::outboundIps)
    }

    private fun outboundIps(req: Request): Response {
        val raw = System.getenv("VECTORBEA_OUTBOUND_IPS")?.trim()
        val ips = if (!raw.isNullOrBlank()) {
            raw.split(",").map { it.trim() }.filter { it.isNotEmpty() }
        } else {
            emptyList()
        }

        return Response.ok(mapOf(
            "ips" to ips,
            "note" to if (ips.isEmpty())
                "VECTORBEA_OUTBOUND_IPS not configured — whitelist your deployment's egress IP(s)"
            else
                "Whitelist these IPs at your external provider to allow connections from this service",
        ))
    }
}
