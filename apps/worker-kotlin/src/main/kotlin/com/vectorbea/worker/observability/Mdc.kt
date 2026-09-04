package com.vectorbea.worker.observability

import org.slf4j.MDC

/**
 * MDC (Mapped Diagnostic Context) key constants and helpers for the worker.
 *
 * MDC values are thread-local and automatically included in every log
 * line by [JsonLayout]. Set them at the start of a job and clear them
 * at the end via [withMdc] or manual [mdcClearAll].
 *
 * Keys are short and consistent with the API service so log-aggregation
 * filters work uniformly across both services.
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
    const val JOB_TYPE       = "job_type"
    const val WORKFLOW_ID    = "workflow_id"
    const val ERROR_CODE     = "error_code"
    const val CORRELATION_ID = "correlation_id"
}

/**
 * Execute [block] with the given MDC fields set, then restore any previous values.
 *
 * Usage:
 * ```kotlin
 * withMdc(
 *     MdcKeys.RUN_ID     to runId.toString(),
 *     MdcKeys.JOB_TYPE   to jobType,
 * ) {
 *     process(job)
 * }
 * ```
 */
inline fun <T> withMdc(vararg entries: Pair<String, String?>, block: () -> T): T {
    val previous = entries.mapNotNull { (k, _) ->
        val prev = MDC.get(k)
        if (prev != null) k to prev else null
    }.toMap()

    for ((k, v) in entries) {
        if (v != null) MDC.put(k, v) else MDC.remove(k)
    }

    return try {
        block()
    } finally {
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

/** Clear all MDC keys managed by the worker (safe to call at end of job). */
fun mdcClearAll() {
    with(MdcKeys) {
        listOf(SERVICE, WORKER_ID, RUN_ID, WORKFLOW_ID, NODE_ID, JOB_TYPE,
               WORKSPACE_ID, ENVIRONMENT_ID, ERROR_CODE, TRACE_ID, CORRELATION_ID)
    }.forEach { MDC.remove(it) }
}
