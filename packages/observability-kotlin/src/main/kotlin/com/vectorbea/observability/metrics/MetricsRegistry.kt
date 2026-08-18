package com.vectorbea.observability.metrics

import java.util.concurrent.ConcurrentHashMap

/**
 * Everything registered, rendered on demand.
 *
 * Registration is by object identity, so re-registering the same metric is a no-op
 * rather than a duplicate series. Declaration order is preserved because a `/metrics`
 * body whose sections move around between scrapes is miserable to diff by hand, and
 * diffing two scrapes by hand is exactly what you do when something is wrong.
 */
object MetricsRegistry {
    private val exposers = ConcurrentHashMap<Any, () -> String>()
    private val order = java.util.Collections.synchronizedList(mutableListOf<Any>())

    fun <T : Any> register(metric: T, render: T.() -> String): T {
        if (exposers.putIfAbsent(metric) { metric.render() } == null) order.add(metric)
        return metric
    }

    fun scrape(): String = buildString {
        val snapshot = synchronized(order) { order.toList() }
        for (m in snapshot) exposers[m]?.let { append(it()) }
    }

    /** Metric count — used by the scrape verification harness. */
    fun size(): Int = exposers.size

    internal fun clear() { exposers.clear(); synchronized(order) { order.clear() } }
}

fun counter(name: String, help: String, vararg labelNames: String): Counter =
    MetricsRegistry.register(Counter(name, help, labelNames.toList())) { exposition() }

fun doubleCounter(name: String, help: String, vararg labelNames: String): DoubleCounter =
    MetricsRegistry.register(DoubleCounter(name, help, labelNames.toList())) { exposition() }

fun gauge(name: String, help: String, vararg labelNames: String): Gauge =
    MetricsRegistry.register(Gauge(name, help, labelNames.toList())) { exposition() }

fun secondsHistogram(name: String, help: String, vararg labelNames: String): SecondsHistogram =
    MetricsRegistry.register(SecondsHistogram(name, help, labelNames.toList())) { exposition() }
