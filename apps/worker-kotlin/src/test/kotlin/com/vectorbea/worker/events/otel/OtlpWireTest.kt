package com.vectorbea.worker.events.otel

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import com.vectorbea.worker.connector.SecretService
import com.vectorbea.worker.testsupport.noOpDataSource
import io.opentelemetry.sdk.resources.Resource
import java.net.InetSocketAddress
import java.time.Instant
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * §9 — the wire. What `RunTraceExportTest` cannot cover.
 *
 * That test asserts the `SpanData` handed to the exporter, which is everything a
 * Jaeger screenshot would show. It stops at the exporter's front door. This one
 * starts there: a real [io.opentelemetry.exporter.otlp.http.trace.OtlpHttpSpanExporter],
 * a real HTTP request, a real receiver.
 *
 * The receiver is `com.sun.net.httpserver`, in-process. It does not decode
 * protobuf — that would mean carrying the OTLP proto classes into the test source
 * set to re-implement what a collector already does. What it CAN assert without
 * them is everything that actually goes wrong in practice: the wrong path, the
 * wrong content type, an empty body, a rejection swallowed as success, and a
 * missing auth header. Protobuf encodes strings as raw UTF-8, so a byte search
 * for the service name and the span name is a crude but genuine check that our
 * data reached the payload rather than an empty envelope.
 *
 * Together with `RunTraceExportTest`, the only untested link left is a
 * collector's own ingestion of a well-formed OTLP payload.
 */
class OtlpWireTest {

    private class Receiver(private val statusCode: Int = 200) {
        val server: HttpServer = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val requests = java.util.Collections.synchronizedList(mutableListOf<Captured>())
        val arrived = CountDownLatch(1)
        val count = AtomicInteger()

        class Captured(val path: String, val contentType: String?, val auth: String?, val body: ByteArray)

        init {
            server.createContext("/") { ex: HttpExchange ->
                val body = ex.requestBody.readBytes()
                requests += Captured(
                    ex.requestURI.path,
                    ex.requestHeaders.getFirst("Content-Type"),
                    ex.requestHeaders.getFirst("Authorization"),
                    body)
                count.incrementAndGet()
                ex.sendResponseHeaders(statusCode, -1)
                ex.close()
                arrived.countDown()
            }
            server.executor = null
            server.start()
        }

        val endpoint: String get() = "http://127.0.0.1:${server.address.port}"
        fun stop() = server.stop(0)
    }

    /**
     * A config whose row is synthetic, so the wire test needs no database.
     *
     * `destinationFor` and `build` are the REAL ones — that is the point. Only the
     * row is substituted.
     */
    private fun configFor(endpoint: String, headersRef: String?) =
        object : TraceExportConfig(noOpDataSource(), SecretService(null, noOpDataSource())) {
            override fun rowFor(workspaceId: UUID) = Row(
                workspaceId = workspaceId,
                endpoint = endpoint,
                protocol = "http/protobuf",
                headersSecretRef = headersRef,
                serviceName = "vectorbea-agents",
                resourceAttributesJson = """{"deployment.environment":"test"}""",
                timeoutMs = 5_000,
                updatedAtMs = 1L,
            )
        }

    private fun sampleSpans(resource: Resource) = listOf(
        OtelSpanMapper.toSpanData(
            OtelSpanMapper.Row(
                spanId = UUID.randomUUID(), traceId = UUID.randomUUID(), runId = UUID.randomUUID(),
                parentSpanId = null, workspaceId = UUID.randomUUID(),
                kind = "llm_call", name = "claude-opus-5", status = "ok",
                stepId = "n-1", activationId = null, iterationIndex = null, attempt = 1,
                startedAt = Instant.now().minusSeconds(2), endedAt = Instant.now(),
                durationMs = 2_000, selfMs = 2_000,
                attributesJson = """{"provider":"anthropic","model":"claude-opus-5"}""",
                failureClass = null, isRootCause = false,
                tokensIn = 100, tokensOut = 20, costCents = 0.5,
            ), resource))

    @Test
    fun `spans reach a real OTLP receiver at the right path and content type`() {
        val receiver = Receiver()
        try {
            val config = configFor(receiver.endpoint, headersRef = null)
            val row = config.rowFor(UUID.randomUUID())!!
            val dest = assertNotNull(config.destinationFor(row), "the exporter must build")

            val result = dest.exporter.export(sampleSpans(dest.resource))
                .join(10, TimeUnit.SECONDS)
            assertTrue(result.isSuccess, "a 200 from the receiver must be a success")
            assertTrue(receiver.arrived.await(10, TimeUnit.SECONDS), "no request arrived")

            val req = receiver.requests.single()
            assertEquals("/v1/traces", req.path,
                "the signal path is appended to the configured endpoint, not assumed")
            assertEquals("application/x-protobuf", req.contentType)
            assertTrue(req.body.isNotEmpty(), "an empty body is an exporter that sent nothing")

            /* The payload really carries our data, not just a well-formed envelope.
               Protobuf writes strings as raw UTF-8, so these appear verbatim. */
            val bytes = String(req.body, Charsets.ISO_8859_1)
            assertTrue(bytes.contains("vectorbea-agents"), "the service name must be in the resource")
            assertTrue(bytes.contains("chat claude-opus-5"), "the span name must be in the payload")
            assertTrue(bytes.contains("gen_ai.system"), "the GenAI attributes must be in the payload")
            assertTrue(bytes.contains("com.vectorbea.agent-runtime"), "the scope must be in the payload")
        } finally {
            receiver.stop()
        }
    }

    /**
     * A rejection must be a failure.
     *
     * `RunTraceExporter` turns a failed result into a recorded `last_error`. If a
     * 503 came back as success, a customer's collector could be down for a week
     * and the settings screen would show a healthy export the whole time.
     */
    @Test
    fun `a receiver that rejects produces a failed result`() {
        val receiver = Receiver(statusCode = 503)
        try {
            val config = configFor(receiver.endpoint, headersRef = null)
            val row = config.rowFor(UUID.randomUUID())!!
            val dest = config.destinationFor(row)!!
            val result = dest.exporter.export(sampleSpans(dest.resource)).join(10, TimeUnit.SECONDS)
            assertTrue(!result.isSuccess, "a 503 must not be reported as a successful export")
        } finally {
            receiver.stop()
        }
    }

    /**
     * The auth header reaches the receiver.
     *
     * The ref here is plaintext because `SecretService` with no key is in dev mode
     * and hands back what it was given — which is exactly the path a local
     * developer takes. In production the same ref is an `aes256gcm:` blob and this
     * code does not know the difference, which is the point of going through
     * SecretService rather than reading a column.
     */
    @Test
    fun `configured auth headers are sent`() {
        val receiver = Receiver()
        try {
            val config = configFor(receiver.endpoint,
                headersRef = """{"Authorization":"Bearer test-token"}""")
            val row = config.rowFor(UUID.randomUUID())!!
            val dest = config.destinationFor(row)!!
            dest.exporter.export(sampleSpans(dest.resource)).join(10, TimeUnit.SECONDS)
            assertTrue(receiver.arrived.await(10, TimeUnit.SECONDS))
            assertEquals("Bearer test-token", receiver.requests.single().auth)
        } finally {
            receiver.stop()
        }
    }

    /**
     * An unimplemented protocol is refused rather than downgraded.
     *
     * Silently sending protobuf to a gRPC endpoint produces a 400 with nothing in
     * it that names the cause, and the operator's only clue is that it does not
     * work.
     */
    @Test
    fun `an unsupported protocol builds no exporter`() {
        val config = object : TraceExportConfig(noOpDataSource(), null) {
            override fun rowFor(workspaceId: UUID) = Row(
                workspaceId, "http://127.0.0.1:1", "grpc", null,
                "svc", "{}", 1_000, 1L)
        }
        val row = config.rowFor(UUID.randomUUID())!!
        assertEquals(null, config.destinationFor(row),
            "an unimplemented protocol must fail to build, not fall back")
    }

    /**
     * `service.name` cannot be overridden by a workspace's resource attributes.
     *
     * A workspace that could rename the service to match one of its own would
     * silently merge our spans into their application's service in their map.
     */
    @Test
    fun `a workspace cannot rename the service through resource attributes`() {
        val config = object : TraceExportConfig(noOpDataSource(), null) {
            override fun rowFor(workspaceId: UUID) = Row(
                workspaceId, "http://127.0.0.1:1", "http/protobuf", null,
                "vectorbea-agents",
                """{"service.name":"their-checkout-api","team":"platform"}""",
                1_000, 1L)
        }
        val dest = config.destinationFor(config.rowFor(UUID.randomUUID())!!)!!
        val attrs = dest.resource.attributes
        assertEquals("vectorbea-agents",
            attrs.get(io.opentelemetry.api.common.AttributeKey.stringKey("service.name")))
        assertEquals("platform",
            attrs.get(io.opentelemetry.api.common.AttributeKey.stringKey("team")),
            "other resource attributes are still honoured")
    }
}
