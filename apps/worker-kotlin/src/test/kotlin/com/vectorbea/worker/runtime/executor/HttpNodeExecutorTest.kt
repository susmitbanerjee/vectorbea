package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.connector.SecretValue
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowGraph
import com.vectorbea.worker.runtime.graph.WorkflowNode
import org.junit.jupiter.api.Test
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertIs

class HttpNodeExecutorTest {

    private val workspaceId   = UUID.randomUUID()
    private val runId         = UUID.randomUUID()
    private val environmentId = UUID.randomUUID()
    private val versionId     = UUID.randomUUID()

    private fun context() = RuntimeContext(
        runId             = runId,
        workspaceId       = workspaceId,
        environmentId     = environmentId,
        workflowVersionId = versionId,
        workflowInput     = emptyMap(),
        graph             = WorkflowGraph(),
    )

    private fun stubEventStore() = object : RunEventStore(noopDs(), noopPubSub()) {
        override fun appendEvent(event: RunEvent): Int = 0
    }

    private fun connectionRecord(
        allowedHosts: List<String> = emptyList(),
        allowedPaths: List<String> = emptyList(),
        baseUrl: String? = null,
    ) = ConnectionRecord(
        id             = UUID.randomUUID(),
        workspaceId    = workspaceId,
        environmentId  = environmentId,
        name           = "test-http",
        type           = "http",
        provider       = "generic",
        status         = "active",
        authType       = "bearer",
        secretRef      = null,
        configJson     = if (baseUrl != null) mapOf("baseUrl" to baseUrl) else emptyMap(),
        allowedHosts   = allowedHosts,
        allowedPaths   = allowedPaths,
        allowedSchemas = emptyList(),
        allowedTables  = emptyList(),
    )

    private fun stubResolver(record: ConnectionRecord, apiKey: String = "tok"): ConnectionResolver {
        val secret = SecretValue(apiKey.toCharArray())
        return object : ConnectionResolver(noopDs(), noopSecretService()) {
            override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) =
                ResolvedConnection(record = record, secret = secret)
        }
    }

    private fun noConnectionResolver(): ConnectionResolver =
        object : ConnectionResolver(noopDs(), noopSecretService()) {
            override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) =
                throw com.vectorbea.worker.connector.ConnectionException("No connection")
        }

    // ── No URL provided ───────────────────────────────────────────────────────

    @Test
    fun `returns Failed when no URL and no connection`() {
        val executor = HttpNodeExecutor(noConnectionResolver(), stubEventStore())
        val node     = WorkflowNode(id = "n1", type = "http", config = emptyMap())
        val result   = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
    }

    // ── SSRF protection ───────────────────────────────────────────────────────

    @Test
    fun `SSRF blocked for loopback URL`() {
        val executor = HttpNodeExecutor(noConnectionResolver(), stubEventStore())
        val node = WorkflowNode(id = "n1", type = "http",
            config = mapOf("url" to "http://127.0.0.1:8080/secret"))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
        assert((result as NodeResult.Failed).reason.contains("SSRF"))
    }

    @Test
    fun `SSRF blocked for metadata endpoint`() {
        val executor = HttpNodeExecutor(noConnectionResolver(), stubEventStore())
        val node = WorkflowNode(id = "n1", type = "http",
            config = mapOf("url" to "http://169.254.169.254/latest/meta-data/"))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
        assert((result as NodeResult.Failed).reason.contains("SSRF"))
    }

    // ── Successful GET ────────────────────────────────────────────────────────

    @Test
    fun `successful GET returns statusCode and parsed JSON body`() {
        val responseJson = """{"hello":"world"}"""
        val executor = HttpNodeExecutor(
            connectionResolver = noConnectionResolver(),
            eventStore         = stubEventStore(),
            httpClient         = stubHttp(200, responseJson),
        )
        val node = WorkflowNode(id = "n1", type = "http",
            config = mapOf("url" to "https://example.com/api", "method" to "GET"))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Completed>(result)
        assertEquals(200, (result as NodeResult.Completed).output["statusCode"])
        @Suppress("UNCHECKED_CAST")
        val body = result.output["body"] as Map<String, Any>
        assertEquals("world", body["hello"])
    }

    // ── HTTP 4xx failure ──────────────────────────────────────────────────────

    @Test
    fun `HTTP 404 returns Failed`() {
        val executor = HttpNodeExecutor(
            connectionResolver = noConnectionResolver(),
            eventStore         = stubEventStore(),
            httpClient         = stubHttp(404, """{"error":"not found"}"""),
        )
        val node = WorkflowNode(id = "n1", type = "http",
            config = mapOf("url" to "https://example.com/missing"))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
        assert((result as NodeResult.Failed).reason.contains("404"))
    }

    // ── allowedPaths enforcement ──────────────────────────────────────────────

    @Test
    fun `path outside allowedPaths returns Failed`() {
        val record = connectionRecord(allowedPaths = listOf("/api/v1"))
        val executor = HttpNodeExecutor(
            connectionResolver = stubResolver(record),
            eventStore         = stubEventStore(),
            httpClient         = stubHttp(200, "{}"),
        )
        val node = WorkflowNode(id = "n1", type = "http",
            config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "url" to "https://example.com/admin/secret",
            ))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
        assert((result as NodeResult.Failed).reason.contains("allowedPaths"))
    }

    @Test
    fun `path within allowedPaths passes`() {
        val record = connectionRecord(allowedPaths = listOf("/api/v1"))
        val executor = HttpNodeExecutor(
            connectionResolver = stubResolver(record),
            eventStore         = stubEventStore(),
            httpClient         = stubHttp(200, """{"ok":true}"""),
        )
        val node = WorkflowNode(id = "n1", type = "http",
            config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "url"          to "https://example.com/api/v1/users",
            ))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Completed>(result)
    }

    // ── allowedHosts enforcement via SSRF guard ───────────────────────────────

    @Test
    fun `host outside allowedHosts returns Failed`() {
        val record = connectionRecord(allowedHosts = listOf("api.allowed.com"))
        val executor = HttpNodeExecutor(
            connectionResolver = stubResolver(record),
            eventStore         = stubEventStore(),
            httpClient         = stubHttp(200, "{}"),
        )
        val node = WorkflowNode(id = "n1", type = "http",
            config = mapOf(
                "connectionId" to UUID.randomUUID().toString(),
                "url"          to "https://evil.com/exfil",
            ))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Failed>(result)
    }

    // ── String body returned when not JSON ────────────────────────────────────

    @Test
    fun `non-JSON response body returned as string`() {
        val executor = HttpNodeExecutor(
            connectionResolver = noConnectionResolver(),
            eventStore         = stubEventStore(),
            httpClient         = stubHttp(200, "plain text response"),
        )
        val node = WorkflowNode(id = "n1", type = "http",
            config = mapOf("url" to "https://example.com/text"))
        val result = executor.execute(node, emptyMap(), context())
        assertIs<NodeResult.Completed>(result)
        assertEquals("plain text response", (result as NodeResult.Completed).output["body"])
    }
}

// ── Stubs ─────────────────────────────────────────────────────────────────────

private fun stubHttp(statusCode: Int, body: String): HttpClient {
    return object : HttpClient() {
        @Suppress("UNCHECKED_CAST")
        override fun <T : Any?> send(
            request: HttpRequest,
            responseBodyHandler: HttpResponse.BodyHandler<T>,
        ): HttpResponse<T> = object : HttpResponse<T> {
            override fun statusCode()  = statusCode
            override fun body(): T     = body as T
            override fun headers()     = java.net.http.HttpHeaders.of(emptyMap()) { _, _ -> true }
            override fun request()     = request
            override fun previousResponse() = java.util.Optional.empty<HttpResponse<T>>()
            override fun sslSession()  = java.util.Optional.empty<javax.net.ssl.SSLSession>()
            override fun uri()         = request.uri()
            override fun version()     = Version.HTTP_1_1
        }
        override fun version(): Version = Version.HTTP_1_1
        override fun connectTimeout()   = java.util.Optional.empty<java.time.Duration>()
        override fun followRedirects()  = Redirect.NORMAL
        override fun proxy()            = java.util.Optional.empty<java.net.ProxySelector>()
        override fun sslContext()       = javax.net.ssl.SSLContext.getDefault()
        override fun sslParameters()    = javax.net.ssl.SSLParameters()
        override fun authenticator()    = java.util.Optional.empty<java.net.Authenticator>()
        override fun executor()         = java.util.Optional.empty<java.util.concurrent.Executor>()
        override fun cookieHandler()    = java.util.Optional.empty<java.net.CookieHandler>()
        override fun <T : Any?> sendAsync(req: HttpRequest, h: HttpResponse.BodyHandler<T>) = throw UnsupportedOperationException()
        override fun <T : Any?> sendAsync(req: HttpRequest, h: HttpResponse.BodyHandler<T>, p: HttpResponse.PushPromiseHandler<T>?) = throw UnsupportedOperationException()
        override fun newWebSocketBuilder(): java.net.http.WebSocket.Builder = throw UnsupportedOperationException()
    }
}

private fun noopDs(): javax.sql.DataSource = object : javax.sql.DataSource {
    override fun getConnection(): java.sql.Connection = throw UnsupportedOperationException()
    override fun getConnection(u: String?, p: String?): java.sql.Connection = throw UnsupportedOperationException()
    override fun getLogWriter(): java.io.PrintWriter? = null
    override fun setLogWriter(out: java.io.PrintWriter?) {}
    override fun setLoginTimeout(s: Int) {}
    override fun getLoginTimeout() = 0
    override fun getParentLogger() = java.util.logging.Logger.getLogger("noop")
    override fun <T : Any?> unwrap(c: Class<T>?): T = throw UnsupportedOperationException()
    override fun isWrapperFor(c: Class<*>?) = false
}

private fun noopSecretService() = com.vectorbea.worker.connector.SecretService(null, noopDs())

@Suppress("UNCHECKED_CAST")
private fun noopPubSub(): io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String> =
    java.lang.reflect.Proxy.newProxyInstance(
        Thread.currentThread().contextClassLoader,
        arrayOf(io.lettuce.core.pubsub.StatefulRedisPubSubConnection::class.java),
    ) { _, _, _ -> null } as io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String>
