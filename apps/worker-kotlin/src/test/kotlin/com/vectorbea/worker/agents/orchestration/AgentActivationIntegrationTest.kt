package com.vectorbea.worker.agents.orchestration

import com.vectorbea.worker.events.RunTracer
import com.vectorbea.worker.events.SpanWriter
import com.vectorbea.worker.runtime.executor.AgentNodeExecutor
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.worker.runtime.graph.WorkflowGraph
import com.vectorbea.worker.runtime.graph.WorkflowNode
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

/**
 * P6's one promise, tested: routing a single-agent step through an activation
 * changes nothing about how that step behaves.
 *
 * ── WHY THIS RUNS THE EXECUTOR AND NOT THE HARNESS ──────────────────────────
 * [AgentHarness] could be tested on its own in memory, and the test would pass
 * while proving nothing: the thing that can break is the SUBSTITUTION — the
 * mapping from an [AgentHarness.ActivationResult] back onto the [NodeResult]
 * vocabulary the runtime already speaks. Asserting on the harness's own return
 * type tests the half that was written second. So both paths are driven through
 * the real [AgentNodeExecutor], the same node, the same agent row, the same
 * script, and the two results are compared.
 *
 * `activationsEnabled` and `llmHttpClient` are constructor parameters for that
 * reason and no other: the differential has to run BOTH paths in one JVM, and
 * process environment cannot be flipped between them portably. Both default to
 * the production value, so nothing in production sees a difference.
 *
 * Skips when no database is reachable — a run through the executor needs a real
 * `agents` row, and stubbing that would be testing the stub.
 */
class AgentActivationIntegrationTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    private val stepId = "n-agent-1"

    private fun dataSourceOrNull(): DataSource? = try {
        val ds = PGSimpleDataSource().apply {
            setURL(jdbcUrl); connectTimeout = 2; socketTimeout = 10
        }
        ds.connection.use { c ->
            /* V042 and V041. An older schema is "not applicable", not "failing". */
            c.prepareStatement("SELECT 1 FROM agent_activations LIMIT 1").use { it.executeQuery() }
            c.prepareStatement("SELECT 1 FROM run_spans LIMIT 1").use { it.executeQuery() }
        }
        ds
    } catch (_: Exception) {
        null
    }

    // ── One workspace, one agent, and a run per case ─────────────────────────

    /**
     * The FK chain plus an `agents` row.
     *
     * Fresh ids per instance: several cases below execute the step twice, and a
     * shared workspace would let one case's activation rows be counted by another.
     */
    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        val agentId: UUID = UUID.randomUUID(),
        val connectionId: UUID = UUID.randomUUID(),
    ) {
        val runIds = mutableListOf<UUID>()
    }

    private fun seed(ds: DataSource, w: World): World {
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "activation-test")
                it.setString(3, "activation-test-" + w.workspaceId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.environmentId); it.setObject(2, w.workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) " +
                "VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.workflowId); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setString(4, "wf-" + w.workflowId); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.versionId); it.setObject(2, w.workflowId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO agents " +
                "(id,workspace_id,environment_id,name,slug,type,instructions," +
                " llm_connection_id,model_name,temperature,max_tokens,max_iterations," +
                " max_tool_calls,max_cost_cents,status) " +
                "VALUES (?,?,?,'activation-agent',?,'iterative_agent','You are a test agent.'," +
                " ?,'gpt-4o-mini',0.2,2048,5,5,50,'active')"
            ).use {
                it.setObject(1, w.agentId); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setString(4, "agent-" + w.agentId); it.setObject(5, w.connectionId); it.executeUpdate()
            }
        }
        return w
    }

    private fun newRun(ds: DataSource, w: World): UUID {
        val runId = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agent_runs " +
                "(id,workspace_id,environment_id,workflow_id,workflow_version_id,status) " +
                "VALUES (?,?,?,?,?,'running')"
            ).use {
                it.setObject(1, runId); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setObject(4, w.workflowId); it.setObject(5, w.versionId); it.executeUpdate()
            }
        }
        w.runIds.add(runId)
        return runId
    }

    private fun cleanup(ds: DataSource, w: World) {
        runCatching {
            ds.connection.use { c ->
                /* run_spans has no FK to the run, deliberately — delete it explicitly. */
                w.runIds.forEach { r ->
                    c.prepareStatement("DELETE FROM run_spans WHERE run_id=?")
                        .use { it.setObject(1, r); it.executeUpdate() }
                }
                c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                    .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
            }
        }
    }

    // ── The pieces under test ────────────────────────────────────────────────

    private fun executor(
        ds: DataSource,
        w: World,
        llm: ScriptedLlmProvider,
        events: RecordingEventStore,
        activations: Boolean,
    ) = AgentNodeExecutor(
        dataSource = ds,
        connectionResolver = stubLlmResolver(w.workspaceId, w.environmentId),
        eventStore = events,
        dbPoolManager = null,
        activationsEnabled = activations,
        llmHttpClient = llm,
    )

    private fun node(w: World) = WorkflowNode(
        id = stepId,
        type = "agent",
        config = mapOf(
            "agentId" to w.agentId.toString(),
            "taskInstruction" to "Summarise the ticket.",
        ),
    )

    private fun ctx(w: World, runId: UUID, tracer: RunTracer? = null) = RuntimeContext(
        runId = runId,
        workspaceId = w.workspaceId,
        environmentId = w.environmentId,
        workflowVersionId = w.versionId,
        workflowId = w.workflowId,
        workflowInput = emptyMap(),
        graph = WorkflowGraph(),
        tracer = tracer,
    )

    private fun activationRows(ds: DataSource, runId: UUID): List<Map<String, Any?>> =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT id, status, step_id, agent_id, sequence, depth, role, " +
                "       contract_json::text AS contract, output_json::text AS output, " +
                "       stop_reason, idempotency_key, agent_snapshot_json::text AS snapshot, " +
                "       parent_activation_id, root_activation_id " +
                "  FROM agent_activations WHERE run_id=? ORDER BY sequence"
            ).use { st ->
                st.setObject(1, runId)
                st.executeQuery().use { rs ->
                    val out = mutableListOf<Map<String, Any?>>()
                    val meta = rs.metaData
                    while (rs.next()) {
                        out += (1..meta.columnCount).associate {
                            meta.getColumnLabel(it).lowercase() to rs.getObject(it)
                        }
                    }
                    out
                }
            }
        }

    /** Approve the gate the way the API's decideApproval does. */
    private fun approve(ds: DataSource, runId: UUID): Int = ds.connection.use { c ->
        c.prepareStatement(
            "UPDATE run_approvals SET status='APPROVED', resolved_by='alice', resolved_at=now() " +
            "WHERE run_id=? AND node_id=?"
        ).use { it.setObject(1, runId); it.setString(2, stepId); it.executeUpdate() }
    }

    /** One scripted two-iteration run: a THINK, then a FINAL. */
    private fun script(llm: ScriptedLlmProvider) = llm
        .thenAction("{\"type\":\"THINK\",\"reasoningSummary\":\"reading the ticket\"}")
        .thenAction("{\"type\":\"FINAL\",\"reasoningSummary\":\"done\"," +
            "\"finalOutput\":{\"answer\":\"42\",\"tone\":\"neutral\"}}")

    private val askApproval = "{\"type\":\"ASK_APPROVAL\",\"reasoningSummary\":\"need a human\"}"
    private val finalAfterApproval = "{\"type\":\"FINAL\",\"finalOutput\":{\"answer\":\"proceeded\"}}"

    // ═════════════════════════════════════════════════════════════════════════
    // 1. The differential
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `the flag changes nothing a single-agent step can observe`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!, World())
        try {
            val offLlm = ScriptedLlmProvider(); val offEvents = RecordingEventStore()
            val onLlm = ScriptedLlmProvider(); val onEvents = RecordingEventStore()
            script(offLlm); script(onLlm)

            val off = executor(ds, w, offLlm, offEvents, activations = false)
                .execute(node(w), emptyMap(), ctx(w, newRun(ds, w)))
            val on = executor(ds, w, onLlm, onEvents, activations = true)
                .execute(node(w), emptyMap(), ctx(w, newRun(ds, w)))

            /*
             * THE FOUR THINGS A CALLER CAN SEE. The output is what downstream nodes
             * read and what the run detail renders; the event stream is what the
             * timeline draws; the stop reason decides whether the run failed; the
             * provider call count is what it cost. If all four match, the flag is
             * invisible — which is the whole claim of this phase.
             */
            assertTrue(off is NodeResult.Completed, "baseline did not complete: " + off)
            assertTrue(on is NodeResult.Completed, "activation path did not complete: " + on)
            assertEquals(
                (off as NodeResult.Completed).output,
                (on as NodeResult.Completed).output,
                "the activation path produced a different output",
            )
            assertEquals(offEvents.typesEmitted(), onEvents.typesEmitted(),
                "the activation path emitted a different event stream")
            assertEquals("FINAL_OUTPUT", off.output["_brainStopReason"])
            assertEquals(off.output["_brainStopReason"], on.output["_brainStopReason"])
            assertEquals(offLlm.callCount(), onLlm.callCount(),
                "the activation path called the provider a different number of times")
            assertEquals(0, onLlm.remaining(), "the loop stopped earlier or later than scripted")
        } finally {
            cleanup(ds!!, w)
        }
    }

    @Test
    fun `a failing agent fails identically on both paths`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!, World())
        try {
            val fail = "{\"type\":\"FAIL\",\"failReason\":\"the ticket has no customer attached\"}"
            val offLlm = ScriptedLlmProvider().thenAction(fail)
            val onLlm = ScriptedLlmProvider().thenAction(fail)

            val off = executor(ds, w, offLlm, RecordingEventStore(), false)
                .execute(node(w), emptyMap(), ctx(w, newRun(ds, w)))
            val on = executor(ds, w, onLlm, RecordingEventStore(), true)
                .execute(node(w), emptyMap(), ctx(w, newRun(ds, w)))

            assertTrue(off is NodeResult.Failed, "baseline: " + off)
            assertTrue(on is NodeResult.Failed, "activation path: " + on)
            /*
             * BYTE-IDENTICAL, not merely "both failed". This string becomes the run's
             * error_json and is what the run detail screen shows; the failure message
             * was MOVED into the harness rather than rewritten precisely so this
             * assertion can be an equality.
             */
            assertEquals((off as NodeResult.Failed).reason, (on as NodeResult.Failed).reason)
            assertEquals(off.retryable, on.retryable)
        } finally {
            cleanup(ds!!, w)
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 2. The row
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a single-agent run with the flag on writes exactly one activation`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!, World())
        try {
            val runId = newRun(ds, w)
            val result = executor(ds, w, ScriptedLlmProvider().also { script(it) },
                RecordingEventStore(), true)
                .execute(node(w), emptyMap(), ctx(w, runId))

            assertTrue(result is NodeResult.Completed, result.toString())

            val rows = activationRows(ds, runId)
            assertEquals(1, rows.size, "a single-agent run is exactly one activation")
            val row = rows.single()
            assertEquals("succeeded", row["status"])
            assertEquals(stepId, row["step_id"])
            assertEquals(w.agentId, row["agent_id"])
            assertEquals(0, row["depth"])
            /* Defaulted by the column, not written at the call site — so an older
               worker inserting without it during a rolling deploy still produces a
               valid row. */
            assertEquals("specialist", row["role"])
            assertEquals(row["id"], row["root_activation_id"],
                "a root activation is its own subtree root")
            assertEquals(null, row["parent_activation_id"])
            assertNotNull(row["idempotency_key"])

            /* The instruction is ON the row, and it is the RESOLVED one — that row is
               what every later reattach reads, not the fallback chain that produced it. */
            assertTrue((row["contract"] as String).contains("Summarise the ticket."))

            /* The pin covers the definition. It must NOT cover the grant. */
            val snapshot = row["snapshot"] as String
            assertTrue(snapshot.contains("gpt-4o-mini"), "the model belongs in the pin")
            assertTrue(!snapshot.contains("oolIds"),
                "a granted tool is policy: it is re-read live so a revocation takes " +
                "effect on a paused run, and pinning it would defeat that")
        } finally {
            cleanup(ds!!, w)
        }
    }

    @Test
    fun `the flag off writes no activation at all`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!, World())
        try {
            val runId = newRun(ds, w)
            executor(ds, w, ScriptedLlmProvider().also { script(it) }, RecordingEventStore(), false)
                .execute(node(w), emptyMap(), ctx(w, runId))
            assertEquals(0, activationRows(ds, runId).size,
                "flag off must be the code that shipped, down to writing no new rows")
        } finally {
            cleanup(ds!!, w)
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 3. Reattach
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `resuming after an approval reattaches instead of creating a second activation`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!, World())
        try {
            val runId = newRun(ds, w)

            // ── First execution: the agent asks for a human, and the step parks.
            val first = executor(ds, w, ScriptedLlmProvider().thenAction(askApproval),
                RecordingEventStore(), true)
                .execute(node(w), emptyMap(), ctx(w, runId))

            assertTrue(first is NodeResult.ApprovalPaused, first.toString())
            val parked = activationRows(ds, runId)
            assertEquals(1, parked.size)
            /* Parked, not ended. A resume must find it in a NON-terminal state, or
               there is nothing to reattach to and a second row gets created. */
            assertEquals("waiting_for_approval", parked.single()["status"])
            val firstId = parked.single()["id"]

            assertEquals(1, approve(ds, runId), "no gate was opened to approve")

            // ── Resume: same run, same step. The loop replays from iteration 1.
            val resumed = executor(ds, w,
                ScriptedLlmProvider().thenAction(askApproval).thenAction(finalAfterApproval),
                RecordingEventStore(), true)
                .execute(node(w), emptyMap(), ctx(w, runId))

            assertTrue(resumed is NodeResult.Completed, resumed.toString())

            /*
             * THE ASSERTION THIS WHOLE CLASS EXISTS FOR. A second row is not an error
             * — the run still completes — so nothing would tell you. It shows up as a
             * duplicated subtree in the trace and a doubled budget, weeks later.
             */
            val after = activationRows(ds, runId)
            assertEquals(1, after.size, "the resume created a second activation")
            assertEquals(firstId, after.single()["id"], "the resume reattached to a different row")
            assertEquals("succeeded", after.single()["status"])
            assertNotNull(after.single()["output"], "the reattached activation recorded no output")
        } finally {
            cleanup(ds!!, w)
        }
    }

    @Test
    fun `an instruction that resolves differently on resume still reattaches`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!, World())
        try {
            val runId = newRun(ds, w)

            // ── First execution: the instruction comes from node config, and parks.
            val first = executor(ds, w, ScriptedLlmProvider().thenAction(askApproval),
                RecordingEventStore(), true)
                .execute(node(w), emptyMap(), ctx(w, runId))
            assertTrue(first is NodeResult.ApprovalPaused, first.toString())
            val firstId = activationRows(ds, runId).single()["id"]

            approve(ds, runId)

            /*
             * ── THE HASH DRIFTS, AND THE ROW HAS TO WIN ─────────────────────
             *
             * The task instruction falls back through node config → taskInstruction
             * → task → prompt → input. Here the node no longer carries it and the
             * chain lands on a mapped input instead — the same situation a resume
             * produces when the step-output view it rebuilds from has moved on.
             *
             * The contract hash is now DIFFERENT, so the unique constraint cannot
             * save this: the insert would not conflict, and a second activation
             * would be created for work that already has one. Only the natural-key
             * lookup on (run_id, step_id, agent_id) catches it. Remove that lookup
             * and this test is the one that fails.
             */
            val driftedNode = WorkflowNode(id = stepId, type = "agent",
                config = mapOf("agentId" to w.agentId.toString()))
            val driftedInputs = mapOf<String, Any>("input" to "Close the ticket instead.")

            val resumeLlm = ScriptedLlmProvider().thenAction(askApproval).thenAction(finalAfterApproval)
            val resumed = executor(ds, w, resumeLlm, RecordingEventStore(), true)
                .execute(driftedNode, driftedInputs, ctx(w, runId))

            assertTrue(resumed is NodeResult.Completed, resumed.toString())

            val after = activationRows(ds, runId)
            assertEquals(1, after.size, "a drifted instruction created a second activation")
            assertEquals(firstId, after.single()["id"])

            /*
             * And the run finished as the thing it STARTED as: the INSTRUCTION the
             * model was given is the pinned one, not the one the fallback chain
             * resolved on this tick. Without the pin, a human would have approved
             * one task and the run would have continued with another.
             */
            val prompt = resumeLlm.requests().first().userPrompt ?: ""
            assertTrue(prompt.contains("Summarise the ticket."),
                "the resumed tick used the drifted instruction instead of the pinned one")

            /*
             * ── THE LIMIT OF THE PIN, STATED RATHER THAN ASSUMED AWAY ───────
             *
             * The drifted value is still visible in the prompt, because the RESOLVED
             * INPUT is not pinned — it rides on AgentBrainConfig.resolvedInput and is
             * rebuilt from the step-output view every tick. That is deliberate: the
             * resolved input is the least stable thing in scope, and putting it in
             * the contract is what would make the hash drift in the first place (see
             * the comment on agent_activations.contract_json).
             *
             * So P6 pins the instruction and P8's constructed TaskContract is where
             * the input joins it. This assertion records the boundary so that a
             * future change which quietly widens or narrows it has to come here and
             * say so.
             */
            assertTrue(prompt.contains("Close the ticket instead."),
                "resolved input is expected to be live in P6 — if this now fails, the " +
                "pin was widened to cover it and that decision belongs in the doc")
        } finally {
            cleanup(ds!!, w)
        }
    }

    @Test
    fun `a run that started with the flag off completes when the flag flips`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!, World())
        try {
            val runId = newRun(ds, w)

            // ── Parked by the OLD path, so there is no activation on file.
            val first = executor(ds, w, ScriptedLlmProvider().thenAction(askApproval),
                RecordingEventStore(), activations = false)
                .execute(node(w), emptyMap(), ctx(w, runId))
            assertTrue(first is NodeResult.ApprovalPaused, first.toString())
            assertEquals(0, activationRows(ds, runId).size)

            approve(ds, runId)

            // ── The flag is turned on while the run is parked mid-flight.
            val resumed = executor(ds, w,
                ScriptedLlmProvider().thenAction(askApproval).thenAction(finalAfterApproval),
                RecordingEventStore(), activations = true)
                .execute(node(w), emptyMap(), ctx(w, runId))

            /* It must COMPLETE, not fail looking for an activation that predates the
               flag. The activation is created on this tick, which is the honest
               record: this is the first tick that had one. */
            assertTrue(resumed is NodeResult.Completed, resumed.toString())
            assertEquals(1, activationRows(ds, runId).size)
        } finally {
            cleanup(ds!!, w)
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 4. The spans
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `the activation and its iterations become spans under the step`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!, World())
        val writer = SpanWriter(ds, pubSub = null, enabled = true)
        try {
            val runId = newRun(ds, w)
            val tracer = RunTracer(writer, traceId = runId, runId = runId, workspaceId = w.workspaceId)

            /* What WorkflowRuntime opens before it reaches the executor. Recreated
               here so the assertion is about the REAL nesting and not about a span
               floating with no parent. */
            tracer.openTick("tick 1")
            val stepSpan = tracer.open("step", "agent", tracer.tickSpanId, nodeId = stepId)

            val result = executor(ds, w, ScriptedLlmProvider().also { script(it) },
                RecordingEventStore(), true)
                .execute(node(w), emptyMap(), ctx(w, runId, tracer))
            assertTrue(result is NodeResult.Completed, result.toString())

            tracer.close(stepSpan, "step", "agent", "ok", stepId = stepId, nodeId = stepId)
            tracer.closeTick("ok")
            writer.flush()

            val spans = ds.connection.use { c ->
                c.prepareStatement(
                    "SELECT span_id, parent_span_id, kind, status, activation_id, iteration_index " +
                    "  FROM run_spans WHERE run_id=?"
                ).use { st ->
                    st.setObject(1, runId)
                    st.executeQuery().use { rs ->
                        val out = mutableListOf<Map<String, Any?>>()
                        while (rs.next()) out += mapOf(
                            "id" to rs.getObject("span_id"),
                            "parent" to rs.getObject("parent_span_id"),
                            "kind" to rs.getString("kind"),
                            "status" to rs.getString("status"),
                            "activation" to rs.getObject("activation_id"),
                            "iteration" to rs.getObject("iteration_index"),
                        )
                        out
                    }
                }
            }

            val activation = spans.singleOrNull { it["kind"] == "activation" }
            assertNotNull(activation,
                "no activation span was written: " + spans.map { it["kind"] })
            assertEquals(stepSpan, activation["parent"], "the activation must nest inside its step")
            assertEquals("ok", activation["status"])

            /* The id the span carries is the row it describes — the join the debugger
               makes to put a trace and a transcript side by side. */
            val row = activationRows(ds, runId).single()
            assertEquals(row["id"], activation["activation"])

            val iterations = spans.filter { it["kind"] == "iteration" }
            assertEquals(2, iterations.size, "one span per iteration the loop actually ran")
            assertTrue(iterations.all { it["parent"] == activation["id"] },
                "iterations must nest inside the activation, not beside it")
            assertEquals(listOf(1, 2), iterations.mapNotNull { it["iteration"] as? Int }.sorted())
            /* Inherited, without any executor knowing activations exist. */
            assertTrue(iterations.all { it["activation"] == row["id"] })

            /*
             * The model calls are the point of the nesting. Before this phase they
             * hung flat off the step: a waterfall could tell you the step took four
             * seconds but not which iteration spent them.
             */
            val llmSpans = spans.filter { it["kind"] == "llm_call" }
            assertEquals(2, llmSpans.size)
            val iterationIds = iterations.map { it["id"] }.toSet()
            assertTrue(llmSpans.all { it["parent"] in iterationIds },
                "a model call belongs to the iteration that made it")
            assertTrue(llmSpans.all { it["activation"] == row["id"] },
                "activation id must be inherited down the tree")
        } finally {
            writer.stop()
            cleanup(ds!!, w)
        }
    }

    @Test
    fun `tracing off leaves the run untouched`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!, World())
        try {
            val runId = newRun(ds, w)
            val writer = SpanWriter(ds, pubSub = null, enabled = false)
            val tracer = RunTracer(writer, traceId = runId, runId = runId, workspaceId = w.workspaceId)
            tracer.openTick("tick 1")

            val result = executor(ds, w, ScriptedLlmProvider().also { script(it) },
                RecordingEventStore(), true)
                .execute(node(w), emptyMap(), ctx(w, runId, tracer))

            /* Observability never blocks execution — including when every id the
               tracer would have handed out is null. */
            assertTrue(result is NodeResult.Completed, result.toString())
            assertEquals(1, activationRows(ds, runId).size)
        } finally {
            cleanup(ds!!, w)
        }
    }
}
