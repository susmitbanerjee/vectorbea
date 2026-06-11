package com.vectorbea.api.middleware

import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import org.slf4j.LoggerFactory

/**
 * Request/response logging middleware.
 *
 * Wrapped around the primary handler; logs:
 *   - HTTP method and path
 *   - Response status
 *   - Duration in ms
 *   - Request ID
 *
 * Logging is done in [HttpServer] directly (after response is sent) so that
 * status code is known. This file provides a composable standalone variant
 * for unit-testing the logging logic and for future use in a middleware chain.
 *
 * IMPORTANT: request/response bodies are NOT logged (may contain PII or secrets).
 * Authorization headers are NOT logged.
 */
object RequestLogging {
    private val log = LoggerFactory.getLogger("vectorbea.access")

    /** Wraps a handler with structured request/response logging. */
    fun wrap(handler: (Request) -> Response): (Request) -> Response = { request ->
        val start = System.currentTimeMillis()
        val response = handler(request)
        val duration = System.currentTimeMillis() - start
        log(request, response, duration)
        response
    }

    fun log(request: Request, response: Response, durationMs: Long) {
        val msg = "${request.method} ${request.path} → ${response.status} [${durationMs}ms] [id=${request.requestId}]"
        when {
            response.status >= 500 -> log.error(msg)
            response.status >= 400 -> log.warn(msg)
            else -> log.info(msg)
        }
    }
}
