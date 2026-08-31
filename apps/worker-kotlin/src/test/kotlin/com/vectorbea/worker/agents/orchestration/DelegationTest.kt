package com.vectorbea.worker.agents.orchestration

import com.vectorbea.worker.agents.brain.model.AgentLoopState.StopReason
import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner
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
import org.junit.jupiter.api.Tag

/**
 * Agent-to-agent delegation, driven end to end through the real executor.
 *
 * ── WHY EVERY CASE RUNS THE WHOLE STACK ─────────────────────────────────────
 * Each guard could be unit-tested against [AgentCallExecutor] alone, and each
 * such test would pass while proving very little. What can actually be wrong
 * here is the WIRING: whether the roster reaches the check, whether the child's
 * depth reaches the guard, whether a refusal becomes the right stop reason,
 * whether the parent's activation is the child's parent. All of those live
 * between the classes, not inside them.
 *
 * So every case below starts at `AgentNodeExecutor.execute` with a real agent
 * row, a real activation, a real Postgres and a scripted provider, and asserts on
 * what a caller can actually see.
 *
 * Skips when no database is reachable.
 */
@Tag("integration")
class DelegationTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    private val stepId = "n-supervisor"

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
        val connectionId: UUID = UUID.randomUUID(),
    ) {
        val agents = mutableMapOf<String, UUID>()
        operator fun get(name: String): UUID = agents.getValue(name)
    }

    private fun seed(ds: DataSource): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "delegation-test")
                it.setString(3, "delegation-test-" + w.workspaceId); it.executeUpdate()
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

    /** One agent. [roster] is its `can_delegate_to`; it is set afterwards by [roster]. */
    private fun agent(
        ds: DataSource, w: World, name: String,
        maxIterations: Int = 6,
        requiresApproval: Boolean = false,
        toolIds: List<UUID> = emptyList(),
    ): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agents (id,workspace_id,environment_id,name,slug,type,instructions," +
                " llm_connection_id,model_name,temperature,max_tokens,max_iterations," +
                " max_tool_calls,max_cost_cents,status,requires_approval,allowed_tool_ids) " +
                "VALUES (?,?,?,?,?,'iterative_agent','You are " + name + ".'," +
                " ?,'gpt-4o-mini',0.2,2048,?,5,50,'active',?,?)"
            ).use {
                it.setObject(1, id); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setString(4, name); it.setString(5, "$name-$id")
                it.setObject(6, w.connectionId); it.setInt(7, maxIterations)
                it.setBoolean(8, requiresApproval)
                it.setArray(9, c.createArrayOf("text", toolIds.map { t -> t.toString() }.toTypedArray()))
                it.executeUpdate()
            }
        }
        w.agents[name] = id
        return id
    }

    /** Grant [from] the right to delegate to [to]. The roster, and nothing else. */
    private fun roster(ds: DataSource, w: World, from: String, vararg to: String) {
        ds.connection.use { c ->
            c.prepareStatement("UPDATE agents SET can_delegate_to = ? WHERE id = ?").use {
                it.setArray(1, c.createArrayOf("text", to.map { n -> w[n].toString() }.toTypedArray()))
                it.setObject(2, w[from]); it.executeUpdate()
            }
        }
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

    // ── Driving it ───────────────────────────────────────────────────────────

    private fun executor(
        ds: DataSource, w: World, llm: ScriptedLlmProvider,
        events: RecordingEventStore = RecordingEventStore(),
        delegation: Boolean = true,
        reconstruction: Boolean = false,
    ) = AgentNodeExecutor(
        dataSource = ds,
        connectionResolver = stubLlmResolver(w.workspaceId, w.environmentId),
        eventStore = events,
        /* A real pool manager, because ToolNodeExecutor is what enforces a tool's
           `requires_approval` and the brain only builds one when pools are present.
           With null, a gated tool never reaches its gate — the loop is told "tool
           execution is not available" and records a failed observation instead. */
        dbPoolManager = com.vectorbea.worker.connector.pool.ClientDbPoolManager(),
        activationsEnabled = true,
        llmHttpClient = llm,
        delegationEnabled = delegation,
        reconstructionEnabled = reconstruction,
    )

    private fun node(w: World, supervisor: String, config: Map<String, Any> = emptyMap()) =
        WorkflowNode(
            id = stepId, type = "agent",
            config = mapOf(
                "agentId" to w[supervisor].toString(),
                "taskInstruction" to "Answer the customer's question.",
            ) + config,
        )

    /** What a RESUME_RUN builds — the only job type that reconstructs. */
    private fun resumeCtx(w: World) = RuntimeContext(
        runId = w.runId, workspaceId = w.workspaceId, environmentId = w.environmentId,
        workflowVersionId = w.versionId, workflowId = w.workflowId,
        workflowInput = emptyMap(), graph = WorkflowGraph(),
        allowLoopReconstruction = true,
    )

    private fun ctx(w: World, tracer: RunTracer? = null) = RuntimeContext(
        runId = w.runId, workspaceId = w.workspaceId, environmentId = w.environmentId,
        workflowVersionId = w.versionId, workflowId = w.workflowId,
        workflowInput = emptyMap(), graph = WorkflowGraph(), tracer = tracer,
    )

    private fun delegateAction(target: UUID, objective: String = "Look up the invoice.",
                               schema: String? = null) =
        "{\"type\":\"DELEGATE\",\"reasoningSummary\":\"the billing agent knows invoices\"," +
        "\"targetAgentId\":\"$target\",\"contract\":{\"objective\":\"$objective\"" +
        (schema?.let { ",\"outputSchema\":$it" } ?: "") + "}}"

    private val finalAction = "{\"type\":\"FINAL\",\"finalOutput\":{\"answer\":\"done\"}}"

    private fun activationRows(ds: DataSource, w: World): List<Map<String, Any?>> =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT id, agent_id, depth, status, parent_activation_id, output_json::text AS out " +
                "  FROM agent_activations WHERE run_id=? ORDER BY sequence"
            ).use { st ->
                st.setObject(1, w.runId)
                st.executeQuery().use { rs ->
                    val out = mutableListOf<Map<String, Any?>>()
                    while (rs.next()) out += mapOf(
                        "id" to rs.getObject("id"), "agent" to rs.getObject("agent_id"),
                        "depth" to rs.getInt("depth"), "status" to rs.getString("status"),
                        "parent" to rs.getObject("parent_activation_id"),
                        "out" to rs.getString("out"),
                    )
                    out
                }
            }
        }

    private fun stopReasonsOf(ds: DataSource, w: World, agentName: String): List<String> =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT stop_reason FROM agent_activations WHERE run_id=? AND agent_id=?")
                .use { st ->
                    st.setObject(1, w.runId); st.setObject(2, w[agentName])
                    st.executeQuery().use { rs ->
                        val out = mutableListOf<String>()
                        while (rs.next()) rs.getString(1)?.let { out += it }
                        out
                    }
                }
        }

    private fun stopReasonOf(ds: DataSource, w: World, agentName: String): String? =
        ds.connection.use { c ->
            c.prepareStatement("SELECT stop_reason FROM agent_activations WHERE run_id=? AND agent_id=?")
                .use { st ->
                    st.setObject(1, w.runId); st.setObject(2, w[agentName])
                    st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
                }
        }

    private fun approvalRows(ds: DataSource, w: World): List<String> =
        ds.connection.use { c ->
            c.prepareStatement("SELECT node_id FROM run_approvals WHERE run_id=? ORDER BY node_id")
                .use { st ->
                    st.setObject(1, w.runId)
                    st.executeQuery().use { rs ->
                        val out = mutableListOf<String>(); while (rs.next()) out += rs.getString(1); out
                    }
                }
        }

    // ═════════════════════════════════════════════════════════════════════════
    // The happy path
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a supervisor delegating to a worker gets two activations, one handoff, and the result`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "supervisor"); agent(ds, w, "worker")
            roster(ds, w, "supervisor", "worker")

            val llm = ScriptedLlmProvider()
                .thenAction(delegateAction(w["worker"]))              // supervisor: delegate
                .thenAction("{\"type\":\"FINAL\",\"finalOutput\":{\"invoice\":\"INV-42\"}}")  // worker
                .thenAction(finalAction)                             // supervisor: wrap up
            val events = RecordingEventStore()

            val result = executor(ds, w, llm, events)
                .execute(node(w, "supervisor"), emptyMap(), ctx(w))

            assertTrue(result is NodeResult.Completed, result.toString())

            val rows = activationRows(ds, w)
            assertEquals(2, rows.size, "one activation per agent that ran")
            val supervisor = rows.single { it["agent"] == w["supervisor"] }
            val worker = rows.single { it["agent"] == w["worker"] }
            assertEquals(0, supervisor["depth"])
            assertEquals(1, worker["depth"])
            assertEquals(supervisor["id"], worker["parent"], "the worker hangs off the supervisor")
            assertEquals("succeeded", worker["status"])
            /* Back to running, not left parked. A parent still `waiting_for_child`
               after its child returned is a run the debugger draws as blocked forever. */
            assertEquals("succeeded", supervisor["status"])

            val edges = HandoffStore(ds).forRun(w.runId)
            assertEquals(1, edges.size)
            assertEquals("DELEGATE", edges.single().kind)
            assertEquals(supervisor["id"], edges.single().from)
            assertEquals(worker["id"], edges.single().to)
            /* The reason is the only record of WHY this worker was chosen, and it is
               the first thing anyone asks when a run goes sideways. */
            assertTrue(edges.single().reason!!.contains("billing agent"), edges.single().reason!!)

            /*
             * THE CHILD'S OUTPUT IN THE PARENT'S PROMPT. Without it the supervisor is
             * told its worker succeeded and told the field names, then asked to
             * summarise data it has never been shown — the same bug the tool path had.
             */
            val supervisorPrompts = llm.requests().map { it.userPrompt ?: "" }
            assertTrue(supervisorPrompts.any { it.contains("INV-42") },
                "the worker's result never reached the supervisor's prompt")
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `the flag off refuses the action instead of silently ignoring it`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "supervisor"); agent(ds, w, "worker")
            roster(ds, w, "supervisor", "worker")

            val llm = ScriptedLlmProvider().thenAction(delegateAction(w["worker"]))
            val result = executor(ds, w, llm, delegation = false)
                .execute(node(w, "supervisor"), emptyMap(), ctx(w))

            assertTrue(result is NodeResult.Failed, result.toString())
            /* Named, not swallowed. Treating it as an unparseable action would repair
               it into a THINK, burn an iteration and tell nobody why. */
            assertTrue((result as NodeResult.Failed).reason.contains("switched off"),
                result.reason)
            assertEquals(1, activationRows(ds, w).size, "no child was created")
            assertTrue(HandoffStore(ds).forRun(w.runId).isEmpty())
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // The guards
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `delegating outside the roster stops with AGENT_NOT_IN_ROSTER and creates nothing`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "supervisor"); agent(ds, w, "worker"); agent(ds, w, "stranger")
            roster(ds, w, "supervisor", "worker")   // 'stranger' deliberately absent

            val llm = ScriptedLlmProvider().thenAction(delegateAction(w["stranger"]))
            val result = executor(ds, w, llm).execute(node(w, "supervisor"), emptyMap(), ctx(w))

            assertTrue(result is NodeResult.Failed, result.toString())
            val failed = result as NodeResult.Failed
            assertTrue(failed.reason.contains("AGENT_NOT_IN_ROSTER"), failed.reason)
            assertTrue(!failed.retryable, "a grant is a decision; retrying changes nothing")
            /* The check is the point: nothing was created for an ungranted target. */
            assertEquals(1, activationRows(ds, w).size)
            assertTrue(HandoffStore(ds).forRun(w.runId).isEmpty())
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `an empty roster means no delegation, not any agent`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "supervisor"); agent(ds, w, "worker")
            // No roster granted at all.

            val llm = ScriptedLlmProvider().thenAction(delegateAction(w["worker"]))
            val result = executor(ds, w, llm).execute(node(w, "supervisor"), emptyMap(), ctx(w))

            /*
             * The one place this deliberately diverges from the tool grant, which
             * reads an empty allowed-list as "everything is allowed". A roster that
             * fails open is an unbounded control-flow edge: every agent could reach
             * every other, and the depth guard would be the only thing between a
             * misconfigured supervisor and the whole workspace.
             */
            assertTrue(result is NodeResult.Failed, result.toString())
            assertTrue((result as NodeResult.Failed).reason.contains("no team roster"), result.reason)
            assertEquals(1, activationRows(ds, w).size)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `depth 4 under a maxDepth of 3 stops with MAX_DEPTH_EXCEEDED`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            listOf("a", "b", "c", "d").forEach { agent(ds, w, it) }
            roster(ds, w, "a", "b"); roster(ds, w, "b", "c"); roster(ds, w, "c", "d")

            /* a→b→c, then c tries d. With maxDepth 2, c sits at depth 2 and d would
               be depth 3. */
            val llm = ScriptedLlmProvider()
                .thenAction(delegateAction(w["b"], "step b"))
                .thenAction(delegateAction(w["c"], "step c"))
                .thenAction(delegateAction(w["d"], "step d"))
                /* c's refusal is a failed OBSERVATION for b, which carries on — so
                   the agents above keep running. That composition is the point: the
                   depth guard stops the agent that broke it, not the whole team. */
                .thenActionRepeated(finalAction, 8)

            val result = executor(ds, w, llm)
                .execute(node(w, "a", mapOf("maxDepth" to 2)), emptyMap(), ctx(w))

            assertTrue(result is NodeResult.Completed, result.toString())

            /* The refusal is recorded on the agent that attempted it. */
            assertEquals("MAX_DEPTH_EXCEEDED", stopReasonOf(ds, w, "c"))

            val rows = activationRows(ds, w)
            /* The guard runs BEFORE creation, so 'd' has no row at all. */
            assertEquals(listOf(0, 1, 2), rows.map { it["depth"] })
            assertTrue(rows.none { it["agent"] == w["d"] }, "the refused level was created anyway")
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `the same request along the same edge stops with HANDOFF_LOOP`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "a", maxIterations = 12); agent(ds, w, "b", maxIterations = 12)
            roster(ds, w, "a", "b"); roster(ds, w, "b", "a")

            /*
             * A→B→A→B with an IDENTICAL contract. The hash is what catches it: the
             * objective is the same words each time, and budget, deadline and
             * watermark are excluded precisely so the repeat still hashes the same.
             */
            val same = "check the invoice"
            val llm = ScriptedLlmProvider()
                .thenAction(delegateAction(w["b"], same))   // a1 → b1   (allowed)
                .thenAction(delegateAction(w["a"], same))   // b1 → a2   (allowed)
                .thenAction(delegateAction(w["b"], same))   // a2 → b2   REFUSED
                /* The refusal is a2's stop; b1 sees a failed observation and
                   carries on, so the agents above keep taking turns. */
                .thenActionRepeated(finalAction, 12)

            val result = executor(ds, w, llm)
                .execute(node(w, "a", mapOf("maxHandoffsPerPair" to 1, "maxDepth" to 8)),
                    emptyMap(), ctx(w))

            /*
             * ── THE EDGE IS BETWEEN AGENTS ───────────────────────────────────
             * a2 is a different ACTIVATION from a1, so a guard keyed on activation
             * ids would see a fresh edge and let the pair ping-pong until the
             * iteration budget ran out. Resolving both sides to the agent's
             * activations is what makes the third hop the repeat it actually is.
             */
            val stops = stopReasonsOf(ds, w, "a")
            assertTrue(stops.contains("HANDOFF_LOOP"),
                "no activation of 'a' stopped with HANDOFF_LOOP: $stops")
            assertTrue(result is NodeResult.Completed || result is NodeResult.Failed)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a run that hits the activation ceiling stops with TEAM_BUDGET_EXCEEDED`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "a", maxIterations = 10); agent(ds, w, "b", maxIterations = 10)
            agent(ds, w, "c", maxIterations = 10)
            roster(ds, w, "a", "b", "c"); roster(ds, w, "b", "c"); roster(ds, w, "c", "b")

            val llm = ScriptedLlmProvider()
                .thenAction(delegateAction(w["b"], "one"))
                .thenAction(delegateAction(w["c"], "two"))
                .thenActionRepeated(delegateAction(w["b"], "three"), 6)

            val result = executor(ds, w, llm)
                .execute(node(w, "a", mapOf("maxActivations" to 3, "maxDepth" to 8)),
                    emptyMap(), ctx(w))

            assertTrue(result is NodeResult.Failed, result.toString())
            assertTrue((result as NodeResult.Failed).reason.contains("activations"), result.reason)
            assertTrue(activationRows(ds, w).size <= 3)
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // The contract
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a child that violates the contract schema fails at the caller's boundary`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "supervisor"); agent(ds, w, "worker")
            roster(ds, w, "supervisor", "worker")

            val llm = ScriptedLlmProvider()
                .thenAction(delegateAction(w["worker"], "get the invoice",
                    schema = "{\"required\":[\"invoiceId\",\"amount\"]}"))
                /* The worker answers with the wrong shape. Note it does NOT fail on
                   its own account — its own outputSchemaJson is the contract's, so
                   this asserts the CALLER'S boundary catches it either way. */
                .thenAction("{\"type\":\"FINAL\",\"finalOutput\":{\"note\":\"I found something\"}}")
                .thenActionRepeated("{\"type\":\"FINAL\",\"finalOutput\":{\"note\":\"still wrong\"}}", 6)

            val result = executor(ds, w, llm)
                .execute(node(w, "supervisor"), emptyMap(), ctx(w))

            assertTrue(result is NodeResult.Failed, result.toString())
            val reason = (result as NodeResult.Failed).reason

            /*
             * ── ASSERTED ON THE STOP REASON, NOT ON MESSAGE TEXT ─────────────
             *
             * A mutation test caught this too: disabling the caller-side check
             * still left the run failing, for an unrelated reason, and a
             * `reason.contains("SCHEMA_INVALID")` assertion could not tell the two
             * apart. The stop reason recorded on the SUPERVISOR'S activation can:
             * it is SCHEMA_INVALID only if the boundary check refused, because the
             * supervisor's own output schema is empty and it has nothing else to
             * fail that way on.
             */
            assertEquals("SCHEMA_INVALID", stopReasonOf(ds, w, "supervisor"),
                "the caller's boundary did not refuse the child's shape; reason was: $reason")

            /* And naming the mismatch is the point. "did not match the required
               output schema" is a category; the missing fields are the answer. */
            assertTrue(reason.contains("invoiceId"), reason)
            /* The child itself did NOT fail — §5.2 rule 1 puts the validation at
               the caller, so the worker succeeded and the CALLER rejected it. */
            assertEquals("succeeded",
                activationRows(ds, w).single { it["agent"] == w["worker"] }["status"])
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Approvals
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `two workers calling the same gated tool open two approval rows`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val toolId = UUID.randomUUID()
        try {
            ds.connection.use { c ->
                c.prepareStatement(
                    "INSERT INTO tools (id,workspace_id,environment_id,name,slug,type,status," +
                    " requires_approval,config_json) " +
                    "VALUES (?,?,?,'gated','gated-tool','http','active',true,'{}'::jsonb)"
                ).use {
                    it.setObject(1, toolId); it.setObject(2, w.workspaceId)
                    it.setObject(3, w.environmentId); it.executeUpdate()
                }
            }
            agent(ds, w, "supervisor")
            agent(ds, w, "w1", toolIds = listOf(toolId))
            agent(ds, w, "w2", toolIds = listOf(toolId))
            roster(ds, w, "supervisor", "w1", "w2")

            val call = "{\"type\":\"CALL_TOOL\",\"toolId\":\"$toolId\",\"toolInput\":{\"q\":\"x\"}}"

            // ── Tick 1: w1 reaches the gate and the whole run parks.
            executor(ds, w, ScriptedLlmProvider()
                .thenAction(delegateAction(w["w1"], "first half"))
                .thenAction(call))
                .execute(node(w, "supervisor"), emptyMap(), ctx(w))

            val firstGate = approvalRows(ds, w).single { it.contains(":tool:$toolId") }
            ds.connection.use { c ->
                c.prepareStatement(
                    "UPDATE run_approvals SET status='APPROVED', resolved_by='alice', resolved_at=now() " +
                    "WHERE run_id=? AND node_id=?"
                ).use { it.setObject(1, w.runId); it.setString(2, firstGate); it.executeUpdate() }
            }

            /* ── Tick 2: w1 proceeds, then w2 reaches its OWN gate. ─────────
               The calls interleave supervisor and child, one action at a time:
               supervisor delegates, w1 calls, w1 finishes, supervisor delegates
               again, w2 calls — and w2's gate is the one being counted. */
            executor(ds, w, ScriptedLlmProvider()
                .thenAction(delegateAction(w["w1"], "first half"))   // supervisor
                .thenAction(call)                                    // w1: gate now APPROVED
                .thenAction(finalAction)                             // w1 done
                .thenAction(delegateAction(w["w2"], "second half"))  // supervisor
                .thenAction(call))                                   // w2: opens gate #2
                .execute(node(w, "supervisor"), emptyMap(), ctx(w))

            /*
             * ── TWO GATES, NOT ONE ───────────────────────────────────────────
             * Sharing `<stepId>:tool:<toolId>` the second worker would silently
             * inherit the first's decision: a person approves w1's call and w2's
             * goes out on the strength of it.
             */
            val gates = approvalRows(ds, w).filter { it.contains(":tool:$toolId") }
            assertEquals(2, gates.size, "gates opened: $gates")

            /*
             * ── ASSERTED AS THE EXACT SHAPE, NOT MERELY AS "DISTINCT" ────────
             *
             * A mutation test caught this: distinctness alone passes even with the
             * depth rule removed, because a child's STEP id is itself derived from
             * its activation (`act:<id>`, so its iteration rows do not collide with
             * a sibling's). Two mechanisms both happen to produce distinct keys,
             * and asserting only distinctness cannot say which one is carrying the
             * guarantee — so it would keep passing after the one that is specified
             * had been deleted.
             *
             * The ruled shape for depth > 0 is `<activationId>:tool:<toolId>`.
             */
            val rows = activationRows(ds, w)
            val expected = listOf("w1", "w2").map { name ->
                val act = rows.single { it["agent"] == w[name] }["id"]
                "$act:tool:$toolId"
            }.sorted()
            assertEquals(expected, gates.sorted(),
                "the gates must key on the ACTIVATION, exactly")
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a root agent's tool gate keeps the step-scoped key that shipped`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val toolId = UUID.randomUUID()
        try {
            ds.connection.use { c ->
                c.prepareStatement(
                    "INSERT INTO tools (id,workspace_id,environment_id,name,slug,type,status," +
                    " requires_approval,config_json) " +
                    "VALUES (?,?,?,'gated','gated-root','http','active',true,'{}'::jsonb)"
                ).use {
                    it.setObject(1, toolId); it.setObject(2, w.workspaceId)
                    it.setObject(3, w.environmentId); it.executeUpdate()
                }
            }
            agent(ds, w, "solo", toolIds = listOf(toolId))

            val llm = ScriptedLlmProvider()
                .thenAction("{\"type\":\"CALL_TOOL\",\"toolId\":\"$toolId\",\"toolInput\":{}}")
            executor(ds, w, llm).execute(node(w, "solo"), emptyMap(), ctx(w))

            /* The compatibility half of the depth rule: nothing in flight can be at
               depth > 0, so a root's keys must be byte-for-byte what they were. */
            assertEquals(listOf("$stepId:tool:$toolId"),
                approvalRows(ds, w).filter { it.contains(":tool:") })
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a gated delegation pauses, resumes, and reattaches to the same activation and the same gate`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "supervisor")
            agent(ds, w, "worker", requiresApproval = true)
            roster(ds, w, "supervisor", "worker")

            // ── First tick: the delegation gate opens and the step parks.
            val first = ScriptedLlmProvider().thenAction(delegateAction(w["worker"]))
            val paused = executor(ds, w, first)
                .execute(node(w, "supervisor"), emptyMap(), ctx(w))
            assertTrue(paused is NodeResult.ApprovalPaused, paused.toString())

            val gateKey = "$stepId:agent:${w["worker"]}"
            assertEquals(listOf(gateKey), approvalRows(ds, w))
            assertEquals(1, activationRows(ds, w).size, "no child until the gate is granted")

            // ── A human approves.
            ds.connection.use { c ->
                c.prepareStatement(
                    "UPDATE run_approvals SET status='APPROVED', resolved_by='alice', resolved_at=now() " +
                    "WHERE run_id=? AND node_id=?"
                ).use { it.setObject(1, w.runId); it.setString(2, gateKey); it.executeUpdate() }
            }

            // ── Resume: the step replays and re-issues the delegation.
            val second = ScriptedLlmProvider()
                .thenAction(delegateAction(w["worker"]))
                .thenAction("{\"type\":\"FINAL\",\"finalOutput\":{\"invoice\":\"INV-7\"}}")
                .thenAction(finalAction)
            val resumed = executor(ds, w, second)
                .execute(node(w, "supervisor"), emptyMap(), ctx(w))
            assertTrue(resumed is NodeResult.Completed, resumed.toString())

            /*
             * ── THE TWO HALVES ASSERTED TOGETHER, ON PURPOSE ─────────────────
             *
             * The activation-scoped approval key is stable only because
             * ActivationStore reattaches deterministically. If a delegation ever
             * produced a SECOND activation row for the same work, the key would move
             * with it and the resumed run would open a gate nobody could ever close.
             * Splitting this into two tests would let one pass while the other's
             * premise had quietly broken.
             */
            assertEquals(2, activationRows(ds, w).size, "the resume created a second activation")
            assertEquals(listOf(gateKey), approvalRows(ds, w), "the resume opened a second gate")

            val worker = activationRows(ds, w).single { it["agent"] == w["worker"] }
            assertEquals("succeeded", worker["status"])
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a resumed delegation replays the child's output, with reconstruction off`() =
        resumedDelegationReplays(reconstruction = false)

    @Test
    fun `a resumed delegation replays the child's output, with reconstruction on`() =
        resumedDelegationReplays(reconstruction = true)

    /**
     * ── BOTH SETTINGS, BECAUSE THEY REACH THE SAME PLACE BY DIFFERENT ROUTES ──
     *
     * Off, the parent replays from iteration 1 and re-issues the DELEGATE. On, it
     * resumes at the DELEGATING iteration — reconstruction takes `completed` and
     * `failed` rows, the delegating iteration is `running` when the child parks,
     * and P3's rule rebuilds to N−1 and lets N re-execute. Either way the
     * delegation is re-issued and reattaches, and only one of those is the route
     * the design note describes; testing one would leave the other unasserted.
     */
    private fun resumedDelegationReplays(reconstruction: Boolean) = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "supervisor"); agent(ds, w, "worker")
            roster(ds, w, "supervisor", "worker")

            // ── First tick: the worker runs and succeeds; the supervisor then parks
            //    on its OWN approval, so the tick ends with the child terminal.
            val first = ScriptedLlmProvider()
                .thenAction(delegateAction(w["worker"]))
                .thenAction("{\"type\":\"FINAL\",\"finalOutput\":{\"invoice\":\"INV-9\"}}")
                .thenAction("{\"type\":\"ASK_APPROVAL\",\"reasoningSummary\":\"need a human\"}")
            val paused = executor(ds, w, first, reconstruction = reconstruction)
                .execute(node(w, "supervisor"), emptyMap(), ctx(w))
            assertTrue(paused is NodeResult.ApprovalPaused, paused.toString())
            assertEquals(3, first.callCount(), "supervisor, worker, supervisor")

            ds.connection.use { c ->
                c.prepareStatement(
                    "UPDATE run_approvals SET status='APPROVED', resolved_by='alice', resolved_at=now() " +
                    "WHERE run_id=? AND node_id=?"
                ).use { it.setObject(1, w.runId); it.setString(2, stepId); it.executeUpdate() }
            }

            // ── Resume. The supervisor replays and re-issues the delegation.
            val second = ScriptedLlmProvider()
                .thenAction(delegateAction(w["worker"]))
                .thenAction("{\"type\":\"ASK_APPROVAL\",\"reasoningSummary\":\"need a human\"}")
                .thenAction(finalAction)
            val resumed = executor(ds, w, second, reconstruction = reconstruction)
                .execute(node(w, "supervisor"), emptyMap(),
                    if (reconstruction) resumeCtx(w) else ctx(w))
            assertTrue(resumed is NodeResult.Completed, resumed.toString())

            /*
             * ── ZERO REPEATED CHILD CALLS ────────────────────────────────────
             * The child's activation is TERMINAL, so reattaching replays its
             * recorded output rather than running it. Every provider call on the
             * resume belongs to the SUPERVISOR — a resumed delegation costs one row
             * read, not the child's entire brain loop.
             */
            assertEquals(2, activationRows(ds, w).size, "no third activation")
            val worker = activationRows(ds, w).single { it["agent"] == w["worker"] }
            assertTrue((worker["out"] as String).contains("INV-9"))

            /*
             * The child's activation is TERMINAL, so reattaching replays its
             * recorded output rather than running it. Every provider call on the
             * resume belongs to the SUPERVISOR — a resumed delegation costs one row
             * read, not the child's entire brain loop. With reconstruction on the
             * supervisor also skips its own earlier iterations, so it makes FEWER
             * calls, never more.
             */
            assertTrue(second.callCount() <= 3,
                "the resume made ${second.callCount()} provider calls; the child's " +
                "loop was re-run instead of replayed")
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Spans
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a delegation produces a handoff span with the child activation inside it`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val writer = SpanWriter(ds, pubSub = null, enabled = true)
        try {
            agent(ds, w, "supervisor"); agent(ds, w, "worker")
            roster(ds, w, "supervisor", "worker")

            val tracer = RunTracer(writer, traceId = w.runId, runId = w.runId, workspaceId = w.workspaceId)
            tracer.openTick("tick 1")
            val stepSpan = tracer.open("step", "agent", tracer.tickSpanId, nodeId = stepId)

            val llm = ScriptedLlmProvider()
                .thenAction(delegateAction(w["worker"]))
                .thenAction("{\"type\":\"FINAL\",\"finalOutput\":{\"invoice\":\"INV-1\"}}")
                .thenAction(finalAction)
            executor(ds, w, llm).execute(node(w, "supervisor"), emptyMap(), ctx(w, tracer))

            tracer.close(stepSpan, "step", "agent", "ok", stepId = stepId, nodeId = stepId)
            tracer.closeTick("ok")
            writer.flush()

            val spans = ds.connection.use { c ->
                c.prepareStatement(
                    "SELECT span_id, parent_span_id, kind, name FROM run_spans WHERE run_id=?"
                ).use { st ->
                    st.setObject(1, w.runId)
                    st.executeQuery().use { rs ->
                        val out = mutableListOf<Map<String, Any?>>()
                        while (rs.next()) out += mapOf(
                            "id" to rs.getObject(1), "parent" to rs.getObject(2),
                            "kind" to rs.getString(3), "name" to rs.getString(4))
                        out
                    }
                }
            }

            val handoff = spans.singleOrNull { it["kind"] == "handoff" }
            assertNotNull(handoff, "no handoff span: " + spans.map { it["kind"] })

            val activations = spans.filter { it["kind"] == "activation" }
            assertEquals(2, activations.size)
            /*
             * The child activation nests INSIDE the handoff, which gives the
             * constellation view a direct edge-to-node mapping rather than one
             * inferred by pairing timestamps.
             */
            assertTrue(activations.any { it["parent"] == handoff["id"] },
                "no activation span hangs off the handoff")
        } finally {
            writer.stop(); cleanup(ds!!, w)
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // A failed child is an observation, not a stop
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a failed delegation is a failed observation and the supervisor carries on`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "supervisor"); agent(ds, w, "worker"); agent(ds, w, "backup")
            roster(ds, w, "supervisor", "worker", "backup")

            val llm = ScriptedLlmProvider()
                .thenAction(delegateAction(w["worker"], "try the first way"))
                .thenAction("{\"type\":\"FAIL\",\"failReason\":\"no invoice for that customer\"}")
                .thenAction(delegateAction(w["backup"], "try the other way"))
                .thenAction("{\"type\":\"FINAL\",\"finalOutput\":{\"invoice\":\"INV-B\"}}")
                .thenAction(finalAction)

            val result = executor(ds, w, llm)
                .execute(node(w, "supervisor"), emptyMap(), ctx(w))

            /*
             * §2 governs: an agent is a callable exactly like a tool, and a failed
             * tool call does not fail the step. The supervisor tried a different
             * worker and finished — which is the outcome a hard CHILD_FAILED stop
             * would have thrown away.
             */
            assertTrue(result is NodeResult.Completed,
                (result as? NodeResult.Failed)?.reason ?: result.toString())
            assertEquals(3, activationRows(ds, w).size)
            assertEquals(2, HandoffStore(ds).forRun(w.runId).size)

            /* And the failure is visible — it rode into the next prompt as an
               unsuccessful observation, which is how the supervisor knew to switch. */
            assertTrue(llm.requests().any { (it.userPrompt ?: "").contains("no invoice") },
                "the child's failure never reached the supervisor")
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a handoff transfers control and the child's output becomes the step's output`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "router"); agent(ds, w, "specialist")
            roster(ds, w, "router", "specialist")

            val llm = ScriptedLlmProvider()
                .thenAction("{\"type\":\"HANDOFF\",\"reasoningSummary\":\"this is a billing question\"," +
                    "\"targetAgentId\":\"${w["specialist"]}\"," +
                    "\"contract\":{\"objective\":\"answer the billing question\"}}")
                .thenAction("{\"type\":\"FINAL\",\"finalOutput\":{\"answer\":\"your bill is £12\"}}")

            val result = executor(ds, w, llm).execute(node(w, "router"), emptyMap(), ctx(w))

            assertTrue(result is NodeResult.Completed, result.toString())
            /* A tail call: the specialist's answer IS the step's answer, and the
               router does not run again. */
            assertEquals("your bill is £12", (result as NodeResult.Completed).output["answer"])

            val router = activationRows(ds, w).single { it["agent"] == w["router"] }
            /* Neither succeeded nor failed. A router that correctly routed did its
               job; grading it succeeded inflates success metrics and grading it
               failed makes every routed run look broken. */
            assertEquals("handed_off", router["status"])
            assertEquals("TRANSFER", HandoffStore(ds).forRun(w.runId).single().kind)
        } finally { cleanup(ds!!, w) }
    }
}
