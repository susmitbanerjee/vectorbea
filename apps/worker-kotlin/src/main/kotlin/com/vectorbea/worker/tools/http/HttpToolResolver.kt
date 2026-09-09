package com.vectorbea.worker.tools.http

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.databind.node.ObjectNode
import com.vectorbea.worker.agents.tools.ToolErrorShape
import com.vectorbea.worker.agents.tools.ToolResultContract
import com.vectorbea.worker.connector.ConnectionException
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.SecretService
import com.vectorbea.worker.connector.SsrfException
import com.vectorbea.worker.connector.SsrfGuard
import com.vectorbea.worker.durable.SideEffectGuard
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.net.OutboundHttp
import com.vectorbea.worker.runtime.executor.NodeExecutor
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.tools.httpspec.HttpAuthSpec
import com.vectorbea.worker.tools.httpspec.HttpToolSpec
import com.vectorbea.graph.WorkflowNode
import kotlinx.coroutines.delay
import java.net.URI
import java.net.http.HttpRequest
import java.security.SecureRandom
import java.util.UUID
import javax.sql.DataSource

/**
 * Executes an HTTP tool from its [HttpToolSpec].
 *
 * ── WHAT THIS REPLACES ──────────────────────────────────────────────────────
 * `HttpNodeExecutor`, for tools that carry a spec. It stays for tools that do
 * not, and that split is the migration: a tool written before this work behaves
 * exactly as it did, and gains nothing and loses nothing on the deploy that
 * ships this. `ToolNodeExecutor` chooses between them on the presence of
 * `tools.http_spec_json`, and nothing else.
 *
 * ── ORDER OF OPERATIONS, AND WHY IT IS THIS ORDER ───────────────────────────
 *   1. Resolve the connection and decrypt its secret ONCE, into a [SecretScope].
 *   2. Assemble the request from the spec and the model's arguments.
 *   3. Apply the auth strategy — which may itself make a token call.
 *   4. SSRF and allowed-path checks, on the URL THAT WILL BE SENT.
 *   5. Reserve the side effect, for a write.
 *   6. Send, with retry and jitter.
 *   7. Follow pagination, under its caps.
 *   8. Extract, map errors, project.
 *
 * Step 4 sits after 2 and 3 deliberately: the checks must inspect the final URL,
 * including path substitutions and any query parameter the auth strategy added.
 * Checking a template would check a string nobody sends.
 *
 * ── EVERYTHING THAT LEAVES THIS CLASS IS SCRUBBED ───────────────────────────
 * Not the parts believed risky — everything. [emit] and [failure] pass their
 * text through [SecretScope.scrub], and the summaries they are given are built
 * from the SPEC (method, host, path template, status, duration) rather than from
 * the request, so there is nothing to scrub in the ordinary case and the scrub
 * is what catches the day somebody adds a field.
 */
class HttpToolResolver(
    private val connectionResolver: ConnectionResolver,
    private val eventStore: RunEventStore,
    private val secretService: SecretService? = null,
    private val dataSource: DataSource? = null,
    private val sideEffects: SideEffectGuard? = null,
    /** Injectable for tests; production uses the transport-bound client. */
    private val httpClientOverride: java.net.http.HttpClient? = null,
    /**
     * Where an async tool's wait is recorded. Null makes async tools refuse
     * rather than run — a job submitted with nothing waiting for it is a
     * six-minute render nobody will ever collect.
     */
    private val waitStore: com.vectorbea.worker.durable.wait.WaitStore? = null,
    /**
     * The public origin a provider calls back on, e.g. `https://api.vectorbea.com`.
     *
     * Null disables callbacks and leaves polling; a tool that declared only a
     * callback then refuses, rather than submitting a job whose completion has no
     * route home.
     */
    private val callbackBaseUrl: String? = System.getenv("PUBLIC_API_BASE_URL"),
) : NodeExecutor {

    private val log = logger()
    private val mapper = ObjectMapper()
    private val random = SecureRandom()
    private val auth = AuthApplier(OAuth2TokenStore.shared(dataSource, secretService))

    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        context: RuntimeContext,
    ): NodeResult {
        val spec = HttpToolSpec.parse(node.config["httpSpec"] as? String
            ?: (node.config["httpSpec"] as? JsonNode)?.toString())
            ?: return NodeResult.Failed(
                "HTTP tool '${node.id}' has no usable specification. Re-save the tool, " +
                    "or re-import it from its API document.",
                retryable = false,
            )

        SecretScope().use { scope ->
            return runWithScope(node, spec, resolvedInputs, context, scope)
        }
    }

    private suspend fun runWithScope(
        node: WorkflowNode,
        spec: HttpToolSpec,
        args: Map<String, Any>,
        ctx: RuntimeContext,
        scope: SecretScope,
    ): NodeResult {
        // ── 1. Connection ─────────────────────────────────────────────────────
        val connectionIdStr = node.config["connectionId"] as? String
        var allowedHosts = emptyList<String>()
        var allowedPaths = emptyList<String>()
        var baseUrl: String? = null
        var connectionId: UUID? = null
        var secrets: Map<String, String> = emptyMap()
        var effectiveAuth = spec.auth

        if (!connectionIdStr.isNullOrBlank()) {
            connectionId = try {
                UUID.fromString(connectionIdStr)
            } catch (_: Exception) {
                return NodeResult.Failed("HTTP tool '${node.id}': invalid connectionId.", retryable = false)
            }
            val resolved = try {
                connectionResolver.resolve(connectionId, ctx.workspaceId, expectedType = "http")
            } catch (e: ConnectionException) {
                emit(ctx, node.id, EventType.CONNECTION_VALIDATION_FAILED, "failed",
                    "Connection validation failed", scope.scrub(e.message?.take(200)))
                return NodeResult.Failed(
                    "This tool's connection cannot be used: ${e.message}", retryable = false)
            }
            allowedHosts = resolved.record.allowedHosts
            allowedPaths = resolved.record.allowedPaths
            baseUrl = resolved.record.configJson["baseUrl"] as? String

            /*
             * The secret is decrypted exactly once and registered for scrubbing
             * in the same expression. `useOnce` zeroes its own backing array on
             * the way out; what survives is the bundle, inside the scope, for the
             * duration of this call.
             */
            resolved.secret?.takeIf { !it.isCleared() }?.useOnce { raw ->
                secrets = SecretScope.bundleOf(raw)
                secrets.values.forEach { scope.protect(it) }
            }

            if (effectiveAuth is HttpAuthSpec.InheritConnection) {
                effectiveAuth = HttpAuthSpec.fromLegacyAuthType(
                    resolved.record.authType,
                    resolved.record.configJson["username"] as? String,
                )
            }
            emit(ctx, node.id, EventType.CONNECTION_RESOLVED, "info",
                "Connection resolved", "provider=${resolved.record.provider}")
        } else if (effectiveAuth is HttpAuthSpec.InheritConnection) {
            effectiveAuth = HttpAuthSpec.None
        }

        // ── 2. Transport ──────────────────────────────────────────────────────
        val bound = try {
            bindTransport(spec, ctx.workspaceId, scope)
        } catch (e: HttpTransport.TransportException) {
            return NodeResult.Failed("HTTP tool '${node.id}': ${e.message}", retryable = false)
        }
        val client = httpClientOverride ?: bound.client

        val timeoutMs = OutboundHttp.policy().clampTotalCallMs(
            spec.timeoutMs ?: (node.config["timeoutMs"] as? Number)?.toLong()
        )
        val maxBytes = spec.response.maxResponseBytes
            ?: (node.config["maxResponseBytes"] as? Number)?.toLong()
            ?: DEFAULT_MAX_RESPONSE_BYTES

        /*
         * ── 2b. ASYNC: IS THIS STEP ALREADY WAITING, OR ALREADY ANSWERED? ────
         *
         * Before anything is assembled or sent. On a resume this step re-executes
         * from the top, and the wait it opened last time is sitting there with the
         * provider's answer in it — so the answer is read out and the provider is
         * never contacted again. That is what makes a six-minute render survive a
         * worker restart without being submitted twice.
         */
        val async = spec.async
        var asyncWait: com.vectorbea.worker.durable.wait.RunWait? = null
        var callbackUrl: String? = null
        if (async != null) {
            val waits = waitStore
                ?: return NodeResult.Failed(
                    "This tool runs asynchronously and this worker has no database to " +
                        "record the wait in. The call was not made.",
                    retryable = false,
                )
            when (val pre = AsyncToolProtocol.precheck(
                spec = spec, async = async, waits = waits,
                workspaceId = ctx.workspaceId, environmentId = ctx.environmentId,
                runId = ctx.runId, workflowId = ctx.workflowId,
                nodeId = node.id, attemptGroup = ctx.attemptGroup,
                toolLabel = (node.config["toolName"] as? String) ?: node.label.ifBlank { node.id },
                callbackBaseUrl = callbackBaseUrl,
            )) {
                is AsyncToolProtocol.Precheck.AlreadyResolved -> {
                    waits.recordWaitedTime(
                        ctx.runId,
                        java.time.Duration.between(
                            pre.wait.createdAt, pre.wait.resolvedAt ?: java.time.Instant.now()
                        ).toMillis(),
                    )
                    return completeFromWait(node, spec, pre.wait, ctx, scope)
                }

                is AsyncToolProtocol.Precheck.StillWaiting ->
                    /* Submitted on an earlier tick and still running. Park again
                       WITHOUT re-submitting — this branch is what stops a
                       redelivered queue message starting a second render. */
                    return parkOn(pre.wait, node, ctx)

                is AsyncToolProtocol.Precheck.Unavailable ->
                    return NodeResult.Failed(
                        "This tool runs asynchronously and its wait could not be created: " +
                            "${pre.why}. The call was not made.",
                        retryable = true,
                    )

                is AsyncToolProtocol.Precheck.Submit -> {
                    asyncWait = pre.wait
                    callbackUrl = pre.callbackUrl
                    if (callbackUrl == null && async.poll == null) {
                        /* No token could be minted (no callback secret configured)
                           and nothing to poll. Submitting would start a job whose
                           completion has no route home — a run parked to its
                           deadline every time. Refuse loudly instead. */
                        return NodeResult.Failed(
                            "This tool expects a completion callback, but no callback secret " +
                                "is configured on this worker, so the provider would have no " +
                                "way to report back. Set WAIT_CALLBACK_SECRET, or give the " +
                                "tool a status URL to poll.",
                            retryable = false,
                        )
                    }
                }
            }
        }

        // ── 3. Assemble + authenticate ────────────────────────────────────────
        /*
         * The callback URL is injected as an ARGUMENT, into the input the spec
         * names — so it travels wherever that provider expects it (a body field,
         * a query parameter, a header) without this code knowing which.
         *
         * It is added AFTER the model's arguments and therefore wins, which is
         * the point: a model-supplied callback URL would be a model choosing
         * where a completion is delivered.
         */
        val submitArgs = if (async?.callback != null && callbackUrl != null)
            args + (async.callback.urlInput to callbackUrl) else args

        val prepared = try {
            RequestAssembler.assemble(spec, baseUrl, submitArgs)
        } catch (e: RequestAssembler.AssemblyException) {
            return NodeResult.Failed("HTTP tool '${node.id}': ${e.message}", retryable = false)
        }

        val authCtx = AuthApplier.Context(
            workspaceId = ctx.workspaceId,
            connectionId = connectionId,
            secrets = secrets,
            scope = scope,
            client = client,
            timeoutMs = timeoutMs,
        )
        val applied = try {
            auth.apply(effectiveAuth, prepared, authCtx)
        } catch (e: AuthApplier.AuthException) {
            emit(ctx, node.id, EventType.HTTP_REQUEST_PREPARED, "failed",
                "Authentication failed", scope.scrub(e.message?.take(200)))
            /* Not retryable: a credential does not become valid by being used
               again, and the agent is told so in the same sentence. */
            return NodeResult.Failed("HTTP tool '${node.id}': ${e.message}", retryable = false)
        }

        val finalUrl = withQuery(prepared.url, applied.query)
        /* The URL as it may be REPORTED. When a credential rides in the query
           string, the query is dropped entirely rather than redacted piecewise:
           a redactor that has to enumerate parameter names is one vendor away
           from missing one. */
        val reportableUrl = if (applied.credentialInQuery) prepared.safeUrl
        else sanitiseForReport(finalUrl)

        // ── 4. Egress checks, on the URL that will be sent ────────────────────
        try {
            SsrfGuard.checkUrl(finalUrl, allowedHosts)
        } catch (e: SsrfException) {
            emit(ctx, node.id, EventType.HTTP_REQUEST_PREPARED, "blocked",
                "Request blocked", scope.scrub(e.message?.take(200)))
            return NodeResult.Failed(
                "HTTP tool '${node.id}' was blocked before sending: ${e.message}", retryable = false)
        }
        if (allowedPaths.isNotEmpty()) {
            val path = runCatching { URI(finalUrl).path ?: "/" }.getOrDefault("/")
            if (allowedPaths.none { path.startsWith(it) }) {
                return NodeResult.Failed(
                    "HTTP tool '${node.id}': the path '$path' is not in this connection's " +
                        "allowed paths. Widen them on the connection, or narrow the tool.",
                    retryable = false,
                )
            }
        }

        val method = prepared.method
        val isWrite = spec.request.isWrite

        emit(ctx, node.id, EventType.HTTP_REQUEST_PREPARED, "running",
            "HTTP request prepared", "$method $reportableUrl")

        // ── 5. Exactly-once reservation, for a write ──────────────────────────
        val guard = sideEffects
        val reservation = if (guard != null && isWrite) {
            when (val outcome = guard.begin(
                workspaceId = ctx.workspaceId,
                runId = ctx.runId,
                nodeId = node.id,
                attemptGroup = ctx.attemptGroup,
                effectType = "http",
                target = runCatching { URI(finalUrl).host }.getOrNull(),
                leaseToken = ctx.leaseToken,
            )) {
                is SideEffectGuard.Outcome.AlreadyDone -> {
                    emit(ctx, node.id, EventType.HTTP_REQUEST_COMPLETED, "success",
                        "HTTP request deduplicated",
                        "Identical call already performed — replaying the stored response")
                    val parsed = parseJson(outcome.response ?: "{}")
                    return NodeResult.Completed(
                        output = mapOf(
                            "statusCode" to 200,
                            "body" to mapper.convertValue(parsed, Any::class.java),
                            "deduplicated" to true,
                        ),
                        metadata = mapOf("deduplicated" to true, "idempotencyKey" to outcome.key),
                    )
                }

                is SideEffectGuard.Outcome.Undetermined ->
                    return NodeResult.Failed(
                        "HTTP tool '${node.id}': ${outcome.reason} (idempotencyKey=${outcome.key})",
                        retryable = false,
                    )

                is SideEffectGuard.Outcome.Proceed -> outcome
            }
        } else null

        /*
         * The idempotency key is the guard's, unchanged.
         *
         * Invariant 2: it is derived from (run, node, attempt_group) and is
         * identical on every re-execution. Nothing here may add an attempt
         * number, a timestamp or a random component to it — a key that changes
         * between attempts opens a duplicate gate at the provider exactly when
         * the guard is trying to close one.
         */
        val idempotencyKey = reservation?.key

        // ── 6 & 7. Send, retry, paginate ──────────────────────────────────────
        val startMs = System.currentTimeMillis()
        emit(ctx, node.id, EventType.HTTP_REQUEST_STARTED, "running",
            "HTTP request started", "$method $reportableUrl")

        var pageCount = 0
        var lastStatus = 0
        var lastHeaders: Map<String, List<String>> = emptyMap()
        var lastRawBody = ""

        suspend fun send(url: String, extraQuery: Map<String, String>): Paginator.Page? {
            val target = if (extraQuery.isEmpty()) url else withQuery(url, extraQuery.toList())
            /* Every page re-checks egress. A `next` link is supplied by the
               REMOTE SERVER, so following one without re-checking would let a
               response redirect the runtime at an internal address — the SSRF
               the guard exists for, arriving one hop later than expected. */
            try {
                SsrfGuard.checkUrl(target, allowedHosts)
            } catch (e: SsrfException) {
                log.warn("[http-tool] pagination target blocked [node={}]: {}", node.id, e.message)
                return null
            }
            val outcome = sendWithRetry(
                spec, target, prepared, applied, bound, client,
                timeoutMs, maxBytes, idempotencyKey, scope,
            )
            pageCount++
            lastStatus = outcome.statusCode
            lastHeaders = outcome.headers
            lastRawBody = outcome.body
            return Paginator.Page(parseJson(outcome.body), outcome.headers, outcome.statusCode)
        }

        val firstPage = try {
            send(finalUrl, emptyMap())
        } catch (e: OutboundHttp.ResponseTooLargeException) {
            reservation?.let { guard?.fail(it.sideEffectId, "response too large") }
            return NodeResult.Failed(
                "The response from this tool exceeded ${e.limitBytes} bytes and was aborted. " +
                    "Narrow the request, or raise the tool's response limit.",
                retryable = false,
            )
        } catch (e: OutboundHttp.TotalCallTimeoutException) {
            /* Deliberately NOT released. A timeout may have reached the endpoint,
               so the reservation stays in_flight and the next attempt refuses
               rather than duplicating. */
            WorkerMetrics.toolCallDurationSeconds.observeMs(e.budgetMs, method, "timeout")
            return NodeResult.Failed(
                "This tool exceeded its ${e.budgetMs}ms budget and was aborted. Raise the " +
                    "tool's timeout, or check that the endpoint is responding.",
            )
        } catch (e: Exception) {
            reservation?.let { guard?.fail(it.sideEffectId, e.javaClass.simpleName) }
            WorkerMetrics.toolCallDurationSeconds.observeMs(
                System.currentTimeMillis() - startMs, method, "error")
            log.warn("[http-tool] request failed [node={}, method={}]: {}",
                node.id, method, e.javaClass.simpleName)
            return NodeResult.Failed(
                "The request to ${hostOf(finalUrl)} failed: ${scope.scrub(e.message?.take(200))}")
        } ?: return NodeResult.Failed("HTTP tool '${node.id}': the request could not be sent.")

        // ── The status decision ───────────────────────────────────────────────
        if (!spec.response.accepts(firstPage.statusCode)) {
            reservation?.let { guard?.fail(it.sideEffectId, "HTTP ${firstPage.statusCode}") }
            return httpFailure(node, spec, firstPage, lastRawBody, reportableUrl, ctx, scope, startMs)
        }

        /*
         * A declared soft failure: HTTP 200 with an error in the body. Checked
         * AFTER the status check so a rule can also match a 2xx, which is the
         * whole point — Slack's `{"ok": false}` arrives as 200 and used to be a
         * hard-coded branch inside the executor, applying to every HTTP tool in
         * the product whether or not it was Slack.
         */
        matchSoftFailure(spec, firstPage)?.let {
            reservation?.let { r -> guard?.fail(r.sideEffectId, "soft failure") }
            return httpFailure(node, spec, firstPage, lastRawBody, reportableUrl, ctx, scope, startMs)
        }

        /*
         * ── THE SUBMIT SUCCEEDED. TAKE THE HANDLE AND PARK. ─────────────────
         *
         * The side-effect reservation is COMPLETED here, not left open: the
         * submit is the side effect, it happened, and a redelivery must not
         * repeat it. The long-running job is tracked by the wait from now on,
         * which is a different mechanism with a different key — the guard stops a
         * second submit, the wait's `status = 'waiting'` CAS stops a second
         * completion.
         */
        if (async != null && asyncWait != null) {
            val handle = AsyncToolProtocol.handleFrom(firstPage.body, async)
            if (handle == null) {
                /*
                 * The provider accepted the job and we cannot say which job it is.
                 * Polling is impossible and a callback would arrive against a wait
                 * carrying no handle to correlate against — so the wait is
                 * cancelled rather than left to time out, and the node fails now
                 * with the reason, instead of in seven days.
                 */
                waitStore?.resolve(
                    java.util.UUID.fromString(asyncWait.id.toString()),
                    com.vectorbea.worker.durable.wait.RunWait.Resolution.CANCELLED,
                    null, "runtime:no_handle",
                )
                reservation?.let { guard?.complete(it.sideEffectId, lastRawBody.take(MAX_STORED_RESPONSE)) }
                return NodeResult.Failed(
                    "This tool submitted a long-running job, but the response contained " +
                        "nothing at '${async.handlePath}' to identify it, so its completion " +
                        "could not be tracked. Check the tool's handle path against the " +
                        "provider's response.",
                    retryable = false,
                )
            }

            val pollUrl = async.poll?.let { poll ->
                runCatching {
                    SpecTemplate.render(poll.url, submitArgs + mapOf("handle" to handle), strict = false)
                }.getOrNull()
            }
            waitStore?.attachHandle(asyncWait.id, handle, pollUrl)
            reservation?.let { guard?.complete(it.sideEffectId, lastRawBody.take(MAX_STORED_RESPONSE)) }

            log.info("[async-tool] submitted and parked [run={}, node={}, handle={}, poll={}, callback={}]",
                ctx.runId, node.id, handle, pollUrl != null, callbackUrl != null)

            return parkOn(
                asyncWait.copy(externalRef = handle, pollUrl = pollUrl),
                node, ctx,
            )
        }

        val paged = Paginator.walk(spec.pagination, firstPage) { extraQuery, absoluteUrl ->
            try {
                send(absoluteUrl ?: finalUrl, extraQuery)
            } catch (e: Exception) {
                /* A page after the first failing does not fail the call: what was
                   already fetched is real, and returning it with a truncation
                   marker beats discarding it. */
                log.warn("[http-tool] pagination stopped early [node={}]: {}",
                    node.id, e.javaClass.simpleName)
                null
            }
        }

        val durationMs = System.currentTimeMillis() - startMs
        reservation?.let { guard?.complete(it.sideEffectId, lastRawBody.take(MAX_STORED_RESPONSE)) }

        // ── 8. Extract ────────────────────────────────────────────────────────
        val extracted = ResponseExtractor.extract(paged.body, spec.response.extract)

        emit(ctx, node.id, EventType.HTTP_REQUEST_COMPLETED, "success",
            "HTTP request completed",
            "$method $reportableUrl → ${firstPage.statusCode} (${durationMs}ms" +
                (if (paged.pagesFetched > 1) ", ${paged.pagesFetched} pages" else "") + ")",
            durationMs)

        WorkerMetrics.toolCallDurationSeconds.observeMs(durationMs, method, "ok")

        val output = LinkedHashMap<String, Any?>()
        output["statusCode"] = firstPage.statusCode
        output["body"] = mapper.convertValue(extracted.node, Any::class.java)
        if (spec.response.keepHeaders.isNotEmpty()) {
            output["headers"] = spec.response.keepHeaders.associateWith { name ->
                lastHeaders.entries.firstOrNull { it.key.equals(name, ignoreCase = true) }
                    ?.value?.firstOrNull() ?: ""
            }
        }
        if (paged.truncated) output["truncated"] = true

        val metadata = LinkedHashMap<String, Any>()
        metadata["method"] = method
        metadata["statusCode"] = firstPage.statusCode
        metadata["durationMs"] = durationMs
        metadata["pagesFetched"] = paged.pagesFetched
        metadata["extractionApplied"] = extracted.applied
        if (paged.truncated) metadata["truncatedBy"] = paged.stoppedBecause ?: "a pagination cap"
        extracted.error?.let { metadata["extractionWarning"] = it }
        idempotencyKey?.let { metadata["idempotencyKey"] = it }

        @Suppress("UNCHECKED_CAST")
        return NodeResult.Completed(
            output = output.filterValues { it != null } as Map<String, Any>,
            metadata = metadata,
        )
    }

    // ── Sending ──────────────────────────────────────────────────────────────

    /**
     * One request, retried under the spec's policy.
     *
     * ── WHY A WRITE IS NOT RETRIED WITHOUT AN IDEMPOTENCY KEY ───────────────
     * A POST that timed out may have been received. Retrying it is how one
     * payment becomes two, so `retryWrites` alone does not authorise a retry:
     * the pairing with an idempotency key is enforced here rather than trusted
     * to whoever ticked the box. With a key, the provider deduplicates and the
     * retry is safe; without one, it is a second charge.
     */
    private suspend fun sendWithRetry(
        spec: HttpToolSpec,
        url: String,
        prepared: RequestAssembler.Prepared,
        applied: AuthApplier.Applied,
        bound: HttpTransport.Bound,
        client: java.net.http.HttpClient,
        timeoutMs: Long,
        maxBytes: Long,
        idempotencyKey: String?,
        scope: SecretScope,
    ): OutboundHttp.Result {
        val retry = spec.retry
        val writeSafe = !spec.request.isWrite || (retry.retryWrites && idempotencyKey != null)
        val attempts = if (writeSafe) retry.maxAttempts else 1

        var lastResult: OutboundHttp.Result? = null
        var lastError: Exception? = null

        for (attempt in 1..attempts) {
            if (attempt > 1) {
                val delayMs = backoffMs(retry, attempt - 1, lastResult)
                log.info("[http-tool] retrying [attempt={}/{}, afterMs={}, status={}]",
                    attempt, attempts, delayMs, lastResult?.statusCode ?: "transport")
                delay(delayMs)
            }
            try {
                val result = sendOnce(url, prepared, applied, bound, client, timeoutMs, maxBytes,
                    idempotencyKey, spec)
                lastResult = result
                if (!retry.retriesStatus(result.statusCode)) return result
                if (attempt == attempts) return result
            } catch (e: OutboundHttp.ResponseTooLargeException) {
                throw e
            } catch (e: OutboundHttp.TotalCallTimeoutException) {
                /* A timeout on a write is exactly the ambiguous case. It is never
                   retried here, whatever the policy says — the side-effect guard
                   owns that decision and will refuse the next attempt. */
                throw e
            } catch (e: Exception) {
                lastError = e
                if (attempt == attempts) throw e
            }
        }
        return lastResult ?: throw (lastError ?: IllegalStateException("no attempt was made"))
    }

    private fun sendOnce(
        url: String,
        prepared: RequestAssembler.Prepared,
        applied: AuthApplier.Applied,
        bound: HttpTransport.Bound,
        client: java.net.http.HttpClient,
        timeoutMs: Long,
        maxBytes: Long,
        idempotencyKey: String?,
        spec: HttpToolSpec,
    ): OutboundHttp.Result {
        val builder = HttpRequest.newBuilder().uri(URI.create(url))

        prepared.headers.forEach { (k, v) -> if (!isRestricted(k)) builder.header(k, v) }
        applied.headers.forEach { (k, v) -> builder.header(k, v) }
        bound.hostHeader?.let {
            /*
             * `Host` is a restricted header the JDK refuses unless the process
             * allows it. `jdk.httpclient.allowRestrictedHeaders` is set at
             * startup (see Main); when it is not, this is dropped rather than
             * throwing, because a missing Host override degrades to "reaches the
             * default virtual host" and an exception fails a working tool.
             */
            runCatching { builder.header("Host", it) }
        }
        if (idempotencyKey != null && spec.idempotency.mode == HttpToolSpec.IdempotencySpec.Mode.AUTO) {
            builder.header(spec.idempotency.header, idempotencyKey)
        }

        val publisher = if (prepared.body != null) {
            prepared.contentType?.let { builder.header("Content-Type", it) }
            HttpRequest.BodyPublishers.ofByteArray(prepared.body)
        } else {
            HttpRequest.BodyPublishers.noBody()
        }
        builder.method(prepared.method, publisher)

        return WorkerMetrics.timeBlocking {
            OutboundHttp.send(builder, totalCallMs = timeoutMs,
                maxResponseBytes = maxBytes, httpClient = client)
        }
    }

    /**
     * Backoff with jitter, and with the provider's own instruction when it gave
     * one.
     *
     * ── WHY JITTER IS NOT OPTIONAL ──────────────────────────────────────────
     * Without it, every worker that failed against a provider at the same moment
     * retries at the same moment. A provider recovering from a blip is
     * immediately knocked over by its own clients — the thundering herd, produced
     * exactly by a fixed backoff. FULL jitter (a uniform draw over the whole
     * window) spreads the load best and is the default; EQUAL keeps half the
     * window fixed for callers who want a floor.
     *
     * `Retry-After` overrides the computed delay because it is the provider
     * telling us when it will be ready, and disregarding it is how a client
     * earns a longer ban.
     */
    private fun backoffMs(
        retry: HttpToolSpec.RetrySpec,
        completedAttempts: Int,
        last: OutboundHttp.Result?,
    ): Long {
        if (retry.respectRetryAfter) {
            retryAfterMs(last)?.let { return it.coerceAtMost(retry.maxDelayMs) }
        }
        val exponential = (retry.initialDelayMs *
            Math.pow(retry.multiplier, (completedAttempts - 1).coerceAtLeast(0).toDouble()))
            .toLong()
            .coerceIn(0, retry.maxDelayMs)
        return when (retry.jitter) {
            HttpToolSpec.RetrySpec.Jitter.NONE -> exponential
            HttpToolSpec.RetrySpec.Jitter.FULL ->
                if (exponential <= 0) 0 else (random.nextDouble() * exponential).toLong()

            HttpToolSpec.RetrySpec.Jitter.EQUAL -> {
                val half = exponential / 2
                half + (random.nextDouble() * half).toLong()
            }
        }
    }

    private fun retryAfterMs(result: OutboundHttp.Result?): Long? {
        val raw = result?.headers?.entries
            ?.firstOrNull { it.key.equals("retry-after", ignoreCase = true) }
            ?.value?.firstOrNull() ?: return null
        raw.trim().toLongOrNull()?.let { return it * 1_000 }
        /* The HTTP-date form. Rare, and real: some CDNs send it. */
        return runCatching {
            val at = java.time.format.DateTimeFormatter.RFC_1123_DATE_TIME
                .parse(raw.trim(), java.time.Instant::from)
            (at.toEpochMilli() - System.currentTimeMillis()).coerceAtLeast(0)
        }.getOrNull()
    }

    // ── Failure shaping ──────────────────────────────────────────────────────

    /**
     * Turn a refused call into something an agent can act on.
     *
     * The spec's error mappings feed `ToolErrorShape` — the same type the result
     * contract produces — so an HTTP tool's failures and a database tool's
     * failures reach the model in one vocabulary, and an operator writing "403
     * means reconnect" writes it once.
     */
    private fun httpFailure(
        node: WorkflowNode,
        spec: HttpToolSpec,
        page: Paginator.Page,
        rawBody: String,
        reportableUrl: String,
        ctx: RuntimeContext,
        scope: SecretScope,
        startMs: Long,
    ): NodeResult {
        val durationMs = System.currentTimeMillis() - startMs
        val soft = matchSoftFailure(spec, page)
        val rule = soft ?: spec.response.errors.firstOrNull {
            it.status == page.statusCode || (it.status == null && it.bodyContains != null &&
                rawBody.contains(it.bodyContains, ignoreCase = true))
        }

        val providerMessage = rule?.messagePath
            ?.let { ResponseExtractor.atPath(page.body, it)?.asText() }
            ?: providerMessageOf(page.body)

        val shape = if (rule != null) {
            ToolErrorShape(
                kind = rule.kind,
                retryable = rule.retryable,
                what = buildString {
                    append(defaultWhat(rule.kind, page.statusCode))
                    providerMessage?.let { append(" The provider said: ${it.take(200)}") }
                },
                fix = rule.fix,
                status = page.statusCode,
            )
        } else {
            ToolErrorShape.ofStatus(page.statusCode, providerMessage)
        }

        emit(ctx, node.id, EventType.HTTP_REQUEST_COMPLETED, "failed",
            "HTTP request failed",
            scope.scrub("$reportableUrl → ${page.statusCode} (${durationMs}ms)"),
            durationMs)
        WorkerMetrics.toolCallDurationSeconds.observeMs(durationMs, spec.request.methodUpper, "http_error")

        return NodeResult.Failed(
            scope.scrub(shape.asObservation()) ?: "The tool call failed.",
            retryable = shape.retryable,
        )
    }

    /** A 2xx that the spec declares to be a failure. Slack's `{"ok": false}`. */
    private fun matchSoftFailure(
        spec: HttpToolSpec,
        page: Paginator.Page,
    ): HttpToolSpec.ErrorMapping? = spec.response.errors.firstOrNull { rule ->
        val path = rule.whenBodyFalse ?: return@firstOrNull false
        val statusMatches = rule.status == null || rule.status == page.statusCode
        if (!statusMatches) return@firstOrNull false
        val node = ResponseExtractor.atPath(page.body, path)
        node == null || (node.isBoolean && !node.asBoolean()) || node.asText() == "false"
    }

    private fun defaultWhat(kind: String, status: Int): String = when (kind) {
        "auth" -> "The tool could not authenticate (HTTP $status)."
        "not_found" -> "The tool found no such record (HTTP $status)."
        "invalid_input" -> "The tool rejected the input as invalid (HTTP $status)."
        "rate_limit" -> "The tool was rate limited (HTTP $status)."
        "server" -> "The tool's provider returned an error (HTTP $status)."
        else -> "The tool call failed (HTTP $status)."
    }

    /**
     * The provider's own message, from wherever it put it.
     *
     * Every API nests this somewhere different and none of them agree. Guessing
     * over a short list beats returning nothing: the alternative is an agent
     * shown "HTTP 400" that retries with a slightly different input until its
     * iteration budget runs out, which is the exact loop `ToolErrorShape` exists
     * to end.
     */
    private fun providerMessageOf(body: JsonNode?): String? {
        if (body == null) return null
        for (path in MESSAGE_PATHS) {
            ResponseExtractor.atPath(body, path)?.let { n ->
                if (n.isTextual && n.asText().isNotBlank()) return n.asText()
            }
        }
        return null
    }

    // ── Transport binding ────────────────────────────────────────────────────

    private fun bindTransport(
        spec: HttpToolSpec,
        workspaceId: UUID,
        scope: SecretScope,
    ): HttpTransport.Bound {
        if (spec.transport.isDefault) {
            return HttpTransport.bind(spec.transport, HttpTransport.Material())
        }
        val secrets = secretService
            ?: throw HttpTransport.TransportException(
                "This tool needs client certificates and no secret service is configured."
            )

        fun read(ref: String?): String? = ref?.let { r ->
            secrets.resolve(r, workspaceId)?.useOnce { it }?.also { scope.protect(it) }
        }

        val material = HttpTransport.Material(
            clientCertPem = read(spec.transport.mtls?.clientCertSecretRef),
            clientKeyPem = read(spec.transport.mtls?.clientKeySecretRef),
            keyPassphrase = read(spec.transport.mtls?.keyPassphraseSecretRef),
            proxyCredential = read(spec.transport.proxy?.credentialSecretRef),
        )
        return HttpTransport.bind(spec.transport, material)
    }

    // ── Async: parking, and coming back ──────────────────────────────────────

    /** Hand the wait to the runtime, which parks the run and releases the worker. */
    private fun parkOn(
        wait: com.vectorbea.worker.durable.wait.RunWait,
        node: WorkflowNode,
        ctx: RuntimeContext,
    ): NodeResult {
        emit(ctx, node.id, EventType.RUN_WAIT_STARTED, "waiting_for_event",
            "Waiting for a long-running job",
            wait.label ?: "The provider is still working.")
        return NodeResult.Waiting(
            waitId = wait.id.toString(),
            kind = wait.kind.wire,
            label = wait.label ?: "Waiting for a long-running job",
            timeoutAt = wait.timeoutAt,
            metadata = buildMap {
                wait.externalRef?.let { put("handle", it) }
                put("waitKey", wait.waitKey)
            },
        )
    }

    /**
     * The node's result, taken out of a wait that has already resolved.
     *
     * ── THE PROVIDER IS NOT CONTACTED ───────────────────────────────────────
     * This is the resume path. The render finished, the callback (or a poll)
     * wrote the answer onto the wait, the run was woken, and this step
     * re-executed. Everything it needs is on the row — so it must not submit
     * again, and the extraction and error mapping run over the stored payload
     * exactly as they would over a live response.
     */
    private fun completeFromWait(
        node: WorkflowNode,
        spec: HttpToolSpec,
        wait: com.vectorbea.worker.durable.wait.RunWait,
        ctx: RuntimeContext,
        scope: SecretScope,
    ): NodeResult {
        val waitedMs = java.time.Duration.between(
            wait.createdAt, wait.resolvedAt ?: java.time.Instant.now()).toMillis()

        return when (val outcome = AsyncToolProtocol.resultFrom(wait)) {
            is AsyncToolProtocol.AsyncResult.Completed -> {
                /* The same extraction the synchronous path applies. An async tool's
                   result is a response like any other, and a model should not see a
                   different shape because the work took six minutes. */
                val extracted = ResponseExtractor.extract(outcome.payload, spec.response.extract)

                emit(ctx, node.id, EventType.RUN_WAIT_RESOLVED, "success",
                    "Long-running job finished",
                    "Completed after ${waitedMs / 1000}s" +
                        (wait.externalRef?.let { " (job $it)" } ?: ""),
                    durationMs = waitedMs)

                NodeResult.Completed(
                    output = buildMap {
                        put("body", mapper.convertValue(extracted.node, Any::class.java))
                        put("async", true)
                        wait.externalRef?.let { put("handle", it) }
                    },
                    metadata = mapOf(
                        "async" to true,
                        "waitedMs" to waitedMs,
                        "resolvedBy" to (wait.resolvedBy ?: "unknown"),
                        "extractionApplied" to extracted.applied,
                    ),
                )
            }

            is AsyncToolProtocol.AsyncResult.Failed -> {
                val timedOut = wait.resolution == com.vectorbea.worker.durable.wait.RunWait.Resolution.TIMEOUT
                emit(ctx, node.id,
                    if (timedOut) EventType.RUN_WAIT_TIMED_OUT else EventType.RUN_WAIT_RESOLVED,
                    "failed",
                    if (timedOut) "Long-running job timed out" else "Long-running job failed",
                    scope.scrub(outcome.message.take(300)),
                    durationMs = waitedMs)

                NodeResult.Failed(
                    scope.scrub(outcome.message) ?: outcome.message,
                    retryable = outcome.retryable,
                )
            }
        }
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    private fun parseJson(raw: String): JsonNode = try {
        if (raw.isBlank()) mapper.createObjectNode()
        else mapper.readTree(raw)
    } catch (_: Exception) {
        mapper.getNodeFactory().textNode(raw)
    }

    private fun withQuery(url: String, extra: List<Pair<String, String>>): String {
        if (extra.isEmpty()) return url
        val encoded = extra.joinToString("&") { (k, v) ->
            "${RequestAssembler.encodeQuery(k)}=${RequestAssembler.encodeQuery(v)}"
        }
        return if (url.contains('?')) "$url&$encoded" else "$url?$encoded"
    }

    /**
     * A URL safe to write down.
     *
     * The query string is dropped whole. Redacting named parameters would need a
     * list of every parameter any vendor uses for a credential, and the list is
     * wrong the first time a vendor invents a new one.
     */
    private fun sanitiseForReport(url: String): String = runCatching {
        val u = URI(url)
        "${u.scheme}://${u.host}${u.path ?: ""}"
    }.getOrElse { url.substringBefore('?').take(120) }

    private fun hostOf(url: String): String =
        runCatching { URI(url).host ?: "the endpoint" }.getOrDefault("the endpoint")

    /** Headers the JDK refuses. Setting them throws; dropping them does not. */
    private fun isRestricted(name: String): Boolean =
        name.lowercase() in RESTRICTED_HEADERS

    private fun emit(
        ctx: RuntimeContext,
        nodeId: String,
        type: EventType,
        status: String,
        title: String? = null,
        summary: String? = null,
        durationMs: Long? = null,
    ) = try {
        eventStore.appendEvent(RunEvent(
            runId = ctx.runId,
            workspaceId = ctx.workspaceId,
            environmentId = ctx.environmentId,
            type = type,
            status = status,
            stepId = nodeId,
            title = title,
            summary = summary,
            durationMs = durationMs,
        ))
    } catch (_: Exception) {
    }

    companion object {
        const val DEFAULT_MAX_RESPONSE_BYTES = 2_097_152L

        /** How much of a response is stored for the deduplication replay. */
        private const val MAX_STORED_RESPONSE = 256 * 1024

        /**
         * `Host` is deliberately absent — the transport sets it, guardedly.
         * `Content-Length` and `Connection` are computed by the client.
         */
        private val RESTRICTED_HEADERS = setOf(
            "connection", "content-length", "expect", "host", "upgrade",
        )

        /** Where APIs put their error text, in rough order of frequency. */
        private val MESSAGE_PATHS = listOf(
            "message", "error", "error.message", "error_description",
            "errors[0].message", "detail", "title", "error.detail",
            "errors[0].detail", "meta.error",
        )
    }
}
