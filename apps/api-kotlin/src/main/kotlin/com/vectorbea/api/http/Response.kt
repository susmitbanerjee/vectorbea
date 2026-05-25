package com.vectorbea.api.http

import com.vectorbea.api.errors.ApiError
import com.vectorbea.api.errors.ErrorResponse

/**
 * Immutable HTTP response.
 *
 * Factory methods for the common cases are provided so handlers stay concise:
 *
 * ```kotlin
 * return Response.ok(mapOf("status" to "ok"))
 * return Response.notFound("Workflow")
 * return Response.noContent()
 * ```
 */
data class Response(
    val status: Int,
    val body: String,
    val headers: Map<String, String> = emptyMap(),
) {
    companion object {
        private val JSON_CONTENT_TYPE = "application/json; charset=utf-8"

        // ── Success ───────────────────────────────────────────────────────────

        fun ok(body: Any): Response = json(200, body)

        fun created(body: Any): Response = json(201, body)

        fun accepted(body: Any): Response = json(202, body)

        fun noContent(): Response = Response(status = 204, body = "")

        // ── Client errors ─────────────────────────────────────────────────────

        fun badRequest(message: String, requestId: String): Response =
            errorResponse(400, "BAD_REQUEST", message, requestId)

        fun notFound(resource: String = "Resource", requestId: String = ""): Response =
            errorResponse(404, "NOT_FOUND", "$resource not found", requestId)

        fun methodNotAllowed(method: String, path: String, requestId: String): Response =
            errorResponse(405, "METHOD_NOT_ALLOWED", "Method $method is not allowed on $path", requestId)

        // ── Server errors ─────────────────────────────────────────────────────

        fun internalError(requestId: String): Response =
            errorResponse(500, "INTERNAL_ERROR", "An internal error occurred", requestId)

        // ── From typed ApiError ───────────────────────────────────────────────

        fun fromApiError(err: ApiError, requestId: String): Response =
            json(err.httpStatus, ErrorResponse.fromApiError(err, requestId))

        // ── Primitive builders ────────────────────────────────────────────────

        fun json(status: Int, body: Any): Response = Response(
            status = status,
            body = toJson(body),
            headers = mapOf("Content-Type" to JSON_CONTENT_TYPE),
        )

        private fun errorResponse(status: Int, code: String, message: String, requestId: String): Response =
            json(status, ErrorResponse.of(code = code, message = message, requestId = requestId))

        // ── OPTIONS / CORS pre-flight ─────────────────────────────────────────

        fun options(allowedMethods: String, corsHeaders: Map<String, String>): Response = Response(
            status = 204,
            body = "",
            headers = corsHeaders + mapOf("Allow" to allowedMethods),
        )
    }

    fun withHeader(name: String, value: String): Response =
        copy(headers = headers + (name to value))

    fun withHeaders(extra: Map<String, String>): Response =
        copy(headers = headers + extra)
}
