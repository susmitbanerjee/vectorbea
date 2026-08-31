package com.vectorbea.worker.agents.orchestration

import com.vectorbea.worker.runtime.executor.AgentTeamNodeExecutor
import com.vectorbea.worker.runtime.executor.NodeResult
import com.vectorbea.worker.runtime.graph.NodeType
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
 * Teams, one policy at a time, driven end to end.
 *
 * ── WHAT THESE ASSERT ON ────────────────────────────────────────────────────
 * The activation TREE and the terminal states, not the prose. A policy is a
 * claim about shape — "a router produces two activations, one of them
 * `handed_off`" — and shape is the thing that goes wrong when a policy is
 * implemented as a special case instead of a table row.
 *
 * Skips when no database is reachable.
 */
class AgentTeamTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    private val stepId = "n-team"

    private fun dataSourceOrNull(): DataSource? = try {
        val ds = PGSimpleDataSource().apply {
            setURL(jdbcUrl); connectTimeout = 2; socketTimeout = 20
        }
        ds.connection.use { c ->
            c.prepareStatement("SELECT join_group_id FROM agent_handoffs LIMIT 1")
                .use { it.executeQuery() }
        }
        ds
    } catch (_: Exception) {
        null
    }

    private class World(
        val workspaceId: UUID = UUID.randomUUID(),
        val environmentId: UUID = UUID.randomUUID(),
        val workflowId: UUID = UUID.randomUUID(),
        val versionId: UUID = UUID.randomUUID(),
        val runId: UUID = UUID.randomUUID(),
        val connectionId: UUID = UUID.randomUUID(),
    ) {
        val agents = linkedMapOf<String, UUID>()
        operator fun get(name: String): UUID = agents.getValue(name)
    }

    private fun seed(ds: DataSource): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "team-test")
                it.setString(3, "team-test-" + w.workspaceId); it.executeUpdate()
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

    private fun agent(ds: DataSource, w: World, name: String, maxIterations: Int = 8): UUID {
        val id = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agents (id,workspace_id,environment_id,name,slug,type,instructions," +
                " llm_connection_id,model_name,temperature,max_tokens,max_iterations," +
                " max_tool_calls,max_cost_cents,status) " +
                "VALUES (?,?,?,?,?,'iterative_agent','You are " + name + ".'," +
                " ?,'gpt-4o-mini',0.2,2048,?,5,50,'active')"
            ).use {
                it.setObject(1, id); it.setObject(2, w.workspaceId); it.setObject(3, w.environmentId)
                it.setString(4, name); it.setString(5, "$name-$id")
                it.setObject(6, w.connectionId); it.setInt(7, maxIterations); it.executeUpdate()
            }
        }
        w.agents[name] = id
        return id
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
        teams: Boolean = true,
    ) = AgentTeamNodeExecutor(
        dataSource = ds,
        connectionResolver = stubLlmResolver(w.workspaceId, w.environmentId),
        eventStore = events,
        dbPoolManager = com.vectorbea.worker.connector.pool.ClientDbPoolManager(),
        teamsEnabled = teams,
        llmHttpClient = llm,
    )

    /** One roster member, in the wire shape §6 shows. */
    private fun member(w: World, name: String, role: String, vararg canDelegateTo: String) =
        mapOf(
            "agentId" to w[name].toString(),
            "role" to role,
            "alias" to name,
            "canDelegateTo" to canDelegateTo.toList(),
        )

    private fun node(
        policy: String,
        roster: List<Map<String, Any?>>,
        extra: Map<String, Any> = emptyMap(),
    ) = WorkflowNode(
        id = stepId, type = "agent_team",
        config = mapOf(
            "policy" to policy,
            "roster" to roster,
            "taskInstruction" to "Answer the customer's question.",
            "budget" to mapOf("maxTotalTokens" to 100_000, "maxCostCents" to 400),
            "limits" to mapOf("maxDepth" to 4, "maxActivations" to 12,
                "maxIterations" to 24, "maxToolCalls" to 12),
        ) + extra,
    )

    private fun ctx(w: World, tickDeadlineAtMs: Long? = null) = RuntimeContext(
        runId = w.runId, workspaceId = w.workspaceId, environmentId = w.environmentId,
        workflowVersionId = w.versionId, workflowId = w.workflowId,
        workflowInput = emptyMap(), graph = WorkflowGraph(),
        tickDeadlineAtMs = tickDeadlineAtMs,
    )

    private fun delegate(target: UUID, objective: String = "do your part") =
        "{\"type\":\"DELEGATE\",\"reasoningSummary\":\"handing over\"," +
        "\"targetAgentId\":\"$target\",\"contract\":{\"objective\":\"$objective\"}}"

    private fun broadcast(vararg targets: UUID) =
        "{\"type\":\"DELEGATE\",\"reasoningSummary\":\"asking everyone\",\"targetAgentIds\":[" +
        targets.joinToString(",") { "\"$it\"" } + "],\"contract\":{\"objective\":\"weigh in\"}}"

    private fun handoff(target: UUID) =
        "{\"type\":\"HANDOFF\",\"reasoningSummary\":\"this is billing\"," +
        "\"targetAgentId\":\"$target\",\"contract\":{\"objective\":\"answer it\"}}"

    private fun final(vararg kv: Pair<String, String>) =
        "{\"type\":\"FINAL\",\"finalOutput\":{" +
        kv.joinToString(",") { "\"${it.first}\":\"${it.second}\"" } + "}}"

    private fun fail(why: String) = "{\"type\":\"FAIL\",\"failReason\":\"$why\"}"

    private data class Row(val agent: UUID?, val depth: Int, val status: String, val parent: UUID?)

    private fun rows(ds: DataSource, w: World): List<Row> = ds.connection.use { c ->
        c.prepareStatement(
            "SELECT agent_id, depth, status, parent_activation_id FROM agent_activations " +
            " WHERE run_id=? ORDER BY sequence"
        ).use { st ->
            st.setObject(1, w.runId)
            st.executeQuery().use { rs ->
                val out = mutableListOf<Row>()
                while (rs.next()) out += Row(
                    rs.getObject("agent_id", UUID::class.java), rs.getInt("depth"),
                    rs.getString("status"), rs.getObject("parent_activation_id", UUID::class.java))
                out
            }
        }
    }

    private fun statusOf(ds: DataSource, w: World, name: String): String? =
        rows(ds, w).firstOrNull { it.agent == w[name] }?.status

    // ═════════════════════════════════════════════════════════════════════════
    // The node type itself
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `agent_team is a type addition and agent nodes keep their own`() {
        assertEquals(NodeType.AGENT_TEAM, NodeType.fromString("agent_team"))
        assertEquals(NodeType.AGENT_TEAM, NodeType.fromString("team"))
        /* The point of a TYPE addition: nothing an existing graph contains
           resolves differently than it did. */
        assertEquals(NodeType.AGENT, NodeType.fromString("agent"))
        assertTrue(WorkflowNode(id = "x", type = "agent_team").isSupported())
    }

    @Test
    fun `the flag off says teams are off, rather than reporting an unknown node`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "supervisor")
            val r = executor(ds, w, ScriptedLlmProvider(), teams = false)
                .execute(node("supervisor", listOf(member(w, "supervisor", "supervisor"))),
                    emptyMap(), ctx(w))
            assertTrue(r is NodeResult.Failed, r.toString())
            /* "this worker does not support agent_team" reads as a bug; "teams are
               switched off here" reads as the configuration it is. */
            assertTrue((r as NodeResult.Failed).reason.contains("switched off"), r.reason)
            assertTrue(rows(ds, w).isEmpty())
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a team with no policy is refused rather than guessed at`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "a")
            val bad = WorkflowNode(id = stepId, type = "agent_team",
                config = mapOf("roster" to listOf(member(w, "a", "worker"))))
            val r = executor(ds, w, ScriptedLlmProvider()).execute(bad, emptyMap(), ctx(w))
            assertTrue(r is NodeResult.Failed, r.toString())
            /* Defaulting a policy would run somebody's team as a shape they did
               not choose, which is worse than refusing. */
            assertTrue((r as NodeResult.Failed).reason.contains("policy"), r.reason)
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // One test per policy — the tree shape and the terminal state
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `supervisor delegates and aggregates`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "supervisor"); agent(ds, w, "researcher")
            val llm = ScriptedLlmProvider()
                .thenAction(delegate(w["researcher"], "find the invoice"))
                .thenAction(final("invoice" to "INV-1"))
                .thenAction(final("answer" to "your invoice is INV-1"))

            val r = executor(ds, w, llm).execute(
                node("supervisor", listOf(
                    member(w, "supervisor", "supervisor", "researcher"),
                    member(w, "researcher", "worker"),
                )), emptyMap(), ctx(w))

            assertTrue(r is NodeResult.Completed, r.toString())
            assertEquals("your invoice is INV-1", (r as NodeResult.Completed).output["answer"])
            assertEquals("supervisor", r.output["_teamPolicy"])

            val tree = rows(ds, w)
            assertEquals(2, tree.size)
            assertEquals(listOf(0, 1), tree.map { it.depth })
            assertEquals("succeeded", statusOf(ds, w, "supervisor"))
            assertEquals("succeeded", statusOf(ds, w, "researcher"))
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `router transfers and ends handed_off, which is neither success nor failure`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "router"); agent(ds, w, "billing")
            val llm = ScriptedLlmProvider()
                .thenAction(handoff(w["billing"]))
                .thenAction(final("answer" to "your bill is 12"))

            val r = executor(ds, w, llm).execute(
                node("router", listOf(
                    member(w, "router", "router", "billing"),
                    member(w, "billing", "worker"),
                )), emptyMap(), ctx(w))

            assertTrue(r is NodeResult.Completed, r.toString())
            assertEquals("your bill is 12", (r as NodeResult.Completed).output["answer"])

            /*
             * ── handed_off IS TERMINAL AND IS NEITHER ───────────────────────
             * A router that correctly transferred did its job. Grading it
             * `succeeded` inflates success metrics; grading it `failed` makes every
             * routed run look broken.
             */
            assertEquals("handed_off", statusOf(ds, w, "router"))
            assertEquals("succeeded", statusOf(ds, w, "billing"))

            /* A TRANSFER is a tail call: it does not grow the stack, so a router
               chain is not capped by maxDepth. */
            assertEquals(listOf(0, 0), rows(ds, w).map { it.depth })
            assertEquals("TRANSFER", HandoffStore(ds).forRun(w.runId).single().kind)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `pipeline runs its stages in order and the last one's output is the team's`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "extract"); agent(ds, w, "summarise"); agent(ds, w, "format")
            val llm = ScriptedLlmProvider()
                .thenAction(final("raw" to "one"))
                .thenAction(final("summary" to "two"))
                .thenAction(final("formatted" to "three"))

            val r = executor(ds, w, llm).execute(
                node("pipeline", listOf(
                    member(w, "extract", "worker"),
                    member(w, "summarise", "worker"),
                    member(w, "format", "worker"),
                )), emptyMap(), ctx(w))

            assertTrue(r is NodeResult.Completed, r.toString())
            /* The LAST stage's output, not a merge — a pipeline's answer is the end
               of the pipe. */
            assertEquals("three", (r as NodeResult.Completed).output["formatted"])

            val tree = rows(ds, w)
            assertEquals(3, tree.size)
            /* Stages are transfers, so the chain stays flat and a long pipeline is
               not capped by maxDepth. */
            assertTrue(tree.all { it.depth == 0 }, "depths: " + tree.map { it.depth })
            assertEquals(2, HandoffStore(ds).forRun(w.runId).size)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `review sends work to the reviewer and finishes when the worker is done`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "writer"); agent(ds, w, "reviewer")
            val llm = ScriptedLlmProvider()
                .thenAction(delegate(w["reviewer"], "review the draft"))
                .thenAction(final("verdict" to "approved"))
                .thenAction(final("document" to "the approved draft"))

            val r = executor(ds, w, llm).execute(
                node("review", listOf(
                    member(w, "writer", "worker", "reviewer"),
                    member(w, "reviewer", "reviewer"),
                ), extra = mapOf("limits" to mapOf("maxRounds" to 2, "maxDepth" to 3))),
                emptyMap(), ctx(w))

            assertTrue(r is NodeResult.Completed, r.toString())
            assertEquals("the approved draft", (r as NodeResult.Completed).output["document"])
            assertEquals(2, rows(ds, w).size)
            assertEquals("succeeded", statusOf(ds, w, "reviewer"))
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `blackboard broadcasts to its peers and any of them can answer`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "lead"); agent(ds, w, "p1"); agent(ds, w, "p2")
            val llm = ScriptedLlmProvider()
                .thenAction(broadcast(w["p1"], w["p2"]))
                .thenAction(final("view" to "p1 says yes"))
                .thenAction(final("view" to "p2 says yes"))
                .thenAction(final("consensus" to "yes"))

            val r = executor(ds, w, llm).execute(
                node("blackboard", listOf(
                    member(w, "lead", "worker", "p1", "p2"),
                    member(w, "p1", "worker"),
                    member(w, "p2", "worker"),
                )), emptyMap(), ctx(w))

            assertTrue(r is NodeResult.Completed, r.toString())
            assertEquals("yes", (r as NodeResult.Completed).output["consensus"])
            assertEquals(3, rows(ds, w).size)

            /* One join group ties the fan-out together — without it, two children
               of one broadcast are indistinguishable from two separate delegations
               that happened to be adjacent. */
            val edges = HandoffStore(ds).forRun(w.runId)
            assertEquals(2, edges.size)
            assertTrue(edges.all { it.kind == "BROADCAST" })
            assertEquals(1, edges.mapNotNull { it.joinGroupId }.toSet().size)
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Policy enforcement
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a router may not delegate, because then it is not a router`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "router"); agent(ds, w, "billing")
            val llm = ScriptedLlmProvider()
                .thenAction(delegate(w["billing"]))       // DELEGATE, not TRANSFER
                .thenActionRepeated(final("answer" to "anyway"), 6)

            executor(ds, w, llm).execute(
                node("router", listOf(
                    member(w, "router", "router", "billing"),
                    member(w, "billing", "worker"),
                )), emptyMap(), ctx(w))

            /* The permitted kinds are ENFORCEMENT, not documentation. A router
               whose specialists start delegating is a run nobody designed. */
            assertEquals(1, rows(ds, w).size, "the delegation was allowed through")
            assertTrue(HandoffStore(ds).forRun(w.runId).isEmpty())
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `canDelegateTo is per-member, so a worker cannot re-delegate upward`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "supervisor"); agent(ds, w, "worker")

            /*
             * ── THE AGENT ROW SAYS YES; THE TEAM MEMBER SAYS NOTHING ─────────
             *
             * A mutation test caught this: with the worker's row also empty, the
             * case passed whether the per-member roster was enforced or not. The
             * row now grants the worker the right to delegate to the supervisor,
             * so the ONLY thing that can stop it is the team's per-member grant —
             * which is the rule §6 actually states.
             */
            ds.connection.use { c ->
                c.prepareStatement("UPDATE agents SET can_delegate_to = ? WHERE id = ?").use {
                    it.setArray(1, c.createArrayOf("text", arrayOf(w["supervisor"].toString())))
                    it.setObject(2, w["worker"]); it.executeUpdate()
                }
            }

            val llm = ScriptedLlmProvider()
                .thenAction(delegate(w["worker"]))
                .thenAction(delegate(w["supervisor"], "you do it"))  // worker → supervisor
                .thenActionRepeated(final("answer" to "done"), 6)

            executor(ds, w, llm).execute(
                node("supervisor", listOf(
                    member(w, "supervisor", "supervisor", "worker"),
                    /* No canDelegateTo: a leaf. The cycle is caught at the ROSTER,
                       which is cheaper than the depth guard and is a sentence about
                       the design rather than about the runtime. */
                    member(w, "worker", "worker"),
                )), emptyMap(), ctx(w))

            assertEquals(2, rows(ds, w).size, "the worker re-delegated upward")
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Joins
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `wait_all with one failing child of three stops with CHILD_FAILED and keeps the survivors`() =
        runBlocking {
            val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
            val w = seed(ds!!)
            try {
                agent(ds, w, "lead"); agent(ds, w, "a"); agent(ds, w, "b"); agent(ds, w, "c")
                val llm = ScriptedLlmProvider()
                    .thenAction(broadcast(w["a"], w["b"], w["c"]))
                    .thenAction(final("from" to "a"))
                    .thenAction(fail("b has nothing"))
                    .thenActionRepeated(final("from" to "c"), 6)

                val r = executor(ds, w, llm).execute(
                    node("blackboard", listOf(
                        member(w, "lead", "worker", "a", "b", "c"),
                        member(w, "a", "worker"), member(w, "b", "worker"), member(w, "c", "worker"),
                    ), extra = mapOf("joinPolicy" to "wait_all", "onChildFailure" to "fail_parent")),
                    emptyMap(), ctx(w))

                assertTrue(r is NodeResult.Failed, r.toString())
                assertTrue((r as NodeResult.Failed).reason.contains("CHILD_FAILED"), r.reason)

                /*
                 * THE SURVIVOR'S OUTPUT IS STILL RECORDED. A join that failed still
                 * did most of its work, and throwing away a good result because a
                 * sibling failed is how a team costs three agent loops and produces
                 * nothing anyone can use.
                 */
                val a = ds.connection.use { c ->
                    c.prepareStatement("SELECT output_json::text FROM agent_activations " +
                        " WHERE run_id=? AND agent_id=?").use { st ->
                        st.setObject(1, w.runId); st.setObject(2, w["a"])
                        st.executeQuery().use { rs -> if (rs.next()) rs.getString(1) else null }
                    }
                }
                assertNotNull(a, "the surviving sibling's output was discarded")
                assertTrue(a.contains("\"a\""), a)
                assertEquals("failed", statusOf(ds, w, "b"))
            } finally { cleanup(ds!!, w) }
        }

    @Test
    fun `wait_any returns on the first success and the rest end cancelled, not failed`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "lead"); agent(ds, w, "a"); agent(ds, w, "b"); agent(ds, w, "c")
            val llm = ScriptedLlmProvider()
                .thenAction(broadcast(w["a"], w["b"], w["c"]))
                .thenAction(final("from" to "a"))
                .thenActionRepeated(final("answer" to "done"), 6)

            val r = executor(ds, w, llm).execute(
                node("blackboard", listOf(
                    member(w, "lead", "worker", "a", "b", "c"),
                    member(w, "a", "worker"), member(w, "b", "worker"), member(w, "c", "worker"),
                ), extra = mapOf("joinPolicy" to "wait_any")), emptyMap(), ctx(w))

            assertTrue(r is NodeResult.Completed, r.toString())
            assertEquals("succeeded", statusOf(ds, w, "a"))

            /*
             * CANCELLED, not failed. They were never asked to finish, and grading
             * them failed would make a working race look like two broken agents and
             * one good one — and put two spurious failures into every aggregate.
             */
            assertEquals("cancelled", statusOf(ds, w, "b"))
            assertEquals("cancelled", statusOf(ds, w, "c"))

            /* Created, so the fan-out's real width is visible. A wait_any that shows
               ONE activation hides the most interesting fact about the run. */
            assertEquals(4, rows(ds, w).size)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `quorum of 2 of 3 returns when the second succeeds`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "lead"); agent(ds, w, "a"); agent(ds, w, "b"); agent(ds, w, "c")
            val llm = ScriptedLlmProvider()
                .thenAction(broadcast(w["a"], w["b"], w["c"]))
                .thenAction(final("from" to "a"))
                .thenAction(final("from" to "b"))
                .thenActionRepeated(final("answer" to "two agree"), 6)

            val r = executor(ds, w, llm).execute(
                node("blackboard", listOf(
                    member(w, "lead", "worker", "a", "b", "c"),
                    member(w, "a", "worker"), member(w, "b", "worker"), member(w, "c", "worker"),
                ), extra = mapOf("joinPolicy" to "quorum(2)")), emptyMap(), ctx(w))

            assertTrue(r is NodeResult.Completed, r.toString())
            assertEquals("succeeded", statusOf(ds, w, "a"))
            assertEquals("succeeded", statusOf(ds, w, "b"))
            /* The third was never needed, so it was never run. */
            assertEquals("cancelled", statusOf(ds, w, "c"))
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // The tick budget
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a team that runs out of tick mid-fan-out stands down and creates no duplicates`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "lead"); agent(ds, w, "a"); agent(ds, w, "b"); agent(ds, w, "c")

            // ── Tick 1: the deadline is already past, so nothing is started.
            val first = executor(ds, w, ScriptedLlmProvider()
                .thenAction(broadcast(w["a"], w["b"], w["c"])))
                .execute(node("blackboard", listOf(
                    member(w, "lead", "worker", "a", "b", "c"),
                    member(w, "a", "worker"), member(w, "b", "worker"), member(w, "c", "worker"),
                )), emptyMap(), ctx(w, tickDeadlineAtMs = System.currentTimeMillis() - 1))

            /*
             * The existing stand-down signal, not a new one: RunProcessor parks the
             * run at `yielded` — its own comment calls that "the same state a
             * cooperative yield uses" — and the step is NOT marked complete, so the
             * node runs again.
             */
            assertTrue(first is NodeResult.Throttled, first.toString())
            assertEquals("agent_team", (first as NodeResult.Throttled).provider)
            assertEquals(0L, first.retryAfterMs, "there is nothing to wait for; our own tick ran out")

            val afterYield = rows(ds, w).size

            // ── Tick 2: unbounded, so it finishes.
            val second = executor(ds, w, ScriptedLlmProvider()
                .thenAction(broadcast(w["a"], w["b"], w["c"]))
                .thenActionRepeated(final("from" to "x"), 8))
                .execute(node("blackboard", listOf(
                    member(w, "lead", "worker", "a", "b", "c"),
                    member(w, "a", "worker"), member(w, "b", "worker"), member(w, "c", "worker"),
                )), emptyMap(), ctx(w))

            assertTrue(second is NodeResult.Completed, second.toString())

            /*
             * ── NO DUPLICATE ACTIVATIONS ────────────────────────────────────
             * The entry reattaches by its natural key and each child by its
             * contract hash, so the resumed execution continues rather than
             * starting a second team. One row per agent, at most.
             */
            val tree = rows(ds, w)
            assertTrue(tree.size >= afterYield)
            assertEquals(tree.size, tree.map { it.agent }.toSet().size,
                "a resumed team created a second activation for an agent it already had")
            assertTrue(tree.size <= 4, "activations: " + tree.size)
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Budget
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a fan-out the team cannot afford is refused before any child is created`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "lead"); agent(ds, w, "a"); agent(ds, w, "b"); agent(ds, w, "c")
            val llm = ScriptedLlmProvider()
                .thenAction(broadcast(w["a"], w["b"], w["c"]))
                .thenActionRepeated(final("answer" to "partial"), 6)

            val r = executor(ds, w, llm).execute(
                node("blackboard", listOf(
                    member(w, "lead", "worker", "a", "b", "c"),
                    member(w, "a", "worker"), member(w, "b", "worker"), member(w, "c", "worker"),
                ), extra = mapOf(
                    /* Enough for the LEAD to run and answer, but not enough for
                       three children to each make a model call — which is the case
                       the preflight is actually about. */
                    "budget" to mapOf("maxTotalTokens" to 400, "maxCostCents" to 20),
                )), emptyMap(), ctx(w))

            /*
             * ── A PARTIAL ANSWER, NOT A BARE FAILURE ────────────────────────
             * §8's completion margin is held back precisely so the lead can still
             * say what it could not do. A run that dies at BUDGET_EXCEEDED having
             * paid for the whole fan-out and produced nothing is the outcome the
             * margin exists to prevent.
             */
            assertTrue(r is NodeResult.Completed,
                (r as? NodeResult.Failed)?.reason ?: r.toString())
            /* And no child was created for a fan-out nobody could afford —
               discovering the ceiling at child three wastes the spend on two. */
            assertEquals(1, rows(ds, w).size, "children were created for an unaffordable fan-out")
        } finally { cleanup(ds!!, w) }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Metrics
    // ═════════════════════════════════════════════════════════════════════════

    @Test
    fun `a routed run leaves run-level success counting untouched`() = runBlocking {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        try {
            agent(ds, w, "router"); agent(ds, w, "billing")
            executor(ds, w, ScriptedLlmProvider()
                .thenAction(handoff(w["billing"]))
                .thenAction(final("answer" to "12")))
                .execute(node("router", listOf(
                    member(w, "router", "router", "billing"),
                    member(w, "billing", "worker"),
                )), emptyMap(), ctx(w))

            /*
             * ── WHAT ACTUALLY COUNTS SUCCESS ────────────────────────────────
             *
             * Every dashboard and metric counts `agent_runs.status`. `handed_off`
             * is an ACTIVATION status and never reaches that table, so a routed run
             * is structurally incapable of moving a success rate: the STEP
             * completed, so the RUN is whatever it would have been.
             *
             * This asserts the boundary rather than the arithmetic — nothing today
             * aggregates activation outcomes, and this is the test that fails if
             * something starts and counts `handed_off` as a failure.
             */
            assertEquals("handed_off", statusOf(ds, w, "router"))

            val runStatus = ds.connection.use { c ->
                c.prepareStatement("SELECT status FROM agent_runs WHERE id=?").use { st ->
                    st.setObject(1, w.runId)
                    st.executeQuery().use { rs -> rs.next(); rs.getString(1) }
                }
            }
            assertEquals("running", runStatus,
                "the team node must not write a run status; only the runtime does")

            val outcomes = rows(ds, w).map { it.status }.toSet()
            assertTrue(!outcomes.contains("failed"),
                "a correctly routed run produced a failed activation: $outcomes")
        } finally { cleanup(ds!!, w) }
    }
}
