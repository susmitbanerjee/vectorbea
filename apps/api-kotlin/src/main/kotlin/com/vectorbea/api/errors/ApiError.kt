package com.vectorbea.api.errors

/**
 * Typed API errors.
 *
 * Every ApiError carries:
 *  - an HTTP status code
 *  - a machine-readable [code] (used in the JSON "error.code" field)
 *  - a human-readable [message] — NEVER contains internal details, secrets, or stack frames
 */
sealed class ApiError(
    val httpStatus: Int,
    val code: String,
    override val message: String,
) : Exception(message) {

    /** 400 — request body / parameter is invalid */
    class ValidationError(message: String) : ApiError(400, "VALIDATION_ERROR", message)

    /** 401 — missing or invalid credentials */
    class Unauthorized(message: String = "Authentication required") :
        ApiError(401, "UNAUTHORIZED", message)

    /** 403 — authenticated but not permitted */
    class Forbidden(message: String = "Access denied") :
        ApiError(403, "FORBIDDEN", message)

    /** 404 — resource does not exist */
    class NotFound(resource: String = "Resource") :
        ApiError(404, "NOT_FOUND", "$resource not found")

    /** 405 — HTTP method not supported for this route */
    class MethodNotAllowed(method: String, path: String) :
        ApiError(405, "METHOD_NOT_ALLOWED", "Method $method is not allowed on $path")

    /** 409 — conflict (duplicate key, version mismatch, etc.) */
    class Conflict(message: String) : ApiError(409, "CONFLICT", message)

    /** 422 — semantically invalid even though parseable */
    class UnprocessableEntity(message: String) :
        ApiError(422, "UNPROCESSABLE_ENTITY", message)

    /** 429 — too many requests */
    class TooManyRequests(message: String = "Rate limit exceeded") :
        ApiError(429, "TOO_MANY_REQUESTS", message)

    /** 500 — unexpected server error (message is generic in production) */
    class InternalError(message: String = "An internal error occurred") :
        ApiError(500, "INTERNAL_ERROR", message)

    /** 503 — service temporarily unavailable (e.g. DB not connected) */
    class ServiceUnavailable(message: String = "Service temporarily unavailable") :
        ApiError(503, "SERVICE_UNAVAILABLE", message)
}
