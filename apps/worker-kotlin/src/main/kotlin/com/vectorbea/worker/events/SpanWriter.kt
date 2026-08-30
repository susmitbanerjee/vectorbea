package com.vectorbea.worker.events

import com.vectorbea.worker.logging.logger
import com.vectorbea.worker.metrics.WorkerMetrics
import io.lettuce.core.pubsub.StatefulRedisPubSubConnection
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.sql.DataSource

/**
 * Writes trace spans without ever making a run wait for it.
 *
 * THE ONE RULE THAT SHAPES EVERYTHING HERE
 * ----------------------------------------
 * A degraded trace is acceptable; a blocked run is not. So every public method
 * returns in constant time, nothing here can throw into a caller, and under
 * pressure spans are DROPPED and counted rather than queued unboundedly or written
 * synchronously. If this class is the reason a run got slower, it is broken.
 *
 * That is a genuinely different contract from [RunEventStore], which is synchronous
 * and takes a `FOR UPDATE` lock on the run row to assign `sequence`. Events need
 * that because their order is their meaning. Spans do not: `parent_span_id` plus
 * timestamps rebuild the tree, so there is no sequence, no lock, and no contention
 * with run status updates.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not sanitize. Same contract as [RunEventStore]: attributes, names and
 * error JSON must already be safe when they arrive. Bulk content does not belong
 * in a span at all — it goes to [PayloadStore], which does redact, and the span
 * keeps a ref.
 */
class SpanWriter(
    private val dataSource: DataSource?,
    private val pubSub: StatefulRedisPubSubConnection<String, String>?,
    private val enabled: Boolean = SPANS_ENABLED,
    /** Bounded. Full means drop, never grow and never block. */
    capacity: Int = 10_000,
    private val flushEveryMs: Long = 250L,
    private val batchSize: Int = 50,
) {
    private val log = logger()

    /**
     * Whether this writer will accept anything.
     *
     * Exposed so [RunTracer] can skip its own bookkeeping too. Without it a disabled
     * writer still costs a UUID allocation and a map entry per span, and the open-span
     * map would fill with entries nothing ever closes.
     */
    val isEnabled: Boolean get() = enabled && dataSource != null

    companion object {
        /**
         * Master switch. Off, `start`/`end` build nothing and return immediately, so
         * the cost of tracing a run is a boolean test per span. Safe to flip in
         * production: no run outcome, timing decision or event depends on a span.
         */
        val SPANS_ENABLED: Boolean =
            System.getenv("TRACE_SPANS_ENABLED")?.lowercase() != "false"

        /**
         * The `run` span's id, derived from the run id rather than stored.
         *
         * A run span outlives the process that opened it — it starts on the worker
         * that takes the first tick and closes on whichever worker reaches a terminal
         * state, which may be a different one after a yield or a crash. Deriving the
         * id means any worker can compute it with no lookup and no coordination, and
         * makes the opening insert idempotent under redelivery.
         *
         * UUIDv5-style: a namespace constant and the run id, hashed. Deterministic
         * across processes and JVM versions, unlike `hashCode`.
         */
        fun runSpanId(runId: UUID): UUID = deterministicId("run", runId.toString())

        /**
         * A `wait` span's id, derived from what the gap IS.
         *
         * Wait spans are written retrospectively at tick start, and a redelivered
         * RESUME_RUN that loses the status CAS still gets far enough to write one. A
         * random id would paint a second hatched bar over the same gap in the
         * waterfall, which reads as the product having stalled twice. Derived from
         * (run, reason, gap start), it collides with itself and the insert no-ops.
         */
        fun waitSpanId(runId: UUID, reason: String, gapStartMs: Long): UUID =
            deterministicId("wait", "$runId|$reason|$gapStartMs")

        private fun deterministicId(kind: String, material: String): UUID {
            val b = java.security.MessageDigest.getInstance("SHA-256")
                .digest("vectorbea.span.$kind|$material".toByteArray(Charsets.UTF_8))
            // Stamp version 5 and the RFC-4122 variant so these are well-formed
            // UUIDs rather than 16 arbitrary bytes that merely look like one.
            b[6] = ((b[6].toInt() and 0x0F) or 0x50).toByte()
            b[8] = ((b[8].toInt() and 0x3F) or 0x80).toByte()
            var msb = 0L
            var lsb = 0L
            for (i in 0..7)  msb = (msb shl 8) or (b[i].toLong() and 0xff)
            for (i in 8..15) lsb = (lsb shl 8) or (b[i].toLong() and 0xff)
            return UUID(msb, lsb)
        }
    }

    /** One span, as it will be written. Immutable by the time it is queued. */
    data class SpanRecord(
        val spanId: UUID,
        val traceId: UUID,
        val runId: UUID,
        val parentSpanId: UUID?,
        val workspaceId: UUID,
        val kind: String,
        val name: String,
        val status: String,
        val stepId: String? = null,
        val activationId: UUID? = null,
        val iterationIndex: Int? = null,
        val attempt: Int = 1,
        val startedAt: Instant,
        val endedAt: Instant? = null,
        val durationMs: Int? = null,
        val selfMs: Int? = null,
        val attributesJson: String = "{}",
        val inputRef: String? = null,
        val outputRef: String? = null,
        val errorJson: String? = null,
        val failureClass: String? = null,
        val tokensIn: Int? = null,
        val tokensOut: Int? = null,
        val costCents: Double? = null,
        /**
         * Written explicitly, NOT left to the column default — this is what makes
         * the deterministic ids actually idempotent.
         *
         * The primary key is `(span_id, created_at)`, because a unique constraint on
         * a partitioned table must include the partition key. If `created_at` came
         * from `now()`, a redelivered wait span would carry the same derived
         * `span_id` but a different `created_at`, miss the conflict, and paint a
         * second hatched bar over the same gap in the waterfall. Pinning it to
         * `startedAt` — which is derived for exactly those spans — makes
         * ON CONFLICT DO NOTHING fire.
         */
        val createdAt: Instant = startedAt,
    )

    private val queue = ArrayBlockingQueue<SpanRecord>(capacity)
    private val running = AtomicBoolean(false)
    private val writer = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "span-writer").also { it.isDaemon = true }
    }

    fun start() {
        if (dataSource == null || !enabled) {
            log.info("[spans] writer inactive (enabled={}, persistence={})", enabled, dataSource != null)
            return
        }
        if (running.compareAndSet(false, true)) {
            writer.scheduleWithFixedDelay(::drain, flushEveryMs, flushEveryMs, TimeUnit.MILLISECONDS)
            log.info("[spans] writer started (flush {}ms / {} spans)", flushEveryMs, batchSize)
        }
    }

    /**
     * Queue a span. Returns immediately, always.
     *
     * The ONLY work on the caller's thread is an `offer` onto a bounded queue —
     * no allocation beyond the record, no I/O, no lock the writer also holds.
     */
    fun emit(span: SpanRecord) {
        if (!enabled || dataSource == null) return
        try {
            if (!queue.offer(span)) {
                /* Full. Drop the NEWEST rather than evicting the oldest: the spans
                   already queued are closer to complete, and a trace missing its tail
                   is easier to read than one missing its middle. */
                WorkerMetrics.spansDropped.inc("buffer_full")
            }
        } catch (e: Throwable) {
            /* Nothing above may ever see an exception from tracing. */
            WorkerMetrics.spansDropped.inc("enqueue_error")
            log.debug("[spans] enqueue failed: {}", e.message)
        }
    }

    /**
     * Drain the queue now, on the calling thread.
     *
     * Exists for exactly one caller: root-cause attribution at run terminalisation.
     * Spans are written with up to [flushEveryMs] of latency, so the last few of a
     * failed run — very often including the one that failed — can still be in the
     * buffer when the run goes terminal. Attributing without flushing would walk an
     * incomplete tree and blame the wrong span, or find no error spans at all.
     *
     * Bounded by what is already queued: it drains the current contents and returns,
     * rather than looping until empty, so a run terminalising while another run
     * floods the buffer cannot be held here.
     */
    fun flush() {
        if (!isEnabled) return
        runCatching {
            var remaining = queue.size
            while (remaining > 0) {
                val batch = ArrayList<SpanRecord>(batchSize)
                queue.drainTo(batch, batchSize)
                if (batch.isEmpty()) break
                writeBatch(batch)
                publish(batch)
                remaining -= batch.size
            }
        }.onFailure { log.warn("[spans] explicit flush failed: {}", it.message) }
    }

    /** Spans lost so far, for labelling a trace incomplete. */
    fun droppedCount(): Long =
        WorkerMetrics.spansDropped.cells.values.sumOf { it.get() }

    fun queueDepth(): Int = queue.size

    /**
     * Drain up to [batchSize] and write them.
     *
     * Runs on the writer thread only. Every failure path here increments a counter
     * and returns; none of them propagate, because there is nobody to propagate to.
     */
    private fun drain() {
        if (!running.get()) return
        try {
            val batch = ArrayList<SpanRecord>(batchSize)
            queue.drainTo(batch, batchSize)
            if (batch.isEmpty()) return
            writeBatch(batch)
            publish(batch)
        } catch (e: Throwable) {
            WorkerMetrics.spansDropped.inc("write_failed")
            log.warn("[spans] drain failed: {}", e.message)
        }
    }

    private fun writeBatch(batch: List<SpanRecord>) {
        val ds = dataSource ?: return
        try {
            ds.connection.use { conn ->
                conn.autoCommit = false
                conn.prepareStatement(INSERT_SQL).use { stmt ->
                    batch.forEach { bind(stmt, it); stmt.addBatch() }
                    stmt.executeBatch()
                }
                conn.commit()
            }
            WorkerMetrics.spansWritten.inc(delta = batch.size.toLong())
        } catch (e: Exception) {
            /*
             * The whole batch is discarded rather than retried.
             *
             * A retry queue would grow while the database is the thing that is
             * unwell, which is when the worker can least afford it — and a span is
             * worth strictly less than the run it describes. The counter is how this
             * becomes visible.
             */
            WorkerMetrics.spansDropped.inc("write_failed", delta = batch.size.toLong())
            log.warn("[spans] batch of {} discarded: {}", batch.size, e.message)
        }
    }

    /**
     * Publish AFTER the Postgres write, never before.
     *
     * Same ordering rule [RunEventStore] follows: a missed live update loses
     * nothing because the span is already durable, whereas publishing first can
     * show a UI something that never lands.
     */
    private fun publish(batch: List<SpanRecord>) {
        val ps = pubSub ?: return
        batch.forEach { s ->
            try {
                ps.sync().publish("run-events:${s.runId}", envelope(s))
            } catch (e: Exception) {
                log.debug("[spans] publish failed span={}: {}", s.spanId, e.message)
            }
        }
    }

    /** Minimal envelope — ids, shape and timing. No attributes, no payloads. */
    private fun envelope(s: SpanRecord): String = buildString {
        append("{\"type\":\"SPAN\"")
        append(",\"spanId\":\"").append(s.spanId).append('"')
        append(",\"traceId\":\"").append(s.traceId).append('"')
        s.parentSpanId?.let { append(",\"parentSpanId\":\"").append(it).append('"') }
        append(",\"kind\":\"").append(s.kind).append('"')
        append(",\"status\":\"").append(s.status).append('"')
        s.durationMs?.let { append(",\"durationMs\":").append(it) }
        append('}')
    }

    private fun bind(stmt: java.sql.PreparedStatement, s: SpanRecord) {
        var i = 1
        stmt.setObject(i++, s.spanId)
        stmt.setObject(i++, s.traceId)
        stmt.setObject(i++, s.runId)
        stmt.setObject(i++, s.parentSpanId)
        stmt.setObject(i++, s.workspaceId)
        stmt.setString(i++, s.kind)
        stmt.setString(i++, s.name.take(200))
        stmt.setString(i++, s.status)
        stmt.setString(i++, s.stepId)
        stmt.setObject(i++, s.activationId)
        setIntOrNull(stmt, i++, s.iterationIndex)
        stmt.setInt(i++, s.attempt)
        stmt.setTimestamp(i++, Timestamp.from(s.startedAt))
        stmt.setTimestamp(i++, s.endedAt?.let { Timestamp.from(it) })
        setIntOrNull(stmt, i++, s.durationMs)
        setIntOrNull(stmt, i++, s.selfMs)
        stmt.setString(i++, s.attributesJson)
        stmt.setString(i++, s.inputRef)
        stmt.setString(i++, s.outputRef)
        stmt.setString(i++, s.errorJson)
        stmt.setString(i++, s.failureClass)
        setIntOrNull(stmt, i++, s.tokensIn)
        setIntOrNull(stmt, i++, s.tokensOut)
        if (s.costCents == null) stmt.setNull(i++, java.sql.Types.NUMERIC)
        else stmt.setBigDecimal(i++, java.math.BigDecimal.valueOf(s.costCents))
        stmt.setTimestamp(i++, Timestamp.from(s.createdAt))
    }

    private fun setIntOrNull(stmt: java.sql.PreparedStatement, i: Int, v: Int?) {
        if (v == null) stmt.setNull(i, java.sql.Types.INTEGER) else stmt.setInt(i, v)
    }

    /**
     * Flush what is queued and stop.
     *
     * Bounded: a worker shutting down must not wait on the trace writer. Whatever
     * is still queued past the deadline is dropped and counted.
     */
    fun stop(timeoutMs: Long = 2_000) {
        if (!running.compareAndSet(true, false)) return
        val deadline = System.currentTimeMillis() + timeoutMs
        try {
            while (queue.isNotEmpty() && System.currentTimeMillis() < deadline) {
                val batch = ArrayList<SpanRecord>(batchSize)
                queue.drainTo(batch, batchSize)
                if (batch.isNotEmpty()) { writeBatch(batch); publish(batch) }
            }
        } catch (e: Exception) {
            log.warn("[spans] shutdown flush failed: {}", e.message)
        }
        val abandoned = queue.size
        if (abandoned > 0) {
            WorkerMetrics.spansDropped.inc("shutdown", delta = abandoned.toLong())
            log.warn("[spans] {} span(s) abandoned at shutdown", abandoned)
        }
        writer.shutdownNow()
    }
}

private const val INSERT_SQL = """
    INSERT INTO run_spans (
        span_id, trace_id, run_id, parent_span_id, workspace_id,
        kind, name, status, step_id, activation_id, iteration_index, attempt,
        started_at, ended_at, duration_ms, self_ms,
        attributes_json, input_ref, output_ref, error_json, failure_class,
        tokens_in, tokens_out, cost_cents, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?::jsonb,?,?,?::jsonb,?,?,?,?,?)
    ON CONFLICT (span_id, created_at) DO NOTHING
"""
