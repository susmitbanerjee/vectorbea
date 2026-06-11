package com.vectorbea.telemetry.analytics

import com.vectorbea.telemetry.security.Redactor

/** Sanitizes incoming analytics events before storage. */
object AnalyticsSanitizer {
    fun sanitizeProperties(props: Map<String, Any?>, maxBytes: Int): Map<String, Any?> =
        Redactor.enforceSize(Redactor.redact(props), maxBytes)

    fun sanitizeContext(ctx: Map<String, Any?>): Map<String, Any?> =
        Redactor.redact(ctx)
}
