package com.vectorbea.worker.events

import com.vectorbea.worker.logging.logger
import io.lettuce.core.pubsub.StatefulRedisPubSubConnection
import java.sql.PreparedStatement
import java.sql.Timestamp
import java.time.Instant
import java.util.UUID
import javax.sql.DataSource

/**
 * Writes run events to Postgres and publishes them on a Redis Pub/Sub channel.
 *
 * Thread-safety: all public methods are synchronised on the DataSource and
 * Lettuce connection (both thread-safe by design).
 *
 * Sequence: assigned under a `FOR UPDATE` lock on the run's `agent_runs` row,
 * held for the same transaction as the INSERT. The in-memory lock below only
 * covers writers inside THIS process; the row lock is what makes the assignment
 * safe against the API, which appends to the same run from another process.
 *
 * SECURITY: [RunEvent.metadataJsonSanitized] and [RunEvent.errorJsonSanitized]
 * must already be sanitized by the caller — this class stores them as-is.
 * Raw error messages, stack traces, and input payloads must NEVER be stored.
 *
 * Redis channel: `run-events:{runId}`
 */
open class RunEventStore(
    private val dataSource: DataSource,
    private val pubSub: StatefulRedisPubSubConnection<String, String>,
    /**
     * Where a sequence number comes from. See [SequenceSource].
     *
     * A constructor parameter rather than a direct env read so a test can drive
     * both modes in one JVM - the whole point of the change is that the two are
     * interchangeable, and a claim like that is only worth what its test is.
     */
    private val sequenceSource: SequenceSource = SequenceSource.default(),
    /**
     * Coalesce events into batched writes. See [emitBuffered].
     *
     * Off by default. On, a hard kill can lose up to [flushEveryMs] of
     * non-terminal events - which is why terminal events are never buffered.
     */
    private val batchEnabled: Boolean =
        System.getenv("AGENT_EVENT_BATCH_ENABLED")?.lowercase() == "true",
    private val batchSize: Int =
        System.getenv("AGENT_EVENT_BATCH_SIZE")?.toIntOrNull()?.coerceIn(1, 500) ?: 50,
    private val flushEveryMs: Long =
        System.getenv("AGENT_EVENT_FLUSH_MS")?.toLongOrNull()?.coerceIn(10, 5_000) ?: 250L,
) {
    private val log = logger()

    /**
     * How `run_events.sequence` is allocated.
     *
     * -- BOTH ARE CORRECT; ONE IS CHEAPER ------------------------------------
     * `RUN_ROW` is what shipped: take `agent_runs FOR UPDATE`, read
     * `MAX(sequence)+1`. It is the right call against a second process appending
     * to the same run and it is NOT being removed - 12.2 is explicit about
     * that. Its cost is that the lock lands on the row that also carries run
     * status, the lease and the fair-queueing vtime, so a five-agent team's
     * hundreds of event writes queue behind every status update.
     *
     * `COUNTER` moves the same lock onto a dedicated `run_event_seq` row. Same
     * serialization, same cluster-wide guarantee, no collision with `agent_runs`
     * and no MAX() scan across the monthly partitions.
     *
     * -- WHY THIS IS A FLAG AND NOT A REPLACEMENT ---------------------------
     * The API appends to `run_events` for the same run from another JVM and
     * deploys independently. A fleet where one side allocates from the counter
     * and the other from MAX(sequence) would write DUPLICATE sequence numbers -
     * they would not be excluding each other at all. So the flag has to be read
     * identically by both, and it defaults off until both are deployed.
     */
    enum class SequenceSource {
        RUN_ROW,
        COUNTER;

        companion object {
            /** Read by BOTH stores. `RunEventRepository` in the API reads the same name. */
            fun default(): SequenceSource =
                if (System.getenv("AGENT_EVENT_SEQ_COUNTER")?.lowercase() == "true") COUNTER
                else RUN_ROW
        }
    }

    /**
     * Per-run in-memory locks for serializing event sequence assignment.
     * Acquired before requesting a DB connection to avoid pool exhaustion.
     */
    private val runLocks = java.util.concurrent.ConcurrentHashMap<UUID, java.util.concurrent.locks.ReentrantLock>()

    /**
     * Pending events per run, guarded by that run's entry in [runLocks].
     *
     * -- WHY EVENTS BUFFER DIFFERENTLY FROM SPANS ---------------------------
     * `SpanWriter` has a bounded queue and DROPS to a counter under pressure,
     * because a missing span is a degraded trace. An event is not that: the run
     * timeline pages on `?afterSequence=`, so a dropped event is a hole a reader
     * can see and cannot explain, and RUN_FAILED going missing is an outage
     * reported as a success. So this buffer applies BACK-PRESSURE instead - a
     * full buffer flushes on the emitting thread rather than discarding.
     */
    private val pending = java.util.concurrent.ConcurrentHashMap<UUID, ArrayDeque<RunEvent>>()

    private val flusher = java.util.concurrent.Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "run-event-flush").also { it.isDaemon = true }
    }
    private var flushTask: java.util.concurrent.ScheduledFuture<*>? = null

    /**
     * Event types that must be on disk before the emitting thread continues.
     *
     * Terminal run states, and the two that gate a resume. Everything here is
     * something a reader would treat as authoritative - "this run finished" -
     * and something that must survive the kill that follows it.
     */
    private val neverBuffered = setOf(
        EventType.RUN_STARTED, EventType.RUN_SUCCEEDED, EventType.RUN_FAILED,
        EventType.RUN_CANCELLED, EventType.RUN_CANCELLED_CLEANLY,
        EventType.RUN_CONTINUED_AS_NEW, EventType.RUN_YIELDED,
        EventType.APPROVAL_REQUESTED, EventType.AGENT_APPROVAL_REQUESTED,
    )

    /** Start the periodic flush. No-op when batching is off. */
    open fun start() {
        if (!batchEnabled || flushTask != null) return
        flushTask = flusher.scheduleWithFixedDelay(
            { runCatching { flushAll() } }, flushEveryMs, flushEveryMs,
            java.util.concurrent.TimeUnit.MILLISECONDS)
        log.info("[events] batching on (size={}, every={}ms, seq={})",
            batchSize, flushEveryMs, sequenceSource)
    }

    /** Flush everything and stop the periodic task. Safe to call twice. */
    open fun stop() {
        flushTask?.cancel(false)
        flushTask = null
        runCatching { flushAll() }
        flusher.shutdown()
    }

    /**
     * Immutable event to persist and publish.
     *
     * Only [title], [summary], [metadataJsonSanitized], and [errorJsonSanitized]
     * are safe to include in the message — all must be pre-sanitized.
     */
    data class RunEvent(
        val runId: UUID,
        val workspaceId: UUID,
        val environmentId: UUID,
        val type: EventType,
        val status: String,
        val source: String = "worker",
        val title: String? = null,
        val summary: String? = null,
        val durationMs: Long? = null,
        val stepId: String? = null,
        val agentId: UUID? = null,
        val modelName: String? = null,
        val tokenCount: Int? = null,
        val estimatedCost: Double? = null,
        val correlationId: String? = null,
        val traceId: String? = null,
        val retryAttempt: Int? = null,
        /** Must be sanitized — no secrets, no raw error details */
        val metadataJsonSanitized: String? = null,
        /** Must be sanitized — no stack traces, no connection strings */
        val errorJsonSanitized: String? = null,
        /**
         * The span this event happened inside, so a log line can be located in the
         * trace tree. Nullable and unenforced: an event written before tracing
         * existed, or with tracing off, simply has none.
         *
         * Deliberately NOT a foreign key to `run_spans`. That table is partitioned by
         * `created_at`, and a foreign key into a partitioned table must include the
         * partition key — the same rule that forces run_spans' composite primary key.
         * V028 already had to drop an FK for exactly this reason.
         */
        val spanId: UUID? = null,
        /** Unwritten until P6 introduces activations. */
        val activationId: UUID? = null,
    )

    enum class EventType(val value: String) {
        RUN_STARTED("RUN_STARTED"),
        RUN_SUCCEEDED("RUN_SUCCEEDED"),
        RUN_FAILED("RUN_FAILED"),
        RUN_CANCELLED("RUN_CANCELLED"),
        // Step-level events
        STEP_SCHEDULED("STEP_SCHEDULED"),
        STEP_STARTED("STEP_STARTED"),
        STEP_INPUT_RESOLVED("STEP_INPUT_RESOLVED"),
        STEP_INPUT_VALIDATED("STEP_INPUT_VALIDATED"),
        STEP_COMPLETED("STEP_COMPLETED"),
        STEP_FAILED("STEP_FAILED"),
        STEP_SKIPPED("STEP_SKIPPED"),
        // Data mapping events
        INPUT_MAPPING_STARTED("INPUT_MAPPING_STARTED"),
        INPUT_MAPPING_COMPLETED("INPUT_MAPPING_COMPLETED"),
        INPUT_MAPPING_FAILED("INPUT_MAPPING_FAILED"),
        OUTPUT_EXTRACTION_STARTED("OUTPUT_EXTRACTION_STARTED"),
        OUTPUT_EXTRACTION_COMPLETED("OUTPUT_EXTRACTION_COMPLETED"),
        OUTPUT_EXTRACTION_FAILED("OUTPUT_EXTRACTION_FAILED"),
        STEP_OUTPUT_VALIDATED("STEP_OUTPUT_VALIDATED"),
        STEP_SCHEMA_VALIDATION_FAILED("STEP_SCHEMA_VALIDATION_FAILED"),
        // Transform-specific
        TRANSFORM_STARTED("TRANSFORM_STARTED"),
        TRANSFORM_COMPLETED("TRANSFORM_COMPLETED"),
        // Control-flow events
        BRANCH_EVALUATED("BRANCH_EVALUATED"),
        PARALLEL_STARTED("PARALLEL_STARTED"),
        PARALLEL_BRANCH_STARTED("PARALLEL_BRANCH_STARTED"),
        PARALLEL_BRANCH_COMPLETED("PARALLEL_BRANCH_COMPLETED"),
        JOIN_WAITING("JOIN_WAITING"),
        JOIN_COMPLETED("JOIN_COMPLETED"),
        // Checkpoint / approval
        CHECKPOINT_CREATED("CHECKPOINT_CREATED"),
        APPROVAL_REQUESTED("APPROVAL_REQUESTED"),
        NODE_TYPE_UNSUPPORTED("NODE_TYPE_UNSUPPORTED"),
        // Connector events
        CONNECTION_RESOLVED("CONNECTION_RESOLVED"),
        CONNECTION_VALIDATION_FAILED("CONNECTION_VALIDATION_FAILED"),
        SECRET_MISSING("SECRET_MISSING"),
        // LLM events
        LLM_CALL_STARTED("LLM_CALL_STARTED"),
        LLM_CALL_COMPLETED("LLM_CALL_COMPLETED"),
        // HTTP events
        HTTP_REQUEST_PREPARED("HTTP_REQUEST_PREPARED"),
        HTTP_REQUEST_STARTED("HTTP_REQUEST_STARTED"),
        HTTP_REQUEST_COMPLETED("HTTP_REQUEST_COMPLETED"),
        // DB read events
        DB_QUERY_PREPARED("DB_QUERY_PREPARED"),
        DB_QUERY_STARTED("DB_QUERY_STARTED"),
        DB_QUERY_COMPLETED("DB_QUERY_COMPLETED"),
        // DB write events
        DB_WRITE_PREPARED("DB_WRITE_PREPARED"),
        DB_WRITE_COMPLETED("DB_WRITE_COMPLETED"),
        // Tool call events
        TOOL_CALL_STARTED("TOOL_CALL_STARTED"),
        TOOL_CALL_COMPLETED("TOOL_CALL_COMPLETED"),
        TOOL_CALL_FAILED("TOOL_CALL_FAILED"),
        // Agent events
        AGENT_STARTED("AGENT_STARTED"),
        AGENT_COMPLETED("AGENT_COMPLETED"),
        AGENT_FAILED("AGENT_FAILED"),
        // Durable control operations
        RETRY_REQUESTED("RETRY_REQUESTED"),
        RETRY_STARTED("RETRY_STARTED"),
        REPLAY_CREATED("REPLAY_CREATED"),
        REPLAY_STARTED("REPLAY_STARTED"),
        APPROVAL_APPROVED("APPROVAL_APPROVED"),
        APPROVAL_REJECTED("APPROVAL_REJECTED"),
        RUN_CANCELLATION_REQUESTED("RUN_CANCELLATION_REQUESTED"),
        RUN_CANCELLED_CLEANLY("RUN_CANCELLED_CLEANLY"),
        // Legacy node-level events (kept for backward compat)
        NODE_STARTED("NODE_STARTED"),
        NODE_SUCCEEDED("NODE_SUCCEEDED"),
        NODE_FAILED("NODE_FAILED"),
        NODE_SKIPPED("NODE_SKIPPED"),
        WORKER_CLAIMED("WORKER_CLAIMED"),
        // Durable execution — history limits
        HISTORY_LIMIT_WARNING("HISTORY_LIMIT_WARNING"),
        CONTINUE_AS_NEW_RECOMMENDED("CONTINUE_AS_NEW_RECOMMENDED"),
        CONTINUE_AS_NEW_REQUESTED("CONTINUE_AS_NEW_REQUESTED"),
        CONTINUE_AS_NEW_STARTED("CONTINUE_AS_NEW_STARTED"),
        CONTINUE_AS_NEW_COMPLETED("CONTINUE_AS_NEW_COMPLETED"),
        RUN_CONTINUED_AS_NEW("RUN_CONTINUED_AS_NEW"),
        // Durable execution — timers
        TIMER_SCHEDULED("TIMER_SCHEDULED"),
        TIMER_FIRED("TIMER_FIRED"),
        TIMER_CANCELLED("TIMER_CANCELLED"),
        // Durable execution — leases + crash recovery
        RUN_LEASE_ACQUIRED("RUN_LEASE_ACQUIRED"),
        RUN_LEASE_RENEWED("RUN_LEASE_RENEWED"),
        RUN_LEASE_EXPIRED("RUN_LEASE_EXPIRED"),
        RUN_RECOVERY_STARTED("RUN_RECOVERY_STARTED"),
        RUN_RECOVERY_COMPLETED("RUN_RECOVERY_COMPLETED"),
        // Durable execution — failure incidents
        FAILURE_INCIDENT_CREATED("FAILURE_INCIDENT_CREATED"),
        // Durable execution — cooperative yielding (durable, low-frequency timeline events)
        RUN_YIELDED("RUN_YIELDED"),
        RUN_REENQUEUED("RUN_REENQUEUED"),
        /**
         * A run picked up again from its checkpoint — after an approval decision, a
         * timer, or a yield.
         *
         * Not RETRY_STARTED, which is what this used to be. Nothing had failed and
         * nothing was being re-attempted, but the UI grades severity by name
         * (`LogsTab`: any type containing "RETRY" renders `warn`), so approving a run
         * and watching it continue normally produced a warning on the timeline and the
         * question "why is it retrying?". The web layer has understood RUN_RESUMED all
         * along — badge, icon, label, compact styling — and only the worker never sent
         * one.
         */
        RUN_RESUMED("RUN_RESUMED"),
        // Scheduling-fairness signals. NOTE: these are operational and HIGH-FREQUENCY
        // under load — they are exposed ONLY via metrics/logs (WorkerMetrics.tenantThrottled
        // / poolSaturated) and MUST NOT be appendEvent'd to run_events per poll.
        // Kept here only so a deliberate, rate-limited timeline write could opt in later.
        TENANT_THROTTLED("TENANT_THROTTLED"),
        POOL_SATURATED("POOL_SATURATED"),
        // Agent Brain — iterative loop events
        AGENT_ITERATION_STARTED("AGENT_ITERATION_STARTED"),
        AGENT_ACTION_SELECTED("AGENT_ACTION_SELECTED"),
        AGENT_TOOL_SELECTED("AGENT_TOOL_SELECTED"),
        AGENT_TOOL_NOT_ALLOWED("AGENT_TOOL_NOT_ALLOWED"),
        AGENT_OBSERVATION_RECORDED("AGENT_OBSERVATION_RECORDED"),
        AGENT_MEMORY_UPDATED("AGENT_MEMORY_UPDATED"),
        AGENT_REFLECTION_CREATED("AGENT_REFLECTION_CREATED"),
        AGENT_FINAL_OUTPUT_CREATED("AGENT_FINAL_OUTPUT_CREATED"),
        AGENT_OUTPUT_VALIDATED("AGENT_OUTPUT_VALIDATED"),
        AGENT_OUTPUT_SCHEMA_INVALID("AGENT_OUTPUT_SCHEMA_INVALID"),
        AGENT_BUDGET_EXCEEDED("AGENT_BUDGET_EXCEEDED"),
        AGENT_MAX_ITERATIONS_REACHED("AGENT_MAX_ITERATIONS_REACHED"),
        AGENT_INVALID_ACTION("AGENT_INVALID_ACTION"),
        AGENT_APPROVAL_REQUESTED("AGENT_APPROVAL_REQUESTED"),
        AGENT_PLAN_CREATED("AGENT_PLAN_CREATED"),

        /**
         * Loop reconstruction declined and the step replayed from iteration 1.
         *
         * SKIPPED, not FAILED, and the distinction is not cosmetic: the timeline
         * grades event names, and a run that fell back is usually going to SUCCEED —
         * just more expensively. Naming it FAILED paints a red row on a green run and
         * sends someone looking for a break that is not there. Same reasoning as
         * RUN_RESUMED rather than RETRY_STARTED.
         *
         * The reason and the transcript snapshot ref travel in the metadata.
         */
        AGENT_LOOP_RECONSTRUCTION_SKIPPED("AGENT_LOOP_RECONSTRUCTION_SKIPPED"),

        /** Loop state was rebuilt; the step resumed mid-loop instead of replaying. */
        AGENT_LOOP_RECONSTRUCTED("AGENT_LOOP_RECONSTRUCTED"),

        /**
         * The assembled context hit the team's `maxContextChars`. §12.5.
         *
         * A BUDGET event, deliberately, and not a failure: sections were dropped
         * to fit and the iteration ran. It is named separately from
         * AGENT_BUDGET_EXCEEDED because that one is terminal — it stops the loop —
         * and this one is not, and a timeline that graded them the same would
         * paint a stopped run over a working one.
         *
         * The dropped sections and the char counts travel in the metadata, and the
         * same numbers are on the iteration span, so the trace and the timeline
         * cannot disagree about what the model was shown.
         */
        AGENT_CONTEXT_BUDGET_EXCEEDED("AGENT_CONTEXT_BUDGET_EXCEEDED"),
    }

    /**
     * Insert the event into `run_events` and publish to Redis.
     * Returns the assigned sequence number.
     *
     * This method is intentionally not transactional with the caller's DB
     * operations — events are appended on a best-effort basis. If the DB
     * write succeeds but Redis publish fails, the event is still persisted.
     */
    /**
     * Append one event.
     *
     * -- THE RETURN VALUE WHEN BATCHING IS ON -------------------------------
     * Returns the assigned sequence, as it always has, EXCEPT when the event was
     * buffered - then it returns [SEQ_BUFFERED], because the number does not
     * exist yet and inventing one would be worse than saying so. No caller in
     * the worker reads this value; a caller that needs the number must call
     * [appendEvents] directly, which is always synchronous.
     */
    open fun appendEvent(event: RunEvent): Int {
        if (batchEnabled && event.type !in neverBuffered) {
            emitBuffered(event)
            return SEQ_BUFFERED
        }
        /* A synchronous write must not overtake buffered events for the same run,
           or the timeline would number them out of emission order. Draining first
           is what keeps "sequence order == emission order" true with batching on. */
        if (batchEnabled) flush(event.runId)
        return appendEvents(listOf(event)).first()
    }

    /**
     * Queue an event for the next flush, flushing early if the run's buffer is full.
     *
     * Under the run's own lock, so emission order into the deque is the order the
     * flush will assign sequence numbers in.
     */
    private fun emitBuffered(event: RunEvent) {
        val lock = runLocks.computeIfAbsent(event.runId) { java.util.concurrent.locks.ReentrantLock() }
        lock.lock()
        val full: Boolean
        try {
            val q = pending.computeIfAbsent(event.runId) { ArrayDeque() }
            q.addLast(event)
            full = q.size >= batchSize
        } finally {
            lock.unlock()
        }
        if (full) flush(event.runId)
    }

    /**
     * Write everything buffered for one run.
     *
     * A failed flush is logged and the events are DISCARDED rather than retried
     * forever: [appendEvents] already retries a sequence conflict three times, so
     * reaching here means the database refused the write, and holding a growing
     * deque of undeliverable events until the JVM dies helps nobody. This is the
     * one place events are lost, it is bounded by one flush, and it is loud.
     */
    open fun flush(runId: UUID) {
        val lock = runLocks[runId] ?: return
        val batch: List<RunEvent>
        lock.lock()
        try {
            val q = pending[runId] ?: return
            if (q.isEmpty()) return
            batch = q.toList()
            q.clear()
        } finally {
            lock.unlock()
        }
        try {
            appendEvents(batch)
        } catch (e: Exception) {
            log.error("[events] flush of {} buffered event(s) failed [runId={}]: {}",
                batch.size, runId, e.message)
        }
    }

    /** Flush every run with pending events. */
    open fun flushAll() {
        pending.keys.toList().forEach { flush(it) }
    }

    /**
     * Append a batch of events for ONE run, under a single sequence allocation.
     *
     * -- WHY A BATCH IS A DIFFERENT METHOD AND NOT AN OPTIMISATION -----------
     * The semantics are identical to calling [appendEvent] N times - same order,
     * same contiguous numbers, same rows. What changes is that the per-run lock
     * is taken ONCE for N events instead of N times, which is the whole of 12.2
     * item 1. Fifty events per flush is fifty times fewer acquisitions.
     *
     * The events must all belong to the same run: the lock is per-run, and a
     * mixed batch would either take one run's lock while writing another's rows
     * (wrong) or take several (a deadlock waiting for an ordering bug). Callers
     * group; this refuses to guess.
     *
     * Returns the assigned sequence numbers, positionally.
     */
    open fun appendEvents(events: List<RunEvent>): List<Int> {
        if (events.isEmpty()) return emptyList()
        val runId = events.first().runId
        require(events.all { it.runId == runId }) {
            "appendEvents takes one run's events; group by runId before calling"
        }
        val seqs = insertEvents(events)
        events.forEachIndexed { i, e -> publishEvent(e, seqs[i]) }
        return seqs
    }

    /**
     * Drop the per-run sequence lock once a run reaches a terminal state.
     * Without this the lock map grows for the lifetime of the JVM.
     */
    open fun forgetRun(runId: UUID) {
        /* Flush BEFORE dropping the lock. Removing it first would leave the deque
           unreachable from [flush], which looks up the lock and returns when it is
           gone - the events would sit in `pending` until the JVM exits. */
        if (batchEnabled) flush(runId)
        pending.remove(runId)
        runLocks.remove(runId)
    }

    // ── DB insert ─────────────────────────────────────────────────────────────

    /**
     * Insert the event, serialized per run via an in-memory ReentrantLock.
     *
     * WHY in-memory locks instead of advisory locks or retries:
     *
     * - Retries: `SELECT MAX(sequence)+1` races under concurrency; 5 retries at
     *   10-50ms are insufficient when 4 branches emit events simultaneously.
     *
     * - Advisory locks (pg_advisory_xact_lock): holds a DB connection while
     *   waiting for the lock. With a 5-connection pool and 4 parallel branches
     *   each trying to acquire the same advisory lock, the pool exhausts before
     *   all branches get connections — causing connection-timeout failures that
     *   silently kill 3 of 4 parallel agent branches.
     *
     * - In-memory ReentrantLock per run_id: the lock is acquired BEFORE a
     *   DB connection is requested. Only one thread needs a connection at a time
     *   for events from the same run, so the 5-connection pool is never
     *   exhausted by event writes. Zero dropped events, no deadlock.
     */
    private fun insertEvents(events: List<RunEvent>): List<Int> {
        val event = events.first()
        // Get (or create) the per-run lock — ~48 bytes per entry; evicted on run
        // completion via [forgetRun].
        val lock = runLocks.computeIfAbsent(event.runId) { java.util.concurrent.locks.ReentrantLock() }
        lock.lock()
        try {
            // The in-memory lock serializes writers within THIS worker only.
            // If another worker writes events for the same run concurrently
            // (e.g. a brief lease handover), the UNIQUE(run_id, sequence)
            // constraint trips — retry with a freshly read sequence instead
            // of dropping the event.
            var lastError: Exception? = null
            repeat(3) { attempt ->
                try {
                    return doInsert(events)
                } catch (e: java.sql.SQLException) {
                    if (e.sqlState == "23505") { // unique_violation — sequence race with another worker
                        lastError = e
                        log.warn("[events] sequence conflict, retrying ({}/3) [runId={}, type={}, n={}]",
                            attempt + 1, event.runId, event.type.value, events.size)
                    } else throw e
                }
            }
            throw lastError ?: IllegalStateException("event insert failed after retries")
        } catch (e: Exception) {
            log.error("[events] failed to insert {} event(s) [runId={}, type={}]: {}",
                events.size, event.runId, event.type.value, e.message)
            throw e
        } finally {
            lock.unlock()
        }
    }

    private fun doInsert(events: List<RunEvent>): List<Int> {
        val runId = events.first().runId
        return dataSource.connection.use { conn ->
            conn.autoCommit = false
            try {
                /*
                 * ── SERIALIZE THE SEQUENCE ACROSS PROCESSES, NOT JUST THREADS ──
                 *
                 * `runLocks` orders event writers within this worker, and it is the
                 * right tool for that (see [insertEvent]). It says nothing about the
                 * API, which appends to `run_events` for the same run from a different
                 * JVM — a cancel, an approval decision, a manual replay. Both sides ran
                 * `SELECT MAX(sequence)+1` under READ COMMITTED, so both could read the
                 * same MAX and both insert the same number: one won and the other took
                 * a 23505 that the retry below papered over, at the cost of a warning
                 * per cancelled run and an extra round trip.
                 *
                 * Where the constraint is absent — after V028 the partitioned table
                 * carries only a plain index on (run_id, sequence) — nothing trips at
                 * all and the duplicate is simply written, which breaks the
                 * `?afterSequence=` cursor the run timeline pages on: two events share a
                 * number and one of them is never delivered to the open stream.
                 *
                 * The row lock removes the race rather than detecting it. It costs
                 * nothing extra to hold: the UPDATE below already locks this same row
                 * for the rest of the transaction, so this only takes that lock sooner.
                 * Both writers take it in the same order and touch no other row, so
                 * there is no cycle to deadlock on.
                 */
                /* ONE allocation for the whole batch. The block is contiguous and
                   assigned in list order, so a batch reads back in exactly the
                   order it was emitted. */
                val first = allocate(conn, runId, events.size)
                val seqs = List(events.size) { first + it }

                conn.prepareStatement(INSERT_SQL).use { stmt ->
                    events.forEachIndexed { i, e ->
                        bindInsert(stmt, e, seqs[i])
                        stmt.addBatch()
                    }
                    stmt.executeBatch()
                }

                /* History counters, aggregated. N events used to be N updates of the
                   same row inside the same transaction — every one of them a dead
                   tuple. One update per batch is the same arithmetic and one row
                   version. */
                val estimatedSize = events.sumOf { estimateEventSize(it) }
                conn.prepareStatement("""
                    UPDATE agent_runs
                    SET history_event_count = history_event_count + ?,
                        history_size_bytes  = history_size_bytes + ?,
                        updated_at          = now()
                    WHERE id = ?
                """.trimIndent()).use { stmt ->
                    stmt.setInt(1, events.size)
                    stmt.setLong(2, estimatedSize)
                    stmt.setObject(3, runId)
                    stmt.executeUpdate()
                }
                conn.commit()
                log.debug("[events] inserted {} event(s) [runId={}, firstSeq={}, estimatedSize={}]",
                    events.size, runId, first, estimatedSize)
                seqs
            } catch (e: Exception) {
                conn.rollback()
                throw e
            } finally {
                conn.autoCommit = true
            }
        }
    }

    /**
     * Rough estimate of the serialized size of an event in bytes.
     * Used for history_size_bytes tracking — precision not required.
     */
    private fun estimateEventSize(event: RunEvent): Long {
        var size = 200L  // base overhead: column names, types, timestamps, UUID fields
        size += event.type.value.length
        size += event.status.length
        size += event.title?.length ?: 0
        size += event.summary?.length ?: 0
        size += event.metadataJsonSanitized?.length ?: 0
        size += event.errorJsonSanitized?.length ?: 0
        return size.coerceAtLeast(100)
    }

    /**
     * Take the run's `agent_runs` row lock, so sequence assignment for this run is
     * serialized cluster-wide.
     *
     * A missing row (a run deleted mid-flight) locks nothing and is not an error here:
     * the event still gets written on a best-effort basis, exactly as before, and the
     * unique-violation retry in [insertEvent] remains the backstop for that case.
     */
    private fun lockRun(conn: java.sql.Connection, runId: UUID) {
        conn.prepareStatement("SELECT 1 FROM agent_runs WHERE id = ? FOR UPDATE").use { stmt ->
            stmt.setObject(1, runId)
            stmt.executeQuery().use { /* the lock is the point; the row is not read */ }
        }
    }

    /**
     * Reserve [count] consecutive sequence numbers for [runId] and return the first.
     *
     * Runs inside the caller's transaction in BOTH modes, deliberately: the lock
     * (whichever row it is on) must be held until the INSERT commits, or a second
     * writer can slip in between the allocation and the write and produce rows
     * whose `sequence` order does not match their commit order.
     */
    private fun allocate(conn: java.sql.Connection, runId: UUID, count: Int): Int =
        when (sequenceSource) {
            SequenceSource.RUN_ROW -> {
                lockRun(conn, runId)
                nextSequence(conn, runId)
            }
            SequenceSource.COUNTER -> allocateFromCounter(conn, runId, count)
        }

    /**
     * The counter row. One statement: lock, advance, return the block's first
     * number. Touches neither `agent_runs` nor any `run_events` partition.
     */
    private fun allocateFromCounter(conn: java.sql.Connection, runId: UUID, count: Int): Int {
        conn.prepareStatement("SELECT run_events_allocate_seq(?, ?)").use { stmt ->
            stmt.setObject(1, runId)
            stmt.setInt(2, count)
            stmt.executeQuery().use { rs ->
                rs.next()
                return rs.getInt(1)
            }
        }
    }

    private fun nextSequence(conn: java.sql.Connection, runId: UUID): Int {
        conn.prepareStatement(
            "SELECT COALESCE(MAX(sequence), 0) + 1 FROM run_events WHERE run_id = ?"
        ).use { stmt ->
            stmt.setObject(1, runId)
            stmt.executeQuery().use { rs ->
                rs.next()
                return rs.getInt(1)
            }
        }
    }

    private fun bindInsert(stmt: PreparedStatement, event: RunEvent, seq: Int) {
        var i = 1
        stmt.setObject(i++, event.runId)
        stmt.setObject(i++, event.workspaceId)
        stmt.setObject(i++, event.environmentId)
        stmt.setInt(i++, seq)
        stmt.setString(i++, event.type.value)
        stmt.setString(i++, event.status)
        stmt.setString(i++, event.source)
        stmt.setTimestamp(i++, Timestamp.from(Instant.now()))
        setNullableLong(stmt, i++, event.durationMs)
        setNullableString(stmt, i++, event.stepId)
        setNullableUuid(stmt, i++, event.agentId)
        setNullableString(stmt, i++, event.modelName)
        setNullableString(stmt, i++, event.title)
        setNullableString(stmt, i++, event.summary)
        setNullableInt(stmt, i++, event.tokenCount)
        setNullableDouble(stmt, i++, event.estimatedCost)
        setNullableString(stmt, i++, event.correlationId)
        setNullableString(stmt, i++, event.traceId)
        setNullableInt(stmt, i++, event.retryAttempt)
        setNullableJsonb(stmt, i++, event.metadataJsonSanitized)
        setNullableJsonb(stmt, i++, event.errorJsonSanitized)
        setNullableUuid(stmt, i++, event.spanId)
        setNullableUuid(stmt, i, event.activationId)
    }

    // ── Redis publish ─────────────────────────────────────────────────────────

    private fun publishEvent(event: RunEvent, seq: Int) {
        val channel = "run-events:${event.runId}"
        // Minimal envelope — no secrets, no raw payload
        val message = buildString {
            append("{")
            append(""""type":"${event.type.value}"""")
            append(""","status":"${event.status}"""")
            append(""","sequence":$seq""")
            append(""","runId":"${event.runId}"""")
            if (event.title != null) append(""","title":${jsonString(event.title)}""")
            if (event.summary != null) append(""","summary":${jsonString(event.summary)}""")
            append("}")
        }

        try {
            pubSub.sync().publish(channel, message)
            log.debug("[events] published to channel [{}] type={}", channel, event.type.value)
        } catch (e: Exception) {
            // Publish failure is non-fatal — event is already persisted in DB
            log.warn("[events] failed to publish to Redis [channel={}]: {}", channel, e.message)
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun setNullableString(stmt: PreparedStatement, i: Int, v: String?) =
        if (v != null) stmt.setString(i, v) else stmt.setNull(i, java.sql.Types.VARCHAR)

    private fun setNullableLong(stmt: PreparedStatement, i: Int, v: Long?) =
        if (v != null) stmt.setLong(i, v) else stmt.setNull(i, java.sql.Types.BIGINT)

    private fun setNullableInt(stmt: PreparedStatement, i: Int, v: Int?) =
        if (v != null) stmt.setInt(i, v) else stmt.setNull(i, java.sql.Types.INTEGER)

    private fun setNullableDouble(stmt: PreparedStatement, i: Int, v: Double?) =
        if (v != null) stmt.setDouble(i, v) else stmt.setNull(i, java.sql.Types.NUMERIC)

    private fun setNullableUuid(stmt: PreparedStatement, i: Int, v: UUID?) =
        if (v != null) stmt.setObject(i, v) else stmt.setNull(i, java.sql.Types.OTHER)

    private fun setNullableJsonb(stmt: PreparedStatement, i: Int, v: String?) {
        if (v != null) {
            val pgObj = org.postgresql.util.PGobject().apply { type = "jsonb"; value = v }
            stmt.setObject(i, pgObj)
        } else {
            stmt.setNull(i, java.sql.Types.OTHER)
        }
    }

    /** Minimal JSON string escaping for the publish envelope. */
    private fun jsonString(s: String): String =
        "\"${s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n").replace("\r", "").take(500)}\""

    companion object {
        /**
         * What [appendEvent] returns for an event that was buffered rather than
         * written. Negative so it can never be mistaken for a real sequence, which
         * starts at 1.
         */
        const val SEQ_BUFFERED = -1

        private val INSERT_SQL = """
            INSERT INTO run_events (
                run_id, workspace_id, environment_id, sequence,
                type, status, source, timestamp,
                duration_ms, step_id, agent_id, model_name,
                title, summary, token_count, estimated_cost,
                correlation_id, trace_id, retry_attempt,
                metadata_json_sanitized, error_json_sanitized,
                span_id, activation_id
            ) VALUES (
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?, ?,
                ?, ?, ?,
                ?, ?,
                ?, ?
            )
        """.trimIndent()
    }
}
