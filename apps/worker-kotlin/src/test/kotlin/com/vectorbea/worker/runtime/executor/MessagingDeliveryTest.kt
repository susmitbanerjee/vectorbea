package com.vectorbea.worker.runtime.executor

import com.vectorbea.graph.WorkflowGraph
import com.vectorbea.graph.WorkflowNode
import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.connector.SecretValue
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.testsupport.noOpDataSource
import com.vectorbea.worker.testsupport.noOpSecretService
import kotlinx.coroutines.runBlocking
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.Flow
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Messaging tools, as they actually reach the provider.
 *
 * Each case is a way a message tool passed its connection test and then did not
 * deliver: a token sent in a header Slack does not read, a channel fixed on the
 * tool that never left the worker, and — for incoming webhooks — a URL that is
 * itself the credential and must never be written down.
 */
class MessagingDeliveryTest {

    private val ws = UUID.randomUUID()

    private fun ctx() = RuntimeContext(
        runId = UUID.randomUUID(), workspaceId = ws, environmentId = UUID.randomUUID(),
        workflowVersionId = UUID.randomUUID(), workflowInput = emptyMap(), graph = WorkflowGraph(),
    )

    private class Events : RunEventStore(noOpDataSource(), noPubSub()) {
        val summaries = mutableListOf<String>()
        override fun appendEvent(event: RunEvent): Int {
            summaries += listOfNotNull(event.title, event.summary, event.errorJsonSanitized, event.metadataJsonSanitized).joinToString(" | ")
            return 0
        }
    }

    private class Captured { var request: HttpRequest? = null; var body: String = "" }

    private fun record(provider: String, authType: String, config: Map<String, Any> = emptyMap()) = ConnectionRecord(
        id = UUID.randomUUID(), workspaceId = ws, environmentId = UUID.randomUUID(),
        name = provider, type = "http", provider = provider, status = "active", authType = authType,
        secretRef = null, configJson = config,
        allowedHosts = emptyList(), allowedPaths = emptyList(), allowedSchemas = emptyList(), allowedTables = emptyList(),
    )

    private fun resolver(record: ConnectionRecord, secret: String) = object : ConnectionResolver(noOpDataSource(), noOpSecretService()) {
        override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) =
            ResolvedConnection(record = record, secret = SecretValue(secret.toCharArray()))
    }

    private fun node(config: Map<String, Any>) =
        WorkflowNode(id = "post", type = "http", config = config + ("connectionId" to UUID.randomUUID().toString()))

    // ── Auth header ──────────────────────────────────────────────────────────

    @Test
    fun `a Slack bot token is sent as Bearer, the way the connection test sent it`() = runBlocking {
        val cap = Captured()
        val exec = HttpNodeExecutor(resolver(record("slack", "api_key", mapOf("baseUrl" to "https://slack.com/api")), "xoxb-123"),
            Events(), httpClient = capturing(cap, 200, """{"ok":true}"""))
        val result = exec.execute(node(mapOf("url" to "/chat.postMessage", "method" to "POST",
            "body" to mapOf("channel" to "C1", "text" to "hi"))), emptyMap(), ctx())
        assertIs<NodeResult.Completed>(result)
        assertEquals("Bearer xoxb-123", cap.request!!.headers().firstValue("Authorization").orElse(null))
        assertTrue(cap.request!!.headers().firstValue("x-api-key").isEmpty)
    }

    @Test
    fun `a named header wins, and an unnamed generic key keeps x-api-key`() {
        assertEquals("X-Api-Key" to "k", authHeaderFor("api_key", "k", "http", mapOf("authHeaderName" to "X-Api-Key")))
        assertEquals("Authorization" to "Bearer k", authHeaderFor("api_key", "k", "http", mapOf("authHeaderName" to "Authorization")))
        assertEquals("x-api-key" to "k", authHeaderFor("api_key", "k", "generic", emptyMap()))
        assertEquals("Authorization" to "Bearer k", authHeaderFor("api_key", "k", "google_sheets", emptyMap()))
    }

    @Test
    fun `Notion calls carry the version header Notion requires`() = runBlocking {
        val cap = Captured()
        val exec = HttpNodeExecutor(resolver(record("notion", "api_key", mapOf("baseUrl" to "https://api.notion.com")), "secret_x"),
            Events(), httpClient = capturing(cap, 200, "{}"))
        exec.execute(node(mapOf("url" to "/v1/pages", "method" to "POST", "body" to "{}")), emptyMap(), ctx())
        assertEquals("2022-06-28", cap.request!!.headers().firstValue("Notion-Version").orElse(null))
    }

    // ── Values fixed at registration ─────────────────────────────────────────

    @Test
    fun `a fixed channel is sent, and a supplied one cannot override it`() {
        val merged = withBoundParameters(
            mapOf("boundParameters" to mapOf("channel" to "C_OPS")),
            mapOf("channel" to "C_ELSEWHERE", "text" to "deploy finished"),
        )
        assertEquals("C_OPS", merged["channel"])
        assertEquals("deploy finished", merged["text"])
        assertEquals(mapOf("text" to "x"), withBoundParameters(emptyMap(), mapOf("text" to "x")))
    }

    @Test
    fun `a card template is filled at depth, once, without double escaping`() {
        val exec = ToolNodeExecutor(noOpDataSource(), resolver(record("teams", "webhook_url"), "u"),
            com.vectorbea.worker.connector.pool.ClientDbPoolManager(), Events())
        val template = mapOf(
            "type" to "message",
            "attachments" to listOf(mapOf("content" to mapOf("body" to listOf(mapOf("type" to "TextBlock", "text" to "{{text}}"))))),
            "summary" to "Run {{text}}",
            "thread_ts" to "{{thread_ts}}",
        )
        @Suppress("UNCHECKED_CAST")
        val out = exec.resolveTemplateValue(template, mapOf("text" to "line \"one\"\nline two"), ctx()) as Map<String, Any?>
        val card = ((out["attachments"] as List<*>)[0] as Map<*, *>)["content"] as Map<*, *>
        assertEquals("line \"one\"\nline two", ((card["body"] as List<*>)[0] as Map<*, *>)["text"])
        assertEquals("Run line \"one\"\nline two", out["summary"])
        assertFalse("thread_ts" in out, "an optional parameter the caller left out is absent, not empty")
    }

    // ── Incoming webhooks ────────────────────────────────────────────────────

    private val discordUrl = "https://discord.com/api/webhooks/123456/SUPER-SECRET-TOKEN"

    @Test
    fun `a webhook connection posts to its own URL and never writes it down`() = runBlocking {
        val cap = Captured()
        val events = Events()
        val exec = HttpNodeExecutor(resolver(record("discord", "webhook_url"), discordUrl), events,
            httpClient = capturing(cap, 204, ""), messagingWebhooksEnabled = true)
        val result = exec.execute(node(mapOf("url" to "", "method" to "POST", "body" to mapOf("content" to "hi"))),
            mapOf("url" to "https://attacker.example/steal"), ctx())

        assertIs<NodeResult.Completed>(result)
        assertEquals(discordUrl, cap.request!!.uri().toString(), "an input url cannot move a webhook")
        assertNull(cap.request!!.headers().firstValue("Authorization").orElse(null), "the URL is the credential; no header")
        assertTrue(events.summaries.isNotEmpty())
        assertTrue(events.summaries.none { it.contains("SUPER-SECRET-TOKEN") || it.contains("/api/webhooks") },
            "the webhook path leaked into an event: ${events.summaries}")
    }

    @Test
    fun `with the flag off a webhook call fails with the variable to set`() = runBlocking {
        val cap = Captured()
        val exec = HttpNodeExecutor(resolver(record("teams", "webhook_url"), "https://x.logic.azure.com/workflows/abc?sig=s"),
            Events(), httpClient = capturing(cap, 202, ""), messagingWebhooksEnabled = false)
        val result = exec.execute(node(mapOf("method" to "POST", "body" to "{}")), emptyMap(), ctx())
        assertIs<NodeResult.Failed>(result)
        assertTrue(result.reason.contains("MESSAGING_WEBHOOKS_ENABLED"))
        assertNull(cap.request, "nothing was sent")
    }

    // ── Stubs ────────────────────────────────────────────────────────────────

    private fun capturing(cap: Captured, status: Int, response: String): HttpClient = object : HttpClient() {
        override fun <T : Any?> send(request: HttpRequest, h: HttpResponse.BodyHandler<T>): HttpResponse<T> = throw UnsupportedOperationException()
        @Suppress("UNCHECKED_CAST")
        override fun <T : Any?> sendAsync(req: HttpRequest, h: HttpResponse.BodyHandler<T>): CompletableFuture<HttpResponse<T>> {
            cap.request = req
            cap.body = bodyOf(req)
            return CompletableFuture.completedFuture(object : HttpResponse<T> {
                override fun statusCode() = status
                override fun body(): T = response as T
                override fun headers() = java.net.http.HttpHeaders.of(emptyMap()) { _, _ -> true }
                override fun request() = req
                override fun previousResponse() = java.util.Optional.empty<HttpResponse<T>>()
                override fun sslSession() = java.util.Optional.empty<javax.net.ssl.SSLSession>()
                override fun uri() = req.uri()
                override fun version() = Version.HTTP_1_1
            })
        }
        override fun <T : Any?> sendAsync(req: HttpRequest, h: HttpResponse.BodyHandler<T>, p: HttpResponse.PushPromiseHandler<T>?) = throw UnsupportedOperationException()
        override fun version(): Version = Version.HTTP_1_1
        override fun connectTimeout() = java.util.Optional.empty<java.time.Duration>()
        override fun followRedirects() = Redirect.NEVER
        override fun proxy() = java.util.Optional.empty<java.net.ProxySelector>()
        override fun sslContext() = javax.net.ssl.SSLContext.getDefault()
        override fun sslParameters() = javax.net.ssl.SSLParameters()
        override fun authenticator() = java.util.Optional.empty<java.net.Authenticator>()
        override fun executor() = java.util.Optional.empty<java.util.concurrent.Executor>()
        override fun cookieHandler() = java.util.Optional.empty<java.net.CookieHandler>()
        override fun newWebSocketBuilder(): java.net.http.WebSocket.Builder = throw UnsupportedOperationException()
    }

    private fun bodyOf(req: HttpRequest): String {
        val publisher = req.bodyPublisher().orElse(null) ?: return ""
        val out = StringBuilder()
        publisher.subscribe(object : Flow.Subscriber<ByteBuffer> {
            override fun onSubscribe(s: Flow.Subscription) = s.request(Long.MAX_VALUE)
            override fun onNext(item: ByteBuffer) { val b = ByteArray(item.remaining()); item.get(b); out.append(String(b)) }
            override fun onError(t: Throwable) = Unit
            override fun onComplete() = Unit
        })
        return out.toString()
    }
}

private fun noPubSub(): io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String> =
    com.vectorbea.worker.testsupport.noOpPubSub()
