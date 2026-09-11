package com.vectorbea.mcp

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import java.net.URI
import java.net.http.HttpRequest

/**
 * The MCP wire protocol: JSON-RPC 2.0 over HTTP.
 *
 * ── WHAT THIS IS FOR, AND WHAT IT IS NOT ────────────────────────────────────
 * MCP is a discovery and invocation protocol. A server calling Salesforce makes
 * the same REST call a direct integration would and returns the same forty fields
 * of nested JSON — so nothing here improves the *quality* of a result. That is
 * the result contract layer's job, and MCP results go through it exactly like an
 * HTTP tool's.
 *
 * What this buys is the product story: a customer connects their own tools
 * without us writing an integration for each. It is ADDITIVE — `http` and
 * `database` are untouched, because a customer with a plain REST endpoint must
 * not have to wrap it in an MCP server first.
 *
 * ── EVERY RESPONSE IS UNTRUSTED ─────────────────────────────────────────────
 * This is a customer's server, and its tool descriptions reach the model's
 * prompt. That makes them an injection surface with a direct route to the thing
 * being protected. Nothing in this file trusts a field: sizes are bounded by the
 * [McpTransport]'s byte cap, and everything textual is sanitized by
 * [McpSanitizer] before it is stored or shown. See [McpDiscovery].
 *
 * ── ONE TRANSPORT, DELIBERATELY ─────────────────────────────────────────────
 * `streamable-http` only. SSE is in the specification and is not implemented
 * here: it needs a long-lived connection held against a worker slot, which is the
 * shape this runtime spends most of its effort avoiding, and it buys nothing for
 * request/response tool calls. A connection configured for `sse` is refused with
 * that sentence rather than silently downgraded — a transport that half works is
 * worse than one that says it does not.
 */
class McpClient(
    /**
     * Supplied by the caller, because egress is the caller's business. See
     * [McpTransport]. There is no default: a default would be one service's
     * egress policy silently applied to the other's calls.
     */
    private val transport: McpTransport,
) {
    private val mapper = ObjectMapper()

    data class Server(
        val connectionId: java.util.UUID,
        val url: String,
        val transport: String = "streamable-http",
        /** Bearer token, when the connection carries one. Never logged. */
        val authToken: String? = null,
        val timeoutMs: Long = DEFAULT_TIMEOUT_MS,
    )

    /** A JSON-RPC failure, or a protocol-level one. Carries what a contract needs. */
    class McpException(
        message: String,
        /** JSON-RPC error code, when the server returned one. */
        val rpcCode: Int? = null,
        /** HTTP status, when the failure was at that level. */
        val httpStatus: Int? = null,
    ) : RuntimeException(message)

    // ── Protocol ─────────────────────────────────────────────────────────────

    /** `tools/list` — what this server offers. */
    fun listTools(server: Server): List<JsonNode> =
        arrayField(call(server, "tools/list", mapper.createObjectNode()), "tools")

    /** `resources/list` — read-only context an agent can pull on demand. */
    fun listResources(server: Server): List<JsonNode> =
        arrayField(call(server, "resources/list", mapper.createObjectNode()), "resources")

    /** `resources/read` — the contents of one resource, by uri. */
    fun readResource(server: Server, uri: String): JsonNode =
        call(server, "resources/read", mapper.createObjectNode().put("uri", uri))

    /** `tools/call` — invoke one remote tool. */
    fun callTool(server: Server, name: String, arguments: Map<String, Any?>): JsonNode {
        val params = mapper.createObjectNode()
        params.put("name", name)
        params.set<JsonNode>("arguments", mapper.valueToTree(arguments))
        return call(server, "tools/call", params)
    }

    /**
     * One JSON-RPC round trip.
     *
     * ── WHY A FAILURE HERE IS AN EXCEPTION AND NOT A NULL ───────────────────
     * Every caller has to distinguish "the server said no" from "the server is
     * unreachable" from "the server answered nonsense", because those map to
     * different error contracts and different retry advice. A null collapses all
     * three into the one thing an agent cannot act on.
     */
    private fun call(server: Server, method: String, params: JsonNode): JsonNode {
        if (server.transport != "streamable-http") {
            throw McpException(
                "MCP transport '${server.transport}' is not supported. " +
                "Only streamable-http is implemented; configure the server for HTTP.")
        }

        val payload = mapper.createObjectNode().apply {
            put("jsonrpc", "2.0")
            put("id", java.util.UUID.randomUUID().toString())
            put("method", method)
            set<JsonNode>("params", params)
        }

        val builder = HttpRequest.newBuilder()
            .uri(URI.create(server.url))
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            /* MCP negotiates a protocol version. Sending ours explicitly means a
               server that speaks a different one can say so, rather than
               answering with a shape we would then misread. */
            .header("MCP-Protocol-Version", PROTOCOL_VERSION)
            .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(payload)))
        server.authToken?.takeIf { it.isNotBlank() }?.let {
            builder.header("Authorization", "Bearer $it")
        }

        val response = try {
            transport.send(builder.build(), server.timeoutMs, MAX_RESPONSE_BYTES)
        } catch (e: Exception) {
            /* The message, never the exception: a stack trace from an HTTP client
               carries the URL, and an MCP server URL can carry a token in its
               path. The cause class is enough to classify. */
            throw McpException(
                "could not reach the MCP server (${e.javaClass.simpleName})")
        }

        if (response.statusCode !in 200..299) {
            throw McpException(
                "the MCP server returned HTTP ${response.statusCode}",
                httpStatus = response.statusCode)
        }

        val root = try {
            mapper.readTree(response.body)
        } catch (_: Exception) {
            throw McpException("the MCP server returned a body that is not JSON")
        }

        root["error"]?.let { err ->
            /* A JSON-RPC error is the server declining, which is a different thing
               from the server being broken — and the distinction is exactly what
               the error contract needs to decide whether retrying could help. */
            val code = err["code"]?.asInt()
            val msg = McpSanitizer.text(err["message"]?.asText(), MAX_ERROR_CHARS)
            throw McpException(
                "the MCP server refused the call${msg?.let { ": $it" } ?: ""}",
                rpcCode = code)
        }

        return root["result"]
            ?: throw McpException("the MCP server's reply had no result and no error")
    }

    private fun arrayField(result: JsonNode, field: String): List<JsonNode> =
        (result[field] as? com.fasterxml.jackson.databind.node.ArrayNode)?.toList()
            ?: emptyList()

    companion object {
        /** The revision this client implements. Sent, so a mismatch is the server's to report. */
        const val PROTOCOL_VERSION = "2025-06-18"

        /**
         * Ceiling on one MCP response.
         *
         * A manifest is small; a `tools/call` result is a tool result and can be
         * anything. Bounded by the same streaming cap every other outbound call
         * uses, because a customer's server is exactly as able to return a
         * gigabyte as anybody else's endpoint.
         */
        const val MAX_RESPONSE_BYTES = 1_048_576L

        const val DEFAULT_TIMEOUT_MS = 15_000L

        /** A server's error text is untrusted and goes near a prompt. */
        const val MAX_ERROR_CHARS = 300
    }
}
