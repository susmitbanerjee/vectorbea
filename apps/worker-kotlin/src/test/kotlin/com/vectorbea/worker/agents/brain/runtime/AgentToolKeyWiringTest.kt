package com.vectorbea.worker.agents.brain.runtime

import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner.Companion.toolApprovalNodeId
import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner.Companion.toolGuardNodeId
import com.vectorbea.worker.testsupport.AgentBrainFixture
import kotlinx.coroutines.runBlocking
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
 * The two keys as the LOOP actually uses them.
 *
 * ── WHY THIS EXISTS ALONGSIDE THE OTHER TWO TOOL-KEY TESTS ──────────────────
 * `AgentToolGuardKeyTest` proves the derivation functions are shaped right.
 * `AgentToolGuardIntegrationTest` proves those shapes behave correctly once they
 * reach Postgres. Both compute the keys THEMSELVES and hand them to the guard —
 * so neither can see which key `AgentBrainRunner.executeTool` passes.
 *
 * That gap is not hypothetical. Swapping the call site to
 * `guardNodeId = syntheticNode.id` — reinstating the exact bug the split exists
 * to fix — leaves every one of those tests green. Mutation testing found this;
 * this test closes it.
 *
 * So this one asserts nothing about key derivation and everything about WIRING:
 * it drives the real loop against a real database and reads back which keys
 * landed in `step_executions` and `run_approvals`.
 *
 * The tool deliberately has no connection. `ToolNodeExecutor` reaches its
 * approval gate immediately after loading the tool row and before resolving
 * anything, and the idempotency guard acquires before the executor is called at
 * all — so both keys are written whether or not the tool could ever run. That is
 * what makes this testable without an HTTP endpoint or a tenant pool.
 *
 * Skips when no database is reachable.
 */
@Tag("integration")
class AgentToolKeyWiringTest {

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

    /** A tool row the executor can load. `requiresApproval` decides which gate it hits. */
    private fun seedTool(ds: DataSource, f: AgentBrainFixture, requiresApproval: Boolean) {
        ds.connection.use { c ->
            c.prepareStatement(
                """INSERT INTO tools (id, workspace_id, environment_id, name, slug, type,
                                      input_schema_json, output_schema_json, config_json,
                                      risk_level, requires_approval, retry_policy_json, status)
                   VALUES (?,?,?,?,?, 'http', '{}', '{}', '{}', 'low', ?, '{}', 'active')"""
            ).use {
                it.setObject(1, f.grantedToolId); it.setObject(2, f.workspaceId)
                it.setObject(3, f.environmentId); it.setString(4, "search")
                it.setString(5, "search-" + f.workspaceId)
                it.setBoolean(6, requiresApproval)
                it.executeUpdate()
            }
        }
    }

    private fun cleanup(ds: DataSource, f: AgentBrainFixture) {
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM tools WHERE workspace_id=?")
                    .use { it.setObject(1, f.workspaceId); it.executeUpdate() }
                c.prepareStatement("DELETE FROM workspaces WHERE id=?")
                    .use { it.setObject(1, f.workspaceId); it.executeUpdate() }
            }
        }
    }

    private fun guardNodeIds(ds: DataSource, runId: UUID): List<String> =
        ds.connection.use { c ->
            c.prepareStatement(
                "SELECT node_id FROM step_executions WHERE run_id = ? ORDER BY node_id"
            ).use { st ->
                st.setObject(1, runId)
                st.executeQuery().use { rs -> buildList { while (rs.next()) add(rs.getString(1)) } }
            }
        }

    private fun approvalNodeIds(ds: DataSource, runId: UUID): List<String> =
        ds.connection.use { c ->
            c.prepareStatement("SELECT node_id FROM run_approvals WHERE run_id = ?").use { st ->
                st.setObject(1, runId)
                st.executeQuery().use { rs -> buildList { while (rs.next()) add(rs.getString(1)) } }
            }
        }

    /**
     * Two calls to one tool with different arguments must acquire two DIFFERENT
     * guard rows, and neither under the approval key.
     *
     * This is the acceptance case — `search(a)` then `search(b)` — asserted at the
     * only layer that can catch the call site using the wrong key.
     */
    @Test
    fun `the loop guards each call under its own argument-hashed key`() = runBlocking {
        val ds = dsOrNull()
        assumeTrue(ds != null, "no database reachable — skipping")
        val f = AgentBrainFixture(dataSource = ds,
            dbPoolManager = com.vectorbea.worker.connector.pool.ClientDbPoolManager())
        try {
            f.seed()
            seedTool(ds!!, f, requiresApproval = false)

            f.llm.thenAction("""{"type":"CALL_TOOL","toolId":"${f.grantedToolId}","toolInput":{"q":"a"}}""")
                .thenAction("""{"type":"CALL_TOOL","toolId":"${f.grantedToolId}","toolInput":{"q":"b"}}""")
                .thenAction("""{"type":"FINAL","finalOutput":{"answer":"done"}}""")

            f.runner().run(f.config(maxIterations = 4), f.runtimeContext())

            val rows = guardNodeIds(ds, f.runId)
            val approvalKey = toolApprovalNodeId(f.stepId, f.grantedToolId)

            assertEquals(2, rows.size,
                "search(a) and search(b) are two operations and need two guard rows; got $rows")
            assertEquals(
                listOf(
                    toolGuardNodeId(f.stepId, f.grantedToolId, mapOf("q" to "a")),
                    toolGuardNodeId(f.stepId, f.grantedToolId, mapOf("q" to "b")),
                ).sorted(),
                rows.sorted(),
                "the guard must key on the arguments the model actually sent")
            assertFalse(rows.any { it == approvalKey },
                "the loop must never guard under the approval key — that is the bug")

            /* Two DIFFERENT calls are two operations. A STEP_SKIPPED here would
               mean the guard collapsed them, which is the original bug. */
            assertTrue(f.events.events.none {
                it.type == com.vectorbea.worker.events.RunEventStore.EventType.STEP_SKIPPED
            }, "search(a) and search(b) are distinct calls — neither may be skipped")
        } finally {
            cleanup(ds!!, f)
        }
    }

    /** The same call twice acquires ONE row: the repeat is deduplicated. */
    @Test
    fun `the loop reuses one guard row for an identical repeat`() = runBlocking {
        val ds = dsOrNull()
        assumeTrue(ds != null, "no database reachable — skipping")
        val f = AgentBrainFixture(dataSource = ds,
            dbPoolManager = com.vectorbea.worker.connector.pool.ClientDbPoolManager())
        try {
            f.seed()
            seedTool(ds!!, f, requiresApproval = false)

            val call = """{"type":"CALL_TOOL","toolId":"${f.grantedToolId}","toolInput":{"q":"a"}}"""
            f.llm.thenAction(call).thenAction(call)
                .thenAction("""{"type":"FINAL","finalOutput":{"answer":"done"}}""")

            f.runner().run(f.config(maxIterations = 4), f.runtimeContext())

            assertEquals(
                listOf(toolGuardNodeId(f.stepId, f.grantedToolId, mapOf("q" to "a"))),
                guardNodeIds(ds, f.runId),
                "an identical repeat is the same operation and must share one row")
        } finally {
            cleanup(ds!!, f)
        }
    }

    /**
     * S7 — a call that already ran is skipped, and the timeline says so.
     *
     * ── WHY THE GUARD ROW IS PRE-SEEDED ─────────────────────────────────────
     * The skip only fires when a PREVIOUS execution succeeded and stored its
     * output: a failed call deliberately leaves its row `running` so the resume
     * calls the tool again. Seeding a completed row with a stored result is
     * exactly the state an earlier tick leaves behind, and it is the state the
     * guard exists for — the agent step replays from iteration 1 on resume, so
     * without this the email sent before the approval gate is sent again.
     *
     * The acceptance criterion is both halves: the cached result comes back AND
     * `STEP_SKIPPED` is emitted. Only the first was asserted before; without the
     * event a reader sees one tool call where the agent made two, with no way to
     * tell whether the second was skipped or never attempted.
     */
    @Test
    fun `a call that already ran is skipped and the timeline says so`() = runBlocking {
        val ds = dsOrNull(); assumeTrue(ds != null, "no database reachable — skipping"); ds!!
        val f = AgentBrainFixture(dataSource = ds,
            dbPoolManager = com.vectorbea.worker.connector.pool.ClientDbPoolManager())
        try {
            f.seed()
            seedTool(ds, f, requiresApproval = false)

            val args = mapOf<String, Any>("q" to "a")
            val guardKey = toolGuardNodeId(f.stepId, f.grantedToolId, args)

            /* What the earlier tick left: a completed guard row and its output. */
            val guard = com.vectorbea.worker.durable.StepExecutionGuard(ds)
            val outputs = com.vectorbea.worker.runtime.StepOutputStore(ds)
            guard.tryAcquire(f.runId, f.workspaceId, f.environmentId, guardKey, 0)
            outputs.save(f.runId, f.workspaceId, f.environmentId, guardKey, "tool",
                mapOf("hits" to "from-the-first-tick"), null, null)
            guard.markCompleted(f.runId, guardKey, 0)

            f.llm.thenAction(
                """{"type":"CALL_TOOL","toolId":"${f.grantedToolId}","toolInput":{"q":"a"}}""")
                .thenAction("""{"type":"FINAL","finalOutput":{"answer":"done"}}""")

            f.runner().run(f.config(maxIterations = 3), f.runtimeContext())

            val skipped = f.events.events.filter {
                it.type == com.vectorbea.worker.events.RunEventStore.EventType.STEP_SKIPPED
            }
            assertEquals(1, skipped.size, "the repeat must emit exactly one STEP_SKIPPED")
            assertEquals(f.stepId, skipped.single().stepId,
                "filed against the step id — an event on the argument-hashed guard key " +
                "resolves to no step on any screen")
            assertTrue(skipped.single().summary!!.contains(f.grantedToolId.toString()),
                "the summary must name the tool that was skipped")

            /* And the stored result really came back, rather than the tool running
               again and failing (it has no connection, so a real call fails). */
            assertTrue(f.llm.requests().any { it.userPrompt?.contains("from-the-first-tick") == true },
                "the cached output must reach the model's next prompt")
        } finally { cleanup(ds, f) }
    }

    /**
     * The gate opens under the BARE key, whatever the arguments were.
     *
     * The mutation that motivated this test opened the approval under the
     * argument-hashed key. Everything would look fine on the first pass — a gate
     * appears, a person approves it — and the resumed step, having re-derived its
     * arguments, would ask again under a different name. Forever.
     */
    @Test
    fun `the loop opens the approval gate under the bare tool key`() = runBlocking {
        val ds = dsOrNull()
        assumeTrue(ds != null, "no database reachable — skipping")
        val f = AgentBrainFixture(dataSource = ds,
            dbPoolManager = com.vectorbea.worker.connector.pool.ClientDbPoolManager())
        try {
            f.seed()
            seedTool(ds!!, f, requiresApproval = true)

            f.llm.thenAction(
                """{"type":"CALL_TOOL","toolId":"${f.grantedToolId}","toolInput":{"q":"a","limit":10}}""")
                .thenAction("""{"type":"FINAL","finalOutput":{"answer":"done"}}""")

            f.runner().run(f.config(maxIterations = 3), f.runtimeContext())

            val approvals = approvalNodeIds(ds, f.runId)
            assertEquals(listOf(toolApprovalNodeId(f.stepId, f.grantedToolId)), approvals,
                "one gate, keyed on (step, tool) and nothing else")
            assertTrue(approvals.single().count { it == ':' } == 2,
                "the approval key must carry no argument hash: ${approvals.single()}")
        } finally {
            cleanup(ds!!, f)
        }
    }
}
