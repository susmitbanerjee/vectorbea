package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.connector.ConnectionException
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.contract.ConstrainedDecoding
import com.vectorbea.worker.contract.Groundedness
import com.vectorbea.worker.net.ConnectionCircuit
import com.vectorbea.worker.replay.ModelCallRecorder
import com.vectorbea.worker.net.OutboundHttp
import com.vectorbea.worker.net.ProviderThrottle
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowNode
import java.net.URI
import java.net.http.HttpRequest
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
 *
 * AVAILABILITY:
 *  An LLM call is the single longest blocking operation the worker performs, and
 *  it happens on an agent-pool thread. All calls go through [OutboundHttp.send],
 *  which bounds connect, headers, **total call including body streaming**, and
 *  response size. `timeoutMs` from node config is honoured but clamped to the
 *  process ceiling — a node cannot configure an unbounded call.
 */
class LlmNodeExecutor(
    private val connectionResolver: ConnectionResolver,
    private val eventStore: RunEventStore,
    /** Injectable for tests; production always uses the shared, bounded client. */
    private val httpClient: java.net.http.HttpClient = OutboundHttp.client,
    /**
     * Per-connection breaker. Null disables it — the behaviour before breakers
     * existed, kept for the unit tests that construct this executor directly.
     */
    private val circuit: ConnectionCircuit? = null,
    /**
     * Records every call completely enough to replay it. Null disables recording —
     * which also means the run cannot be replayed, so production always supplies
     * it.
     */
    private val recorder: ModelCallRecorder? = null,
    /**
     * Non-null when this execution is a replay. Model calls are then served from
     * the recording and any attempt to reach a provider is a hard error.
     */
    private val replay: com.vectorbea.worker.replay.ReplayContext? = null,
    /**
     * Supplies the node's output contract, so a declared schema turns on
     * constrained decoding. Null means no contract lookup and therefore no
     * Layer 0 - which is why production always supplies it.
     */
    private val contracts: com.vectorbea.worker.contract.ContractValidator? = null,
) : NodeExecutor {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        const val DEFAULT_TIMEOUT_MS         = 60_000L
        const val DEFAULT_MAX_RESPONSE_BYTES = 1_048_576L // 1 MB
    }

    override suspend fun execute(
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
        // Clamp the node's timeout into the process ceiling — this is the
        // total-call budget, not a headers-only budget.
        val timeoutMs   = OutboundHttp.policy()
            .clampTotalCallMs((cfg["timeoutMs"] as? Number)?.toLong() ?: DEFAULT_TIMEOUT_MS)
        val maxRespBytes = (cfg["maxResponseBytes"] as? Number)?.toLong() ?: DEFAULT_MAX_RESPONSE_BYTES

        val nodeContract = contracts?.contractFor(context.workflowId, node.id)

        // ---- Layer 2: groundedness --------------------------------------------
        //
        // When the contract asks for citations, the schema sent to the provider is
        // the WRAPPED one - every field becomes {value, found, source_span} - and the
        // response is unwrapped again below. The author declared the simple shape and
        // never sees the envelope, which is what keeps turning groundedness on from
        // being a breaking edit to every downstream mapping.
        val grounded = Groundedness.enabled(nodeContract?.groundedness)
        val outputSchema = nodeContract?.schema?.let {
            if (grounded) Groundedness.wrapSchema(it) else it
        }

        @Suppress("UNCHECKED_CAST")
        val messages = buildMessages(
            // The addendum is not decoration: explicit permission to answer "not
            // present" is the half of Layer 2 that prevents fabrication in the first
            // place. A model asked to fill a schema with no sanctioned way to decline
            // invents a plausible value, because that is what the request implies.
            systemPrompt = (cfg["systemPrompt"] as? String).let { base ->
                if (!grounded) base
                else listOfNotNull(base, Groundedness.systemPromptAddendum()).joinToString("\n\n")
            },
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
        val capture = CallCapture()

        // ---- Layer 0: the node's declared schema, if it has one ----------------
        //
        // Read from the contract rather than from node config so there is ONE
        // definition of the node's output shape, versioned and content-hashed. A
        // schema duplicated in the graph would drift from the contract that
        // validates against it, and the two disagreeing is worse than either alone.

        // Record whatever happened, on every exit path.
        //
        // A local rather than a call at each return site: this method has five
        // ways out (success, circuit open, throttle, call failure, secret
        // missing) and an audit that covers only the happy one is not an audit.
        // The failure paths are the ones a replay most needs to reproduce.
        fun recordCall(
            outcome: String,
            response: LlmResponse? = null,
            error: String? = null,
        ) {
            val rec = recorder ?: return
            rec.record(ModelCallRecorder.ModelCall(
                runId = context.runId,
                workspaceId = context.workspaceId,
                environmentId = context.environmentId,
                nodeId = node.id,
                provider = provider,
                modelId = model,
                modelVersion = response?.modelVersion,
                temperature = temperature,
                topP = (cfg["topP"] as? Number)?.toDouble(),
                seed = (cfg["seed"] as? Number)?.toLong(),
                maxTokens = maxTokens,
                responseFormat = cfg["responseFormat"] as? String,
                promptHash = ModelCallRecorder.promptHash(messages),
                // Secrets stripped; the prompt is not. See ModelCallRecorder for
                // why the prompt and response are never redacted.
                requestJson = capture.requestJson,
                responseJson = capture.responseJson,
                logprobs = response?.logprobsJson,
                finishReason = response?.finishReason,
                tokensIn = response?.tokensIn,
                tokensOut = response?.tokensOut,
                latencyMs = System.currentTimeMillis() - startMs,
                costUsd = response?.tokenCount?.let { estimateCostUsd(it, model) },
                attemptNumber = context.attemptGroup,
                callIndex = 0,
                outcome = outcome,
                errorSanitized = error,
            ))
        }

        // ── Replay: answer from the recording, never from the provider ────────
        //
        // Placed before the secret is resolved, deliberately. A replay must work
        // on a run whose connection has since been deleted or whose key has been
        // rotated - the recording is the source of truth, and needing a live
        // credential to read it would make replay fail exactly when it is most
        // needed, during an incident.
        val liveAfterBoundary = replay != null && replay.isLive(node.id)
        capture.liveCallAllowed = liveAfterBoundary
        if (replay != null && !liveAfterBoundary) {
            val recorded = replay.nextModelCall(node.id, context.attemptGroup)

            // A recorded failure replays as a failure. Skipping it would let the
            // replayed run take a different branch from the original, which is the
            // divergence this whole change exists to eliminate.
            if (recorded.outcome != "ok") {
                emitEvent(context, node.id, EventType.NODE_FAILED, "failed",
                    title = "LLM call failed (replayed)",
                    summary = recorded.errorSanitized ?: "Recorded failure")
                return NodeResult.Failed(
                    "LLM call failed for node '${node.id}': ${recorded.errorSanitized ?: "recorded failure"}")
            }

            val replayed = parseFor(provider, recorded.responseBody)
            emitEvent(context, node.id, EventType.LLM_CALL_COMPLETED, "success",
                title = "LLM call replayed",
                summary = "provider=$provider model=${recorded.modelId} " +
                    "version=${recorded.modelVersion ?: "unknown"} REPLAYED - no provider call, no cost",
                durationMs = 0,
                modelName = recorded.modelId,
                // Tokens and cost are reported as zero rather than as the original
                // figures. They are the original run's cost and are already
                // attributed to it; repeating them here would double-count a spend
                // that never happened twice.
                tokenCount = 0,
                estimatedCost = 0.0)

            return NodeResult.Completed(
                output = mapOf(
                    "content"      to (replayed.content ?: ""),
                    "model"        to recorded.modelId,
                    "provider"     to provider,
                    "tokenCount"   to (replayed.tokenCount ?: 0),
                    "finishReason" to (replayed.finishReason ?: ""),
                ),
                metadata = mapOf(
                    "provider"   to provider,
                    "model"      to recorded.modelId,
                    "durationMs" to 0L,
                    "replayed"   to true,
                ),
            )
        }

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

                // Fail fast if this connection is already known to be down. The
                // alternative is burning the full timeout to rediscover it, once
                // per run, while holding a permit each time.
                circuit?.beforeCall(connectionId)
                callProvider(provider, model, baseUrl, apiKey, messages,
                    temperature, maxTokens, timeoutMs, maxRespBytes, capture, outputSchema)
                    .also { circuit?.onSuccess(connectionId) }
            }
        } catch (e: ConnectionCircuit.CircuitOpenException) {
            recordCall("error", error = "circuit open")
            emitEvent(context, node.id, EventType.NODE_FAILED, "failed",
                title = "Connection paused", summary = e.message)
            return NodeResult.Failed(e.message ?: "Connection temporarily unavailable")
        } catch (e: ProviderThrottledException) {
            // Hand the scheduling decision up. Suspending releases the permit;
            // sleeping here would hold it for the provider's whole backoff.
            recordCall("throttled", error = "provider rate limited")
            val decision = ProviderThrottle.decide(e.retryAfter, attempt = 0)
            WorkerMetrics.providerThrottleSuspendTotal.inc(provider)
            emitEvent(context, node.id, EventType.NODE_FAILED, "throttled",
                title = "Rate limited by $provider",
                summary = decision.userMessage(provider))
            log.info("[llm] {} rate limited [nodeId={}] — {} for {}ms",
                provider, node.id, if (decision.suspend) "suspending" else "backing off",
                decision.delayMs)
            return NodeResult.Throttled(provider, decision.delayMs, decision.userMessage(provider))
        } catch (e: LlmCallException) {
            val durationMs = System.currentTimeMillis() - startMs
            recordCall("error", error = e.message?.take(500))
            circuit?.onFailure(connectionId, e.message ?: "LLM call failed")
            log.warn("[llm] call failed [nodeId={}, provider={}, durationMs={}]: {}",
                node.id, provider, durationMs, e.message)
            return NodeResult.Failed("LLM call failed for node '${node.id}': ${e.message}")
        }

        val durationMs = System.currentTimeMillis() - startMs
        val estimatedCostUsd = result.tokenCount?.let { estimateCostUsd(it, model) }
        // ---- Verify the citations before anything is returned -----------------
        //
        // Before the output leaves this executor, not after: a fabricated citation
        // means a fabricated value, and the value must not reach the checkpoint
        // boundary as if it were real.
        var groundednessFailure: String? = null
        var groundingCounts: Map<String, Int> = emptyMap()
        // Kept alongside the counts because the confidence gate has to show a reviewer
        // WHICH field was doubtful and what it cited, not just how many failed. Counts
        // score the node; this is what the human reads.
        var groundingEvidence: Map<String, Any?> = emptyMap()
        var unverifiedCitation: String? = null
        val groundedOutput: Map<String, Any?>? = if (!grounded) null else {
            val parsedWrapped = runCatching {
                @Suppress("UNCHECKED_CAST")
                mapper.readValue(result.content ?: "{}", Map::class.java) as Map<String, Any?>
            }.getOrNull()

            val verdict = Groundedness.verify(parsedWrapped, Groundedness.sourceText(resolvedInputs))
            groundingCounts = mapOf(
                "verified" to verdict.verifiedCount,
                "fuzzy" to verdict.fuzzyCount,
                "unverified" to verdict.unverifiedCount,
                "absent" to verdict.absentCount,
                "claims" to verdict.claimsMade,
            )

            // `required` fails on a fabricated citation; `optional` verifies and
            // records but does not block - which is what makes it usable on a node
            // where some fields are extracted and some are generated.
            groundingEvidence = verdict.fields.associate { f ->
                f.field to mapOf(
                    "found" to f.found,
                    "span" to f.span,
                    "verified" to (f.verification?.verified ?: !f.found),
                    "level" to (f.verification?.level?.name ?: if (f.found) "NOT_FOUND" else "ABSENT"),
                    "offset" to f.verification?.offset,
                    "length" to f.span?.length,
                    "similarity" to f.verification?.similarity,
                )
            }
            unverifiedCitation = verdict.fabricated.firstOrNull()?.field

            if (verdict.fabricated.isNotEmpty() &&
                Groundedness.required(nodeContract?.groundedness)) {
                groundednessFailure = verdict.failureMessage()
            }
            verdict.unwrapped
        }

        if (groundednessFailure != null) {
            emitEvent(context, node.id, EventType.NODE_FAILED, "failed",
                title = "Citation could not be verified",
                summary = groundednessFailure)
            log.warn("[llm] groundedness failed [nodeId={}]: {}", node.id, groundednessFailure)
            return NodeResult.Failed(groundednessFailure)
        }

        recordCall("ok", response = result)

        // Cost, attributed. The event above already carries these numbers, but an event
        // is a row in Postgres — you cannot graph a rate from it, and "what is this
        // costing me right now" is a rate question.
        //
        // Micros because the counter is an integer: a call costing $0.0004 would
        // truncate to zero dollars and the meter would read 0.00 while money was
        // leaving the account.
        run {
            val ws = context.workspaceId.toString()
            val wf = context.workflowId.toString()
            WorkerMetrics.llmCallsTotal.inc(ws, model, "ok")
            result.tokenCount?.let {
                // The provider reports a single total here; split reporting arrives
                // per-provider and is not yet normalised, so `direction="total"` is
                // honest rather than a guess at the input/output ratio.
                WorkerMetrics.llmTokensTotal.inc(ws, wf, model, "total", delta = it.toLong())
            }
            estimatedCostUsd?.let {
                WorkerMetrics.llmCostMicros.inc(ws, wf, model, delta = Math.round(it * 1_000_000))
            }
        }

        emitEvent(context, node.id, EventType.LLM_CALL_COMPLETED, "success",
            title = "LLM call completed",
            summary = "provider=$provider model=$model durationMs=$durationMs" +
                    (result.tokenCount?.let { " tokens=$it" } ?: "") +
                    (estimatedCostUsd?.let { " cost=\$${"%.6f".format(it)}" } ?: ""),
            durationMs = durationMs,
            modelName = model,
            tokenCount = result.tokenCount,
            estimatedCost = estimatedCostUsd,
            // Verified / fuzzy / unverified per node - the citation half of the
            // confidence score.
            meta = if (groundingCounts.isEmpty()) null
                   else runCatching { mapper.writeValueAsString(groundingCounts) }.getOrNull())

        // With a schema declared, the structured object IS the output.
        //
        // Without this the node's output would be {content: "{\"risk_score\":80}"} and
        // every assertion would have to reach through a JSON string - which the
        // expression language deliberately cannot do. Layer 0 and Layer 1 have to
        // agree on what "the output" means, and this is where they are joined.
        @Suppress("UNCHECKED_CAST")
        val structured: Map<String, Any>? =
            if (groundedOutput != null) groundedOutput as Map<String, Any>
            else if (outputSchema == null) null
            else runCatching {
                @Suppress("UNCHECKED_CAST")
                mapper.readValue(result.content ?: "{}", Map::class.java) as Map<String, Any>
            }.getOrNull()

        return NodeResult.Completed(
            output = structured ?: mapOf(
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
                // The citation evidence has to survive the return, or confidence
                // scoring in the runtime has nothing to score. It was previously
                // written only to an event, where the runtime cannot reach it.
                + (if (groundingCounts.isEmpty()) emptyMap()
                   else mapOf(
                       "groundingCounts" to groundingCounts,
                       "groundingEvidence" to groundingEvidence,
                   ))
                + (unverifiedCitation?.let { mapOf("unverifiedCitation" to it) } ?: emptyMap())
        )
    }

    /**
     * The provider asked us to slow down.
     *
     * Separate from [LlmCallException] because the handling is opposite: a failure
     * ends the node, a throttle pauses the run and keeps its progress.
     */
    private class ProviderThrottledException(
        val provider: String,
        val retryAfter: String?,
    ) : RuntimeException("$provider rate limited this request")

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
        capture: CallCapture,
        /**
         * The node's declared output schema, when it has one.
         *
         * Non-null turns on constrained decoding for that provider - Layer 0. This
         * is the parameter that converts "please return JSON" into a structural
         * guarantee.
         */
        outputSchema: Map<String, Any?>?,
    ): LlmResponse = when (provider) {
        "anthropic" -> callAnthropic(model, baseUrl, apiKey, messages, temperature, maxTokens, timeoutMs, maxResponseBytes, capture, outputSchema)
        "gemini"    -> callGemini(model, baseUrl, apiKey, messages, temperature, maxTokens, timeoutMs, maxResponseBytes, capture, outputSchema)
        else        -> callOpenAiCompatible(provider, model, baseUrl, apiKey, messages, temperature, maxTokens, timeoutMs, maxResponseBytes, capture, outputSchema)
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
        capture: CallCapture,
        outputSchema: Map<String, Any?>?,
    ): LlmResponse {
        val url = (baseUrl?.trimEnd('/') ?: "https://api.openai.com") + "/v1/chat/completions"

        val body = buildMap<String, Any> {
            put("model", model)
            put("messages", messages)
            temperature?.let { put("temperature", it) }
            maxTokens?.let { put("max_tokens", it) }
            // Layer 0. `strict: true` is the whole point - without it json_schema is
            // advisory and the model may still return prose.
            outputSchema?.let { put("response_format", ConstrainedDecoding.openAiResponseFormat(it)) }
        }

        val response = doHttpPost(url, body,
            headers = mapOf(
                "Authorization" to "Bearer $apiKey",  // key in header, never URL
                "Content-Type"  to "application/json",
            ),
            timeoutMs = timeoutMs,
            maxResponseBytes = maxResponseBytes,
            provider = provider,
            capture = capture,
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
        capture: CallCapture,
        outputSchema: Map<String, Any?>?,
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
            // Anthropic has no response_format; a FORCED tool call is the
            // equivalent. tool_choice is what makes it forced - without it the model
            // may answer in prose and never call the tool.
            outputSchema?.let { putAll(ConstrainedDecoding.anthropicToolConfig(it)) }
        }

        val response = doHttpPost(url, body,
            headers = mapOf(
                "x-api-key"         to apiKey,             // key in header, never URL
                "anthropic-version" to "2023-06-01",
                "Content-Type"      to "application/json",
            ),
            timeoutMs = timeoutMs,
            maxResponseBytes = maxResponseBytes,
            provider = "anthropic",
            capture = capture,
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
        capture: CallCapture,
        outputSchema: Map<String, Any?>?,
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
                // Both keys or neither: responseSchema without responseMimeType is
                // silently ignored and the call returns prose.
                outputSchema?.let { putAll(ConstrainedDecoding.geminiGenerationConfig(it)) }
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
            provider = "gemini",
            capture = capture,
        )

        return parseGeminiResponse(response)
    }

    /**
     * Parse a recorded body with the same parser that read it live.
     *
     * Reusing the live parser is the point: if replay parsed differently from the
     * original execution the outputs would diverge for a reason that has nothing
     * to do with the model, and the byte-identical test would be checking the
     * wrong thing.
     */
    private fun parseFor(provider: String, body: String): LlmResponse = when (provider) {
        "anthropic" -> parseAnthropicResponse(body)
        "gemini"    -> parseGeminiResponse(body)
        else        -> parseOpenAiResponse(body)
    }

    // ── HTTP execution ────────────────────────────────────────────────────────

    private fun doHttpPost(
        url: String,
        body: Map<String, Any>,
        headers: Map<String, String>,
        timeoutMs: Long,
        maxResponseBytes: Long,
        provider: String,
        capture: CallCapture,
    ): String {
        // The backstop. Every replayed node should have returned a recorded
        // response before reaching here; if one did not, refusing is the only safe
        // answer — a replay that reaches the network has already broken its
        // promise.
        //
        // Skipped when the executor has explicitly authorised a live call, which
        // happens only past a partial-replay boundary the user asked for.
        if (replay != null && !capture.liveCallAllowed) {
            replay.refuseExternalCall("(http)", "$provider HTTP")
        }

        val bodyJson = mapper.writeValueAsString(body)
        // Captured before the call, so a request that fails or times out is still
        // recorded. A failed call the audit cannot see is a hole in the audit.
        capture.requestJson = bodyJson

        val reqBuilder = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .POST(HttpRequest.BodyPublishers.ofString(bodyJson))

        headers.forEach { (k, v) -> reqBuilder.header(k, v) }

        val result = try {
            WorkerMetrics.timeBlocking {
                OutboundHttp.send(reqBuilder, totalCallMs = timeoutMs,
                    maxResponseBytes = maxResponseBytes, httpClient = httpClient)
            }
        } catch (e: OutboundHttp.TotalCallTimeoutException) {
            WorkerMetrics.llmCallDurationSeconds.observeMs(timeoutMs, provider, "timeout")
            throw LlmCallException(
                "LLM call exceeded its ${timeoutMs}ms budget and was aborted " +
                    "(connect ${OutboundHttp.policy().httpConnectTimeoutMs}ms / total ${timeoutMs}ms). " +
                    "Raise the node's timeoutMs, or check the provider's status."
            )
        } catch (e: OutboundHttp.ResponseTooLargeException) {
            WorkerMetrics.llmCallDurationSeconds.observeMs(0, provider, "too_large")
            throw LlmCallException("LLM response exceeded the ${e.limitBytes}-byte limit and was aborted")
        } catch (e: Exception) {
            WorkerMetrics.llmCallDurationSeconds.observeMs(0, provider, "error")
            /* `e.message` is null for exactly the failures that matter most here:
               java.net.ConnectException and UnknownHostException from the JDK HTTP
               client usually carry their detail on the cause, so the naive form
               produced "ConnectException: null" — a message that says a connection
               problem happened and refuses to say which. Walk to the first cause
               that has something to say, and name the host, since "cannot reach
               api.openai.com" and "cannot reach the base URL you typed" are
               different problems with different fixes. */
            val detail = generateSequence(e as Throwable) { it.cause }
                .mapNotNull { it.message?.takeIf { m -> m.isNotBlank() } }
                .firstOrNull()
            val host = runCatching { URI.create(url).host }.getOrNull()
            throw LlmCallException(
                "HTTP request to ${host ?: "the provider"} failed: ${e.javaClass.simpleName}" +
                    // Nothing anywhere in the chain had a message: the exception type
                    // IS the whole diagnosis, and repeating it as its own detail
                    // ("ConnectException: ConnectException") only adds noise.
                    (detail?.let { ": ${it.take(200)}" } ?: "")
            )
        }

        // 429 is not a failure, and treating it as one is how a rate limit becomes
        // an incident: the node fails, the run retries, the retry is rate limited
        // too, and the provider's polite "slow down" turns into a failed workflow.
        if (result.statusCode == 429) {
            WorkerMetrics.llmCallDurationSeconds.observeMs(result.durationMs, provider, "throttled")
            throw ProviderThrottledException(
                provider = provider,
                // Header names are case-insensitive and providers disagree about
                // the casing, so match on the lower-cased name rather than
                // guessing which two spellings to try.
                retryAfter = result.headers.entries
                    .firstOrNull { it.key.lowercase() == "retry-after" }
                    ?.value?.firstOrNull(),
            )
        }

        if (result.statusCode !in 200..299) {
            WorkerMetrics.llmCallDurationSeconds.observeMs(result.durationMs, provider, "http_error")
            // Never log the response body raw — it may echo the request including prompt content
            throw LlmCallException("LLM API returned HTTP ${result.statusCode}")
        }

        WorkerMetrics.llmCallDurationSeconds.observeMs(result.durationMs, provider, "ok")
        capture.responseJson = result.body
        return result.body
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

            LlmResponse(
                content = content, finishReason = finish, tokenCount = tokenCount,
                // The provider echoes the version it actually served. This is the
                // field that distinguishes "gpt-4o" the alias from the specific
                // model that made the decision under audit.
                modelVersion = root["model"] as? String,
                tokensIn = (usage?.get("prompt_tokens") as? Number)?.toInt(),
                tokensOut = (usage?.get("completion_tokens") as? Number)?.toInt(),
                logprobsJson = (first["logprobs"])?.let { mapper.writeValueAsString(it) },
            )
        } catch (e: Exception) {
            throw LlmCallException("Failed to parse OpenAI response: ${e.javaClass.simpleName}")
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseAnthropicResponse(json: String): LlmResponse {
        return try {
            val root    = mapper.readValue(json, Map::class.java) as Map<String, Any>
            val content = root["content"] as? List<Map<String, Any>> ?: emptyList()

            // Under constrained decoding the answer arrives as a tool_use block's
            // `input`, not as a text block. Checked first: with a schema declared
            // there IS no text block, and reading one would return empty content
            // from a call that succeeded.
            val toolUse = content.firstOrNull { it["type"] == "tool_use" }
            if (toolUse != null) {
                val usage = root["usage"] as? Map<String, Any>
                val inTok = (usage?.get("input_tokens") as? Number)?.toInt()
                val outTok = (usage?.get("output_tokens") as? Number)?.toInt()
                return LlmResponse(
                    // Re-serialised so the caller sees JSON text whichever route the
                    // provider took. Downstream parses it identically either way.
                    content = mapper.writeValueAsString(toolUse["input"]),
                    finishReason = root["stop_reason"] as? String,
                    tokenCount = if (inTok != null && outTok != null) inTok + outTok else null,
                    modelVersion = root["model"] as? String,
                    tokensIn = inTok,
                    tokensOut = outTok,
                )
            }
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
        /**
         * Sanitised metadata JSON. Carries the groundedness counts - verified,
         * fuzzy, unverified, absent - which are the citation half of the confidence
         * score and are otherwise lost the moment the node returns.
         */
        meta: String? = null,
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
            metadataJsonSanitized = meta,
            durationMs     = durationMs,
            modelName      = modelName,
            tokenCount     = tokenCount,
            estimatedCost  = estimatedCost,
        ))
    } catch (_: Exception) { /* events are best-effort */ }

    // ── Internal types ────────────────────────────────────────────────────────

    /**
     * The parsed response, plus everything an audit needs that parsing used to
     * throw away.
     *
     * `rawBody` matters most: it is the byte string the provider actually sent,
     * and it is the only thing a replay can hand back that is guaranteed
     * identical. Everything else here is derived from it and stored alongside so
     * the common questions do not require re-parsing megabytes.
     */
    private data class LlmResponse(
        val content: String?,
        val finishReason: String? = null,
        val tokenCount: Int? = null,
        /** Resolved model version the provider served, not the alias we asked for. */
        val modelVersion: String? = null,
        val tokensIn: Int? = null,
        val tokensOut: Int? = null,
        val logprobsJson: String? = null,
    )

    /**
     * Carries the raw request and response out of the HTTP layer.
     *
     * Passed down the call chain rather than held in a field or a ThreadLocal:
     * this executor instance is shared across nodes, and execution is now
     * coroutine-based, so a ThreadLocal would attach the capture to whatever
     * thread happened to resume the continuation. Explicit threading is four extra
     * parameters and no chance of cross-talk.
     */
    private class CallCapture {
        var requestJson: String? = null
        var responseJson: String? = null

        /**
         * Set when this node is past a partial-replay boundary and a live call is
         * therefore intended.
         *
         * The HTTP backstop refuses every outbound call during a replay, which is
         * correct for a full replay and wrong for the live half of a partial one.
         * The decision is made once, by the executor, where the node id is known —
         * and carried here rather than re-derived in the HTTP layer, which has no
         * idea which node it is serving.
         */
        var liveCallAllowed: Boolean = false
    }
}

private class LlmCallException(message: String) : Exception(message)
