package com.vectorbea.observability

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.spi.LoggingEvent
import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.observability.logging.JsonLogEncoder
import com.vectorbea.observability.logging.LogContext
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Assertions.*
import org.slf4j.MDC

/**
 * The envelope is a contract with Loki and with every saved query built on it, so it is
 * asserted rather than eyeballed. A log line that stops being parseable fails silently:
 * the line is dropped at ingest and the absence is only noticed when someone goes
 * looking for it, during an incident.
 */
class JsonLogEncoderTest {

    private val mapper = ObjectMapper()
    private val encoder = JsonLogEncoder()

    @AfterEach fun cleanup() = MDC.clear()

    private fun encode(message: String, error: Throwable? = null): Map<*, *> {
        val event = LoggingEvent().apply {
            loggerName = "com.vectorbea.worker.Test"
            level = Level.INFO
            this.message = message
            timeStamp = 1_760_000_000_000
            threadName = "worker-1"
            mdcPropertyMap = MDC.getCopyOfContextMap() ?: emptyMap()
            error?.let { setThrowableProxy(ch.qos.logback.classic.spi.ThrowableProxy(it)) }
        }
        return mapper.readValue(String(encoder.encode(event), Charsets.UTF_8), Map::class.java)
    }

    @Test
    fun `the envelope carries the fields a run detail view filters on`() {
        LogContext.identify("worker", "w-3")
        LogContext.put(LogContext.RUN_ID, "run-1")
        LogContext.put(LogContext.NODE_ID, "extract")
        LogContext.put(LogContext.WORKSPACE_ID, "ws-1")
        LogContext.put(LogContext.TRACE_ID, "4bf92f3577b34da6a3ce929d0e0e4736")

        val line = encode("node started")

        assertEquals("worker", line["service"])
        assertEquals("w-3", line["worker_id"])
        assertEquals("run-1", line["run_id"])
        assertEquals("extract", line["node_id"])
        assertEquals("ws-1", line["workspace_id"])
        assertEquals("4bf92f3577b34da6a3ce929d0e0e4736", line["trace_id"])
        assertEquals("INFO", line["level"])
        assertEquals("node started", line["message"])
        // ISO-8601 in UTC with a Z suffix — what Loki and Grafana parse without a
        // format hint. Epoch millis would be smaller and unreadable in a raw tail.
        assertEquals("2025-10-09T08:53:20Z", line["timestamp"])
    }

    @Test
    fun `non-envelope context lands in fields, not at the top level`() {
        LogContext.identify("api")
        MDC.put("request_id", "req-9")
        MDC.put("path", "/api/runs")

        val line = encode("handled")

        assertNull(line["request_id"], "an ad-hoc key must not sit beside the envelope")
        @Suppress("UNCHECKED_CAST")
        val fields = line["fields"] as Map<String, Any?>
        assertEquals("req-9", fields["request_id"])
        assertEquals("/api/runs", fields["path"])
    }

    @Test
    fun `a message containing quotes and newlines stays parseable`() {
        // The whole reason this is an encoder rather than a pattern layout. A run that
        // logs a model's raw output logs quotes, braces and newlines by definition.
        val nasty = "model said: {\"a\": \"b\"}\nand then\ttabbed"
        val line = encode(nasty)
        assertEquals(nasty, line["message"])
    }

    @Test
    fun `a control character does not break the line`() {
        val line = encode("bell: end")
        assertEquals("bell: end", line["message"])
    }

    @Test
    fun `an exception is recorded with its type and stack`() {
        val line = encode("failed", IllegalStateException("lease was reassigned"))
        @Suppress("UNCHECKED_CAST")
        val error = line["error"] as Map<String, Any?>
        assertEquals("java.lang.IllegalStateException", error["type"])
        assertEquals("lease was reassigned", error["message"])
        assertTrue((error["stack"] as String).contains("JsonLogEncoderTest"))
    }

    @Test
    fun `scoped restores the previous value rather than clearing it`() {
        // The failure this guards: a node finishes, and the lines after it lose the
        // run_id because the node scope cleared instead of restoring.
        LogContext.put(LogContext.RUN_ID, "run-1")
        LogContext.scoped(LogContext.NODE_ID to "extract") {
            assertEquals("extract", MDC.get("node_id"))
            assertEquals("run-1", MDC.get("run_id"))
        }
        assertNull(MDC.get("node_id"))
        assertEquals("run-1", MDC.get("run_id"), "the run must survive the node")
    }

    @Test
    fun `an absent envelope key is omitted rather than emitted as null`() {
        LogContext.identify("api")
        val line = encode("no run here")
        assertFalse(line.containsKey("run_id"))
        assertFalse(line.containsKey("node_id"))
    }
}
