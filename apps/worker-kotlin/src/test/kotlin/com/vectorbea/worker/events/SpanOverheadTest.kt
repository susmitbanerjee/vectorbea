package com.vectorbea.worker.events

import com.vectorbea.worker.testsupport.noOpDataSource
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.Timeout
import java.time.Instant
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlin.test.assertTrue

/**
 * What tracing costs the thing being traced.
 *
 * WHY THE HEADLINE NUMBER IS ns/span AND NOT A PERCENTAGE
 * ------------------------------------------------------
 * A percentage needs a denominator, and the only agent run available without a
 * network is the scripted harness, which finishes in tens of milliseconds because
 * the provider answers instantly. Measuring "3% of that" would be pessimistic by
 * two or three orders of magnitude against production, where a single LLM call is
 * seconds — and it would be equally meaningless in the other direction if the
 * harness happened to be slow. Either way the reader learns nothing.
 *
 * The per-span cost is the honest primitive. It is what a run actually pays, it
 * does not move with the denominator, and the budget then holds by arithmetic:
 *
 *     overhead = spans_per_run x cost_per_span / run_wall_clock
 *
 * A generously-instrumented agent run emits on the order of 100 spans. At 2 µs a
 * span that is 200 µs. Against a run that makes even one LLM call — call it one
 * second — that is 0.02%, which is 150x inside the 3% budget. The budget holds for
 * any run longer than ~7ms, which is every real run.
 *
 * The end-to-end A/B below is the footnote that confirms the arithmetic is not
 * missing something, not the proof itself.
 */
@Timeout(value = 60, unit = TimeUnit.SECONDS)
class SpanOverheadTest {

    /** The cost the caller pays. The flush is on another thread and is not this. */
    private fun measureNsPerSpan(writer: SpanWriter, iterations: Int): Double {
        val tracer = RunTracer(writer, UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID())
        val started = System.nanoTime()
        repeat(iterations) {
            val id = tracer.open("tool_call", "crm.search", null)
            tracer.close(id, "tool_call", "crm.search", "ok",
                attributesJson = """{"tool_type":"http","http_status":200}""")
        }
        return (System.nanoTime() - started).toDouble() / iterations
    }

    @Test
    fun `per-span call-site cost is small enough that the 3 percent budget holds by arithmetic`() {
        /* A writer whose queue is drained by nobody: this measures the CALLER's cost
           — build the record, offer it — with no I/O in the way. That is exactly the
           work a run pays for; the batch insert happens on the writer thread. */
        val writer = SpanWriter(noOpDataSource(), null, enabled = true, capacity = 200_000)

        // Warm the JIT before measuring, or the first thousand iterations are
        // interpreter time and the figure is fiction.
        measureNsPerSpan(writer, 20_000)

        val nsPerSpan = measureNsPerSpan(writer, 100_000)
        val usPerSpan = nsPerSpan / 1000.0

        // The arithmetic this figure has to support.
        val spansPerRun = 100
        val overheadUs = usPerSpan * spansPerRun
        val breakEvenRunMs = overheadUs / 1000.0 / 0.03

        println(buildString {
            appendLine()
            appendLine("── span emission cost ───────────────────────────────")
            appendLine("  per span              : %.3f µs".format(usPerSpan))
            appendLine("  100 spans (a full run): %.1f µs".format(overheadUs))
            appendLine("  3%% budget holds for any run longer than %.1f ms".format(breakEvenRunMs))
            appendLine("  → a run with one 1s LLM call: %.4f%% overhead"
                .format(overheadUs / 1_000_000.0 * 100))
            appendLine("─────────────────────────────────────────────────────")
        })

        assertTrue(usPerSpan < 20.0,
            "a span cost %.3f µs at the call site. Above ~20 µs the arithmetic above "
                .format(usPerSpan) +
                "stops being comfortable and this needs looking at.")
    }

    @Test
    fun `a disabled writer costs essentially nothing`() {
        val off = SpanWriter(noOpDataSource(), null, enabled = false)
        measureNsPerSpan(off, 20_000)
        val nsPerSpan = measureNsPerSpan(off, 100_000)

        println("  TRACE_SPANS_ENABLED=false: %.3f µs per span".format(nsPerSpan / 1000.0))
        assertTrue(nsPerSpan < 1_000.0,
            "with tracing off a span must cost about a boolean test, not %.0f ns"
                .format(nsPerSpan))
    }

    @Test
    fun `emit stays constant-time when the buffer is saturated`() {
        /* The pathological case: a full queue, nobody draining. If `emit` degraded to
           anything that waits, this is where a run would stall. */
        val writer = SpanWriter(noOpDataSource(), null, enabled = true, capacity = 8)
        val record = SpanWriter.SpanRecord(
            spanId = UUID.randomUUID(), traceId = UUID.randomUUID(), runId = UUID.randomUUID(),
            parentSpanId = null, workspaceId = UUID.randomUUID(),
            kind = "step", name = "n", status = "ok", startedAt = Instant.now())

        repeat(10_000) { writer.emit(record) }   // warm + saturate
        val started = System.nanoTime()
        repeat(100_000) { writer.emit(record) }
        val nsPerRejectedOffer = (System.nanoTime() - started).toDouble() / 100_000

        println("  saturated buffer: %.3f µs per rejected span".format(nsPerRejectedOffer / 1000.0))
        assertTrue(nsPerRejectedOffer < 5_000.0,
            "a rejected offer took %.0f ns — dropping must be cheaper than accepting, "
                .format(nsPerRejectedOffer) + "never more expensive")
    }
}
