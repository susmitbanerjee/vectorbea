package com.vectorbea.api.metrics

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.DoubleAdder

// ─────────────────────────────────────────────────────────────────────────────
// Simple in-process metrics registry — no external dependencies.
//
// Exports Prometheus text format (OpenMetrics-compatible) at GET /metrics.
//
// Thread-safety: all counters and adders are lock-free via java.util.concurrent
// atomic primitives. Label maps use ConcurrentHashMap with putIfAbsent.
//
// Design:
//   - Counter    — monotonically increasing (requests, errors, jobs)
//   - Gauge      — point-in-time value (active tasks, queue depth)
//   - Histogram  — latency buckets + sum + count per label set
//
// SECURITY:
//   Label values must never contain secrets. Paths are normalized
//   (IDs replaced with placeholders) before use as labels.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A multi-dimensional counter.
 * Labels must be passed in the same order they appear in [labelNames].
 *
 * Example:
 * ```kotlin
 * val c = Counter("requests_total", listOf("method", "status"))
 * c.inc("GET", "200")
 * c.inc("POST", "201")
 * ```
 */
class Counter(val name: String, val help: String, val labelNames: List<String> = emptyList()) {
    private val cells = ConcurrentHashMap<List<String>, AtomicLong>()

    fun inc(vararg labelValues: String, delta: Long = 1) {
        require(labelValues.size == labelNames.size) {
            "Expected ${labelNames.size} labels but got ${labelValues.size}"
        }
        cells.getOrPut(labelValues.toList()) { AtomicLong(0) }.addAndGet(delta)
    }

    fun exposition(): String = buildString {
        append("# HELP $name $help\n")
        append("# TYPE $name counter\n")
        if (cells.isEmpty()) {
            // Always emit at least one line so the metric shows up at startup
            append("${name}_total${labelSetStr(emptyList())} 0.0\n")
        } else {
            for ((labels, count) in cells) {
                append("${name}_total${labelSetStr(labels)} ${count.get().toDouble()}\n")
            }
        }
    }

    private fun labelSetStr(values: List<String>): String {
        if (labelNames.isEmpty() || values.isEmpty()) return ""
        return "{" + labelNames.zip(values).joinToString(",") { (k, v) -> "$k=\"${v.escapeLabel()}\"" } + "}"
    }
}

/**
 * A settable gauge value, supporting multi-dimensional labels.
 */
class Gauge(val name: String, val help: String, val labelNames: List<String> = emptyList()) {
    private val cells = ConcurrentHashMap<List<String>, DoubleAdder>()

    fun set(value: Double, vararg labelValues: String) {
        require(labelValues.size == labelNames.size)
        cells.getOrPut(labelValues.toList()) { DoubleAdder() }.also {
            // DoubleAdder doesn't support set — use a reset + add idiom
            // For gauges this is approximate under concurrent writes; acceptable for metrics
            synchronized(it) { it.reset(); it.add(value) }
        }
    }

    fun inc(vararg labelValues: String) = add(1.0, *labelValues)
    fun dec(vararg labelValues: String) = add(-1.0, *labelValues)
    fun add(delta: Double, vararg labelValues: String) {
        require(labelValues.size == labelNames.size)
        cells.getOrPut(labelValues.toList()) { DoubleAdder() }.add(delta)
    }

    fun exposition(): String = buildString {
        append("# HELP $name $help\n")
        append("# TYPE $name gauge\n")
        if (cells.isEmpty()) {
            append("$name${labelSetStr(emptyList())} 0.0\n")
        } else {
            for ((labels, adder) in cells) {
                append("$name${labelSetStr(labels)} ${adder.sum()}\n")
            }
        }
    }

    private fun labelSetStr(values: List<String>): String {
        if (labelNames.isEmpty() || values.isEmpty()) return ""
        return "{" + labelNames.zip(values).joinToString(",") { (k, v) -> "$k=\"${v.escapeLabel()}\"" } + "}"
    }
}

/**
 * A histogram for latency distributions.
 *
 * Pre-defined buckets (in ms): 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, +Inf
 *
 * Emits `_bucket`, `_count`, and `_sum` series per label set.
 */
class Histogram(
    val name: String,
    val help: String,
    val labelNames: List<String> = emptyList(),
    val buckets: LongArray = DEFAULT_BUCKETS,
) {
    companion object {
        val DEFAULT_BUCKETS = longArrayOf(5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000)
    }

    data class Cell(
        val bucketCounts: Array<AtomicLong> = Array(0) { AtomicLong(0) },
        val sum: DoubleAdder = DoubleAdder(),
        val count: AtomicLong = AtomicLong(0),
    )

    private val cells = ConcurrentHashMap<List<String>, Cell>()

    fun observe(valueMs: Long, vararg labelValues: String) {
        require(labelValues.size == labelNames.size)
        val key = labelValues.toList()
        val cell = cells.getOrPut(key) {
            Cell(bucketCounts = Array(buckets.size + 1) { AtomicLong(0) })
        }
        // Increment all buckets where le >= value
        for (i in buckets.indices) {
            if (valueMs <= buckets[i]) cell.bucketCounts[i].incrementAndGet()
        }
        cell.bucketCounts[buckets.size].incrementAndGet() // +Inf
        cell.sum.add(valueMs.toDouble())
        cell.count.incrementAndGet()
    }

    fun exposition(): String = buildString {
        append("# HELP $name $help\n")
        append("# TYPE $name histogram\n")
        if (cells.isEmpty()) {
            // Emit zero-value buckets at startup
            for (i in buckets.indices) {
                append("${name}_bucket${labelStr(emptyList(), "le" to buckets[i].toString())} 0.0\n")
            }
            append("${name}_bucket${labelStr(emptyList(), "le" to "+Inf")} 0.0\n")
            append("${name}_count${labelStr(emptyList())} 0.0\n")
            append("${name}_sum${labelStr(emptyList())} 0.0\n")
        } else {
            for ((labels, cell) in cells) {
                for (i in buckets.indices) {
                    append("${name}_bucket${labelStr(labels, "le" to buckets[i].toString())} ${cell.bucketCounts[i].get().toDouble()}\n")
                }
                append("${name}_bucket${labelStr(labels, "le" to "+Inf")} ${cell.bucketCounts[buckets.size].get().toDouble()}\n")
                append("${name}_count${labelStr(labels)} ${cell.count.get().toDouble()}\n")
                append("${name}_sum${labelStr(labels)} ${cell.sum.sum()}\n")
            }
        }
    }

    private fun labelStr(values: List<String>, extra: Pair<String, String>? = null): String {
        val pairs = labelNames.zip(values).map { (k, v) -> k to v } +
                    (if (extra != null) listOf(extra) else emptyList())
        if (pairs.isEmpty()) return ""
        return "{" + pairs.joinToString(",") { (k, v) -> "$k=\"${v.escapeLabel()}\"" } + "}"
    }
}

// ── Private helpers ───────────────────────────────────────────────────────────

private fun String.escapeLabel(): String =
    replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")

/**
 * Global registry for collecting all metric [Exposition] objects.
 * Serialise to Prometheus text format via [scrape].
 */
object MetricsRegistry {
    private val metrics = ConcurrentHashMap<String, () -> String>()

    /** Register a metric for scraping. Returns the metric for use. */
    fun <T : Any> register(exposition: T, fn: T.() -> String): T {
        // Use object identity as key to allow re-registration
        metrics[System.identityHashCode(exposition).toString()] = { fn(exposition) }
        return exposition
    }

    /** Produce the full Prometheus text exposition. */
    fun scrape(): String = buildString {
        for ((_, fn) in metrics) {
            try { append(fn()) } catch (_: Exception) { /* skip broken metric */ }
        }
        append("# EOF\n")
    }
}

/** Convenience: register a Counter and return it. */
fun counter(name: String, help: String, vararg labelNames: String): Counter =
    MetricsRegistry.register(Counter(name, help, labelNames.toList())) { exposition() }

/** Convenience: register a Gauge and return it. */
fun gauge(name: String, help: String, vararg labelNames: String): Gauge =
    MetricsRegistry.register(Gauge(name, help, labelNames.toList())) { exposition() }

/** Convenience: register a Histogram and return it. */
fun histogram(name: String, help: String, vararg labelNames: String): Histogram =
    MetricsRegistry.register(Histogram(name, help, labelNames.toList())) { exposition() }
