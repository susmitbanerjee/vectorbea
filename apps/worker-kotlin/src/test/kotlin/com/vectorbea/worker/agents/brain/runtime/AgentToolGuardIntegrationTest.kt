package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner.Companion.toolApprovalNodeId
import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner.Companion.toolGuardNodeId
import com.vectorbea.worker.durable.StepExecutionGuard
import com.vectorbea.worker.runtime.StepOutputStore
import org.junit.jupiter.api.Assumptions.assumeTrue
import org.postgresql.ds.PGSimpleDataSource
import java.util.UUID
import javax.sql.DataSource
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The tool-call idempotency guard against a real `step_executions` table.
 *
 * [AgentToolGuardKeyTest] proves the two keys are shaped correctly. This proves the
 * shape actually produces the behaviour once the keys reach Postgres: that two calls
 * with different arguments both acquire, that a repeat of one of them does not, and
 * that the stored output comes back.
 *
 * It exercises the guard and the output store directly rather than driving
 * [AgentBrainRunner.run], because the loop needs an LLM connection and a tenant pool
 * to reach a tool at all. What is asserted here is the contract the brain's
 * `executeTool` depends on, at the layer where it can actually be wrong — the unique
 * index, the status transitions and the round-trip of the stored result.
 *
 * Skips when no database is reachable, so the normal `gradle test` stays green
 * without infrastructure.
 */
class AgentToolGuardIntegrationTest {

    private val jdbcUrl = System.getenv("TEST_DATABASE_URL")
        ?: "jdbc:postgresql://127.0.0.1:15432/vectorbea?user=vectorbea&password=vectorbea"

    private val stepId = "n-agent-1"
    private val toolId = UUID.fromString("11111111-2222-3333-4444-555555555555")

    private fun dataSourceOrNull(): DataSource? = try {
        val ds = PGSimpleDataSource().apply {
            setURL(jdbcUrl); connectTimeout = 2; socketTimeout = 5
        }
        ds.connection.use { c ->
            // Both tables the guard path touches. An older schema is "not applicable"
            // rather than "failing".
            c.prepareStatement("SELECT 1 FROM step_executions LIMIT 1").use { it.executeQuery() }
            c.prepareStatement("SELECT 1 FROM step_outputs LIMIT 1").use { it.executeQuery() }
        }
        ds
    } catch (_: Exception) {
        null
    }

    /** Minimal FK chain so a step_executions row can exist. */
    private fun seedRun(ds: DataSource): Triple<UUID, UUID, UUID> {
        val ws = UUID.randomUUID(); val env = UUID.randomUUID()
        val wf = UUID.randomUUID(); val ver = UUID.randomUUID(); val run = UUID.randomUUID()
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?)").use {
                it.setObject(1, ws); it.setString(2, "toolguard-test")
                it.setString(3, "toolguard-test-$ws"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development')"
            ).use { it.setObject(1, env); it.setObject(2, ws); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) VALUES (?,?,?,'t',?,'active')"
            ).use {
                it.setObject(1, wf); it.setObject(2, ws); it.setObject(3, env)
                it.setString(4, "wf-$wf"); it.executeUpdate()
            }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}')"
            ).use { it.setObject(1, ver); it.setObject(2, wf); it.executeUpdate() }
            c.prepareStatement(
                """INSERT INTO agent_runs
                   (id,workspace_id,environment_id,workflow_id,workflow_version_id,status)
                   VALUES (?,?,?,?,?,'running')"""
            ).use {
                it.setObject(1, run); it.setObject(2, ws); it.setObject(3, env)
                it.setObject(4, wf); it.setObject(5, ver); it.executeUpdate()
            }
        }
        return Triple(ws, env, run)
    }

    private fun cleanup(ds: DataSource, ws: UUID) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM workspaces WHERE id=?").use {
                    it.setObject(1, ws); it.executeUpdate()
                }
            }
        }
    }

    /** One guarded tool call. Returns the stored output if the guard skipped it. */
    private fun call(
        guard: StepExecutionGuard, outputs: StepOutputStore,
        ws: UUID, env: UUID, run: UUID,
        args: Map<String, Any?>, result: Map<String, Any>,
        attemptGroup: Int = 0,
    ): Map<String, Any>? {
        val nodeId = toolGuardNodeId(stepId, toolId, args)
        val acq = guard.tryAcquire(run, ws, env, nodeId, attemptGroup)
        if (acq.alreadyCompleted) {
            outputs.loadRaw(run, nodeId)?.let { return it }
        }
        // "executed"
        outputs.save(run, ws, env, nodeId, "tool", result, null, null)
        guard.markCompleted(run, nodeId, attemptGroup)
        return null
    }

    @Test
    fun `two calls with different arguments both execute and keep distinct results`() {
        val ds = dataSourceOrNull()
        assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, env, run) = seedRun(ds!!)
        try {
            val guard = StepExecutionGuard(ds)
            val outputs = StepOutputStore(ds)

            val skippedA = call(guard, outputs, ws, env, run,
                mapOf("q" to "a"), mapOf("hits" to "result-for-a"))
            val skippedB = call(guard, outputs, ws, env, run,
                mapOf("q" to "b"), mapOf("hits" to "result-for-b"))

            // Neither was skipped: both are real operations.
            assertNull(skippedA, "search(a) should have executed")
            assertNull(skippedB, "search(b) should have executed")

            // And each kept its own result — this is the bug: b receiving a's output.
            assertEquals("result-for-a",
                outputs.loadRaw(run, toolGuardNodeId(stepId, toolId, mapOf("q" to "a")))?.get("hits"))
            assertEquals("result-for-b",
                outputs.loadRaw(run, toolGuardNodeId(stepId, toolId, mapOf("q" to "b")))?.get("hits"))
        } finally { cleanup(ds, ws) }
    }

    @Test
    fun `a repeat of the same call is skipped and returns the first result`() {
        val ds = dataSourceOrNull()
        assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, env, run) = seedRun(ds!!)
        try {
            val guard = StepExecutionGuard(ds)
            val outputs = StepOutputStore(ds)

            val first = call(guard, outputs, ws, env, run,
                mapOf("q" to "a"), mapOf("hits" to "first"))
            // The second call would return something different if it ran. It must not.
            val second = call(guard, outputs, ws, env, run,
                mapOf("q" to "a"), mapOf("hits" to "SECOND-EXECUTION"))

            assertNull(first, "the first call should have executed")
            assertNotNull(second, "the repeat should have been skipped")
            assertEquals("first", second["hits"])
        } finally { cleanup(ds, ws) }
    }

    @Test
    fun `re-parsed arguments still hit the same guard row`() {
        // The resume case: iteration 1 built `{"n":1}` from an Int, the resumed pass
        // reparsed the same literal to a Double. One call, one row.
        val ds = dataSourceOrNull()
        assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, env, run) = seedRun(ds!!)
        try {
            val guard = StepExecutionGuard(ds)
            val outputs = StepOutputStore(ds)

            call(guard, outputs, ws, env, run, mapOf("n" to 1, "q" to "x"), mapOf("v" to "original"))
            val replayed = call(guard, outputs, ws, env, run,
                mapOf("q" to "x", "n" to 1.0), mapOf("v" to "SHOULD-NOT-RUN"))

            assertNotNull(replayed, "the re-parsed repeat should have been skipped")
            assertEquals("original", replayed["v"])
        } finally { cleanup(ds, ws) }
    }

    @Test
    fun `a deliberate re-run executes again`() {
        // attemptGroup moves only when a human asks for the work to happen again.
        val ds = dataSourceOrNull()
        assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, env, run) = seedRun(ds!!)
        try {
            val guard = StepExecutionGuard(ds)
            val outputs = StepOutputStore(ds)

            call(guard, outputs, ws, env, run,
                mapOf("q" to "a"), mapOf("hits" to "first"), attemptGroup = 0)
            val rerun = call(guard, outputs, ws, env, run,
                mapOf("q" to "a"), mapOf("hits" to "second"), attemptGroup = 1)

            assertNull(rerun, "a new attempt group must genuinely re-run")
        } finally { cleanup(ds, ws) }
    }

    @Test
    fun `the guard key never collides with the approval key`() {
        // The approval row is filed under the bare key by ToolNodeExecutor. If the
        // guard wrote there too, the two mechanisms would overwrite each other.
        val ds = dataSourceOrNull()
        assumeTrue(ds != null, "no database reachable — skipping")
        val (ws, env, run) = seedRun(ds!!)
        try {
            val guard = StepExecutionGuard(ds)
            val outputs = StepOutputStore(ds)
            call(guard, outputs, ws, env, run, mapOf("q" to "a"), mapOf("hits" to "x"))

            ds.connection.use { c ->
                c.prepareStatement(
                    "SELECT count(*) FROM step_executions WHERE run_id=? AND node_id=?"
                ).use { st ->
                    st.setObject(1, run)
                    st.setString(2, toolApprovalNodeId(stepId, toolId))
                    st.executeQuery().use { rs ->
                        rs.next()
                        assertEquals(0, rs.getInt(1),
                            "nothing may be filed under the approval key by the guard")
                    }
                }
                c.prepareStatement(
                    "SELECT count(*) FROM step_executions WHERE run_id=? AND node_id LIKE ?"
                ).use { st ->
                    st.setObject(1, run)
                    st.setString(2, toolApprovalNodeId(stepId, toolId) + ":%")
                    st.executeQuery().use { rs ->
                        rs.next()
                        assertTrue(rs.getInt(1) >= 1, "the guard row should exist under a hashed key")
                    }
                }
            }
        } finally { cleanup(ds, ws) }
    }
}
