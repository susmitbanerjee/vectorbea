package com.vectorbea.worker.metrics

import com.sun.net.httpserver.HttpServer as JdkHttpServer
import org.slf4j.LoggerFactory
import java.net.InetSocketAddress
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.DoubleAdder

// ─────────────────────────────────────────────────────────────────────────────
// Worker-side in-process metrics — mirrors the API MetricsRegistry design.
//
// Worker metrics are exposed on a separate lightweight HTTP server (default
// port 9090) so the main workflow queue is not burdened and so the metrics
// port can be firewalled independently from the API port.
//
// Thread-safety: same lock-free atomic primitives as the API counterpart.
// ─────────────────────────────────────────────────────────────────────────────

// ── Primitives ────────────────────────────────────────────────────────────────

internal class WCounter(val name: String, val help: String, val labelNames: List<String>) {
    val cells = ConcurrentHashMap<List<String>, AtomicLong>()
    fun inc(vararg lv: String, delta: Long = 1) {
        cells.getOrPut(LabelGuard.guard(name, lv.toList())) { AtomicLong(0) }.addAndGet(delta)
    }
    fun exposition() = buildString {
        // The HELP/TYPE header must name the SAME family as the samples.
        //
        // This emitted `# TYPE lease_expiry counter` while the samples were named
        // `lease_expiry_total` — so the declared family had no samples and the samples
        // belonged to no declared family. Prometheus ingests it either way, which is why
        // nobody noticed: the series exists but is UNTYPED, so nothing validates that
        // `rate()` is being applied to a counter, and a type-aware consumer sees nothing
        // at all.
        //
        // Found by scripts/load/verify-metrics.mjs, which looked for each §5.4 metric by
        // its documented name and could not find five of them.
        val family = "${name}_total"
        append("# HELP $family $help\n# TYPE $family counter\n")
        if (cells.isEmpty()) append("$family 0.0\n")
        else cells.forEach { (lbs, c) -> append("$family${ls(lbs)} ${c.get().toDouble()}\n") }
    }
    private fun ls(v: List<String>): String {
        if (labelNames.isEmpty() || v.isEmpty()) return ""
        return "{" + labelNames.zip(v).joinToString(",") { (k, vv) -> "$k=\"${vv.esc()}\"" } + "}"
    }
}

internal class WGauge(val name: String, val help: String, val labelNames: List<String>) {
    val cells = ConcurrentHashMap<List<String>, DoubleAdder>()
    fun set(value: Double, vararg lv: String) {
        val a = cells.getOrPut(LabelGuard.guard(name, lv.toList())) { DoubleAdder() }
        synchronized(a) { a.reset(); a.add(value) }
    }
    fun inc(vararg lv: String) { cells.getOrPut(LabelGuard.guard(name, lv.toList())) { DoubleAdder() }.add(1.0) }
    fun dec(vararg lv: String) { cells.getOrPut(LabelGuard.guard(name, lv.toList())) { DoubleAdder() }.add(-1.0) }
    fun exposition() = buildString {
        append("# HELP $name $help\n# TYPE $name gauge\n")
        if (cells.isEmpty()) append("$name 0.0\n")
        else cells.forEach { (lbs, a) -> append("$name${ls(lbs)} ${a.sum()}\n") }
    }
    private fun ls(v: List<String>): String {
        if (labelNames.isEmpty() || v.isEmpty()) return ""
        return "{" + labelNames.zip(v).joinToString(",") { (k, vv) -> "$k=\"${vv.esc()}\"" } + "}"
    }
}

internal class WHistogram(val name: String, val help: String, val labelNames: List<String>) {
    companion object { val BUCKETS = longArrayOf(5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000) }
    data class Cell(val bc: Array<AtomicLong>, val sum: DoubleAdder, val count: AtomicLong)
    val cells = ConcurrentHashMap<List<String>, Cell>()
    fun observe(ms: Long, vararg lv: String) {
        val c = cells.getOrPut(lv.toList()) { Cell(Array(BUCKETS.size + 1) { AtomicLong(0) }, DoubleAdder(), AtomicLong(0)) }
        for (i in BUCKETS.indices) if (ms <= BUCKETS[i]) c.bc[i].incrementAndGet()
        c.bc[BUCKETS.size].incrementAndGet(); c.sum.add(ms.toDouble()); c.count.incrementAndGet()
    }
    fun exposition() = buildString {
        append("# HELP $name $help\n# TYPE $name histogram\n")
        if (cells.isEmpty()) {
            for (i in BUCKETS.indices) append("${name}_bucket{le=\"${BUCKETS[i]}\"} 0.0\n")
            append("${name}_bucket{le=\"+Inf\"} 0.0\n${name}_count 0.0\n${name}_sum 0.0\n")
        } else cells.forEach { (lbs, c) ->
            for (i in BUCKETS.indices) append("${name}_bucket${ls(lbs,"le" to BUCKETS[i].toString())} ${c.bc[i].get().toDouble()}\n")
            append("${name}_bucket${ls(lbs,"le" to "+Inf")} ${c.bc[BUCKETS.size].get().toDouble()}\n")
            append("${name}_count${ls(lbs)} ${c.count.get().toDouble()}\n")
            append("${name}_sum${ls(lbs)} ${c.sum.sum()}\n")
        }
    }
    private fun ls(v: List<String>, extra: Pair<String,String>? = null): String {
        val pairs = labelNames.zip(v) + listOfNotNull(extra)
        if (pairs.isEmpty()) return ""
        return "{" + pairs.joinToString(",") { (k, vv) -> "$k=\"${vv.esc()}\"" } + "}"
    }
}

/**
 * Histogram whose unit is **seconds** (Prometheus base unit) with buckets that
 * span the range this worker actually sees: sub-millisecond DB reads through
 * five-minute agent runs. Observations are still supplied in milliseconds
 * because that is what the call sites measure.
 */
internal class WSecondsHistogram(val name: String, val help: String, val labelNames: List<String>) {
    companion object {
        val BUCKETS = doubleArrayOf(
            0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5,
            1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0,
        )
        private fun fmt(d: Double) = if (d == d.toLong().toDouble()) "${d.toLong()}.0" else d.toString()
    }

    class Cell(val bc: Array<AtomicLong>, val sum: DoubleAdder, val count: AtomicLong)

    val cells = ConcurrentHashMap<List<String>, Cell>()

    fun observeSeconds(seconds: Double, vararg lv: String) {
        val key = LabelGuard.guard(name, lv.toList())
        val c = cells.getOrPut(key) {
            Cell(Array(BUCKETS.size + 1) { AtomicLong(0) }, DoubleAdder(), AtomicLong(0))
        }
        for (i in BUCKETS.indices) if (seconds <= BUCKETS[i]) c.bc[i].incrementAndGet()
        c.bc[BUCKETS.size].incrementAndGet()
        c.sum.add(seconds)
        c.count.incrementAndGet()
    }

    fun observeMs(ms: Long, vararg lv: String) = observeSeconds(ms / 1000.0, *lv)

    fun exposition() = buildString {
        append("# HELP $name $help\n# TYPE $name histogram\n")
        if (cells.isEmpty()) {
            for (b in BUCKETS) append("${name}_bucket{le=\"${fmt(b)}\"} 0.0\n")
            append("${name}_bucket{le=\"+Inf\"} 0.0\n${name}_count 0.0\n${name}_sum 0.0\n")
        } else cells.forEach { (lbs, c) ->
            for (i in BUCKETS.indices) {
                append("${name}_bucket${ls(lbs, "le" to fmt(BUCKETS[i]))} ${c.bc[i].get().toDouble()}\n")
            }
            append("${name}_bucket${ls(lbs, "le" to "+Inf")} ${c.bc[BUCKETS.size].get().toDouble()}\n")
            append("${name}_count${ls(lbs)} ${c.count.get().toDouble()}\n")
            append("${name}_sum${ls(lbs)} ${c.sum.sum()}\n")
        }
    }

    private fun ls(v: List<String>, extra: Pair<String, String>? = null): String {
        val pairs = labelNames.zip(v) + listOfNotNull(extra)
        if (pairs.isEmpty()) return ""
        return "{" + pairs.joinToString(",") { (k, vv) -> "$k=\"${vv.esc()}\"" } + "}"
    }
}

/**
 * Counter accumulating a floating-point quantity (e.g. seconds of blocked time).
 * Unlike [WCounter] the exposed series name is used verbatim — no `_total`
 * suffix is appended — because the metric name already carries its unit.
 */
internal class WDoubleCounter(val name: String, val help: String, val labelNames: List<String>) {
    val cells = ConcurrentHashMap<List<String>, DoubleAdder>()
    fun add(delta: Double, vararg lv: String) {
        cells.getOrPut(LabelGuard.guard(name, lv.toList())) { DoubleAdder() }.add(delta)
    }
    fun exposition() = buildString {
        append("# HELP $name $help\n# TYPE $name counter\n")
        if (cells.isEmpty()) append("$name 0.0\n")
        else cells.forEach { (lbs, a) -> append("$name${ls(lbs)} ${a.sum()}\n") }
    }
    private fun ls(v: List<String>): String {
        if (labelNames.isEmpty() || v.isEmpty()) return ""
        return "{" + labelNames.zip(v).joinToString(",") { (k, vv) -> "$k=\"${vv.esc()}\"" } + "}"
    }
}

/**
 * Bounds label cardinality per metric.
 *
 * Several metrics below are labelled by `workspace`, which is a UUID supplied by
 * whoever is using the platform. Left unbounded that is a memory leak in the
 * worker and a cardinality explosion in Prometheus: one time series per
 * workspace per label combination, retained forever. Once a metric has seen
 * [MAX_SERIES_PER_METRIC] distinct label sets, further ones collapse into a
 * single `overflow` series so the endpoint degrades in fidelity rather than
 * taking the process with it.
 */
internal object LabelGuard {
    private const val MAX_SERIES_PER_METRIC = 1_000
    private val seen = ConcurrentHashMap<String, MutableSet<List<String>>>()

    fun guard(metric: String, labels: List<String>): List<String> {
        if (labels.isEmpty()) return labels
        val set = seen.getOrPut(metric) { ConcurrentHashMap.newKeySet() }
        if (set.contains(labels)) return labels
        if (set.size >= MAX_SERIES_PER_METRIC) return labels.map { "overflow" }
        set.add(labels)
        return labels
    }
}

private fun String.esc() = replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")

// ── Worker metric definitions ─────────────────────────────────────────────────

object WorkerMetrics {
    private val log = LoggerFactory.getLogger(WorkerMetrics::class.java)

    // Gauge: currently-active (in-flight) tasks
    /**
     * §5.4: `worker_in_flight{worker_id}`.
     *
     * Renamed from `worker_active_tasks` and given the worker_id label it was missing.
     * Without the label a three-replica fleet summed to one number, which answers "is
     * the fleet busy" and not "is THIS worker stuck" - and the second question is the
     * one you ask when a run is not progressing.
     */
    internal val activeTasks = WGauge("worker_in_flight", "Runs currently executing on this worker", listOf("worker_id"))

    // Gauge: seconds since the last heartbeat was written (updated by heartbeat component)
    internal val heartbeatAgeSeconds = WGauge("worker_heartbeat_age_seconds", "Seconds since the last worker heartbeat was written", emptyList())

    // Counters: run outcomes
    internal val runsQueued    = WCounter("worker_workflow_runs_queued",    "Total workflow runs picked up from the queue",    emptyList())
    internal val runsSucceeded = WCounter("worker_workflow_runs_succeeded", "Total workflow runs completed with status succeeded", emptyList())
    internal val runsFailed    = WCounter("worker_workflow_runs_failed",    "Total workflow runs completed with status failed",    emptyList())
    internal val runsCancelled = WCounter("worker_workflow_runs_cancelled", "Total workflow runs cancelled",                       emptyList())

    // Histogram: run end-to-end duration.  Labels: job_type
    internal val runDuration = WHistogram("worker_run_duration_ms", "Workflow run duration in milliseconds", listOf("job_type"))

    // Histograms: connector latency.  Labels: connector_type
    internal val llmCallDuration  = WHistogram("worker_llm_call_duration_ms",  "LLM connector call duration in milliseconds",       listOf("provider"))
    internal val httpToolDuration = WHistogram("worker_http_tool_duration_ms", "HTTP tool call duration in milliseconds",            listOf("method"))
    internal val dbToolDuration   = WHistogram("worker_db_tool_duration_ms",   "DB tool call duration in milliseconds",              listOf("db_type"))

    // Counter: connector failures.  Labels: connector_type
    internal val connectorFailures = WCounter("worker_connector_failures_total", "Total connector call failures", listOf("connector_type"))

    // ── Scheduling / fairness / durable-tick metrics ────────────────────────────
    // Gauge: in-flight runs per execution pool.  Labels: pool
    internal val activeRunsByPool = WGauge("worker_active_runs_by_pool", "In-flight runs per execution pool", listOf("pool"))
    // Gauge: free execution slots per pool.  Labels: pool
    internal val poolCapacityAvailable = WGauge("worker_pool_capacity_available", "Free execution slots per pool", listOf("pool"))
    // Counters: queue consumer accounting.  Labels: job_type where useful
    internal val messagesRead     = WCounter("worker_messages_read",     "Stream messages read from Redis",            emptyList())
    internal val messagesAck      = WCounter("worker_messages_ack",      "Stream messages acknowledged after processing", emptyList())
    internal val messagesDeferred = WCounter("worker_messages_deferred", "Messages buffered/deferred (pool saturated)",   listOf("job_type"))
    internal val tenantThrottled  = WCounter("worker_tenant_throttled",  "Times a tenant was throttled",               emptyList())
    internal val poolSaturated    = WCounter("worker_pool_saturated",    "Times a pool had no capacity for a ready job", listOf("pool"))
    internal val runYields        = WCounter("worker_run_yields",        "Runs that yielded mid-execution (budget exhausted)", listOf("reason"))

    /**
     * Spans that never reached Postgres, by cause.
     *
     * Two causes, deliberately separate, because they call for different responses:
     * `buffer_full` means the writer is behind and the fix is throughput;
     * `write_failed` means the table rejected the batch and the fix is the database.
     * Either being non-zero means a trace is incomplete and the UI must say so.
     */
    internal val spansDropped     = WCounter("worker_trace_spans_dropped",   "Spans discarded before reaching Postgres",  listOf("cause"))
    internal val spansWritten     = WCounter("worker_trace_spans_written",   "Spans durably written to run_spans",        emptyList())
    internal val runReenqueued    = WCounter("worker_run_reenqueued",    "RESUME_RUN jobs re-enqueued after a yield",   emptyList())
    // Histogram: per-tick execution duration
    internal val runTickDuration  = WHistogram("worker_run_tick_duration_ms", "Duration of a single run execution tick", listOf("job_type"))

    // ── Redis-pressure metrics ──────────────────────────────────────────────────
    internal val redisXadd        = WCounter("worker_redis_stream_xadd",        "XADD writes issued by the worker (re-enqueue + DLQ)", emptyList())
    internal val redisXreadgroup  = WCounter("worker_redis_stream_xreadgroup",  "XREADGROUP calls issued by the worker",              emptyList())
    internal val redisXack        = WCounter("worker_redis_stream_xack",        "XACK calls issued by the worker",                    emptyList())
    internal val pelParked        = WCounter("worker_pel_parked",               "Messages left unacked in the PEL (pool saturated)",  listOf("pool"))
    internal val pelReclaimed     = WCounter("worker_pel_reclaimed",            "Messages reclaimed from the PEL via XAUTOCLAIM",     emptyList())
    // Gauge: current adaptive poll backoff (ms)
    internal val pollBackoffMs    = WGauge("worker_poll_backoff_ms",            "Current adaptive poll-loop backoff in ms",           emptyList())
    // Gauge: local prefetch buffer size per pool
    internal val localBufferSize  = WGauge("worker_local_buffer_size",          "Messages buffered locally awaiting a free slot",     listOf("pool"))
    /**
     * Current adaptive XREADGROUP batch size. Falling toward 1 means messages are
     * being parked in the PEL — the worker is pulling work it cannot start and
     * backing off. Pinned at the configured maximum means every read is placeable.
     */
    internal val readBatchSize    = WGauge("worker_read_batch_size",            "Current adaptive XREADGROUP COUNT",                  emptyList())

    // ── Capacity, latency and fairness — the scheduling contract ───────────────
    //
    // These answer the four questions an operator has during an incident:
    //   "is the worker full?"           → pool_slots_total / pool_slots_active
    //   "is it hoarding work?"          → pel_depth
    //   "how long until a run starts?"  → job_wait_before_start_seconds
    //   "is one tenant eating it?"      → tenant_active_runs / tenant_throttled_total

    /** Configured width of each execution pool. */
    internal val poolSlotsTotal = WGauge("worker_pool_slots_total", "Configured execution slots per pool", listOf("pool"))

    /** Slots currently occupied by an in-flight run. */
    internal val poolSlotsActive = WGauge("worker_pool_slots_active", "Occupied execution slots per pool", listOf("pool"))

    /**
     * Messages THIS worker has read from the consumer group and not yet XACKed.
     *
     * This is the metric that makes §1.2 of the execution architecture visible:
     * a message in this worker's PEL cannot be taken by any other worker until
     * the idle threshold expires. Depth rising while [poolSlotsActive] is flat
     * is head-of-line blocking at the stream layer, not a capacity problem.
     */
    internal val pelDepth = WGauge("worker_pel_depth", "Stream messages held unacked by this worker", listOf("stream"))

    /** Cost of the classifier's Postgres probe, which sits on the hot path (§6.1). */
    internal val jobClassifyDurationSeconds = WSecondsHistogram(
        "job_classify_duration_seconds", "Time to classify a job into an execution class", listOf("result"))

    /**
     * XADD → RUN_STARTED: the latency a user actually experiences between
     * pressing Run and the run beginning. Measured from the Redis stream message
     * ID, which is a millisecond timestamp assigned at enqueue.
     */
    internal val jobWaitBeforeStartSeconds = WSecondsHistogram(
        "job_wait_before_start_seconds", "Seconds between enqueue (XADD) and RUN_STARTED", listOf("class"))

    /** In-flight runs per (workspace, execution class). */
    internal val tenantActiveRuns = WGauge(
        "tenant_active_runs", "In-flight runs per workspace and execution class", listOf("workspace", "class"))

    /** Admission refusals, by why. */
    internal val tenantThrottledTotal = WCounter(
        "tenant_throttled", "Times a workspace was refused admission", listOf("workspace", "reason"))

    /**
     * Times the authoritative `run_leases` count came back **above** the
     * workspace's limit — i.e. the advisory cache admitted more than policy
     * allows during its staleness window.
     *
     * This is the honest price of not putting a database round trip on the
     * admission hot path, and it is measured rather than assumed. Flat means the
     * window is small enough. Climbing means either shorten
     * `TENANT_LOAD_STALENESS_MS` or fold the check into the claim (S06), which
     * removes the window entirely.
     *
     * Note what this does NOT indicate: duplicate execution. That is prevented
     * by the unique lease row per run, independently of anything here.
     */
    internal val tenantAdmissionOvershoot = WCounter(
        "tenant_admission_overshoot",
        "Times the authoritative lease count exceeded the workspace limit",
        listOf("workspace", "dimension"))

    /**
     * Runs that acquired a lease and were then refused by the hard gate.
     *
     * This is the "wasted acquire attempt" the design trades for keeping the
     * admission hot path off the database: the run took a lease, discovered an
     * older lease already filled the tenant's quota, and released it. Cheap and
     * self-correcting — but if it climbs, the advisory cache is too stale and
     * `TENANT_LOAD_STALENESS_MS` should come down.
     */
    internal val tenantClaimRejected = WCounter(
        "tenant_claim_rejected", "Runs refused at lease-claim time by the hard gate",
        listOf("workspace", "class"))

    /** Cost of the shared admission query — it runs off the hot path, but not for free. */
    internal val tenantLoadQuerySeconds = WSecondsHistogram(
        "tenant_load_query_seconds", "Duration of the run_leases tenant-load query", emptyList())

    /** Outbound call latency, by outcome — timeouts are visible as their own series. */
    internal val llmCallDurationSeconds = WSecondsHistogram(
        "llm_call_duration_seconds", "LLM provider call duration", listOf("provider", "outcome"))
    internal val toolCallDurationSeconds = WSecondsHistogram(
        "tool_call_duration_seconds", "HTTP tool call duration", listOf("method", "outcome"))
    internal val tenantDbCallDurationSeconds = WSecondsHistogram(
        "tenant_db_call_duration_seconds", "Tenant database call duration", listOf("op", "outcome"))

    /**
     * Accumulated seconds that pool threads spent parked on blocking outbound
     * I/O. Divide by the scrape interval for "threads blocked on average" — if
     * that approaches [poolSlotsTotal] for a pool, that pool is not computing,
     * it is waiting, and adding replicas buys nothing.
     */
    internal val threadBlockedSeconds = WDoubleCounter(
        "thread_blocked_seconds", "Seconds pool threads spent blocked on outbound I/O", listOf("pool"))

    /** Leases that expired rather than being renewed or released — crash proxy. */
    internal val leaseExpiryTotal = WCounter("lease_expiry", "Run leases observed expired", listOf("source"))

    // ── The resume reconciler ─────────────────────────────────────────────────
    //
    // `resumeReconciled` climbing steadily is not a healthy platform: every
    // increment is a run that was parked with nothing coming for it, rescued by
    // a sweep. The label says WHICH of the four broken enqueue paths did it, so
    // a rise points at the one to fix rather than at "Redis was flaky".
    internal val resumeReconciled = WCounter("resume_reconciled",
        "Parked runs re-enqueued by the reconciler", listOf("reason"))
    internal val resumeReconcileFailed = WCounter("resume_reconcile_failed",
        "Reconciler enqueue attempts that threw", listOf("reason"))
    // Any increment here is a run a person has to look at.
    internal val resumeDeadLettered = WCounter("resume_dead_lettered",
        "Parked runs the reconciler gave up on", listOf("reason"))

    // ── Exactly-once guards ───────────────────────────────────────────────────

    /**
     * Writes rejected because the worker no longer held the lease.
     *
     * A non-zero *rate* is a real signal, not noise: it means leases are being
     * lost while work is still running, so either the TTL is too short for the
     * workload or workers are overloaded enough to miss their heartbeats. Either
     * way, runs are being executed twice up to the point of the fence.
     */
    internal val fencedWriteTotal = WCounter(
        "fenced_write", "Writes rejected because the lease was reassigned", listOf("operation"))

    /**
     * External calls skipped because the same logical operation already
     * succeeded — the mechanism doing its job.
     *
     * Near zero in steady state. **Non-zero under chaos testing is the proof it
     * works**: it counts the emails that would otherwise have been sent twice.
     */
    internal val sideEffectDedupeTotal = WCounter(
        "side_effect_dedupe", "External calls skipped because already performed", listOf("effect_type"))

    /**
     * Side effects whose outcome could not be established — a previous attempt
     * died mid-call and we refuse to guess.
     *
     * Every one of these needs a human. The node fails rather than risk a
     * duplicate, which is the right trade for an email or a payment and should
     * be rare enough to investigate individually.
     */
    internal val sideEffectUndeterminedTotal = WCounter(
        "side_effect_undetermined", "Side effects with an unresolvable outcome", listOf("effect_type"))

    /** Jobs that exhausted max_attempts and were dead-lettered. */
    internal val deadLetterTotal = WCounter(
        "dead_letter", "Jobs moved to dead_letters after exhausting attempts", listOf("reason"))

    /** Lease extensions that failed because the lease had been reassigned. */
    internal val leaseStolenTotal = WCounter(
        "lease_stolen", "Lease heartbeats that found the lease reassigned", emptyList())

    /** Messages recovered from another consumer's PEL via XAUTOCLAIM. */
    internal val xautoclaimReclaimTotal = WCounter("xautoclaim_reclaim", "Messages reclaimed via XAUTOCLAIM", emptyList())

    // ── Postgres-claim scheduler ──────────────────────────────────────────────

    /**
     * Claim round-trip latency. The number the brief asks to keep under 100ms p95.
     *
     * This is the cost of the transport swap: every claim is now a Postgres query
     * rather than an XREADGROUP. If it degrades, the index is not being used —
     * check that the plan still walks `agent_runs_claim_idx` rather than sorting.
     */
    internal val claimDurationSeconds = WSecondsHistogram(
        // §5.4 names this `job_claim_latency_seconds`. Renamed from
        // `claim_duration_seconds` so the dashboards, the alert and the doc all say the
        // same word; the metric is unchanged.
        "job_claim_latency_seconds", "SKIP LOCKED claim round-trip", listOf("class"))

    /**
     * Run-level ceilings hit, by dimension.
     *
     * `steps` climbing is the signal that matters most: it usually means agent
     * loops in the wild are not reaching their exit conditions, which is a product
     * problem the ceiling is only containing. `cost` climbing means the default is
     * too low for real workloads, or too high to protect anyone.
     */
    internal val ceilingBreachTotal = WCounter(
        "run_ceiling_breach", "Runs ended by a per-run ceiling", listOf("dimension"))

    /**
     * Circuit breaker activity.
     *
     * `opened` climbing is a provider incident, not a platform one — the label
     * that matters is which connection. `rejected` is the win being measured:
     * every increment is a call that failed in microseconds instead of burning a
     * 30s socket timeout and a worker permit with it.
     */
    internal val circuitOpenedTotal = WCounter("circuit_opened", "Connection circuits opened", emptyList())
    internal val circuitClosedTotal = WCounter("circuit_closed", "Connection circuits recovered", emptyList())
    // No connection label: connection ids are unbounded, and one Prometheus series
    // per connection is how a metrics backend falls over. Which connection is open
    // is already in `connections.circuit_state`, queryable and shown in the UI.
    internal val circuitRejectedTotal = WCounter(
        "circuit_rejected", "Calls rejected fast by an open circuit", emptyList())

    /** Provider 429s that suspended a run instead of holding its permit. */
    internal val providerThrottleSuspendTotal = WCounter(
        // §5.4: `provider_429_total{provider}`. The `_total` suffix is appended by the
        // counter renderer, so the name here stops at `provider_429`.
        "provider_429", "Runs suspended after a provider 429", listOf("provider"))

    /**
     * Provider calls the capacity bucket refused. §12.4.
     *
     * Separate from `provider_429`, and the difference is the point: a 429 is the
     * provider refusing us, this is us refusing ourselves BEFORE the request. The
     * first rising while the second stays flat means the bucket is set too high.
     */
    internal val providerCapacityExhaustedTotal = WCounter(
        "provider_capacity_exhausted", "Calls deferred by the local token bucket",
        listOf("provider", "model"))

    /** Runs claimed, by class. */
    internal val claimedTotal = WCounter("claimed", "Runs claimed from Postgres", listOf("class"))

    /**
     * Runs claimed while only the reserved priority permits were free.
     *
     * Every increment is a run that would have queued behind ordinary traffic
     * without the reserve. Flat at zero means the reserve is never being used and
     * could be released back to general capacity; climbing steadily means the pool
     * is undersized, and the demo lane is masking it.
     */
    internal val claimReservedLaneTotal = WCounter(
        "claim_reserved_lane", "Runs claimed from the reserved priority slots", listOf("class"))

    /** Runs recovered from a stale `claimed` state — a worker died before leasing. */
    internal val claimReclaimedTotal = WCounter(
        "claim_reclaimed", "Runs returned to the queue after a stale claim", emptyList())

    /**
     * Wakeups, by source.
     *
     * `notify` near zero while `safety_poll` climbs is the pooler trap: LISTEN
     * was silently dropped and the system is running on the fallback poll while
     * looking event-driven. See ClaimWakeup.
     */
    internal val claimWakeupTotal = WCounter(
        "claim_wakeup", "Claim-loop wakeups by source", listOf("source"))

    // ── Isolated tenant-database dispatcher ───────────────────────────────────
    //
    // Watched separately from the execution pools on purpose: the whole point of
    // the dispatcher is that these numbers can saturate without any pool metric
    // moving. `tenant_db_slots_active` at its ceiling while
    // `worker_pool_slots_active` is healthy is containment working, not an outage.

    internal val tenantDbSlotsTotal = WGauge(
        "tenant_db_slots_total", "Threads available for tenant-database node execution", emptyList())
    internal val tenantDbSlotsActive = WGauge(
        "tenant_db_slots_active", "Tenant-database queries currently executing", emptyList())
    internal val tenantDbQueueDepth = WGauge(
        "tenant_db_queue_depth", "Tenant-database node executions waiting for a thread", emptyList())

    /**
     * Nodes refused because the dispatcher was full.
     *
     * Non-zero means one or more tenant databases are unresponsive and the
     * platform chose to fail those runs rather than let the hang spread. It is
     * the metric to alert on for "a customer's database is down", and it should
     * be read alongside `tenant_db_call_duration_seconds{outcome="socket_timeout"}`.
     */
    internal val tenantDbRejectedTotal = WCounter(
        "tenant_db_rejected", "Tenant-database nodes refused because the dispatcher was full", emptyList())

    // ── JVM cost of the configured pool sizes ─────────────────────────────────
    //
    // Thread-per-run has a real ceiling and these are how it is found. Sampled at
    // scrape time rather than tracked continuously — they are process facts, not
    // events.

    internal val jvmThreads = WGauge("jvm_threads_live", "Live JVM threads", emptyList())
    internal val jvmThreadsPeak = WGauge("jvm_threads_peak", "Peak live JVM threads since start", emptyList())
    internal val jvmHeapUsedBytes = WGauge("jvm_heap_used_bytes", "Used heap", emptyList())
    internal val jvmHeapMaxBytes = WGauge("jvm_heap_max_bytes", "Maximum heap", emptyList())
    internal val jvmCpuSeconds = WGauge("jvm_process_cpu_seconds", "Process CPU time consumed", emptyList())
    internal val jvmCpuLoad = WGauge("jvm_process_cpu_load", "Process CPU load, 0..1 across all cores", emptyList())

    // ── §5.4 metrics that did not exist before ────────────────────────────────

    /**
     * Free execution slots across every pool on this worker.
     *
     * §5.4 lists `worker_slots_available` unlabelled, and that is deliberate: it is the
     * number an operator glances at to answer "can this worker take more work". The
     * per-pool breakdown is still there as `worker_pool_capacity_available{pool}` for
     * when the answer is "yes overall, no for agents".
     */
    internal val workerSlotsAvailable = WGauge(
        "worker_slots_available", "Free execution slots across all pools on this worker", emptyList())

    /**
     * Runs waiting in Postgres, by workspace and priority.
     *
     * Sampled rather than incremented: queue depth is a property of a table that many
     * processes write, so counting locally would drift the moment anything else claimed
     * or enqueued. [sampleQueueDepth] runs on scrape.
     */
    internal val jobQueueDepth = WGauge(
        "job_queue_depth", "Runs queued and not yet claimed", listOf("workspace", "priority"))

    /**
     * How long a node took, by kind.
     *
     * `worker_run_duration_ms` measures whole runs, which conflates "the model was slow"
     * with "the workflow has forty nodes". §5.4 asks for the per-node view by node_kind,
     * which is the one that identifies WHICH step is slow.
     */
    internal val jobExecutionDurationSeconds = WSecondsHistogram(
        "job_execution_duration_seconds", "Node execution duration", listOf("node_kind", "outcome"))

    /**
     * Time spent waiting for a connection from the pool.
     *
     * §5.4: "rising means the DB pool is the bottleneck". This is the metric that
     * distinguishes a slow query from no connection to run it on - two problems with
     * identical symptoms at the request layer and opposite fixes.
     */
    internal val dbPoolWaitSeconds = WSecondsHistogram(
        "db_pool_wait_seconds", "Time waiting to acquire a pooled connection", listOf("pool"))

    /**
     * Runs that suspended rather than holding a slot.
     *
     * §5.4: "should be free; confirm it isn't holding slots". The confirmation is the
     * pairing - this counter climbing while `worker_in_flight` does not is suspension
     * working. Both climbing together means a suspend path is still occupying a permit.
     */
    internal val runSuspendedTotal = WCounter(
        "run_suspended", "Runs suspended without holding an execution slot", listOf("reason"))

    /**
     * Where the queue-depth sample comes from.
     *
     * Set by Main once the DataSource exists. Null in tests and before startup, in which
     * case the gauge simply reports nothing rather than the process failing to scrape.
     */
    @Volatile var queueDepthSource: (() -> List<Triple<String, String, Long>>)? = null

    private fun sampleQueueDepth() {
        val source = queueDepthSource ?: return
        try {
            for ((workspace, priority, depth) in source()) {
                jobQueueDepth.set(depth.toDouble(), workspace, priority)
            }
        } catch (_: Exception) { /* a scrape must not fail because Postgres is busy */ }
    }

    // ── Cost ──────────────────────────────────────────────────────────────────
    //
    // ON THE CARDINALITY OF THESE THREE
    // ---------------------------------
    // `workspace` and `workflow` are both unbounded in principle — one series per
    // (workspace, workflow, model) combination, retained for the full 15 days. That is
    // the highest-cardinality thing in this process by a wide margin.
    //
    // It is accepted rather than avoided, for a specific reason: "which customer is
    // costing me money" is the question this system's economics depend on, and it
    // cannot be answered by an aggregate. LabelGuard caps each metric at 1,000 distinct
    // label sets and collapses the rest into `overflow`, so the failure mode is a
    // dashboard that stops distinguishing the long tail — not a worker that runs out of
    // memory.
    //
    // If that cap is ever reached, the right move is to drop `workflow` from the labels
    // and read per-workflow cost from `agent_runs.estimated_cost_usd` in Postgres,
    // where it already lives and where cardinality is free. Prometheus is the wrong
    // store for high-cardinality attribution; it is used here only because the
    // cardinality is currently small and the convenience is real.

    /** Tokens consumed, split by direction so input/output pricing can be applied. */
    internal val llmTokensTotal = WCounter(
        "llm_tokens", "Tokens consumed by model calls",
        listOf("workspace", "workflow", "model", "direction"))

    /**
     * Estimated spend in USD micros.
     *
     * Micros rather than dollars because this is an integer counter and a fractional
     * cent per call would truncate to zero — the metric would read 0.0 forever while
     * real money was being spent, which is the worst possible failure for a cost meter.
     * The dashboard divides by 1e6.
     */
    internal val llmCostMicros = WCounter(
        "llm_cost_usd_micros", "Estimated model spend in USD micros",
        listOf("workspace", "workflow", "model"))

    /** Model calls, so cost per call and call volume are both available. */
    internal val llmCallsTotal = WCounter(
        "llm_calls", "Model calls made", listOf("workspace", "model", "outcome"))

    /** Refresh the JVM gauges. Called on each scrape. */
    private fun sampleJvm() {
        try {
            val threads = java.lang.management.ManagementFactory.getThreadMXBean()
            jvmThreads.set(threads.threadCount.toDouble())
            jvmThreadsPeak.set(threads.peakThreadCount.toDouble())

            val heap = java.lang.management.ManagementFactory.getMemoryMXBean().heapMemoryUsage
            jvmHeapUsedBytes.set(heap.used.toDouble())
            jvmHeapMaxBytes.set(heap.max.toDouble())

            val os = java.lang.management.ManagementFactory.getOperatingSystemMXBean()
            if (os is com.sun.management.OperatingSystemMXBean) {
                jvmCpuSeconds.set(os.processCpuTime / 1_000_000_000.0)
                jvmCpuLoad.set(os.processCpuLoad.coerceAtLeast(0.0))
            }
        } catch (_: Exception) { /* metrics must never break a scrape */ }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Run [block], attributing its wall-clock duration to [threadBlockedSeconds]
     * for the pool that owns the current thread.
     *
     * The pool is read from the thread name (`vectorbea-worker-agent-3` → `agent`)
     * rather than threaded through every call site, so it stays correct when a
     * node type moves between pools.
     */
    fun <T> timeBlocking(block: () -> T): T {
        val startedAt = System.nanoTime()
        try {
            return block()
        } finally {
            val seconds = (System.nanoTime() - startedAt) / 1_000_000_000.0
            threadBlockedSeconds.add(seconds, currentPoolLabel())
        }
    }

    /**
     * The thread family doing the blocking, derived from the thread name.
     *
     *   `vectorbea-worker-agent-3` → `agent`   (a class pool thread)
     *   `wf-node-42`               → `node`    (the per-node timeout pool)
     *   `wf-branch-17`             → `branch`  (parallel-branch execution)
     *   anything else              → `other`
     *
     * `node` dominating this metric is the expected — and important — reading:
     * WorkflowRuntime dispatches every node onto `nodeTimeoutExecutor` and the
     * class-pool thread then blocks on the future. So outbound I/O is served by
     * `wf-node-*` threads while the class slot is held by a thread waiting on
     * them. Both are occupied; only one is doing the socket read. Attributing
     * the seconds to the thread that is actually blocked is what makes the
     * distinction visible.
     */
    fun currentPoolLabel(): String {
        val name = Thread.currentThread().name
        return when {
            name.startsWith("vectorbea-worker-") ->
                name.removePrefix("vectorbea-worker-").substringBeforeLast('-').ifEmpty { "other" }
            name.startsWith("wf-node-") -> "node"
            name.startsWith("wf-branch-") -> "branch"
            // The isolated tenant-database dispatcher. Seconds here are the
            // containment working: this is time a tenant's broken database cost
            // that no pool thread paid.
            name.startsWith("tenant-db-") -> "tenant-db"
            else -> "other"
        }
    }

    // ── Exposition ────────────────────────────────────────────────────────────

    fun scrape(): String = buildString {
        sampleJvm()
        sampleQueueDepth()
        listOf(
            activeTasks, heartbeatAgeSeconds,
            runsQueued, runsSucceeded, runsFailed, runsCancelled,
            runDuration,
            llmCallDuration, httpToolDuration, dbToolDuration,
            connectorFailures,
            activeRunsByPool, poolCapacityAvailable,
            messagesRead, messagesAck, messagesDeferred,
            tenantThrottled, poolSaturated,
            runYields, runReenqueued, runTickDuration,
            redisXadd, redisXreadgroup, redisXack,
            pelParked, pelReclaimed, pollBackoffMs, localBufferSize, readBatchSize,
            poolSlotsTotal, poolSlotsActive, pelDepth,
            jobClassifyDurationSeconds, jobWaitBeforeStartSeconds,
            tenantActiveRuns, tenantThrottledTotal, tenantAdmissionOvershoot, tenantClaimRejected, tenantLoadQuerySeconds,
            llmCallDurationSeconds, toolCallDurationSeconds, tenantDbCallDurationSeconds,
            threadBlockedSeconds, leaseExpiryTotal, xautoclaimReclaimTotal,
            resumeReconciled, resumeReconcileFailed, resumeDeadLettered,
            claimDurationSeconds, claimedTotal, claimReclaimedTotal, claimWakeupTotal,
            claimReservedLaneTotal, ceilingBreachTotal,
            circuitOpenedTotal, circuitClosedTotal, circuitRejectedTotal,
            providerThrottleSuspendTotal, providerCapacityExhaustedTotal,
            fencedWriteTotal, sideEffectDedupeTotal, sideEffectUndeterminedTotal,
            deadLetterTotal, leaseStolenTotal,
            tenantDbSlotsTotal, tenantDbSlotsActive, tenantDbQueueDepth, tenantDbRejectedTotal,
            workerSlotsAvailable, jobQueueDepth, jobExecutionDurationSeconds,
            dbPoolWaitSeconds, runSuspendedTotal,
            llmTokensTotal, llmCostMicros, llmCallsTotal,
            jvmThreads, jvmThreadsPeak, jvmHeapUsedBytes, jvmHeapMaxBytes, jvmCpuSeconds, jvmCpuLoad,
        ).forEach { m ->
            try {
                append(when (m) {
                    is WGauge            -> m.exposition()
                    is WCounter          -> m.exposition()
                    is WHistogram        -> m.exposition()
                    is WSecondsHistogram -> m.exposition()
                    is WDoubleCounter    -> m.exposition()
                    else -> ""
                })
            } catch (_: Exception) { /* skip broken metric */ }
        }
        append("# EOF\n")
    }

    // ── Lightweight HTTP server ───────────────────────────────────────────────

    private var metricsServer: JdkHttpServer? = null

    /**
     * Starts a minimal HTTP server on [port] (default 9090) that serves
     * Prometheus text format at GET /metrics.
     *
     * Intentionally separate from the workflow queue to avoid coupling.
     * Should be firewalled to the monitoring scraper subnet in production.
     */
    fun startServer(port: Int = 9090) {
        try {
            val srv = JdkHttpServer.create(InetSocketAddress(port), 4)
            srv.executor = Executors.newFixedThreadPool(2)
            srv.createContext("/metrics") { exchange ->
                try {
                    if (exchange.requestMethod != "GET") {
                        exchange.sendResponseHeaders(405, -1)
                        exchange.close()
                        return@createContext
                    }
                    val body = scrape().toByteArray(Charsets.UTF_8)
                    exchange.responseHeaders.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
                    exchange.responseHeaders.set("Cache-Control", "no-cache")
                    exchange.sendResponseHeaders(200, body.size.toLong())
                    exchange.responseBody.use { it.write(body) }
                } catch (e: Exception) {
                    log.debug("metrics scrape error: {}", e.message)
                    try { exchange.close() } catch (_: Exception) {}
                }
            }
            srv.createContext("/healthz") { exchange ->
                val body = "ok".toByteArray()
                exchange.sendResponseHeaders(200, body.size.toLong())
                exchange.responseBody.use { it.write(body) }
            }
            srv.start()
            metricsServer = srv
            log.info("[metrics] worker metrics server started on port {}", port)
        } catch (e: Exception) {
            log.warn("[metrics] could not start metrics server on port {}: {}", port, e.message)
        }
    }

    fun stopServer() {
        try { metricsServer?.stop(0) } catch (_: Exception) {}
        metricsServer = null
    }
}
