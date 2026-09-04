package com.vectorbea.observability.logging

import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.spi.IThrowableProxy
import ch.qos.logback.core.encoder.EncoderBase
import com.vectorbea.observability.logging.LogContext.ENVELOPE_KEYS
import java.io.PrintWriter
import java.io.StringWriter
import java.time.Instant

/**
 * One JSON object per line, with a fixed envelope.
 *
 *   {"timestamp":"2026-08-18T09:41:02.117Z","level":"INFO","service":"worker",
 *    "worker_id":"w-3","run_id":"...","node_id":"extract","workspace_id":"...",
 *    "trace_id":"...","logger":"...","message":"...","fields":{...}}
 *
 * WHY AN ENCODER AND NOT A PATTERN LAYOUT
 * ---------------------------------------
 * A pattern layout that emits JSON-shaped text works until a message contains a quote,
 * a newline or a stack trace - at which point the line stops being parseable and Loki
 * drops it or, worse, indexes half of it. Every value here goes through a real escaper.
 *
 * WHY NOT logstash-logback-encoder
 * --------------------------------
 * It would do this and more. It is ~400KB of dependency and a large configuration
 * surface for an envelope that is fixed by design and fits in one file. If the envelope
 * ever needs to stop being fixed, take the dependency.
 *
 * THE `fields` SUB-OBJECT
 * -----------------------
 * Envelope keys are promoted to the top level because Loki and Grafana filter on them
 * constantly. Everything else nests under `fields` so that an ad-hoc key from one call
 * site can never collide with an envelope key and quietly change the meaning of a
 * dashboard query.
 */
class JsonLogEncoder : EncoderBase<ILoggingEvent>() {

    /** Stack traces are large; on by default because a stack trace you did not keep is gone. */
    var includeStackTrace: Boolean = true

    /** Truncation guard — a runaway message must not fill the disk one line at a time. */
    var maxMessageChars: Int = 8_000

    override fun headerBytes(): ByteArray = ByteArray(0)
    override fun footerBytes(): ByteArray = ByteArray(0)

    override fun encode(event: ILoggingEvent): ByteArray = buildString(256) {
        append('{')
        field("timestamp", Instant.ofEpochMilli(event.timeStamp).toString())
        append(',')
        field("level", event.level.toString())

        val mdc = event.mdcPropertyMap ?: emptyMap()
        for (key in ENVELOPE_KEYS) {
            mdc[key]?.let { append(','); field(key, it) }
        }

        append(',')
        field("logger", event.loggerName)
        append(',')
        field("thread", event.threadName)
        append(',')
        field("message", event.formattedMessage.orEmpty().take(maxMessageChars))

        val extra = mdc.filterKeys { it !in ENVELOPE_KEYS }
        if (extra.isNotEmpty()) {
            append(",\"fields\":{")
            var first = true
            for ((k, v) in extra) {
                if (!first) append(',')
                field(k, v)
                first = false
            }
            append('}')
        }

        event.throwableProxy?.let { t ->
            append(",\"error\":{")
            field("type", t.className)
            append(',')
            field("message", t.message.orEmpty())
            if (includeStackTrace) {
                append(',')
                field("stack", renderStack(t).take(maxMessageChars))
            }
            append('}')
        }

        append("}\n")
    }.toByteArray(Charsets.UTF_8)

    private fun StringBuilder.field(key: String, value: String) {
        append('"').append(key).append("\":\"").appendEscaped(value).append('"')
    }

    private fun StringBuilder.appendEscaped(s: String): StringBuilder {
        for (c in s) when {
            c == '"'  -> append("\\\"")
            c == '\\' -> append("\\\\")
            c == '\n' -> append("\\n")
            c == '\r' -> append("\\r")
            c == '\t' -> append("\\t")
            // Control characters would make the line unparseable; \u-escape them rather
            // than dropping, so a payload that contains one is still diagnosable.
            c < ' '   -> append(String.format("\\u%04x", c.code))
            else      -> append(c)
        }
        return this
    }

    private fun renderStack(t: IThrowableProxy): String {
        val sw = StringWriter()
        val pw = PrintWriter(sw)
        var cur: IThrowableProxy? = t
        var depth = 0
        while (cur != null && depth < 5) {
            if (depth > 0) pw.print("Caused by: ")
            pw.println("${cur.className}: ${cur.message}")
            cur.stackTraceElementProxyArray?.take(30)?.forEach { pw.println("\tat ${it.getSTEAsString()}") }
            cur = cur.cause
            depth++
        }
        pw.flush()
        return sw.toString()
    }
}
