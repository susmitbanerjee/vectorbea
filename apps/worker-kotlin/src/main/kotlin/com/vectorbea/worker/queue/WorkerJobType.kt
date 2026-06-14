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
    SYSTEM,
}
