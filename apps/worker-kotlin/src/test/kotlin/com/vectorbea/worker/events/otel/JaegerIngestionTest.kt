package com.vectorbea.worker.events.otel

import com.fasterxml.jackson.databind.ObjectMapper
import com.vectorbea.worker.durable.archive.TraceSampler
import com.vectorbea.worker.events.SpanWriter
import com.vectorbea.worker.testsupport.Infra
import org.junit.jupiter.api.Tag
import java.net.HttpURLConnection
import java.net.URI
import java.time.Duration
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * §9's acceptance criterion, against a real collector.
 *
 * "A team run appears as a correct trace tree in a local Jaeger or Tempo, with
 * parent/child intact across a dispatched child run."
 *
 * ── WHY THIS EXISTS WHEN TWO OTHER TESTS ALREADY COVER THE EXPORT ───────────
 * `RunTraceExportTest` asserts the `SpanData` handed to the exporter, and
 * `OtlpWireTest` asserts the bytes reaching an HTTP receiver. Between them the
 * only untested link was a collector's own INGESTION of that payload — which is
 * exactly where a well-formed-looking export can still be rejected: an invalid
 * span id, a parent in a different trace, a timestamp a backend refuses, a
 * duplicate span id silently collapsing two spans into one.
 *
 * None of those are visible from our side of the socket. All of them are visible
 * from Jaeger's query API, which is why the container is `all-in-one` rather
 * than a bare collector.
 *
 * This test was written to `assumeTrue(dockerAvailable)` in an earlier pass and
 * therefore never ran. It now fails if the collector is missing.
 */
@Tag("integration")
class JaegerIngestionTest {

    private val mapper = ObjectMapper()

    private class Team(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        val parentRun: UUID = UUID.randomUUID(),
        val supervisor: UUID = UUID.randomUUID(),
        val researcher: UUID = UUID.randomUUID(),
        val researcherRun: UUID = UUID.randomUUID(),
    )

    private fun seed(ds: DataSource): Team {
        val t = Team()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, t.workspaceId); it.setString(2, "jaeger")
                it.setString(3, "jaeger-" + t.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, t.environmentId); it.setObject(2, t.workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, t.workflowId); it.setObject(2, t.workspaceId)
                it.setObject(3, t.environmentId); it.setString(4, "wf-" + t.workflowId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, t.versionId); it.setObject(2, t.workflowId); it.executeUpdate() }

            fun run(id: UUID, parent: UUID?, activation: UUID?) =
                c.prepareStatement(
                    "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id," +
                    " status,duration_ms,parent_run_id,parent_activation_id) " +
                    "VALUES (?,?,?,?,?,'succeeded',600000,?,?)"
                ).use {
                    it.setObject(1, id); it.setObject(2, t.workspaceId); it.setObject(3, t.environmentId)
                    it.setObject(4, t.workflowId); it.setObject(5, t.versionId)
                    it.setObject(6, parent); it.setObject(7, activation); it.executeUpdate()
                }
            run(t.parentRun, null, null)
            run(t.researcherRun, t.parentRun, t.researcher)

            fun activation(id: UUID, parent: UUID?, depth: Int, seq: Int) =
                c.prepareStatement(
                    "INSERT INTO agent_activations (id,run_id,workspace_id,environment_id,step_id," +
                    " parent_activation_id,root_activation_id,depth,sequence,agent_id,status,idempotency_key) " +
                    "VALUES (?,?,?,?,'n-team-1',?,?,?,?,?,'succeeded',?)"
                ).use {
                    it.setObject(1, id); it.setObject(2, t.parentRun); it.setObject(3, t.workspaceId)
                    it.setObject(4, t.environmentId); it.setObject(5, parent)
                    it.setObject(6, t.supervisor); it.setInt(7, depth); it.setInt(8, seq)
                    it.setObject(9, UUID.randomUUID()); it.setString(10, "idem-$id"); it.executeUpdate()
                }
            activation(t.supervisor, null, 0, 0)
            activation(t.researcher, t.supervisor, 1, 1)

            fun span(
                spanId: UUID, runId: UUID, parentSpan: UUID?, kind: String, name: String,
                activationId: UUID? = null, attrs: String = "{}",
            ) = c.prepareStatement(
                "INSERT INTO run_spans (span_id,trace_id,run_id,parent_span_id,workspace_id,kind,name," +
                " status,step_id,activation_id,started_at,ended_at,duration_ms,self_ms,attributes_json," +
                " tokens_in,tokens_out,created_at) " +
                "VALUES (?,?,?,?,?,?,?, 'ok','n-team-1',?, now() - interval '5 seconds', now(), 100, 80, " +
                " ?::jsonb, 10, 5, now())"
            ).use {
                it.setObject(1, spanId); it.setObject(2, runId); it.setObject(3, runId)
                it.setObject(4, parentSpan); it.setObject(5, t.workspaceId)
                it.setString(6, kind); it.setString(7, name); it.setObject(8, activationId)
                it.setString(9, attrs); it.executeUpdate()
            }

            val pRun = SpanWriter.runSpanId(t.parentRun)
            val pStep = UUID.randomUUID(); val pAct = UUID.randomUUID()
            span(pRun, t.parentRun, null, "run", "run")
            span(pStep, t.parentRun, pRun, "step", "team")
            span(pAct, t.parentRun, pStep, "activation", "supervisor", t.supervisor,
                /* One allowlisted, one not. The unlisted key is what M1(b) is for:
                   before the allowlist, ANY key on a span was forwarded verbatim to
                   a customer's observability vendor. */
                """{"budget_clamped":true,"super_secret_payload":"leaked-value"}""")
            span(UUID.randomUUID(), t.parentRun, pAct, "llm_call", "claude-opus-5", t.supervisor,
                """{"provider":"anthropic","model":"claude-opus-5"}""")

            // The dispatched child: its own run, its own trace id in Postgres.
            val cRun = SpanWriter.runSpanId(t.researcherRun)
            val cAct = UUID.randomUUID()
            span(cRun, t.researcherRun, null, "run", "run")
            span(cAct, t.researcherRun, cRun, "activation", "researcher", t.researcher)
            span(UUID.randomUUID(), t.researcherRun, cAct, "llm_call", "gpt-4o", t.researcher,
                """{"provider":"openai","model":"gpt-4o"}""")

            c.prepareStatement(
                "INSERT INTO workspace_otel_exports (workspace_id, enabled, endpoint, service_name) " +
                "VALUES (?, true, ?, 'vectorbea-agents')"
            ).use {
                it.setObject(1, t.workspaceId); it.setString(2, Infra.otlpEndpoint); it.executeUpdate()
            }
        }
        return t
    }

    private fun cleanup(ds: DataSource, t: Team) = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM run_spans WHERE workspace_id=?")
                .use { it.setObject(1, t.workspaceId); it.executeUpdate() }
            c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                .use { it.setObject(1, t.workspaceId); it.executeUpdate() }
        }
    }

    /** Jaeger's query API. Returns null until the trace has been indexed. */
    private fun fetchTrace(traceId: String): com.fasterxml.jackson.databind.JsonNode? {
        val conn = URI("${Infra.jaegerQueryUrl}/api/traces/$traceId").toURL()
            .openConnection() as HttpURLConnection
        conn.connectTimeout = 5_000; conn.readTimeout = 5_000
        return try {
            if (conn.responseCode != 200) return null
            val body = mapper.readTree(conn.inputStream)
            body.path("data").takeIf { it.isArray && it.size() > 0 }?.get(0)
        } catch (_: Exception) { null } finally { conn.disconnect() }
    }

    /**
     * Ingestion is asynchronous: the collector answers 200 the moment it has the
     * bytes, and the query service can serve the trace a beat later. Polling to a
     * deadline rather than sleeping a fixed amount keeps the test fast when it is
     * fast and honest when it is slow.
     */
    private fun awaitTrace(traceId: String, expectedSpans: Int): com.fasterxml.jackson.databind.JsonNode {
        val deadline = System.currentTimeMillis() + 30_000
        var last: com.fasterxml.jackson.databind.JsonNode? = null
        while (System.currentTimeMillis() < deadline) {
            last = fetchTrace(traceId)
            if (last != null && last.path("spans").size() >= expectedSpans) return last
            Thread.sleep(250)
        }
        error(
            "Jaeger never ingested trace $traceId with $expectedSpans spans " +
            "(got ${last?.path("spans")?.size() ?: 0}). " +
            "The export reported success, so the payload was rejected or dropped downstream."
        )
    }

    @Test
    fun `a team run arrives in Jaeger as one trace with the child nested under its delegator`() {
        val ds = Infra.postgres
        val t = seed(ds)
        try {
            val exporter = RunTraceExporter(
                dataSource = ds,
                /* The REAL config: a real OtlpHttpSpanExporter, built from the row
                   seeded above, pointed at a real collector. No recording double. */
                config = TraceExportConfig(ds, null),
                sampler = TraceSampler(rateFor = { 1.0 }, graceWindow = Duration.ZERO),
                enabled = true,
            )

            val result = exporter.exportRun(t.parentRun, t.workspaceId)
            assertEquals(null, result.skipped, "the export itself must succeed")
            assertEquals(2, result.runs, "the parent and its dispatched child")
            assertEquals(7, result.exported)

            val traceId = OtelIds.traceId(t.parentRun)
            val trace = awaitTrace(traceId, expectedSpans = 7)

            // 1. ONE trace. In Postgres these are two trace ids; Jaeger sees one.
            assertEquals(traceId, trace.path("traceID").asText())
            val spans = trace.path("spans")
            assertEquals(7, spans.size(), "every span must have been accepted, not just the root")

            // 2. Jaeger resolved the tree: exactly one span with no CHILD_OF parent.
            val roots = spans.filter { it.path("references").none { r ->
                r.path("refType").asText() == "CHILD_OF" } }
            assertEquals(1, roots.size, "a trace with two roots renders as two traces")

            // 3. No orphans — every parent reference resolves inside the trace.
            val ids = spans.map { it.path("spanID").asText() }.toSet()
            spans.forEach { s ->
                s.path("references").forEach { r ->
                    if (r.path("refType").asText() == "CHILD_OF") {
                        assertTrue(r.path("spanID").asText() in ids,
                            "${s.path("operationName").asText()} points outside the trace")
                    }
                }
            }

            // 4. THE CRITERION: the dispatched child's run span nests under the
            //    supervisor's activation, so the delegation is one continuous path.
            val supervisor = spans.single { it.path("operationName").asText() == "invoke_agent supervisor" }
            val childRoot = spans.single {
                it.path("spanID").asText() == OtelIds.spanId(SpanWriter.runSpanId(t.researcherRun))
            }
            assertEquals(
                supervisor.path("spanID").asText(),
                childRoot.path("references").first { it.path("refType").asText() == "CHILD_OF" }
                    .path("spanID").asText(),
                "the dispatched child must hang off its delegator in the ingested trace",
            )

            // 5. The GenAI attributes survived ingestion, not just serialisation.
            val call = spans.single { it.path("operationName").asText() == "chat claude-opus-5" }
            val tags = call.path("tags").associate { it.path("key").asText() to it.path("value").asText() }
            assertEquals("anthropic", tags["gen_ai.system"])
            assertEquals("chat", tags["gen_ai.operation.name"])
            assertTrue(tags.containsKey("vectorbea.activation_id"))

            /*
             * 6. M1(b): AN UNLISTED ATTRIBUTE NEVER REACHES THE COLLECTOR.
             *
             * The span seeded below carries `super_secret_payload` alongside the
             * allowlisted `budget_clamped`. Asserted HERE, against what Jaeger
             * actually stored, rather than against the SpanData we built —
             * because the claim being made is about what a third party ends up
             * holding, and only the third party can answer that.
             */
            val clamped = spans.single { it.path("operationName").asText() == "invoke_agent supervisor" }
            val supTags = clamped.path("tags").associate {
                it.path("key").asText() to it.path("value").asText()
            }
            assertEquals("true", supTags["vectorbea.budget_clamped"],
                "an allowlisted attribute must still get through")
            assertTrue(supTags.keys.none { it.contains("super_secret_payload") },
                "an attribute absent from EXPORTABLE_ATTRIBUTES reached the collector: ${supTags.keys}")
            assertTrue(spans.none { sp ->
                sp.path("tags").any { it.path("value").asText().contains("leaked-value") }
            }, "the VALUE of an unlisted attribute reached the collector")

            // 7. And the service is named as the workspace asked.
            val process = trace.path("processes").fields().asSequence().first().value
            assertEquals("vectorbea-agents", process.path("serviceName").asText())
        } finally {
            cleanup(ds, t)
        }
    }
}
