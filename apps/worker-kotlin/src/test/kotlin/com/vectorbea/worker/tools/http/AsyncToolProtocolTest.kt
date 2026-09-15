package com.vectorbea.worker.tools.http

import com.fasterxml.jackson.databind.ObjectMapper
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import com.vectorbea.graph.WorkflowGraph
import com.vectorbea.graph.WorkflowNode
import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.durable.wait.RunWait
import com.vectorbea.worker.durable.wait.WaitStore
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.graph.RuntimeContext
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Tag
import java.net.InetSocketAddress
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The async tool protocol end to end: submit, park, resume.
 *
 * ── WHY THIS IS SEPARATE FROM `WaitPrimitiveTest` ───────────────────────────
 * That suite proves the STORE behaves — one wait per key, a duplicated
 * completion resolves once, a wait with no answer times out. None of it proves
 * the RESOLVER uses the store correctly, and the two most expensive bugs
 * available here live in exactly that seam: submitting the job twice because
 * the re-executed step did not recognise its own wait, and contacting the
 * provider again on resume when the answer was already sitting on the row.
 *
 * ── AND WHY IT NEEDS BOTH A DATABASE AND A SOCKET ───────────────────────────
 * "Holds no worker" is a claim about a real submit returning a real park
 * without blocking on a real connection. A stubbed client would let this pass
 * while the resolver waited six minutes inside `send()`, and a mocked store
 * would let a second submit through the moment the unique constraint was
 * dropped.
 *
 * The acceptance criterion in the brief — "a six-minute async tool holds no
 * worker and resumes correctly" — is `a submitted job parks without blocking,
 * and the resume projects the provider's result`.
 */
@Tag("integration")
class AsyncToolProtocolTest {

    private val mapper = ObjectMapper()

    private val ds: DataSource get() = com.vectorbea.worker.testsupport.Infra.postgres
    private val waits: WaitStore get() = WaitStore(ds)

    private lateinit var server: HttpServer
    private lateinit var baseUrl: String

    /** Every request the provider received, so "was it submitted twice" is a fact. */
    private val received = ConcurrentLinkedQueue<Pair<String, String>>()

    /** Replaced per test: (method, path, index) → status to body. */
    private var respond: (String, String, Int) -> Pair<Int, String> =
        { _, _, _ -> 202 to """{"id":"job_1","state":"queued"}""" }

    @BeforeEach
    fun start() {
        received.clear()
        server = HttpServer.create(InetSocketAddress(TEST_HOST, 0), 0)
        server.createContext("/") { exchange -> handle(exchange) }
        server.executor = java.util.concurrent.Executors.newFixedThreadPool(2)
        server.start()
        baseUrl = "http://${TEST_HOST}:${server.address.port}"
    }

    @AfterEach
    fun stop() {
        server.stop(0)
        HttpTransport.clearCacheForTests()
    }

    private fun handle(exchange: HttpExchange) {
        exchange.requestBody.readBytes()
        val index = received.size
        received += exchange.requestMethod to exchange.requestURI.path
        val (status, payload) = respond(exchange.requestMethod, exchange.requestURI.path, index)
        exchange.responseHeaders.add("Content-Type", "application/json")
        val bytes = payload.toByteArray()
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    // ── The world ────────────────────────────────────────────────────────────

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        val runId: UUID = UUID.randomUUID(),
    )

    private fun seed(): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "async-tool")
                it.setString(3, "async-tool-" + w.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.environmentId); it.setObject(2, w.workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                    "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.workflowId); it.setObject(2, w.workspaceId)
                it.setObject(3, w.environmentId); it.setString(4, "wf-" + w.workflowId)
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.versionId); it.setObject(2, w.workflowId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id," +
                    " workflow_version_id,status) VALUES (?,?,?,?,?,'running')"
            ).use {
                it.setObject(1, w.runId); it.setObject(2, w.workspaceId)
                it.setObject(3, w.environmentId); it.setObject(4, w.workflowId)
                it.setObject(5, w.versionId); it.executeUpdate()
            }
        }
        return w
    }

    private fun cleanup(w: World) = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
        }
    }

    // ── The tool ─────────────────────────────────────────────────────────────

    /**
     * A render tool, declared entirely as configuration.
     *
     * `handlePath` is where the submit response carries the provider's job id;
     * the poll URL is templated with `{handle}`, which the resolver substitutes
     * after the submit. Both a poll and a callback are declared, because a real
     * integration wants both and the fallback is only real if it coexists.
     */
    private fun spec(): String = """
        {
          "specVersion": 1,
          "request": {
            "method": "POST",
            "path": "/render",
            "inputs": [
              {"name": "prompt", "in": "body", "required": true},
              {"name": "webhook", "in": "body", "wireName": "callback_url"}
            ],
            "body": {"encoding": "json"}
          },
          "response": {
            "expectedStatus": [200, 202],
            "extract": {"engine": "jsonpath", "expression": "$.output.url"}
          },
          "async": {
            "handlePath": "id",
            "timeoutMs": 600000,
            "poll": {
              "url": "$baseUrl/render/{handle}",
              "intervalMs": 5000,
              "statusPath": "state",
              "completedValues": ["succeeded"],
              "failedValues": ["failed"]
            },
            "callback": {
              "urlInput": "webhook",
              "statusPath": "state",
              "completedValues": ["succeeded"],
              "failedValues": ["failed"]
            }
          }
        }
    """.trimIndent()

    private fun resolverFor(w: World): HttpToolResolver {
        val record = ConnectionRecord(
            id = CONNECTION_ID, workspaceId = w.workspaceId, environmentId = w.environmentId,
            name = "renderer", type = "http", provider = "generic", status = "active",
            authType = "none", secretRef = null,
            configJson = mapOf("baseUrl" to baseUrl),
            allowedHosts = emptyList(), allowedPaths = emptyList(),
            allowedSchemas = emptyList(), allowedTables = emptyList(),
        )
        val connections = object : ConnectionResolver(noopDs(), noopSecretService()) {
            override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) =
                ResolvedConnection(record, null)
        }
        return HttpToolResolver(
            connectionResolver = connections,
            eventStore = recordingEventStore(),
            waitStore = waits,
            callbackBaseUrl = "https://api.test.invalid",
        )
    }

    private val emitted = ConcurrentLinkedQueue<RunEventStore.RunEvent>()

    private fun recordingEventStore() = object : RunEventStore(noopDs(), noopPubSub()) {
        override fun appendEvent(event: RunEvent): Int {
            emitted += event
            return 0
        }
    }

    private fun context(w: World) = RuntimeContext(
        runId = w.runId,
        workspaceId = w.workspaceId,
        environmentId = w.environmentId,
        workflowVersionId = w.versionId,
        workflowId = w.workflowId,
        workflowInput = emptyMap(),
        graph = WorkflowGraph(),
    )

    private fun execute(w: World): NodeResult = runBlocking {
        resolverFor(w).execute(
            WorkflowNode(
                id = NODE_ID, type = "tool",
                config = mapOf(
                    "httpSpec" to spec(),
                    "connectionId" to CONNECTION_ID.toString(),
                    "toolName" to "render_video",
                ),
            ),
            mapOf("prompt" to "a cat on a bicycle"),
            context(w),
        )
    }

    private fun waitRow(w: World): RunWait? =
        waits.findByKey(w.runId, RunWait.keyFor(w.runId, NODE_ID, 0))

    /** Read straight from the column, because that is what the API route reads. */
    private fun metadataOf(w: World): String = ds.connection.use { c ->
        c.prepareStatement("SELECT metadata_json FROM run_waits WHERE run_id = ?").use { st ->
            st.setObject(1, w.runId)
            st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) ?: "{}" else "{}" }
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE: a six-minute tool holds no worker, and resumes correctly
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a submitted job parks the run instead of holding the worker`() {
        val w = seed()
        try {
            respond = { _, _, _ -> 202 to """{"id":"job_7f3","state":"queued"}""" }

            val startedAt = System.currentTimeMillis()
            val result = execute(w)
            val elapsed = System.currentTimeMillis() - startedAt

            val waiting = assertIs<NodeResult.Waiting>(
                result,
                "the resolver returned $result. Anything but Waiting means the worker " +
                    "is still on the hook for this render — the failure mode the whole " +
                    "protocol exists to remove.",
            )

            /* The declared timeout is ten minutes. Returning in under a second is
               the difference between parking and blocking, and it is measurable
               precisely because the provider here answers immediately while the
               "job" it describes has not finished. */
            assertTrue(
                elapsed < 5_000,
                "submit took ${elapsed}ms. The call is supposed to return as soon as the " +
                    "provider accepts the job, not to wait for the job.",
            )

            assertEquals("async_tool", waiting.kind)
            assertEquals("job_7f3", waiting.metadata["handle"],
                "the provider's handle is not on the wait, so nothing can correlate " +
                    "its completion back to this run")

            val row = assertNotNull(waitRow(w), "no wait row was written")
            assertTrue(row.isWaiting)
            assertEquals("job_7f3", row.externalRef)
            assertNotNull(row.pollUrl, "the poll URL was not templated with the handle")
            assertContains(row.pollUrl!!, "job_7f3")
            assertNotNull(row.timeoutAt, "a wait with no deadline is a run parked forever")

            assertEquals(1, received.size, "the provider was contacted more than once")
        } finally { cleanup(w) }
    }

    @Test
    fun `the resume projects the provider's result without contacting it again`() {
        val w = seed()
        try {
            respond = { _, _, _ -> 202 to """{"id":"job_7f3","state":"queued"}""" }
            assertIs<NodeResult.Waiting>(execute(w))
            val row = assertNotNull(waitRow(w))

            /* The completion, as a callback would deliver it. */
            assertTrue(
                waits.resolve(
                    row.id, RunWait.Resolution.COMPLETED,
                    """{"state":"succeeded","output":{"url":"https://cdn.test/v/7f3.mp4"}}""",
                    "callback",
                )
            )

            val before = received.size
            val result = execute(w)

            val done = assertIs<NodeResult.Completed>(
                result,
                "the resumed step returned $result rather than the finished render",
            )
            assertEquals(
                before, received.size,
                "the provider was contacted on the resume path. The answer was already " +
                    "on the wait; asking again costs money and can charge for a second render.",
            )

            /* The extraction declared in the spec is applied to the STORED payload,
               so a model sees the same shape whether the tool took 40ms or six
               minutes. */
            assertEquals("https://cdn.test/v/7f3.mp4", done.output["body"])
            assertEquals(true, done.output["async"])
            assertEquals("job_7f3", done.output["handle"])
            assertEquals("callback", done.metadata["resolvedBy"])

            assertTrue(
                emitted.any { it.type == RunEventStore.EventType.RUN_WAIT_RESOLVED },
                "nothing recorded that the wait ended, so the timeline has an open " +
                    "wait span that never closes",
            )
        } finally { cleanup(w) }
    }

    @Test
    fun `a re-executed step parks again without submitting a second job`() {
        val w = seed()
        try {
            respond = { _, _, _ -> 202 to """{"id":"job_7f3","state":"queued"}""" }
            assertIs<NodeResult.Waiting>(execute(w))
            assertEquals(1, received.size)

            /* A redelivered queue message, a worker restart, a spurious resume:
               the step runs again while the render is still going. */
            val second = execute(w)

            assertIs<NodeResult.Waiting>(second, "the re-executed step returned $second")
            assertEquals(
                1, received.size,
                "the render was submitted TWICE. The provider now has two jobs, the " +
                    "customer is billed for two, and only one of them has a wait " +
                    "listening for it.",
            )
        } finally { cleanup(w) }
    }

    @Test
    fun `a provider that fails the job fails the node, and not retryably`() {
        val w = seed()
        try {
            respond = { _, _, _ -> 202 to """{"id":"job_bad","state":"queued"}""" }
            assertIs<NodeResult.Waiting>(execute(w))
            val row = assertNotNull(waitRow(w))

            waits.resolve(
                row.id, RunWait.Resolution.FAILED,
                """{"state":"failed","error":"the prompt was rejected by the safety filter"}""",
                "callback",
            )

            val failed = assertIs<NodeResult.Failed>(execute(w))
            assertContains(failed.reason, "safety filter",
                message = "the provider's own reason was replaced with a generic one, " +
                    "which is the difference between a fixable prompt and a mystery")
            assertTrue(
                !failed.retryable,
                "a render the provider REJECTED was marked retryable. It will be " +
                    "rejected again, at the same price.",
            )
        } finally { cleanup(w) }
    }

    @Test
    fun `a wait that times out fails the node retryably, and says how long it waited`() {
        val w = seed()
        try {
            respond = { _, _, _ -> 202 to """{"id":"job_slow","state":"queued"}""" }
            assertIs<NodeResult.Waiting>(execute(w))
            val row = assertNotNull(waitRow(w))

            waits.timeOut(row.id, "nothing reported back")

            val failed = assertIs<NodeResult.Failed>(execute(w))
            assertTrue(
                failed.retryable,
                "a timeout was marked not retryable. Nobody answering in time can go " +
                    "differently on a second attempt; a rejection cannot.",
            )
            assertContains(failed.reason, "job_slow",
                message = "the timeout message does not name the job, so the operator " +
                    "cannot look it up in the provider's dashboard")
        } finally { cleanup(w) }
    }

    @Test
    fun `a submit that returns no handle fails now rather than parking for the timeout`() {
        val w = seed()
        try {
            /* Accepted, with nothing at `handlePath`. Polling is impossible and a
               callback would have nothing to correlate against. */
            respond = { _, _, _ -> 202 to """{"state":"queued"}""" }

            val result = execute(w)

            val failed = assertIs<NodeResult.Failed>(
                result,
                "the resolver returned $result. A job with no handle parks a run until " +
                    "its deadline every single time, and the reason is discoverable only " +
                    "ten minutes later.",
            )
            assertContains(failed.reason, "handle path",
                message = "the message does not say what to fix")

            val row = assertNotNull(waitRow(w), "the wait row should exist and be closed")
            assertTrue(!row.isWaiting, "the wait was left open with nothing able to resolve it")
            assertEquals(RunWait.Resolution.CANCELLED, row.resolution)
        } finally { cleanup(w) }
    }

    @Test
    fun `the spec's callback rules are carried onto the wait`() {
        val w = seed()
        try {
            respond = { _, _, _ -> 202 to """{"id":"job_rules","state":"queued"}""" }
            assertIs<NodeResult.Waiting>(execute(w))

            val meta = mapper.readTree(metadataOf(w))
            val cb = meta.get("callback")

            /*
             * ── WHY THIS IS ASSERTED AT ALL ─────────────────────────────────
             * `POST /api/tool-callbacks/:token` lives in the API, has no access
             * to the tool's spec, and reads these off the wait. When they were
             * missing it fell back to "any delivery is a completion", so a
             * provider's progress ping resolved the wait and resumed the run
             * with a half-finished render presented as the answer — and a
             * `{"state":"failed"}` was recorded as a success.
             *
             * Nothing in the worker fails when they are absent, which is exactly
             * why it needs a test on this side rather than only on that one.
             */
            assertNotNull(cb, "no callback rules on the wait. The callback route " +
                "would then treat every delivery, including a progress ping, as a " +
                "completed job.")
            assertEquals("state", cb.path("statusPath").asText())
            assertEquals(
                listOf("succeeded"),
                cb.path("completedValues").map { it.asText() },
                "the spec's completion vocabulary did not survive onto the wait",
            )
            assertEquals(
                listOf("failed"),
                cb.path("failedValues").map { it.asText() },
                "a failure callback would be read as a success",
            )
        } finally { cleanup(w) }
    }

    @Test
    fun `the callback URL handed to the provider is stable across re-execution`() {
        val w = seed()
        try {
            var seenCallback: String? = null
            server.removeContext("/")
            server.createContext("/") { exchange ->
                val body = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
                received += exchange.requestMethod to exchange.requestURI.path
                if (seenCallback == null) {
                    seenCallback = mapper.readTree(body).path("callback_url").asText(null)
                }
                val payload = """{"id":"job_cb","state":"queued"}""".toByteArray()
                exchange.responseHeaders.add("Content-Type", "application/json")
                exchange.sendResponseHeaders(202, payload.size.toLong())
                exchange.responseBody.use { it.write(payload) }
            }

            assertIs<NodeResult.Waiting>(execute(w))

            val url = assertNotNull(
                seenCallback,
                "no callback URL reached the provider, so a completion has no route home",
            )
            assertContains(url, "/api/tool-callbacks/cb_")

            /* The token is an HMAC over the derived wait key, so the SAME URL comes
               back out of a fresh computation. If it did not, a provider calling
               the URL it was given after a re-execution would resolve nothing. */
            val row = assertNotNull(waitRow(w))
            val recomputed = RunWait.callbackTokenFor(
                RunWait.keyFor(w.runId, NODE_ID, 0), RunWait.callbackSecret(),
            )
            assertEquals(row.callbackToken, recomputed,
                "the callback token is not reproducible. A re-executed step would " +
                    "publish a different URL and the provider's completion would " +
                    "arrive at a token nothing recognises.")
            assertNull(
                received.firstOrNull { it.second.startsWith("/api/tool-callbacks") },
                "nothing should have dialled the callback URL in this test",
            )
        } finally { cleanup(w) }
    }

    private companion object {
        val CONNECTION_ID: UUID = UUID.randomUUID()
        const val NODE_ID = "render-node"

        /**
         * Not 127.0.0.1, for the reason `HttpToolResolverTest` documents: two
         * other suites assert that 127.0.0.1 is BLOCKED, and exempting it would
         * make them pass while proving nothing. Declared here rather than shared
         * because that companion is private, and widening it to share a string
         * constant would be the wrong trade.
         */
        const val TEST_HOST = "127.0.0.2"
    }
}

private fun noopDs(): DataSource = object : DataSource {
    override fun getConnection() = throw UnsupportedOperationException()
    override fun getConnection(u: String?, p: String?) = throw UnsupportedOperationException()
    override fun getLogWriter() = null
    override fun setLogWriter(out: java.io.PrintWriter?) {}
    override fun setLoginTimeout(seconds: Int) {}
    override fun getLoginTimeout() = 0
    override fun getParentLogger() = throw UnsupportedOperationException()
    override fun <T : Any?> unwrap(iface: Class<T>?): T = throw UnsupportedOperationException()
    override fun isWrapperFor(iface: Class<*>?) = false
}

private fun noopSecretService() = com.vectorbea.worker.connector.SecretService(null, noopDs())

@Suppress("UNCHECKED_CAST")
private fun noopPubSub(): io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String> =
    java.lang.reflect.Proxy.newProxyInstance(
        io.lettuce.core.pubsub.StatefulRedisPubSubConnection::class.java.classLoader,
        arrayOf(io.lettuce.core.pubsub.StatefulRedisPubSubConnection::class.java),
    ) { _, _, _ -> null } as io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String>
