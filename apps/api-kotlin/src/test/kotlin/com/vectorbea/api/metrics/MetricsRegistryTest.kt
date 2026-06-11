package com.vectorbea.api.metrics

import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/**
 * Tests for [Counter], [Gauge], [Histogram], and [MetricsRegistry].
 *
 * Uses a local registry per-test to avoid cross-test pollution with the
 * global [MetricsRegistry] singleton.
 */
class MetricsRegistryTest {

    // ── Counter ───────────────────────────────────────────────────────────────

    @Test
    fun `counter emits zero line at startup when no observations`() {
        val c = Counter("test_requests", "help text")
        val output = c.exposition()
        assertTrue(output.contains("# HELP test_requests help text"))
        assertTrue(output.contains("# TYPE test_requests counter"))
        assertTrue(output.contains("test_requests_total 0.0"))
    }

    @Test
    fun `counter increments correctly with labels`() {
        val c = Counter("req", "help", listOf("method", "status"))
        c.inc("GET", "200")
        c.inc("GET", "200")
        c.inc("POST", "201")
        val output = c.exposition()
        assertTrue(output.contains("req_total{method=\"GET\",status=\"200\"} 2.0"), output)
        assertTrue(output.contains("req_total{method=\"POST\",status=\"201\"} 1.0"), output)
    }

    @Test
    fun `counter label count mismatch throws`() {
        val c = Counter("r", "h", listOf("a", "b"))
        assertThrows(IllegalArgumentException::class.java) {
            c.inc("only-one")
        }
    }

    @Test
    fun `counter label values are JSON-escaped`() {
        val c = Counter("esc", "help", listOf("path"))
        c.inc("/api/runs/\"test\"")
        val output = c.exposition()
        assertTrue(output.contains("\\\"test\\\""), output)
    }

    // ── Gauge ─────────────────────────────────────────────────────────────────

    @Test
    fun `gauge set replaces previous value`() {
        val g = Gauge("active", "help")
        g.set(5.0)
        g.set(3.0)
        val output = g.exposition()
        assertTrue(output.contains("active 3.0"), output)
    }

    @Test
    fun `gauge inc and dec work correctly`() {
        val g = Gauge("tasks", "help")
        g.inc()
        g.inc()
        g.dec()
        val output = g.exposition()
        assertTrue(output.contains("tasks 1.0"), output)
    }

    @Test
    fun `gauge emits zero line when no observations`() {
        val g = Gauge("empty_gauge", "help")
        val output = g.exposition()
        assertTrue(output.contains("empty_gauge 0.0"), output)
    }

    // ── Histogram ─────────────────────────────────────────────────────────────

    @Test
    fun `histogram observe increments correct buckets`() {
        val h = Histogram("latency", "help")
        h.observe(30L)  // fits in 50ms bucket and all above
        val output = h.exposition()
        // bucket le=25 should be 0, le=50 should be 1
        assertTrue(output.contains("""latency_bucket{le="25"} 0.0"""), output)
        assertTrue(output.contains("""latency_bucket{le="50"} 1.0"""), output)
        assertTrue(output.contains("""latency_bucket{le="+Inf"} 1.0"""), output)
        assertTrue(output.contains("latency_count 1.0"), output)
        assertTrue(output.contains("latency_sum 30.0"), output)
    }

    @Test
    fun `histogram emits zero-value buckets at startup`() {
        val h = Histogram("empty_hist", "help")
        val output = h.exposition()
        assertTrue(output.contains("""empty_hist_bucket{le="5"} 0.0"""), output)
        assertTrue(output.contains("""empty_hist_bucket{le="+Inf"} 0.0"""), output)
        assertTrue(output.contains("empty_hist_count 0.0"), output)
    }

    @Test
    fun `histogram with labels produces labelled exposition`() {
        val h = Histogram("db_ms", "help", listOf("op"))
        h.observe(10L, "query")
        h.observe(200L, "execute")
        val output = h.exposition()
        assertTrue(output.contains("""db_ms_bucket{op="query",le="10"} 1.0"""), output)
        assertTrue(output.contains("""db_ms_bucket{op="execute",le="250"} 1.0"""), output)
    }

    // ── MetricsRegistry ───────────────────────────────────────────────────────

    @Test
    fun `scrape output ends with # EOF`() {
        // Use a fresh counter not registered in the global registry
        val output = MetricsRegistry.scrape()
        assertTrue(output.trimEnd().endsWith("# EOF"), output)
    }

    @Test
    fun `registered metric appears in scrape`() {
        val c = counter("scrape_test_total", "test counter for scrape")
        c.inc()
        val output = MetricsRegistry.scrape()
        assertTrue(output.contains("scrape_test_total"), output)
    }

    // ── AppMetrics helpers ────────────────────────────────────────────────────

    @Test
    fun `statusClass returns correct class strings`() {
        assertEquals("2xx", AppMetrics.statusClass(200))
        assertEquals("2xx", AppMetrics.statusClass(201))
        assertEquals("4xx", AppMetrics.statusClass(404))
        assertEquals("5xx", AppMetrics.statusClass(500))
    }

    @Test
    fun `normalisePath replaces UUIDs with placeholder`() {
        val raw = "/api/runs/a1b2c3d4-e5f6-7890-abcd-ef1234567890/events"
        val normalised = AppMetrics.normalisePath(raw)
        assertEquals("/api/runs/:id/events", normalised)
    }

    @Test
    fun `normalisePath replaces numeric IDs`() {
        val normalised = AppMetrics.normalisePath("/api/workspaces/42/agents")
        assertEquals("/api/workspaces/:id/agents", normalised)
    }

    @Test
    fun `normalisePath preserves clean paths`() {
        val path = "/api/runs"
        assertEquals(path, AppMetrics.normalisePath(path))
    }
}
