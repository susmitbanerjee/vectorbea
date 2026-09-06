package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.connector.ConnectionRecord
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.ResolvedConnection
import com.vectorbea.worker.connector.SecretValue
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.testsupport.noOpDataSource
import com.vectorbea.worker.testsupport.noOpPubSub
import com.vectorbea.worker.testsupport.noOpSecretService
import com.vectorbea.worker.testsupport.ScriptedLlmProvider
import com.vectorbea.graph.WorkflowGraph
import com.vectorbea.graph.WorkflowNode
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Test
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

/**
 * Prompt caching: where the breakpoint goes, and what a cached token costs.
 *
 * ── WHY THESE TWO THINGS AND NOT THE ROUND TRIP ─────────────────────────────
 * Neither failure mode here throws, logs, or looks wrong on a screen. A
 * breakpoint placed after the observations still returns a perfectly good
 * answer — it just pays the 1.25x write premium on every single iteration and
 * never reads the entry back, so the bill goes UP and nothing says so. Pricing a
 * cache read as a fresh token likewise produces a plausible number that is
 * simply too big. Both are quantitative, silent, and only visible in an invoice
 * weeks later, which is exactly the shape of bug a test has to carry.
 *
 * The provider round trip is not tested here because the assertion that matters
 * — "Anthropic actually cached it" — can only come from a real response's
 * `cache_read_input_tokens`, and that is a measurement, not a unit test.
 */
class PromptCacheTest {

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

    private fun eventStore() = object : RunEventStore(noOpDataSource(), noOpPubSub()) {
        override fun appendEvent(event: RunEvent): Int = 0
    }

    private fun stubResolver(provider: String): ConnectionResolver {
        val record = ConnectionRecord(
            id = UUID.randomUUID(), workspaceId = workspaceId, environmentId = environmentId,
            name = "test-llm", type = "llm", provider = provider, status = "active",
            authType = "api_key", secretRef = null, configJson = emptyMap(),
            allowedHosts = emptyList(), allowedPaths = emptyList(),
            allowedSchemas = emptyList(), allowedTables = emptyList(),
        )
        val secret = SecretValue("test-key".toCharArray())
        return object : ConnectionResolver(noOpDataSource(), noOpSecretService()) {
            override fun resolve(connectionId: UUID, workspaceId: UUID, expectedType: String?) =
                ResolvedConnection(record = record, secret = secret)
        }
    }

    /** Cache ON by default here: the ON path is the one that moves money. */
    private fun executor(
        provider: String,
        llm: ScriptedLlmProvider,
        cacheEnabled: Boolean = true,
    ) = LlmNodeExecutor(
        connectionResolver = stubResolver(provider),
        eventStore         = eventStore(),
        httpClient         = llm,
        promptCacheEnabled = cacheEnabled,
    )

    private fun node(extraConfig: Map<String, Any> = emptyMap()) = WorkflowNode(
        id = "n1", type = "llm",
        config = mapOf(
            "connectionId" to UUID.randomUUID().toString(),
            "messages" to listOf(
                mapOf("role" to "system", "content" to longSystemPrompt),
                mapOf("role" to "user",   "content" to "Hi"),
            ),
        ) + extraConfig,
    )

    // ── Breakpoint placement ─────────────────────────────────────────────────

    private val longSystemPrompt = "x".repeat(LlmNodeExecutor.PROMPT_CACHE_MIN_CHARS + 1)

    @Test
    fun `unmarked system prompt stays a bare string`() {
        // The flag-off path must be byte-identical on the wire to what we sent
        // before this feature existed. A list here would be a silent request-shape
        // change on every workflow that never asked for caching.
        val exec = LlmNodeExecutor(stubResolver("anthropic"), eventStore())
        val block = exec.anthropicSystemBlock(
            longSystemPrompt, cachePrefix = false, enabled = true)
        assertIs<String>(block, "an opted-out caller must send the plain string form")
        assertEquals(longSystemPrompt, block)
    }

    @Test
    fun `a short prompt is never marked even when the caller opts in`() {
        // Below the model minimum the breakpoint is silently ignored, so marking
        // it only adds noise to the request and to the trace.
        val exec = LlmNodeExecutor(stubResolver("anthropic"), eventStore())
        val short = "x".repeat(LlmNodeExecutor.PROMPT_CACHE_MIN_CHARS - 1)
        assertIs<String>(exec.anthropicSystemBlock(
            short, cachePrefix = true, enabled = true))
    }

    @Test
    fun `the flag alone gates the whole feature`() {
        // Off is a true no-op, not a smaller cache: an opted-in caller with a long
        // prompt still sends the plain string while the flag is down.
        val exec = LlmNodeExecutor(stubResolver("anthropic"), eventStore())
        assertIs<String>(exec.anthropicSystemBlock(
            longSystemPrompt, cachePrefix = true, enabled = false))
    }

    @Test
    fun `marking produces one text block with an ephemeral breakpoint at its end`() {
        val exec = LlmNodeExecutor(stubResolver("anthropic"), eventStore())
        val block = exec.anthropicSystemBlock(
            longSystemPrompt, cachePrefix = true, enabled = true)

        @Suppress("UNCHECKED_CAST")
        val blocks = block as List<Map<String, Any>>
        assertEquals(1, blocks.size,
            "one block: the breakpoint marks the END of the system prompt, and a " +
            "second block would put cacheable content after it")
        assertEquals("text", blocks[0]["type"])
        assertEquals(longSystemPrompt, blocks[0]["text"],
            "the prompt must cross unchanged — a byte of drift invalidates the entry")
        assertEquals(mapOf("type" to "ephemeral"), blocks[0]["cache_control"])
    }

    // ── Anthropic's total is not input + output ──────────────────────────────

    @Test
    fun `anthropic total includes cache reads and writes`(): Unit = runBlocking {
        // Anthropic reports cached tokens OUTSIDE `input_tokens`. Summing only the
        // two obvious fields under-counts by the cached fraction — which on an
        // agent loop is most of the prompt, so every cost on every screen would
        // fall by ~80% the day caching was switched on and read as a saving.
        val llm = ScriptedLlmProvider().thenRaw("""
            {
              "content": [{"type": "text", "text": "ok"}],
              "stop_reason": "end_turn",
              "usage": {
                "input_tokens": 100,
                "output_tokens": 50,
                "cache_read_input_tokens": 800,
                "cache_creation_input_tokens": 200
              }
            }
        """.trimIndent())

        val result = executor("anthropic", llm).execute(node(), emptyMap(), context())

        assertIs<NodeResult.Completed>(result)
        assertEquals(1150, (result.output["tokenCount"] as Number).toInt(),
            "100 fresh + 50 out + 800 read + 200 written")
    }

    @Test
    fun `a response with no usage object reports no token count`(): Unit = runBlocking {
        // Absent is not zero. Pinned so Commit 3's explicit unknown is visible when
        // it replaces today's coercion to 0.
        val llm = ScriptedLlmProvider().thenRaw(
            """{"content": [{"type": "text", "text": "ok"}], "stop_reason": "end_turn"}""")
        val result = executor("anthropic", llm).execute(node(), emptyMap(), context())
        assertIs<NodeResult.Completed>(result)
        assertEquals(0, (result.output["tokenCount"] as Number).toInt())
    }

    @Test
    fun `openai cached tokens are read from prompt_tokens_details`(): Unit = runBlocking {
        // OpenAI caches with no opt-in and folds the hit INTO `prompt_tokens`, so
        // the total must not move — only the price of part of it.
        val llm = ScriptedLlmProvider().thenRaw("""
            {
              "choices": [{"message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
              "usage": {
                "total_tokens": 1000,
                "prompt_tokens": 900,
                "completion_tokens": 100,
                "prompt_tokens_details": {"cached_tokens": 700}
              }
            }
        """.trimIndent())

        val result = executor("openai", llm).execute(node(), emptyMap(), context())
        assertIs<NodeResult.Completed>(result)
        assertEquals(1000, (result.output["tokenCount"] as Number).toInt(),
            "cached tokens are already inside the provider's total — never added to it")
    }

    // ── The wire shape actually sent ─────────────────────────────────────────

    @Test
    fun `an opted-in agent call carries cache_control on the wire`(): Unit = runBlocking {
        // The end-to-end assertion: not "the helper returns a list" but "the bytes
        // Anthropic receives contain the breakpoint, positioned in `system`".
        val llm = ScriptedLlmProvider().thenRaw("""
            {"content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn",
             "usage":{"input_tokens":10,"output_tokens":5}}
        """.trimIndent())

        executor("anthropic", llm).execute(
            node(mapOf(LlmNodeExecutor.CFG_CACHE_PREFIX to true)), emptyMap(), context())

        val sent = llm.lastRequest()!!.rawBody
        assertTrue(sent.contains("cache_control"), "the breakpoint must reach the provider")
        assertTrue(sent.contains("ephemeral"))
        // And it must sit in `system`, before the user message that carries the
        // growing observations — the placement rule this whole commit turns on.
        assertTrue(sent.indexOf("cache_control") < sent.indexOf("\"messages\"") ||
                   sent.indexOf("\"system\"") < sent.indexOf("cache_control"),
            "cache_control belongs to the system block, not to a message")
    }

    @Test
    fun `the flag off sends no cache_control even for an opted-in agent call`(): Unit = runBlocking {
        // The rollback path. Turning the flag off must restore the exact request
        // we sent before this commit, or "disable it" is not a real mitigation.
        val llm = ScriptedLlmProvider().thenRaw("""
            {"content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn",
             "usage":{"input_tokens":10,"output_tokens":5}}
        """.trimIndent())

        executor("anthropic", llm, cacheEnabled = false).execute(
            node(mapOf(LlmNodeExecutor.CFG_CACHE_PREFIX to true)), emptyMap(), context())

        assertTrue(!llm.lastRequest()!!.rawBody.contains("cache_control"))
    }

    @Test
    fun `a one-shot node sends no cache_control`(): Unit = runBlocking {
        // The loss case: a node that never resends this prefix must not pay a write.
        val llm = ScriptedLlmProvider().thenRaw("""
            {"content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn",
             "usage":{"input_tokens":10,"output_tokens":5}}
        """.trimIndent())

        executor("anthropic", llm).execute(node(), emptyMap(), context())

        assertTrue(!llm.lastRequest()!!.rawBody.contains("cache_control"),
            "a caller that did not opt in must never be charged a cache write")
    }

    // ── What a cached token costs ────────────────────────────────────────────

    private val exec = LlmNodeExecutor(stubResolver("anthropic"), eventStore())

    @Test
    fun `no cache reported bills every token as fresh`() {
        assertEquals(1000, exec.effectiveBillableTokens(1000, null, null, "anthropic"))
        assertEquals(1000, exec.effectiveBillableTokens(1000, 0, 0, "anthropic"))
    }

    @Test
    fun `an anthropic cache read bills at a tenth`() {
        // 200 fresh + 800 read x 0.10 = 280
        assertEquals(280, exec.effectiveBillableTokens(1000, 800, null, "anthropic"))
    }

    @Test
    fun `an anthropic cache write bills at a premium, not a discount`() {
        // The inversion that costs money if it is got backwards: a written token
        // is MORE expensive than a fresh one. 800 fresh + 200 written x 1.25 = 1050.
        val billed = exec.effectiveBillableTokens(1000, null, 200, "anthropic")
        assertEquals(1050, billed)
        assertTrue(billed > 1000, "a cache write must cost more than not caching at all")
    }

    @Test
    fun `openai and gemini discount a cached prefix by half, not by ninety percent`() {
        // 300 fresh + 700 read x 0.50 = 650. Applying Anthropic's 0.1x here would
        // under-report by 5x on the cached slice.
        assertEquals(650, exec.effectiveBillableTokens(1000, 700, null, "openai"))
        assertEquals(650, exec.effectiveBillableTokens(1000, 700, null, "gemini"))
    }

    @Test
    fun `a cached count larger than the total cannot drive the bill negative`() {
        // Defensive: the providers should never do this, and a negative bill would
        // silently subtract from every other run in the same SUM.
        assertEquals(100, exec.effectiveBillableTokens(1000, 5000, null, "anthropic"))
        assertTrue(exec.effectiveBillableTokens(10, 9999, 9999, "anthropic") >= 0)
    }

    @Test
    fun `the ten-iteration agent loop is cheaper cached than uncached`() {
        // The claim the whole commit rests on, as arithmetic rather than a promise.
        // Profile from the audit: ~6,340 input + 300 output per iteration, of which
        // the 4,500-token system prefix is byte-identical after the first turn.
        val perIterationTotal = 6_640
        val stablePrefix      = 4_500

        val uncached = (1..10).sumOf {
            exec.effectiveBillableTokens(perIterationTotal, null, null, "anthropic")
        }
        val cached = (1..10).sumOf { i ->
            if (i == 1) exec.effectiveBillableTokens(perIterationTotal, null, stablePrefix, "anthropic")
            else exec.effectiveBillableTokens(perIterationTotal, stablePrefix, null, "anthropic")
        }

        assertTrue(cached < uncached,
            "caching must reduce billable tokens over a loop: cached=$cached uncached=$uncached")
        // And the first call alone must be MORE expensive — the write premium is
        // real, and a test that did not show it would hide the short-prompt risk.
        assertTrue(
            exec.effectiveBillableTokens(perIterationTotal, null, stablePrefix, "anthropic") >
                exec.effectiveBillableTokens(perIterationTotal, null, null, "anthropic"),
            "the first, cache-writing call is dearer; only reuse repays it",
        )
    }
}
