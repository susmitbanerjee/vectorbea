package com.vectorbea.api.http

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer as JdkHttpServer
import com.vectorbea.api.config.AppConfig
import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.errors.ErrorResponse
import org.slf4j.LoggerFactory
import java.net.InetSocketAddress
import java.util.UUID
import java.util.concurrent.Executors

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
        val start = System.currentTimeMillis()

        var response: Response? = null
        try {
            // Parse request (may throw ApiError.ValidationError for body-too-large)
            val request = Request.from(exchange, requestId, config.maxRequestBodyBytes)

            // OPTIONS preflight — answer without hitting the router
            response = if (request.method == "OPTIONS") {
                val allowed = router.allowedMethods(request.path)
                    .plus("OPTIONS").joinToString(", ")
                Response.options(allowed, corsHeaders(exchange))
            } else {
                router.dispatch(request).withHeaders(corsHeaders(exchange))
            }
        } catch (e: ApiError) {
            val requestIdFallback = response?.headers?.get("X-Request-Id") ?: requestId
            response = Response.fromApiError(e, requestIdFallback).withHeaders(corsHeaders(exchange))
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
        }

        send(exchange, response, requestId)
        log(exchange, response, requestId, start)
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
        // Log level based on status
        when {
            status >= 500 -> log.error("$method $path → $status [${duration}ms] [id=$requestId]")
            status >= 400 -> log.warn("$method $path → $status [${duration}ms] [id=$requestId]")
            else -> log.info("$method $path → $status [${duration}ms] [id=$requestId]")
        }
    }

    // ── CORS ─────────────────────────────────────────────────────────────────

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
            "Access-Control-Allow-Headers" to "Content-Type, Authorization, X-Request-Id, X-Workspace-Id",
            "Access-Control-Allow-Credentials" to "true",
            "Access-Control-Max-Age" to "86400",  // 24h preflight cache
        )
    }
}
