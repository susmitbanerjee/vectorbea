package com.vectorbea.observability.tracing

import io.opentelemetry.api.OpenTelemetry
import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.api.common.Attributes
import io.opentelemetry.api.trace.Span
import io.opentelemetry.api.trace.SpanKind
import io.opentelemetry.api.trace.StatusCode
import io.opentelemetry.api.trace.Tracer
import io.opentelemetry.context.Context
import io.opentelemetry.extension.kotlin.asContextElement
import io.opentelemetry.context.propagation.TextMapGetter
import io.opentelemetry.context.propagation.TextMapSetter
import com.vectorbea.observability.logging.LogContext
import org.slf4j.LoggerFactory

/**
 * Spans across the whole path: request → enqueue → claim → node → tool call → done.
 *
 * THE HARD PART IS THE QUEUE, NOT THE SPANS
 * -----------------------------------------
 * In-process tracing is easy - the context is ambient and every child span finds its
 * parent. The moment work crosses a queue, the parent is in a different process that
 * has already returned, and the trace breaks exactly where it becomes interesting:
 * "the user pressed Run at 09:41 and the node started at 09:46, where were those five
 * minutes?" is a question that spans the boundary.
 *
 * So the W3C traceparent is serialised into the job payload at enqueue and extracted at
 * claim. The queue carries the trace as data, the same way it carries the run id. See
 * [inject] and [extractContext].
 *
 * The link is a parent-child relationship rather than a span link, deliberately: the
 * claim genuinely is caused by the enqueue and belongs in the same trace, not in a
 * related one. Span links are for fan-in, e.g. a batch that merges many causes.
 *
 * INERT BY DEFAULT
 * ----------------
 * With `OTEL_ENABLED` unset this uses OpenTelemetry's no-op implementation: spans are
 * created and discarded with no exporter, no batching thread and no network. That is
 * the right default for local development and it means the instrumentation can live on
 * the hot path unconditionally rather than behind `if (tracingEnabled)` at every site.
 */
object Tracing {
    private val log = LoggerFactory.getLogger(Tracing::class.java)

    @Volatile private var otel: OpenTelemetry = OpenTelemetry.noop()
    @Volatile private var tracer: Tracer = otel.getTracer("com.vectorbea")
    @Volatile var enabled: Boolean = false
        private set

    /** W3C traceparent, the field name used inside the job payload. */
    const val TRACEPARENT = "traceparent"
    const val TRACESTATE = "tracestate"

    /**
     * Initialise from the environment.
     *
     * Never throws. An observability layer that prevents the service from starting has
     * inverted its own purpose; a failure here logs and leaves the no-op in place.
     */
    fun init(serviceName: String, endpoint: String?, enabledFlag: Boolean, resourceAttributes: String? = null) {
        if (!enabledFlag || endpoint.isNullOrBlank()) {
            log.info("[tracing] disabled (OTEL_ENABLED={}, endpoint={}) - spans are no-ops",
                enabledFlag, endpoint ?: "unset")
            return
        }
        try {
            // Configured through the autoconfigure SDK so the standard OTEL_* variables
            // work without this file growing a parser for each of them.
            System.setProperty("otel.service.name", serviceName)
            System.setProperty("otel.exporter.otlp.endpoint", endpoint)
            System.setProperty("otel.traces.exporter", "otlp")
            System.setProperty("otel.metrics.exporter", "none")   // Prometheus scrape owns metrics
            System.setProperty("otel.logs.exporter", "none")      // Loki owns logs
            resourceAttributes?.let { System.setProperty("otel.resource.attributes", it) }

            val sdk = io.opentelemetry.sdk.autoconfigure.AutoConfiguredOpenTelemetrySdk
                .builder().setResultAsGlobal().build().openTelemetrySdk
            otel = sdk
            tracer = sdk.getTracer("com.vectorbea")
            enabled = true
            log.info("[tracing] enabled - service={} endpoint={}", serviceName, endpoint)
        } catch (e: Throwable) {
            /* The SDK logs only "Error encountered during autoconfiguration" through
               java.util.logging, which says nothing about WHICH setting is wrong. The
               cause chain does — usually a malformed OTEL_* variable (an endpoint
               without http://, or OTEL_EXPORTER_OTLP_HEADERS with an unencoded space). */
            val causes = generateSequence(e) { it.cause }.take(4)
                .joinToString(" <- ") { "${it.javaClass.simpleName}: ${it.message}" }
            log.error("[tracing] could not initialise, continuing without traces. " +
                "Check the OTEL_* variables on this service. Cause: {}", causes)
        }
    }

    fun tracer(): Tracer = tracer

    /**
     * Run [block] inside a span, recording the outcome.
     *
     * The span is closed on every path including a thrown exception, and a thrown
     * exception marks the span ERROR before rethrowing - an exception that leaves a
     * span looking successful is worse than no span.
     *
     * The span's ids are also pushed into [LogContext], which is what correlates a Loki
     * log line with a trace: clicking a trace in Grafana and getting its logs depends on
     * `trace_id` being in the log envelope, not on anything OpenTelemetry does.
     */
    fun <T> span(
        name: String,
        kind: SpanKind = SpanKind.INTERNAL,
        attributes: Map<String, String> = emptyMap(),
        parent: Context? = null,
        block: (Span) -> T,
    ): T {
        val builder = tracer.spanBuilder(name).setSpanKind(kind)
        parent?.let { builder.setParent(it) }
        attributes.forEach { (k, v) -> builder.setAttribute(k, v) }
        val span = builder.startSpan()

        val previousTrace = LogContext.get(LogContext.TRACE_ID)
        val previousSpan = LogContext.get(LogContext.SPAN_ID)
        val ctx = span.spanContext
        if (ctx.isValid) {
            LogContext.put(LogContext.TRACE_ID, ctx.traceId)
            LogContext.put(LogContext.SPAN_ID, ctx.spanId)
        }

        return try {
            span.makeCurrent().use { block(span) }
        } catch (e: Throwable) {
            span.recordException(e)
            span.setStatus(StatusCode.ERROR, e.message ?: e::class.java.simpleName)
            throw e
        } finally {
            span.end()
            LogContext.put(LogContext.TRACE_ID, previousTrace)
            LogContext.put(LogContext.SPAN_ID, previousSpan)
        }
    }

    /**
     * The suspending form, for work that crosses coroutine suspension points.
     *
     * NOT just [span] with a suspend lambda. `Span.makeCurrent()` returns a
     * thread-local Scope that must be closed on the thread that opened it; a coroutine
     * can resume anywhere, so using the thread-local form around a suspending block
     * attributes the work after the first suspension to whatever span happens to be
     * current on the resuming thread — usually none, occasionally another run's.
     *
     * That failure is invisible: the span exists, has a duration, and is simply missing
     * its children. `asContextElement()` puts the context in the COROUTINE context, so
     * it travels with the coroutine.
     */
    suspend fun <T> spanSuspending(
        name: String,
        kind: SpanKind = SpanKind.INTERNAL,
        attributes: Map<String, String> = emptyMap(),
        parent: Context? = null,
        block: suspend (Span) -> T,
    ): T {
        val builder = tracer.spanBuilder(name).setSpanKind(kind)
        parent?.let { builder.setParent(it) }
        attributes.forEach { (k, v) -> builder.setAttribute(k, v) }
        val span = builder.startSpan()

        val previousTrace = LogContext.get(LogContext.TRACE_ID)
        val previousSpan = LogContext.get(LogContext.SPAN_ID)
        val ctx = span.spanContext
        if (ctx.isValid) {
            LogContext.put(LogContext.TRACE_ID, ctx.traceId)
            LogContext.put(LogContext.SPAN_ID, ctx.spanId)
        }

        return try {
            kotlinx.coroutines.withContext(
                Context.current().with(span).asContextElement()
            ) { block(span) }
        } catch (e: Throwable) {
            span.recordException(e)
            span.setStatus(StatusCode.ERROR, e.message ?: e::class.java.simpleName)
            throw e
        } finally {
            span.end()
            LogContext.put(LogContext.TRACE_ID, previousTrace)
            LogContext.put(LogContext.SPAN_ID, previousSpan)
        }
    }

    /**
     * Serialise the current trace context into a mutable map — the job payload.
     *
     * Returns the map unchanged when tracing is off, so a payload written by a process
     * with tracing disabled is byte-identical to one written before this existed. That
     * matters: the payload is hashed for idempotency in places, and a traceparent that
     * appeared and disappeared with a feature flag would change those hashes.
     */
    fun inject(carrier: MutableMap<String, String>): MutableMap<String, String> {
        if (!enabled) return carrier
        otel.propagators.textMapPropagator.inject(Context.current(), carrier, MapSetter)
        return carrier
    }

    /** Recover the enqueuing process's context from a job payload. */
    fun extractContext(carrier: Map<String, String>): Context? {
        if (!enabled) return null
        if (carrier[TRACEPARENT].isNullOrBlank()) return null
        return otel.propagators.textMapPropagator.extract(Context.root(), carrier, MapGetter)
    }

    /** The current trace id, for putting on a run row so the UI can deep-link to Grafana. */
    fun currentTraceId(): String? =
        Span.current().spanContext.takeIf { it.isValid }?.traceId

    fun attributes(vararg pairs: Pair<String, String>): Attributes {
        val b = Attributes.builder()
        pairs.forEach { (k, v) -> b.put(AttributeKey.stringKey(k), v) }
        return b.build()
    }

    private object MapSetter : TextMapSetter<MutableMap<String, String>> {
        override fun set(carrier: MutableMap<String, String>?, key: String, value: String) {
            carrier?.put(key, value)
        }
    }

    private object MapGetter : TextMapGetter<Map<String, String>> {
        override fun keys(carrier: Map<String, String>): Iterable<String> = carrier.keys
        override fun get(carrier: Map<String, String>?, key: String): String? = carrier?.get(key)
    }
}
