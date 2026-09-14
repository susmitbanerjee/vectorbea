package com.vectorbea.api.http

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer as JdkHttpServer
import com.vectorbea.api.auth.AuthMiddleware
import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.errors.ErrorResponse
import com.vectorbea.api.metrics.AppMetrics
import com.vectorbea.api.observability.MdcKeys
import com.vectorbea.api.observability.mdcClearAll
import org.slf4j.LoggerFactory
import org.slf4j.MDC
import java.io.IOException
import java.net.InetSocketAddress
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Thin wrapper around JDK's built-in [com.sun.net.httpserver.HttpServer].
 *
 * - Registers a single "/" context and fans all requests through [Router].
 * - Attaches CORS headers to every response.
 * - Handles OPTIONS preflight entirely (no handler needed).
 * - Logs every request via [requestLogging].
 * - Catches all exceptions and turns them into structured [ErrorResponse] JSON
 *   (stack traces never reach the wire).
 */
class HttpServer(
    private val config: AppConfig,
    private val router: Router,
    /** Null = auth disabled (no SUPABASE_URL configured, dev/local mode). */
    private val authMiddleware: AuthMiddleware? = null,
    /**
     * Per-caller request rate.
     *
     * Keyed on the authenticated principal. The spec calls this "per API key";
     * this codebase authenticates with Supabase JWTs and has no API-key concept
     * yet, so the app user is the closest true identity — and when API keys do
     * arrive, the key becomes the identity and nothing else here changes.
     *
     * Unauthenticated requests are not bucketed here: they have no stable
     * identity, and bucketing them by IP would rate-limit an entire office behind
     * one NAT. Auth failure is already the cheap rejection for those.
     */
    private val requestRateLimiter: com.vectorbea.api.rate.TokenBucket? = null,
) {
    private val log = LoggerFactory.getLogger(HttpServer::class.java)
    private lateinit var server: JdkHttpServer

    fun start() {
        server = JdkHttpServer.create(InetSocketAddress(config.port), /* backlog */ 128)
        // Single catch-all context — router handles path dispatch
        server.createContext("/", ::handleExchange)
        // Thread pool sized for concurrent requests; virtual threads (JDK 21) can be used later
        server.executor = Executors.newFixedThreadPool(Runtime.getRuntime().availableProcessors() * 2)
        server.start()
        log.info("vectorbea-api started on port ${config.port} [env=${config.appEnv}]")
    }

    fun stop(delaySeconds: Int = 2) {
        server.stop(delaySeconds)
        log.info("vectorbea-api stopped")
    }

    // ── Core exchange handler ─────────────────────────────────────────────────

    private fun handleExchange(exchange: HttpExchange) {
        val requestId = UUID.randomUUID().toString().replace("-", "").take(16)
        // Honour X-Trace-Id from upstream proxy/gateway; generate one if absent
        val traceId = exchange.requestHeaders.getFirst("X-Trace-Id")
            ?.takeIf { it.isNotBlank() }
            ?: UUID.randomUUID().toString().replace("-", "").take(24)
        val start = System.currentTimeMillis()

        // ── Set MDC context for the duration of this request ─────────────────
        MDC.put(MdcKeys.SERVICE, "api")
        MDC.put(MdcKeys.REQUEST_ID, requestId)
        MDC.put(MdcKeys.TRACE_ID, traceId)
        MDC.put(MdcKeys.METHOD, exchange.requestMethod)
        MDC.put(MdcKeys.PATH, exchange.requestURI.path)

        // Propagate workspace/environment from headers if present
        exchange.requestHeaders.getFirst("X-Workspace-Id")?.takeIf { it.isNotBlank() }
            ?.let { MDC.put(MdcKeys.WORKSPACE_ID, it) }
        exchange.requestHeaders.getFirst("X-Environment-Id")?.takeIf { it.isNotBlank() }
            ?.let { MDC.put(MdcKeys.ENVIRONMENT_ID, it) }

        // The root span for the whole path. Everything downstream — the enqueue, the
        // claim in another process, each node, each tool call — hangs off this one, so
        // a single trace answers "what happened when the user pressed Run".
        //
        // Started here rather than after routing so a request rejected by auth or the
        // rate limiter still produces a span. The rejected ones are the interesting
        // ones during an incident, and instrumenting only the happy path is how you end
        // up with a trace view that looks healthy while users cannot log in.
        //
        // The span's own trace id replaces the locally-generated one in MDC when
        // tracing is live, so a log line and a trace agree on the identifier. With
        // tracing off, the locally-generated id stays — it is still useful for
        // correlating one request's log lines with each other.
        val span = com.vectorbea.observability.tracing.Tracing.tracer()
            .spanBuilder("${exchange.requestMethod} ${exchange.requestURI.path}")
            .setSpanKind(io.opentelemetry.api.trace.SpanKind.SERVER)
            .setAttribute("http.request.method", exchange.requestMethod)
            .setAttribute("url.path", exchange.requestURI.path)
            .startSpan()
        span.spanContext.takeIf { it.isValid }?.let {
            MDC.put(MdcKeys.TRACE_ID, it.traceId)
            MDC.put(MdcKeys.SPAN_ID, it.spanId)
        }

        var response: Response? = null
        try {
            // The public API hostname serves the run API and nothing else. Checked
            // before the body is read or anybody is authenticated: a route that is
            // not published on this host should cost nothing to refuse.
            val hostHeaders = listOfNotNull(
                exchange.requestHeaders["Host"],
                exchange.requestHeaders["X-Forwarded-Host"],
            ).flatten()
            if (!PublicHostGate.allows(exchange.requestMethod, exchange.requestURI.path ?: "/", hostHeaders)) {
                throw ApiError.NotFound("Route")
            }

            // Parse request (may throw ApiError.ValidationError for body-too-large)
            val rawRequest = Request.from(exchange, requestId, config.maxRequestBodyBytes)

            // OPTIONS preflight MUST bypass auth — browsers never send credentials
            // on preflight requests, so auth middleware would always return 401.
            if (rawRequest.method == "OPTIONS") {
                val allowed = router.allowedMethods(rawRequest.path)
                    .plus("OPTIONS").joinToString(", ")
                response = Response.options(allowed, corsHeaders(exchange))
            } else {
                // Apply authentication before routing for all non-OPTIONS requests.
                val request = authMiddleware?.authenticate(rawRequest) ?: rawRequest

                // Rate limit after authentication, before routing. After, because
                // the bucket is keyed on identity; before, because the whole point
                // is to reject without doing the work.
                enforceRequestRate(request)

                // Check for SSE route before normal dispatch
                val sseMatch = router.findSseRoute(request)
                if (sseMatch != null) {
                    val (sseRoute, params) = sseMatch
                    val enrichedRequest = request.copy(pathParams = params)
                    handleSseExchange(exchange, enrichedRequest, requestId, sseRoute.handler)
                    // SSE handler owns the exchange — return without calling send()
                    return
                }
                response = router.dispatch(request).withHeaders(corsHeaders(exchange))
            }
        } catch (e: ApiError) {
            val requestIdFallback = response?.headers?.get("X-Request-Id") ?: requestId
            response = Response.fromApiError(e, requestIdFallback)
                .withHeaders(corsHeaders(exchange))
                .withHeaders(retryAfterHeader(e))
        } catch (e: Exception) {
            log.error("Unhandled exception [requestId=$requestId]", e)
            val msg = if (config.isProduction) null else e.message
            response = Response(
                status = 500,
                body = toJson(ErrorResponse.internalError(requestId, if (config.isProduction) null else msg)),
                headers = mapOf(
                    "Content-Type" to "application/json; charset=utf-8",
                ) + corsHeaders(exchange),
            )
        } finally {
            // The SSE branch above `return`s from inside the try, so the span MUST be
            // ended here rather than after `send`. Ending it only on the normal path
            // would leak one span per SSE connection — unbounded, and invisible until
            // the exporter's queue starts dropping.
            //
            // A streaming response has no single status code at this point, so the
            // attribute is simply absent rather than guessed.
            response?.let {
                span.setAttribute("http.response.status_code", it.status.toLong())
                if (it.status >= 500) {
                    span.setStatus(io.opentelemetry.api.trace.StatusCode.ERROR)
                }
            }
            span.end()
        }

        send(exchange, response, requestId)
        log(exchange, response, requestId, start)
        mdcClearAll()
    }

    private fun send(exchange: HttpExchange, response: Response, requestId: String) {
        try {
            // Always add request ID to response
            exchange.responseHeaders.add("X-Request-Id", requestId)
            response.headers.forEach { (k, v) -> exchange.responseHeaders.add(k, v) }

            val bodyBytes = if (response.status == 204 || response.body.isEmpty()) {
                ByteArray(0)
            } else {
                response.body.toByteArray(Charsets.UTF_8)
            }

            exchange.sendResponseHeaders(response.status, if (bodyBytes.isEmpty()) -1 else bodyBytes.size.toLong())
            if (bodyBytes.isNotEmpty()) {
                exchange.responseBody.use { it.write(bodyBytes) }
            }
        } catch (e: Exception) {
            // Socket may have closed; log and move on
            log.debug("Failed to send response [requestId=$requestId]: ${e.message}")
        } finally {
            exchange.close()
        }
    }

    private fun log(exchange: HttpExchange, response: Response?, requestId: String, startMs: Long) {
        val duration = System.currentTimeMillis() - startMs
        val status = response?.status ?: 0
        val method = exchange.requestMethod
        val path = exchange.requestURI.path
        val pathPattern = AppMetrics.normalisePath(path)

        // Record metrics — labels use normalised path to bound cardinality
        AppMetrics.requestCount.inc(method, AppMetrics.statusClass(status), pathPattern)
        AppMetrics.requestDuration.observe(duration, method, pathPattern)

        // Structured log — MDC already holds requestId/traceId/workspaceId
        val msg = "$method $path → $status [${duration}ms]"
        when {
            status >= 500 -> log.error(msg)
            status >= 400 -> log.warn(msg)
            else          -> log.info(msg)
        }
    }

    // ── SSE streaming ─────────────────────────────────────────────────────────

    /**
     * Handles a Server-Sent Events exchange.
     * Sends SSE headers, then delegates to [handler] which may block the calling thread
     * while the connection stays open.  The exchange is closed when [handler] returns.
     *
     * The emitter returned to the handler is backed by the raw [HttpExchange] output stream.
     * Writing to a closed stream throws [IOException] which the handler should treat as
     * client disconnect.
     */
    private fun handleSseExchange(
        exchange: HttpExchange,
        request: Request,
        requestId: String,
        handler: (Request, Router.SseEmitter) -> Unit,
    ) {
        // Add CORS + request-id headers before sending response headers
        corsHeaders(exchange).forEach { (k, v) -> exchange.responseHeaders.add(k, v) }
        exchange.responseHeaders.add("X-Request-Id", requestId)
        exchange.responseHeaders.set("Content-Type", "text/event-stream; charset=utf-8")
        exchange.responseHeaders.set("Cache-Control", "no-cache, no-transform")
        exchange.responseHeaders.set("Connection", "keep-alive")
        exchange.responseHeaders.set("X-Accel-Buffering", "no")

        try {
            // 0 = unknown/chunked length → stream until close
            exchange.sendResponseHeaders(200, 0)
        } catch (e: Exception) {
            log.debug("Failed to send SSE headers [requestId=$requestId]: ${e.message}")
            exchange.close()
            return
        }

        val out = exchange.responseBody
        val connected = AtomicBoolean(true)

        val emitter = object : Router.SseEmitter {
            override fun sendEvent(eventType: String, data: String): Boolean {
                if (!connected.get()) return false
                return try {
                    out.write("event: $eventType\ndata: $data\n\n".toByteArray(Charsets.UTF_8))
                    out.flush()
                    true
                } catch (_: IOException) {
                    connected.set(false)
                    false
                }
            }

            override fun sendComment(comment: String): Boolean {
                if (!connected.get()) return false
                return try {
                    out.write(": $comment\n\n".toByteArray(Charsets.UTF_8))
                    out.flush()
                    true
                } catch (_: IOException) {
                    connected.set(false)
                    false
                }
            }

            override fun isConnected(): Boolean = connected.get()
        }

        val start = System.currentTimeMillis()
        try {
            handler(request, emitter)
        } catch (e: ApiError) {
            // Too late to change HTTP status — just log and close
            log.debug("SSE handler ApiError [requestId=$requestId]: ${e.message}")
        } catch (e: Exception) {
            if (connected.get()) {
                log.error("SSE handler error [requestId=$requestId]", e)
            }
            // else: IOException from client disconnect — expected, no need to log
        } finally {
            connected.set(false)
            try { out.close() } catch (_: Exception) {}
            exchange.close()
            val duration = System.currentTimeMillis() - start
            log.info("SSE ${request.path} closed [${duration}ms] [id=$requestId]")
        }
    }

    // ── CORS ─────────────────────────────────────────────────────────────────

    private companion object {
        /**
         * Per-caller API request rate.
         *
         * Deliberately far above the run-creation rate: reading runs, polling a
         * status, and streaming events are cheap and a busy dashboard legitimately
         * makes many of them. This exists to stop a runaway client, not to shape
         * normal usage.
         */
        val REQUESTS_PER_MINUTE = System.getenv("API_REQUESTS_PER_MINUTE")?.toIntOrNull() ?: 600
        val REQUESTS_BURST = System.getenv("API_REQUESTS_BURST")?.toIntOrNull() ?: 1_200
    }

    /**
     * Per-caller request rate, enforced before any routing work happens.
     *
     * Throws [ApiError.TooManyRequests] so the existing error path renders it —
     * structured body, request id, and (via [retryAfterHeader]) a `Retry-After`
     * a well-behaved client will honour without being told.
     */
    private fun enforceRequestRate(request: Request) {
        val bucket = requestRateLimiter ?: return

        /*
         * ── THE BUCKET IS PER KEY, NOT PER USER ─────────────────────────────
         * Keyed on the user, two integrations sharing a service account shared
         * one budget: a runaway sync job consumed the throughput of the
         * dashboard, the CI job and the key an operator was using to look into
         * it. A key gets its own bucket so a misbehaving one starves only itself.
         *
         * Falls back to the user for a browser session, which has no key and for
         * which the person IS the right unit.
         */
        val caller = request.apiKeyId?.let { "key:$it" }
            ?: request.principal?.appUserId?.let { "req:$it" }
            ?: return

        /* A key's own ceiling when it set one, clamped to the platform's on the
           way in (see ApiKeyService.setRateLimit) so this cannot be a way to buy
           more throughput. The burst scales with it rather than staying at the
           platform's, or a key limited to 10/min would still be allowed a
           1,200-request spike. */
        val perMinute = request.apiKeyRateLimit ?: REQUESTS_PER_MINUTE
        val burst = if (request.apiKeyRateLimit != null) (perMinute * 2).coerceAtLeast(1)
                    else REQUESTS_BURST

        val verdict = bucket.tryConsume(
            key = caller,
            refillPerMinute = perMinute,
            burst = burst,
        )
        if (!verdict.allowed) {
            throw ApiError.TooManyRequests(
                "Too many requests. The limit is $perMinute per minute; " +
                    "retry in ${verdict.retryAfterSeconds}s.",
                mapOf(
                    "limitPerMinute" to perMinute,
                    "burst" to burst,
                    "retryAfterSeconds" to verdict.retryAfterSeconds,
                    "retryable" to true,
                ),
            )
        }
    }

    /**
     * `Retry-After` for any error that carries a retry hint.
     *
     * A 429 without one tells a client to back off and leaves it to guess how
     * long — and clients guess badly, usually by retrying immediately. Reading it
     * off `details` means every error that knows its own retry interval gets the
     * header for free, without each throw site remembering to set it.
     */
    private fun retryAfterHeader(e: ApiError): Map<String, String> =
        (e.details["retryAfterSeconds"] as? Int)
            ?.let { mapOf("Retry-After" to it.toString()) }
            ?: emptyMap()

    private fun corsHeaders(exchange: HttpExchange): Map<String, String> {
        val origin = exchange.requestHeaders.getFirst("Origin") ?: return emptyMap()
        val allowed = config.corsAllowedOrigins

        // Exact match or wildcard
        val effectiveOrigin = when {
            "*" in allowed -> "*"
            origin in allowed -> origin
            else -> return emptyMap()  // Origin not in allowlist — no CORS headers added
        }

        return mapOf(
            "Access-Control-Allow-Origin" to effectiveOrigin,
            "Access-Control-Allow-Methods" to "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers" to "Content-Type, Authorization, X-Request-Id, X-Workspace-Id, X-Environment-Id",
            "Access-Control-Allow-Credentials" to "true",
            "Access-Control-Max-Age" to "86400",  // 24h preflight cache
        )
    }
}
