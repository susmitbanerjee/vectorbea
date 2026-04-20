package com.vectorbea.sdk

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull

/**
 * Integration-style tests for [VectorBeaClient] backed by [MockWebServer].
 *
 * Each test spins up a real HTTP server on localhost so we exercise the full
 * OkHttp + deserialization + error-mapping stack.
 */
class VectorBeaClientTest {

    private lateinit var server: MockWebServer
    private lateinit var client: VectorBeaClient

    // A minimal valid prompt JSON the server can return
    private val validPromptJson = """
        {
          "promptId":        "pid-001",
          "promptVersionId": "pvid-001",
          "organizationId":  "org-001",
          "name":            "greet-user",
          "versionTag":      "v1.0.0",
          "templateText":    "Hello {{name}}!",
          "parameters":      {},
          "description":     "Greeting prompt",
          "createdAt":       "2024-01-01T00:00:00Z"
        }
    """.trimIndent()

    @BeforeTest
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = VectorBeaClient.Builder()
            .apiKey("vbagent_test_key")
            .baseUrl(server.url("/").toString().trimEnd('/'))
            .timeoutSeconds(5)
            .build()
    }

    @AfterTest
    fun tearDown() {
        client.close()
        server.shutdown()
    }

    // ── Success path ──────────────────────────────────────────────────────────

    @Test
    fun `getPrompt returns a Prompt on 200`() = runTest {
        // Enqueue the valid prompt response; audit POST will also need a response
        server.enqueue(MockResponse().setResponseCode(200).setBody(validPromptJson))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        val prompt = client.getPrompt("greet-user")

        assertEquals("greet-user", prompt.name)
        assertEquals("pvid-001", prompt.promptVersionId)
        assertEquals("v1.0.0", prompt.versionTag)
        assertEquals("Hello {{name}}!", prompt.templateText)
    }

    @Test
    fun `getPrompt calls the correct path`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(validPromptJson))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        client.getPrompt("greet-user")

        val request = server.takeRequest()
        assertEquals("/v1/prompts/greet-user", request.path)
        assertEquals("GET", request.method)
    }

    @Test
    fun `getPrompt sets Authorization header`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(validPromptJson))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        client.getPrompt("greet-user")

        val request = server.takeRequest()
        assertEquals("Bearer vbagent_test_key", request.getHeader("Authorization"))
    }

    @Test
    fun `compile result is correct after successful getPrompt`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(validPromptJson))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}"))

        val prompt = client.getPrompt("greet-user")
        val message = prompt.compile(mapOf("name" to "Alice"))

        assertEquals("Hello Alice!", message)
    }

    // ── 404 mapping ───────────────────────────────────────────────────────────

    @Test
    fun `getPrompt throws NotFoundException on 404`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(404)
                .setBody("""{"error":"prompt not found"}""")
        )

        assertFailsWith<NotFoundException> {
            client.getPrompt("non-existent-prompt")
        }
    }

    @Test
    fun `getPrompt strips workspace UUID from 404 message`() = runTest {
        // Server returns a message containing an internal workspace UUID.
        // The SDK must not forward the raw UUID to the caller.
        server.enqueue(
            MockResponse().setResponseCode(404).setBody(
                """{"error":"Prompt 'greet-user' not found. The agent token is linked to workspace 8a18b033-48ed-497f-a3b7-d93087897a81 — make sure the prompt was created and published in that same workspace."}"""
            )
        )

        val ex = assertFailsWith<NotFoundException> {
            client.getPrompt("greet-user")
        }
        assert("8a18b033-48ed-497f-a3b7-d93087897a81" !in (ex.message ?: "")) {
            "Raw UUID must not appear in the exception message"
        }
        assert("[id]" in (ex.message ?: "")) {
            "UUID should be replaced with [id] placeholder"
        }
    }

    @Test
    fun `getPrompt does not leak server detail in 401 message`() = runTest {
        // Server returns workspace context in the auth error — the SDK should
        // discard the server body entirely for 401 and use a fixed message.
        server.enqueue(
            MockResponse().setResponseCode(401).setBody(
                """{"error":"Token belongs to workspace 8a18b033-48ed-497f-a3b7-d93087897a81"}"""
            )
        )

        val ex = assertFailsWith<AuthenticationException> {
            client.getPrompt("greet-user")
        }
        assert("8a18b033" !in (ex.message ?: "")) {
            "Server detail must not appear in AuthenticationException message"
        }
    }

    // ── 401 mapping ───────────────────────────────────────────────────────────

    @Test
    fun `getPrompt throws AuthenticationException on 401`() = runTest {
        server.enqueue(
            MockResponse().setResponseCode(401)
                .setBody("""{"error":"invalid api key"}""")
        )

        assertFailsWith<AuthenticationException> {
            client.getPrompt("greet-user")
        }
    }

    // ── Timeout mapping ───────────────────────────────────────────────────────

    @Test
    fun `getPrompt throws TimeoutException when server is unresponsive`() = runTest {
        // NO_RESPONSE causes the socket to stall — the read timeout fires first
        server.enqueue(MockResponse().apply { socketPolicy = SocketPolicy.NO_RESPONSE })

        assertFailsWith<TimeoutException> {
            client.getPrompt("greet-user")
        }
    }

    // ── logAudit ──────────────────────────────────────────────────────────────

    @Test
    fun `logAudit posts to audit endpoint`() = runTest {
        server.enqueue(MockResponse().setResponseCode(200).setBody(validPromptJson))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}")) // auto audit
        server.enqueue(MockResponse().setResponseCode(200).setBody("{}")) // manual audit

        val prompt = client.getPrompt("greet-user")
        client.logAudit(prompt, llmLatencyMs = 432L, tokenCount = 87)

        // Consume the prompt GET request
        server.takeRequest()
        // Consume the auto-audit POST
        server.takeRequest()
        // Manual audit
        val auditRequest = server.takeRequest()

        assertEquals("POST", auditRequest.method)
        assertEquals("/v1/audit", auditRequest.path)
        assertNotNull(auditRequest.body)
    }
}
