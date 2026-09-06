package com.vectorbea.api.routes

import com.vectorbea.api.repository.RunRepository
import org.junit.jupiter.api.Tag
import org.junit.jupiter.api.Test
import java.time.Instant
import java.util.UUID
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The Agents tab, for a run that recorded no activations.
 *
 * ── WHY THIS PATH EXISTS ────────────────────────────────────────────────────
 * `agent_activations` is written only on the activation path, which is behind
 * `AGENT_ACTIVATIONS_ENABLED` — off by default and set in no environment file in
 * this repository. So an ordinary single-agent run has iterations and no
 * activation row, and the Agents tab used to answer that with an apology naming
 * an environment variable at somebody reading their own run.
 *
 * Everything the card shows is recorded in `agent_iterations`. These tests pin
 * that it is read rather than guessed, and that the two things which are NOT
 * recorded — the stop reason and the handoff edges — are not invented.
 */
@Tag("integration")
class DerivedConstellationTest {

    private val ds = com.vectorbea.api.testsupport.Infra.postgres
    private val routes = ConstellationRoutes(ds, RunRepository(ds))

    private class World {
        val ws: UUID = UUID.randomUUID()
        val env: UUID = UUID.randomUUID()
        val run: UUID = UUID.randomUUID()
        val wf: UUID = UUID.randomUUID()
        val ver: UUID = UUID.randomUUID()
        val agent: UUID = UUID.randomUUID()
    }

    private fun seed(w: World) {
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.ws); it.setString(2, "derived"); it.setString(3, "derived-${w.ws}")
                it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, w.env); it.setObject(2, w.ws); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, w.wf); it.setObject(2, w.ws); it.setObject(3, w.env)
                it.setString(4, "wf-${w.wf}"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, w.ver); it.setObject(2, w.wf); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id,status) " +
                "VALUES (?,?,?,?,?,'succeeded')"
            ).use {
                it.setObject(1, w.run); it.setObject(2, w.ws); it.setObject(3, w.env)
                it.setObject(4, w.wf); it.setObject(5, w.ver); it.executeUpdate()
            }
        }
    }

    private fun addAgent(w: World, id: UUID, name: String) {
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agents (id,workspace_id,environment_id,name,slug,type,status) " +
                "VALUES (?,?,?,?,?,'iterative_agent','active')"
            ).use {
                it.setObject(1, id); it.setObject(2, w.ws); it.setObject(3, w.env)
                it.setString(4, name); it.setString(5, "a-$id"); it.executeUpdate()
            }
        }
    }

    private fun addIteration(
        w: World, step: String, n: Int,
        status: String = "completed",
        agentId: UUID = w.agent,
        tokens: Int = 100,
        costCents: String = "1.00",
        atMs: Long = 0,
    ) {
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO agent_iterations
                     (id, workspace_id, environment_id, run_id, step_id, agent_id,
                      iteration_number, status, action_type, started_at, completed_at,
                      tokens_delta, cost_delta_cents)
                   VALUES (?,?,?,?,?,?,?,?,'CALL_TOOL',?,?,?,?)"""
            ).use { st ->
                val start = Instant.parse("2026-09-01T10:00:00Z").plusMillis(atMs)
                st.setObject(1, UUID.randomUUID())
                st.setObject(2, w.ws); st.setObject(3, w.env); st.setObject(4, w.run)
                st.setString(5, step); st.setObject(6, agentId)
                st.setInt(7, n); st.setString(8, status)
                st.setTimestamp(9, java.sql.Timestamp.from(start))
                st.setTimestamp(10, java.sql.Timestamp.from(start.plusMillis(1_000)))
                st.setInt(11, tokens)
                st.setBigDecimal(12, java.math.BigDecimal(costCents))
                st.executeUpdate()
            }
        }
    }

    private fun cleanup(w: World) = runCatching {
        ds.connection.use { c ->
            c.prepareStatement("DELETE FROM agent_iterations WHERE run_id=?")
                .use { it.setObject(1, w.run); it.executeUpdate() }
            c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                .use { it.setObject(1, w.ws); it.executeUpdate() }
        }
    }

    /**
     * ACCEPTANCE: a single-agent run draws its agent, named, with the numbers it
     * actually spent — with no activation row anywhere.
     */
    @Test
    fun `a run with no activations still draws its agent from the iterations`() {
        val w = World()
        try {
            seed(w)
            addAgent(w, w.agent, "Support triage")
            addIteration(w, "n-agent-1", 1, tokens = 400, costCents = "1.25", atMs = 0)
            addIteration(w, "n-agent-1", 2, tokens = 600, costCents = "2.75", atMs = 2_000)

            val node = routes.derivedNodes(w.run, w.ws).single()
            assertEquals("Support triage", node["agentName"])
            assertEquals("n-agent-1", node["stepId"])
            assertEquals("n-agent-1", node["id"], "the step is the identity — there is no activation uuid")
            assertEquals(0, node["depth"])
            assertNull(node["parentId"])
            assertEquals(2, node["iterations"])
            assertEquals(1_000L, node["tokens"])
            assertEquals(4.0, node["costCents"] as Double, 0.001)
        } finally { cleanup(w) }
    }

    /**
     * A failed step is not painted green because the RUN went green.
     *
     * The run in this fixture is `succeeded` — seeded that way — and the agent
     * step inside it failed. Reading the status from the run would colour the
     * card success, which is how a debugger loses the reader's trust.
     */
    @Test
    fun `the node status comes from the iterations, not from the run`() {
        val w = World()
        try {
            seed(w)
            addAgent(w, w.agent, "Support triage")
            addIteration(w, "n-agent-1", 1, atMs = 0)
            addIteration(w, "n-agent-1", 2, status = "failed", atMs = 2_000)

            assertEquals("error", routes.derivedNodes(w.run, w.ws).single()["status"])
        } finally { cleanup(w) }
    }

    /** A step still in flight reads as running, not as finished. */
    @Test
    fun `an open iteration makes the node running`() {
        val w = World()
        try {
            seed(w)
            addAgent(w, w.agent, "Support triage")
            addIteration(w, "n-agent-1", 1, atMs = 0)
            addIteration(w, "n-agent-1", 2, status = "running", atMs = 2_000)

            assertEquals("running", routes.derivedNodes(w.run, w.ws).single()["status"])
        } finally { cleanup(w) }
    }

    /**
     * Nothing recorded a stop reason on this path, so none is reported.
     *
     * "completed" would be a guess presented as a fact, and the card renders it
     * as though the agent had said it.
     */
    @Test
    fun `a derived node never invents a stop reason`() {
        val w = World()
        try {
            seed(w)
            addAgent(w, w.agent, "Support triage")
            addIteration(w, "n-agent-1", 1)
            assertNull(routes.derivedNodes(w.run, w.ws).single()["stopReason"])
        } finally { cleanup(w) }
    }

    /** One node per agent STEP, ordered by when each first ran. */
    @Test
    fun `a run with two agent steps draws two nodes, in execution order`() {
        val w = World()
        val second = UUID.randomUUID()
        try {
            seed(w)
            addAgent(w, w.agent, "Researcher")
            addAgent(w, second, "Writer")
            /* Inserted writer-first to prove the ordering is by TIME, not by
               insertion or by step id. */
            addIteration(w, "n-agent-2", 1, agentId = second, atMs = 60_000)
            addIteration(w, "n-agent-1", 1, agentId = w.agent, atMs = 0)

            val nodes = routes.derivedNodes(w.run, w.ws)
            assertEquals(listOf("Researcher", "Writer"), nodes.map { it["agentName"] })
        } finally { cleanup(w) }
    }

    /**
     * An agent whose row was deleted still draws — it just has no name.
     *
     * The join is LEFT for the same reason the tool-name join is: tidying up a
     * definition six weeks later must not delete the history of the runs that
     * used it.
     */
    @Test
    fun `a deleted agent still produces a node`() {
        val w = World()
        try {
            seed(w)
            addIteration(w, "n-agent-1", 1)      // no `agents` row for w.agent
            val node = routes.derivedNodes(w.run, w.ws).single()
            assertEquals("agent", node["agentName"])
            assertEquals(w.agent.toString(), node["agentId"])
        } finally { cleanup(w) }
    }

    /** Another workspace's run is not this workspace's (invariant 8). */
    @Test
    fun `derived nodes are workspace-scoped`() {
        val w = World()
        val other = World()
        try {
            seed(w); seed(other)
            addAgent(w, w.agent, "Support triage")
            addIteration(w, "n-agent-1", 1)

            assertTrue(routes.derivedNodes(w.run, other.ws).isEmpty(),
                "reading this run under another workspace must return nothing")
        } finally { cleanup(w); cleanup(other) }
    }

    /** A run with no agent step at all derives nothing, and that is correct. */
    @Test
    fun `a run with no agent steps derives no nodes`() {
        val w = World()
        try {
            seed(w)
            assertTrue(routes.derivedNodes(w.run, w.ws).isEmpty())
        } finally { cleanup(w) }
    }
}
