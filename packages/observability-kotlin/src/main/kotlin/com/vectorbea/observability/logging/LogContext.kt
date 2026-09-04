package com.vectorbea.observability.logging

import org.slf4j.MDC

/**
 * The fields every log line inside a run execution carries.
 *
 * WHY MDC AND NOT AN EXPLICIT PARAMETER
 * -------------------------------------
 * The requirement is that EVERY line emitted during a node's execution carries
 * `run_id` and `node_id` - including lines from code that has no idea it is inside a
 * run: the HTTP client, the JDBC wrapper, a third-party library. Threading a context
 * object through every call site reaches only the code you own and remember to change,
 * which is the subset guaranteed to be well-behaved anyway. The lines you actually
 * want during an incident come from the code you did not think about.
 *
 * MDC is thread-local, so it reaches all of it.
 *
 * COROUTINES
 * ----------
 * The worker runs nodes on coroutines, which move between threads. A thread-local set
 * on dispatch is therefore NOT automatically present after a suspension point. The
 * worker installs `MDCContext` from kotlinx-coroutines-slf4j as part of its context so
 * the map travels with the coroutine; [scoped] below is the non-suspending equivalent
 * for the API and for worker code outside a coroutine.
 *
 * Getting this wrong fails quietly - the log line simply lacks a run_id, and you do
 * not notice until you are filtering by one - so `WorkerContextTest` asserts that a
 * line emitted after a suspension point still carries its run.
 */
object LogContext {

    const val SERVICE = "service"
    const val WORKER_ID = "worker_id"
    const val RUN_ID = "run_id"
    const val NODE_ID = "node_id"
    const val WORKSPACE_ID = "workspace_id"
    const val ENVIRONMENT_ID = "environment_id"
    const val TRACE_ID = "trace_id"
    const val SPAN_ID = "span_id"

    /** Keys that belong in the envelope rather than in `fields`. */
    val ENVELOPE_KEYS = setOf(
        SERVICE, WORKER_ID, RUN_ID, NODE_ID, WORKSPACE_ID, ENVIRONMENT_ID, TRACE_ID, SPAN_ID,
    )

    /**
     * Process-wide identity. Set once at startup; never cleared, because a line emitted
     * during shutdown still needs to say which service produced it.
     */
    fun identify(service: String, workerId: String? = null) {
        MDC.put(SERVICE, service)
        workerId?.let { MDC.put(WORKER_ID, it) }
    }

    fun put(key: String, value: String?) {
        if (value == null) MDC.remove(key) else MDC.put(key, value)
    }

    fun get(key: String): String? = MDC.get(key)

    /**
     * Run the block with these fields set, restoring whatever was there before.
     *
     * Restores rather than clears, deliberately: a node executing inside a run must not
     * strip the run_id from the lines emitted after it returns. Clearing looks correct
     * in a unit test with one level of nesting and loses context in production, where
     * there are three.
     */
    fun <T> scoped(vararg fields: Pair<String, String?>, block: () -> T): T {
        val previous = fields.map { (k, _) -> k to MDC.get(k) }
        fields.forEach { (k, v) -> put(k, v) }
        return try {
            block()
        } finally {
            previous.forEach { (k, v) -> put(k, v) }
        }
    }

    /** The current context as a plain map — what the coroutine bridge copies. */
    fun snapshot(): Map<String, String> = MDC.getCopyOfContextMap() ?: emptyMap()

    fun restore(map: Map<String, String>?) {
        MDC.clear()
        map?.forEach { (k, v) -> MDC.put(k, v) }
    }

    /** Everything except the process identity — cleared between jobs. */
    fun clearRequestScope() {
        listOf(RUN_ID, NODE_ID, WORKSPACE_ID, ENVIRONMENT_ID, TRACE_ID, SPAN_ID).forEach(MDC::remove)
    }
}
