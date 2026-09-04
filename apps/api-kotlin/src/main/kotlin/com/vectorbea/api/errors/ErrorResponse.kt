package com.vectorbea.api.errors

/**
 * Wire format for all error responses.
 *
 * JSON shape:
 * ```json
 * {
 *   "error": {
 *     "code": "NOT_FOUND",
 *     "message": "Workflow not found",
 *     "requestId": "f3a2..."
 *   }
 * }
 * ```
 *
 * With machine-readable facts attached, for the errors a UI must render as
 * something richer than a toast:
 *
 * ```json
 * {
 *   "error": {
 *     "code": "WORKSPACE_CONCURRENCY_LIMIT",
 *     "message": "Workspace concurrency limit reached (8 concurrent runs). 12 runs queued.",
 *     "requestId": "f3a2...",
 *     "details": { "limit": 8, "active": 8, "queued": 12, "retryable": true }
 *   }
 * }
 * ```
 *
 * Stack traces, internal details, and secret values are NEVER included.
 */
data class ErrorResponse(val error: ErrorDetail) {
    data class ErrorDetail(
        val code: String,
        val message: String,
        val requestId: String,
        /**
         * Machine-readable facts behind the message. Omitted from the JSON when
         * empty, so every error that has nothing extra to say keeps the shape
         * clients already parse.
         */
        val details: Map<String, Any?>? = null,
    )

    companion object {
        fun of(code: String, message: String, requestId: String, details: Map<String, Any?> = emptyMap()) =
            ErrorResponse(ErrorDetail(
                code = code, message = message, requestId = requestId,
                details = details.takeIf { it.isNotEmpty() },
            ))

        fun fromApiError(err: ApiError, requestId: String) =
            of(code = err.code, message = err.message, requestId = requestId, details = err.details)

        /** 500 — never exposes cause in production */
        fun internalError(requestId: String, devMessage: String? = null) =
            ErrorResponse(
                ErrorDetail(
                    code = "INTERNAL_ERROR",
                    message = devMessage ?: "An internal error occurred",
                    requestId = requestId,
                )
            )
    }
}
