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
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowNode
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
    /**
     * Shared provider token bucket. §12.4. Null disables it entirely, which is
     * the behaviour of every deployment before it existed.
     */
    private val capacity: com.vectorbea.worker.net.ProviderCapacityBucket? = null,
    /**
     * Turns a prompt into the number of tokens the provider will bill for.
     *
     * Its own object rather than a method here because it holds two things this
     * class should not: the tokenizer's merge tables, which are megabytes and must
     * be loaded once, and the learned correction factor, which is state that
     * accumulates across calls. Default-constructed so no call site has to know
     * either exists.
     */
    private val tokenEstimator: com.vectorbea.worker.net.TokenEstimator =
        com.vectorbea.worker.net.TokenEstimator(),
    /**
     * Whether to ask Anthropic to cache the prefix. Defaults to the env flag.
     *
     * Injected rather than read straight from the companion at the point of use so
     * a test can exercise the ON path deterministically. A test that reads the
     * ambient environment passes whether or not the feature works, which on a
     * change that moves money is worse than having no test.
     *
     * It does NOT gate reading the cache figures back: those are recorded for all
     * three providers regardless, because OpenAI and Gemini cache whether or not
     * we asked. See [LlmResponse.cacheReadTokens].
     */
    private val promptCacheEnabled: Boolean = PROMPT_CACHE_ENABLED,
    /**
     * What a call costs, and whose price says so.
     *
     * Defaults to a pricing object with no database, which resolves to the
     * platform's list price — exactly the pre-V070 behaviour, and what the unit
     * tests that construct this executor directly want. Production supplies one
     * backed by a DataSource so a customer's negotiated rate is found.
     */
    private val pricing: com.vectorbea.worker.pricing.ModelPricing =
        com.vectorbea.worker.pricing.ModelPricing(null),
    /**
     * Where the prompt and the response of each call are recorded for the Debug tab.
     * Null records nothing; production passes
     * [com.vectorbea.worker.events.StepIoCapture.storeFor], which is null unless
     * TRACE_STEP_IO_ENABLED.
     */
    private val callPayloads: com.vectorbea.worker.events.PayloadStore? = null,
) : NodeExecutor {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        const val DEFAULT_TIMEOUT_MS         = 60_000L
        const val DEFAULT_MAX_RESPONSE_BYTES = 1_048_576L // 1 MB

        /**
         * The wire shapes this executor can speak.
         *
         * Three, and deliberately not more: an enterprise gateway that is not
         * one of these is not a gateway we can talk to, and saying so at
         * configuration time is better than discovering it inside a run. A
         * value outside this set falls back to inference rather than being
         * refused, because a typo in a config field must not take a working
         * connection down.
         */
        val PROTOCOLS = setOf("openai", "anthropic", "gemini")

        /**
         * Anthropic prompt caching. Off until measured — see the note on
         * [anthropicSystemBlock] for why this cannot be assumed to be a saving.
         */
        val PROMPT_CACHE_ENABLED: Boolean =
            System.getenv("LLM_PROMPT_CACHE_ENABLED")?.equals("true", ignoreCase = true) ?: false

        /**
         * The smallest system block worth marking, in characters.
         *
         * Anthropic will not cache a prefix below a model-dependent minimum
         * (roughly 1k-4k tokens); below it the breakpoint is silently ignored and
         * the tokens bill as ordinary input. ~4 chars per token is wrong for JSON
         * — see [com.vectorbea.worker.net.TokenEstimator] — so this is deliberately
         * generous rather than precise: its job is to skip prompts that obviously
         * cannot cache, not to predict the boundary. Tune from the measured hit
         * rate, which is the only number that settles it.
         */
        val PROMPT_CACHE_MIN_CHARS: Int =
            System.getenv("LLM_PROMPT_CACHE_MIN_CHARS")?.toIntOrNull()?.coerceAtLeast(0) ?: 4_000

        /**
         * Node config key: this caller resends the same prefix and wants it cached.
         *
         * Opt-IN, and this is the crux of the economics rather than a convenience.
         * A cache write costs 1.25x base input and only pays back on the SECOND
         * request that shares the prefix. An agent loop resends its system prompt
         * on every iteration and repays it immediately; a one-shot LLM node in a
         * workflow never sends that prefix again, so caching it is a pure 1.25x
         * loss on every call. Size alone cannot tell those two apart — only the
         * caller knows whether it is a loop.
         */
        const val CFG_CACHE_PREFIX = "cachePrefix"
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
        val protocol    = protocolFor(resolved.record)

        /*
         * ── THE LLM PATH HAD NO EGRESS CHECK AT ALL ─────────────────────
         * `HttpNodeExecutor` and `HttpToolResolver` both run `SsrfGuard` over the
         * URL they are about to call. This executor never did — `baseUrl` came
         * out of `config_json` and went straight into a request. A workspace
         * member can write a connection, so a `baseUrl` of
         * `http://169.254.169.254` reached the cloud metadata service with the
         * connection's own Authorization header attached.
         *
         * It went unnoticed because until now every LLM connection pointed at a
         * vendor: the field existed for Azure OpenAI and nobody typed anything
         * else into it. Making customer-hosted gateways a supported thing (V070)
         * turns that from a field nobody uses into the field the feature is
         * built on, so the check has to exist before the encouragement does.
         *
         * The DEFAULT policy still blocks every private address. A customer whose
         * gateway is genuinely internal sets `egress_policy = private_allowed`
         * and names the host, which is one deliberate decision recorded against
         * the connection — not a side effect of typing a URL.
         */
        if (baseUrl != null) {
            try {
                com.vectorbea.worker.connector.SsrfGuard.checkUrl(
                    baseUrl, resolved.record.allowedHosts, resolved.record.egressPolicy)
            } catch (e: com.vectorbea.worker.connector.UnresolvableHostException) {
                /*
                 * Not blocked — unreachable. Letting the request proceed produces
                 * the provider's own connection error, which names the real
                 * problem; refusing here would report a DNS outage as a security
                 * misconfiguration and send the reader to the wrong screen.
                 *
                 * Safe by construction: a name with no address reaches nothing,
                 * so there is no private address to have protected.
                 */
                log.warn("[llm] could not resolve the model endpoint for connection {}: {}",
                    connectionId, e.message)
            } catch (e: com.vectorbea.worker.connector.SsrfException) {
                emitEvent(context, node.id, EventType.NODE_FAILED, "failed",
                    title = "Model endpoint blocked",
                    summary = e.message?.take(200))
                return NodeResult.Failed(
                    "The model endpoint configured on this connection was refused: ${e.message}. " +
                        "If it is a gateway inside your own network, set the connection's egress " +
                        "policy to `private_allowed` and list the host.",
                    retryable = false)
            }
        }

        emitEvent(context, node.id, EventType.LLM_CALL_STARTED, "running",
            title = "LLM call started",
            summary = "provider=$provider model=$model")

        /* An agent's loop calls this with the AGENT STEP's node id, so every
           iteration's llm_call parents to that step — which is what makes "this step
           took 40s across six model calls" answerable in one look. */
        val llmSpan = runCatching {
            context.tracer?.open("llm_call", model,
                context.tracer.spanForNode(node.id) ?: context.tracer.tickSpanId)
        }.getOrNull()

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
                costUsd = response?.let { costUsdFor(it, model, provider, connectionId) },
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

        /* ── THE CREDENTIAL, BEFORE THE CAPACITY CHECK ─────────────────────
           The bucket's ceiling is keyed on the ACCOUNT, because that is what the
           provider rate-limits, so the fingerprint has to exist before the
           reservation. That means resolving the secret earlier than the call that
           uses it — the plaintext is held as a CharArray for the extra few lines
           and never becomes a String. See [CredentialKey]. */
        val apiKeyChars: CharArray = resolved.secret?.let { sv ->
            var k: CharArray = CharArray(0)
            sv.useOnce { k = it.toCharArray() }
            k
        } ?: run {
            emitEvent(context, node.id, EventType.SECRET_MISSING, "failed",
                title = "Secret missing",
                summary = "LLM connection '${resolved.record.name}' has no API key")
            return NodeResult.Failed(
                "No API key configured for LLM connection '${resolved.record.name}'")
        }
        val fingerprint = runCatching { com.vectorbea.worker.net.CredentialKey.fingerprint(apiKeyChars) }
            .getOrDefault(com.vectorbea.worker.net.CredentialKey.UNKNOWN)

        /* ── CAPACITY, BEFORE THE CALL ──────────────────────────────────────
           Reserved on an ESTIMATE, because the real cost is only known from the
           response and a bucket that counts afterwards limits nothing: a hundred
           concurrent calls would all pass the check and then all report their
           spend. Settled below against what the call actually used.

           Placed after the replay branch on purpose — a replay makes no provider
           call, so charging it would throttle a run that costs nothing. */
        val estimate = tokenEstimator.estimate(model, messages, maxTokens)
        val lease: com.vectorbea.worker.net.ProviderCapacityBucket.Lease? =
            when (val c = capacity?.reserve(provider, model, fingerprint, context.workspaceId,
                estimate.total,
                interactive = context.executionLane ==
                    com.vectorbea.worker.queue.WorkerJobType.AGENT_INTERACTIVE)) {
                is com.vectorbea.worker.net.ProviderCapacityBucket.Outcome.Granted -> c.lease
                is com.vectorbea.worker.net.ProviderCapacityBucket.Outcome.Exhausted -> {
                    /* Not a failure and not a provider error: nothing has been sent.
                       Throttled releases the permit and re-enqueues on a timer, so
                       this costs a yield — exactly what §12.4 asks for. */
                    java.util.Arrays.fill(apiKeyChars, '\u0000')
                    WorkerMetrics.providerCapacityExhaustedTotal.inc(
                        provider, model, c.dimension.name.lowercase())
                    /*
                     * NAME THE LIMIT AND WHERE TO CHANGE IT — invariant 6.
                     *
                     * And name WHICH limit: "raise your requests per minute" and
                     * "raise your tokens per minute" are different actions, and a
                     * message that says only "capacity" sends an operator to the
                     * wrong number. The dimension that bound the reservation is
                     * known here and nowhere downstream.
                     */
                    val dim = c.dimension
                    val hit = if (dim == com.vectorbea.worker.net.ProviderCapacityBucket.Dimension.REQUESTS)
                        "${c.limit.requestsPerMinute} requests/minute"
                        else "${c.limit.tokensPerMinute} tokens/minute"
                    /*
                     * JITTERED. The bucket's own arithmetic is deterministic — N
                     * callers refused at one instant with equal deficits all get
                     * the same answer and would come back together, which is the
                     * resynchronisation this whole change exists to remove.
                     */
                    val waitMs = ProviderThrottle.jitter(c.retryAfterMs)
                    val limitMsg =
                        "Reached this account's own limit of $hit for $provider/$model " +
                        "(not a provider 429). Retrying in ${waitMs}ms. Raise it with " +
                        "PROVIDER_LIMIT_OVERRIDES=$provider:$model=<rpm>/<tpm>."
                    emitEvent(context, node.id, EventType.NODE_FAILED, "throttled",
                        title = "Reached the $model capacity limit",
                        summary = limitMsg, modelName = model)
                    log.info("[llm] capacity exhausted [provider={}, model={}, dimension={}, " +
                        "rpm={}, tpm={}, retryAfterMs={}]",
                        provider, model, dim, c.limit.requestsPerMinute, c.limit.tokensPerMinute, waitMs)
                    return NodeResult.Throttled(provider, waitMs, limitMsg)
                }
                else -> null
            }

        val settled = java.util.concurrent.atomic.AtomicBoolean(false)
        suspend fun settleOnce(actualTokens: Long) {
            val l = lease ?: return
            if (!settled.compareAndSet(false, true)) return
            /*
             * ── NonCancellable IS THE WHOLE FIX ─────────────────────────────
             *
             * A bare `finally` is not enough and fails in a way that looks fixed.
             * Once a coroutine is cancelled every suspension point inside it
             * throws immediately, so cleanup that suspends never completes —
             * and this cleanup talks to Redis. `withContext(NonCancellable)`
             * gives the block a job that is not cancelled, which is the only way
             * a suspending release survives the cancellation that triggered it.
             */
            withContext(NonCancellable) { capacity?.settle(l, actualTokens) }
        }

        val result = try {
            // Fail fast if this connection is already known to be down. The
            // alternative is burning the full timeout to rediscover it, once
            // per run, while holding a permit each time.
            circuit?.beforeCall(connectionId)
            callProvider(provider, protocol, model, baseUrl, String(apiKeyChars), messages,
                temperature, maxTokens, timeoutMs, maxRespBytes, capture, outputSchema,
                hadLease = lease != null,
                cachePrefix = cfg[CFG_CACHE_PREFIX] == true)
                .also { circuit?.onSuccess(connectionId) }
        } catch (e: ConnectionCircuit.CircuitOpenException) {
            settleOnce(lease?.reservedTokens ?: 0)   // nothing was sent; return it whole
            recordCall("error", error = "circuit open")
            emitEvent(context, node.id, EventType.NODE_FAILED, "failed",
                title = "Connection paused", summary = e.message)
            return NodeResult.Failed(e.message ?: "Connection temporarily unavailable")
        } catch (e: ProviderThrottledException) {
            /* The provider refused, so it spent nothing on our behalf — give the
               whole reservation back. Keeping it would compound the outage: the
               bucket would stay drawn for a call that never happened. */
            settleOnce(lease?.reservedTokens ?: 0)
            /*
             * ── A 429 IS NOT A BREAKER EVENT ────────────────────────────────
             *
             * Note what is NOT called here: `circuit.onFailure`. A rate limit
             * means the provider is HEALTHY and we are asking too fast; the
             * breaker exists for a provider that is unavailable. Opening it on a
             * throttle storm converts "slow down" into "this connection is down"
             * for every run in the workspace, including the ones that would have
             * succeeded — a worse failure than the one being handled, and one
             * that outlives the rate limit that caused it.
             *
             * Asserted by `ThrottleDoesNotOpenBreakerTest`.
             */
            recordCall("throttled", error = "provider rate limited")
            /*
             * THE PROVIDER'S OWN INSTRUCTION WINS.
             *
             * `Retry-After` is the provider telling us exactly when to come back.
             * Applying our own curve on top of it is how a throttle becomes a
             * storm: we either come back too early and are refused again, or too
             * late and idle capacity we were given. `attemptOf` supplies the real
             * retry count for the fallback curve — it used to be hardcoded to 0,
             * which collapsed the exponential to a constant 1000ms with the
             * jitter arithmetically eliminated.
             */
            val decision = ProviderThrottle.decide(e.retryAfter, attempt = attemptOf(context, node.id))
            WorkerMetrics.providerThrottleSuspendTotal.inc(provider, e.limitKind)
            emitEvent(context, node.id, EventType.NODE_FAILED, "throttled",
                title = "Rate limited by $provider",
                summary = decision.userMessage(provider), modelName = model)
            log.info("[llm] {} rate limited [nodeId={}, limit={}, fromHeader={}] — waiting {}ms",
                provider, node.id, e.limitKind, decision.fromHeader, decision.delayMs)
            return NodeResult.Throttled(provider, decision.delayMs, decision.userMessage(provider))
            /* Reached only when nothing above settled — cancellation, or a
               throwable this method does not name. Half, for the same reason
               LlmCallException returns half: the request may or may not have
               reached the provider, and both "return everything" and "return
               nothing" are wrong in one direction. The bucket self-corrects
               within a refill window either way. */
        } catch (e: LlmCallException) {
            /* A failed call may still have consumed input tokens at the provider.
               Returning HALF is a deliberate compromise over the two wrong
               answers: returning everything under-counts a real spend, and
               returning nothing over-counts a request that never reached the
               model. The bucket self-corrects within a refill window either way. */
            settleOnce((lease?.reservedTokens ?: 0) / 2)
            val durationMs = System.currentTimeMillis() - startMs
            recordCall("error", error = e.message?.take(500))
            circuit?.onFailure(connectionId, e.message ?: "LLM call failed")
            log.warn("[llm] call failed [nodeId={}, provider={}, durationMs={}]: {}",
                node.id, provider, durationMs, e.message)
            return NodeResult.Failed("LLM call failed for node '${node.id}': ${e.message}")
        } finally {
            /* The guarantee. Every named path above has already settled and
               `settleOnce` is idempotent, so this fires only for the exits this
               method does not name — cancellation, chiefly. Half, for the same
               reason LlmCallException returns half: the request may or may not
               have reached the provider, and both "return everything" and
               "return nothing" are wrong in one direction. */
            settleOnce((lease?.reservedTokens ?: 0) / 2)
        }

        /* Settle against the real cost. A surplus goes back for the next caller;
           a shortfall is debited and can drive the bucket negative, which is a
           legitimate state — an estimate that was badly low SHOULD make the next
           caller wait. */
        settleOnce((result.tokenCount ?: 0).toLong())
        java.util.Arrays.fill(apiKeyChars, '\u0000')

        /*
         * ── CLOSE THE LOOP ─────────────────────────────────────────────────
         *
         * The provider's own input-token count is the only ground truth there is,
         * and it arrives here. Feeding the ratio back is what turns the tokenizer
         * from a better guess into a calibrated one: it absorbs message framing,
         * tool-definition wrappers, Anthropic's separate system block, and the
         * fact that cl100k is an approximation for two of the three providers.
         *
         * Input tokens only. The output side is `maxTokens`, which is a ceiling we
         * chose rather than an estimate we made — grading it would teach the
         * corrector that we systematically over-reserve output, and it would then
         * shrink the input reservation to compensate for a completion that simply
         * came in short.
         */
        result.tokensIn?.let { actual ->
            tokenEstimator.record(estimate, actual.toLong())
            WorkerMetrics.estimateErrorRatio.observe(
                actual.toDouble() / estimate.correctedInput.coerceAtLeast(1L),
                model, estimate.shape.name.lowercase())
        }

        val durationMs = System.currentTimeMillis() - startMs
        val estimatedCostUsd = costUsdFor(result, model, provider, connectionId)
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
            /* The cache hit rate, as a rate. `cache_read / total` over any window
               is the number that decides whether the flag stays on, and it cannot
               be computed from the `total` series alone. Emitted only when the
               provider reported the field, so a zero here means "cached nothing",
               never "did not say". */
            result.cacheReadTokens?.let {
                WorkerMetrics.llmTokensTotal.inc(ws, wf, model, "cache_read", delta = it.toLong())
            }
            result.cacheWriteTokens?.let {
                WorkerMetrics.llmTokensTotal.inc(ws, wf, model, "cache_write", delta = it.toLong())
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

        runCatching {
            context.tracer?.close(
                llmSpan, "llm_call", model, status = "ok", stepId = node.id,
                /*
                 * The cache figures land on the SPAN as well as the metric,
                 * because the two answer different questions. The metric answers
                 * "what is the hit rate right now"; the span answers "what did
                 * THIS run cost, and would it have cost less" — asked days later,
                 * about one run, by someone reading a trace. A counter cannot be
                 * queried per run and a Prometheus window cannot be joined to a
                 * workflow version.
                 *
                 * Deliberately NOT `costCents`: that column stays null until the
                 * summation in TraceGraphBuilder is fixed, or every node's cost is
                 * multiplied by its nesting depth.
                 */
                attributesJson = buildString {
                    append("""{"provider":${jsonAttr(provider)},"model":${jsonAttr(model)}""")
                    append(""","cache_enabled":${promptCacheEnabled && cfg[CFG_CACHE_PREFIX] == true}""")
                    result.cacheReadTokens?.let { append(""","cache_read_tokens":$it""") }
                    result.cacheWriteTokens?.let { append(""","cache_write_tokens":$it""") }
                    append("}")
                },
                tokensIn = result.tokensIn, tokensOut = result.tokensOut,
                /* What the model was asked and what it answered, when step I/O
                   capture is on. Only for a span that exists: no tracer, no record. */
                inputRef = llmSpan?.let { captureCallText(context, renderPromptText(messages)) },
                outputRef = llmSpan?.let { captureCallText(context, result.content) },
            )
        }

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
    /**
     * A provider 429.
     *
     * [limitKind] is which limit the provider says was breached — `requests`,
     * `tokens` or `unknown`. Read from the rate-limit headers rather than guessed,
     * because "we hit RPM" and "we hit TPM" call for different changes and the
     * bucket cannot tell them apart from the outside. It was previously thrown
     * away along with the whole response, which is why the original investigation
     * could not confirm which limit was being hit.
     */
    private class ProviderThrottledException(
        val provider: String,
        val retryAfter: String?,
        val limitKind: String = "unknown",
    ) : RuntimeException("$provider rate limited this request")

    /**
     * Which limit the provider says was breached.
     *
     * ── WHY THIS IS WORTH READING ───────────────────────────────────────────
     * Providers publish RPM and TPM separately, enforce them separately, and say
     * which one they refused on — in headers, and usually in the body too. The
     * old handler read `Retry-After` and discarded everything else, which is why
     * "which limit are we actually hitting" was unanswerable from our own
     * telemetry during the investigation that produced this work.
     *
     * The rule is: whichever remaining counter is at zero is the one that
     * refused. If both or neither are, the answer is honestly `unknown` rather
     * than a guess — a wrong label here sends an operator to raise the wrong
     * number.
     */
    private fun limitKindOf(header: (String) -> String?): String {
        fun zero(vararg names: String): Boolean =
            names.any { header(it)?.trim()?.toLongOrNull() == 0L }
        val reqOut = zero("x-ratelimit-remaining-requests",
            "anthropic-ratelimit-requests-remaining")
        val tokOut = zero("x-ratelimit-remaining-tokens",
            "anthropic-ratelimit-tokens-remaining", "anthropic-ratelimit-input-tokens-remaining")
        return when {
            reqOut && !tokOut -> "requests"
            tokOut && !reqOut -> "tokens"
            else -> "unknown"
        }
    }

    /**
     * How many times this node has already been throttled in this run.
     *
     * The exponential curve needs it, and it used to be hardcoded to zero — which
     * collapsed `BASE shl 0` to a single value and made `Random.nextLong(1000,
     * 1001)` return exactly 1000 every time. The fallback backoff was therefore a
     * constant one second with the jitter arithmetically eliminated, however many
     * times a run had been refused.
     *
     * Counted from the run's own event stream rather than carried in memory: a
     * throttled run is parked and resumed in a different process, so an in-memory
     * counter would reset to zero on every attempt — which is exactly the bug
     * being fixed, wearing a different hat.
     */
    private fun attemptOf(context: RuntimeContext, nodeId: String): Int =
        runCatching {
            eventStore.countEvents(context.runId, nodeId, EventType.NODE_FAILED, "throttled")
        }.getOrDefault(0)

    // ── Provider dispatch ─────────────────────────────────────────────────────

    private fun callProvider(
        provider: String,
        /** The wire shape — see [protocolFor]. Usually implied by [provider]. */
        protocol: String,
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
        /** Whether the capacity bucket admitted this call. See [doHttpPost]. */
        hadLease: Boolean,
        /**
         * The caller resends this prefix and wants it cached. Anthropic only —
         * OpenAI and Gemini cache without being asked and have nothing to opt into.
         */
        cachePrefix: Boolean,
    ): LlmResponse = when (protocol) {
        "anthropic" -> callAnthropic(model, baseUrl, apiKey, messages, temperature, maxTokens, timeoutMs, maxResponseBytes, capture, outputSchema, hadLease, cachePrefix)
        "gemini"    -> callGemini(model, baseUrl, apiKey, messages, temperature, maxTokens, timeoutMs, maxResponseBytes, capture, outputSchema, hadLease)
        else        -> callOpenAiCompatible(provider, model, baseUrl, apiKey, messages, temperature, maxTokens, timeoutMs, maxResponseBytes, capture, outputSchema, hadLease)
    }

    /**
     * The wire shape to speak to this connection.
     *
     * ── WHY THIS IS NOT JUST `provider` ANY MORE ──────────────────────
     * They answer different questions, and conflating them worked only while
     * every connection pointed at the vendor whose name it carried:
     *
     *   provider  — WHOSE capacity, credential, breaker and price. A customer's
     *               gateway is genuinely its own pool of all four.
     *   protocol  — what the request body looks like.
     *
     * An enterprise gateway called `acme-ai` speaking OpenAI's format used to
     * reach the OpenAI branch by falling off the end of a `when` — right by
     * accident, and silently wrong the day that default changed.
     *
     * Unset infers from the provider, which reproduces the previous behaviour
     * exactly for every connection that predates V070.
     */
    internal fun protocolFor(record: com.vectorbea.worker.connector.ConnectionRecord): String {
        val declared = (record.configJson["protocol"] as? String)?.lowercase()?.trim()
        if (declared != null && declared in PROTOCOLS) return declared
        return when (record.provider.lowercase()) {
            "anthropic" -> "anthropic"
            "gemini" -> "gemini"
            else -> "openai"
        }
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
        hadLease: Boolean,
    ): LlmResponse {
        val url = (baseUrl?.trimEnd('/') ?: "https://api.openai.com") + "/v1/chat/completions"

        /* OpenAI's reasoning models (o1, o3, o4-mini, gpt-5…) refuse `max_tokens`
           and any non-default `temperature` with HTTP 400 before doing anything,
           so an agent configured with one of them failed on its first call.
           They take `max_completion_tokens`, which also covers the hidden
           reasoning tokens — hence the floor, or the reasoning alone uses the
           allowance and the visible answer comes back empty. */
        val reasoningModel = isOpenAiReasoningModel(provider, baseUrl, model)
        val body = buildMap<String, Any> {
            put("model", model)
            put("messages", messages)
            if (!reasoningModel) temperature?.let { put("temperature", it) }
            maxTokens?.let {
                if (reasoningModel) put("max_completion_tokens", maxOf(it, REASONING_MIN_COMPLETION_TOKENS))
                else put("max_tokens", it)
            }
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
            model = model,
            hadLease = hadLease,
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
        hadLease: Boolean,
        cachePrefix: Boolean,
    ): LlmResponse {
        val url = (baseUrl?.trimEnd('/') ?: "https://api.anthropic.com") + "/v1/messages"

        // Anthropic separates system prompt from messages
        val systemMsg = messages.firstOrNull { it["role"] == "system" }?.get("content") as? String
        val chatMessages = messages.filter { it["role"] != "system" }

        val body = buildMap<String, Any> {
            put("model", model)
            put("messages", chatMessages)
            put("max_tokens", maxTokens ?: 1024)
            systemMsg?.let { put("system", anthropicSystemBlock(it, cachePrefix)) }
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
            model = model,
            hadLease = hadLease,
        )

        return parseAnthropicResponse(response)
    }

    /**
     * The `system` field, with a cache breakpoint at its end when that pays.
     *
     * ── WHY THE BREAKPOINT GOES HERE AND NOWHERE ELSE ───────────────────────
     * Anthropic caching is a PREFIX match: everything up to the breakpoint is the
     * cache key, and one changed byte anywhere before it invalidates the whole
     * entry. The render order is `tools` -> `system` -> `messages`, so the end of
     * the system block is the last position that is byte-identical on every
     * iteration of an agent loop.
     *
     * `AgentPromptBuilder` puts the instructions, the serialised tool catalogue
     * and the team roster in the system prompt, and the objective, inputs and
     * ACCUMULATED OBSERVATIONS in the user message. The observations grow by one
     * entry per iteration. A breakpoint placed after them would be invalidated by
     * the very next turn — we would pay the 1.25x write premium on every
     * iteration and never once read the entry back. That is strictly worse than
     * not caching at all, and it is the single easy way to get this wrong.
     *
     * ── WHY IT IS RETURNED AS A LIST ────────────────────────────────────────
     * `cache_control` is a property of a content BLOCK. A bare string cannot
     * carry one, so marking the prefix means promoting `system` to a one-element
     * array. Unmarked, it stays a string — identical bytes on the wire to what we
     * sent before this change, which is what keeps the flag-off path a true
     * no-op.
     *
     * ── THE THREE CONDITIONS, EACH LOAD-BEARING ─────────────────────────────
     *   flag         the whole feature is off until measured (see the class note)
     *   cachePrefix  the CALLER resends this prefix. A one-shot node does not,
     *                and paying a write for a prefix nobody reads back is a loss.
     *   length       below the model's minimum the breakpoint is ignored, so
     *                marking it is noise in the request and in the trace.
     */
    internal fun anthropicSystemBlock(
        systemPrompt: String,
        cachePrefix: Boolean,
        /* Passed rather than read from the companion so the decision is a pure
           function of its inputs. An env-var read inside here would make the one
           branch that costs money untestable in the state that matters. */
        enabled: Boolean = promptCacheEnabled,
        minChars: Int = PROMPT_CACHE_MIN_CHARS,
    ): Any {
        val worthCaching = enabled && cachePrefix && systemPrompt.length >= minChars
        if (!worthCaching) return systemPrompt
        return listOf(mapOf(
            "type" to "text",
            "text" to systemPrompt,
            "cache_control" to mapOf("type" to "ephemeral"),
        ))
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
        hadLease: Boolean,
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
            model = model,
            hadLease = hadLease,
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
        /** For the 429 metrics, which are per model — a 429 is model-scoped. */
        model: String,
        /**
         * Did the capacity bucket admit this call?
         *
         * A 429 on an ADMITTED call is a bucket bug and is counted as one, apart
         * from an ordinary 429 on an unmetered call. Passed down rather than
         * inferred, because down here there is no way to tell the two apart.
         */
        hadLease: Boolean,
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
            // Header names are case-insensitive and providers disagree about the
            // casing, so match on the lower-cased name rather than guessing which
            // two spellings to try.
            fun header(name: String): String? = result.headers.entries
                .firstOrNull { it.key.lowercase() == name }?.value?.firstOrNull()
            val kind = limitKindOf(::header)
            WorkerMetrics.provider429Total.inc(provider, model, kind)
            /*
             * A 429 AFTER THE BUCKET ADMITTED THE CALL IS A BUCKET BUG.
             *
             * Counted separately from a refusal, and that distinction is the whole
             * point of the metric: a refusal means the bucket worked, this means
             * it let through a call it should have held. If this counter is
             * non-zero the limits are configured too high, the estimate is short,
             * or somebody else is spending the same account's budget.
             */
            if (hadLease) WorkerMetrics.provider429AfterAdmitTotal.inc(provider, model, kind)
            throw ProviderThrottledException(
                provider = provider,
                retryAfter = header("retry-after"),
                limitKind = kind,
            )
        }

        if (result.statusCode !in 200..299) {
            WorkerMetrics.llmCallDurationSeconds.observeMs(result.durationMs, provider, "http_error")
            // Never log the response body raw — it may echo the request including prompt content.
            // The provider's own error MESSAGE is kept, redacted and capped: "LLM API
            // returned HTTP 400" alone gave nobody anything to act on, and the message
            // is where "Unsupported parameter: 'max_tokens'" or "model not found" lives.
            val detail = providerErrorDetail(result.body)
            throw LlmCallException(
                "LLM API returned HTTP ${result.statusCode}" + (detail?.let { ": $it" } ?: ""))
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

            /* OpenAI caches automatically and reports the hit here. `prompt_tokens`
               INCLUDES these, so they must be discounted rather than added. */
            @Suppress("UNCHECKED_CAST")
            val promptDetails = usage?.get("prompt_tokens_details") as? Map<String, Any>
            val cachedIn = (promptDetails?.get("cached_tokens") as? Number)?.toInt()

            LlmResponse(
                content = content, finishReason = finish, tokenCount = tokenCount,
                cacheReadTokens = cachedIn,
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
                    tokenCount = anthropicTotal(inTok, outTok, usage),
                    modelVersion = root["model"] as? String,
                    tokensIn = inTok,
                    tokensOut = outTok,
                    cacheReadTokens = anthropicCacheRead(usage),
                    cacheWriteTokens = anthropicCacheWrite(usage),
                )
            }
            val text    = content.firstOrNull { it["type"] == "text" }?.get("text") as? String
            val stop    = root["stop_reason"] as? String

            val usage      = root["usage"] as? Map<String, Any>
            val inputTokens  = (usage?.get("input_tokens") as? Number)?.toInt() ?: 0
            val outputTokens = (usage?.get("output_tokens") as? Number)?.toInt() ?: 0

            /* The SPLIT, not just the total. The estimate's feedback loop grades
               the input side alone, and a combined figure cannot be graded: a
               short completion would read as a good input estimate. */
            LlmResponse(content = text, finishReason = stop,
                tokenCount = anthropicTotal(inputTokens, outputTokens, usage),
                tokensIn = inputTokens, tokensOut = outputTokens,
                cacheReadTokens = anthropicCacheRead(usage),
                cacheWriteTokens = anthropicCacheWrite(usage))
        } catch (e: Exception) {
            throw LlmCallException("Failed to parse Anthropic response: ${e.javaClass.simpleName}")
        }
    }

    /**
     * Anthropic's true total, which is NOT `input_tokens + output_tokens`.
     *
     * ── THE TRAP THIS EXISTS TO CLOSE ───────────────────────────────────────
     * Unlike OpenAI, Anthropic reports cached tokens in fields SEPARATE from
     * `input_tokens` and excludes them from it. Summing only the two obvious
     * fields was correct while nothing was ever cached — and the moment caching
     * is switched on it silently under-counts every call by the cached fraction,
     * which on an agent loop is most of the prompt. The bill would not move and
     * every number on the Cost tab would fall by ~80%, reading as a saving.
     *
     * So the total is all four: fresh input, cache reads, cache writes, output.
     * Nulls are treated as absent-and-zero HERE only because a missing usage
     * object still yields a non-null total from the two required fields; the
     * decision about how to price an absent count belongs to the caller.
     */
    private fun anthropicTotal(inTok: Int?, outTok: Int?, usage: Map<String, Any>?): Int? {
        if (inTok == null || outTok == null) return null
        return inTok + outTok + (anthropicCacheRead(usage) ?: 0) + (anthropicCacheWrite(usage) ?: 0)
    }

    /** Cached input served this call. Null when the provider did not report it. */
    private fun anthropicCacheRead(usage: Map<String, Any>?): Int? =
        (usage?.get("cache_read_input_tokens") as? Number)?.toInt()

    /** Input written to the cache this call, billed at a premium over base input. */
    private fun anthropicCacheWrite(usage: Map<String, Any>?): Int? =
        (usage?.get("cache_creation_input_tokens") as? Number)?.toInt()

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

            /* Gemini caches implicitly and, like OpenAI, counts the hit inside
               `promptTokenCount` — so this is a discount, never an addition. */
            val cachedIn = (usageMeta?.get("cachedContentTokenCount") as? Number)?.toInt()

            LlmResponse(content = text, finishReason = finishReason, tokenCount = tokenCount,
                tokensIn = (usageMeta?.get("promptTokenCount") as? Number)?.toInt(),
                tokensOut = (usageMeta?.get("candidatesTokenCount") as? Number)?.toInt(),
                cacheReadTokens = cachedIn)
        } catch (e: Exception) {
            throw LlmCallException("Failed to parse Gemini response: ${e.javaClass.simpleName}")
        }
    }

    // ── Call capture ──────────────────────────────────────────────────────────

    /** A payload ref for [text], or null. Never throws: a lost record must not fail the call. */
    private fun captureCallText(context: RuntimeContext, text: String?): String? {
        val store = callPayloads ?: return null
        if (text.isNullOrBlank()) return null
        return runCatching {
            store.capture(context.workspaceId, text, com.vectorbea.worker.events.PayloadStore.TEXT)?.ref
        }.getOrNull()
    }

    /** The messages as a person reads them: each role as a heading over its text. */
    private fun renderPromptText(messages: List<Map<String, Any>>): String =
        messages.joinToString("\n\n") { m ->
            val role = (m["role"] as? String ?: "message").uppercase()
            val content = when (val c = m["content"]) {
                is String -> c
                null -> ""
                else -> runCatching { mapper.writeValueAsString(c) }.getOrDefault(c.toString())
            }
            "$role:\n$content"
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
    /**
     * A pre-call token estimate for the capacity bucket.
     *
     * Four characters per token is the standard rough figure for English prose
     * and is wrong for code, for CJK and for anything heavily punctuated. It does
     * not need to be right: the reservation is settled against the real number as
     * soon as the response arrives, so the estimate only has to be the right
     * ORDER for the few hundred milliseconds a call is in flight. A tokeniser per
     * provider would be more accurate and would buy nothing.
     *
     * `maxTokens` is added because the completion has not been generated yet and
     * the provider counts it against the same limit. Its default matches the one
     * `callAnthropic` sends when the node sets none, so the estimate does not
     * silently assume zero output.
     */
    internal fun estimateTokens(messages: List<Map<String, Any>>, maxTokens: Int?): Long {
        val chars = messages.sumOf { (it["content"] as? String)?.length ?: 0 }
        return (chars / 4L) + (maxTokens ?: 1024).toLong()
    }

    /**
     * Cost with cached input priced as cached rather than as fresh.
     *
     * ── WHAT THIS FIXES AND WHAT IT DELIBERATELY DOES NOT ───────────────────
     * FIXES: cached input billed at the full rate. OpenAI and Gemini cache
     * automatically and fold the hit into their headline prompt count, so every
     * agent run was over-reported — 2.8x on a measured ten-iteration loop.
     *
     * DOES NOT FIX: the rate itself. [estimateCostUsd] still applies ONE blended
     * $/M to input and output together, from a table that names only 2024 models.
     * That is the larger error (1.8x to 29x depending on the model string) and it
     * is deliberately left alone here — this commit ships alone, and mixing a
     * table rewrite into it would make the measured before/after unreadable.
     *
     * ── THE ARITHMETIC ──────────────────────────────────────────────────────
     * The multipliers are relative to base input: a cache read costs ~0.1x on
     * Anthropic and ~0.5x on OpenAI/Gemini, and an Anthropic cache WRITE costs
     * ~1.25x. So a cached token is not free and a written one costs more than a
     * fresh one — a naive "subtract the cached tokens" would under-report in one
     * direction and over-report in the other.
     *
     * `tokens` arrives from the provider's own usage object and already includes
     * both cache figures — for Anthropic because [anthropicTotal] adds them, for
     * OpenAI and Gemini because the provider folds them in. So each is REPLACED
     * at its own multiplier, never added.
     */
    private fun costUsdFor(
        result: LlmResponse,
        model: String,
        provider: String,
        connectionId: java.util.UUID?,
    ): Double? {
        val total = result.tokenCount ?: return null
        return pricing.costUsd(
            connectionId = connectionId,
            provider = provider,
            model = model,
            usage = com.vectorbea.worker.pricing.ModelPricing.Usage(
                totalTokens = total,
                tokensIn = result.tokensIn,
                tokensOut = result.tokensOut,
                cacheReadTokens = result.cacheReadTokens,
                cacheWriteTokens = result.cacheWriteTokens,
            ),
        )
    }

    /**
     * Tokens to bill, with cached input REPLACED at its own rate.
     *
     * Pure and internal because this is the arithmetic that silently moves money:
     * every branch is a plausible-looking one-liner and three of them are wrong.
     *
     *   - Adding the cached tokens instead of replacing them double-counts, since
     *     every provider's total already includes them.
     *   - Treating a cache read as free under-reports by 10-50% of the prefix.
     *   - Treating a cache WRITE as a read under-reports by 12.5x on that slice —
     *     a write costs MORE than a fresh token, not less.
     *
     * Clamped, because a provider is free to report a cached count that exceeds
     * what we believe the total is, and a negative fresh count would flip the
     * sign of the bill.
     */
    /**
     * Tokens to bill, with cached input replaced at its own rate.
     *
     * Delegates to [com.vectorbea.worker.pricing.ModelPricing], which is now the
     * one place that answers "what does this cost" — the list table used to live
     * here as well, and two price tables in two files is how a customer's
     * dashboard comes to disagree with their invoice. Kept as a method because
     * it is the seam `PromptCacheTest` exercises, and that test is the reason the
     * cache arithmetic is right.
     */
    internal fun effectiveBillableTokens(
        total: Int,
        cacheRead: Int?,
        cacheWrite: Int?,
        provider: String,
    ): Int = com.vectorbea.worker.pricing.ModelPricing
        .effectiveBillableTokens(total, cacheRead, cacheWrite, provider)

    /** A JSON string literal for a span attribute value. Escapes, never truncates. */
    private fun jsonAttr(v: String?): String =
        if (v == null) "null"
        else "\"" + v.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ") + "\""

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
        /**
         * Input tokens served from the provider's prompt cache, billed at a
         * fraction of the base input rate.
         *
         * ── WHY THIS IS RECORDED EVEN WITH CACHING OFF ──────────────────────
         * OpenAI and Gemini cache automatically, with no opt-in and no way to
         * decline, and both INCLUDE the cached tokens in the headline prompt
         * count. Pricing that count at the full rate over-reports every agent run
         * — measured at 2.8x on a ten-iteration loop, because 87% of its input is
         * a resent prefix. So this field is populated for all three providers
         * regardless of [PROMPT_CACHE_ENABLED]: the flag governs whether we ASK
         * Anthropic to cache, never whether we notice that caching happened.
         *
         * Null means the provider said nothing, which is not the same as zero and
         * must not be priced as if it were.
         */
        val cacheReadTokens: Int? = null,
        /**
         * Input tokens written to the cache this call, billed at ~1.25x base input.
         *
         * Anthropic only. OpenAI and Gemini do not charge for, or report, a write.
         */
        val cacheWriteTokens: Int? = null,
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

/** Floor for `max_completion_tokens` on a reasoning model: reasoning spends from the same allowance. */
internal const val REASONING_MIN_COMPLETION_TOKENS = 8192

private val OPENAI_REASONING_MODEL = Regex("""^(o\d|gpt-5)""")

/** A reasoning model on OpenAI itself. OpenAI-compatible hosts keep the classic parameters. */
internal fun isOpenAiReasoningModel(provider: String, baseUrl: String?, model: String): Boolean {
    val onOpenAi = provider.equals("openai", ignoreCase = true) &&
        (baseUrl.isNullOrBlank() || baseUrl.contains("api.openai.com", ignoreCase = true))
    return onOpenAi && OPENAI_REASONING_MODEL.containsMatchIn(model.trim().lowercase().substringAfterLast('/'))
}

/**
 * The provider's error message from a non-2xx body, safe to put in a run's failure.
 *
 * OpenAI, Anthropic and Gemini all nest it at `error.message` (Anthropic and Gemini
 * add a type or status beside it). Only that field is read — never the body — then
 * anything credential-shaped is masked and it is capped, because a message can quote
 * a fragment of the request.
 */
internal fun providerErrorDetail(body: String?): String? {
    if (body.isNullOrBlank()) return null
    val error = runCatching {
        (com.fasterxml.jackson.module.kotlin.jacksonObjectMapper().readValue(body, Map::class.java)["error"])
    }.getOrNull()
    val message = when (error) {
        is Map<*, *> -> error["message"] as? String
        is String -> error
        else -> null
    }?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    val code = (error as? Map<*, *>)?.let { (it["code"] ?: it["type"] ?: it["status"])?.toString() }
    return (message.take(300)
        .replace(Regex("""sk-[A-Za-z0-9_-]+"""), "[REDACTED-KEY]")
        .replace(Regex("""eyJ[A-Za-z0-9._-]{20,}"""), "[REDACTED-JWT]")
        .replace(Regex("""[A-Za-z0-9+/]{40,}={0,2}"""), "[REDACTED]")) +
        (code?.takeIf { it.isNotBlank() && it.length < 60 }?.let { " ($it)" } ?: "")
}
