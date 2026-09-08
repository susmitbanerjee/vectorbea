package com.vectorbea.worker.tools.http

import com.fasterxml.jackson.databind.ObjectMapper
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import com.vectorbea.graph.WorkflowGraph
import com.vectorbea.graph.WorkflowNode
import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.connector.SecretValue
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.graph.RuntimeContext
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import java.net.InetSocketAddress
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import kotlin.test.assertContains
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The resolver, against a real socket.
 *
 * ── WHY A LOCAL SERVER RATHER THAN A STUBBED HttpClient ─────────────────────
 * Every claim in the brief is about what goes ON THE WIRE: the body is
 * form-encoded, the key is in the `api_key` header, the cursor is followed
 * exactly three times. A stubbed client asserts what the code intended to send,
 * which is the same code under test restating itself. A socket records what it
 * actually received.
 *
 * `com.sun.net.httpserver` is in the JDK, so this costs no dependency and no
 * container. `SSRF_ALLOWED_TEST_HOSTS` is what makes it reachable at all —
 * loopback is blocked by [com.vectorbea.worker.connector.SsrfGuard], which is
 * correct, and the exemption exists precisely for this.
 */
class HttpToolResolverTest {

    private val mapper = ObjectMapper()
    private val workspaceId = UUID.randomUUID()

    private lateinit var server: HttpServer
    private lateinit var baseUrl: String

    /** Everything the server received, in order. */
    private val received = ConcurrentLinkedQueue<Captured>()

    /**
     * Both the raw and the decoded forms are kept.
     *
     * `URI.getPath()` and `getQuery()` percent-DECODE, so an assertion written
     * against them cannot tell `,` from `%2C` — which is exactly what the
     * explode and path-encoding tests are about. The raw forms are what was on
     * the wire; the decoded ones are more readable everywhere else.
     */
    data class Captured(
        val method: String,
        val path: String,
        val rawPath: String,
        val query: String?,
        val rawQuery: String?,
        val headers: Map<String, List<String>>,
        val body: String,
    ) {
        fun header(name: String): String? = headers.entries
            .firstOrNull { it.key.equals(name, ignoreCase = true) }?.value?.firstOrNull()
    }

    /** What the next response should be. Replaced per test. */
    private var respond: (Captured, Int) -> Pair<Int, String> = { _, _ -> 200 to "{}" }
    private var responseHeaders: (Int) -> Map<String, String> = { emptyMap() }

    @BeforeEach
    fun start() {
        received.clear()
        server = HttpServer.create(InetSocketAddress(TEST_HOST, 0), 0)
        server.createContext("/") { exchange -> handle(exchange) }
        server.executor = java.util.concurrent.Executors.newFixedThreadPool(2)
        server.start()
        baseUrl = "http://$TEST_HOST:${server.address.port}"
    }

    @AfterEach
    fun stop() {
        server.stop(0)
        HttpTransport.clearCacheForTests()
        OAuth2TokenStore.resetForTests()
    }

    private fun handle(exchange: HttpExchange) {
        val body = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
        val captured = Captured(
            method = exchange.requestMethod,
            path = exchange.requestURI.path,
            rawPath = exchange.requestURI.rawPath,
            query = exchange.requestURI.query,
            rawQuery = exchange.requestURI.rawQuery,
            headers = exchange.requestHeaders.mapValues { it.value.toList() },
            body = body,
        )
        received += captured
        val index = received.size - 1
        val (status, payload) = respond(captured, index)
        responseHeaders(index).forEach { (k, v) -> exchange.responseHeaders.add(k, v) }
        exchange.responseHeaders.add("Content-Type", "application/json")
        val bytes = payload.toByteArray()
        exchange.sendResponseHeaders(status, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    // ── Harness ──────────────────────────────────────────────────────────────

    private fun context() = RuntimeContext(
        runId = UUID.randomUUID(),
        workspaceId = workspaceId,
        environmentId = UUID.randomUUID(),
        workflowVersionId = UUID.randomUUID(),
        workflowInput = emptyMap(),
        graph = WorkflowGraph(),
    )

    /** Events the resolver emitted, so a test can read what was written down. */
    private val emitted = ConcurrentLinkedQueue<RunEventStore.RunEvent>()

    private fun eventStore() = object : RunEventStore(noopDs2(), noopPubSub2()) {
        override fun appendEvent(event: RunEvent): Int {
            emitted += event
            return 0
        }
    }

    private fun resolverFor(secret: String?, authType: String = "none"): ConnectionResolver {
        val record = ConnectionRecord(
            id = CONNECTION_ID, workspaceId = workspaceId, environmentId = UUID.randomUUID(),
            name = "test", type = "http", provider = "generic", status = "active",
            authType = authType, secretRef = null,
            configJson = mapOf("baseUrl" to baseUrl),
            allowedHosts = emptyList(), allowedPaths = emptyList(),
            allowedSchemas = emptyList(), allowedTables = emptyList(),
        )
        return object : ConnectionResolver(noopDs2(), noopSecretService2()) {
            override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) =
                ResolvedConnection(record, secret?.let { SecretValue(it.toCharArray()) })
        }
    }

    private fun run(
        spec: String,
        args: Map<String, Any> = emptyMap(),
        secret: String? = null,
        authType: String = "none",
    ): NodeResult = runBlocking {
        val resolver = HttpToolResolver(
            connectionResolver = resolverFor(secret, authType),
            eventStore = eventStore(),
        )
        val node = WorkflowNode(
            id = "tool-node", type = "tool",
            config = mapOf("httpSpec" to spec, "connectionId" to CONNECTION_ID.toString()),
        )
        resolver.execute(node, args, context())
    }

    @Suppress("UNCHECKED_CAST")
    private fun bodyOf(result: NodeResult): Map<String, Any?> =
        (result as NodeResult.Completed).output["body"] as Map<String, Any?>

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE 1: a POST with a JSON body, an api_key header, and a nested
    // response extraction — every part of it declared, none of it code.
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `a POST with a JSON body, an api_key header and a nested extraction`() {
        respond = { _, _ ->
            200 to """{"envelope":{"result":{"id":"cus_9","email":"a@b.c","internal":"noise"}}}"""
        }

        val spec = """
        {
          "specVersion": 1,
          "request": {
            "method": "POST",
            "path": "/v1/customers/{id}/notes",
            "inputs": [
              {"name": "customerId", "in": "path",  "wireName": "id",   "required": true},
              {"name": "noteBody",   "in": "body",  "wireName": "body", "required": true},
              {"name": "visibility", "in": "query", "wireName": "vis",  "default": "team"},
              {"name": "traceId",    "in": "header","wireName": "X-Trace-Id"}
            ],
            "body": {"encoding": "json", "contentType": "application/json"}
          },
          "auth": {"strategy": "api_key_header", "header": "api_key"},
          "response": {"extract": {"engine": "jsonpath", "expression": "${'$'}.envelope.result"}}
        }
        """.trimIndent()

        val result = run(
            spec,
            args = mapOf("customerId" to "cus_9", "noteBody" to "hello", "traceId" to "t-1"),
            secret = SECRET,
        )

        assertIs<NodeResult.Completed>(result)
        val call = received.single()

        assertEquals("POST", call.method)
        assertEquals("/v1/customers/cus_9/notes", call.path)
        assertEquals("vis=team", call.query, "the default for an omitted optional input was not sent")

        // The header name is the SERVICE's, not ours. This is the brief's example.
        assertEquals(SECRET, call.header("api_key"), "the key did not arrive as `api_key`")
        assertEquals(null, call.header("x-api-key"), "the old hard-coded header name was sent")

        assertEquals("application/json", call.header("Content-Type"))
        assertEquals("hello", mapper.readTree(call.body).path("body").asText())
        assertEquals("t-1", call.header("X-Trace-Id"))

        // The extraction cut the envelope away.
        val body = bodyOf(result)
        assertEquals("cus_9", body["id"])
        assertEquals("a@b.c", body["email"])
        assertTrue("envelope" !in body.keys, "the envelope survived the extraction")
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ACCEPTANCE 3: a secret never appears in any span, event, log or trace.
    // ─────────────────────────────────────────────────────────────────────────

    @Test
    fun `no event, result or log line carries the credential — in the query too`() {
        respond = { _, _ -> 200 to """{"ok":true}""" }

        /*
         * The api-key-IN-QUERY strategy is deliberately the one under test. It is
         * the hardest case: the credential is in the URL, and the URL is what
         * every event summary, every span attribute and every log line naturally
         * contains. If the guarantee holds here it holds for the header
         * strategies, where the credential never touches a URL at all.
         */
        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/search",
           "inputs":[{"name":"q","in":"query","wireName":"q"}]},
         "auth":{"strategy":"api_key_query","param":"apikey"}}
        """.trimIndent()

        val logged = captureLogs {
            val result = run(spec, args = mapOf("q" to "hello"), secret = SECRET)
            assertIs<NodeResult.Completed>(result)

            // It really was sent — otherwise this test proves only that nothing happened.
            assertContains(received.single().query ?: "", "apikey=$SECRET")

            val serialisedResult = mapper.writeValueAsString(result.output) +
                mapper.writeValueAsString(result.metadata)
            assertTrue(
                SECRET !in serialisedResult,
                "the credential reached the node result, which is stored and replayed",
            )
        }

        val serialisedEvents = emitted.joinToString("\n") {
            "${it.title}|${it.summary}|${it.status}|${it.stepId}"
        }
        assertTrue(
            SECRET !in serialisedEvents,
            "the credential reached a run event:\n$serialisedEvents",
        )
        assertTrue(SECRET !in logged, "the credential reached a log line:\n$logged")

        /*
         * And the events must still be USEFUL. A redactor that produced empty
         * summaries would pass the assertion above while destroying the timeline,
         * so the host and path are asserted present.
         */
        assertTrue(
            emitted.any { it.summary?.contains("/search") == true },
            "the events no longer say what was called",
        )
    }

    @Test
    fun `a failure message does not carry the credential either`() {
        respond = { _, _ -> 401 to """{"error":"bad key"}""" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/thing"},
         "auth":{"strategy":"api_key_query","param":"apikey"}}
        """.trimIndent()

        val result = run(spec, secret = SECRET)
        val failed = assertIs<NodeResult.Failed>(result)
        assertTrue(SECRET !in failed.reason, "the credential reached the failure message")
        /* The failure still has to be actionable — this is the whole point of the
           error contract, and a redactor must not eat it. */
        assertContains(failed.reason.lowercase(), "authenticate")
        assertTrue(!failed.retryable, "a 401 is not retryable and the agent must be told so")
    }

    // ── Body encodings ───────────────────────────────────────────────────────

    @Test
    fun `a form body is form-encoded, with Stripe's bracket nesting`() {
        respond = { _, _ -> 200 to """{"id":"cus_1"}""" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"POST","path":"/v1/customers",
           "inputs":[
             {"name":"email","in":"body","wireName":"email"},
             {"name":"metadata","in":"body","wireName":"metadata","type":"object"}],
           "body":{"encoding":"form","bracketNesting":true}}}
        """.trimIndent()

        val result = run(spec, args = mapOf(
            "email" to "a@b.c",
            "metadata" to mapOf("order_id" to "42", "tier" to "gold"),
        ))
        assertIs<NodeResult.Completed>(result)

        val call = received.single()
        assertEquals("application/x-www-form-urlencoded", call.header("Content-Type"))
        assertContains(call.body, "email=a%40b.c")
        assertContains(
            call.body, "metadata%5Border_id%5D=42",
            message = "a nested object must become `metadata[order_id]=42`; without " +
                "bracket nesting a nested value cannot be form-encoded at all",
        )
    }

    @Test
    fun `a multipart body sends a real file part`() {
        respond = { _, _ -> 200 to """{"ok":true}""" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"POST","path":"/upload",
           "inputs":[
             {"name":"purpose","in":"body","wireName":"purpose"},
             {"name":"file","in":"body","wireName":"file","isFile":true}],
           "body":{"encoding":"multipart"}}}
        """.trimIndent()

        val result = run(spec, args = mapOf(
            "purpose" to "import",
            "file" to mapOf("filename" to "rows.csv", "contentType" to "text/csv",
                "content" to "a,b\n1,2\n"),
        ))
        assertIs<NodeResult.Completed>(result)

        val call = received.single()
        assertContains(call.header("Content-Type") ?: "", "multipart/form-data; boundary=")
        assertContains(call.body, """name="purpose"""")
        assertContains(call.body, """filename="rows.csv"""")
        assertContains(call.body, "text/csv")
        assertContains(call.body, "a,b")
    }

    @Test
    fun `a JSON body template keeps the types of the values it substitutes`() {
        respond = { _, _ -> 200 to "{}" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"POST","path":"/orders",
           "inputs":[
             {"name":"quantity","in":"body","type":"integer"},
             {"name":"express","in":"body","type":"boolean"},
             {"name":"note","in":"body"}],
           "body":{"encoding":"json","template":
             {"qty":"{{quantity}}","flags":{"express":"{{express}}"},"label":"Order: {{note}}"}}}}
        """.trimIndent()

        val result = run(spec, args = mapOf("quantity" to 3, "express" to true, "note" to "rush"))
        assertIs<NodeResult.Completed>(result)

        val sent = mapper.readTree(received.single().body)
        assertTrue(
            sent.path("qty").isNumber,
            "a placeholder standing alone must keep its type; a string template would " +
                "send \"3\" and a schema-validating API would reject it",
        )
        assertEquals(3, sent.path("qty").asInt())
        assertTrue(sent.path("flags").path("express").isBoolean)
        assertEquals("Order: rush", sent.path("label").asText(),
            "a placeholder inside surrounding text is an interpolation and stays a string")
    }

    // ── Auth strategies ──────────────────────────────────────────────────────

    @Test
    fun `bearer, basic and custom strategies each send what they declare`() {
        respond = { _, _ -> 200 to "{}" }

        run("""{"specVersion":1,"request":{"method":"GET","path":"/a"},
               "auth":{"strategy":"bearer","header":"X-Auth","prefix":"Token"}}""",
            secret = SECRET)
        assertEquals("Token $SECRET", received.last().header("X-Auth"))

        received.clear()
        run("""{"specVersion":1,"request":{"method":"GET","path":"/b"},
               "auth":{"strategy":"basic","username":"alice"}}""", secret = SECRET)
        val expected = java.util.Base64.getEncoder().encodeToString("alice:$SECRET".toByteArray())
        assertEquals("Basic $expected", received.last().header("Authorization"))

        received.clear()
        run("""{"specVersion":1,"request":{"method":"GET","path":"/c"},
               "auth":{"strategy":"custom","headers":{"X-Signature":"v1={{secret.value}}"}}}""",
            secret = SECRET)
        assertEquals("v1=$SECRET", received.last().header("X-Signature"))
    }

    @Test
    fun `an hmac signature is computed over the request that is actually sent`() {
        respond = { _, _ -> 200 to "{}" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"POST","path":"/pay",
           "inputs":[{"name":"amount","in":"body","type":"integer"}],
           "body":{"encoding":"json"}},
         "auth":{"strategy":"hmac","algorithm":"HmacSHA256",
                 "canonicalTemplate":"{{method}}\n{{path}}\n{{bodySha256Hex}}",
                 "signatureHeader":"X-Signature","timestampHeader":"X-Timestamp",
                 "encoding":"hex"}}
        """.trimIndent()

        val result = run(spec, args = mapOf("amount" to 100), secret = SECRET)
        assertIs<NodeResult.Completed>(result)

        val call = received.single()
        val signature = assertNotNull(call.header("X-Signature"))
        assertNotNull(call.header("X-Timestamp"))

        // Recompute over the bytes the server received, not over what we intended.
        val bodyHash = java.security.MessageDigest.getInstance("SHA-256")
            .digest(call.body.toByteArray()).joinToString("") { "%02x".format(it) }
        val canonical = "POST\n/pay\n$bodyHash"
        val mac = javax.crypto.Mac.getInstance("HmacSHA256").apply {
            init(javax.crypto.spec.SecretKeySpec(SECRET.toByteArray(), "HmacSHA256"))
        }
        val expected = mac.doFinal(canonical.toByteArray()).joinToString("") { "%02x".format(it) }
        assertEquals(expected, signature, "the signature does not cover the bytes that were sent")
    }

    @Test
    fun `oauth2 client credentials fetches a token once and reuses it`() {
        respond = { call, _ ->
            if (call.path == "/oauth/token") 200 to """{"access_token":"$SECRET","expires_in":3600}"""
            else 200 to """{"ok":true}"""
        }

        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/data"},
         "auth":{"strategy":"oauth2_client_credentials",
                 "tokenUrl":"$baseUrl/oauth/token","clientId":"client-1",
                 "clientSecretField":"clientSecret","clientAuth":"body"}}
        """.trimIndent()

        val bundle = """{"clientSecret":"$CLIENT_SECRET"}"""
        assertIs<NodeResult.Completed>(run(spec, secret = bundle))
        assertIs<NodeResult.Completed>(run(spec, secret = bundle))

        val tokenCalls = received.count { it.path == "/oauth/token" }
        assertEquals(
            1, tokenCalls,
            "the token was fetched per call. Eight agent iterations would then be " +
                "sixteen requests, half of them to a token endpoint with tighter limits.",
        )
        val dataCalls = received.filter { it.path == "/data" }
        assertEquals(2, dataCalls.size)
        dataCalls.forEach { assertEquals("Bearer $SECRET", it.header("Authorization")) }

        // The CLIENT secret went to the token endpoint and nowhere else.
        val tokenCall = received.first { it.path == "/oauth/token" }
        assertContains(tokenCall.body, "grant_type=client_credentials")
        assertContains(tokenCall.body, CLIENT_SECRET)
        dataCalls.forEach {
            assertTrue(CLIENT_SECRET !in it.headers.toString(), "the client secret was sent to the API")
        }
    }

    // ── Response handling ────────────────────────────────────────────────────

    @Test
    fun `a declared soft failure turns an HTTP 200 into a failure`() {
        respond = { _, _ -> 200 to """{"ok":false,"error":"channel_not_found"}""" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"POST","path":"/chat.postMessage","body":{"encoding":"form"}},
         "response":{"errors":[
           {"whenBodyFalse":"ok","kind":"invalid_input","retryable":false,
            "messagePath":"error","fix":"Check the channel id."}]}}
        """.trimIndent()

        val failed = assertIs<NodeResult.Failed>(run(spec))
        assertContains(failed.reason, "channel_not_found")
        assertContains(failed.reason, "Check the channel id.")
        assertTrue(!failed.retryable)
    }

    @Test
    fun `an expected 404 is a result, not a failure`() {
        respond = { _, _ -> 404 to """{"found":false}""" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/lookup"},
         "response":{"expectedStatus":[200,404]}}
        """.trimIndent()

        val result = assertIs<NodeResult.Completed>(run(spec))
        assertEquals(404, result.output["statusCode"])
    }

    @Test
    fun `a jmespath extraction works alongside jsonpath`() {
        respond = { _, _ -> 200 to """{"users":[{"name":"a","age":3},{"name":"b","age":4}]}""" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/users"},
         "response":{"extract":{"engine":"jmespath","expression":"users[*].name"}}}
        """.trimIndent()

        val result = assertIs<NodeResult.Completed>(run(spec))
        assertEquals(listOf("a", "b"), result.output["body"])
    }

    @Test
    fun `an extraction that matches nothing returns the whole body, not an empty one`() {
        respond = { _, _ -> 200 to """{"data":{"id":1}}""" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/x"},
         "response":{"extract":{"engine":"jsonpath","expression":"${'$'}.renamed.field"}}}
        """.trimIndent()

        val result = assertIs<NodeResult.Completed>(run(spec))
        val body = bodyOf(result)
        assertTrue(body.isNotEmpty(), "an empty projection reads to a model as 'no results'")
        assertEquals(false, result.metadata["extractionApplied"])
    }

    // ── Pagination ───────────────────────────────────────────────────────────

    @Test
    fun `cursor pagination stops at the page cap and says it was truncated`() {
        // An endless API: every page reports more.
        respond = { call, index ->
            val cursor = call.query?.substringAfter("cursor=", "")?.substringBefore('&') ?: ""
            200 to """{"data":[{"id":"$index-a"},{"id":"$index-b"}],
                       "next_cursor":"c$index","has_more":true,"seen":"$cursor"}"""
        }

        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/list"},
         "pagination":{"strategy":"cursor","cursorParam":"cursor",
           "nextCursorPath":"next_cursor","hasMorePath":"has_more",
           "itemsPath":"data","maxPages":3,"maxItems":100}}
        """.trimIndent()

        val result = assertIs<NodeResult.Completed>(run(spec))
        assertEquals(3, received.size, "the page cap did not stop the walk")
        assertEquals(3, result.metadata["pagesFetched"])
        assertEquals(true, result.output["truncated"])

        val body = bodyOf(result)
        @Suppress("UNCHECKED_CAST")
        val items = body["data"] as List<Map<String, Any>>
        assertEquals(6, items.size, "pages were not accumulated")
        assertTrue(
            body.containsKey("truncationNote"),
            "a model shown a cut-off list with no marker reasons as though it saw everything",
        )

        // Page two carried page one's cursor.
        assertContains(received.toList()[1].query ?: "", "cursor=c0")
    }

    @Test
    fun `the item cap stops the walk even when pages remain under the page cap`() {
        respond = { _, index ->
            val items = (0 until 10).joinToString(",") { """{"id":"$index-$it"}""" }
            200 to """{"data":[$items],"next_cursor":"c$index","has_more":true}"""
        }

        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/list"},
         "pagination":{"strategy":"cursor","cursorParam":"cursor",
           "nextCursorPath":"next_cursor","hasMorePath":"has_more",
           "itemsPath":"data","maxPages":10,"maxItems":15}}
        """.trimIndent()

        val result = assertIs<NodeResult.Completed>(run(spec))
        @Suppress("UNCHECKED_CAST")
        val items = bodyOf(result)["data"] as List<Any>
        assertEquals(15, items.size, "the item cap is what bounds an API with large pages")
        assertTrue(received.size < 10)
    }

    @Test
    fun `link header pagination follows rel=next and stops when it is absent`() {
        responseHeaders = { index ->
            if (index == 0) mapOf(
                "Link" to """<$baseUrl/items?page=2>; rel="next", <$baseUrl/items?page=9>; rel="last""""
            ) else emptyMap()
        }
        respond = { _, index -> 200 to """[{"n":$index}]""" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/items"},
         "pagination":{"strategy":"link_header","relation":"next","maxPages":5}}
        """.trimIndent()

        val result = assertIs<NodeResult.Completed>(run(spec))
        assertEquals(2, received.size, "the `next` link was not followed exactly once")
        assertEquals(2, result.metadata["pagesFetched"])
        assertContains(received.toList()[1].query ?: "", "page=2")
    }

    // ── Retry ────────────────────────────────────────────────────────────────

    @Test
    fun `a retryable status is retried and a write without a key is not`() {
        respond = { _, index -> if (index == 0) 503 to """{"e":1}""" else 200 to """{"ok":true}""" }

        val readSpec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/flaky"},
         "retry":{"maxAttempts":3,"initialDelayMs":1,"maxDelayMs":5,"jitter":"none"}}
        """.trimIndent()
        assertIs<NodeResult.Completed>(run(readSpec))
        assertEquals(2, received.size, "a 503 on a GET should have been retried")

        received.clear()
        respond = { _, _ -> 503 to """{"e":1}""" }
        val writeSpec = """
        {"specVersion":1,
         "request":{"method":"POST","path":"/pay","body":{"encoding":"json"}},
         "retry":{"maxAttempts":3,"initialDelayMs":1,"maxDelayMs":5,"jitter":"none"}}
        """.trimIndent()
        assertIs<NodeResult.Failed>(run(writeSpec))
        assertEquals(
            1, received.size,
            "a POST was retried without an idempotency key. That is how one payment " +
                "becomes two.",
        )
    }

    // ── Parameter mapping ────────────────────────────────────────────────────

    @Test
    fun `an argument that is not a declared input never reaches the wire`() {
        respond = { _, _ -> 200 to "{}" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"POST","path":"/x",
           "inputs":[{"name":"keep","in":"body","wireName":"keep"}],
           "body":{"encoding":"json"}}}
        """.trimIndent()

        assertIs<NodeResult.Completed>(
            run(spec, args = mapOf("keep" to "yes", "apiToken" to "leaked-value-here"))
        )
        val sent = received.single().body
        assertTrue(
            "leaked-value-here" !in sent,
            "an undeclared argument reached the request. The previous resolver passed " +
                "the whole input map through as the body, so anything in scope was sent.",
        )
        assertContains(sent, "keep")
    }

    @Test
    fun `a bound constant cannot be overridden by an argument`() {
        respond = { _, _ -> 200 to "{}" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/orgs/{org}/repos",
           "inputs":[{"name":"org","in":"path","wireName":"org","constant":"acme"}]}}
        """.trimIndent()

        assertIs<NodeResult.Completed>(run(spec, args = mapOf("org" to "attacker")))
        assertEquals(
            "/orgs/acme/repos", received.single().path,
            "a bound input is the whole security value of scoping a tool; an argument " +
                "must not be able to talk it out of its scope",
        )
    }

    @Test
    fun `a path value is encoded so it cannot climb out of its segment`() {
        respond = { _, _ -> 200 to "{}" }

        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/items/{id}",
           "inputs":[{"name":"id","in":"path","wireName":"id","required":true}]}}
        """.trimIndent()

        assertIs<NodeResult.Completed>(run(spec, args = mapOf("id" to "../../admin/keys")))
        assertEquals(
            "/items/..%2F..%2Fadmin%2Fkeys", received.single().rawPath,
            "the slashes must be percent-encoded. Unencoded, `read item N` becomes a " +
                "request at a different path entirely.",
        )
        assertTrue(
            (received.single().rawQuery ?: "").isEmpty(),
            "a value containing ? must not graft a query string onto the request",
        )
    }

    @Test
    fun `a missing required input fails before anything is sent`() {
        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/items/{id}",
           "inputs":[{"name":"itemId","in":"path","wireName":"id","required":true}]}}
        """.trimIndent()

        val failed = assertIs<NodeResult.Failed>(run(spec, args = emptyMap()))
        assertEquals(0, received.size, "a request went out with an unresolved placeholder")
        assertContains(failed.reason, "itemId")
        assertTrue(!failed.retryable)
    }

    @Test
    fun `an array query parameter honours explode`() {
        respond = { _, _ -> 200 to "{}" }

        assertIs<NodeResult.Completed>(
            run(
                """{"specVersion":1,"request":{"method":"GET","path":"/s",
                   "inputs":[{"name":"tags","in":"query","wireName":"tags","type":"array","explode":true}]}}""",
                args = mapOf("tags" to listOf("a", "b")),
            )
        )
        assertEquals("tags=a&tags=b", received.last().rawQuery)

        received.clear()
        assertIs<NodeResult.Completed>(
            run(
                """{"specVersion":1,"request":{"method":"GET","path":"/s",
                   "inputs":[{"name":"tags","in":"query","wireName":"tags","type":"array","explode":false}]}}""",
                args = mapOf("tags" to listOf("a", "b")),
            )
        )
        assertEquals(
            "tags=a%2Cb", received.last().rawQuery,
            "the separator must be encoded, or a value containing a comma becomes two values",
        )
    }

    @Test
    fun `a header value containing a newline is refused rather than sent`() {
        val spec = """
        {"specVersion":1,
         "request":{"method":"GET","path":"/x",
           "inputs":[{"name":"note","in":"header","wireName":"X-Note"}]}}
        """.trimIndent()

        val failed = assertIs<NodeResult.Failed>(
            run(spec, args = mapOf("note" to "ok\r\nX-Admin: true"))
        )
        assertEquals(0, received.size, "a request-splitting header was sent")
        assertContains(failed.reason, "line break")
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Capture everything written to SLF4J while [block] runs.
     *
     * Logback's `ListAppender` attached to the ROOT logger, so it catches every
     * logger in the process rather than the ones this test thought to name — the
     * point of the assertion is to catch a log line somebody adds later, in a
     * class this test does not know about.
     */
    private fun captureLogs(block: () -> Unit): String {
        val root = org.slf4j.LoggerFactory.getLogger(org.slf4j.Logger.ROOT_LOGGER_NAME)
            as ch.qos.logback.classic.Logger
        val appender = ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>()
        appender.start()
        val previousLevel = root.level
        root.level = ch.qos.logback.classic.Level.TRACE
        root.addAppender(appender)
        try {
            block()
        } finally {
            root.detachAppender(appender)
            root.level = previousLevel
        }
        return appender.list.joinToString("\n") {
            it.formattedMessage + " " + (it.throwableProxy?.message ?: "")
        }
    }

    private companion object {
        val CONNECTION_ID: UUID = UUID.randomUUID()

        /**
         * Not 127.0.0.1.
         *
         * `SsrfGuardTest` and `HttpNodeExecutorTest` assert that 127.0.0.1 is
         * BLOCKED. Exempting that exact address to let this suite run would make
         * those two pass vacuously — green while proving nothing. The whole of
         * 127/8 is loopback and binds identically, so this suite moves instead.
         */
        const val TEST_HOST = "127.0.0.2"

        /** Long and distinctive, so a substring match cannot be a coincidence. */
        const val SECRET = "sk_live_UNMISTAKABLE_CREDENTIAL_0123456789"
        const val CLIENT_SECRET = "cs_UNMISTAKABLE_CLIENT_SECRET_9876543210"

        /**
         * The SSRF guard blocks loopback, correctly, so this suite could not reach
         * its own server without an exemption. It is granted in `build.gradle.kts`
         * as `SSRF_ALLOWED_TEST_HOSTS=127.0.0.1` — the guard's own documented
         * mechanism, ignored entirely when APP_ENV=production.
         *
         * Asserted rather than assumed: without the exemption every test in this
         * class fails with a blocked request, and the failure message would say
         * "SSRF blocked" on twenty tests instead of naming the missing setting
         * once.
         */
        @JvmStatic
        @org.junit.jupiter.api.BeforeAll
        fun requireLoopbackExemption() {
            val allowed = System.getenv("SSRF_ALLOWED_TEST_HOSTS").orEmpty()
            check(TEST_HOST in allowed) {
                "This suite talks to a local HTTP server, which SsrfGuard blocks by " +
                    "design. The test task must set SSRF_ALLOWED_TEST_HOSTS=$TEST_HOST " +
                    "(see apps/worker-kotlin/build.gradle.kts)."
            }
        }
    }
}

private fun noopDs2(): javax.sql.DataSource = object : javax.sql.DataSource {
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

private fun noopSecretService2() = com.vectorbea.worker.connector.SecretService(null, noopDs2())

@Suppress("UNCHECKED_CAST")
private fun noopPubSub2(): io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String> =
    java.lang.reflect.Proxy.newProxyInstance(
        Thread.currentThread().contextClassLoader,
        arrayOf(io.lettuce.core.pubsub.StatefulRedisPubSubConnection::class.java),
    ) { _, _, _ -> null } as io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String>
