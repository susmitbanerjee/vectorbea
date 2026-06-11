package com.vectorbea.api.observability

import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.spi.IThrowableProxy
import ch.qos.logback.core.LayoutBase
import java.time.Instant

/**
 * Custom Logback layout that serializes every log event to a single JSON line.
 *
 * Output format (one JSON object per line — NDJSON / JSON-Lines):
 * ```json
 * {"ts":"2024-01-01T00:00:00.000Z","level":"INFO","logger":"HttpServer","msg":"GET /api/runs → 200","requestId":"abc","service":"api",...}
 * ```
 *
 * All MDC keys present at the time of the log call are merged into the root
 * JSON object, enabling structured queries in Datadog / CloudWatch / Loki / etc.
 *
 * SECURITY:
 *  - Message and MDC values are JSON-escaped (no injection via log messages).
 *  - Throwable chain is included as `errorClass` + `errorMessage` + `stackTrace`
 *    (truncated to [MAX_STACK_LINES] frames to avoid log flooding).
 *  - Authorization headers and secrets must be redacted BEFORE they are passed
 *    to the logger — this layout does not perform additional redaction.
 *
 * Configuration (logback.xml):
 * ```xml
 * <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
 *   <layout class="com.vectorbea.api.observability.JsonLayout"/>
 * </appender>
 * ```
 */
class JsonLayout : LayoutBase<ILoggingEvent>() {

    companion object {
        private const val MAX_STACK_LINES = 20
    }

    override fun doLayout(event: ILoggingEvent): String {
        val sb = StringBuilder(256)
        sb.append('{')

        appendStr(sb, "ts", Instant.ofEpochMilli(event.timeStamp).toString(), first = true)
        appendStr(sb, "level", event.level.toString())
        appendStr(sb, "logger", abbreviateLogger(event.loggerName))
        appendStr(sb, "msg", event.formattedMessage)

        // All MDC fields are merged into the root object so log-query tools can filter on them
        for ((k, v) in event.mdcPropertyMap) {
            if (k.isNotBlank() && v != null) appendStr(sb, k, v)
        }

        // Thread — useful for diagnosing pool starvation
        appendStr(sb, "thread", event.threadName)

        // Throwable chain
        val tp = event.throwableProxy
        if (tp != null) {
            appendStr(sb, "errorClass", tp.className)
            appendStr(sb, "errorMessage", tp.message ?: "")
            val frames = buildStackTrace(tp)
            if (frames.isNotEmpty()) appendStr(sb, "stackTrace", frames)
        }

        sb.append('}')
        sb.append('\n')
        return sb.toString()
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun abbreviateLogger(name: String): String {
        // "com.vectorbea.api.http.HttpServer" → "a.h.HttpServer"
        val parts = name.split('.')
        if (parts.size <= 2) return name
        return parts.dropLast(1).joinToString(".") { it.take(1) } + "." + parts.last()
    }

    private fun buildStackTrace(tp: IThrowableProxy): String {
        val sb = StringBuilder()
        var current: IThrowableProxy? = tp
        var depth = 0
        while (current != null && depth < 3) {
            if (depth > 0) sb.append(" | caused by: ${current.className}: ${current.message}")
            val frames = current.stackTraceElementProxyArray ?: break
            val relevant = frames
                .map { it.steAsString }
                .filter { "com.vectorbea" in it || "kotlin.coroutines" in it }
                .take(MAX_STACK_LINES)
            if (relevant.isNotEmpty()) {
                if (depth > 0) sb.append(" → ")
                sb.append(relevant.joinToString(" | "))
            }
            current = current.cause
            depth++
        }
        return sb.toString().take(2000)
    }

    private var firstInObject = false

    private fun appendStr(sb: StringBuilder, key: String, value: String, first: Boolean = false) {
        if (!first) sb.append(',')
        sb.append('"')
        appendEscaped(sb, key)
        sb.append("\":\"")
        appendEscaped(sb, value)
        sb.append('"')
    }

    private fun appendEscaped(sb: StringBuilder, s: String) {
        for (ch in s) {
            when (ch) {
                '"'  -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (ch.code < 0x20) sb.append("\\u${ch.code.toString(16).padStart(4, '0')}") else sb.append(ch)
            }
        }
    }
}
