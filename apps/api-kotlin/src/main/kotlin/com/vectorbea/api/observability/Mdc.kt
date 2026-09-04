package com.vectorbea.api.observability

import org.slf4j.MDC

/**
 * MDC (Mapped Diagnostic Context) key constants and helpers.
 *
 * MDC values are thread-local and automatically included in every log
 * line by [JsonLayout]. Set them at the start of a request or job and
 * clear them at the end via [withMdc] (or manual [clear]).
 *
 * Keys are short and consistent across api and worker so log-aggregation
 * filters work uniformly.
 *
 * SECURITY: Never put secret values, connection strings, or API keys into MDC.
 * MDC values appear in every log line for the duration they are set.
 */
/**
 * Envelope keys, delegating to the shared library.
 *
 * These were camelCase (`runId`, `nodeId`) and defined twice, once per service. They
 * are now snake_case and defined once, in `LogContext`, because:
 *
 *  - Loki, Prometheus and the OpenTelemetry conventions are all snake_case, and a
 *    mixed-case envelope means every query is a guess about which convention won.
 *  - Two definitions of "what the run id field is called" is one definition too many.
 *    They agreed today by inspection, not by construction.
 *
 * THIS BREAKS EXISTING LOG QUERIES. A saved Loki query for `runId` finds nothing after
 * this deploy; it wants `run_id`. That is called out in docs/architecture/OBSERVABILITY.md
 * rather than softened with a transition period emitting both, which would double the
 * envelope size forever to spare one search-and-replace.
 *
 * The constant names are unchanged, so every `MDC.put(MdcKeys.RUN_ID, ...)` call site
 * keeps working and starts writing the new key.
 */
object MdcKeys {
    // Envelope keys — shared with the API/worker peer and with the log encoder.
    const val SERVICE        = com.vectorbea.observability.logging.LogContext.SERVICE
    const val WORKER_ID      = com.vectorbea.observability.logging.LogContext.WORKER_ID
    const val RUN_ID         = com.vectorbea.observability.logging.LogContext.RUN_ID
    const val NODE_ID        = com.vectorbea.observability.logging.LogContext.NODE_ID
    const val WORKSPACE_ID   = com.vectorbea.observability.logging.LogContext.WORKSPACE_ID
    const val ENVIRONMENT_ID = com.vectorbea.observability.logging.LogContext.ENVIRONMENT_ID
    const val TRACE_ID       = com.vectorbea.observability.logging.LogContext.TRACE_ID
    const val SPAN_ID        = com.vectorbea.observability.logging.LogContext.SPAN_ID

    // Service-local keys — these land in the `fields` sub-object, not the envelope.
    const val REQUEST_ID     = "request_id"
    const val PATH           = "path"
    const val METHOD         = "method"
    const val JOB_TYPE       = "job_type"
    const val WORKFLOW_ID    = "workflow_id"
    const val ERROR_CODE     = "error_code"
}

/**
 * Execute [block] with the given MDC fields set, then clear them.
 * Restores any previously set values for the same keys on exit.
 *
 * Usage:
 * ```kotlin
 * withMdc(
 *     MdcKeys.REQUEST_ID to requestId,
 *     MdcKeys.TRACE_ID   to traceId,
 * ) {
 *     handler(request)
 * }
 * ```
 */
inline fun <T> withMdc(vararg entries: Pair<String, String?>, block: () -> T): T {
    // Save previous values
    val previous = entries.mapNotNull { (k, _) ->
        val prev = MDC.get(k)
        if (prev != null) k to prev else null
    }.toMap()

    // Set new values (skip nulls)
    for ((k, v) in entries) {
        if (v != null) MDC.put(k, v) else MDC.remove(k)
    }

    return try {
        block()
    } finally {
        // Restore: put back previous values, remove keys that had no prior value
        for ((k, _) in entries) {
            val prev = previous[k]
            if (prev != null) MDC.put(k, prev) else MDC.remove(k)
        }
    }
}

/** Set a single MDC key. Returns the previous value (for manual restore). */
fun mdcSet(key: String, value: String): String? {
    val prev = MDC.get(key)
    MDC.put(key, value)
    return prev
}

/** Remove a single MDC key. */
fun mdcClear(key: String) = MDC.remove(key)

/** Clear all MDC keys set by Vectorbea (safe to call at end of request/job). */
fun mdcClearAll() {
    with(MdcKeys) {
        listOf(SERVICE, REQUEST_ID, TRACE_ID, WORKSPACE_ID, ENVIRONMENT_ID,
               PATH, METHOD, RUN_ID, WORKFLOW_ID, NODE_ID, WORKER_ID, JOB_TYPE, ERROR_CODE)
    }.forEach { MDC.remove(it) }
}
