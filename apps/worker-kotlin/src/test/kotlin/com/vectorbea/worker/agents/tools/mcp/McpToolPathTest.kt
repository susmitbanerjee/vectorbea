package com.vectorbea.worker.agents.tools.mcp
import com.vectorbea.mcp.McpClient
import com.vectorbea.mcp.McpTransport

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.graph.WorkflowGraph
import com.vectorbea.graph.WorkflowNode
import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.net.ConnectionCircuit
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.executor.ToolNodeExecutor
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.testsupport.Infra
import com.vectorbea.worker.testsupport.RecordingEventStore
import com.vectorbea.worker.testsupport.noOpDataSource
import com.vectorbea.worker.testsupport.noOpSecretService
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Tag
import java.net.http.HttpRequest
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * MCP through the ordinary tool path.
 *
 * ── ACCEPTANCE: THE SAME CODE PATH, SPANS AND APPROVAL KEYS ─────────────────
 * The claim is not "MCP has its own equivalents of these". It is that MCP takes
 * the same ones, because it is a case in `ToolNodeExecutor`'s type dispatch and
 * everything around that `when` already ran. Asserted by driving a real
 * `ToolNodeExecutor` and checking the events it emits and the gate it takes are
 * the ones an HTTP tool gets — from the same code, not from a parallel
 * implementation.
 */
@Tag("integration")
class McpToolPathTest {

    private val ds: DataSource = Infra.postgres
    private val mapper = ObjectMapper()
    private val ws: UUID = UUID.randomUUID()
    private val env: UUID = UUID.randomUUID()
    private val connectionId: UUID = UUID.randomUUID()

    // ── A scripted MCP server ────────────────────────────────────────────────

    /**
     * Answers JSON-RPC without a socket.
     *
     * Substituted at `McpClient`'s send seam rather than by standing up a server:
     * what is under test is this worker's behaviour, and a real server would add a
     * port, a lifecycle and a source of flakiness to prove nothing extra.
     */
    private class FakeServer {
        var reply: String? = null
        var failWith: Exception? = null
        val calls = mutableListOf<String>()

        fun send(req: HttpRequest, total: Long, maxBytes: Long): McpTransport.Response {
            calls += req.uri().toString()
            failWith?.let { throw it }
            return McpTransport.Response(statusCode = 200, body = reply ?: "{}")
        }
    }

    private fun rpcResult(json: String) =
        """{"jsonrpc":"2.0","id":"1","result":$json}"""

    // ── Fixture ─────────────────────────────────────────────────────────────

    private fun seed(requiresApproval: Boolean = false): UUID {
        val toolId = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?) " +
                "ON CONFLICT DO NOTHING").use {
                it.setObject(1, ws); it.setString(2, "mcp"); it.setString(3, "mcp-$ws")
                it.executeUpdate()
            }
            c.prepareStatement("INSERT INTO environments (id,workspace_id,name,slug,type) " +
                "VALUES (?,?,'t','t','development') ON CONFLICT DO NOTHING").use {
                it.setObject(1, env); it.setObject(2, ws); it.executeUpdate()
            }
            c.prepareStatement(
                """INSERT INTO tools (id, workspace_id, environment_id, name, slug, type,
                     description, config_json, requires_approval, status,
                     mcp_server_connection_id, mcp_tool_name)
                   VALUES (?,?,?,?,?,'mcp','d','{}'::jsonb,?, 'active', ?, ?)"""
            ).use {
                it.setObject(1, toolId); it.setObject(2, ws); it.setObject(3, env)
                it.setString(4, "crm.search"); it.setString(5, "crm-search-$toolId")
                it.setBoolean(6, requiresApproval)
                it.setObject(7, connectionId); it.setString(8, "crm_search")
                it.executeUpdate()
            }
        }
        return toolId
    }

    @AfterTest
    fun cleanup() {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM tools WHERE workspace_id=?")
                    .use { it.setObject(1, ws); it.executeUpdate() }
                c.prepareStatement("DELETE FROM mcp_server_manifests WHERE workspace_id=?")
                    .use { it.setObject(1, ws); it.executeUpdate() }
                c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                    .use { it.setObject(1, ws); it.executeUpdate() }
            }
        }
    }

    private fun record() = ConnectionRecord(
        id = connectionId, workspaceId = ws, environmentId = env,
        name = "customer mcp", type = "tool", provider = "mcp",
        status = "active", authType = "bearer", secretRef = null,
        configJson = mapOf("serverUrl" to "https://mcp.example.test/rpc"),
        allowedHosts = emptyList(), allowedPaths = emptyList(),
        allowedSchemas = emptyList(), allowedTables = emptyList(),
    )

    private fun executorWith(server: FakeServer, events: RunEventStore): ToolNodeExecutor {
        val resolver = object : ConnectionResolver(noOpDataSource(), noOpSecretService()) {
            override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) =
                ResolvedConnection(record = record(), secret = null)
        }
        /* The real ToolNodeExecutor, with only the socket replaced. Everything the
           acceptance criterion is about — the gate, the events, the span, the
           dispatch — is production code. */
        return ToolNodeExecutor(ds, resolver,
            com.vectorbea.worker.connector.pool.ClientDbPoolManager(), events,
            circuit = ConnectionCircuit(dataSource = null, failureThreshold = 2))
            .also { injectClient(it, server) }
    }

    /** Replace the lazily-built MCP executor's client with the scripted one. */
    private fun injectClient(exec: ToolNodeExecutor, server: FakeServer) {
        val field = ToolNodeExecutor::class.java.getDeclaredField("mcpExecutor\$delegate")
        field.isAccessible = true
        val lazyRef = field.get(exec) as Lazy<*>
        /* Force the lazy, then swap the client inside the executor it built. */
        val mcp = lazyRef.value as McpToolExecutor
        val clientField = McpToolExecutor::class.java.getDeclaredField("client")
        clientField.isAccessible = true
        clientField.set(mcp, McpClient(server::send))
    }

    private fun ctx() = RuntimeContext(
        runId = UUID.randomUUID(), workspaceId = ws, environmentId = env,
        workflowVersionId = UUID.randomUUID(), workflowInput = emptyMap(),
        graph = WorkflowGraph(),
    )

    private fun call(toolId: UUID, exec: ToolNodeExecutor, inputs: Map<String, Any> = emptyMap()) =
        runBlocking {
            exec.execute(
                WorkflowNode(id = "n1", type = "tool",
                    config = mapOf("toolId" to toolId.toString())),
                inputs, ctx())
        }

    // ── ACCEPTANCE ───────────────────────────────────────────────────────────

    /**
     * ACCEPTANCE: an MCP tool takes the same path, events and gate as an HTTP one.
     *
     * `TOOL_CALL_STARTED` and `TOOL_CALL_COMPLETED` are emitted by
     * `ToolNodeExecutor` around the dispatch, so seeing them proves the MCP arm is
     * inside that dispatch rather than beside it.
     */
    @Test
    fun `an mcp tool emits the same tool events as any other type`() {
        val toolId = seed()
        val server = FakeServer().apply {
            reply = rpcResult("""{"content":[{"type":"text","text":"{\"n\":1}"}]}""")
        }
        val events = RecordingEventStore()
        val result = call(toolId, executorWith(server, events))

        assertTrue(result is NodeResult.Completed,
            "the MCP call did not complete: ${(result as? NodeResult.Failed)?.reason}")

        val types = events.events.map { it.type.name }
        assertTrue(types.contains("TOOL_CALL_STARTED"),
            "no TOOL_CALL_STARTED — the MCP arm is not inside the tool boundary. Saw: $types")
        assertTrue(types.contains("TOOL_CALL_COMPLETED"),
            "no TOOL_CALL_COMPLETED. Saw: $types")
        assertTrue(server.calls.single().contains("mcp.example.test"),
            "the configured server URL was not called")
    }

    /**
     * The approval gate is the tool boundary's, not a second one.
     *
     * `requires_approval` on the tool row pauses an MCP call exactly as it pauses
     * an HTTP one, and it pauses BEFORE the server is contacted — a call held at a
     * gate has not started.
     */
    @Test
    fun `requires_approval gates an mcp tool at the same boundary`() {
        val toolId = seed(requiresApproval = true)
        val server = FakeServer().apply { reply = rpcResult("""{"content":[]}""") }
        val result = call(toolId, executorWith(server, RecordingEventStore()))

        assertTrue(result is NodeResult.ApprovalPaused,
            "an MCP tool marked requires_approval was not gated; got ${result::class.simpleName}")
        assertTrue(server.calls.isEmpty(),
            "the MCP server was contacted before the approval was granted")
    }

    /**
     * ACCEPTANCE: an unreachable server degrades to a tool error with a legible
     * cause — never a run failure.
     */
    @Test
    fun `an unreachable server is a tool error, not a run failure`() {
        val toolId = seed()
        val server = FakeServer().apply {
            failWith = java.net.ConnectException("connection refused")
        }
        val result = call(toolId, executorWith(server, RecordingEventStore()))

        assertTrue(result is NodeResult.Completed,
            "an unreachable MCP server failed the node instead of producing an " +
            "observation; got ${result::class.simpleName}")
        val message = result.output["message"].toString()
        assertEquals("server", result.output["error"])
        assertEquals(true, result.output["retryable"])
        assertTrue(message.contains("could not be reached"),
            "the cause is not legible: $message")
        assertTrue(message.contains("only the tools that server provides"),
            "the message does not say the blast radius is limited: $message")
    }

    /**
     * A server that refuses is not a server that is down.
     *
     * A JSON-RPC error means the server answered — so the breaker must not count
     * it, or one badly-configured tool would take a working server offline for
     * every other tool on it. Same distinction the provider 429 path makes.
     */
    @Test
    fun `a refusal does not open the breaker but an outage does`() {
        val toolId = seed()

        /* Refusals: two of them, past the threshold, and the third call still
           reaches the server. */
        val refusing = FakeServer().apply {
            reply = """{"jsonrpc":"2.0","id":"1","error":{"code":-32602,"message":"bad args"}}"""
        }
        val refusingExec = executorWith(refusing, RecordingEventStore())
        repeat(3) { call(toolId, refusingExec) }
        assertEquals(3, refusing.calls.size,
            "the breaker opened on refusals; a server that answers is not a server that is down")

        /* Outages: the breaker opens and stops calling. */
        val down = FakeServer().apply { failWith = java.net.ConnectException("refused") }
        val downExec = executorWith(down, RecordingEventStore())
        repeat(4) { call(toolId, downExec) }
        assertTrue(down.calls.size < 4,
            "the breaker never opened on a genuinely unreachable server: ${down.calls.size} calls")
    }

    /**
     * A tool the server no longer advertises fails legibly rather than vanishing.
     *
     * Discovery does not delete rows for withdrawn tools, because deleting a
     * granted tool changes what an agent may do without anyone deciding to. It
     * fails at call time instead, with a cause the agent can act on.
     */
    @Test
    fun `a withdrawn tool reports that it is gone`() {
        val toolId = seed()
        val server = FakeServer().apply {
            reply = """{"jsonrpc":"2.0","id":"1","error":{"code":-32601,"message":"no such tool"}}"""
        }
        val result = call(toolId, executorWith(server, RecordingEventStore()))
        assertTrue(result is NodeResult.Completed)
        assertEquals("not_found", result.output["error"])
        assertEquals(false, result.output["retryable"],
            "the agent was told to retry a tool the server does not implement")
    }
}
