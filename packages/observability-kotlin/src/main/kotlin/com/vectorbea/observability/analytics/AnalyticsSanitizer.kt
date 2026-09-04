package com.vectorbea.observability.analytics

import com.vectorbea.observability.security.Redactor

/** Sanitizes incoming analytics events before storage. */
object AnalyticsSanitizer {
    fun sanitizeProperties(props: Map<String, Any?>, maxBytes: Int): Map<String, Any?> =
        Redactor.enforceSize(Redactor.redact(props), maxBytes)

    fun sanitizeContext(ctx: Map<String, Any?>): Map<String, Any?> =
        Redactor.redact(ctx)
}
