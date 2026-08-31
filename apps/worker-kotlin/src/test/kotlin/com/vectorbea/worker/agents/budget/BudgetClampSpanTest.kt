package com.vectorbea.worker.agents.budget

import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner
import com.vectorbea.worker.agents.orchestration.ActivationStore
import com.vectorbea.worker.agents.orchestration.AgentHarness
import com.vectorbea.worker.events.RunTracer
import com.vectorbea.worker.events.SpanWriter
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowGraph
import com.vectorbea.worker.testsupport.RecordingEventStore
import com.vectorbea.worker.testsupport.ScriptedLlmProvider
import com.vectorbea.worker.testsupport.stubLlmResolver
import kotlinx.coroutines.runBlocking
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.postgresql.ds.PGSimpleDataSource
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import org.junit.jupiter.api.Tag

/**
 * A budget clamp, all the way to a row in `run_spans`.
 *
 * [BudgetLedgerTest] proves the ledger computes the clamp. This proves the clamp
 * SURVIVES the journey to the trace, which is a different claim and the one that
 * matters operationally: a clamp the ledger knows about and the debugger does not
 * is worth nothing, because the whole point is that an agent handed a fraction of
 * what it asked for looks — in its output, its events and its stop reason —
 * exactly like an agent that is bad at its job.
 *
 * Skips when no database is reachable.
 */
@Tag("integration")
class BudgetClampSpanTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    private val stepId = "n-agent-1"

    /**
     * The database, or a thrown exception naming what is missing.
     *
     * This used to probe a hard-coded localhost port and return null, which
     * turned every test in this class into a silent pass on any machine
     * without it. See [Infra].
     */
    private fun dataSourceOrNull(): DataSource? = com.vectorbea.worker.testsupport.Infra.postgres

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        val runId: UUID = UUID.randomUUID(),
        val agentId: UUID = UUID.randomUUID(),
        val connectionId: UUID = UUID.randomUUID(),
    )

    private fun seed(ds: DataSource): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "clamp-test")
                it.setString(3, "clamp-test-" + w.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.environmentId); it.setObject(2, w.workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.workflowId); it.setObject(2, w.workspaceId)
                it.setObject(3, w.environmentId); it.setString(4, "wf-" + w.workflowId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.versionId); it.setObject(2, w.workflowId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id,status) " +
                "VALUES (?,?,?,?,?,'running')"
            ).use {
                it.setObject(1, w.runId); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId); it.executeUpdate()
            }
        }
        return w
    }

    private fun cleanup(ds: DataSource, w: World) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM run_spans WHERE run_id=?")
                    .use { it.setObject(1, w.runId); it.executeUpdate() }
                c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                    .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
            }
        }
    }

    @Test
    fun `a leaf clamped by the root carries the clamp on its activation span`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val writer = SpanWriter(ds, pubSub = null, enabled = true)
        try {
            /*
             * ── A THREE-LEVEL TREE, WITH THE LEAF ASKING FOR TOO MUCH ────────
             *
             * The leaf asks for more than the WHOLE ROOT has, let alone what its
             * parent has left. It is clamped rather than refused — a worker told
             * it has less usually adapts; one refused outright fails the run.
             */
            val ledger = BudgetLedger(null, completionMarginFraction = 0.0)
            val rootActivation = UUID.randomUUID()
            val midActivation = UUID.randomUUID()
            val leafActivation = UUID.randomUUID()

            ledger.allocate(rootActivation, null,
                BudgetVector(iterations = 12, tokens = 900, costMicroCents = BudgetVector.ofCents(30.0)))
            ledger.allocate(midActivation, rootActivation,
                BudgetVector(iterations = 6, tokens = 400, costMicroCents = BudgetVector.ofCents(10.0)))
            val leaf = ledger.allocate(leafActivation, midActivation,
                BudgetVector(iterations = 100, tokens = 100_000, costMicroCents = BudgetVector.ofCents(999.0)))

            assertTrue(leaf.clamped, "the fixture must actually clamp, or this proves nothing")

            /* The harness reads the clamp for whichever activation it is running.
               Here that is the leaf, so the ledger is asked about the leaf's id —
               which is the id the store will hand back for this (run, step, agent). */
            val store = ClampingActivationStore(ds, leafActivation)

            val tracer = RunTracer(writer, traceId = w.runId, runId = w.runId, workspaceId = w.workspaceId)
            tracer.openTick("tick 1")
            val stepSpan = tracer.open("step", "agent", tracer.tickSpanId, nodeId = stepId)

            val llm = ScriptedLlmProvider()
                .thenAction("{\"type\":\"FINAL\",\"finalOutput\":{\"answer\":\"ok\"}}")
            val brain = AgentBrainRunner(
                dataSource = ds,
                eventStore = RecordingEventStore(),
                connectionResolver = stubLlmResolver(w.workspaceId, w.environmentId),
                llmHttpClient = llm,
            )

            val harness = AgentHarness(store, brain, ledger)
            val config = AgentBrainConfig(
                agentId = w.agentId, workspaceId = w.workspaceId, environmentId = w.environmentId,
                runId = w.runId, stepId = stepId, agentName = "clamped-agent", role = null,
                instructions = "Do the thing.", llmConnectionId = w.connectionId,
                modelName = "gpt-4o-mini", taskInstruction = "Do the thing.",
            )

            val result = harness.activate(
                AgentHarness.ActivationRequest(
                    runId = w.runId, workspaceId = w.workspaceId, environmentId = w.environmentId,
                    stepId = stepId, agentId = w.agentId, agentName = "clamped-agent",
                    resolvedTaskInstruction = "Do the thing.",
                    agentSnapshot = mapOf("modelName" to "gpt-4o-mini"),
                    agentVersion = null,
                    budgetAllocated = leaf.granted.toMap(),
                    buildConfig = { config },
                ),
                RuntimeContext(
                    runId = w.runId, workspaceId = w.workspaceId, environmentId = w.environmentId,
                    workflowVersionId = w.versionId, workflowId = w.workflowId,
                    workflowInput = emptyMap(), graph = WorkflowGraph(), tracer = tracer,
                ),
            )

            assertTrue(result is AgentHarness.ActivationResult.Completed, result.toString())

            tracer.close(stepSpan, "step", "agent", "ok", stepId = stepId, nodeId = stepId)
            tracer.closeTick("ok")
            writer.flush()

            val attrs = ds.connection.use { c ->
                c.prepareStatement(
                    "SELECT attributes_json::text FROM run_spans WHERE run_id=? AND kind='activation'"
                ).use { st ->
                    st.setObject(1, w.runId)
                    st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
                }
            }

            /*
             * THE ASSERTION. The clamp is in the trace, on the activation it
             * happened to, where somebody debugging a thin answer will find it.
             */
            assertNotNull(attrs, "no activation span was written")
            /* Parsed, not substring-matched: jsonb round-trips with its own
               whitespace and key order, so a literal match asserts Postgres's
               formatting rather than the attribute. */
            val parsed = parse(attrs)
            assertEquals(true, parsed["budget_clamped"])
            @Suppress("UNCHECKED_CAST")
            val dims = parsed["budget_clamped_dimensions"] as List<String>
            assertTrue(dims.containsAll(listOf("iterations", "tokens", "costCents")), dims.toString())
        } finally {
            writer.stop()
            cleanup(ds!!, w)
        }
    }

    @Test
    fun `an unclamped activation says so rather than saying nothing`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val writer = SpanWriter(ds, pubSub = null, enabled = true)
        try {
            val ledger = BudgetLedger(null, completionMarginFraction = 0.0)
            val rootActivation = UUID.randomUUID()
            ledger.allocate(rootActivation, null, BudgetVector(iterations = 12, tokens = 900))

            val store = ClampingActivationStore(ds, rootActivation)
            val tracer = RunTracer(writer, traceId = w.runId, runId = w.runId, workspaceId = w.workspaceId)
            tracer.openTick("tick 1")

            val brain = AgentBrainRunner(
                dataSource = ds,
                eventStore = RecordingEventStore(),
                connectionResolver = stubLlmResolver(w.workspaceId, w.environmentId),
                llmHttpClient = ScriptedLlmProvider()
                    .thenAction("{\"type\":\"FINAL\",\"finalOutput\":{\"answer\":\"ok\"}}"),
            )
            val config = AgentBrainConfig(
                agentId = w.agentId, workspaceId = w.workspaceId, environmentId = w.environmentId,
                runId = w.runId, stepId = stepId, agentName = "a", role = null,
                instructions = "Do it.", llmConnectionId = w.connectionId, modelName = "gpt-4o-mini",
            )

            AgentHarness(store, brain, ledger).activate(
                AgentHarness.ActivationRequest(
                    runId = w.runId, workspaceId = w.workspaceId, environmentId = w.environmentId,
                    stepId = stepId, agentId = w.agentId, agentName = "a",
                    resolvedTaskInstruction = "Do it.", agentSnapshot = emptyMap(),
                    agentVersion = null, budgetAllocated = emptyMap(), buildConfig = { config },
                ),
                RuntimeContext(
                    runId = w.runId, workspaceId = w.workspaceId, environmentId = w.environmentId,
                    workflowVersionId = w.versionId, workflowId = w.workflowId,
                    workflowInput = emptyMap(), graph = WorkflowGraph(), tracer = tracer,
                ),
            )
            tracer.closeTick("ok")
            writer.flush()

            val attrs = ds.connection.use { c ->
                c.prepareStatement(
                    "SELECT attributes_json::text FROM run_spans WHERE run_id=? AND kind='activation'"
                ).use { st ->
                    st.setObject(1, w.runId)
                    st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
                }
            }

            /* `false` rather than absent: "this span predates clamp recording" and
               "this activation got what it asked for" are different facts, and a
               missing key cannot tell them apart. */
            assertNotNull(attrs)
            assertEquals(false, parse(attrs)["budget_clamped"])
        } finally {
            writer.stop()
            cleanup(ds!!, w)
        }
    }

    @Suppress("UNCHECKED_CAST")
    private fun parse(json: String): Map<String, Any?> =
        com.fasterxml.jackson.module.kotlin.jacksonObjectMapper()
            .readValue(json, Map::class.java) as Map<String, Any?>

    /**
     * An [ActivationStore] that hands back a chosen activation id.
     *
     * The ledger is keyed by activation id, and this phase has no delegation, so
     * there is no code path that creates a leaf activation three levels down. The
     * override pins the id the harness will look the clamp up under, leaving the
     * REST of the store — the insert, the status write, the reattach — untouched
     * and real.
     */
    private class ClampingActivationStore(
        ds: DataSource,
        private val forcedId: UUID,
    ) : ActivationStore(ds) {
        override fun createOrReattach(
            runId: UUID, workspaceId: UUID, environmentId: UUID, stepId: String, agentId: UUID,
            resolvedTaskInstruction: String?, agentSnapshot: Map<String, Any?>,
            agentVersion: String?, budgetAllocated: Map<String, Any?>,
        ): Activation? = super.createOrReattach(
            runId, workspaceId, environmentId, stepId, agentId,
            resolvedTaskInstruction, agentSnapshot, agentVersion, budgetAllocated,
        )?.copy(id = forcedId)
    }
}
