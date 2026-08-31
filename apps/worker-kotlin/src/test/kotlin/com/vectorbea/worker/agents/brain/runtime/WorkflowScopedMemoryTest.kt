package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.postgresql.ds.PGSimpleDataSource
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import org.junit.jupiter.api.Tag

/**
 * Workflow-scoped memory: in the schema since V010, unimplemented until V043,
 * and dangerous the moment it works.
 *
 * ── WHAT THESE TESTS ARE ACTUALLY GUARDING ──────────────────────────────────
 * The feature is easy; the limits are the hard part and the reason it was never
 * shipped. Memory that outlives its run is an unbounded prompt-growth vector:
 * every run adds entries, every subsequent run reads them into a prompt, and
 * the failure arrives slowly, in production, on whichever workflows are used
 * most. So the assertions below are mostly about the ceiling, the upsert and the
 * TTL rather than about storing and reading a value.
 *
 * Skips when no database is reachable.
 */
@Tag("integration")
class WorkflowScopedMemoryTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

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
        val agentId: UUID = UUID.randomUUID(),
    ) {
        val runIds = mutableListOf<UUID>()
    }

    private fun seed(ds: DataSource): World {
        val w = World()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, w.workspaceId); it.setString(2, "mem-test")
                it.setString(3, "mem-test-" + w.workspaceId); it.executeUpdate()
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
        }
        return w
    }

    private fun newRun(ds: DataSource, w: World): UUID {
        val runId = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement(
                "INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id,status) " +
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
                /* Workflow memory deliberately survives its run, so the run cascade
                   does not take it — delete it explicitly. */
                c.prepareStatement("DELETE FROM agent_memory_entries WHERE workflow_id=?")
                    .use { it.setObject(1, w.workflowId); it.executeUpdate() }
                c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                    .use { it.setObject(1, w.workspaceId); it.executeUpdate() }
            }
        }
    }

    private fun config(w: World, runId: UUID) = AgentBrainConfig(
        agentId = w.agentId,
        workspaceId = w.workspaceId,
        environmentId = w.environmentId,
        runId = runId,
        stepId = "n-agent-1",
        agentName = "memo",
        role = null,
        instructions = "remember things",
        llmConnectionId = UUID.randomUUID(),
        modelName = "gpt-4o-mini",
    )

    private fun rowCount(ds: DataSource, w: World): Int = ds.connection.use { c ->
        c.prepareStatement(
            "SELECT count(*) FROM agent_memory_entries WHERE workflow_id=? AND memory_scope='workflow_scoped'"
        ).use { st -> st.setObject(1, w.workflowId); st.executeQuery().use { rs -> rs.next(); rs.getInt(1) } }
    }

    // ── The feature ──────────────────────────────────────────────────────────

    @Test
    fun `a fact written on one run is recalled on the next`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val store = AgentMemoryStore(ds, workflowMemoryEnabled = true)
        try {
            val firstRun = newRun(ds, w)
            store.persistWorkflowScoped(config(w, firstRun), w.workflowId, "customer.timezone", "Asia/Kolkata")

            /* A DIFFERENT run of the same workflow. This is the whole feature: the
               difference between an agent that learns and one that starts cold. */
            newRun(ds, w)
            val recalled = store.loadWorkflow(w.workspaceId, w.workflowId, w.agentId)
            assertEquals("Asia/Kolkata", recalled["customer.timezone"])
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `memory survives the deletion of the run that wrote it`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val store = AgentMemoryStore(ds, workflowMemoryEnabled = true)
        try {
            val runId = newRun(ds, w)
            store.persistWorkflowScoped(config(w, runId), w.workflowId, "k", "v")

            /* Retention prunes old runs. The FK was ON DELETE CASCADE, which would
               have taken the learning with it — the feature would appear to work
               and then quietly forget, which is worse than not shipping it. */
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM agent_runs WHERE id=?")
                    .use { it.setObject(1, runId); it.executeUpdate() }
            }

            assertEquals("v", store.loadWorkflow(w.workspaceId, w.workflowId, w.agentId)["k"])
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `run-scoped recall does not pick up workflow-scoped rows`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val store = AgentMemoryStore(ds, workflowMemoryEnabled = true)
        try {
            val runId = newRun(ds, w)
            store.persist(config(w, runId), "run.note", "this run only")
            store.persistWorkflowScoped(config(w, runId), w.workflowId, "wf.note", "every run")

            /* Two scopes, two recalls. Letting workflow rows leak into the run
               recall would double every long-lived fact in the prompt. */
            val runMemory = store.load(runId, w.agentId)
            assertEquals(setOf("run.note"), runMemory.keys)
            assertEquals(setOf("wf.note"), store.loadWorkflow(w.workspaceId, w.workflowId, w.agentId).keys)
        } finally { cleanup(ds!!, w) }
    }

    // ── The limits, which are the reason it took this long to ship ───────────

    @Test
    fun `the flag off writes nothing and recalls nothing`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val off = AgentMemoryStore(ds, workflowMemoryEnabled = false)
        try {
            val runId = newRun(ds, w)
            off.persistWorkflowScoped(config(w, runId), w.workflowId, "k", "v")

            assertEquals(0, rowCount(ds, w))
            assertTrue(off.loadWorkflow(w.workspaceId, w.workflowId, w.agentId).isEmpty())

            /* And with the flag ON there is still nothing to read — the write never
               happened, rather than happening and being hidden. */
            val on = AgentMemoryStore(ds, workflowMemoryEnabled = true)
            assertTrue(on.loadWorkflow(w.workspaceId, w.workflowId, w.agentId).isEmpty())
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `one key is one row however many runs write it`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val store = AgentMemoryStore(ds, workflowMemoryEnabled = true)
        try {
            /* Run memory is a transcript and appends. A workflow FACT must not:
               an agent recording `customer.timezone` on every run would otherwise
               accumulate a row per run forever, and the recall would read all of
               them. `uq_agent_memory_workflow_key` enforces it in the database so
               a buggy writer cannot opt out. */
            repeat(5) { n ->
                store.persistWorkflowScoped(config(w, newRun(ds, w)), w.workflowId, "tz", "zone-$n")
            }

            assertEquals(1, rowCount(ds, w))
            assertEquals("zone-4", store.loadWorkflow(w.workspaceId, w.workflowId, w.agentId)["tz"],
                "the newest write wins — a fact is current, not historical")
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `the entry cap keeps the newest and drops the rest`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val store = AgentMemoryStore(ds, workflowMemoryEnabled = true, workflowMemoryMaxEntries = 5)
        try {
            val runId = newRun(ds, w)
            /* Distinct keys, so the upsert does not collapse them — this is the
               other growth axis, and the one a unique constraint cannot bound. */
            repeat(12) { n -> store.persistWorkflowScoped(config(w, runId), w.workflowId, "fact-$n", "v$n") }

            assertEquals(5, rowCount(ds, w),
                "enforced at WRITE time, not on a schedule: a nightly job leaves a " +
                "workflow that runs every minute unbounded for a day, which is the " +
                "whole problem")

            val keys = store.loadWorkflow(w.workspaceId, w.workflowId, w.agentId, limit = 50).keys
            assertTrue(keys.contains("fact-11"), "the newest must survive")
            assertFalse(keys.contains("fact-0"), "the oldest must not")
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `expired memory is neither recalled nor kept`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val store = AgentMemoryStore(ds, workflowMemoryEnabled = true)
        try {
            val runId = newRun(ds, w)
            store.persistWorkflowScoped(config(w, runId), w.workflowId, "stale", "old news")
            store.persistWorkflowScoped(config(w, runId), w.workflowId, "fresh", "current")

            /* Age one of them past its TTL, the way 30 days of wall clock would. */
            ds.connection.use { c ->
                c.prepareStatement(
                    "UPDATE agent_memory_entries SET expires_at = now() - interval '1 day' " +
                    "WHERE workflow_id=? AND key='stale'"
                ).use { it.setObject(1, w.workflowId); it.executeUpdate() }
            }

            /* Filtered at READ as well as swept, so a lapsed sweep degrades to a
               larger table rather than to stale facts in a prompt. */
            assertEquals(setOf("fresh"), store.loadWorkflow(w.workspaceId, w.workflowId, w.agentId).keys)
            assertEquals(2, rowCount(ds, w), "not yet swept")

            assertTrue(store.pruneExpired() >= 1)
            assertEquals(1, rowCount(ds, w))
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `a write stamps a TTL`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val store = AgentMemoryStore(ds, workflowMemoryEnabled = true, workflowMemoryRetentionDays = 7)
        try {
            store.persistWorkflowScoped(config(w, newRun(ds, w)), w.workflowId, "k", "v")

            val days = ds.connection.use { c ->
                c.prepareStatement(
                    "SELECT EXTRACT(DAY FROM (expires_at - now()))::int FROM agent_memory_entries " +
                    "WHERE workflow_id=? AND key='k'"
                ).use { st -> st.setObject(1, w.workflowId); st.executeQuery().use { rs -> rs.next(); rs.getInt(1) } }
            }
            /* A row with no expiry is the unbounded case this feature exists to
               avoid, so the TTL is stamped by the writer rather than backfilled. */
            assertEquals(6, days, "7 days out, minus the sliver already elapsed")
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `the recall limit bounds the prompt, not the table`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val store = AgentMemoryStore(ds, workflowMemoryEnabled = true, workflowMemoryMaxEntries = 40)
        try {
            val runId = newRun(ds, w)
            repeat(30) { n -> store.persistWorkflowScoped(config(w, runId), w.workflowId, "k$n", "v$n") }

            assertEquals(30, rowCount(ds, w))
            /* The storage cap and the recall limit are different numbers on
               purpose: the cap bounds what the table holds, this bounds what the
               PROMPT holds, and the prompt is the thing that breaks. */
            assertEquals(10, store.loadWorkflow(w.workspaceId, w.workflowId, w.agentId, limit = 10).size)
        } finally { cleanup(ds!!, w) }
    }

    @Test
    fun `no workflow id means no workflow memory, not a crash`() {
        val ds = dataSourceOrNull(); assumeTrue(ds != null, "no database")
        val w = seed(ds!!)
        val store = AgentMemoryStore(ds, workflowMemoryEnabled = true)
        try {
            store.persistWorkflowScoped(config(w, newRun(ds, w)), null, "k", "v")
            assertEquals(0, rowCount(ds, w))
            assertTrue(store.loadWorkflow(w.workspaceId, null, w.agentId).isEmpty())
        } finally { cleanup(ds!!, w) }
    }
}
