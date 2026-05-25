package com.vectorbea.api.middleware

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.errors.ErrorResponse
import com.vectorbea.api.http.Request
import com.vectorbea.api.http.Response
import com.vectorbea.api.http.toJson
import org.slf4j.LoggerFactory

/**
 * Error-handling middleware.
 *
 * Converts any exception thrown by a handler into a structured [ErrorResponse]:
 *
 *  - [ApiError] subtypes → their declared HTTP status + typed error code
 *  - Any other [Exception] → 500, with a generic message (stack trace logged server-side ONLY)
 *
 * Stack traces are NEVER serialized into the HTTP response.
 * In production, the "message" for 500s is always generic.
 */
class ErrorHandler(private val isProduction: Boolean) {
    private val log = LoggerFactory.getLogger(ErrorHandler::class.java)

    fun wrap(handler: (Request) -> Response): (Request) -> Response = { request ->
        try {
            handler(request)
        } catch (e: ApiError) {
            // Known domain error — use typed code and message
            Response.fromApiError(e, request.requestId)
        } catch (e: Exception) {
            // Unexpected error — log with full stack trace, respond with generic message
            log.error("Unhandled exception [requestId=${request.requestId}] ${request.method} ${request.path}", e)
            val message = if (isProduction) "An internal error occurred" else (e.message ?: "Unknown error")
            Response(
                status = 500,
                body = toJson(ErrorResponse.internalError(request.requestId, message)),
                headers = mapOf("Content-Type" to "application/json; charset=utf-8"),
            )
        }
    }
}
