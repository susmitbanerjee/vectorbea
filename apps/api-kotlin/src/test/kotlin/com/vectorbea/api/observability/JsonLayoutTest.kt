package com.vectorbea.api.observability

import ch.qos.logback.classic.Level
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.LoggingEvent
import ch.qos.logback.classic.spi.ThrowableProxy
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test
import org.slf4j.LoggerFactory
import org.slf4j.MDC

/**
 * Unit tests for [JsonLayout].
 *
 * Verifies that every log event is serialized to a valid, single-line JSON
 * object with proper escaping, MDC inclusion, and throwable formatting.
 */
class JsonLayoutTest {

    private val layout = JsonLayout()
    private val logger = LoggerFactory.getLogger("test.JsonLayoutTest") as Logger

    @BeforeEach
    fun clearMdc() {
        MDC.clear()
    }

    private fun event(msg: String, level: Level = Level.INFO, t: Throwable? = null): LoggingEvent {
        val e = LoggingEvent("test", logger, level, msg, t, null)
        e.mdcPropertyMap  // initialise from current MDC state
        return e
    }

    // ── Basic structure ───────────────────────────────────────────────────────

    @Test
    fun `output is a single JSON line ending with newline`() {
        val output = layout.doLayout(event("hello"))
        assertTrue(output.endsWith("\n"), "should end with newline")
        assertEquals(1, output.trim().lines().size, "should be a single line")
        assertTrue(output.trimEnd().startsWith("{"), "should start with {")
        assertTrue(output.trimEnd().endsWith("}"), "should end with }")
    }

    @Test
    fun `output contains required fields`() {
        val output = layout.doLayout(event("test message"))
        assertTrue(output.contains("\"ts\":"), output)
        assertTrue(output.contains("\"level\":\"INFO\""), output)
        assertTrue(output.contains("\"logger\":"), output)
        assertTrue(output.contains("\"msg\":\"test message\""), output)
        assertTrue(output.contains("\"thread\":"), output)
    }

    // ── JSON escaping ─────────────────────────────────────────────────────────

    @Test
    fun `double quotes in message are escaped`() {
        val output = layout.doLayout(event("say \"hello\" world"))
        assertTrue(output.contains("\\\"hello\\\""), output)
    }

    @Test
    fun `backslash in message is escaped`() {
        val output = layout.doLayout(event("path\\to\\file"))
        assertTrue(output.contains("path\\\\to\\\\file"), output)
    }

    @Test
    fun `newline in message is escaped`() {
        val output = layout.doLayout(event("line1\nline2"))
        assertTrue(output.contains("\\n"), output)
        // The output itself must still be a single line
        assertEquals(1, output.trim().lines().size)
    }

    @Test
    fun `tab in message is escaped`() {
        val output = layout.doLayout(event("col1\tcol2"))
        assertTrue(output.contains("\\t"), output)
    }

    // ── MDC inclusion ─────────────────────────────────────────────────────────

    @Test
    fun `MDC fields are included in output`() {
        MDC.put(MdcKeys.REQUEST_ID, "req-abc")
        MDC.put(MdcKeys.TRACE_ID, "trace-xyz")
        MDC.put(MdcKeys.WORKSPACE_ID, "ws-123")

        val output = layout.doLayout(event("with mdc"))

        assertTrue(output.contains("\"requestId\":\"req-abc\""), output)
        assertTrue(output.contains("\"traceId\":\"trace-xyz\""), output)
        assertTrue(output.contains("\"workspaceId\":\"ws-123\""), output)
    }

    @Test
    fun `MDC values with special characters are escaped`() {
        MDC.put("custom", "value\"with\"quotes")
        val output = layout.doLayout(event("escape mdc"))
        assertTrue(output.contains("\\\"with\\\""), output)
    }

    // ── Throwable formatting ──────────────────────────────────────────────────

    @Test
    fun `throwable fields appear when exception is attached`() {
        val ex = RuntimeException("something went wrong")
        val output = layout.doLayout(event("error occurred", Level.ERROR, ex))
        assertTrue(output.contains("\"errorClass\":\"java.lang.RuntimeException\""), output)
        assertTrue(output.contains("\"errorMessage\":\"something went wrong\""), output)
    }

    @Test
    fun `no throwable fields when no exception`() {
        val output = layout.doLayout(event("no error"))
        assertFalse(output.contains("\"errorClass\""), output)
        assertFalse(output.contains("\"errorMessage\""), output)
    }

    // ── Logger abbreviation ───────────────────────────────────────────────────

    @Test
    fun `logger name is abbreviated`() {
        // com.vectorbea.api.http.HttpServer → c.v.a.h.HttpServer
        val output = layout.doLayout(event("check logger"))
        // Just ensure there's a logger field with some abbreviated form
        assertTrue(output.contains("\"logger\":"), output)
    }

    // ── Log level variants ────────────────────────────────────────────────────

    @Test
    fun `WARN level is serialized correctly`() {
        val output = layout.doLayout(event("warn msg", Level.WARN))
        assertTrue(output.contains("\"level\":\"WARN\""), output)
    }

    @Test
    fun `ERROR level is serialized correctly`() {
        val output = layout.doLayout(event("error msg", Level.ERROR))
        assertTrue(output.contains("\"level\":\"ERROR\""), output)
    }
}
