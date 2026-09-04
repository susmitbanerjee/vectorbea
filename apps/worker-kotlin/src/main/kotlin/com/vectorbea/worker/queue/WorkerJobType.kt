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

    /**
     * A dispatched child activation. §12.3.
     *
     * Its own lane, its own pool and — because `Main` maps over [entries] — its
     * own consumer with its own dedicated Redis connection. That last part is not
     * incidental: `XREADGROUP BLOCK` holds a connection for the whole block
     * window, so lanes sharing one connection would serialise behind whichever
     * happened to be waiting, and a child lane that cannot be read while the
     * agent lane blocks is worse than no child lane at all.
     */
    AGENT_CHILD,

    /** A run with a caller waiting. Keeps a demo responsive while a batch drains. */
    AGENT_INTERACTIVE,

    /** Internal/operational commands that must always have capacity. */
    SYSTEM;

    /**
     * Lower-case wire form — the `execution_class` column and NOTIFY payload.
     *
     * The underscore becomes a DOT, so `AGENT_CHILD` is `agent.child` and the
     * stream is `runs.agent.child`, exactly as §12.3 names it. One translation,
     * here, because the API's `ExecutionClass` and this enum have to agree about
     * the string or a job is written to a stream nobody reads.
     */
    val label: String get() = name.lowercase().replace('_', '.')

    /** True for the three lanes that carry agent work of some kind. */
    val isAgentic: Boolean get() = this == AGENT || this == AGENT_CHILD || this == AGENT_INTERACTIVE

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
