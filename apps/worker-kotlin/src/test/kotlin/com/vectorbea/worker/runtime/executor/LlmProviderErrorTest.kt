package com.vectorbea.worker.runtime.executor

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * An OpenAI 400 used to surface as "LLM API returned HTTP 400" and nothing else.
 */
class LlmProviderErrorTest {

    @Test
    fun `the provider's own message is kept, with its code`() {
        val openAi = """{"error":{"message":"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.","type":"invalid_request_error","param":"max_tokens","code":"unsupported_parameter"}}"""
        assertEquals(
            "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead. (unsupported_parameter)",
            providerErrorDetail(openAi),
        )
        val anthropic = """{"type":"error","error":{"type":"invalid_request_error","message":"messages: text content blocks must be non-empty"}}"""
        assertEquals("messages: text content blocks must be non-empty (invalid_request_error)", providerErrorDetail(anthropic))
    }

    @Test
    fun `nothing credential-shaped survives, and a body without an error field says nothing`() {
        val leaky = """{"error":{"message":"Incorrect API key provided: sk-proj-abc123XYZ. You can find your API key at …"}}"""
        val detail = providerErrorDetail(leaky)!!
        assertFalse(detail.contains("sk-proj-abc123XYZ"))
        assertTrue(detail.contains("[REDACTED-KEY]"))
        assertNull(providerErrorDetail("""{"choices":[]}"""))
        assertNull(providerErrorDetail("<html>Bad gateway</html>"))
    }

    @Test
    fun `reasoning models on OpenAI get the parameters they accept`() {
        assertTrue(isOpenAiReasoningModel("openai", null, "o4-mini"))
        assertTrue(isOpenAiReasoningModel("openai", "https://api.openai.com", "gpt-5-mini"))
        assertFalse(isOpenAiReasoningModel("openai", null, "gpt-4o-mini"))
        assertFalse(isOpenAiReasoningModel("groq", "https://api.groq.com/openai", "o3"))
    }
}

/** A required tool input that resolved to nothing fails by name, before the call. */
class MissingToolInputTest {
    private val schema = """{"type":"object","properties":{"text":{"type":"string"},"thread_ts":{"type":"string"}},"required":["text"]}"""

    @Test
    fun `an empty or absent required input is reported with the reference it came from`() {
        assertEquals(listOf("text"), missingRequiredInputs(schema, mapOf("thread_ts" to "1"), emptyMap()))
        assertEquals(listOf("text"), missingRequiredInputs(schema, mapOf("text" to "  "), emptyMap()))
        val message = missingInputsMessage("Post a message (Slack)", listOf("text"),
            mapOf("text" to "{{ steps.n-agent-3.output.message }}"))
        assertTrue(message.contains("text comes from {{ steps.n-agent-3.output.message }}, which was empty"))
    }

    @Test
    fun `a value fixed on the tool or supplied at call time satisfies it`() {
        assertTrue(missingRequiredInputs(schema, mapOf("text" to "hi"), emptyMap()).isEmpty())
        assertTrue(missingRequiredInputs(schema, emptyMap(), mapOf("boundParameters" to mapOf("text" to "fixed"))).isEmpty())
        assertTrue(missingRequiredInputs(null, emptyMap(), emptyMap()).isEmpty())
    }
}
