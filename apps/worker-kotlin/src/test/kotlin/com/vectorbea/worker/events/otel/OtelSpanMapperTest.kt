package com.vectorbea.worker.events.otel

import io.opentelemetry.api.common.AttributeKey
import io.opentelemetry.api.trace.SpanKind
import io.opentelemetry.api.trace.StatusCode
import io.opentelemetry.sdk.resources.Resource
import java.time.Instant
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §9 — the mapping from a `run_spans` row to an OTel span.
 *
 * All of it is pure, so all of it is asserted here rather than by looking at a
 * Jaeger screenshot. What a screenshot would tell you — "the tree looks right" —
 * is the one thing a test can state precisely: which parent, which trace, which
 * attribute keys, spelled out.
 */
class OtelSpanMapperTest {

    private val resource: Resource = Resource.create(
        io.opentelemetry.api.common.Attributes.of(
            AttributeKey.stringKey("service.name"), "vectorbea-agents"))

    private fun row(
        kind: String = "llm_call",
        name: String = "gpt-4o",
        status: String = "ok",
        spanId: UUID = UUID.randomUUID(),
        traceId: UUID = UUID.randomUUID(),
        parentSpanId: UUID? = null,
        attributesJson: String? = null,
        tokensIn: Int? = null,
        tokensOut: Int? = null,
        endedAt: Instant? = Instant.parse("2026-08-31T10:00:02Z"),
        failureClass: String? = null,
        iterationIndex: Int? = null,
    ) = OtelSpanMapper.Row(
        spanId = spanId, traceId = traceId, runId = UUID.randomUUID(),
        parentSpanId = parentSpanId, workspaceId = UUID.randomUUID(),
        kind = kind, name = name, status = status,
        stepId = "n-agent-1", activationId = null, iterationIndex = iterationIndex,
        attempt = 1,
        startedAt = Instant.parse("2026-08-31T10:00:00Z"), endedAt = endedAt,
        durationMs = 2_000, selfMs = 1_500,
        attributesJson = attributesJson, failureClass = failureClass,
        isRootCause = false, tokensIn = tokensIn, tokensOut = tokensOut, costCents = 1.25,
    )

    private fun attrs(r: OtelSpanMapper.Row, reparent: OtelSpanMapper.Reparent? = null) =
        OtelSpanMapper.toSpanData(r, resource, reparent).attributes.asMap()
            .mapKeys { it.key.key }

    // ── Ids ───────────────────────────────────────────────────────────────────

    @Test
    fun `a trace id is the UUID, unchanged`() {
        val u = UUID.fromString("0189d5f0-1c2b-7a3d-9e4f-5a6b7c8d9e0f")
        assertEquals("0189d5f01c2b7a3d9e4f5a6b7c8d9e0f", OtelIds.traceId(u))
        assertEquals(32, OtelIds.traceId(u).length)
    }

    @Test
    fun `a span id is sixteen hex characters, folded from all 128 bits`() {
        repeat(200) {
            val hex = OtelIds.spanId(UUID.randomUUID())
            assertEquals(16, hex.length)
            assertTrue(hex.matches(Regex("[0-9a-f]{16}")))
        }
    }

    /**
     * Zero is the INVALID span id — a backend drops a span carrying it, silently.
     * The one UUID that folds to zero is the one where both halves are equal.
     */
    @Test
    fun `a span id is never all zeroes`() {
        val degenerate = UUID(0x1122334455667788L, 0x1122334455667788L)
        assertEquals(0L, degenerate.mostSignificantBits xor degenerate.leastSignificantBits)
        assertFalse(OtelIds.spanId(degenerate) == OtelIds.NO_PARENT)
    }

    /**
     * The rule has to be one function, because the parent link is the SAME id
     * mapped by it. A parent and child that disagreed by a bit would render as
     * two orphan roots and look like a data bug rather than an encoding one.
     */
    @Test
    fun `the parent link uses the same folding as the span itself`() {
        val parent = UUID.randomUUID()
        val child = row(parentSpanId = parent)
        val data = OtelSpanMapper.toSpanData(child, resource)
        assertEquals(OtelIds.spanId(parent), data.parentSpanContext.spanId)
        assertEquals(data.spanContext.traceId, data.parentSpanContext.traceId,
            "a parent in another trace is not a parent")
    }

    @Test
    fun `a root span has no parent`() {
        val data = OtelSpanMapper.toSpanData(row(kind = "run", parentSpanId = null), resource)
        assertFalse(data.parentSpanContext.isValid)
    }

    // ── GenAI conventions ─────────────────────────────────────────────────────

    @Test
    fun `an llm_call carries the GenAI attributes`() {
        val a = attrs(row(
            kind = "llm_call", name = "claude-opus-5", tokensIn = 1_200, tokensOut = 340,
            attributesJson = """{"provider":"anthropic","model":"claude-opus-5"}"""))

        assertEquals("chat", a["gen_ai.operation.name"])
        assertEquals("anthropic", a["gen_ai.system"])
        assertEquals("claude-opus-5", a["gen_ai.request.model"])
        assertEquals(1_200L, a["gen_ai.usage.input_tokens"])
        assertEquals(340L, a["gen_ai.usage.output_tokens"])
    }

    /**
     * `provider` and `model` map to the convention keys and are NOT also copied
     * into `vectorbea.*`. One fact, one key — duplicating it means two places to
     * disagree and doubles the attribute count on the highest-volume span kind.
     */
    @Test
    fun `provider and model are not duplicated into the vectorbea namespace`() {
        val a = attrs(row(attributesJson = """{"provider":"openai","model":"gpt-4o"}"""))
        assertNull(a["vectorbea.provider"])
        assertNull(a["vectorbea.model"])
    }

    @Test
    fun `each kind gets the right operation name, or none at all`() {
        assertEquals("chat", attrs(row(kind = "llm_call"))["gen_ai.operation.name"])
        assertEquals("execute_tool", attrs(row(kind = "tool_call"))["gen_ai.operation.name"])
        assertEquals("invoke_agent", attrs(row(kind = "activation"))["gen_ai.operation.name"])
        assertEquals("invoke_agent", attrs(row(kind = "handoff"))["gen_ai.operation.name"])
        /* A kind with no honest mapping gets nothing rather than a guess: a wrong
           value mis-groups our spans inside somebody else's GenAI dashboards. */
        assertNull(attrs(row(kind = "tick"))["gen_ai.operation.name"])
        assertNull(attrs(row(kind = "wait"))["gen_ai.operation.name"])
    }

    @Test
    fun `span names follow the convention's operation-then-target shape`() {
        assertEquals("chat gpt-4o", OtelSpanMapper.spanName(row(kind = "llm_call", name = "gpt-4o")))
        assertEquals("execute_tool send_email",
            OtelSpanMapper.spanName(row(kind = "tool_call", name = "send_email")))
        assertEquals("invoke_agent researcher",
            OtelSpanMapper.spanName(row(kind = "activation", name = "researcher")))
        assertEquals("iteration 3",
            OtelSpanMapper.spanName(row(kind = "iteration", name = "iter", iterationIndex = 3)))
        assertEquals("tick tick", OtelSpanMapper.spanName(row(kind = "tick", name = "tick")))
    }

    @Test
    fun `outbound calls are CLIENT spans and everything else is INTERNAL`() {
        assertEquals(SpanKind.CLIENT, OtelSpanMapper.toSpanData(row(kind = "llm_call"), resource).kind)
        assertEquals(SpanKind.CLIENT, OtelSpanMapper.toSpanData(row(kind = "tool_call"), resource).kind)
        assertEquals(SpanKind.INTERNAL, OtelSpanMapper.toSpanData(row(kind = "activation"), resource).kind)
    }

    // ── vectorbea.* ───────────────────────────────────────────────────────────

    /**
     * The attributes that explain a thin answer — §2's two families — have to
     * survive as queryable keys. A backend cannot filter inside an opaque JSON
     * string, so promoting them individually is the whole point of the namespace.
     */
    @Test
    fun `span attributes are promoted individually, not shipped as a blob`() {
        val a = attrs(row(kind = "iteration", attributesJson = """
            {"context_truncated":true,
             "context_dropped_sections":["OBSERVATIONS","HANDOFFS"],
             "context_chars":47210,
             "budget_clamped":true,
             "depth":2,
             "role":"researcher"}
        """.trimIndent()))

        assertEquals(true, a["vectorbea.context_truncated"])
        assertEquals(listOf("OBSERVATIONS", "HANDOFFS"), a["vectorbea.context_dropped_sections"])
        assertEquals(47_210L, a["vectorbea.context_chars"])
        assertEquals(true, a["vectorbea.budget_clamped"])
        assertEquals(2L, a["vectorbea.depth"])
        assertEquals("researcher", a["vectorbea.role"])
    }

    @Test
    fun `self time and duration are exported, because a waterfall cannot re-derive self time`() {
        val a = attrs(row())
        assertEquals(2_000L, a["vectorbea.duration_ms"])
        assertEquals(1_500L, a["vectorbea.self_ms"])
    }

    /** A nested object has no attribute representation; inventing key names for it would. */
    @Test
    fun `nested objects and nulls are skipped rather than flattened`() {
        /* `role` is on the allowlist, so it isolates the SHAPE rule from the
           allowlist rule — a test using an unlisted key here would pass for the
           wrong reason. */
        val a = attrs(row(attributesJson = """{"role":{"a":1},"depth":null,"contract_hash":"abc"}"""))
        assertNull(a["vectorbea.role"], "an object has no attribute representation")
        assertNull(a["vectorbea.depth"], "a null is absent, not empty")
        assertEquals("abc", a["vectorbea.contract_hash"])
    }

    // ── The export allowlist (M1b) ────────────────────────────────────────────

    /**
     * Attributes leave the building only if they are on the list.
     *
     * Passthrough governed by convention — "attributes are small flat filter
     * keys, never payload" — is true today and enforced by nothing. On an
     * internal table that is a mess; on an egress to a customer's observability
     * vendor it is a disclosure, and it would arrive the first time somebody put
     * a useful-looking string on a span without thinking about where spans go.
     */
    @Test
    fun `an attribute not on the allowlist is dropped`() {
        OtelSpanMapper.resetDroppedAttributes()
        val a = attrs(row(attributesJson =
            """{"budget_clamped":true,"prompt_text":"the whole prompt","user_email":"a@b.c"}"""))

        assertEquals(true, a["vectorbea.budget_clamped"], "an allowlisted key must get through")
        assertNull(a["vectorbea.prompt_text"])
        assertNull(a["vectorbea.user_email"])
        assertTrue(a.keys.none { it.contains("prompt_text") || it.contains("user_email") },
            "an unlisted key reached the exported attributes under some other name")
    }

    /**
     * A refusal is counted, not silent.
     *
     * An operator who cannot find an attribute needs to know whether it was never
     * recorded or refused at the boundary — those send them to different places.
     */
    @Test
    fun `a dropped attribute is counted by key`() {
        OtelSpanMapper.resetDroppedAttributes()
        repeat(3) { attrs(row(attributesJson = """{"mystery_field":1}""")) }
        assertEquals(3L, OtelSpanMapper.droppedAttributeCounts()["mystery_field"])
    }

    /**
     * The two families §2 calls out — what the assembler dropped, and what the
     * budget clamped — must survive the allowlist. They are the whole reason the
     * `vectorbea.*` namespace is exported at all.
     */
    @Test
    fun `the attributes that explain a thin answer are all exportable`() {
        listOf(
            "context_truncated", "context_dropped_sections", "context_over_budget",
            "budget_clamped", "budget_clamped_dimensions",
        ).forEach {
            assertTrue(it in OtelSpanMapper.EXPORTABLE_ATTRIBUTES,
                "$it explains a thin answer and must be exportable")
        }
    }

    @Test
    fun `malformed attribute json does not lose the span`() {
        val data = OtelSpanMapper.toSpanData(row(attributesJson = "{not json"), resource)
        assertEquals("chat gpt-4o", data.name)
        assertEquals("llm_call", data.attributes.asMap().mapKeys { it.key.key }["vectorbea.kind"])
    }

    // ── Status ────────────────────────────────────────────────────────────────

    /**
     * The failure CLASS travels, never the error body. A status description goes
     * to a third party's backend, and `error_json` is not something to forward on
     * the strength of it having been sanitized for our own storage.
     */
    @Test
    fun `a failure carries its taxonomy label and nothing else`() {
        val data = OtelSpanMapper.toSpanData(
            row(status = "failed", failureClass = "PROVIDER_TIMEOUT"), resource)
        assertEquals(StatusCode.ERROR, data.status.statusCode)
        assertEquals("PROVIDER_TIMEOUT", data.status.description)
    }

    @Test
    fun `running and cancelled are UNSET, not errors`() {
        assertEquals(StatusCode.UNSET,
            OtelSpanMapper.toSpanData(row(status = "running"), resource).status.statusCode)
        assertEquals(StatusCode.UNSET,
            OtelSpanMapper.toSpanData(row(status = "cancelled"), resource).status.statusCode)
        assertEquals(StatusCode.OK,
            OtelSpanMapper.toSpanData(row(status = "ok"), resource).status.statusCode)
    }

    /**
     * An unclosed span is usually the most interesting row in a trace — the
     * activation that was running when the worker died. It is exported as a point
     * in time rather than dropped or stretched to the epoch.
     */
    @Test
    fun `a span that never closed becomes a zero-length span, not a dropped one`() {
        val data = OtelSpanMapper.toSpanData(row(status = "running", endedAt = null), resource)
        assertEquals(data.startEpochNanos, data.endEpochNanos)
        assertTrue(data.hasEnded())
    }

    // ── Reparenting ───────────────────────────────────────────────────────────

    /**
     * The acceptance criterion, at the mapping layer: a child run's spans are
     * re-rooted onto the parent's trace and its root span is hung off the
     * delegating activation.
     */
    @Test
    fun `reparenting puts a child run's spans in the parent's trace`() {
        val parentTrace = UUID.randomUUID()
        val childTrace = UUID.randomUUID()
        val childRootSpan = UUID.randomUUID()
        val delegatingActivation = UUID.randomUUID()

        val reparent = OtelSpanMapper.Reparent(
            traceId = parentTrace,
            parentOverride = mapOf(childRootSpan to delegatingActivation))

        val childRoot = OtelSpanMapper.toSpanData(
            row(kind = "run", traceId = childTrace, spanId = childRootSpan, parentSpanId = null),
            resource, reparent)

        assertEquals(OtelIds.traceId(parentTrace), childRoot.spanContext.traceId,
            "the child run must land in the parent's trace, not its own")
        assertEquals(OtelIds.spanId(delegatingActivation), childRoot.parentSpanContext.spanId,
            "the child run's root must hang off the agent that delegated it")

        // A span with no override keeps its own parent, re-rooted.
        val inner = OtelSpanMapper.toSpanData(
            row(kind = "iteration", traceId = childTrace, parentSpanId = childRootSpan),
            resource, reparent)
        assertEquals(OtelIds.traceId(parentTrace), inner.spanContext.traceId)
        assertEquals(OtelIds.spanId(childRootSpan), inner.parentSpanContext.spanId)
    }

    @Test
    fun `the resource carries the workspace's chosen service name`() {
        val data = OtelSpanMapper.toSpanData(row(), resource)
        assertEquals("vectorbea-agents",
            data.resource.attributes.get(AttributeKey.stringKey("service.name")))
        assertEquals("com.vectorbea.agent-runtime", data.instrumentationScopeInfo.name)
    }
}
