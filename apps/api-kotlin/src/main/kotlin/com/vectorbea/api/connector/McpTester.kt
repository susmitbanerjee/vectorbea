package com.vectorbea.api.connector

import com.vectorbea.api.mcp.ApiMcpTransport
import com.vectorbea.api.security.SsrfGuard
import com.vectorbea.mcp.McpClient
import com.vectorbea.mcp.McpCredential
import com.vectorbea.mcp.McpCredentials
import com.vectorbea.mcp.McpOAuth
import java.net.URI
import java.util.UUID

/**
 * Proving an MCP server works: a handshake and a `tools/list`, not a reachability probe.
 *
 * ── WHY NOT HEAD/GET ────────────────────────────────────────────────────────
 * A streamable-HTTP endpoint is POST-only JSON-RPC; the specification's answer to
 * a GET it will not stream is 405, and the old HEAD-then-GET test therefore
 * failed every correct server, including Vectorbea's own (MCP-CONNECTOR-UI.md
 * §2.2). A `tools/list` proves the endpoint speaks MCP, that the credential was
 * accepted, and how many tools there are — the number the next screen shows.
 *
 * ── A 401 IS A QUESTION, NOT ALWAYS AN ERROR ────────────────────────────────
 * A server that answers a cold call with 401 is usually not refusing anything:
 * it is an OAuth resource server saying "sign in first". Reporting that as "the
 * server rejected the token" — for a token nobody sent — was the message on the
 * connect screen for every hosted server that uses sign-in, and it pointed at a
 * token field that could never be filled in. [probe] tells the three cases
 * apart: no credential needed, sign in, or paste a token.
 */
object McpTester {

    /** How a server wants to be authenticated, as far as a cold probe can tell. */
    enum class AuthMode { NONE, OAUTH, TOKEN }

    data class ProbeResult(
        val result: ConnectionTestResult,
        val auth: AuthMode,
        val serverName: String? = null,
        val authorizationServer: String? = null,
        val toolCount: Int? = null,
    ) {
        fun toResponse(): Map<String, Any?> = result.toResponse() + mapOf(
            "auth" to auth.name.lowercase(),
            "serverName" to serverName,
            "authorizationServer" to authorizationServer,
            "toolCount" to toolCount,
        )
    }

    fun test(
        serverUrl: String,
        bearerToken: String?,
        transport: String = "streamable-http",
        connectionId: UUID = UUID(0L, 0L),
    ): ConnectionTestResult = probe(serverUrl, McpCredential.parse(bearerToken), transport, connectionId).result

    fun probe(
        serverUrl: String,
        credential: McpCredential?,
        transport: String = "streamable-http",
        connectionId: UUID = UUID(0L, 0L),
    ): ProbeResult {
        val start = System.currentTimeMillis()
        try {
            SsrfGuard.validate(serverUrl)
        } catch (_: SsrfGuard.SsrfBlockedException) {
            return ProbeResult(ConnectionTestResult(
                ConnectionTestResult.TestStatus.PRIVATE_RUNNER_REQUIRED,
                System.currentTimeMillis() - start,
                "PRIVATE_HOST",
                "This MCP server is on a private network. Set this connection's egress " +
                "to private allowed and name its host in the allow-list, then test again.",
            ), AuthMode.NONE)
        } catch (e: IllegalArgumentException) {
            return ProbeResult(ConnectionTestResult.failed(0, "INVALID_URL",
                "That is not a valid URL. Enter the MCP server's full endpoint, including https://."), AuthMode.NONE)
        }

        val server = McpClient.Server(
            connectionId = connectionId,
            url = serverUrl,
            transport = transport.ifBlank { "streamable-http" },
            authToken = McpCredentials.tokenOf(credential),
        )
        val mode = when (credential) {
            is McpCredential.OAuth -> AuthMode.OAUTH
            is McpCredential.Bearer -> AuthMode.TOKEN
            null -> AuthMode.NONE
        }
        return try {
            val probe = McpClient(ApiMcpTransport).probe(server)
            val count = probe.tools.size
            val name = probe.info.name
            ProbeResult(
                ConnectionTestResult.connected(
                    System.currentTimeMillis() - start,
                    buildString {
                        append("Connected")
                        name?.let { append(" to $it") }
                        append(". ")
                        append(when (count) {
                            0 -> "This server advertises no tools yet."
                            1 -> "This server advertises 1 tool."
                            else -> "This server advertises $count tools."
                        })
                    },
                    details = mapOf(
                        "toolCount" to count,
                        /* A server that needs no credential proves nothing about one. */
                        "credentialVerified" to (credential != null),
                        "serverName" to name,
                        "protocolVersion" to probe.info.protocolVersion,
                    ),
                ),
                auth = mode, serverName = name, toolCount = count,
            )
        } catch (e: McpClient.McpAuthRequiredException) {
            authOutcome(e, credential, serverUrl, System.currentTimeMillis() - start)
        } catch (e: McpClient.McpException) {
            ProbeResult(ConnectionTestResult.failed(System.currentTimeMillis() - start, codeFor(e), messageFor(e)), mode)
        } catch (e: Exception) {
            ProbeResult(ConnectionTestResult.failed(
                System.currentTimeMillis() - start, "MCP_UNREACHABLE",
                "Could not reach the MCP server (${e.javaClass.simpleName}). Vectorbea " +
                "calls it from the public internet — if it is on a private network, set " +
                "this connection's egress policy and allow-list first."), mode)
        }
    }

    private fun authOutcome(
        e: McpClient.McpAuthRequiredException,
        credential: McpCredential?,
        serverUrl: String,
        latency: Long,
    ): ProbeResult = when (credential) {
        is McpCredential.OAuth -> ProbeResult(ConnectionTestResult.failed(latency, "OAUTH_EXPIRED",
            "The sign-in to this server has expired or was revoked. Sign in again from the connection."), AuthMode.OAUTH)
        is McpCredential.Bearer -> ProbeResult(ConnectionTestResult.failed(latency, "AUTH_FAILED",
            "The server rejected the token (HTTP ${e.httpStatus}). Check that it is current and has " +
            "not been scoped to a different workspace."), AuthMode.TOKEN)
        null -> {
            /* No credential was sent, so this is the server describing how to
               authenticate. Find out whether it publishes a sign-in. */
            val discovery = runCatching { McpOAuth(ApiMcpTransport).discover(serverUrl, e.challenge) }.getOrNull()
            if (discovery != null) {
                val host = runCatching { URI.create(discovery.authorizationServer.issuer).host }.getOrNull()
                ProbeResult(
                    ConnectionTestResult.failed(latency, "OAUTH_REQUIRED",
                        "This server uses sign-in. Sign in${host?.let { " with $it" } ?: ""} to connect it — " +
                        "there is no token to paste."),
                    AuthMode.OAUTH, authorizationServer = host,
                )
            } else ProbeResult(
                ConnectionTestResult.failed(latency, "AUTH_REQUIRED",
                    "This server needs a credential and does not publish a sign-in. Paste an access " +
                    "token from the server's own settings."),
                AuthMode.TOKEN,
            )
        }
    }

    private fun codeFor(e: McpClient.McpException): String = when {
        e.httpStatus == 404 -> "MCP_ENDPOINT_NOT_FOUND"
        e.httpStatus == 406 -> "MCP_HTTP_ERROR"
        (e.httpStatus ?: 0) >= 500 -> "SERVER_ERROR"
        e.httpStatus != null -> "MCP_HTTP_ERROR"
        e.rpcCode == -32601 -> "MCP_NOT_SUPPORTED"
        e.rpcCode != null -> "MCP_REFUSED"
        e.message?.contains("not supported") == true -> "MCP_TRANSPORT_UNSUPPORTED"
        e.message?.contains("not JSON") == true || e.message?.contains("event stream") == true -> "MCP_NOT_AN_MCP_SERVER"
        else -> "MCP_UNREACHABLE"
    }

    private fun messageFor(e: McpClient.McpException): String = when {
        e.httpStatus == 404 ->
            "The server answered, but there is nothing at that path (HTTP 404). Check " +
            "the URL points at the MCP endpoint — it usually ends in /mcp."
        e.httpStatus == 405 ->
            "That URL refused a POST (HTTP 405), so it is not a streamable-HTTP MCP " +
            "endpoint. Check the URL, or whether the server only offers the older SSE " +
            "transport, which Vectorbea does not support."
        (e.httpStatus ?: 0) >= 500 ->
            "The server returned HTTP ${e.httpStatus}. It is reachable but failing — " +
            "check its own logs, then test again."
        e.httpStatus != null ->
            "The server returned HTTP ${e.httpStatus}. Check the URL."
        e.rpcCode == -32601 ->
            "The server answered, but does not implement tools/list. It speaks " +
            "JSON-RPC without offering tools, so there is nothing to discover."
        e.rpcCode != null ->
            "The server refused the request (code ${e.rpcCode}). Check the server's own logs."
        e.message?.contains("not supported") == true -> e.message!!
        e.message?.contains("not JSON") == true || e.message?.contains("event stream") == true ->
            "The server answered, but not with an MCP reply. Check the URL points " +
            "at the MCP endpoint rather than the application root."
        else ->
            "Could not reach the MCP server. Vectorbea calls it from the public " +
            "internet — if it is on a private network, set this connection's egress " +
            "policy and allow-list first."
    }
}
