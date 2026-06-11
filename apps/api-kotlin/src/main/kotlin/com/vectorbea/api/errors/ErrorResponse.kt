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
 * Stack traces, internal details, and secret values are NEVER included.
 */
data class ErrorResponse(val error: ErrorDetail) {
    data class ErrorDetail(
        val code: String,
        val message: String,
        val requestId: String,
    )

    companion object {
        fun of(code: String, message: String, requestId: String) =
            ErrorResponse(ErrorDetail(code = code, message = message, requestId = requestId))

        fun fromApiError(err: ApiError, requestId: String) =
            of(code = err.code, message = err.message, requestId = requestId)

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
