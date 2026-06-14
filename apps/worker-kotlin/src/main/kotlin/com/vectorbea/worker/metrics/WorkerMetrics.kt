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
        cells.getOrPut(lv.toList()) { AtomicLong(0) }.addAndGet(delta)
    }
    fun exposition() = buildString {
        append("# HELP $name $help\n# TYPE $name counter\n")
        if (cells.isEmpty()) append("${name}_total 0.0\n")
        else cells.forEach { (lbs, c) -> append("${name}_total${ls(lbs)} ${c.get().toDouble()}\n") }
    }
    private fun ls(v: List<String>): String {
        if (labelNames.isEmpty() || v.isEmpty()) return ""
        return "{" + labelNames.zip(v).joinToString(",") { (k, vv) -> "$k=\"${vv.esc()}\"" } + "}"
    }
}

internal class WGauge(val name: String, val help: String, val labelNames: List<String>) {
    val cells = ConcurrentHashMap<List<String>, DoubleAdder>()
    fun set(value: Double, vararg lv: String) {
        val a = cells.getOrPut(lv.toList()) { DoubleAdder() }
        synchronized(a) { a.reset(); a.add(value) }
    }
    fun inc(vararg lv: String) { cells.getOrPut(lv.toList()) { DoubleAdder() }.add(1.0) }
    fun dec(vararg lv: String) { cells.getOrPut(lv.toList()) { DoubleAdder() }.add(-1.0) }
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

private fun String.esc() = replace("\\","\\\\").replace("\"","\\\"").replace("\n","\\n")

// ── Worker metric definitions ─────────────────────────────────────────────────

object WorkerMetrics {
    private val log = LoggerFactory.getLogger(WorkerMetrics::class.java)

    // Gauge: currently-active (in-flight) tasks
    internal val activeTasks = WGauge("worker_active_tasks", "Number of workflow run tasks currently executing", emptyList())

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

    // ── Exposition ────────────────────────────────────────────────────────────

    fun scrape(): String = buildString {
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
            pelParked, pelReclaimed, pollBackoffMs, localBufferSize,
        ).forEach { m ->
            try {
                append(when (m) {
                    is WGauge     -> m.exposition()
                    is WCounter   -> m.exposition()
                    is WHistogram -> m.exposition()
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
