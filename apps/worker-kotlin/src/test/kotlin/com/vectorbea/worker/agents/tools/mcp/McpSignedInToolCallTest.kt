package com.vectorbea.worker.agents.tools.mcp

import com.vectorbea.mcp.McpClient
import com.vectorbea.mcp.McpCredential
import com.vectorbea.mcp.McpCredentials
import com.vectorbea.mcp.McpDiscovery
import com.vectorbea.mcp.McpOAuth
import com.vectorbea.mcp.McpTransport
import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.connector.SecretValue
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.testsupport.noOpDataSource
import com.vectorbea.worker.testsupport.noOpSecretService
import kotlinx.coroutines.runBlocking
import java.net.http.HttpRequest
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * An agent calling a tool on a server somebody SIGNED IN to — after the sign-in's
 * access token has expired.
 *
 * This is the case that decides whether "we discovered your tools" becomes "your
 * agents can use them" or a run that fails an hour later. Access tokens from
 * hosted MCP servers typically live for an hour; an agent's first run after
 * lunch arrives with a dead one. The executor must refresh, persist the rotated
 * credential before using it, and complete the call — with no person involved.
 */
class McpSignedInToolCallTest {

    private val ws = UUID.randomUUID()
    private val connectionId = UUID.randomUUID()

    private fun expiredSignIn() = McpCredential.OAuth(
        accessToken = "at-old", refreshToken = "rt-1", expiresAtMs = System.currentTimeMillis() - 1_000,
        tokenEndpoint = "https://auth.example.test/token", clientId = "cid", clientSecret = null,
        tokenEndpointAuthMethod = "none", resource = "https://mcp.example.test/mcp", scope = null, issuer = null,
    )

    private fun resolverWith(secret: String) = object : ConnectionResolver(noOpDataSource(), noOpSecretService()) {
        override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) = ResolvedConnection(
            record = ConnectionRecord(
                id = connectionId, workspaceId = ws, environmentId = UUID.randomUUID(),
                name = "signed-in mcp", type = "mcp", provider = "mcp", status = "connected", authType = "oauth2",
                secretRef = null, configJson = mapOf("serverUrl" to "https://mcp.example.test/mcp"),
                allowedHosts = emptyList(), allowedPaths = emptyList(), allowedSchemas = emptyList(), allowedTables = emptyList(),
            ),
            secret = SecretValue(secret.toCharArray()),
        )
    }

    /** The MCP server: accepts only the refreshed token. */
    private class Server {
        val authorizations = mutableListOf<String?>()
        fun send(req: HttpRequest, total: Long, max: Long): McpTransport.Response {
            val auth = req.headers().firstValue("Authorization").orElse(null)
            val method = rpcMethodOf(req)
            if (auth != "Bearer at-new") return McpTransport.Response(401, "",
                mapOf("WWW-Authenticate" to listOf("Bearer error=\"invalid_token\"")))
            return when (method) {
                "initialize" -> McpTransport.Response(200, FAKE_INITIALIZE_REPLY)
                "notifications/initialized" -> McpTransport.Response(202, "")
                else -> {
                    authorizations += auth
                    McpTransport.Response(200, """{"jsonrpc":"2.0","id":"1","result":{"content":[{"type":"text","text":"ok"}]}}""")
                }
            }
        }
    }

    @Test
    fun `an expired sign-in is refreshed, persisted, and the call completes`() {
        var refreshes = 0
        val tokenEndpoint = McpTransport { _, _, _ ->
            refreshes++
            McpTransport.Response(200, """{"access_token":"at-new","refresh_token":"rt-2","expires_in":3600}""")
        }
        val stored = mutableListOf<McpCredential.OAuth>()
        val store = object : McpCredentials.Store {
            override fun loadRefreshed(workspaceId: UUID, connectionId: UUID) = stored.lastOrNull()
            override fun saveRefreshed(workspaceId: UUID, connectionId: UUID, credential: McpCredential.OAuth) { stored += credential }
        }
        val server = Server()
        val executor = McpToolExecutor(
            connectionResolver = resolverWith(expiredSignIn().toJson()),
            discovery = McpDiscovery(noOpDataSource(), McpClient(server::send)),
            client = McpClient(server::send),
            credentials = McpCredentials(McpOAuth(tokenEndpoint), store),
        )

        val result = runBlocking {
            executor.call(connectionId, "search", mapOf("q" to "x"), ws, toolContract = null, timeoutMs = null)
        }

        assertTrue(result is NodeResult.Completed && result.output["error"] == null, "the call did not complete: $result")
        assertEquals(1, refreshes, "refreshed exactly once")
        assertEquals("rt-2", stored.single().refreshToken, "the rotated refresh token was persisted before use")
        assertEquals(listOf<String?>("Bearer at-new"), server.authorizations)
    }

    @Test
    fun `a revoked sign-in becomes a legible tool error, not a run failure`() {
        val tokenEndpoint = McpTransport { _, _, _ -> McpTransport.Response(400, """{"error":"invalid_grant"}""") }
        val store = object : McpCredentials.Store {
            override fun loadRefreshed(workspaceId: UUID, connectionId: UUID): McpCredential.OAuth? = null
            override fun saveRefreshed(workspaceId: UUID, connectionId: UUID, credential: McpCredential.OAuth) = Unit
        }
        val server = Server()
        val executor = McpToolExecutor(
            connectionResolver = resolverWith(expiredSignIn().toJson()),
            discovery = McpDiscovery(noOpDataSource(), McpClient(server::send)),
            client = McpClient(server::send),
            credentials = McpCredentials(McpOAuth(tokenEndpoint), store),
        )

        val result = runBlocking {
            executor.call(connectionId, "search", emptyMap(), ws, toolContract = null, timeoutMs = null)
        }

        assertTrue(result is NodeResult.Completed, "an auth problem must not fail the run: $result")
        assertEquals("auth", result.output["error"])
        assertEquals(false, result.output["retryable"], "the agent is told not to retry a call only a person can fix")
    }
}
