package com.vectorbea.observability.metrics

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.DoubleAdder

/**
 * Prometheus metric primitives, in one place.
 *
 * WHY THESE ARE HERE AND NOT IN EACH SERVICE
 * ------------------------------------------
 * Both `api-kotlin` and `worker-kotlin` had their own Counter/Gauge/Histogram, written
 * from the same design and then edited independently. They had already diverged: the
 * worker grew a seconds-based histogram, a floating-point counter and a cardinality
 * guard; the API did not. So the two services rendered the same concept in two shapes,
 * and a dashboard querying both had to know which was which.
 *
 * That is the specific failure a shared library prevents. It is not about saving two
 * hundred lines - it is that an observability layer whose two halves disagree about
 * units is worse than having none, because it is trusted.
 *
 * ON NOT USING A CLIENT LIBRARY
 * -----------------------------
 * `simpleclient` would do this properly. It is not used because the exposition format
 * is a few hundred lines, the process must never fail because its metrics library
 * threw, and a dependency that pulls in a servlet API to serve one text endpoint is a
 * poor trade at this size. Revisit if exemplars or native histograms are ever needed.
 */

/** Bare integer counter. Renders with the `_total` suffix Prometheus expects. */
class Counter(val name: String, val help: String, val labelNames: List<String> = emptyList()) {
    private val cells = ConcurrentHashMap<List<String>, AtomicLong>()

    fun inc(vararg labelValues: String, delta: Long = 1) {
        cells.getOrPut(LabelGuard.guard(name, labelValues.toList())) { AtomicLong(0) }.addAndGet(delta)
    }

    /** Current value for one label set — for tests and for the Control API. */
    fun value(vararg labelValues: String): Long = cells[labelValues.toList()]?.get() ?: 0L

    /** Sum across every label set. */
    fun total(): Long = cells.values.sumOf { it.get() }

    fun exposition(): String = buildString {
        append("# HELP $name $help\n# TYPE $name counter\n")
        if (cells.isEmpty()) append("${name}_total 0.0\n")
        else cells.forEach { (labels, c) -> append("${name}_total${labelSet(labelNames, labels)} ${c.get().toDouble()}\n") }
    }
}

/**
 * Counter accumulating a floating-point quantity, e.g. seconds of blocked time.
 *
 * The series name is used verbatim with no `_total` suffix, because these metrics
 * carry their unit in the name (`thread_blocked_seconds`) and `_seconds_total` reads
 * as a count of seconds-events rather than a sum of seconds.
 */
class DoubleCounter(val name: String, val help: String, val labelNames: List<String> = emptyList()) {
    private val cells = ConcurrentHashMap<List<String>, DoubleAdder>()

    fun add(delta: Double, vararg labelValues: String) {
        cells.getOrPut(LabelGuard.guard(name, labelValues.toList())) { DoubleAdder() }.add(delta)
    }

    fun total(): Double = cells.values.sumOf { it.sum() }

    fun exposition(): String = buildString {
        append("# HELP $name $help\n# TYPE $name counter\n")
        if (cells.isEmpty()) append("$name 0.0\n")
        else cells.forEach { (labels, a) -> append("$name${labelSet(labelNames, labels)} ${a.sum()}\n") }
    }
}

class Gauge(val name: String, val help: String, val labelNames: List<String> = emptyList()) {
    private val cells = ConcurrentHashMap<List<String>, DoubleAdder>()

    fun set(value: Double, vararg labelValues: String) {
        val a = cells.getOrPut(LabelGuard.guard(name, labelValues.toList())) { DoubleAdder() }
        synchronized(a) { a.reset(); a.add(value) }
    }

    fun inc(vararg labelValues: String) = add(1.0, *labelValues)
    fun dec(vararg labelValues: String) = add(-1.0, *labelValues)

    fun add(delta: Double, vararg labelValues: String) {
        cells.getOrPut(LabelGuard.guard(name, labelValues.toList())) { DoubleAdder() }.add(delta)
    }

    fun value(vararg labelValues: String): Double = cells[labelValues.toList()]?.sum() ?: 0.0

    /** Every label set and its value — how the Control API reads fleet state. */
    fun snapshot(): Map<List<String>, Double> = cells.mapValues { it.value.sum() }

    fun exposition(): String = buildString {
        append("# HELP $name $help\n# TYPE $name gauge\n")
        if (cells.isEmpty()) append("$name 0.0\n")
        else cells.forEach { (labels, a) -> append("$name${labelSet(labelNames, labels)} ${a.sum()}\n") }
    }
}

/**
 * Histogram in **seconds**, the Prometheus base unit.
 *
 * Millisecond-named histograms were the API's original choice and the worker's
 * original choice too; both are kept renderable through [observeMs], but the exposed
 * unit is seconds everywhere. Mixed units across two services is precisely the kind of
 * thing that survives review and then wastes an hour during an incident.
 *
 * The bucket range spans what this system actually sees: sub-millisecond claim
 * round-trips through five-minute agent runs.
 */
class SecondsHistogram(
    val name: String,
    val help: String,
    val labelNames: List<String> = emptyList(),
) {
    companion object {
        val BUCKETS = doubleArrayOf(
            0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5,
            1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0,
        )
        internal fun fmt(d: Double) = if (d == d.toLong().toDouble()) "${d.toLong()}.0" else d.toString()
    }

    class Cell(val buckets: Array<AtomicLong>, val sum: DoubleAdder, val count: AtomicLong)

    private val cells = ConcurrentHashMap<List<String>, Cell>()

    fun observeSeconds(seconds: Double, vararg labelValues: String) {
        val c = cells.getOrPut(LabelGuard.guard(name, labelValues.toList())) {
            Cell(Array(BUCKETS.size + 1) { AtomicLong(0) }, DoubleAdder(), AtomicLong(0))
        }
        for (i in BUCKETS.indices) if (seconds <= BUCKETS[i]) c.buckets[i].incrementAndGet()
        c.buckets[BUCKETS.size].incrementAndGet()
        c.sum.add(seconds)
        c.count.incrementAndGet()
    }

    fun observeMs(ms: Long, vararg labelValues: String) = observeSeconds(ms / 1000.0, *labelValues)

    fun count(): Long = cells.values.sumOf { it.count.get() }

    /**
     * Quantile by linear interpolation within the containing bucket.
     *
     * Approximate by construction - that is what a bucketed histogram is - and used
     * only to feed the Control page a number without a Prometheus round trip. Alerting
     * uses `histogram_quantile` against the real series.
     */
    fun quantile(q: Double, vararg labelValues: String): Double? {
        val c = cells[labelValues.toList()] ?: return null
        val total = c.count.get()
        if (total == 0L) return null
        val target = q * total
        var lower = 0.0
        for (i in BUCKETS.indices) {
            val cumulative = c.buckets[i].get().toDouble()
            if (cumulative >= target) {
                val previous = if (i == 0) 0.0 else c.buckets[i - 1].get().toDouble()
                val span = cumulative - previous
                val within = if (span <= 0) 0.0 else (target - previous) / span
                return lower + (BUCKETS[i] - lower) * within
            }
            lower = BUCKETS[i]
        }
        return BUCKETS.last()
    }

    fun exposition(): String = buildString {
        append("# HELP $name $help\n# TYPE $name histogram\n")
        if (cells.isEmpty()) {
            for (b in BUCKETS) append("${name}_bucket{le=\"${fmt(b)}\"} 0.0\n")
            append("${name}_bucket{le=\"+Inf\"} 0.0\n${name}_count 0.0\n${name}_sum 0.0\n")
        } else cells.forEach { (labels, c) ->
            for (i in BUCKETS.indices) {
                append("${name}_bucket${labelSet(labelNames, labels, "le" to fmt(BUCKETS[i]))} ${c.buckets[i].get().toDouble()}\n")
            }
            append("${name}_bucket${labelSet(labelNames, labels, "le" to "+Inf")} ${c.buckets[BUCKETS.size].get().toDouble()}\n")
            append("${name}_count${labelSet(labelNames, labels)} ${c.count.get().toDouble()}\n")
            append("${name}_sum${labelSet(labelNames, labels)} ${c.sum.sum()}\n")
        }
    }
}

/**
 * Bounds label cardinality per metric.
 *
 * Several metrics are labelled by `workspace`, which is a UUID supplied by whoever is
 * using the platform. Left unbounded that is a memory leak in the process and a
 * cardinality explosion in Prometheus: one time series per workspace per label
 * combination, retained forever. Past [MAX_SERIES_PER_METRIC] distinct label sets,
 * further ones collapse into a single `overflow` series, so the endpoint degrades in
 * fidelity rather than taking the process with it.
 */
object LabelGuard {
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

    /** Distinct label sets seen for a metric — lets a test assert the guard bites. */
    fun seriesCount(metric: String): Int = seen[metric]?.size ?: 0

    internal fun reset() = seen.clear()
}

private fun labelSet(
    names: List<String>,
    values: List<String>,
    extra: Pair<String, String>? = null,
): String {
    val pairs = names.zip(values) + listOfNotNull(extra)
    if (pairs.isEmpty()) return ""
    return "{" + pairs.joinToString(",") { (k, v) -> "$k=\"${v.escape()}\"" } + "}"
}

private fun String.escape() = replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n")
