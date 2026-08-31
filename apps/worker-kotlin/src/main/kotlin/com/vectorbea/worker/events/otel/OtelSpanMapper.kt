package com.vectorbea.worker.events.otel

import com.fasterxml.jackson.databind.JsonNode
import com.fasterxml.jackson.databind.ObjectMapper
import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.api.common.Attributes
import io.opentelemetry.api.common.AttributesBuilder
import io.opentelemetry.api.trace.SpanContext
import io.opentelemetry.api.trace.SpanKind
import io.opentelemetry.api.trace.StatusCode
import io.opentelemetry.api.trace.TraceFlags
import io.opentelemetry.api.trace.TraceState
import io.opentelemetry.sdk.common.InstrumentationScopeInfo
import io.opentelemetry.sdk.resources.Resource
import io.opentelemetry.sdk.trace.data.EventData
import io.opentelemetry.sdk.trace.data.LinkData
import io.opentelemetry.sdk.trace.data.SpanData
import io.opentelemetry.sdk.trace.data.StatusData
import java.time.Instant
import java.util.UUID

/**
 * `run_spans` rows, expressed as OpenTelemetry spans. §9.
 *
 * ── WHY THIS BUILDS SpanData RATHER THAN USING THE Tracer API ───────────────
 * The obvious approach is to open a real OTel span alongside every
 * `RunTracer.open()`. It cannot work here, for a reason that is structural
 * rather than awkward: **a dispatched child activation executes in a different
 * worker process, minutes later.** By then the parent's in-process span is
 * closed and quite possibly on another host, so there is nothing to be a child
 * of. Live instrumentation can express a trace that happens inside one call
 * stack; ours deliberately does not.
 *
 * `run_spans` already solves that — `trace_id` + `parent_span_id` + timestamps
 * stitch the tree across processes and across time, which is exactly what a
 * durable runtime needs. So the export reads the durable tree and emits it.
 *
 * That rules out `Tracer`, because the SDK assigns span ids itself and there is
 * no supported way to hand it ours. What IS supported, stable and public is
 * [SpanData] plus `SpanExporter`: build the spans, hand them to the OTLP
 * exporter. No `IdGenerator` tricks, no `io.opentelemetry.exporter.internal.*`.
 *
 * ── NAMING FOLLOWS THE GenAI CONVENTION, NOT OUR INTERNAL NAMES ─────────────
 * The semantic conventions specify `{operation} {target}` — `chat gpt-4o`,
 * `execute_tool send_email`, `invoke_agent researcher`. Somebody's Tempo already
 * has other GenAI services in it, and a span called `llm_call` sorts and groups
 * differently from every one of them. Exporting means speaking their vocabulary;
 * our names are preserved verbatim on `vectorbea.kind` and `vectorbea.name`.
 *
 * Pure and free of I/O, which is what lets the whole mapping be a unit test
 * rather than something you check by squinting at Jaeger.
 */
object OtelSpanMapper {

    private val mapper = ObjectMapper()

    val SCOPE: InstrumentationScopeInfo =
        InstrumentationScopeInfo.create("com.vectorbea.agent-runtime", "1.0.0", null)

    /** One `run_spans` row, already read. Field-for-field, no interpretation. */
    data class Row(
        val spanId: UUID,
        val traceId: UUID,
        val runId: UUID,
        val parentSpanId: UUID?,
        val workspaceId: UUID,
        val kind: String,
        val name: String,
        val status: String,
        val stepId: String?,
        val activationId: UUID?,
        val iterationIndex: Int?,
        val attempt: Int,
        val startedAt: Instant,
        val endedAt: Instant?,
        val durationMs: Int?,
        val selfMs: Int?,
        val attributesJson: String?,
        val errorJson: String?,
        val failureClass: String?,
        val isRootCause: Boolean,
        val tokensIn: Int?,
        val tokensOut: Int?,
        val costCents: Double?,
    )

    /**
     * Where a span belongs in the exported trace, when that differs from the row.
     *
     * ── WHY THIS EXISTS ─────────────────────────────────────────────────────
     * `run_spans.trace_id` is the RUN id (`WorkflowRuntime.tracerFor` sets
     * `traceId = runId`). A dispatched child is its own run, so it gets its own
     * trace id, and a five-agent team lands in an external backend as six
     * unrelated traces.
     *
     * That is a genuine finding rather than an export inconvenience: internally
     * "trace" and "run" are the same thing, and a logical trace spanning several
     * runs has no id at all. Exporting is what surfaced it — which is precisely
     * the reason §9 says to build this before the schema hardens.
     *
     * Fixed HERE and not in the schema, deliberately: rewriting `trace_id` on
     * child runs would change data every existing reader depends on, for a
     * feature that is off by default. The export re-roots the tree; the eventual
     * schema fix is to give a logical trace its own id, and this override is the
     * shape that fix should take.
     */
    data class Reparent(
        /** The trace id every span in the logical trace shares. */
        val traceId: UUID,
        /** Span ids to re-parent — a child run's root span onto its delegator. */
        val parentOverride: Map<UUID, UUID> = emptyMap(),
    )

    // ── GenAI operation names ─────────────────────────────────────────────────
    // From the GenAI semantic conventions' closed set. A kind with no honest
    // mapping gets NO gen_ai.operation.name at all rather than an invented one:
    // a wrong value here silently mis-groups our spans inside somebody else's
    // dashboards, which is worse than an absent attribute they can filter on.
    private val OPERATION = mapOf(
        "llm_call" to "chat",
        "tool_call" to "execute_tool",
        "activation" to "invoke_agent",
        "handoff" to "invoke_agent",
    )

    private val SPAN_KIND = mapOf(
        "llm_call" to SpanKind.CLIENT,     // an outbound call to a provider
        "tool_call" to SpanKind.CLIENT,    // an outbound call to a tool
        "wait" to SpanKind.INTERNAL,
    )

    fun toSpanData(row: Row, resource: Resource, reparent: Reparent? = null): SpanData {
        val traceUuid = reparent?.traceId ?: row.traceId
        val traceHex = OtelIds.traceId(traceUuid)
        val parentUuid = reparent?.parentOverride?.get(row.spanId) ?: row.parentSpanId

        val ctx = SpanContext.create(
            traceHex, OtelIds.spanId(row.spanId),
            /* Sampled, always. The sampling decision was made before this row was
               ever handed to the exporter — see RunTraceExporter — so a span that
               reaches here is one we have decided to send. Marking it unsampled
               would tell the backend to drop what we just chose to keep. */
            TraceFlags.getSampled(), TraceState.getDefault())

        val parentCtx = if (parentUuid == null) SpanContext.getInvalid()
        else SpanContext.createFromRemoteParent(
            traceHex, OtelIds.spanId(parentUuid),
            TraceFlags.getSampled(), TraceState.getDefault())

        return Exported(
            name = spanName(row),
            kind = SPAN_KIND[row.kind] ?: SpanKind.INTERNAL,
            spanContext = ctx,
            parentSpanContext = parentCtx,
            status = status(row),
            startEpochNanos = nanos(row.startedAt),
            /* A span with no end is one whose run died mid-flight. It still gets
               exported — an unclosed `activation` is often the most interesting
               row in the trace — with its start as its end, so the backend has a
               point in time rather than a span reaching to the epoch. */
            endEpochNanos = nanos(row.endedAt ?: row.startedAt),
            attributes = attributes(row),
            resource = resource,
        )
    }

    /**
     * `{operation} {target}` where the convention defines one, our own name
     * otherwise.
     */
    internal fun spanName(row: Row): String = when (row.kind) {
        "llm_call" -> "chat ${row.name}"
        "tool_call" -> "execute_tool ${row.name}"
        "activation" -> "invoke_agent ${row.name}"
        "handoff" -> "invoke_agent ${row.name}"
        "iteration" -> "iteration ${row.iterationIndex ?: 0}"
        else -> "${row.kind} ${row.name}"
    }

    private fun status(row: Row): StatusData = when (row.status.lowercase()) {
        "ok", "success", "succeeded", "completed" -> StatusData.ok()
        "failed", "error", "timeout" -> StatusData.create(
            StatusCode.ERROR,
            /* The failure CLASS, never the error body. `error_json` is sanitized
               at the write boundary, but a description travels to a third party's
               backend, so this sends the taxonomy label and nothing else. */
            row.failureClass ?: row.status)
        else -> StatusData.unset()   // running, cancelled, skipped — not an error
    }

    private fun attributes(row: Row): Attributes {
        val b = Attributes.builder()

        // ── GenAI semantic conventions ────────────────────────────────────────
        OPERATION[row.kind]?.let { b.put("gen_ai.operation.name", it) }
        row.tokensIn?.let { b.put("gen_ai.usage.input_tokens", it.toLong()) }
        row.tokensOut?.let { b.put("gen_ai.usage.output_tokens", it.toLong()) }

        val attrs = parse(row.attributesJson)
        /* `provider` and `model` are already on every llm_call span — see
           LlmNodeExecutor's close() — so the GenAI mapping needs no new
           instrumentation at the call site. */
        attrs?.get("provider")?.takeIf { it.isTextual }?.let { b.put("gen_ai.system", it.asText()) }
        val model = attrs?.get("model")?.takeIf { it.isTextual }?.asText()
            ?: row.name.takeIf { row.kind == "llm_call" }
        if (model != null) b.put("gen_ai.request.model", model)

        // ── vectorbea.* ───────────────────────────────────────────────────────
        // Our own vocabulary, namespaced so it can never be mistaken for a
        // convention attribute and can be dropped wholesale by a processor that
        // only wants the standard ones.
        b.put("vectorbea.kind", row.kind)
        b.put("vectorbea.name", row.name)
        b.put("vectorbea.run_id", row.runId.toString())
        b.put("vectorbea.workspace_id", row.workspaceId.toString())
        row.stepId?.let { b.put("vectorbea.step_id", it) }
        row.activationId?.let { b.put("vectorbea.activation_id", it.toString()) }
        row.iterationIndex?.let { b.put("vectorbea.iteration", it.toLong()) }
        if (row.attempt != 1) b.put("vectorbea.attempt", row.attempt.toLong())
        row.durationMs?.let { b.put("vectorbea.duration_ms", it.toLong()) }
        /* Self time is the one number a waterfall cannot re-derive: a parent's
           own cost, with its children's time removed. */
        row.selfMs?.let { b.put("vectorbea.self_ms", it.toLong()) }
        row.failureClass?.let { b.put("vectorbea.failure_class", it) }
        if (row.isRootCause) b.put("vectorbea.is_root_cause", true)
        row.costCents?.let { b.put("vectorbea.cost_cents", it) }

        /* Everything the span recorded, promoted individually rather than as one
           JSON blob. `budget_clamped`, `context_truncated`, `depth`, `role`,
           `contract_hash` — all of these are things somebody filters or groups by,
           and a backend cannot query inside an opaque string. Scalars only: a
           nested object has no attribute representation, and flattening one
           invents key names nobody documented. */
        attrs?.fields()?.forEach { (key, value) ->
            if (key == "provider" || key == "model") return@forEach
            putScalar(b, "vectorbea.$key", value)
        }
        return b.build()
    }

    /**
     * One JSON value as an OTel attribute, or nothing.
     *
     * Arrays of strings are supported because `context_dropped_sections` and
     * `budget_clamped_dimensions` are exactly that, and they are two of the most
     * useful things in the whole trace.
     */
    private fun putScalar(b: AttributesBuilder, key: String, v: JsonNode) {
        when {
            v.isTextual -> b.put(key, v.asText())
            v.isBoolean -> b.put(key, v.asBoolean())
            v.isIntegralNumber -> b.put(key, v.asLong())
            v.isNumber -> b.put(key, v.asDouble())
            v.isArray && v.all { it.isTextual } && !v.isEmpty ->
                b.put(AttributeKey.stringArrayKey(key), v.map { it.asText() })
            else -> Unit   // objects, nulls, mixed arrays: no honest representation
        }
    }

    private fun parse(json: String?): JsonNode? =
        if (json.isNullOrBlank() || json == "{}") null
        else runCatching { mapper.readTree(json) }.getOrNull()?.takeIf { it.isObject }

    private fun nanos(i: Instant): Long = i.epochSecond * 1_000_000_000L + i.nano

    /**
     * A finished span, described.
     *
     * `SpanData` is an interface with no public builder outside
     * `opentelemetry-sdk-testing`, which is a test artifact and has no business
     * on a production classpath. The interface itself is public and stable, so
     * implementing it is the supported path rather than a workaround.
     */
    private data class Exported(
        private val name: String,
        private val kind: SpanKind,
        private val spanContext: SpanContext,
        private val parentSpanContext: SpanContext,
        private val status: StatusData,
        private val startEpochNanos: Long,
        private val endEpochNanos: Long,
        private val attributes: Attributes,
        private val resource: Resource,
    ) : SpanData {
        override fun getName() = name
        override fun getKind() = kind
        override fun getSpanContext() = spanContext
        override fun getParentSpanContext() = parentSpanContext
        override fun getStatus() = status
        override fun getStartEpochNanos() = startEpochNanos
        override fun getAttributes() = attributes
        override fun getEvents(): List<EventData> = emptyList()
        override fun getLinks(): List<LinkData> = emptyList()
        override fun getEndEpochNanos() = endEpochNanos
        override fun hasEnded() = true
        override fun getTotalRecordedEvents() = 0
        override fun getTotalRecordedLinks() = 0
        override fun getTotalAttributeCount() = attributes.size()
        override fun getInstrumentationScopeInfo() = SCOPE
        override fun getResource() = resource

        /**
         * Deprecated in the SDK and still abstract in 1.40, so it has to be
         * implemented. Derived from the scope rather than hand-built, so the two
         * cannot drift apart if the scope name changes.
         */
        @Deprecated("Superseded by getInstrumentationScopeInfo()", ReplaceWith("getInstrumentationScopeInfo()"))
        @Suppress("DEPRECATION")
        override fun getInstrumentationLibraryInfo():
            io.opentelemetry.sdk.common.InstrumentationLibraryInfo =
            io.opentelemetry.sdk.common.InstrumentationLibraryInfo.create(
                SCOPE.name, SCOPE.version)
    }
}
