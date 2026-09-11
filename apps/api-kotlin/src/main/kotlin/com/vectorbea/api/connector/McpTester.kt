package com.vectorbea.api.connector

import com.vectorbea.api.mcp.ApiMcpTransport
import com.vectorbea.api.security.SsrfGuard
import com.vectorbea.mcp.McpClient
import java.util.UUID

/**
 * Test an MCP connection by asking it what it offers.
 *
 * ── WHY THIS IS NOT `HttpTester` ────────────────────────────────────────────
 * It used to be, and the result was that a correctly-implemented MCP server
 * could not be connected at all.
 *
 * `HttpTester` issues HEAD, then GET. An MCP streamable-HTTP endpoint is a
 * POST-only JSON-RPC URL, and the specification's own answer to a GET it cannot
 * stream is **405** — which lands in `doRequest`'s final branch as
 * `UNEXPECTED_STATUS`. Vectorbea's own `/api/mcp` returns 405 on GET, on
 * purpose (`McpRoutes.noStream`), so the product could not pass its own
 * connection test. The connect wizard's whole claim is that nothing is saved
 * until it has been proven to work; a verify step that fails on every correct
 * server turns that claim into a wall and makes the override path the normal
 * one.
 *
 * ── AND WHY THE REPLACEMENT IS BETTER, NOT JUST CORRECT ─────────────────────
 * A HEAD proves a host is up. `tools/list` proves the endpoint speaks MCP, that
 * the credential was accepted, and how many tools the server advertises — which
 * is the number the next screen is about to show. The test and the product are
 * the same call.
 *
 * It is the SHARED client (`packages/mcp-kotlin`), not a second implementation:
 * the count this reports has to be a fact about the code that will run the
 * customer's tools, or it is a number nobody should trust. See the module's
 * build file.
 *
 * ── SIDE-EFFECT FREE ────────────────────────────────────────────────────────
 * `tools/list` is a read. Probing a customer's server never changes anything at
 * their end, which is the contract every other tester in this package keeps.
 */
object McpTester {

    /**
     * Dial [serverUrl] and report what answered.
     *
     * [transport] is the server's configured transport, so an `sse` connection
     * is refused with the sentence that names why rather than being dialled as
     * something it is not.
     */
    fun test(
        serverUrl: String,
        bearerToken: String?,
        transport: String = "streamable-http",
        connectionId: UUID = UUID(0L, 0L),
    ): ConnectionTestResult {
        val start = System.currentTimeMillis()

        try {
            SsrfGuard.validate(serverUrl)
        } catch (_: SsrfGuard.SsrfBlockedException) {
            /*
             * Not `ConnectionTestResult.privateHost`'s default message. That one
             * says "enable private runner mode", which is a different feature —
             * the fix here is the connection's own egress policy plus an
             * allow-list, and naming the wrong setting is how somebody spends an
             * afternoon in the wrong screen.
             */
            return ConnectionTestResult(
                ConnectionTestResult.TestStatus.PRIVATE_RUNNER_REQUIRED,
                System.currentTimeMillis() - start,
                "PRIVATE_HOST",
                "This MCP server is on a private network. Set this connection's egress " +
                "to private allowed and name its host in the allow-list, then test again.",
            )
        } catch (e: IllegalArgumentException) {
            return ConnectionTestResult.failed(0, "INVALID_URL",
                "That is not a valid URL. Enter the MCP server's full endpoint, " +
                "including https://.")
        }

        val server = McpClient.Server(
            connectionId = connectionId,
            url = serverUrl,
            transport = transport.ifBlank { "streamable-http" },
            authToken = bearerToken,
        )

        return try {
            val tools = McpClient(ApiMcpTransport).listTools(server)
            val latency = System.currentTimeMillis() - start
            ConnectionTestResult.connected(
                latency,
                when (tools.size) {
                    0 -> "Connected. This server advertises no tools yet."
                    1 -> "Connected. This server advertises 1 tool."
                    else -> "Connected. This server advertises ${tools.size} tools."
                },
                details = mapOf(
                    "toolCount" to tools.size,
                    /* The wizard shows the credential claim honestly: reaching a
                       server that needs no token proves nothing about a token. */
                    "credentialVerified" to !bearerToken.isNullOrBlank(),
                ),
            )
        } catch (e: McpClient.McpException) {
            ConnectionTestResult.failed(
                System.currentTimeMillis() - start,
                codeFor(e),
                messageFor(e),
            )
        } catch (e: Exception) {
            ConnectionTestResult.failed(
                System.currentTimeMillis() - start, "MCP_UNREACHABLE",
                "Could not reach the MCP server (${e.javaClass.simpleName}). Vectorbea " +
                "calls it from the public internet — if it is on a private network, set " +
                "this connection's egress policy and allow-list first.")
        }
    }

    /**
     * The machine-readable half.
     *
     * Kept distinct from the HTTP tester's codes: `AUTH_FAILED` on an MCP
     * connection and on a REST one need the same word, but "the server answered
     * something that is not an MCP tool list" has no equivalent there and must
     * not be flattened into `UNEXPECTED_STATUS`, which is what it looked like
     * before.
     */
    private fun codeFor(e: McpClient.McpException): String = when {
        e.httpStatus == 401 || e.httpStatus == 403 -> "AUTH_FAILED"
        e.httpStatus == 404 -> "MCP_ENDPOINT_NOT_FOUND"
        (e.httpStatus ?: 0) >= 500 -> "SERVER_ERROR"
        e.httpStatus != null -> "MCP_HTTP_ERROR"
        e.rpcCode == -32601 -> "MCP_NOT_SUPPORTED"
        e.rpcCode != null -> "MCP_REFUSED"
        e.message?.contains("not supported") == true -> "MCP_TRANSPORT_UNSUPPORTED"
        e.message?.contains("not JSON") == true -> "MCP_NOT_AN_MCP_SERVER"
        else -> "MCP_UNREACHABLE"
    }

    /**
     * The half a person reads.
     *
     * Every branch names what happened and what to do about it, because the
     * error IS the product on this screen — the copy rules, and the reason
     * `DbTester.hostGuidance` exists one file over.
     */
    private fun messageFor(e: McpClient.McpException): String = when {
        e.httpStatus == 401 || e.httpStatus == 403 ->
            "The server rejected the token (HTTP ${e.httpStatus}). Check that it is " +
            "current and has not been scoped to a different workspace."
        e.httpStatus == 404 ->
            "The server answered, but there is nothing at that path (HTTP 404). Check " +
            "the URL points at the MCP endpoint — it usually ends in /mcp."
        e.httpStatus == 405 ->
            "That URL refused a POST (HTTP 405), so it is not a streamable-HTTP MCP " +
            "endpoint. Check the URL, or whether the server is configured for SSE, " +
            "which Vectorbea does not support."
        (e.httpStatus ?: 0) >= 500 ->
            "The server returned HTTP ${e.httpStatus}. It is reachable but failing — " +
            "check its own logs, then test again."
        e.httpStatus != null ->
            "The server returned HTTP ${e.httpStatus}. Check the URL and the token."
        e.rpcCode == -32601 ->
            "The server answered, but does not implement tools/list. It speaks " +
            "JSON-RPC without offering tools, so there is nothing to discover."
        e.rpcCode != null ->
            "The server refused the request (code ${e.rpcCode}). Check the token and " +
            "the server's own logs."
        e.message?.contains("not supported") == true ->
            /* The client's own sentence about the transport, which is already
               the right one. Passed through rather than rephrased. */
            e.message!!
        e.message?.contains("not JSON") == true ->
            "The server answered, but not with an MCP tool list. Check the URL points " +
            "at the MCP endpoint rather than the application root."
        else ->
            "Could not reach the MCP server. Vectorbea calls it from the public " +
            "internet — if it is on a private network, set this connection's egress " +
            "policy and allow-list first."
    }
}
