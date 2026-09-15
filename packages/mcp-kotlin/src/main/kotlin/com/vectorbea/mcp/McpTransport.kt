package com.vectorbea.mcp

import java.net.http.HttpRequest

/**
 * How this module reaches the network — supplied by whoever is calling it.
 *
 * ── WHY AN INTERFACE AND NOT A CLIENT ───────────────────────────────────────
 * The protocol is shared; the egress is not. The worker's outbound calls go
 * through `OutboundHttp` — its clamped total-call ceiling, its streaming byte
 * cap, its pool, its metrics. The API's go through its own SSRF guard and a
 * plain JDK client, because an API request is a person waiting on a page and has
 * a different budget from a run that has already been admitted.
 *
 * Both are correct for their side and neither belongs to the other. So this
 * names the one thing the protocol actually needs — send this request, bounded
 * in time and in bytes — and each service supplies its own.
 *
 * ── THE BOUNDS ARE ARGUMENTS, NOT SUGGESTIONS ───────────────────────────────
 * A customer's MCP server is exactly as able to return a gigabyte, or to never
 * answer, as anybody else's endpoint. An implementation that ignores
 * [maxResponseBytes] or [totalCallMs] is a hole in the isolation this module
 * depends on, not a performance choice.
 */
fun interface McpTransport {

    /**
     * Send [request] and return the response.
     *
     * @param totalCallMs the whole call's ceiling, connect through last byte.
     * @param maxResponseBytes hard cap; exceeding it must throw, never truncate
     *   silently — a truncated JSON-RPC body parses as "not JSON", which is a
     *   legible failure, while a silently truncated one could parse as a
     *   *shorter tool list* and quietly shrink an agent's roster.
     */
    fun send(request: HttpRequest, totalCallMs: Long, maxResponseBytes: Long): Response

    /**
     * What came back.
     *
     * Headers were absent while nothing read one. Three things now do, and each
     * is part of the protocol rather than a convenience: `WWW-Authenticate`
     * names where an OAuth server describes itself (RFC 9728), `Mcp-Session-Id`
     * is how a stateful server knows a call belongs to the session it
     * initialised, and `Content-Type` decides whether the body is plain JSON or
     * a server-sent event stream carrying it.
     *
     * Names are matched case-insensitively by [header]; HTTP header names are.
     */
    data class Response(
        val statusCode: Int,
        val body: String,
        val headers: Map<String, List<String>> = emptyMap(),
    ) {
        fun header(name: String): String? =
            headers.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }
                ?.value?.firstOrNull()
    }
}
