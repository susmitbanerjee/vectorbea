package com.vectorbea.worker.events

import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong

/**
 * The per-run bookkeeping that turns individual span writes into a tree.
 *
 * [SpanWriter] knows how to persist a span. This knows which span is the parent of
 * which, and how long a span spent in its own work rather than its children. One
 * instance per run execution, hung off `RuntimeContext`.
 *
 * WHY A REGISTRY KEYED BY NODE ID
 * -------------------------------
 * The parent of a `tool_call` is the `step` that dispatched it, and the executor
 * that makes the tool call receives a `WorkflowNode` but no span. Threading a span
 * parameter down would mean changing `NodeExecutor.execute`, which fifteen classes
 * implement. Instead `WorkflowRuntime` registers `nodeId -> spanId` when it opens
 * the step span, and executors look their parent up by the node id they already
 * hold.
 *
 * Race-free under parallel branches because node ids are distinct — including the
 * agent's synthetic `<stepId>:tool:<toolId>` ids — and it works across threads and
 * coroutine suspension, which a ThreadLocal would not.
 *
 * ITS SIZE IS BOUNDED BY THE GRAPH, AND ENTRIES ARE EVICTED
 * --------------------------------------------------------
 * One entry per node executed in this tick, so the ceiling is the node count of a
 * single workflow — small, and fixed at version time. Entries are dropped as each
 * step closes anyway, so the map tracks in-flight work rather than history.
 *
 * That bound stops holding in P6. Activation spans are created at RUNTIME, one per
 * delegation, so a registry keyed by activation id grows with the work rather than
 * with the graph. Whoever adds them must keep the eviction below and must not
 * assume "bounded by the graph" still applies.
 */
class RunTracer(
    private val writer: SpanWriter?,
    val traceId: UUID,
    val runId: UUID,
    val workspaceId: UUID,
) {
    /** Open spans: spanId -> start instant, parent, and accumulated child time. */
    private class Open(
        val startedAt: Instant,
        val parentSpanId: UUID?,
        /**
         * The activation this span belongs to, inherited from the parent.
         *
         * Carried on the OPEN record rather than passed at close, because the two
         * spans that most need it — `llm_call` and `tool_call` — are opened and
         * closed inside executors that know nothing about activations and are not
         * going to learn. Inheritance down the tree stamps them for free.
         */
        val activationId: UUID?,
    ) {
        val childMs = AtomicLong(0)
    }

    private val open = ConcurrentHashMap<UUID, Open>()

    /** nodeId -> its step span, for executors that only know their node. */
    private val byNode = ConcurrentHashMap<String, UUID>()

    /**
     * Gated on the writer ACCEPTING spans, not merely existing.
     *
     * A writer with TRACE_SPANS_ENABLED=false is non-null but inert; checking only
     * for non-null would leave this class allocating ids and filling its open-span
     * map with entries whose closes are all discarded.
     */
    val enabled: Boolean get() = writer?.isEnabled == true

    /** The run span's id — derived, so every worker agrees without a lookup. */
    val runSpanId: UUID get() = SpanWriter.runSpanId(runId)

    /**
     * This tick's span, the default parent for every step in it.
     *
     * One tick per execution of this tracer, so a plain field rather than a stack.
     * Null until [openTick]; a step opened before then parents to the run span,
     * which is still correct, just flatter.
     */
    @Volatile
    var tickSpanId: UUID? = null
        private set

    /** Open the tick span. Its parent is always the run. */
    fun openTick(name: String): UUID? {
        val id = open("tick", name, runSpanId)
        tickSpanId = id
        return id
    }

    fun closeTick(status: String, attributesJson: String = "{}") {
        close(tickSpanId, "tick", "tick", status, attributesJson = attributesJson)
        tickSpanId = null
    }

    fun spanForNode(nodeId: String): UUID? = byNode[nodeId]

    /**
     * Point a node id at a span, or clear it with null.
     *
     * [open] binds on creation and [close] unbinds, which is the whole story for a
     * step: it opens, its children look it up, it closes. An agent's loop is not
     * that shape. The step span, the activation span and each iteration span all
     * answer to the SAME node id in turn, and a `llm_call` opened during iteration
     * three must find iteration three — so the binding is swapped as the loop moves
     * and swapped back when it is done, which [close] alone cannot express.
     *
     * Rebinding is not a second registry: there is still exactly one entry per node
     * id, and the eviction rule in [close] and [clear] still empties it.
     */
    fun bindNode(nodeId: String, spanId: UUID?) {
        if (!enabled) return
        if (spanId == null) byNode.remove(nodeId) else byNode[nodeId] = spanId
    }

    /**
     * Open a span. Returns its id, or null when tracing is off.
     *
     * Nothing is written yet: a span is persisted once, on close, with its duration
     * already computed. The exception is the `run` span, which outlives the process
     * and is written open — see [openRunSpan].
     */
    fun open(
        kind: String,
        name: String,
        parentSpanId: UUID?,
        nodeId: String? = null,
        startedAt: Instant = Instant.now(),
        /**
         * Null means "whatever my parent belongs to". Passed explicitly only by the
         * activation span itself, which is where an activation starts.
         */
        activationId: UUID? = null,
    ): UUID? {
        if (!enabled) return null
        val id = UUID.randomUUID()
        val inherited = activationId ?: parentSpanId?.let { open[it]?.activationId }
        open[id] = Open(startedAt, parentSpanId, inherited)
        if (nodeId != null) byNode[nodeId] = id
        return id
    }

    /**
     * Close a span and emit it.
     *
     * `self_ms` is duration minus the time its children accounted for. Computed here
     * rather than at read time so the number is right even if a child span was
     * dropped under buffer pressure — the accumulator saw it regardless.
     */
    fun close(
        spanId: UUID?,
        kind: String,
        name: String,
        status: String,
        stepId: String? = null,
        attributesJson: String = "{}",
        errorJson: String? = null,
        failureClass: String? = null,
        inputRef: String? = null,
        outputRef: String? = null,
        tokensIn: Int? = null,
        tokensOut: Int? = null,
        costCents: Double? = null,
        iterationIndex: Int? = null,
        attempt: Int = 1,
        nodeId: String? = null,
    ) {
        val w = writer ?: return
        val id = spanId ?: return
        val o = open.remove(id) ?: return
        if (nodeId != null) byNode.remove(nodeId)

        val ended = Instant.now()
        val durationMs = (ended.toEpochMilli() - o.startedAt.toEpochMilli()).coerceAtLeast(0)
        /* Children that outlived their parent contribute nothing rather than a
           negative self time. */
        val selfMs = (durationMs - o.childMs.get()).coerceAtLeast(0)

        /* Tell the parent how long this took, so ITS self time excludes ours. */
        o.parentSpanId?.let { open[it]?.childMs?.addAndGet(durationMs) }

        w.emit(SpanWriter.SpanRecord(
            spanId = id, traceId = traceId, runId = runId,
            parentSpanId = o.parentSpanId, workspaceId = workspaceId,
            kind = kind, name = name, status = status, stepId = stepId,
            activationId = o.activationId,
            iterationIndex = iterationIndex, attempt = attempt,
            startedAt = o.startedAt, endedAt = ended,
            durationMs = durationMs.toInt(), selfMs = selfMs.toInt(),
            attributesJson = attributesJson, inputRef = inputRef, outputRef = outputRef,
            errorJson = errorJson, failureClass = failureClass,
            tokensIn = tokensIn, tokensOut = tokensOut, costCents = costCents,
        ))
    }

    /**
     * The run span, opened `running` and closed by whichever worker finishes.
     *
     * Written immediately rather than held open in memory, because the process that
     * opens it is frequently not the one that closes it — a yield, an approval or a
     * crash hands the run to another worker. `created_at` is pinned to [startedAt]
     * so the derived id and the partition key are both stable, and the insert
     * no-ops on redelivery.
     */
    fun openRunSpan(name: String, startedAt: Instant) {
        val w = writer?.takeIf { it.isEnabled } ?: return
        w.emit(SpanWriter.SpanRecord(
            spanId = runSpanId, traceId = traceId, runId = runId,
            parentSpanId = null, workspaceId = workspaceId,
            kind = "run", name = name, status = "running",
            startedAt = startedAt, createdAt = startedAt,
        ))
    }

    /**
     * Close the run span.
     *
     * `self_ms` is deliberately null. The run span's direct children are `tick` and
     * `wait` spans, and between them they tile its entire timeline — so its self
     * time is always ~0. Correct, and useless. Self time is meaningful for leaves
     * and for spans with real gaps between their children; a root whose children
     * cover it is neither.
     */
    fun closeRunSpan(name: String, status: String, startedAt: Instant, failureClass: String? = null) {
        val w = writer?.takeIf { it.isEnabled } ?: return
        val ended = Instant.now()
        w.emit(SpanWriter.SpanRecord(
            spanId = runSpanId, traceId = traceId, runId = runId,
            parentSpanId = null, workspaceId = workspaceId,
            kind = "run", name = name, status = status,
            startedAt = startedAt, endedAt = ended,
            durationMs = (ended.toEpochMilli() - startedAt.toEpochMilli()).coerceAtLeast(0).toInt(),
            selfMs = null,
            failureClass = failureClass,
            createdAt = startedAt,
        ))
    }

    /**
     * A gap between ticks, written after the fact.
     *
     * The worker is not running during the gap, so this is the only way to record
     * it: at the start of the next tick, from timestamps that are already durable.
     * An unexplained hole in a waterfall generates more support tickets than an
     * error does, because it looks like the product hanging.
     *
     * The id is derived from (run, reason, gap start) so a redelivered job that
     * writes the same wait twice collides with itself instead of drawing the gap
     * twice.
     */
    fun emitWait(reason: String, from: Instant, to: Instant) {
        val w = writer?.takeIf { it.isEnabled } ?: return
        val durationMs = (to.toEpochMilli() - from.toEpochMilli())
        /* Sub-second gaps are scheduling noise, not waiting. Emitting them would
           bury the real ones in a waterfall. */
        if (durationMs < 1_000) return
        w.emit(SpanWriter.SpanRecord(
            spanId = SpanWriter.waitSpanId(runId, reason, from.toEpochMilli()),
            traceId = traceId, runId = runId,
            parentSpanId = runSpanId, workspaceId = workspaceId,
            kind = "wait", name = "wait:$reason", status = "ok",
            startedAt = from, endedAt = to, durationMs = durationMs.toInt(),
            selfMs = durationMs.toInt(),
            attributesJson = """{"reason":"$reason"}""",
            createdAt = from,
        ))
    }

    /** Drop everything still open — a tick ended without closing its spans. */
    fun clear() {
        open.clear()
        byNode.clear()
    }
}
