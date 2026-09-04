package com.vectorbea.worker.runtime.executor

import kotlinx.coroutines.runBlocking

import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.connector.SecretValue
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowGraph
import com.vectorbea.graph.WorkflowNode
import org.junit.jupiter.api.Test
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertIs

/**
 * Unit tests for [LlmNodeExecutor].
 *
 * Uses a stubbed [ConnectionResolver] and [HttpClient] to avoid real network calls.
 */
class LlmNodeExecutorTest {

    private val workspaceId    = UUID.randomUUID()
    private val runId          = UUID.randomUUID()
    private val environmentId  = UUID.randomUUID()
    private val versionId      = UUID.randomUUID()

    private fun context(graph: WorkflowGraph = WorkflowGraph()) = RuntimeContext(
        runId             = runId,
        workspaceId       = workspaceId,
        environmentId     = environmentId,
        workflowVersionId = versionId,
        workflowInput     = emptyMap(),
        graph             = graph,
    )

    private fun eventStore() = object : RunEventStore(noOpDataSource(), noOpPubSub()) {
        override fun appendEvent(event: RunEvent): Int = 0
    }

    private fun connectionRecord(provider: String) = ConnectionRecord(
        id            = UUID.randomUUID(),
        workspaceId   = workspaceId,
        environmentId = environmentId,
        name          = "test-llm",
        type          = "llm",
        provider      = provider,
        status        = "active",
        authType      = "api_key",
        secretRef     = null,
        configJson    = emptyMap(),
        allowedHosts  = emptyList(),
        allowedPaths  = emptyList(),
        allowedSchemas = emptyList(),
        allowedTables  = emptyList(),
    )

    private fun stubResolver(
        provider: String,
        apiKey: String = "test-key",
    ): ConnectionResolver {
        val record = connectionRecord(provider)
        val secret = SecretValue(apiKey.toCharArray())
        return object : ConnectionResolver(noOpDataSource(), noOpSecretService()) {
            override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) =
                ResolvedConnection(record = record, secret = secret)
        }
    }

    // ── Missing connectionId ──────────────────────────────────────────────────

    @Test
    fun `returns Failed when connectionId missing`(): Unit = runBlocking {
        val executor = LlmNodeExecutor(stubResolver("openai"), eventStore())
        val node     = WorkflowNode(id = "n1", type = "llm", config = emptyMap())
        val result   = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
        assert((result as NodeResult.Failed).reason.contains("connectionId"))
    }

    // ── OpenAI-compatible response parsing ────────────────────────────────────

    @Test
    fun `parses OpenAI response and returns content`(): Unit = runBlocking {
        val openAiJson = """
            {
              "choices": [{"message": {"role": "assistant", "content": "Hello, world!"}, "finish_reason": "stop"}],
              "usage": {"total_tokens": 42}
            }
        """.trimIndent()

        val executor = LlmNodeExecutor(
            connectionResolver = stubResolver("openai"),
            eventStore         = eventStore(),
            httpClient         = stubHttpClient(200, openAiJson),
        )
        val node = WorkflowNode(
            id     = "n1",
            type   = "llm",
            config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "messages"     to listOf(mapOf("role" to "user", "content" to "Hi")),
            ),
        )
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Completed>(result)
        assertEquals("Hello, world!", (result as NodeResult.Completed).output["content"])
        assertEquals(42, result.output["tokenCount"])
    }

    // ── Anthropic response parsing ────────────────────────────────────────────

    @Test
    fun `parses Anthropic response and returns content`(): Unit = runBlocking {
        val anthropicJson = """
            {
              "content": [{"type": "text", "text": "Bonjour!"}],
              "stop_reason": "end_turn",
              "usage": {"input_tokens": 10, "output_tokens": 5}
            }
        """.trimIndent()

        val executor = LlmNodeExecutor(
            connectionResolver = stubResolver("anthropic"),
            eventStore         = eventStore(),
            httpClient         = stubHttpClient(200, anthropicJson),
        )
        val node = WorkflowNode(
            id     = "n1",
            type   = "llm",
            config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "messages"     to listOf(mapOf("role" to "user", "content" to "Bonjour")),
            ),
        )
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Completed>(result)
        assertEquals("Bonjour!", (result as NodeResult.Completed).output["content"])
        assertEquals(15, result.output["tokenCount"])
    }

    // ── Gemini response parsing ───────────────────────────────────────────────

    @Test
    fun `parses Gemini response and returns content`(): Unit = runBlocking {
        val geminiJson = """
            {
              "candidates": [{"content": {"parts": [{"text": "Ciao!"}]}, "finishReason": "STOP"}],
              "usageMetadata": {"totalTokenCount": 7}
            }
        """.trimIndent()

        val executor = LlmNodeExecutor(
            connectionResolver = stubResolver("gemini"),
            eventStore         = eventStore(),
            httpClient         = stubHttpClient(200, geminiJson),
        )
        val node = WorkflowNode(
            id     = "n1",
            type   = "llm",
            config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "messages"     to listOf(mapOf("role" to "user", "content" to "Hello")),
            ),
        )
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Completed>(result)
        assertEquals("Ciao!", (result as NodeResult.Completed).output["content"])
    }

    // ── HTTP error ────────────────────────────────────────────────────────────

    @Test
    fun `returns Failed on HTTP 401`(): Unit = runBlocking {
        val executor = LlmNodeExecutor(
            connectionResolver = stubResolver("openai"),
            eventStore         = eventStore(),
            httpClient         = stubHttpClient(401, """{"error":"Unauthorized"}"""),
        )
        val node = WorkflowNode(
            id     = "n1",
            type   = "llm",
            config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "messages"     to listOf(mapOf("role" to "user", "content" to "test")),
            ),
        )
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
        assert((result as NodeResult.Failed).reason.contains("401"))
    }

    // ── Resolved inputs used as prompt when no messages ──────────────────────

    @Test
    fun `resolved inputs prompt field used when no messages configured`(): Unit = runBlocking {
        val openAiJson = """
            {"choices":[{"message":{"role":"assistant","content":"Got it"},"finish_reason":"stop"}],"usage":{"total_tokens":3}}
        """.trimIndent()
        val executor = LlmNodeExecutor(
            connectionResolver = stubResolver("openai"),
            eventStore         = eventStore(),
            httpClient         = stubHttpClient(200, openAiJson),
        )
        val node = WorkflowNode(
            id     = "n1",
            type   = "llm",
            config = mapOf("connectionId" to UUID.randomUUID().toString()),
        )
        val result = executor.execute(node, mapOf("prompt" to "Do something"), context())
        assertIs<NodeResult.Completed>(result)
        assertEquals("Got it", (result as NodeResult.Completed).output["content"])
    }
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

private fun stubHttpClient(statusCode: Int, responseBody: String): HttpClient {
    return object : HttpClient() {
        @Suppress("UNCHECKED_CAST")
        override fun <T : Any?> send(
            request: HttpRequest,
            responseBodyHandler: HttpResponse.BodyHandler<T>,
        ): HttpResponse<T> = StubHttpResponse(statusCode, responseBody) as HttpResponse<T>

        override fun version(): Version = Version.HTTP_1_1
        override fun connectTimeout() = java.util.Optional.empty<java.time.Duration>()
        override fun followRedirects(): Redirect = Redirect.NORMAL
        override fun proxy(): java.util.Optional<java.net.ProxySelector> = java.util.Optional.empty()
        override fun sslContext(): javax.net.ssl.SSLContext = javax.net.ssl.SSLContext.getDefault()
        override fun sslParameters(): javax.net.ssl.SSLParameters = javax.net.ssl.SSLParameters()
        override fun authenticator(): java.util.Optional<java.net.Authenticator> = java.util.Optional.empty()
        override fun executor(): java.util.Optional<java.util.concurrent.Executor> = java.util.Optional.empty()
        override fun cookieHandler(): java.util.Optional<java.net.CookieHandler> = java.util.Optional.empty()
        // OutboundHttp.send drives sendAsync so the total-call ceiling can cover
        // body streaming. The stub returns an already-complete future; the body
        // handler is bypassed because the stub supplies the decoded String.
        @Suppress("UNCHECKED_CAST")
        override fun <T : Any?> sendAsync(
            request: HttpRequest,
            responseBodyHandler: HttpResponse.BodyHandler<T>,
        ): java.util.concurrent.CompletableFuture<HttpResponse<T>> =
            java.util.concurrent.CompletableFuture.completedFuture(
                StubHttpResponse(statusCode, responseBody) as HttpResponse<T>)
        override fun <T : Any?> sendAsync(
            request: HttpRequest,
            responseBodyHandler: HttpResponse.BodyHandler<T>,
            pushPromiseHandler: HttpResponse.PushPromiseHandler<T>?,
        ): java.util.concurrent.CompletableFuture<HttpResponse<T>> = throw UnsupportedOperationException()
        override fun newWebSocketBuilder(): java.net.http.WebSocket.Builder = throw UnsupportedOperationException()
    }
}


private class StubHttpResponse<T>(
    private val code: Int,
    private val body: T,
) : HttpResponse<T> {
    override fun statusCode(): Int = code
    override fun body(): T = body
    override fun headers(): java.net.http.HttpHeaders = java.net.http.HttpHeaders.of(emptyMap()) { _, _ -> true }
    override fun request(): HttpRequest = throw UnsupportedOperationException()
    override fun previousResponse(): java.util.Optional<HttpResponse<T>> = java.util.Optional.empty()
    override fun sslSession(): java.util.Optional<javax.net.ssl.SSLSession> = java.util.Optional.empty()
    override fun uri(): java.net.URI = java.net.URI.create("https://example.com")
    override fun version(): HttpClient.Version = HttpClient.Version.HTTP_1_1
}

private fun noOpDataSource(): javax.sql.DataSource = object : javax.sql.DataSource {
    override fun getConnection(): java.sql.Connection = throw UnsupportedOperationException()
    override fun getConnection(u: String?, p: String?): java.sql.Connection = throw UnsupportedOperationException()
    override fun getLogWriter(): java.io.PrintWriter? = null
    override fun setLogWriter(out: java.io.PrintWriter?) {}
    override fun setLoginTimeout(seconds: Int) {}
    override fun getLoginTimeout(): Int = 0
    override fun getParentLogger(): java.util.logging.Logger = java.util.logging.Logger.getLogger("noop")
    override fun <T : Any?> unwrap(iface: Class<T>?): T = throw UnsupportedOperationException()
    override fun isWrapperFor(iface: Class<*>?): Boolean = false
}

private fun noOpSecretService() = com.vectorbea.worker.connector.SecretService(null, noOpDataSource())

@Suppress("UNCHECKED_CAST")
private fun noOpPubSub(): io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String> =
    java.lang.reflect.Proxy.newProxyInstance(
        Thread.currentThread().contextClassLoader,
        arrayOf(io.lettuce.core.pubsub.StatefulRedisPubSubConnection::class.java),
    ) { _, _, _ -> null } as io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String>
