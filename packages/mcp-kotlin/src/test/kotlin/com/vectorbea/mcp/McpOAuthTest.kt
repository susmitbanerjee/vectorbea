package com.vectorbea.mcp

import java.net.URI
import java.net.URLDecoder
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Signing in to an MCP server: discovery, registration, the authorization URL,
 * the exchange and the refresh — each against the documents a real server
 * publishes, and each without a person or a browser.
 */
class McpOAuthTest {

    private val server = "https://mcp.example.test/mcp"
    private val redirect = "https://api.example.test/api/mcp/oauth/callback"

    private fun metadataServer(prmAtHeaderOnly: Boolean = false) = FakeServer().apply {
        val prm = """{"resource":"https://mcp.example.test/mcp","authorization_servers":["https://auth.example.test"],"scopes_supported":["tools:read"]}"""
        if (prmAtHeaderOnly) onGet("https://meta.example.test/prm", body = prm)
        else onGet("https://mcp.example.test/.well-known/oauth-protected-resource/mcp", body = prm)
        onGet("https://auth.example.test/.well-known/oauth-authorization-server", body = """{
            "issuer":"https://auth.example.test",
            "authorization_endpoint":"https://auth.example.test/authorize",
            "token_endpoint":"https://auth.example.test/token",
            "registration_endpoint":"https://auth.example.test/register",
            "code_challenge_methods_supported":["S256"],
            "token_endpoint_auth_methods_supported":["none","client_secret_basic"]}""")
        on { s ->
            if (s.method == "POST" && s.url == "https://auth.example.test/register")
                McpTransport.Response(201, """{"client_id":"cid-123","token_endpoint_auth_method":"none"}""") else null
        }
        on { s ->
            if (s.method != "POST" || s.url != "https://auth.example.test/token") return@on null
            val form = s.body.split("&").associate { it.substringBefore("=") to URLDecoder.decode(it.substringAfter("="), "UTF-8") }
            when (form["grant_type"]) {
                "authorization_code" ->
                    if (form["code"] == "good" && form["code_verifier"]?.isNotBlank() == true && form["resource"] == "https://mcp.example.test/mcp")
                        McpTransport.Response(200, """{"access_token":"at-1","refresh_token":"rt-1","expires_in":3600,"token_type":"Bearer"}""")
                    else McpTransport.Response(400, """{"error":"invalid_grant","error_description":"bad code"}""")
                "refresh_token" ->
                    if (form["refresh_token"] == "rt-1") McpTransport.Response(200, """{"access_token":"at-2","refresh_token":"rt-2","expires_in":3600}""")
                    else McpTransport.Response(400, """{"error":"invalid_grant"}""")
                else -> McpTransport.Response(400, """{"error":"unsupported_grant_type"}""")
            }
        }
    }

    @Test
    fun `discovers the authorization server through the path-aware well-known document`() {
        val d = McpOAuth(metadataServer().transport()).discover(server, challenge = null)
        assertEquals("https://auth.example.test/token", d.authorizationServer.tokenEndpoint)
        assertEquals("https://mcp.example.test/mcp", d.resource)
        assertEquals("tools:read", d.scope)
    }

    @Test
    fun `prefers the metadata url the 401 named`() {
        val d = McpOAuth(metadataServer(prmAtHeaderOnly = true).transport())
            .discover(server, McpClient.AuthChallenge(resourceMetadata = "https://meta.example.test/prm", scope = "custom"))
        assertEquals("https://auth.example.test/authorize", d.authorizationServer.authorizationEndpoint)
        assertEquals("custom", d.scope)
    }

    @Test
    fun `the full sign-in round trip produces a credential that refreshes`() {
        val fake = metadataServer()
        val oauth = McpOAuth(fake.transport())
        val discovery = oauth.discover(server, null)
        val client = oauth.registerClient(discovery.authorizationServer, redirect, "Vectorbea")
        val pkce = McpOAuth.pkce()

        val url = URI.create(oauth.authorizationUrl(discovery, client, redirect, "state-xyz", pkce))
        val query = url.rawQuery.split("&").associate { it.substringBefore("=") to URLDecoder.decode(it.substringAfter("="), "UTF-8") }
        assertEquals("S256", query["code_challenge_method"])
        assertEquals("cid-123", query["client_id"])
        assertEquals("https://mcp.example.test/mcp", query["resource"])
        assertFalse(url.toString().contains(pkce.verifier), "the verifier never leaves the server side")

        val tokens = oauth.exchangeCode(discovery.authorizationServer.tokenEndpoint, client, "good", pkce.verifier, redirect, discovery.resource)
        val credential = McpCredential.fromSignIn(discovery, client, tokens)

        val parsed = McpCredential.parse(credential.toJson()) as McpCredential.OAuth
        assertEquals("at-1", parsed.accessToken)
        assertFalse(parsed.needsRefresh())

        val refreshed = oauth.refresh(parsed.tokenEndpoint, parsed.client, parsed.refreshToken!!, parsed.resource, null)
        assertEquals("rt-2", parsed.refreshed(refreshed).refreshToken)
    }

    @Test
    fun `a bad code is reported by its oauth error, never by the raw body`() {
        val fake = metadataServer()
        val oauth = McpOAuth(fake.transport())
        val d = oauth.discover(server, null)
        val c = oauth.registerClient(d.authorizationServer, redirect, "Vectorbea")
        val e = assertFailsWith<McpOAuth.McpOAuthException> {
            oauth.exchangeCode(d.authorizationServer.tokenEndpoint, c, "bad", "v", redirect, d.resource)
        }
        assertEquals("OAUTH_INVALID_GRANT", e.code)
    }

    @Test
    fun `refuses an authorization server that cannot do S256`() {
        val fake = FakeServer().apply {
            onGet("https://mcp.example.test/.well-known/oauth-protected-resource/mcp",
                body = """{"authorization_servers":["https://auth.example.test"]}""")
            onGet("https://auth.example.test/.well-known/oauth-authorization-server", body = """{
                "authorization_endpoint":"https://auth.example.test/a","token_endpoint":"https://auth.example.test/t",
                "code_challenge_methods_supported":["plain"]}""")
        }
        val e = assertFailsWith<McpOAuth.McpOAuthException> { McpOAuth(fake.transport()).discover(server, null) }
        assertEquals("OAUTH_PKCE_UNSUPPORTED", e.code)
    }

    @Test
    fun `refreshes once under concurrency and persists before returning`() {
        val fake = metadataServer()
        val oauth = McpOAuth(fake.transport())
        val saved: MutableList<McpCredential.OAuth> = java.util.Collections.synchronizedList(mutableListOf())
        val store = object : McpCredentials.Store {
            override fun loadRefreshed(workspaceId: UUID, connectionId: UUID) = saved.lastOrNull()
            override fun saveRefreshed(workspaceId: UUID, connectionId: UUID, credential: McpCredential.OAuth) { saved += credential }
        }
        val expired = McpCredential.OAuth("at-1", "rt-1", System.currentTimeMillis() - 1, "https://auth.example.test/token",
            "cid-123", null, "none", "https://mcp.example.test/mcp", null, null)
        val creds = McpCredentials(oauth, store)
        val ws = UUID.randomUUID(); val conn = UUID.randomUUID()

        val threads = (1..6).map { Thread { creds.current(ws, conn, expired) } }
        threads.forEach { it.start() }; threads.forEach { it.join() }

        assertEquals(1, fake.seen.count { it.url.endsWith("/token") }, "one refresh, not six")
        assertEquals("at-2", (creds.current(ws, conn, expired) as McpCredential.OAuth).accessToken)
    }

    @Test
    fun `a pasted token is still a bearer token`() {
        assertTrue(McpCredential.parse("sk-live-abc") is McpCredential.Bearer)
        assertTrue(McpCredential.parse("""{"not":"ours"}""") is McpCredential.Bearer)
        assertNull(McpCredential.parse("  "))
    }

    @Test
    fun `well-known candidates put the segment between host and path`() {
        assertEquals(
            listOf("https://h.test/.well-known/oauth-protected-resource/v1/mcp", "https://h.test/.well-known/oauth-protected-resource"),
            McpOAuth.protectedResourceCandidates(URI.create("https://H.test/v1/mcp/"), null))
        assertEquals("https://h.test:8443/mcp", McpOAuth.canonicalResource("https://H.TEST:8443/mcp/#frag"))
    }
}
