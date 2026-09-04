package com.vectorbea.worker.events.otel

import com.vectorbea.worker.durable.archive.TraceSampler
import com.vectorbea.worker.events.SpanWriter
import io.opentelemetry.api.common.Attributes
import io.opentelemetry.sdk.common.CompletableResultCode
import io.opentelemetry.sdk.resources.Resource
import io.opentelemetry.sdk.trace.data.SpanData
import io.opentelemetry.sdk.trace.export.SpanExporter
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.postgresql.ds.PGSimpleDataSource
import java.time.Duration
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.jupiter.api.Tag

/**
 * §9 acceptance — a team run leaves as ONE trace, with parent/child intact across
 * a dispatched child run.
 *
 * ── WHY THIS IS THE TEST AND NOT A JAEGER SCREENSHOT ────────────────────────
 * The criterion is "appears as a correct trace tree in a local Jaeger or Tempo".
 * What Jaeger would show is derived entirely from the `SpanData` handed to the
 * exporter: one trace id, one root, every parent present. Those are assertions,
 * and asserting them is strictly stronger than looking at them — a screenshot
 * cannot tell you that the SECOND child also linked correctly, and this can.
 *
 * The one thing it does not cover is the OTLP wire encoding, which is
 * `OtlpWireTest`'s job. Between them the only untested link is Jaeger's own
 * ingestion of a well-formed OTLP payload.
 *
 * Everything below the destination seam runs for real: the config read, the
 * sampling decision, the recursive run walk, the reparenting query and the whole
 * attribute mapping. Skips when no database is reachable.
 */
@Tag("integration")
class RunTraceExportTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    /**
     * The database, or a thrown exception naming what is missing.
     *
     * This used to probe a hard-coded localhost port and return null, which
     * turned every test in this class into a silent pass on any machine
     * without it. See [Infra].
     */
    private fun dsOrNull(): DataSource? = com.vectorbea.worker.testsupport.Infra.postgres

    /** Records what would have gone on the wire. */
    private class Recording : SpanExporter {
        val spans = java.util.Collections.synchronizedList(mutableListOf<SpanData>())
        var failNext = false
        override fun export(items: Collection<SpanData>): CompletableResultCode {
            if (failNext) return CompletableResultCode.ofFailure()
            spans.addAll(items)
            return CompletableResultCode.ofSuccess()
        }
        override fun flush() = CompletableResultCode.ofSuccess()
        override fun shutdown() = CompletableResultCode.ofSuccess()
    }

    private fun configWith(ds: DataSource, recording: Recording) =
        object : TraceExportConfig(ds, null) {
            override fun destinationFor(row: Row) = Destination(
                recording,
                Resource.create(Attributes.of(
                    io.opentelemetry.api.common.AttributeKey.stringKey("service.name"),
                    row.serviceName)),
                row.updatedAtMs)
        }

    // ── The world: a supervisor and two dispatched children ───────────────────

    private class Team(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        /** The top run — the one a user started. */
        val parentRun: UUID = UUID.randomUUID(),
        /** The supervisor's activation, which runs inline in [parentRun]. */
        val supervisor: UUID = UUID.randomUUID(),
        /** Two delegated activations, each executing as its own dispatched run. */
        val researcher: UUID = UUID.randomUUID(),
        val writer: UUID = UUID.randomUUID(),
        val researcherRun: UUID = UUID.randomUUID(),
        val writerRun: UUID = UUID.randomUUID(),
    )

    private fun seed(ds: DataSource, failASpan: Boolean = false): Team {
        val t = Team()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, t.workspaceId); it.setString(2, "otel")
                it.setString(3, "otel-" + t.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, t.environmentId); it.setObject(2, t.workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, t.workflowId); it.setObject(2, t.workspaceId)
                it.setObject(3, t.environmentId); it.setString(4, "wf-" + t.workflowId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, t.versionId); it.setObject(2, t.workflowId); it.executeUpdate() }

            fun run(id: UUID, parent: UUID?, activation: UUID?) {
                c.prepareStatement(
                    "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id," +
                    " workflow_version_id,status,duration_ms,parent_run_id,parent_activation_id) " +
                    "VALUES (?,?,?,?,?,'succeeded',600000,?,?)"
                ).use {
                    it.setObject(1, id); it.setObject(2, t.workspaceId); it.setObject(3, t.environmentId)
                    it.setObject(4, t.workflowId); it.setObject(5, t.versionId)
                    it.setObject(6, parent); it.setObject(7, activation)
                    it.executeUpdate()
                }
            }
            run(t.parentRun, null, null)
            run(t.researcherRun, t.parentRun, t.researcher)
            run(t.writerRun, t.parentRun, t.writer)

            fun activation(id: UUID, runId: UUID, parent: UUID?, depth: Int, seq: Int) {
                c.prepareStatement(
                    "INSERT INTO agent_activations (id,run_id,workspace_id,environment_id,step_id," +
                    " parent_activation_id,root_activation_id,depth,sequence,agent_id,status," +
                    " idempotency_key) VALUES (?,?,?,?,'n-team-1',?,?,?,?,?,'succeeded',?)"
                ).use {
                    it.setObject(1, id); it.setObject(2, runId); it.setObject(3, t.workspaceId)
                    it.setObject(4, t.environmentId); it.setObject(5, parent)
                    it.setObject(6, t.supervisor); it.setInt(7, depth); it.setInt(8, seq)
                    it.setObject(9, UUID.randomUUID()); it.setString(10, "idem-$id")
                    it.executeUpdate()
                }
            }
            /* The activations all belong to the PARENT run — a dispatched child is
               the same activation on a different transport, not a new one. That is
               exactly the shape the reparenting query has to navigate. */
            activation(t.supervisor, t.parentRun, null, 0, 0)
            activation(t.researcher, t.parentRun, t.supervisor, 1, 1)
            activation(t.writer, t.parentRun, t.supervisor, 1, 2)

            fun span(
                spanId: UUID, runId: UUID, parentSpan: UUID?, kind: String, name: String,
                activationId: UUID? = null, status: String = "ok", attrs: String = "{}",
            ) {
                c.prepareStatement(
                    "INSERT INTO run_spans (span_id,trace_id,run_id,parent_span_id,workspace_id," +
                    " kind,name,status,step_id,activation_id,started_at,ended_at,duration_ms," +
                    " self_ms,attributes_json,tokens_in,tokens_out,created_at) " +
                    "VALUES (?,?,?,?,?,?,?,?,'n-team-1',?, now(), now(), 100, 80, ?::jsonb, 10, 5, now())"
                ).use {
                    it.setObject(1, spanId); it.setObject(2, runId)   // trace_id == run_id
                    it.setObject(3, runId); it.setObject(4, parentSpan); it.setObject(5, t.workspaceId)
                    it.setString(6, kind); it.setString(7, name); it.setString(8, status)
                    it.setObject(9, activationId); it.setString(10, attrs)
                    it.executeUpdate()
                }
            }

            // Parent run: run → tick → step → activation(supervisor) → iteration → llm_call
            val pRun = SpanWriter.runSpanId(t.parentRun)
            val pTick = UUID.randomUUID(); val pStep = UUID.randomUUID()
            val pAct = UUID.randomUUID(); val pIter = UUID.randomUUID()
            span(pRun, t.parentRun, null, "run", "run")
            span(pTick, t.parentRun, pRun, "tick", "tick")
            span(pStep, t.parentRun, pTick, "step", "team")
            span(pAct, t.parentRun, pStep, "activation", "supervisor", t.supervisor)
            span(pIter, t.parentRun, pAct, "iteration", "iter", t.supervisor)
            span(UUID.randomUUID(), t.parentRun, pIter, "llm_call", "claude-opus-5", t.supervisor,
                attrs = """{"provider":"anthropic","model":"claude-opus-5"}""")

            // Each child run: run → activation → iteration → llm_call
            listOf(t.researcherRun to t.researcher, t.writerRun to t.writer)
                .forEachIndexed { i, (runId, actId) ->
                    val cRun = SpanWriter.runSpanId(runId)
                    val cAct = UUID.randomUUID(); val cIter = UUID.randomUUID()
                    span(cRun, runId, null, "run", "run")
                    span(cAct, runId, cRun, "activation",
                        if (i == 0) "researcher" else "writer", actId)
                    span(cIter, runId, cAct, "iteration", "iter", actId)
                    span(UUID.randomUUID(), runId, cIter, "llm_call", "gpt-4o", actId,
                        status = if (failASpan && i == 0) "failed" else "ok",
                        attrs = """{"provider":"openai","model":"gpt-4o"}""")
                }

            c.prepareStatement(
                "INSERT INTO workspace_otel_exports (workspace_id, enabled, endpoint, service_name) " +
                "VALUES (?, true, 'http://localhost:4318', 'vectorbea-agents')"
            ).use { it.setObject(1, t.workspaceId); it.executeUpdate() }
        }
        return t
    }

    private fun cleanup(ds: DataSource, t: Team) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM run_spans WHERE workspace_id=?")
                    .use { it.setObject(1, t.workspaceId); it.executeUpdate() }
                c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                    .use { it.setObject(1, t.workspaceId); it.executeUpdate() }
            }
        }
    }

    private fun exporter(ds: DataSource, rec: Recording, rate: Double = 1.0) =
        RunTraceExporter(
            dataSource = ds,
            config = configWith(ds, rec),
            sampler = TraceSampler(rateFor = { rate }, graceWindow = Duration.ZERO),
            enabled = true,
        )

    // ── The acceptance criterion ──────────────────────────────────────────────

    @Test
    fun `a team run exports as one trace with parent-child intact across dispatched children`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val t = seed(ds)
        try {
            val rec = Recording()
            val result = exporter(ds, rec).exportRun(t.parentRun, t.workspaceId)

            assertEquals(3, result.runs, "the parent and both dispatched children")
            assertEquals(14, result.exported, "6 parent spans + 4 per child")
            assertEquals(14, rec.spans.size)

            // 1. ONE trace. Internally these are three trace ids; externally one.
            val traces = rec.spans.map { it.spanContext.traceId }.toSet()
            assertEquals(setOf(OtelIds.traceId(t.parentRun)), traces,
                "a team must arrive as one trace, not one per dispatched run")

            // 2. Exactly one root, and it is the parent run's `run` span.
            val roots = rec.spans.filter { !it.parentSpanContext.isValid }
            assertEquals(1, roots.size, "a trace with two roots renders as two traces")
            assertEquals(OtelIds.spanId(SpanWriter.runSpanId(t.parentRun)),
                roots.single().spanContext.spanId)

            // 3. No orphans: every parent link resolves inside the exported set.
            val ids = rec.spans.map { it.spanContext.spanId }.toSet()
            rec.spans.filter { it.parentSpanContext.isValid }.forEach {
                assertTrue(it.parentSpanContext.spanId in ids,
                    "${it.name} points at a parent that was not exported")
            }

            // 4. THE POINT: each child run's root hangs off the supervisor's
            //    activation span, so "the supervisor called the researcher, and
            //    here is what the researcher did" is one continuous path.
            val supervisorSpan = rec.spans.single { it.name == "invoke_agent supervisor" }
            listOf(t.researcherRun, t.writerRun).forEach { childRun ->
                val childRoot = rec.spans.single {
                    it.spanContext.spanId == OtelIds.spanId(SpanWriter.runSpanId(childRun))
                }
                assertEquals(supervisorSpan.spanContext.spanId, childRoot.parentSpanContext.spanId,
                    "a dispatched child's run span must hang off its delegator")
            }

            // 5. The GenAI attributes survived the round trip.
            val call = rec.spans.first { it.name == "chat claude-opus-5" }
            val a = call.attributes.asMap().mapKeys { it.key.key }
            assertEquals("anthropic", a["gen_ai.system"])
            assertEquals("chat", a["gen_ai.operation.name"])
            assertEquals(10L, a["gen_ai.usage.input_tokens"])
            assertEquals(t.workspaceId.toString(), a["vectorbea.workspace_id"])
        } finally {
            cleanup(ds, t)
        }
    }

    // ── Sampling ──────────────────────────────────────────────────────────────

    /**
     * A long, clean, successful run at rate 0 is not sent. Everything about this
     * run makes it the ideal sampling candidate — which is what makes it the
     * right control for the next test.
     */
    @Test
    fun `sampling is honoured`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val t = seed(ds)
        try {
            val rec = Recording()
            val r = exporter(ds, rec, rate = 0.0).exportRun(t.parentRun, t.workspaceId)
            assertEquals("sampled out", r.skipped)
            assertEquals(0, rec.spans.size)
        } finally {
            cleanup(ds, t)
        }
    }

    /**
     * The same run, at the same rate, with one failed span — sent in full.
     *
     * This is §12.1's rule reaching the export path: the runs somebody will ask
     * about are never the ones that get dropped, and the observability stack they
     * pay for is exactly where they will go looking.
     */
    @Test
    fun `a run with a failed span is never sampled out`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val t = seed(ds, failASpan = true)
        try {
            val rec = Recording()
            val r = exporter(ds, rec, rate = 0.0).exportRun(t.parentRun, t.workspaceId)
            assertEquals(14, r.exported, "a run with a failed step must be exported at any rate")
            assertTrue(rec.spans.any { it.status.statusCode == io.opentelemetry.api.trace.StatusCode.ERROR })
        } finally {
            cleanup(ds, t)
        }
    }

    // ── Cross-workspace containment ───────────────────────────────────────────

    /**
     * M1(a). A child run belonging to another workspace is DROPPED, and said so.
     *
     * `agent_runs.parent_run_id` has no foreign key — V045 says so and says why —
     * so nothing in the schema stops it pointing at another tenant's run.
     * Following it would put that tenant's agent names, step names and run ids
     * into THIS tenant's Grafana Tempo: outbound, to a third party, and not
     * recoverable once sent.
     *
     * The export must still succeed for the workspace that owns it. Failing the
     * whole export would turn one bad row into a total loss of observability for
     * a tenant who did nothing wrong.
     */
    @Test
    fun `a child in another workspace is excluded and announced`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val t = seed(ds)
        val intruder = UUID.randomUUID()
        val intruderRun = UUID.randomUUID()
        try {
            /* A whole second tenant, and one of its runs claiming to be a child of
               the first tenant's run. */
            ds.connection.use { c ->
                c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                    it.setObject(1, intruder); it.setString(2, "other")
                    it.setString(3, "other-$intruder"); it.executeUpdate()
                }
                c.prepareStatement(
                    "INSERT INTO environments (id,workspace_id,name,slug,type) " +
                    "VALUES (?,?,'t','t','development')"
                ).use { it.setObject(1, intruder); it.setObject(2, intruder); it.executeUpdate() }
                c.prepareStatement(
                    "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                    "VALUES (?,?,?,'t',?,'active')"
                ).use {
                    it.setObject(1, intruder); it.setObject(2, intruder); it.setObject(3, intruder)
                    it.setString(4, "wf-$intruder"); it.executeUpdate()
                }
                c.prepareStatement(
                    "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) " +
                    "VALUES (?,?,1,'{}')"
                ).use { it.setObject(1, intruder); it.setObject(2, intruder); it.executeUpdate() }
                c.prepareStatement(
                    "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id," +
                    " workflow_version_id,status,duration_ms,parent_run_id) " +
                    "VALUES (?,?,?,?,?,'succeeded',1000,?)"
                ).use {
                    it.setObject(1, intruderRun); it.setObject(2, intruder); it.setObject(3, intruder)
                    it.setObject(4, intruder); it.setObject(5, intruder)
                    it.setObject(6, t.parentRun)   // the cross-workspace link
                    it.executeUpdate()
                }
                c.prepareStatement(
                    "INSERT INTO run_spans (span_id,trace_id,run_id,parent_span_id,workspace_id," +
                    " kind,name,status,started_at,created_at) " +
                    "VALUES (?,?,?,NULL,?,'run','SECRET-TENANT-B-SPAN','ok', now(), now())"
                ).use {
                    it.setObject(1, SpanWriter.runSpanId(intruderRun))
                    it.setObject(2, intruderRun); it.setObject(3, intruderRun)
                    it.setObject(4, intruder); it.executeUpdate()
                }
            }

            val rec = Recording()
            val events = com.vectorbea.worker.testsupport.RecordingEventStore()
            val exporter = RunTraceExporter(
                dataSource = ds, config = configWith(ds, rec),
                sampler = TraceSampler(rateFor = { 1.0 }, graceWindow = Duration.ZERO),
                enabled = true, events = events)

            val r = exporter.exportRun(t.parentRun, t.workspaceId)

            // The owning workspace's trace is exported in full, unaffected.
            assertEquals(14, r.exported)
            assertEquals(3, r.runs, "the intruder must not be counted as part of the tree")

            // Not one span of the other tenant's went out.
            assertTrue(rec.spans.none { it.name.contains("SECRET-TENANT-B-SPAN") },
                "a span from another workspace reached the exporter")
            val exportedRunIds = rec.spans.mapNotNull {
                it.attributes.asMap().entries.firstOrNull { e -> e.key.key == "vectorbea.run_id" }
                    ?.value as String?
            }.toSet()
            assertFalse(intruderRun.toString() in exportedRunIds,
                "the intruder run's spans were exported")

            // And it was announced, naming both sides.
            val ev = events.events.single {
                it.type == com.vectorbea.worker.events.RunEventStore.EventType.TRACE_EXPORT_CROSS_WORKSPACE
            }
            assertEquals(t.parentRun, ev.runId, "filed on the run somebody is looking at")
            assertEquals(t.workspaceId, ev.workspaceId)
            assertTrue(ev.summary!!.contains(intruderRun.toString()),
                "the event must name the foreign run — it is the only handle on it")
        } finally {
            runCatching {
                ds.connection.use { c ->
                    c.prepareStatement("DELETE FROM run_spans WHERE workspace_id=?")
                        .use { it.setObject(1, intruder); it.executeUpdate() }
                    c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                        .use { it.setObject(1, intruder); it.executeUpdate() }
                }
            }
            cleanup(ds, t)
        }
    }

    // ── The guards ────────────────────────────────────────────────────────────

    /** A child run is shipped inside its parent's tree, never on its own. */
    @Test
    fun `a dispatched child does not export its own trace`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val t = seed(ds)
        try {
            val rec = Recording()
            val r = exporter(ds, rec).exportRun(t.researcherRun, t.workspaceId)
            assertEquals("child run", r.skipped)
            assertEquals(0, rec.spans.size)
        } finally {
            cleanup(ds, t)
        }
    }

    @Test
    fun `a workspace with no destination exports nothing`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val t = seed(ds)
        try {
            ds.connection.use { c ->
                c.prepareStatement("UPDATE workspace_otel_exports SET enabled = false WHERE workspace_id = ?")
                    .use { it.setObject(1, t.workspaceId); it.executeUpdate() }
            }
            val rec = Recording()
            assertEquals("no destination",
                exporter(ds, rec).exportRun(t.parentRun, t.workspaceId).skipped)
        } finally {
            cleanup(ds, t)
        }
    }

    @Test
    fun `the flag off means no work at all`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val t = seed(ds)
        try {
            val rec = Recording()
            val off = RunTraceExporter(ds, configWith(ds, rec),
                TraceSampler(rateFor = { 1.0 }, graceWindow = Duration.ZERO), enabled = false)
            assertEquals("disabled", off.exportRun(t.parentRun, t.workspaceId).skipped)
            assertEquals(0, rec.spans.size)
        } finally {
            cleanup(ds, t)
        }
    }

    /**
     * Invariant 7: observability never blocks execution.
     *
     * A customer's collector rejecting the batch must be recorded and swallowed.
     * If this ever propagated, a succeeded run would be reported as failed
     * because somebody else's Tempo was down.
     */
    @Test
    fun `a rejecting collector is recorded, not thrown`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val t = seed(ds)
        try {
            val rec = Recording().apply { failNext = true }
            val r = exporter(ds, rec).exportRun(t.parentRun, t.workspaceId)
            assertEquals("error", r.skipped)

            val lastError = ds.connection.use { c ->
                c.prepareStatement("SELECT last_error FROM workspace_otel_exports WHERE workspace_id=?")
                    .use { st ->
                        st.setObject(1, t.workspaceId)
                        st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
                    }
            }
            assertTrue(lastError != null && lastError.contains("rejected"),
                "the failure must be recorded where an operator can see it; was: $lastError")
        } finally {
            cleanup(ds, t)
        }
    }

    /**
     * Invariant 7's other half: observability never BLOCKS execution.
     *
     * The terminal transition calls `exportAsync`, and the queue behind it is
     * bounded. A collector that stops responding must cost dropped traces, not a
     * stalled worker — so this pins a slow destination against a full queue and
     * asserts that submissions keep returning and the drops are counted.
     *
     * Deterministic rather than timing-based: the exporter blocks on a latch, so
     * the two pool threads and the single queue slot are occupied for certain
     * before the submissions that must be dropped are made.
     */
    @Test
    fun `a stalled collector drops traces instead of blocking the caller`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val t = seed(ds)
        val release = java.util.concurrent.CountDownLatch(1)
        val entered = java.util.concurrent.CountDownLatch(2)
        try {
            val stalled = object : SpanExporter {
                override fun export(items: Collection<SpanData>): CompletableResultCode {
                    entered.countDown()
                    release.await(20, java.util.concurrent.TimeUnit.SECONDS)
                    return CompletableResultCode.ofSuccess()
                }
                override fun flush() = CompletableResultCode.ofSuccess()
                override fun shutdown() = CompletableResultCode.ofSuccess()
            }
            val config = object : TraceExportConfig(ds, null) {
                override fun destinationFor(row: Row) =
                    Destination(stalled, Resource.empty(), row.updatedAtMs)
            }
            val exporter = RunTraceExporter(
                dataSource = ds, config = config,
                sampler = TraceSampler(rateFor = { 1.0 }, graceWindow = Duration.ZERO),
                enabled = true, queueCapacity = 1)

            // Two threads occupied, one queue slot filled.
            repeat(3) { exporter.exportAsync(t.parentRun, t.workspaceId) }
            assertTrue(entered.await(20, java.util.concurrent.TimeUnit.SECONDS),
                "both pool threads should have picked up work")

            val started = System.currentTimeMillis()
            repeat(20) { exporter.exportAsync(t.parentRun, t.workspaceId) }
            val elapsed = System.currentTimeMillis() - started

            assertTrue(elapsed < 1_000,
                "submitting to a stalled exporter must return immediately; took ${elapsed}ms")
            assertTrue(exporter.droppedCount() >= 19,
                "a full queue must drop and count, not block; dropped ${exporter.droppedCount()}")

            release.countDown()
            exporter.stop(2_000)
        } finally {
            release.countDown()
            cleanup(ds, t)
        }
    }

    /** A successful export stamps `last_export_at` and clears any previous error. */
    @Test
    fun `a successful export clears the last error`() {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database"); ds!!
        val t = seed(ds)
        try {
            ds.connection.use { c ->
                c.prepareStatement(
                    "UPDATE workspace_otel_exports SET last_error='old', last_error_at=now() " +
                    "WHERE workspace_id=?"
                ).use { it.setObject(1, t.workspaceId); it.executeUpdate() }
            }
            exporter(ds, Recording()).exportRun(t.parentRun, t.workspaceId)
            ds.connection.use { c ->
                c.prepareStatement(
                    "SELECT last_export_at IS NOT NULL, last_error IS NULL " +
                    "FROM workspace_otel_exports WHERE workspace_id=?"
                ).use { st ->
                    st.setObject(1, t.workspaceId)
                    st.executeQuery().use { rs ->
                        rs.next()
                        assertTrue(rs.getBoolean(1), "last_export_at must be stamped")
                        assertTrue(rs.getBoolean(2), "a success must clear the stale error")
                    }
                }
            }
        } finally {
            cleanup(ds, t)
        }
    }
}
