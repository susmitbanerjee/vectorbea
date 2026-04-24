package com.vectorbea.sdk

import kotlinx.serialization.json.*
import java.io.Closeable
import kotlin.time.TimeSource

/** Per-model cost rates in USD per token. */
private val MODEL_COSTS = mapOf(
    "gpt-4o"               to Pair(5.00 / 1_000_000.0, 15.00 / 1_000_000.0),
    "gpt-4o-mini"          to Pair(0.15 / 1_000_000.0,  0.60 / 1_000_000.0),
    "gpt-4-turbo"          to Pair(10.00 / 1_000_000.0, 30.00 / 1_000_000.0),
    "gpt-3.5-turbo"        to Pair(0.50 / 1_000_000.0,  1.50 / 1_000_000.0),
    "claude-3-5-sonnet-20241022" to Pair(3.00 / 1_000_000.0, 15.00 / 1_000_000.0),
    "claude-3-haiku-20240307"    to Pair(0.25 / 1_000_000.0,  1.25 / 1_000_000.0),
)

private fun costForModel(model: String, tokensIn: Int, tokensOut: Int): Triple<Double, Double, Double> {
    val rates = MODEL_COSTS[model]
        ?: MODEL_COSTS.entries.firstOrNull { model.startsWith(it.key) }?.value
        ?: return Triple(0.0, 0.0, 0.0)
    val inputCost  = tokensIn  * rates.first
    val outputCost = tokensOut * rates.second
    return Triple(inputCost, outputCost, inputCost + outputCost)
}

/**
 * Holds in-flight trace state and flushes an audit event on [finish] / [close].
 *
 * Obtain via [VectorBeaClient.trace]:
 * ```kotlin
 * client.trace(prompt, inputText = message).use { t ->
 *     val response = openai.chat(...)
 *     t.record(response)
 * }
 * ```
 */
class TraceSession internal constructor(
    private val client: VectorBeaClient,
    private val prompt: Prompt,
    private val inputText: String,
    private val sidecar: String,
    private val environment: String,
    private val extraMetadata: Map<String, Any?>,
    private val costOverrideInput: Double?,
    private val costOverrideOutput: Double?,
) : Closeable {

    private val startMark = TimeSource.Monotonic.markNow()

    private var model       = ""
    private var provider    = ""
    private var tokensIn    = 0
    private var tokensOut   = 0
    private var totalTokens = 0
    private var outputText  = ""
    private var inputCost   = 0.0
    private var outputCost  = 0.0
    private var totalCost   = 0.0
    private var cacheStatus = "miss"
    private var guardrail   = "passed"
    private var rag: Map<String, Any?>? = null
    private var status      = "success"
    private var llmMs       = 0L
    private var finished    = false

    /**
     * Record the LLM response. Supports:
     * - OpenAI4J / openai-java style objects (has `choices` + `usage` fields via reflection)
     * - Anthropic Java SDK objects (has `content` + `usage.inputTokens` via reflection)
     * - A plain [Map] with keys: model, provider, tokensIn, tokensOut, output
     */
    @Suppress("UNCHECKED_CAST")
    fun record(response: Any): TraceSession {
        llmMs = startMark.elapsedNow().inWholeMilliseconds

        when (response) {
            is Map<*, *> -> {
                model      = response["model"] as? String ?: ""
                provider   = response["provider"] as? String ?: ""
                tokensIn   = (response["tokensIn"] as? Number)?.toInt() ?: 0
                tokensOut  = (response["tokensOut"] as? Number)?.toInt() ?: 0
                totalTokens = (response["totalTokens"] as? Number)?.toInt() ?: tokensIn + tokensOut
                outputText = response["output"] as? String ?: ""
            }
            else -> extractViaReflection(response)
        }
        computeCost()
        return this
    }

    private fun extractViaReflection(response: Any) {
        val cls = response::class.java
        runCatching { model = cls.getMethod("model").invoke(response) as? String ?: "" }
        // OpenAI: response.choices[0].message().content()
        runCatching {
            val choices = cls.getMethod("choices").invoke(response) as List<*>
            val first   = choices.firstOrNull() ?: return@runCatching
            val msg     = first::class.java.getMethod("message").invoke(first)
            outputText  = msg::class.java.getMethod("content").invoke(msg) as? String ?: ""
            provider    = "openai"
        }
        // Anthropic: response.content()[0].text()
        runCatching {
            val content = cls.getMethod("content").invoke(response) as List<*>
            val first   = content.firstOrNull() ?: return@runCatching
            outputText  = first::class.java.getMethod("text").invoke(first) as? String ?: ""
            provider    = "anthropic"
        }
        // Usage — OpenAI style
        runCatching {
            val usage = cls.getMethod("usage").invoke(response) ?: return@runCatching
            val uCls  = usage::class.java
            tokensIn  = (uCls.getMethod("promptTokens").invoke(usage) as? Number)?.toInt() ?: 0
            tokensOut = (uCls.getMethod("completionTokens").invoke(usage) as? Number)?.toInt() ?: 0
            totalTokens = (runCatching { uCls.getMethod("totalTokens").invoke(usage) as? Number }.getOrNull()?.toInt())
                ?: tokensIn + tokensOut
        }
        // Usage — Anthropic style
        runCatching {
            val usage = cls.getMethod("usage").invoke(response) ?: return@runCatching
            val uCls  = usage::class.java
            if (tokensIn == 0)  tokensIn  = (uCls.getMethod("inputTokens").invoke(usage) as? Number)?.toInt() ?: 0
            if (tokensOut == 0) tokensOut = (uCls.getMethod("outputTokens").invoke(usage) as? Number)?.toInt() ?: 0
            if (totalTokens == 0) totalTokens = tokensIn + tokensOut
        }
    }

    private fun computeCost() {
        if (costOverrideInput != null) {
            inputCost  = costOverrideInput * tokensIn
            outputCost = (costOverrideOutput ?: 0.0) * tokensOut
            totalCost  = inputCost + outputCost
        } else {
            val (ic, oc, tc) = costForModel(model, tokensIn, tokensOut)
            inputCost = ic; outputCost = oc; totalCost = tc
        }
    }

    fun setCacheStatus(s: String) = apply { cacheStatus = s }
    fun setGuardrail(action: String) = apply { guardrail = action }
    fun setStatus(s: String) = apply { status = s }
    fun setRag(query: String, chunks: List<Any?>, retrievalMs: Int = 0) = apply {
        rag = mapOf("query" to query, "chunks" to chunks,
                    "chunks_used" to chunks.size, "retrieval_ms" to retrievalMs)
    }

    /**
     * Flush the audit event to the VectorBea hub. Called automatically by [close].
     */
    suspend fun finish(error: Throwable? = null) {
        if (finished) return
        finished = true
        if (error != null) status = "error"
        if (llmMs == 0L) llmMs = startMark.elapsedNow().inWholeMilliseconds

        val richMetadata = buildRichMetadata()
        runCatching {
            client.logAuditRich(
                prompt      = prompt,
                llmLatencyMs = llmMs,
                tokenCount  = totalTokens.takeIf { it > 0 } ?: tokensIn + tokensOut,
                richMetadata = richMetadata,
            )
        }.onFailure { err ->
            System.err.println("[vectorbea] trace flush failed (non-fatal): ${err.message}")
        }
    }

    private fun buildRichMetadata(): Map<String, Any?> {
        val meta = mutableMapOf<String, Any?>(
            "cache"     to mapOf("status" to cacheStatus),
            "guardrail" to mapOf(
                "triggered" to (guardrail != "passed"),
                "action" to if (guardrail == "passed") "allow" else "warn",
            ),
            "executor"  to mapOf(
                "type" to "direct_provider",
                "ownership" to "vectorbea",
                "request_mode" to "direct",
                "response_observability" to "full",
            ),
            "trace"     to mapOf("environment" to environment, "status" to status),
        )
        if (sidecar.isNotBlank())    meta["sidecar"] = sidecar
        if (inputText.isNotBlank())  meta["request"] = mapOf("input" to mapOf("text" to inputText))
        if (outputText.isNotBlank()) meta["output"]  = mapOf("raw_text" to outputText, "final_text" to outputText)
        if (model.isNotBlank()) {
            meta["model"] = mapOf(
                "model"         to model,
                "provider"      to provider,
                "input_tokens"  to tokensIn,
                "output_tokens" to tokensOut,
                "total_tokens"  to (totalTokens.takeIf { it > 0 } ?: tokensIn + tokensOut),
                "latency_ms"    to llmMs,
                "cost"          to mapOf("input_cost" to inputCost, "output_cost" to outputCost, "total_cost" to totalCost),
            )
        }
        rag?.let { meta["retrieval"] = it }
        meta.putAll(extraMetadata)
        return meta
    }

    /** Implements [Closeable] for use with [use] blocks. Calls [finish] synchronously via runBlocking. */
    override fun close() {
        if (!finished) {
            kotlinx.coroutines.runBlocking { finish() }
        }
    }
}
