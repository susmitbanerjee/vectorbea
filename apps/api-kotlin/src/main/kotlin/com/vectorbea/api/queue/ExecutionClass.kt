package com.vectorbea.api.queue

/**
 * Which worker pool — and therefore which stream — a run belongs to.
 *
 * Materialised on `agent_runs.execution_class` at trigger time, so the worker
 * never has to read a message before it knows whether it can run it. The stream
 * name is derived here and nowhere else; both the API's enqueue path and the
 * worker's consumers agree because they agree on this enum.
 */
enum class ExecutionClass(val wire: String) {
    /** Simple, fast, deterministic workflows — the common case and the default. */
    SHORT("short"),

    /** Many nodes, external HTTP, tenant databases, large fan-out. */
    LONG("long"),

    /** Any LLM or AI-agent node. The scarce resource. */
    AGENT("agent"),

    /**
     * A dispatched child activation — §12.3.
     *
     * Its own lane for two reasons, and the first is the one that bites: a
     * supervisor parked on its children must not sit behind a cold backlog of new
     * top-level runs, because then the parent's latency is the queue's depth and a
     * team gets slower exactly when the platform is busy. The second is that child
     * work has a different duration profile, so mixing the two makes the
     * free-slot heuristic wrong for both.
     */
    AGENT_CHILD("agent.child"),

    /**
     * A run with a caller waiting — SSE attached, or a deadline set.
     *
     * What keeps a demo responsive while a batch of 500 drains. Nobody watching a
     * spinner cares that the queue is fair.
     */
    AGENT_INTERACTIVE("agent.interactive"),

    /** Timers, recovery and continuations — synthesized by the worker, never starved. */
    SYSTEM("system"),
    ;

    /** Redis stream key for this class. */
    val streamKey: String get() = "runs.$wire"

    /** Consumer group name for this class's stream. */
    val consumerGroup: String get() = "runs.$wire.workers"

    companion object {
        /**
         * Parse a persisted or wire value. Unknown and null values fall back to
         * [SHORT] rather than throwing: a run whose class cannot be read is
         * still a run that must execute, and the smallest pool claim is the safe
         * one. A misfiled short run costs throughput; a dropped run costs trust.
         */
        fun fromWire(value: String?): ExecutionClass =
            entries.firstOrNull { it.wire.equals(value?.trim(), ignoreCase = true) } ?: SHORT

        /** Every typed stream, in the order a fresh deployment should create groups. */
        val allStreams: List<String> get() = entries.map { it.streamKey }
    }
}
