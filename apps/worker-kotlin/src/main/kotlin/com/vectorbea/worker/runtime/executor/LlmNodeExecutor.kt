package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.connector.ConnectionException
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import java.util.UUID

/**
 * Executes LLM nodes against OpenAI-compatible, Anthropic, and Gemini APIs.
 *
 * Node config keys (all from [WorkflowNode.config]):
 *   - connectionId  (UUID string, required)  — refers to a connection of type "llm"
 *   - model         (string, optional)        — overrides connection default model
 *   - messages      (List<Map>, required)     — chat message list [{role, content}]
 *   - temperature   (Double, optional)        — 0.0–2.0
 *   - maxTokens     (Int, optional)           — max completion tokens
 *   - systemPrompt  (String, optional)        — system message prepended to messages
 *   - timeoutMs     (Long, optional)          — per-request timeout; default 60 s
 *   - maxResponseBytes (Long, optional)       — response body size limit; default 1 MB
 *
 * SECURITY:
 *  - API keys are injected as HTTP headers — NEVER placed in URLs.
 *  - API key values are never logged, only provider/model metadata.
 *  - Connection validation happens before any network I/O.
 *  - Response bodies are capped at [DEFAULT_MAX_RESPONSE_BYTES].
 */
class LlmNodeExecutor(
    private val connectionResolver: ConnectionResolver,
    private val eventStore: RunEventStore,
    private val httpClient: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build(),
) : NodeExecutor {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        const val DEFAULT_TIMEOUT_MS         = 60_000L
        const val DEFAULT_MAX_RESPONSE_BYTES = 1_048_576L // 1 MB
    }

    override fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        context: RuntimeContext,
    ): NodeResult {
        val cfg = node.config

        // ── Resolve connection ────────────────────────────────────────────────
        val connectionIdStr = cfg["connectionId"] as? String
            ?: return NodeResult.Failed("LLM node '${node.id}' missing required config: connectionId")

        val connectionId = try { UUID.fromString(connectionIdStr) }
        catch (e: Exception) {
            return NodeResult.Failed("LLM node '${node.id}': invalid connectionId format")
        }

        val resolved = try {
            connectionResolver.resolve(connectionId, context.workspaceId, expectedType = "llm")
        } catch (e: ConnectionException) {
            emitEvent(context, node.id, EventType.CONNECTION_VALIDATION_FAILED,
                "failed", title = "Connection validation failed",
                summary = "connectionId=${connectionIdStr}")
            return NodeResult.Failed("Connection error for node '${node.id}': ${e.message}")
        }

        emitEvent(context, node.id, EventType.CONNECTION_RESOLVED, "info",
            title = "Connection resolved",
            summary = "provider=${resolved.record.provider}")

        // ── Build request ─────────────────────────────────────────────────────
        val provider    = resolved.record.provider.lowercase()
        val model       = cfg["model"] as? String
            ?: resolved.record.configJson["model"] as? String
            ?: defaultModelFor(provider)
        val timeoutMs   = (cfg["timeoutMs"] as? Number)?.toLong() ?: DEFAULT_TIMEOUT_MS
        val maxRespBytes = (cfg["maxResponseBytes"] as? Number)?.toLong() ?: DEFAULT_MAX_RESPONSE_BYTES

        @Suppress("UNCHECKED_CAST")
        val messages = buildMessages(
            systemPrompt = cfg["systemPrompt"] as? String,
            messages     = cfg["messages"] as? List<Map<String, Any>> ?: emptyList(),
            resolvedInputs = resolvedInputs,
        )

        val temperature = (cfg["temperature"] as? Number)?.toDouble()
        val maxTokens   = (cfg["maxTokens"] as? Number)?.toInt()
        val baseUrl     = resolved.record.configJson["baseUrl"] as? String

        emitEvent(context, node.id, EventType.LLM_CALL_STARTED, "running",
            title = "LLM call started",
            summary = "provider=$provider model=$model")

        val startMs = System.currentTimeMillis()

        val result = try {
            resolved.secret.use { secret ->
                val apiKey = secret?.let { sv ->
                    var key = ""
                    sv.useOnce { key = it }
                    key
                } ?: run {
                    emitEvent(context, node.id, EventType.SECRET_MISSING, "failed",
                        title = "Secret missing",
                        summary = "LLM connection '${resolved.record.name}' has no API key")
                    return NodeResult.Failed("No API key configured for LLM connection '${resolved.record.name}'")
                }

                callProvider(provider, model, baseUrl, apiKey, messages,
                    temperature, maxTokens, timeoutMs, maxRespBytes)
            }
        } catch (e: LlmCallException) {
            val durationMs = System.currentTimeMillis() - startMs
            log.warn("[llm] call failed [nodeId={}, provider={}, durationMs={}]: {}",
                node.id, provider, durationMs, e.message)
            return NodeResult.Failed("LLM call failed for node '${node.id}': ${e.message}")
        }

        val durationMs = System.currentTimeMillis() - startMs
        val estimatedCostUsd = result.tokenCount?.let { estimateCostUsd(it, model) }
        emitEvent(context, node.id, EventType.LLM_CALL_COMPLETED, "success",
            title = "LLM call completed",
            summary = "provider=$provider model=$model durationMs=$durationMs" +
                    (result.tokenCount?.let { " tokens=$it" } ?: "") +
                    (estimatedCostUsd?.let { " cost=\$${"%.6f".format(it)}" } ?: ""),
            durationMs = durationMs,
            modelName = model,
            tokenCount = result.tokenCount,
            estimatedCost = estimatedCostUsd)

        return NodeResult.Completed(
            output = mapOf(
                "content"    to (result.content ?: ""),
                "model"      to model,
                "provider"   to provider,
                "tokenCount" to (result.tokenCount ?: 0),
                "finishReason" to (result.finishReason ?: ""),
            ),
            metadata = mapOf(
                "provider"   to provider,
                "model"      to model,
                "durationMs" to durationMs,
            )
        )
    }

    // ── Provider dispatch ─────────────────────────────────────────────────────

    private fun callProvider(
        provider: String,
        model: String,
        baseUrl: String?,
        apiKey: String,
        messages: List<Map<String, Any>>,
        temperature: Double?,
        maxTokens: Int?,
        timeoutMs: Long,
        maxResponseBytes: Long,
    ): LlmResponse = when (provider) {
        "anthropic" -> callAnthropic(model, baseUrl, apiKey, messages, temperature, maxTokens, timeoutMs, maxResponseBytes)
        "gemini"    -> callGemini(model, baseUrl, apiKey, messages, temperature, maxTokens, timeoutMs, maxResponseBytes)
        else        -> callOpenAiCompatible(provider, model, baseUrl, apiKey, messages, temperature, maxTokens, timeoutMs, maxResponseBytes)
    }

    // ── OpenAI-compatible ─────────────────────────────────────────────────────

    private fun callOpenAiCompatible(
        provider: String,
        model: String,
        baseUrl: String?,
        apiKey: String,
        messages: List<Map<String, Any>>,
        temperature: Double?,
        maxTokens: Int?,
        timeoutMs: Long,
        maxResponseBytes: Long,
    ): LlmResponse {
        val url = (baseUrl?.trimEnd('/') ?: "https://api.openai.com") + "/v1/chat/completions"

        val body = buildMap<String, Any> {
            put("model", model)
            put("messages", messages)
            temperature?.let { put("temperature", it) }
            maxTokens?.let { put("max_tokens", it) }
        }

        val response = doHttpPost(url, body,
            headers = mapOf(
                "Authorization" to "Bearer $apiKey",  // key in header, never URL
                "Content-Type"  to "application/json",
            ),
            timeoutMs = timeoutMs,
            maxResponseBytes = maxResponseBytes,
        )

        return parseOpenAiResponse(response)
    }

    // ── Anthropic ─────────────────────────────────────────────────────────────

    private fun callAnthropic(
        model: String,
        baseUrl: String?,
        apiKey: String,
        messages: List<Map<String, Any>>,
        temperature: Double?,
        maxTokens: Int?,
        timeoutMs: Long,
        maxResponseBytes: Long,
    ): LlmResponse {
        val url = (baseUrl?.trimEnd('/') ?: "https://api.anthropic.com") + "/v1/messages"

        // Anthropic separates system prompt from messages
        val systemMsg = messages.firstOrNull { it["role"] == "system" }?.get("content") as? String
        val chatMessages = messages.filter { it["role"] != "system" }

        val body = buildMap<String, Any> {
            put("model", model)
            put("messages", chatMessages)
            put("max_tokens", maxTokens ?: 1024)
            systemMsg?.let { put("system", it) }
            temperature?.let { put("temperature", it) }
        }

        val response = doHttpPost(url, body,
            headers = mapOf(
                "x-api-key"         to apiKey,             // key in header, never URL
                "anthropic-version" to "2023-06-01",
                "Content-Type"      to "application/json",
            ),
            timeoutMs = timeoutMs,
            maxResponseBytes = maxResponseBytes,
        )

        return parseAnthropicResponse(response)
    }

    // ── Gemini ────────────────────────────────────────────────────────────────

    private fun callGemini(
        model: String,
        baseUrl: String?,
        apiKey: String,
        messages: List<Map<String, Any>>,
        temperature: Double?,
        maxTokens: Int?,
        timeoutMs: Long,
        maxResponseBytes: Long,
    ): LlmResponse {
        // NOTE: Gemini uses Bearer auth — API key goes in Authorization header, NOT as ?key= param
        val url = (baseUrl?.trimEnd('/') ?: "https://generativelanguage.googleapis.com") +
                "/v1beta/models/$model:generateContent"

        // Convert OpenAI-style messages to Gemini contents
        val contents = messages.filter { it["role"] != "system" }.map { msg ->
            val role = if (msg["role"] == "assistant") "model" else "user"
            mapOf("role" to role, "parts" to listOf(mapOf("text" to (msg["content"] ?: ""))))
        }

        val body = buildMap<String, Any> {
            put("contents", contents)
            val genConfig = buildMap<String, Any> {
                temperature?.let { put("temperature", it) }
                maxTokens?.let { put("maxOutputTokens", it) }
            }
            if (genConfig.isNotEmpty()) put("generationConfig", genConfig)
        }

        val response = doHttpPost(url, body,
            headers = mapOf(
                "Authorization" to "Bearer $apiKey",  // key in header, never URL
                "Content-Type"  to "application/json",
            ),
            timeoutMs = timeoutMs,
            maxResponseBytes = maxResponseBytes,
        )

        return parseGeminiResponse(response)
    }

    // ── HTTP execution ────────────────────────────────────────────────────────

    private fun doHttpPost(
        url: String,
        body: Map<String, Any>,
        headers: Map<String, String>,
        timeoutMs: Long,
        maxResponseBytes: Long,
    ): String {
        val bodyJson = mapper.writeValueAsString(body)

        val reqBuilder = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .timeout(Duration.ofMillis(timeoutMs))
            .POST(HttpRequest.BodyPublishers.ofString(bodyJson))

        headers.forEach { (k, v) -> reqBuilder.header(k, v) }

        val httpResponse = try {
            httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString())
        } catch (e: Exception) {
            throw LlmCallException("HTTP request failed: ${e.javaClass.simpleName}: ${e.message?.take(200)}")
        }

        val responseBody = httpResponse.body() ?: ""

        if (responseBody.length > maxResponseBytes) {
            throw LlmCallException("Response exceeded size limit (${responseBody.length} > $maxResponseBytes bytes)")
        }

        val status = httpResponse.statusCode()
        if (status !in 200..299) {
            // Never log the response body raw — it may echo the request including prompt content
            throw LlmCallException("LLM API returned HTTP $status")
        }

        return responseBody
    }

    // ── Response parsers ──────────────────────────────────────────────────────

    @Suppress("UNCHECKED_CAST")
    private fun parseOpenAiResponse(json: String): LlmResponse {
        return try {
            val root    = mapper.readValue(json, Map::class.java) as Map<String, Any>
            val choices = root["choices"] as? List<Map<String, Any>> ?: emptyList()
            val first   = choices.firstOrNull() ?: return LlmResponse(content = null)
            val message = first["message"] as? Map<String, Any>
            val content = message?.get("content") as? String
            val finish  = first["finish_reason"] as? String

            val usage      = root["usage"] as? Map<String, Any>
            val tokenCount = (usage?.get("total_tokens") as? Number)?.toInt()

            LlmResponse(content = content, finishReason = finish, tokenCount = tokenCount)
        } catch (e: Exception) {
            throw LlmCallException("Failed to parse OpenAI response: ${e.javaClass.simpleName}")
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseAnthropicResponse(json: String): LlmResponse {
        return try {
            val root    = mapper.readValue(json, Map::class.java) as Map<String, Any>
            val content = root["content"] as? List<Map<String, Any>> ?: emptyList()
            val text    = content.firstOrNull { it["type"] == "text" }?.get("text") as? String
            val stop    = root["stop_reason"] as? String

            val usage      = root["usage"] as? Map<String, Any>
            val inputTokens  = (usage?.get("input_tokens") as? Number)?.toInt() ?: 0
            val outputTokens = (usage?.get("output_tokens") as? Number)?.toInt() ?: 0

            LlmResponse(content = text, finishReason = stop, tokenCount = inputTokens + outputTokens)
        } catch (e: Exception) {
            throw LlmCallException("Failed to parse Anthropic response: ${e.javaClass.simpleName}")
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseGeminiResponse(json: String): LlmResponse {
        return try {
            val root        = mapper.readValue(json, Map::class.java) as Map<String, Any>
            val candidates  = root["candidates"] as? List<Map<String, Any>> ?: emptyList()
            val first       = candidates.firstOrNull() ?: return LlmResponse(content = null)
            val contentMap  = first["content"] as? Map<String, Any>
            val parts       = contentMap?.get("parts") as? List<Map<String, Any>> ?: emptyList()
            val text        = parts.firstOrNull()?.get("text") as? String
            val finishReason = first["finishReason"] as? String

            val usageMeta  = root["usageMetadata"] as? Map<String, Any>
            val tokenCount = (usageMeta?.get("totalTokenCount") as? Number)?.toInt()

            LlmResponse(content = text, finishReason = finishReason, tokenCount = tokenCount)
        } catch (e: Exception) {
            throw LlmCallException("Failed to parse Gemini response: ${e.javaClass.simpleName}")
        }
    }

    // ── Message construction ──────────────────────────────────────────────────

    private fun buildMessages(
        systemPrompt: String?,
        messages: List<Map<String, Any>>,
        resolvedInputs: Map<String, Any>,
    ): List<Map<String, Any>> {
        val result = mutableListOf<Map<String, Any>>()
        if (!systemPrompt.isNullOrBlank()) {
            result += mapOf("role" to "system", "content" to systemPrompt)
        }
        // If no messages provided but there are resolved inputs, synthesize a user message
        if (messages.isEmpty() && resolvedInputs.isNotEmpty()) {
            val content = resolvedInputs["prompt"] as? String
                ?: resolvedInputs["message"] as? String
                ?: resolvedInputs["input"] as? String
                ?: mapper.writeValueAsString(resolvedInputs)
            result += mapOf("role" to "user", "content" to content)
        } else {
            result += messages
        }
        return result
    }

    private fun defaultModelFor(provider: String): String = when (provider) {
        "anthropic" -> "claude-3-5-haiku-20241022"
        "gemini"    -> "gemini-2.0-flash"
        else        -> "gpt-4o-mini"
    }

    // ── Event helper ──────────────────────────────────────────────────────────

    /**
     * Estimate USD cost from token count and model name.
     * Rates are conservative approximations — accurate billing requires provider invoices.
     */
    private fun estimateCostUsd(tokens: Int, model: String): Double {
        val usdPerMillion = when {
            model.contains("gpt-4o-mini", ignoreCase = true) -> 0.60   // $0.60/M
            model.contains("gpt-4o",  ignoreCase = true)    -> 5.00   // $5.00/M
            model.contains("gpt-4.1-mini", ignoreCase = true)-> 0.40
            model.contains("gpt-4.1", ignoreCase = true)    -> 2.00
            model.contains("gpt-4",   ignoreCase = true)    -> 30.00  // gpt-4 turbo
            model.contains("gpt-3.5", ignoreCase = true)    -> 0.50
            model.contains("claude-3-5-haiku", ignoreCase = true) -> 0.80
            model.contains("claude-3-5", ignoreCase = true) -> 3.00
            model.contains("claude-3-haiku", ignoreCase = true) -> 0.25
            model.contains("claude-3-opus",  ignoreCase = true) -> 15.00
            model.contains("claude",  ignoreCase = true)    -> 3.00
            model.contains("gemini-1.5-flash", ignoreCase = true) -> 0.075
            model.contains("gemini-1.5-pro",   ignoreCase = true) -> 3.50
            model.contains("gemini",  ignoreCase = true)    -> 1.00
            else                                             -> 2.00   // safe default
        }
        return (tokens / 1_000_000.0) * usdPerMillion
    }

    private fun emitEvent(
        ctx: RuntimeContext,
        nodeId: String,
        type: EventType,
        status: String,
        title: String? = null,
        summary: String? = null,
        durationMs: Long? = null,
        modelName: String? = null,
        tokenCount: Int? = null,
        estimatedCost: Double? = null,
    ) = try {
        eventStore.appendEvent(RunEvent(
            runId          = ctx.runId,
            workspaceId    = ctx.workspaceId,
            environmentId  = ctx.environmentId,
            type           = type,
            status         = status,
            stepId         = nodeId,
            title          = title,
            summary        = summary,
            durationMs     = durationMs,
            modelName      = modelName,
            tokenCount     = tokenCount,
            estimatedCost  = estimatedCost,
        ))
    } catch (_: Exception) { /* events are best-effort */ }

    // ── Internal types ────────────────────────────────────────────────────────

    private data class LlmResponse(
        val content: String?,
        val finishReason: String? = null,
        val tokenCount: Int? = null,
    )
}

private class LlmCallException(message: String) : Exception(message)
