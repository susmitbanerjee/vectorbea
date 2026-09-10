package com.vectorbea.worker.runtime.executor

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import com.vectorbea.graph.WorkflowGraph
import com.vectorbea.graph.WorkflowNode
import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.connector.SecretValue
import com.vectorbea.worker.connector.SsrfGuard
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.pricing.ModelPricing
import com.vectorbea.worker.runtime.graph.RuntimeContext
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Tag
import java.math.BigDecimal
import java.net.InetSocketAddress
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import javax.sql.DataSource
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * A workflow running against a customer's own AI gateway.
 *
 * ── WHY A REAL SOCKET AND A REAL DATABASE ───────────────────────────────────
 * The acceptance criterion is end to end and both halves of it are things a
 * stub cannot establish:
 *
 *   · "runs against a customer-hosted gateway" is a claim about REACHING one.
 *     A customer's gateway is on their network, so the test's gateway is on
 *     loopback — which the SSRF guard blocks, correctly, until the connection
 *     says otherwise. Stubbing the HTTP client would skip the guard entirely
 *     and prove nothing about the thing that actually stood in the way.
 *
 *   · "at their negotiated rate" is a row in `connection_model_prices` being
 *     found, matched and applied. A stubbed lookup would assert that the code
 *     I wrote matches the code I wrote.
 */
@Tag("integration")
class CustomerGatewayAcceptanceTest {

    private val ds: DataSource get() = com.vectorbea.worker.testsupport.Infra.postgres

    private val workspaceId = UUID.randomUUID()
    private val environmentId = UUID.randomUUID()
    private val connectionId = UUID.randomUUID()

    private lateinit var gateway: HttpServer
    private lateinit var baseUrl: String

    /** Everything the gateway was asked for, so "did it actually go there" is answerable. */
    private val received = ConcurrentLinkedQueue<String>()

    @BeforeEach
    fun start() {
        received.clear()
        events.clear()
        gateway = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        /*
         * An OpenAI-compatible shim, which is what an enterprise gateway almost
         * always is: their own auth, their own model names, OpenAI's wire shape
         * over whatever is actually behind it.
         */
        gateway.createContext("/v1/chat/completions") { exchange -> respond(exchange) }
        gateway.executor = java.util.concurrent.Executors.newSingleThreadExecutor()
        gateway.start()
        baseUrl = "http://127.0.0.1:${gateway.address.port}"
        seedConnection()
    }

    @AfterEach
    fun stop() {
        gateway.stop(0)
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM connection_model_prices WHERE connection_id = ?")
                    .use { it.setObject(1, connectionId); it.executeUpdate() }
                c.prepareStatement("DELETE FROM connections WHERE id = ?")
                    .use { it.setObject(1, connectionId); it.executeUpdate() }
                c.prepareStatement("DELETE FROM workspaces WHERE id = ?")
                    .use { it.setObject(1, workspaceId); it.executeUpdate() }
            }
        }
    }

    private fun respond(exchange: HttpExchange) {
        received += exchange.requestBody.readBytes().toString(Charsets.UTF_8)
        /* 300k prompt tokens, 20k completion — a shape where a blended rate and
           a split rate give visibly different answers. */
        val body = """
            {
              "choices": [{"message": {"role": "assistant", "content": "ok"},
                           "finish_reason": "stop"}],
              "model": "acme-llm-large-v3",
              "usage": {"prompt_tokens": 300000, "completion_tokens": 20000,
                        "total_tokens": 320000}
            }
        """.trimIndent().toByteArray()
        exchange.responseHeaders.add("Content-Type", "application/json")
        exchange.sendResponseHeaders(200, body.size.toLong())
        exchange.responseBody.use { it.write(body) }
    }

    private fun seedConnection() {
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, workspaceId); it.setString(2, "gateway")
                it.setString(3, "gateway-$workspaceId"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) " +
                    "VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, environmentId); it.setObject(2, workspaceId); it.executeUpdate() }
            c.prepareStatement(
                """INSERT INTO connections
                     (id, workspace_id, environment_id, name, slug, type, provider,
                      auth_type, config_json, allowed_hosts, egress_policy, protocol)
                   VALUES (?,?,?,'acme gateway',?,'llm','acme-gateway','api_key',
                           ?::jsonb, ?::jsonb, 'private_allowed', 'openai')"""
            ).use {
                it.setObject(1, connectionId); it.setObject(2, workspaceId)
                it.setObject(3, environmentId); it.setString(4, "acme-$connectionId")
                it.setString(5, """{"baseUrl":"$baseUrl"}""")
                it.setString(6, """["127.0.0.1"]""")
                it.executeUpdate()
            }
        }
    }

    private fun setNegotiatedRate(model: String, input: Double, output: Double) {
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO connection_model_prices
                     (workspace_id, connection_id, model_pattern,
                      input_usd_per_million, output_usd_per_million)
                   VALUES (?,?,?,?,?)
                   ON CONFLICT (connection_id, model_pattern) DO UPDATE SET
                     input_usd_per_million = EXCLUDED.input_usd_per_million,
                     output_usd_per_million = EXCLUDED.output_usd_per_million"""
            ).use {
                it.setObject(1, workspaceId); it.setObject(2, connectionId)
                it.setString(3, model)
                it.setBigDecimal(4, BigDecimal.valueOf(input))
                it.setBigDecimal(5, BigDecimal.valueOf(output))
                it.executeUpdate()
            }
        }
    }

    private fun record(
        egress: SsrfGuard.EgressPolicy = SsrfGuard.EgressPolicy.PRIVATE_ALLOWED,
        allowedHosts: List<String> = listOf("127.0.0.1"),
        protocol: String? = "openai",
    ) = ConnectionRecord(
        id = connectionId,
        workspaceId = workspaceId,
        environmentId = environmentId,
        name = "acme gateway",
        type = "llm",
        provider = "acme-gateway",
        status = "active",
        authType = "api_key",
        secretRef = null,
        configJson = buildMap {
            put("baseUrl", baseUrl)
            protocol?.let { put("protocol", it) }
        },
        allowedHosts = allowedHosts,
        allowedPaths = emptyList(),
        allowedSchemas = emptyList(),
        allowedTables = emptyList(),
        egressPolicy = egress,
    )

    /* The no-op fixtures next door are file-private; these are this file's own. */
    private fun deadDataSource(): DataSource = object : DataSource {
        override fun getConnection(): java.sql.Connection = throw UnsupportedOperationException()
        override fun getConnection(u: String?, p: String?): java.sql.Connection =
            throw UnsupportedOperationException()
        override fun getLogWriter(): java.io.PrintWriter? = null
        override fun setLogWriter(out: java.io.PrintWriter?) {}
        override fun setLoginTimeout(seconds: Int) {}
        override fun getLoginTimeout(): Int = 0
        override fun getParentLogger(): java.util.logging.Logger =
            java.util.logging.Logger.getLogger("noop")
        override fun <T : Any?> unwrap(iface: Class<T>?): T = throw UnsupportedOperationException()
        override fun isWrapperFor(iface: Class<*>?): Boolean = false
    }

    @Suppress("UNCHECKED_CAST")
    private fun deadPubSub(): io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String> =
        java.lang.reflect.Proxy.newProxyInstance(
            Thread.currentThread().contextClassLoader,
            arrayOf(io.lettuce.core.pubsub.StatefulRedisPubSubConnection::class.java),
        ) { _, _, _ -> null } as io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String>

    /** Every event the executor emitted, so the cost can be read where it lands. */
    private val events = ConcurrentLinkedQueue<RunEventStore.RunEvent>()

    /**
     * The cost attributed to the model call.
     *
     * Read from `LLM_CALL_COMPLETED` rather than from the node's output map,
     * because that is where it goes in production: the output carries content
     * and token counts, and the money is on the event the dashboard and the
     * usage ledger are built from.
     */
    private fun attributedCost(): Double? = events
        .firstOrNull { it.type == RunEventStore.EventType.LLM_CALL_COMPLETED }
        ?.estimatedCost

    private fun executor(rec: ConnectionRecord) = LlmNodeExecutor(
        connectionResolver = object : ConnectionResolver(ds, com.vectorbea.worker.connector.SecretService(null, ds)) {
            override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) =
                ResolvedConnection(record = rec, secret = SecretValue("acme-key".toCharArray()))
        },
        eventStore = object : RunEventStore(deadDataSource(), deadPubSub()) {
            override fun appendEvent(event: RunEvent): Int { events += event; return 0 }
        },
        pricing = ModelPricing(ds),
    )

    private fun node() = WorkflowNode(
        id = "n1", type = "llm",
        config = mapOf(
            "connectionId" to connectionId.toString(),
            "model" to "acme-llm-large-v3",
            "messages" to listOf(mapOf("role" to "user", "content" to "hello")),
        ),
    )

    private fun context() = RuntimeContext(
        runId = UUID.randomUUID(),
        workspaceId = workspaceId,
        environmentId = environmentId,
        workflowVersionId = UUID.randomUUID(),
        workflowInput = emptyMap(),
        graph = WorkflowGraph(),
    )

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: a workflow runs end to end against a customer-hosted
    // OpenAI-compatible gateway, with correct cost attribution at their rate
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a run against a customer gateway is priced at their negotiated rate`(): Unit = runBlocking {
        /* $0.50/M in, $1.50/M out — a discount off every published rate, which is
           what a committed-spend agreement buys. */
        setNegotiatedRate("acme-llm-large*", input = 0.50, output = 1.50)

        val result = executor(record()).execute(node(), emptyMap(), context())

        assertIs<NodeResult.Completed>(result)
        assertEquals(1, received.size, "the call did not reach the customer's gateway")
        assertTrue(received.first().contains("acme-llm-large-v3"),
            "the gateway was asked for a model name only it knows")

        /*
         * 300k input at $0.50/M + 20k output at $1.50/M = $0.15 + $0.03.
         *
         * The list-price path would have charged the fallback $2.00/M over 320k
         * effective tokens — $0.64, or 3.6x too much. That factor is the whole
         * reason this exists: a finance team reconciling $0.64 against an
         * invoice for $0.18 does not conclude that our price table is stale.
         */
        val cost = attributedCost()
        assertNotNull(cost, "no cost was attributed to a call that reported 320k tokens")
        assertTrue(abs(cost - 0.18) < 1e-6,
            "expected \$0.18 at the negotiated rate; got \$$cost. The list-price fallback " +
                "would give \$0.64 — if that is what came back, the override was not found.")
    }

    @Test
    fun `without a negotiated rate the same call falls back to list, visibly`(): Unit = runBlocking {
        /* No override row. The fallback is a guess, and this is what it costs —
           asserted so the gap between the two is a fact in the suite rather than
           a claim in a comment. */
        val result = executor(record()).execute(node(), emptyMap(), context())

        assertIs<NodeResult.Completed>(result)
        val cost = attributedCost()
        assertNotNull(cost)
        assertTrue(abs(cost - 0.64) < 1e-6,
            "expected the \$2.00/M fallback over 320k tokens; got \$$cost")
    }

    @Test
    fun `the longest matching rate wins over a catch-all added later`(): Unit = runBlocking {
        setNegotiatedRate("*", input = 9.00, output = 9.00)
        setNegotiatedRate("acme-llm-large*", input = 0.50, output = 1.50)

        val result = executor(record()).execute(node(), emptyMap(), context())
        assertIs<NodeResult.Completed>(result)
        val cost = attributedCost()
        assertTrue(cost != null && abs(cost - 0.18) < 1e-6,
            "a catch-all row silently overrode the specific rate configured for this model: " +
                "got \$$cost")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The guard that stood in the way, and still does by default
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a private gateway is refused unless the connection says private egress`(): Unit = runBlocking {
        /*
         * ── AND THIS IS THE HOLE THAT WAS THERE BEFORE ──────────────────────
         * The LLM path ran no egress check at all: `baseUrl` came out of
         * `config_json` and went straight into a request, so a workspace member
         * could point a connection at `http://169.254.169.254` and the cloud
         * metadata service would answer, with the connection's own Authorization
         * header attached. It went unnoticed because the field existed for Azure
         * OpenAI and nobody typed anything else into it.
         */
        val result = executor(record(egress = SsrfGuard.EgressPolicy.PUBLIC))
            .execute(node(), emptyMap(), context())

        assertIs<NodeResult.Failed>(result)
        assertTrue((result as NodeResult.Failed).reason.contains("egress", ignoreCase = true),
            "the refusal must say how to fix it. Got: ${result.reason}")
        assertEquals(0, received.size, "the request reached the gateway anyway")
    }

    @Test
    fun `private egress without an allow-list reaches nothing`(): Unit = runBlocking {
        /* The policy is useless on its own, deliberately. "Allow private" and
           "these hosts" are one decision; splitting them is how a temporary
           allowance becomes a permanent hole. */
        val result = executor(record(allowedHosts = emptyList()))
            .execute(node(), emptyMap(), context())

        assertIs<NodeResult.Failed>(result)
        assertEquals(0, received.size)
    }

    @Test
    fun `a metadata address is refused under every policy`() {
        /* Not a policy anyone can turn off. An operator who genuinely needs to
           call 169.254.169.254 from a workflow does not exist. */
        listOf(SsrfGuard.EgressPolicy.PUBLIC, SsrfGuard.EgressPolicy.PRIVATE_ALLOWED)
            .forEach { policy ->
                val e = runCatching {
                    SsrfGuard.checkHost("169.254.169.254", listOf("169.254.169.254"), policy)
                }.exceptionOrNull()
                assertNotNull(e, "the metadata address was reachable under $policy")
            }
    }

    @Test
    fun `the protocol is what selects the wire shape, not the provider's name`(): Unit = runBlocking {
        /*
         * `acme-gateway` is not a name this executor knows. Before V070 it
         * reached the OpenAI branch by falling off the end of a `when` — right
         * by accident. Declaring the protocol makes it right on purpose, and
         * this asserts the declared value is what is honoured.
         */
        val exec = executor(record(protocol = "openai"))
        assertEquals("openai", exec.protocolFor(record(protocol = "openai")))
        assertEquals("anthropic", exec.protocolFor(record(protocol = "anthropic")))
        /* Unset still infers, so nothing that predates V070 moves. */
        assertEquals("openai", exec.protocolFor(record(protocol = null)))

        val result = exec.execute(node(), emptyMap(), context())
        assertIs<NodeResult.Completed>(result)
        assertTrue(received.first().contains("\"messages\""),
            "an OpenAI-shaped body was expected; the gateway received: ${received.first().take(200)}")
    }
}
