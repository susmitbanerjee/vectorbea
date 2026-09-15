package com.vectorbea.worker.runtime.executor

import com.fasterxml.jackson.module.kotlin.jacksonObjectMapper
import com.vectorbea.worker.connector.ConnectionException
import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.SsrfException
import com.vectorbea.worker.connector.SsrfGuard
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.EventType
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import com.vectorbea.worker.net.OutboundHttp
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowNode
import java.net.URI
import java.net.http.HttpRequest
import java.util.UUID

/**
 * Executes HTTP tool nodes against external HTTP endpoints.
 *
 * Node config keys:
 *   - connectionId    (UUID string, optional) — an HTTP connection for base URL + auth
 *   - url             (string, required if no connectionId) — absolute URL
 *   - method          (string, default "GET")
 *   - headers         (Map<String,String>, optional) — additional request headers
 *   - body            (Any, optional) — request body (JSON-serialized)
 *   - timeoutMs       (Long, optional) — default 30 s
 *   - maxResponseBytes (Long, optional) — default 2 MB
 *   - followRedirects (Boolean, default true)
 *
 * SECURITY:
 *  - SSRF guard applied to every request.
 *  - allowedHosts enforced if connection is set.
 *  - allowedPaths enforced if connection is set and non-empty.
 *  - Authorization headers are REDACTED in all event summaries.
 *  - Secrets are never placed in URLs.
 *  - Response body is never logged raw.
 *
 * AVAILABILITY:
 *  `timeoutMs` here is the value a tool row's `timeout_ms` column resolves to.
 *  It is enforced as a **total-call** budget by [OutboundHttp.send] — connect,
 *  headers, and body streaming — not merely as the JDK's headers-phase request
 *  timeout, which a server can evade by answering 200 and then stalling the body.
 */
class HttpNodeExecutor(
    private val connectionResolver: ConnectionResolver,
    private val eventStore: RunEventStore,
    /** Injectable for tests; production always uses the shared, bounded client. */
    private val httpClient: java.net.http.HttpClient = OutboundHttp.client,
    /**
     * Exactly-once guard for the outbound call. Null disables deduplication —
     * acceptable in unit tests, never in production, where an at-least-once
     * queue plus an unguarded POST means duplicate side effects.
     */
    private val sideEffects: com.vectorbea.worker.durable.SideEffectGuard? = null,
    /** Mirrors MESSAGING_WEBHOOKS_ENABLED. A parameter so a test can drive both settings. */
    private val messagingWebhooksEnabled: Boolean = MESSAGING_WEBHOOKS_ENABLED,
) : NodeExecutor {

    private val log    = logger()
    private val mapper = jacksonObjectMapper()

    companion object {
        const val DEFAULT_TIMEOUT_MS          = 30_000L
        const val DEFAULT_MAX_RESPONSE_BYTES  = 2_097_152L // 2 MB
        private val REDACTED_HEADER_NAMES = setOf(
            "authorization", "x-api-key", "api-key", "x-auth-token", "x-secret"
        )

        /** A `{placeholder}` in the URL that nothing supplied a value for. */
        class UnresolvedPathParam(val name: String) : Exception(name)

        private val PATH_PARAM = Regex("""\{\{?\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}?\}""")

        /**
         * Fill `{name}` placeholders in a URL from the node's resolved inputs.
         *
         * WHY THIS EXISTS. A REST API puts its identifiers in the path — GitHub's
         * pull request is `/repos/{owner}/{repo}/pulls/{number}`, Airtable's record
         * is `/v0/{base}/{table}`. Without substitution the only tools that could be
         * registered were ones whose every path segment was fixed forever, so "read
         * a pull request" could read exactly one pull request. Body templates have
         * been resolvable since the beginning; URLs simply never were, which quietly
         * decided which integrations were expressible.
         *
         * VALUES ARE PATH-ENCODED, ALWAYS. These come from workflow inputs and, one
         * step further back, from a model. An unencoded `../` or a `?` would climb
         * out of the intended resource or graft a query string onto the request —
         * turning "read issue N" into a call at a different path entirely. Encoding
         * happens before the SSRF and allowed-path checks run, so those inspect the
         * URL that will actually be sent.
         *
         * An unresolved placeholder FAILS rather than being left in place. A literal
         * `{number}` in a path produces a 404 from the vendor, and a vendor 404 is
         * the single least informative way to learn that an input mapping is missing.
         */
        fun substitutePathParams(url: String, resolvedInputs: Map<String, Any>): String {
            if (!url.contains('{')) return url
            return PATH_PARAM.replace(url) { match ->
                val name = match.groupValues[1]
                val value = resolvedInputs[name]
                    ?: resolvedInputs[name.substringAfterLast('.')]
                    ?: throw UnresolvedPathParam(name)
                java.net.URLEncoder.encode(value.toString(), Charsets.UTF_8)
                    // URLEncoder is a FORM encoder: it writes a space as `+`, which
                    // is a literal plus inside a path segment. `%20` is the path form.
                    .replace("+", "%20")
            }
        }
    }

    override suspend fun execute(
        node: WorkflowNode,
        resolvedInputs: Map<String, Any>,
        context: RuntimeContext,
    ): NodeResult {
        val cfg = node.config

        // ── Optional: resolve connection ──────────────────────────────────────
        val connectionIdStr = cfg["connectionId"] as? String
        var allowedHosts    = emptyList<String>()
        /* Public until a connection says otherwise: a node with no connection has
           nothing that could have authorised private egress. */
        var egressPolicy    = SsrfGuard.EgressPolicy.PUBLIC
        var allowedPaths    = emptyList<String>()
        var baseUrl: String? = null
        var authHeader: Pair<String, String>? = null
        /* Set when the connection's credential IS the destination — a Teams,
           Google Chat or Discord incoming webhook. Never logged, never put in an
           event: see `displayUrl` below. */
        var webhookUrl: String? = null
        var providerHeaders: Map<String, String> = emptyMap()

        if (!connectionIdStr.isNullOrBlank()) {
            val connectionId = try { UUID.fromString(connectionIdStr) }
            catch (e: Exception) {
                return NodeResult.Failed("HTTP node '${node.id}': invalid connectionId format")
            }

            val resolved = try {
                connectionResolver.resolve(connectionId, context.workspaceId, expectedType = "http")
            } catch (e: ConnectionException) {
                emitEvent(context, node.id, EventType.CONNECTION_VALIDATION_FAILED, "failed",
                    title = "Connection validation failed")
                return NodeResult.Failed("Connection error for node '${node.id}': ${e.message}")
            }

            emitEvent(context, node.id, EventType.CONNECTION_RESOLVED, "info",
                title = "Connection resolved",
                summary = "provider=${resolved.record.provider}")

            allowedHosts = resolved.record.allowedHosts
            egressPolicy = resolved.record.egressPolicy
            allowedPaths = resolved.record.allowedPaths
            baseUrl      = resolved.record.configJson["baseUrl"] as? String

            providerHeaders = PROVIDER_HEADERS[normaliseProvider(resolved.record.provider)] ?: emptyMap()

            // Build auth header from connection
            if (resolved.secret != null && !resolved.secret.isCleared()) {
                val authType = resolved.record.authType.lowercase()
                resolved.secret.useOnce { secret ->
                    if (authType == WEBHOOK_URL_AUTH) {
                        webhookUrl = secret
                    } else {
                        authHeader = authHeaderFor(authType, secret, resolved.record.provider, resolved.record.configJson)
                    }
                }
            }

            if (resolved.record.authType.equals(WEBHOOK_URL_AUTH, ignoreCase = true)) {
                if (!messagingWebhooksEnabled) {
                    return NodeResult.Failed(
                        "HTTP node '${node.id}': posting through an incoming webhook (Microsoft Teams, " +
                            "Google Chat, Discord) is switched off on this deployment. Set " +
                            "MESSAGING_WEBHOOKS_ENABLED=true on the worker to turn it on.")
                }
                if (webhookUrl.isNullOrBlank()) {
                    return NodeResult.Failed(
                        "HTTP node '${node.id}': the connection '${resolved.record.name}' has no webhook URL " +
                            "stored. Paste the channel's webhook URL into the connection again.")
                }
            }
        }

        // ── Build URL ─────────────────────────────────────────────────────────
        /*
         * A webhook connection's URL is the credential, so it is the ONLY URL the
         * call may go to. Neither the tool's config nor the caller's input can
         * move it: `resolveUrl` honours an input `url` when config has none, and
         * an agent that could supply one could send the channel's messages
         * anywhere.
         */
        val templateUrl = webhookUrl ?: resolveUrl(cfg, resolvedInputs, baseUrl)
            ?: return NodeResult.Failed("HTTP node '${node.id}': no URL provided (set 'url' in config or attach an HTTP connection with baseUrl)")

        val rawUrl = if (webhookUrl != null) templateUrl else try {
            substitutePathParams(templateUrl, resolvedInputs)
        } catch (e: UnresolvedPathParam) {
            return NodeResult.Failed(
                "HTTP node '${node.id}': the URL needs a value for '${e.name}' and the input did not " +
                    "supply one. Map it from an earlier node, or bind it on the tool."
            )
        }

        // ── SSRF check ────────────────────────────────────────────────────────
        try {
            SsrfGuard.checkUrl(rawUrl, allowedHosts, egressPolicy)
        } catch (e: SsrfException) {
            val reason = if (webhookUrl != null) "the webhook URL points at an address that is not allowed" else e.message
            emitEvent(context, node.id, EventType.HTTP_REQUEST_PREPARED, "blocked",
                title = "SSRF blocked", summary = reason?.take(200))
            return NodeResult.Failed("SSRF protection blocked request for node '${node.id}': $reason")
        }

        /* What may be written down about the destination. A webhook's path and
           query ARE its secret (Discord's token is the last path segment; Teams
           and Google Chat sign the query), so only the host survives. */
        val displayUrl = if (webhookUrl != null)
            "https://${runCatching { URI.create(rawUrl).host }.getOrNull() ?: "webhook"}/…"
        else sanitizeUrlForLog(rawUrl)

        // ── Allowed paths check ───────────────────────────────────────────────
        if (allowedPaths.isNotEmpty()) {
            val path = try { URI.create(rawUrl).path ?: "/" } catch (_: Exception) { "/" }
            val pathAllowed = allowedPaths.any { allowed -> path.startsWith(allowed) }
            if (!pathAllowed) {
                return NodeResult.Failed(
                    "HTTP node '${node.id}': path '$path' not in allowedPaths for this connection"
                )
            }
        }

        // ── Build request ─────────────────────────────────────────────────────
        val method      = (cfg["method"] as? String ?: "GET").uppercase()
        // tools.timeout_ms lands here. Clamp into the process ceiling so a tool
        // row cannot configure an unbounded call.
        val timeoutMs   = OutboundHttp.policy()
            .clampTotalCallMs((cfg["timeoutMs"] as? Number)?.toLong() ?: DEFAULT_TIMEOUT_MS)
        val maxRespBytes = (cfg["maxResponseBytes"] as? Number)?.toLong() ?: DEFAULT_MAX_RESPONSE_BYTES

        @Suppress("UNCHECKED_CAST")
        val extraHeaders = providerHeaders + ((cfg["headers"] as? Map<String, String>) ?: emptyMap())

        val bodyObj = cfg["body"] ?: resolvedInputs["body"]
        val bodyJson = if (bodyObj != null && method !in setOf("GET", "HEAD", "DELETE")) {
            when (bodyObj) {
                is String -> bodyObj
                else      -> mapper.writeValueAsString(bodyObj)
            }
        } else null

        emitEvent(context, node.id, EventType.HTTP_REQUEST_PREPARED, "running",
            title = "HTTP request prepared",
            summary = "$method $displayUrl")

        // ── Execute ───────────────────────────────────────────────────────────
        val startMs = System.currentTimeMillis()

        emitEvent(context, node.id, EventType.HTTP_REQUEST_STARTED, "running",
            title = "HTTP request started",
            summary = "$method $displayUrl")

        // ── Exactly-once guard ────────────────────────────────────────────────
        // An HTTP tool call is an external side effect: it sends the email, posts
        // to Slack, writes to the customer's CRM. The queue is at-least-once, so
        // without this a redelivery repeats it.
        val guard = sideEffects
        val reservation = if (guard != null && method != "GET" && method != "HEAD") {
            when (val outcome = guard.begin(
                workspaceId = context.workspaceId,
                runId = context.runId,
                nodeId = node.id,
                attemptGroup = context.attemptGroup,
                effectType = "http",
                target = runCatching { URI.create(rawUrl).host }.getOrNull(),
                leaseToken = context.leaseToken,
            )) {
                is com.vectorbea.worker.durable.SideEffectGuard.Outcome.AlreadyDone -> {
                    // This exact call already succeeded. Replay the stored
                    // response and do NOT contact the endpoint again.
                    emitEvent(context, node.id, EventType.HTTP_REQUEST_COMPLETED, "success",
                        title = "HTTP request deduplicated",
                        summary = "Identical call already performed — replaying stored response")
                    val parsed: Any = try {
                        mapper.readValue(outcome.response ?: "{}", Any::class.java)
                    } catch (_: Exception) { outcome.response ?: "" }
                    return NodeResult.Completed(
                        output = mapOf("statusCode" to 200, "body" to parsed,
                            "headers" to emptyMap<String, String>(), "deduplicated" to true),
                        metadata = mapOf("deduplicated" to true, "idempotencyKey" to outcome.key),
                    )
                }
                is com.vectorbea.worker.durable.SideEffectGuard.Outcome.Undetermined -> {
                    // A previous attempt died mid-call. We cannot tell whether the
                    // endpoint received it, so we refuse rather than risk sending
                    // it twice. A human resolves the side_effects row.
                    return NodeResult.Failed(
                        "HTTP node '${node.id}': ${outcome.reason} " +
                            "(idempotencyKey=${outcome.key})")
                }
                is com.vectorbea.worker.durable.SideEffectGuard.Outcome.Proceed -> outcome
            }
        } else null

        val (statusCode, responseBody, responseHeaders) = try {
            doRequest(rawUrl, method, authHeader, extraHeaders, bodyJson, timeoutMs, maxRespBytes,
                idempotencyKey = reservation?.key)
        } catch (e: OutboundHttp.ResponseTooLargeException) {
            WorkerMetrics.toolCallDurationSeconds.observeMs(
                System.currentTimeMillis() - startMs, method, "too_large")
            return NodeResult.Failed(
                "HTTP response exceeded size limit for node '${node.id}': > ${e.limitBytes} bytes"
            )
        } catch (e: OutboundHttp.TotalCallTimeoutException) {
            // A timeout is NOT a clean failure: the request may have reached the
            // endpoint. Left as in_flight so the next attempt refuses rather than
            // duplicating — see SideEffectGuard.Outcome.Undetermined.
            WorkerMetrics.toolCallDurationSeconds.observeMs(e.budgetMs, method, "timeout")
            log.warn("[http] request exceeded total budget [nodeId={}, method={}, budgetMs={}]",
                node.id, method, e.budgetMs)
            return NodeResult.Failed(
                "HTTP request for node '${node.id}' exceeded its ${e.budgetMs}ms budget and was aborted. " +
                    "Raise the tool's timeout, or check that the endpoint is responding."
            )
        } catch (e: Exception) {
            val durationMs = System.currentTimeMillis() - startMs
            // Connection-level failure: the request did not land, so a retry is
            // legitimate and the reservation is released.
            reservation?.let { guard?.fail(it.sideEffectId, e.message ?: e.javaClass.simpleName) }
            WorkerMetrics.toolCallDurationSeconds.observeMs(durationMs, method, "error")
            log.warn("[http] request failed [nodeId={}, method={}, durationMs={}]: {}",
                node.id, method, durationMs, e.javaClass.simpleName)
            /* An HTTP client's exception message can carry the URI, and for a
               webhook the URI is the credential. The class name is enough. */
            val detail = if (webhookUrl != null) e.javaClass.simpleName else e.message?.take(200)
            return NodeResult.Failed("HTTP request failed for node '${node.id}': $detail")
        }

        val durationMs = System.currentTimeMillis() - startMs

        val success = statusCode in 200..299
        emitEvent(context, node.id, EventType.HTTP_REQUEST_COMPLETED, if (success) "success" else "failed",
            title = "HTTP request completed",
            summary = "$method $displayUrl → $statusCode (${durationMs}ms)",
            durationMs = durationMs)

        if (!success) {
            // The endpoint answered — it saw the request. A 4xx will not become a
            // 2xx on retry, so record it as a genuine failure and let the retry
            // policy decide.
            reservation?.let { guard?.fail(it.sideEffectId, "HTTP $statusCode") }
            return NodeResult.Failed("HTTP node '${node.id}': server returned HTTP $statusCode")
        }

        // Succeeded. Store the response so any later attempt replays it instead
        // of calling again.
        reservation?.let { guard?.complete(it.sideEffectId, responseBody) }

        // ── Parse response ────────────────────────────────────────────────────
        val parsedBody: Any = try {
            mapper.readValue(responseBody, Any::class.java)
        } catch (_: Exception) {
            responseBody // raw string if not JSON
        }

        // ── Slack / API soft-failure detection ────────────────────────────────
        // Slack Web API (chat.postMessage etc.) always returns HTTP 200, but
        // indicates failures via {"ok": false, "error": "..."} in the JSON body.
        // Treat these as hard failures so the step shows as failed with the reason.
        @Suppress("UNCHECKED_CAST")
        if (parsedBody is Map<*, *>) {
            val ok = (parsedBody as Map<String, Any?>)["ok"]
            if (ok == false || ok == "false") {
                val slackError = parsedBody["error"]?.toString() ?: "unknown Slack error"
                val needed     = parsedBody["needed"]?.toString()  // missing OAuth scope
                val reason = if (needed != null)
                    "Slack API error: $slackError (needed scope: $needed)"
                else
                    "Slack API error: $slackError"
                log.warn("[http] Slack soft-failure [nodeId={}, error={}]", node.id, slackError)
                return NodeResult.Failed("HTTP node '${node.id}': $reason")
            }
        }

        return NodeResult.Completed(
            output = mapOf(
                "statusCode"  to statusCode,
                "body"        to parsedBody,
                "headers"     to redactHeaders(responseHeaders),
            ),
            metadata = mapOf(
                "method"     to method,
                "statusCode" to statusCode,
                "durationMs" to durationMs,
            )
        )
    }

    // ── HTTP execution ────────────────────────────────────────────────────────

    private fun doRequest(
        url: String,
        method: String,
        authHeader: Pair<String, String>?,
        extraHeaders: Map<String, String>,
        bodyJson: String?,
        timeoutMs: Long,
        maxResponseBytes: Long,
        idempotencyKey: String? = null,
    ): Triple<Int, String, Map<String, List<String>>> {
        val reqBuilder = HttpRequest.newBuilder().uri(URI.create(url))

        // Pass the key through so providers that support native idempotency
        // (Stripe, OpenAI, and anything following that convention) dedupe on
        // their side too. Belt and braces: ours stops the second call being
        // made, theirs stops it counting if it somehow is.
        idempotencyKey?.let { reqBuilder.header("Idempotency-Key", it) }

        // Auth header first — never in URL
        authHeader?.let { (name, value) -> reqBuilder.header(name, value) }

        // Extra headers (skip if they attempt to override auth)
        extraHeaders.forEach { (k, v) ->
            if (k.lowercase() !in REDACTED_HEADER_NAMES) {
                reqBuilder.header(k, v)
            }
        }

        val bodyPublisher = when {
            bodyJson != null -> {
                reqBuilder.header("Content-Type", "application/json")
                HttpRequest.BodyPublishers.ofString(bodyJson)
            }
            else -> HttpRequest.BodyPublishers.noBody()
        }

        reqBuilder.method(method, bodyPublisher)

        // The size cap is enforced WHILE reading and the total-call ceiling covers
        // body streaming — a peer that answers 200 and then stalls is aborted at
        // [timeoutMs] rather than holding this pool thread indefinitely.
        val result = WorkerMetrics.timeBlocking {
            OutboundHttp.send(reqBuilder, totalCallMs = timeoutMs,
                maxResponseBytes = maxResponseBytes, httpClient = httpClient)
        }
        WorkerMetrics.toolCallDurationSeconds.observeMs(
            result.durationMs, method, if (result.statusCode in 200..299) "ok" else "http_error")
        return Triple(result.statusCode, result.body, result.headers)
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun resolveUrl(
        cfg: Map<String, Any>,
        resolvedInputs: Map<String, Any>,
        baseUrl: String?,
    ): String? {
        val configUrl = cfg["url"] as? String
        val inputUrl  = resolvedInputs["url"] as? String
        val path      = cfg["path"] as? String ?: resolvedInputs["path"] as? String

        return when {
            !configUrl.isNullOrBlank() -> {
                if (baseUrl != null && !configUrl.startsWith("http")) {
                    baseUrl.trimEnd('/') + "/" + configUrl.trimStart('/')
                } else configUrl
            }
            !inputUrl.isNullOrBlank()  -> inputUrl
            baseUrl != null && path != null -> baseUrl.trimEnd('/') + "/" + path.trimStart('/')
            baseUrl != null -> baseUrl
            else -> null
        }
    }

    /** Remove query-string from URL for safe logging. */
    private fun sanitizeUrlForLog(url: String): String = try {
        val uri = URI.create(url)
        "${uri.scheme}://${uri.host}${uri.path}"
    } catch (_: Exception) {
        url.take(80)
    }

    private fun redactHeaders(headers: Map<String, List<String>>): Map<String, String> =
        headers.entries.associate { (k, vs) ->
            val v = if (k.lowercase() in REDACTED_HEADER_NAMES) "[REDACTED]" else vs.firstOrNull() ?: ""
            k to v
        }

    private fun emitEvent(
        ctx: RuntimeContext,
        nodeId: String,
        type: EventType,
        status: String,
        title: String? = null,
        summary: String? = null,
        durationMs: Long? = null,
    ) = try {
        eventStore.appendEvent(RunEvent(
            runId         = ctx.runId,
            workspaceId   = ctx.workspaceId,
            environmentId = ctx.environmentId,
            type          = type,
            status        = status,
            stepId        = nodeId,
            title         = title,
            summary       = summary,
            durationMs    = durationMs,
        ))
    } catch (_: Exception) {}
}

/**
 * How a stored credential is presented, per connection.
 *
 * ── WHAT THE CONNECTION TEST PROVED IS WHAT RUNS ────────────────────────────
 * `api_key` was always sent as `x-api-key: <key>`, while the connection test
 * (`HttpTester.applyAuth` in the API) sends `Authorization: Bearer <key>` unless
 * the connection names another header. So a Slack bot token passed its test and
 * then failed every call with `not_authed`; GitHub, Notion, Airtable and HubSpot
 * the same. The rules are now the tester's:
 *
 *   · a header named on the connection (`authHeaderName`) wins — `Authorization`
 *     carries the key as Bearer, any other name carries it raw;
 *   · a SaaS provider whose API takes Bearer gets Bearer;
 *   · anything else keeps `x-api-key`, so a connection saved before either rule
 *     existed, against an API that wants that header, is not changed under it.
 */
internal fun authHeaderFor(
    authType: String,
    secret: String,
    provider: String,
    config: Map<String, Any?>,
): Pair<String, String> = when (authType.lowercase()) {
    "api_key" -> {
        val named = (config["authHeaderName"] as? String ?: config["apiKeyHeaderName"] as? String)
            ?.trim()?.takeIf { it.isNotEmpty() }
        when {
            named != null && named.equals("authorization", ignoreCase = true) -> "Authorization" to "Bearer $secret"
            named != null -> named to secret
            normaliseProvider(provider) in BEARER_PROVIDERS -> "Authorization" to "Bearer $secret"
            else -> "x-api-key" to secret
        }
    }
    "bearer", "jwt", "oauth2" -> "Authorization" to "Bearer $secret"
    "basic" -> {
        val user = config["username"] as? String ?: config["email"] as? String ?: ""
        "Authorization" to "Basic " + java.util.Base64.getEncoder().encodeToString("$user:$secret".toByteArray())
    }
    else -> "Authorization" to "Bearer $secret"
}

/** `google_sheets` and `google-sheets` are the same provider; the column carries both. */
internal fun normaliseProvider(provider: String): String = provider.trim().lowercase().replace('_', '-')

/** Providers whose API keys and tokens are Bearer credentials. Mirrors `SaasEndpoints`. */
internal val BEARER_PROVIDERS = setOf(
    "slack", "gmail", "google-sheets", "github", "notion", "airtable", "hubspot", "linear",
)

/** Headers a provider's API refuses to work without. Mirrors `SaasEndpoint.extraHeaders`. */
internal val PROVIDER_HEADERS: Map<String, Map<String, String>> = mapOf(
    "notion" to mapOf("Notion-Version" to "2022-06-28"),
)

/** `connections.auth_type` for a credential that is itself the destination URL. */
internal const val WEBHOOK_URL_AUTH = "webhook_url"

/**
 * Posting to incoming webhooks (Teams, Google Chat, Discord).
 *
 * Off by default, per the standing convention for new runtime behaviour. Off, a
 * webhook connection's call fails with a sentence naming this variable rather
 * than posting — nothing else about HTTP tools changes either way.
 */
internal val MESSAGING_WEBHOOKS_ENABLED: Boolean =
    System.getenv("MESSAGING_WEBHOOKS_ENABLED")?.lowercase() in setOf("true", "1", "yes")
