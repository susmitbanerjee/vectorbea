package com.vectorbea.worker.queue

/**
 * Execution class of a worker job. Determines which bounded [ExecutionPoolRouter]
 * pool the job runs on and which tenant-fairness limits apply.
 *
 * The classes are intentionally coarse — the goal is isolation, not precision:
 *  - [SYSTEM] must never be starved (timer/approval resumes, cancellation, recovery).
 *  - [AGENT] / [LONG] are capacity-capped so they cannot consume [SHORT]/[SYSTEM] slots.
 *  - [SHORT] is the default for simple deterministic workflows.
 *
 * @see JobClassifier for how a [WorkflowRunJob] is mapped to one of these.
 */
enum class WorkerJobType {
    /** Simple, fast, deterministic workflows — the common case. */
    SHORT,

    /** Many nodes / external HTTP / batch / known-slow integrations. */
    LONG,

    /** Contains LLM, agent-loop, or tool-calling agent nodes. */
    AGENT,

    /** Internal/operational commands that must always have capacity. */
    SYSTEM;

    /** Lower-case wire form — the `execution_class` column and NOTIFY payload. */
    val label: String get() = name.lowercase()

    companion object {
        /**
         * Parse the stored/notified class. Unknown values fall back to [SHORT]
         * rather than throwing: a NOTIFY payload arrives from outside this
         * process, and an unparseable one must not kill the listener.
         */
        fun fromLabel(label: String?): WorkerJobType =
            entries.firstOrNull { it.label == label?.trim()?.lowercase() } ?: SHORT
    }
}
