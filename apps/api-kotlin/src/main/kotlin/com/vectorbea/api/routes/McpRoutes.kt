package com.vectorbea.api.routes

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ArrayNode
import com.vectorbea.api.api.context
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.Router
import com.vectorbea.api.http.toJson
import com.vectorbea.api.mcp.McpServer
import org.slf4j.LoggerFactory

/**
 * `POST /api/mcp` — Vectorbea as an MCP server.
 *
 * ── ONE ENDPOINT, WHICH IS THE PROTOCOL ─────────────────────────────────────
 * MCP's Streamable HTTP transport is a single URL that takes JSON-RPC messages.
 * There is no per-method routing to build: the method is in the body, and the
 * dispatch is [McpServer].
 *
 * ── AUTHENTICATED LIKE EVERY OTHER API CALLER ───────────────────────────────
 * Not public, unlike the webhook endpoint. An MCP client is a program acting for
 * a person and it can hold an API key, so it does — which means the key's member
 * cap, the workspace's quota and the audit trail all apply without a second
 * mechanism. A public MCP endpoint would be an unauthenticated way to enumerate
 * a customer's workflows.
 */
class McpRoutes(
    private val server: McpServer,
) {
    private val log = LoggerFactory.getLogger(McpRoutes::class.java)
    private val mapper = ObjectMapper()

    private companion object {
        /**
         * A batch larger than this is not a client, it is a load generator.
         *
         * JSON-RPC batching is in the spec and real clients use it for a handful
         * of messages at connection time. An unbounded batch is one request that
         * can start a thousand runs, past the per-request rate limit that only
         * counted one.
         */
        const val MAX_BATCH = 20
    }

    fun register(router: Router) {
        router.post("/api/mcp", ::handle)

        /*
         * GET on the same URL is how a Streamable HTTP client opens a
         * server-to-client stream for unsolicited messages. This server sends
         * none — it has no subscriptions, no progress notifications and a static
         * tool list — so the spec's own answer is 405, and saying so plainly
         * stops a client waiting on a stream that will never carry anything.
         */
        router.get("/api/mcp", ::noStream)
    }

    private fun handle(req: Request): Response {
        val ctx = req.context()
        val caller = McpServer.Caller(
            workspaceId = ctx.workspaceId,
            environmentId = ctx.environmentId,
            userId = req.principal?.appUserId,
            apiKeyId = req.apiKeyId,
        )

        val root = try {
            mapper.readTree(req.body.ifBlank { "" })
        } catch (e: Exception) {
            /* A parse error has no id to echo, by definition — the id is inside
               the thing that did not parse. The spec says null. */
            return jsonRpc(mapOf(
                "jsonrpc" to "2.0", "id" to null,
                "error" to mapOf(
                    "code" to McpServer.PARSE_ERROR,
                    "message" to "The request body is not valid JSON."),
            ))
        }

        if (root == null || root.isMissingNode || root.isNull) {
            return jsonRpc(mapOf(
                "jsonrpc" to "2.0", "id" to null,
                "error" to mapOf(
                    "code" to McpServer.INVALID_REQUEST,
                    "message" to "The request body is empty."),
            ))
        }

        // ── A batch ──────────────────────────────────────────────────────────
        if (root is ArrayNode) {
            if (root.size() > MAX_BATCH) {
                throw ApiError.ValidationError(
                    "A JSON-RPC batch may contain at most $MAX_BATCH messages.")
            }
            val responses = root.mapNotNull { server.handle(it, caller) }
            /* A batch of nothing but notifications gets 202 and an empty body,
               not `[]` — the spec is explicit, and a client that sees `[]` where
               it expected nothing logs a protocol error on every connect. */
            return if (responses.isEmpty()) Response(202, "",
                mapOf("Content-Type" to "application/json; charset=utf-8"))
            else jsonRpc(responses)
        }

        // ── A single message ─────────────────────────────────────────────────
        val response = server.handle(root, caller)
            ?: return Response(202, "", mapOf("Content-Type" to "application/json; charset=utf-8"))
        return jsonRpc(response)
    }

    private fun noStream(@Suppress("UNUSED_PARAMETER") req: Request): Response = Response(
        status = 405,
        body = toJson(mapOf(
            "error" to mapOf(
                "code" to "STREAM_UNSUPPORTED",
                "message" to "This MCP server does not send unsolicited messages, so there " +
                    "is no stream to open. POST JSON-RPC requests to this URL instead.",
            ),
        )),
        headers = mapOf(
            "Content-Type" to "application/json; charset=utf-8",
            "Allow" to "POST, OPTIONS",
        ),
    )

    /**
     * A JSON-RPC reply.
     *
     * Always HTTP 200, even when the body carries an `error`. That is the point
     * of JSON-RPC over HTTP: the transport succeeded and the payload says what
     * happened. Mapping a JSON-RPC error onto a 4xx makes clients that check the
     * status before parsing throw away the error they needed to read.
     */
    private fun jsonRpc(payload: Any): Response = Response(
        status = 200,
        body = toJson(payload),
        headers = mapOf("Content-Type" to "application/json; charset=utf-8"),
    )
}
