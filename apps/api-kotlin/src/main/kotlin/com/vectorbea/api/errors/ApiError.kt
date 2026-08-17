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
    /**
     * Machine-readable facts behind the message, for a UI that has to render
     * something better than the sentence.
     *
     * "Workspace concurrency limit reached" is a toast. `{limit: 8, active: 8,
     * queued: 12}` is a progress bar, a queue position, and an upgrade prompt
     * that names the right number. The message stays authoritative — details
     * never contradict it — but a client that understands the code can do more
     * than print it.
     *
     * Values must be JSON primitives or maps of them. Never anything derived
     * from a secret, a connection string, or an internal identifier the caller
     * does not already own.
     */
    val details: Map<String, Any?> = emptyMap(),
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
    class TooManyRequests(
        message: String = "Rate limit exceeded",
        details: Map<String, Any?> = emptyMap(),
    ) : ApiError(429, "TOO_MANY_REQUESTS", message, details)

    /**
     * 429 — the workspace is at its own concurrency ceiling.
     *
     * Distinct from [TooManyRequests] on purpose. Rate limiting is "you asked too
     * fast"; this is "you have too much running", and the fix is different: wait
     * for your own runs to finish, or raise the plan. Giving them the same code
     * would make the UI unable to tell a customer which.
     */
    class WorkspaceConcurrencyLimit(
        limit: Int, active: Int, queued: Int,
    ) : ApiError(
        429, "WORKSPACE_CONCURRENCY_LIMIT",
        "Workspace concurrency limit reached ($limit concurrent runs). $queued runs queued.",
        mapOf("limit" to limit, "active" to active, "queued" to queued, "retryable" to true),
    )

    /**
     * 503 — the platform is shedding load, and this request is not in the
     * priority lane.
     *
     * A 503 rather than a 429: nothing about *this* caller is wrong, and a 429
     * would tell them to slow down when slowing down is not the remedy.
     */
    class QueueSaturated(
        globalDepth: Int, threshold: Int,
    ) : ApiError(
        503, "QUEUE_SATURATED",
        "The platform is at capacity ($globalDepth runs queued). Your run was not accepted — " +
            "please retry shortly.",
        mapOf("globalDepth" to globalDepth, "threshold" to threshold, "retryable" to true),
    )

    /** 500 — unexpected server error (message is generic in production) */
    class InternalError(message: String = "An internal error occurred") :
        ApiError(500, "INTERNAL_ERROR", message)

    /** 503 — service temporarily unavailable (e.g. DB not connected) */
    class ServiceUnavailable(message: String = "Service temporarily unavailable") :
        ApiError(503, "SERVICE_UNAVAILABLE", message)
}
