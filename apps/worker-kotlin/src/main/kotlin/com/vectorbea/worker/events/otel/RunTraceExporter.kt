package com.vectorbea.worker.events.otel

import com.vectorbea.worker.durable.archive.TraceSampler
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.SpanWriter
import com.vectorbea.worker.logging.logger
import io.opentelemetry.sdk.trace.data.SpanData
import io.opentelemetry.sdk.trace.export.SpanExporter
import java.time.Duration
import java.util.UUID
import java.util.concurrent.TimeUnit
import javax.sql.DataSource

/**
 * Ships a finished run's trace to the workspace's own OTLP endpoint. §9.
 *
 * ── WHEN IT RUNS, AND WHY ONLY THEN ─────────────────────────────────────────
 * On the terminal transition of a run with **no parent**. Not on every run's
 * terminal: a five-agent team is six runs, and exporting on each of them would
 * ship the same tree six times. Not on a timer either — at terminal the tree is
 * complete, because every dispatched child terminalises before its parent can
 * (that is what `waiting_for_child` and the reconciler are for).
 *
 * The gap that leaves is honest and worth naming: a child whose parent NEVER
 * terminalises is never exported. That is the same condition under which the
 * internal trace is incomplete too, and the reconciler's dead-letter path is
 * where it is visible. Exporting a half-finished tree would produce a trace that
 * looks finished and is not, which is worse.
 *
 * ── ONE LOGICAL TRACE, SIX RUNS ─────────────────────────────────────────────
 * `run_spans.trace_id` is the run id, so each dispatched child has its own. The
 * export re-roots them all onto the top run's id and hangs each child run's `run`
 * span off the `activation` span of the agent that delegated it. See
 * [OtelSpanMapper.Reparent] for why this is fixed here rather than in the schema.
 *
 * ── NEVER BLOCKS, NEVER FAILS A RUN ─────────────────────────────────────────
 * Invariant 7, and it takes two mechanisms rather than one.
 *
 * **Never fails**: every path is wrapped. A customer's Tempo being down, their
 * token being expired, their endpoint being a typo — none of it may propagate
 * into the terminal transition that called us. The failure is recorded on
 * `workspace_otel_exports.last_error` and the run is unaffected.
 *
 * **Never blocks**: [exportAsync] is what the terminal path calls, and it hands
 * the work to a small bounded pool. Exporting inline would put an HTTP round trip
 * to somebody else's collector — up to their configured `timeout_ms`, ten seconds
 * by default — on the completion of every run. A slow collector would then slow
 * the whole fleet down, which is an observability integration causing an outage:
 * precisely what the invariant exists to forbid.
 *
 * The queue is BOUNDED and a full queue DROPS, like `SpanWriter`'s. A dropped
 * export is a trace missing from someone's Tempo, which is a degraded
 * integration; a blocked one is a stalled worker.
 */
class RunTraceExporter(
    private val dataSource: DataSource,
    private val config: TraceExportConfig,
    /**
     * Which runs are worth sending. See [samplerForExport] for why the grace
     * window is zero here and sixty seconds everywhere else.
     */
    private val sampler: TraceSampler,
    private val enabled: Boolean =
        System.getenv("OTEL_TRACE_EXPORT_ENABLED")?.lowercase() == "true",
    /** Spans per OTLP request. */
    private val batchSize: Int =
        System.getenv("OTEL_TRACE_EXPORT_BATCH")?.toIntOrNull()?.coerceIn(1, 2_000) ?: 512,
    /**
     * Where a cross-workspace link is announced. Null leaves the log line and
     * drops the event — the right shape for a unit test, the wrong one for
     * production.
     */
    private val events: RunEventStore? = null,
    /**
     * Traces waiting to be shipped.
     *
     * Small on purpose. A deep queue would let a collector that has been down for
     * an hour hold an hour of memory and then deliver an hour of stale traces at
     * once; a shallow one drops early and loudly. Two workers, because an export
     * is mostly socket wait and one slow tenant should not stall another's.
     */
    private val queueCapacity: Int =
        System.getenv("OTEL_TRACE_EXPORT_QUEUE")?.toIntOrNull()?.coerceIn(1, 10_000) ?: 256,
) {
    private val log = logger()

    private val dropped = java.util.concurrent.atomic.AtomicLong()

    /** How many traces were dropped because the queue was full. */
    fun droppedCount(): Long = dropped.get()

    private val pool: java.util.concurrent.ThreadPoolExecutor by lazy {
        java.util.concurrent.ThreadPoolExecutor(
            2, 2, 0L, TimeUnit.MILLISECONDS,
            java.util.concurrent.ArrayBlockingQueue(queueCapacity),
        ) { r -> Thread(r, "otel-trace-export").also { it.isDaemon = true } }
    }

    /**
     * Ship the trace off the caller's thread. Returns immediately.
     *
     * This is what the terminal transition calls. [exportRun] stays public and
     * synchronous for tests and for anything that needs the outcome.
     */
    fun exportAsync(runId: UUID, workspaceId: UUID) {
        if (!enabled) return
        try {
            pool.execute { runCatching { exportRun(runId, workspaceId) } }
        } catch (_: java.util.concurrent.RejectedExecutionException) {
            /* A counter, not a log line per drop: if the collector is down, every
               run drops, and a log line each would bury the incident it describes. */
            val n = dropped.incrementAndGet()
            if (n == 1L || n % 100L == 0L) {
                log.warn("[otel-export] queue full — {} trace(s) not exported", n)
            }
        }
    }

    /** Drain briefly, then stop. Called on shutdown. */
    fun stop(timeoutMs: Long = 3_000) {
        if (!enabled) return
        runCatching {
            pool.shutdown()
            if (!pool.awaitTermination(timeoutMs, TimeUnit.MILLISECONDS)) pool.shutdownNow()
        }
    }

    data class Result(
        val exported: Int,
        val runs: Int,
        val skipped: String? = null,
    )

    /**
     * Export the logical trace rooted at [runId], if there is anywhere to send it.
     *
     * Safe to call for any run: a run with a parent, a workspace with no
     * destination and a sampled-out run all return without doing work.
     */
    fun exportRun(runId: UUID, workspaceId: UUID): Result = runCatching {
        if (!enabled) return Result(0, 0, "disabled")

        val row = config.rowFor(workspaceId) ?: return Result(0, 0, "no destination")

        /* A child run is exported as part of its parent's tree. Checking here
           rather than at the call site keeps the rule in one place. */
        if (parentRunOf(runId) != null) return Result(0, 0, "child run")

        /* The tree FIRST, because the sampling decision depends on it. A team's
           failure is almost always in a child, and asking only whether the top run
           has a failed span would sample out precisely the traces somebody is
           about to go looking for. */
        val tree = traceRuns(runId, workspaceId)
        val runIds = tree.runIds

        /*
         * ── A DESCENDANT IN ANOTHER WORKSPACE IS DROPPED AND ANNOUNCED ──────
         *
         * `agent_runs.parent_run_id` has no foreign key — V045 says so, and says
         * why — so nothing in the schema prevents it pointing at a run in another
         * tenant. Following it would ship that tenant's agent names, step names
         * and run ids to THIS tenant's OTLP endpoint: outbound, to a third party,
         * unrecoverable once sent.
         *
         * Dropped rather than exported, and LOUD rather than silent — a
         * cross-workspace parent link is itself a bug, and the run ids on both
         * sides are the only handle on the writer that created it.
         */
        if (tree.foreign.isNotEmpty()) reportForeign(runId, workspaceId, tree.foreign)

        val decision = sampler.decide(factsFor(runId, runIds) ?: return Result(0, 0, "no run"))
        if (!decision.kept) return Result(0, 0, "sampled out")

        val rows = spansFor(runIds, workspaceId)
        if (rows.isEmpty()) return Result(0, runIds.size, "no spans")

        val destination = config.destinationFor(row) ?: return Result(0, 0, "no exporter")
        val reparent = OtelSpanMapper.Reparent(
            traceId = runId,
            parentOverride = childRunLinks(runId, runIds),
        )

        val spans = rows.map { OtelSpanMapper.toSpanData(it, destination.resource, reparent) }
        send(destination.exporter, spans, row.timeoutMs.toLong())
        config.recordOutcome(workspaceId, null)
        log.info("[otel-export] {} span(s) across {} run(s) → {}",
            spans.size, runIds.size, row.endpoint)
        Result(spans.size, runIds.size)
    }.getOrElse { e ->
        log.warn("[otel-export] export failed for run {}: {}", runId, e.message)
        runCatching { config.recordOutcome(workspaceId, e.message) }
        Result(0, 0, "error")
    }

    /** Push in batches, waiting on each so a failure is visible rather than swallowed. */
    private fun send(exporter: SpanExporter, spans: List<SpanData>, timeoutMs: Long) {
        spans.chunked(batchSize).forEach { batch ->
            val r = exporter.export(batch)
            if (!r.join(timeoutMs, TimeUnit.MILLISECONDS).isSuccess) {
                /* The OTLP exporter does not surface the cause on the result, and
                   it has already logged it. Naming the batch is what this adds. */
                error("OTLP receiver rejected a batch of ${batch.size} span(s)")
            }
        }
    }

    // ── Reading the tree ──────────────────────────────────────────────────────

    private fun parentRunOf(runId: UUID): UUID? = dataSource.connection.use { c ->
        c.prepareStatement("SELECT parent_run_id FROM agent_runs WHERE id = ?").use { st ->
            st.setObject(1, runId)
            st.executeQuery().use { rs -> if (rs.next()) rs.getObject(1) as UUID? else null }
        }
    }

    /**
     * The root run and every run beneath it.
     *
     * `UNION` rather than `UNION ALL` and a depth cap: `parent_run_id` has no
     * foreign key and nothing in the schema forbids a cycle, so a recursive query
     * without both is one bad row away from running until the connection times
     * out. The cap is generous — real depth is bounded by `TeamLimits.maxDepth`.
     */
    /** The runs in the trace, and the ones refused for belonging elsewhere. */
    internal data class Tree(val runIds: List<UUID>, val foreign: List<UUID>)

    internal fun traceRuns(rootId: UUID, workspaceId: UUID): Tree = dataSource.connection.use { c ->
        c.prepareStatement(
            """
            WITH RECURSIVE tree(id, workspace_id, depth) AS (
                SELECT id, workspace_id, 0 FROM agent_runs WHERE id = ? AND workspace_id = ?
                UNION
                SELECT r.id, r.workspace_id, t.depth + 1
                  FROM agent_runs r JOIN tree t ON r.parent_run_id = t.id
                 WHERE t.depth < 32 AND t.workspace_id = ?
            )
            SELECT id, workspace_id = ? AS same_workspace FROM tree
            """.trimIndent()
        ).use { st ->
            st.setObject(1, rootId); st.setObject(2, workspaceId)
            st.setObject(3, workspaceId); st.setObject(4, workspaceId)
            st.executeQuery().use { rs ->
                val mine = mutableListOf<UUID>()
                val theirs = mutableListOf<UUID>()
                while (rs.next()) {
                    val id = rs.getObject(1) as UUID
                    if (rs.getBoolean(2)) mine += id else theirs += id
                }
                /* Foreign runs are enumerated but never descended into: the
                   recursion only continues from rows already in this workspace,
                   so a chain cannot walk A -> B -> C one hop at a time. One hop
                   is enough to NAME the bad link, which is all the report needs. */
                Tree(mine, theirs)
            }
        }
    }

    /**
     * A cross-workspace parent link, announced.
     *
     * Filed on the ROOT's run, because that is the run somebody is looking at,
     * and with both ids in the summary because the foreign run id is the only
     * handle on the other half. `warning`, not `failed`: the export is correct
     * and complete for this workspace — what is wrong is the data it walked over.
     */
    private fun reportForeign(rootId: UUID, workspaceId: UUID, foreign: List<UUID>) {
        log.error("[otel-export] refusing to export {} run(s) from another workspace " +
            "[rootRun={}, workspace={}, foreign={}] — a cross-workspace parent_run_id is a bug",
            foreign.size, rootId, workspaceId, foreign.take(10))
        runCatching {
            val env = environmentOf(rootId) ?: return
            events?.appendEvent(RunEventStore.RunEvent(
                runId = rootId,
                workspaceId = workspaceId,
                environmentId = env,
                type = RunEventStore.EventType.TRACE_EXPORT_CROSS_WORKSPACE,
                status = "warning",
                source = "otel-export",
                title = "Cross-workspace run link",
                summary = "${foreign.size} run(s) linked as children of this one belong to " +
                    "another workspace and were excluded from the trace export: " +
                    foreign.take(5).joinToString(),
            ))
        }
    }

    private fun environmentOf(runId: UUID): UUID? = runCatching {
        dataSource.connection.use { c ->
            c.prepareStatement("SELECT environment_id FROM agent_runs WHERE id = ?").use { st ->
                st.setObject(1, runId)
                st.executeQuery().use { rs -> if (rs.next()) rs.getObject(1) as UUID? else null }
            }
        }
    }.getOrNull()

    /**
     * The facts for a logical trace, aggregated over EVERY run in it.
     *
     * ── WHY NOT JUST THE TOP RUN ────────────────────────────────────────────
     * Because in a team, the interesting thing almost never happens in the top
     * run. The supervisor delegates and waits; the researcher is the one whose
     * tool call fails, whose approval gate opens, whose budget gets clamped.
     * Asking only whether the top run has a failed span answers "did the
     * supervisor fail", which is a different and much less useful question — and
     * it would sample out exactly the traces somebody is about to go looking for.
     *
     * The status and duration still come from the top run, because those ARE
     * properties of the whole: a team whose child failed and which recovered is a
     * succeeded run, and its duration is the supervisor's.
     */
    private fun factsFor(runId: UUID, family: List<UUID>): TraceSampler.RunFacts? =
        dataSource.connection.use { c ->
            c.prepareStatement(
                """
                SELECT r.workspace_id, r.status, r.created_at, r.duration_ms,
                       EXISTS (SELECT 1 FROM run_spans s
                                WHERE s.run_id = ANY(?) AND s.status = 'failed'),
                       EXISTS (SELECT 1 FROM run_events e
                                WHERE e.run_id = ANY(?)
                                  AND e.type IN ('APPROVAL_REQUESTED','AGENT_APPROVAL_REQUESTED')),
                       EXISTS (SELECT 1 FROM run_spans s
                                WHERE s.run_id = ANY(?)
                                  AND (s.attributes_json ->> 'budget_clamped')::boolean IS TRUE)
                  FROM agent_runs r WHERE r.id = ?
                """.trimIndent()
            ).use { st ->
                val ids = c.createArrayOf("uuid", family.toTypedArray())
                st.setArray(1, ids); st.setArray(2, ids); st.setArray(3, ids)
                st.setObject(4, runId)
                st.executeQuery().use { rs ->
                    if (!rs.next()) null else TraceSampler.RunFacts(
                        runId = runId,
                        workspaceId = rs.getObject(1) as UUID,
                        status = rs.getString(2) ?: "unknown",
                        createdAt = rs.getTimestamp(3).toInstant(),
                        durationMs = rs.getObject(4)?.let { (it as Number).toLong() },
                        hadFailedStep = rs.getBoolean(5),
                        hadApproval = rs.getBoolean(6),
                        hadBudgetClamp = rs.getBoolean(7),
                    )
                }
            }
        }

    /**
     * The spans of those runs, scoped to the workspace a second time.
     *
     * `traceRuns` already refused foreign runs, so this predicate is redundant
     * today. It is here because these two queries ARE the outbound boundary, and
     * they should not both depend on one of them being right: a future edit that
     * widens the walk would otherwise silently widen the export.
     */
    private fun spansFor(runIds: List<UUID>, workspaceId: UUID): List<OtelSpanMapper.Row> =
        dataSource.connection.use { c ->
            c.prepareStatement(
                """
                SELECT span_id, trace_id, run_id, parent_span_id, workspace_id, kind, name,
                       status, step_id, activation_id, iteration_index, attempt,
                       started_at, ended_at, duration_ms, self_ms, attributes_json::text,
                       failure_class, is_root_cause,
                       tokens_in, tokens_out, cost_cents
                  FROM run_spans WHERE run_id = ANY(?) AND workspace_id = ? ORDER BY started_at
                """.trimIndent()
            ).use { st ->
                st.setArray(1, c.createArrayOf("uuid", runIds.toTypedArray()))
                st.setObject(2, workspaceId)
                st.executeQuery().use { rs ->
                    buildList {
                        while (rs.next()) add(OtelSpanMapper.Row(
                            spanId = rs.getObject(1) as UUID,
                            traceId = rs.getObject(2) as UUID,
                            runId = rs.getObject(3) as UUID,
                            parentSpanId = rs.getObject(4) as UUID?,
                            workspaceId = rs.getObject(5) as UUID,
                            kind = rs.getString(6),
                            name = rs.getString(7),
                            status = rs.getString(8),
                            stepId = rs.getString(9),
                            activationId = rs.getObject(10) as UUID?,
                            iterationIndex = rs.getObject(11)?.let { (it as Number).toInt() },
                            attempt = rs.getInt(12),
                            startedAt = rs.getTimestamp(13).toInstant(),
                            endedAt = rs.getTimestamp(14)?.toInstant(),
                            durationMs = rs.getObject(15)?.let { (it as Number).toInt() },
                            selfMs = rs.getObject(16)?.let { (it as Number).toInt() },
                            attributesJson = rs.getString(17),
                            /* 18 was error_json. Dropped from the SELECT, not just
                               from the mapping: a sanitized-for-us error body has
                               no reason to be in memory on an egress path. */
                            failureClass = rs.getString(18),
                            isRootCause = rs.getBoolean(19),
                            tokensIn = rs.getObject(20)?.let { (it as Number).toInt() },
                            tokensOut = rs.getObject(21)?.let { (it as Number).toInt() },
                            costCents = rs.getObject(22)?.let { (it as Number).toDouble() },
                        ))
                    }
                }
            }
        }

    /**
     * Where each child run's `run` span hangs in the exported tree.
     *
     * A dispatched child run's root span has no parent — the run started on its
     * own transport, and in Postgres it is the root of its own trace. In the
     * exported tree it belongs under the **activation of the agent that delegated
     * it**, which is what makes "the supervisor called the researcher, and here is
     * what the researcher did" one continuous path rather than two traces a reader
     * has to correlate by timestamp.
     *
     * The chain is: child run → `parent_activation_id` (the activation this run
     * IS) → that activation's own `parent_activation_id` (the delegator) → the
     * `activation` span carrying it. Falling back to the parent run's `run` span
     * keeps the tree connected when any link is missing — a disconnected subtree
     * would be read as a bug in the runtime rather than a gap in the trace.
     */
    internal fun childRunLinks(rootId: UUID, runIds: List<UUID>): Map<UUID, UUID> {
        if (runIds.size < 2) return emptyMap()
        return dataSource.connection.use { c ->
            c.prepareStatement(
                """
                SELECT child.id,
                       parent_span.span_id,
                       child.parent_run_id
                  FROM agent_runs child
                  LEFT JOIN agent_activations a  ON a.id = child.parent_activation_id
                  LEFT JOIN run_spans parent_span
                         ON parent_span.run_id     = child.parent_run_id
                        AND parent_span.kind       = 'activation'
                        AND parent_span.activation_id = a.parent_activation_id
                 WHERE child.id = ANY(?) AND child.id <> ?
                """.trimIndent()
            ).use { st ->
                st.setArray(1, c.createArrayOf("uuid", runIds.toTypedArray()))
                st.setObject(2, rootId)
                st.executeQuery().use { rs ->
                    buildMap {
                        while (rs.next()) {
                            val childRun = rs.getObject(1) as UUID
                            val delegator = rs.getObject(2) as UUID?
                            val parentRun = rs.getObject(3) as UUID?
                            val target = delegator
                                ?: parentRun?.let { SpanWriter.runSpanId(it) }
                                ?: continue
                            /* The child run's root span id is DERIVED, not read:
                               `runSpanId` is deterministic, which is what makes the
                               run span idempotent across redelivery in the first
                               place. Reading it back would be a second query for a
                               value that is a pure function of the run id. */
                            put(SpanWriter.runSpanId(childRun), target)
                        }
                    }
                }
            }
        }
    }

    companion object {
        /**
         * The sampler the EXPORT uses, which is not the one retention uses.
         *
         * `TraceSampler`'s sixty-second grace window exists so a run somebody is
         * watching in the debugger right now is never pruned. Export happens at
         * terminal, so every run is inside that window and the grace rule would
         * keep all of them — the workspace's rate would never apply and "sampling
         * honoured" would be a claim with no behaviour behind it.
         *
         * Zeroing it leaves exactly the rules that mean something here: a failed
         * run, an approval or a budget clamp is always sent, a short or unfinished
         * run is always sent, and a long clean success is sent at the workspace's
         * configured rate. Same class, same rules, same rate column — one window
         * that belongs to the other caller.
         */
        fun samplerForExport(dataSource: DataSource): TraceSampler =
            TraceSampler.fromDatabase(dataSource, graceWindow = Duration.ZERO)
    }
}
