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
object MdcKeys {
    const val SERVICE       = "service"
    const val REQUEST_ID    = "requestId"
    const val TRACE_ID      = "traceId"
    const val WORKSPACE_ID  = "workspaceId"
    const val ENVIRONMENT_ID = "environmentId"
    const val PATH          = "path"
    const val METHOD        = "method"
    const val RUN_ID        = "runId"
    const val WORKFLOW_ID   = "workflowId"
    const val NODE_ID       = "nodeId"
    const val WORKER_ID     = "workerId"
    const val JOB_TYPE      = "jobType"
    const val ERROR_CODE    = "errorCode"
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
