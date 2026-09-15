package com.vectorbea.mcp

import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The streamable-HTTP handshake, against a server shaped like the reference SDKs.
 *
 * Every test here is a way a correct MCP server used to be misdiagnosed as "not
 * an MCP server" by the verify step, or an agent's tool call used to fail against
 * a server discovery had just succeeded against.
 */
class McpClientProtocolTest {

    private val url = "https://mcp.example.test/mcp"
    private fun server(token: String? = null) = McpClient.Server(UUID.randomUUID(), url, authToken = token)

    /** A strict server: initialize first, session header after, both Accept types. */
    private fun strictServer(stream: Boolean = false): FakeServer = FakeServer().apply {
        on { s ->
            val accept = s.header("Accept") ?: ""
            if (s.method == "POST" && !(accept.contains("application/json") && accept.contains("text/event-stream")))
                McpTransport.Response(406, "Not Acceptable") else null
        }
        onRpc("initialize") { _, node ->
            FakeServer.json(
                FakeServer.result(node["id"], """{"protocolVersion":"2025-06-18","serverInfo":{"name":"Acme","version":"2.1"},"capabilities":{}}"""),
                "Mcp-Session-Id" to "sess-1",
            )
        }
        onRpc("notifications/initialized") { _, _ -> McpTransport.Response(202, "") }
        onRpc("tools/list") { s, node ->
            if (s.header("Mcp-Session-Id") != "sess-1") McpTransport.Response(400, "Bad Request: Server not initialized")
            else {
                val body = FakeServer.result(node["id"], """{"tools":[{"name":"search","inputSchema":{}}]}""")
                if (stream) McpTransport.Response(200,
                    "event: message\ndata: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/progress\",\"params\":{}}\n\nevent: message\ndata: $body\n\n",
                    mapOf("Content-Type" to listOf("text/event-stream")))
                else FakeServer.json(body)
            }
        }
    }

    @Test
    fun `initializes, carries the session, and accepts both reply types`() {
        val fake = strictServer()
        val probe = McpClient(fake.transport()).probe(server())

        assertEquals("Acme", probe.info.name)
        assertEquals(1, probe.tools.size)
        assertEquals(listOf("initialize", "notifications/initialized", "tools/list"), fake.seen.mapNotNull { it.rpcMethod() })
        assertEquals("sess-1", fake.seen.last().header("Mcp-Session-Id"))
    }

    @Test
    fun `reads the response out of an event stream, skipping notifications`() {
        val tools = McpClient(strictServer(stream = true).transport()).listTools(server())
        assertEquals("search", tools.single()["name"].asText())
    }

    @Test
    fun `re-initializes once when the server forgets the session`() {
        var expired = true
        val fake = strictServer().apply {
            on { s -> if (expired && s.rpcMethod() == "tools/call") { expired = false; McpTransport.Response(404, "") } else null }
            onRpc("tools/call") { _, node -> FakeServer.json(FakeServer.result(node["id"], """{"content":[]}""")) }
        }
        val client = McpClient(fake.transport())
        val s = server()
        client.listTools(s)
        client.callTool(s, "search", mapOf("q" to "x"))

        assertEquals(2, fake.seen.count { it.rpcMethod() == "initialize" })
    }

    @Test
    fun `a 401 becomes an auth challenge naming the resource metadata`() {
        val fake = FakeServer().apply {
            on { McpTransport.Response(401, "", mapOf("WWW-Authenticate" to listOf(
                """Bearer realm="mcp", resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/mcp", scope="read write""""))) }
        }
        val e = assertFailsWith<McpClient.McpAuthRequiredException> { McpClient(fake.transport()).probe(server()) }
        assertEquals(401, e.httpStatus)
        assertEquals("https://mcp.example.test/.well-known/oauth-protected-resource/mcp", e.challenge.resourceMetadata)
        assertEquals("read write", e.challenge.scope)
    }

    @Test
    fun `a server without initialize still works session-less`() {
        val fake = FakeServer().apply {
            onRpc("initialize") { _, node -> FakeServer.json("""{"jsonrpc":"2.0","id":${node["id"]},"error":{"code":-32601,"message":"no"}}""") }
            onRpc("tools/list") { s, node ->
                assertNull(s.header("Mcp-Session-Id"))
                FakeServer.json(FakeServer.result(node["id"], """{"tools":[]}"""))
            }
        }
        assertTrue(McpClient(fake.transport()).listTools(server()).isEmpty())
    }

    @Test
    fun `follows pagination cursors`() {
        val fake = strictServer().apply {
            onRpc("resources/list") { s, node ->
                val cursor = runCatching { com.fasterxml.jackson.databind.ObjectMapper().readTree(s.body)["params"]["cursor"]?.asText() }.getOrNull()
                FakeServer.json(FakeServer.result(node["id"],
                    if (cursor == null) """{"resources":[{"uri":"a"}],"nextCursor":"p2"}""" else """{"resources":[{"uri":"b"}]}"""))
            }
        }
        assertEquals(listOf("a", "b"), McpClient(fake.transport()).listResources(server()).map { it["uri"].asText() })
    }

    @Test
    fun `a new credential starts a new session`() {
        val fake = strictServer()
        val client = McpClient(fake.transport())
        val id = UUID.randomUUID()
        client.listTools(McpClient.Server(id, url, authToken = "old"))
        client.listTools(McpClient.Server(id, url, authToken = "new"))
        assertEquals(2, fake.seen.count { it.rpcMethod() == "initialize" })
        assertEquals("Bearer new", fake.seen.last().header("Authorization"))
    }

    @Test
    fun `event stream parsing joins multi-line data and ignores comments`() {
        val events = McpClient.sseDataMessages(": keepalive\r\ndata: {\"a\":\r\ndata: 1}\r\n\r\nevent: x\ndata: two\n")
        assertEquals(listOf("{\"a\":\n1}", "two"), events)
    }

    @Test
    fun `a malformed challenge is empty, not an exception`() {
        val c = McpClient.parseChallenge("Bearer ,,, =broken")
        assertNull(c.resourceMetadata)
        assertNotNull(c)
    }
}
