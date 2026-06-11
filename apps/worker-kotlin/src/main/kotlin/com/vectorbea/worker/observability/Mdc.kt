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
object MdcKeys {
    const val SERVICE        = "service"
    const val WORKER_ID      = "workerId"
    const val RUN_ID         = "runId"
    const val WORKFLOW_ID    = "workflowId"
    const val NODE_ID        = "nodeId"
    const val JOB_TYPE       = "jobType"
    const val WORKSPACE_ID   = "workspaceId"
    const val ENVIRONMENT_ID = "environmentId"
    const val ERROR_CODE     = "errorCode"
    const val TRACE_ID       = "traceId"
    const val CORRELATION_ID = "correlationId"
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
