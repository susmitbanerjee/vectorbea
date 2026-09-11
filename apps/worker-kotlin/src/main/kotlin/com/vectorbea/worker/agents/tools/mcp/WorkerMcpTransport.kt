package com.vectorbea.worker.agents.tools.mcp

import com.vectorbea.mcp.McpTransport
import com.vectorbea.worker.net.OutboundHttp
import java.net.http.HttpRequest

/**
 * The worker's egress, handed to the shared MCP protocol module.
 *
 * ── WHY THE WORKER SUPPLIES ITS OWN ─────────────────────────────────────────
 * `OutboundHttp` is the one place this service's outbound calls are bounded: the
 * clamped total-call ceiling, the streaming byte cap that refuses rather than
 * truncates, the shared connection pool, the metrics. An MCP server is somebody
 * else's endpoint and gets exactly those terms, the same ones an HTTP tool gets —
 * which is the whole claim in MCP.md §6, and it would stop being true the moment
 * this module reached the network some other way.
 *
 * The API supplies a different one, for its own reasons. See [McpTransport].
 */
object WorkerMcpTransport : McpTransport {

    override fun send(
        request: HttpRequest,
        totalCallMs: Long,
        maxResponseBytes: Long,
    ): McpTransport.Response {
        /* clampTotalCallMs, not the raw value: a per-tool timeout may ask for
           longer than this worker's policy allows, and the policy wins. */
        val result = OutboundHttp.send(
            request,
            OutboundHttp.policy().clampTotalCallMs(totalCallMs),
            maxResponseBytes,
        )
        return McpTransport.Response(result.statusCode, result.body)
    }
}
