package com.vectorbea.worker.events.otel

import java.util.UUID

/**
 * Our ids, expressed as OpenTelemetry's.
 *
 * ── THE SHAPE MISMATCH, AND WHY IT IS NOT A DETAIL ──────────────────────────
 * A W3C trace id is 16 bytes and a span id is 8. Ours are both UUIDs — 16 bytes
 * each. So a trace id maps across exactly, and a span id has to lose half its
 * bits.
 *
 * That halving must be DETERMINISTIC and it must be the same function everywhere,
 * because `parent_span_id` is mapped by the same rule. If the parent and the
 * child disagreed by one bit the backend would show two orphan roots instead of
 * a tree, and the failure would look like a data problem rather than an encoding
 * one.
 *
 * ── XOR, NOT TRUNCATION ─────────────────────────────────────────────────────
 * Taking the high 8 bytes would be simpler and is wrong here. Several span ids
 * are DERIVED rather than random — `SpanWriter.runSpanId(runId)` and
 * `waitSpanId(...)` build a UUID from a name hash so a redelivered span is
 * idempotent — and a derived id family can share structure in its high bits.
 * Folding the whole 128 bits with XOR uses every bit of whatever generated it.
 *
 * The all-zero guard is not decoration: `0000000000000000` is the INVALID span
 * id in the spec, and an exporter that emits one produces a span the backend
 * drops silently.
 */
object OtelIds {

    /** 32 lowercase hex characters. A UUID is already 16 bytes. */
    fun traceId(id: UUID): String =
        "%016x%016x".format(id.mostSignificantBits, id.leastSignificantBits)

    /** 16 lowercase hex characters, folded from all 128 bits. */
    fun spanId(id: UUID): String {
        val folded = id.mostSignificantBits xor id.leastSignificantBits
        /* Zero is the invalid span id. One is as arbitrary as anything else and,
           unlike zero, is a span the backend will keep. */
        return "%016x".format(if (folded == 0L) 1L else folded)
    }

    /** The all-zero span id, which OTel reads as "no parent". */
    const val NO_PARENT: String = "0000000000000000"
}
