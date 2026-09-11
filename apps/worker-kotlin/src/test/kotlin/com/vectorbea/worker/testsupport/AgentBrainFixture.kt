package com.vectorbea.worker.testsupport

import com.vectorbea.worker.agents.brain.model.AgentBrainConfig
import com.vectorbea.worker.agents.brain.runtime.AgentBrainRunner
import com.vectorbea.worker.runtime.checkpoint.ApprovalRow
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.graph.RuntimeContext
import com.vectorbea.graph.WorkflowGraph
import java.util.UUID

/**
 * A minimal runnable agent: one workspace, one agent, one granted tool, one run.
 *
 * NO DATABASE, DELIBERATELY — read this before reaching for testcontainers.
 * `AgentBrainRunner` accepts a null `dataSource`, documented as the shape used
 * where there is no persistence, and under it the loop still does everything these
 * tests assert on: prompt assembly, the provider call, action parsing, the safety
 * and budget guards, every stop reason, and the event stream. What a null
 * DataSource turns off is iteration persistence and memory recall — storage, not
 * decisions.
 *
 * Testcontainers was considered and rejected against the stated constraints: it
 * adds a dependency (the repo asks before adding any), needs a running Docker
 * daemon, pulls an image over the network on a cold cache, and costs seconds of
 * startup per class. This fixture builds in microseconds and cannot touch a
 * network. Where a test genuinely needs Postgres, the repo's existing convention
 * is `assumeTrue` + skip — see `AgentToolGuardIntegrationTest`.
 *
 * The approval gate is the one collaborator that needs real behaviour rather than
 * absence, so [FakeApprovalStore] gives it an in-memory `run_approvals`.
 */
class AgentBrainFixture(
    val llm: ScriptedLlmProvider = ScriptedLlmProvider(),
    val events: RecordingEventStore = RecordingEventStore(),
    val approvals: FakeApprovalStore = FakeApprovalStore(),
    /**
     * A real database, for the tests that exercise persistence.
     *
     * Null keeps the no-persistence shape most loop tests want. Non-null turns on
     * iteration persistence and therefore loop reconstruction, which cannot be
     * tested against a stub: the whole feature is "what survived the process".
     */
    val dataSource: javax.sql.DataSource? = null,
    /** Mirrors AGENT_LOOP_RECONSTRUCTION_ENABLED without touching process env. */
    val reconstructionEnabled: Boolean = false,
    /** Mirrors AGENT_CONTEXT_ASSEMBLY_ENABLED. §12.5's budget only bites when on. */
    val contextAssemblyEnabled: Boolean = false,
    /**
     * Lets the loop build a real `ToolNodeExecutor`.
     *
     * `AgentBrainRunner.toolExecutor` needs BOTH a DataSource and a pool manager;
     * with either null it returns "Tool execution is not available on this worker"
     * and the tool path is never entered — which is the right default for the loop
     * tests, and useless for one that needs to see which key the guard acquired.
     * An empty manager is enough: a tool that stops at its approval gate, or that
     * fails to resolve a connection, still passes through the guard first.
     */
    val dbPoolManager: com.vectorbea.worker.connector.pool.ClientDbPoolManager? = null,
    /** The team's bounds, including §12.5's maxContextChars. */
    val teamLimits: com.vectorbea.worker.agents.orchestration.TeamLimits =
        com.vectorbea.worker.agents.orchestration.TeamLimits(),
) {
    /* Random per fixture: the DB-backed tests insert real rows, and fixed ids would
       make two tests in one JVM collide on the primary key. */
    val workspaceId   : UUID = UUID.randomUUID()
    val environmentId : UUID = UUID.randomUUID()
    val agentId       : UUID = UUID.randomUUID()
    val connectionId  : UUID = UUID.randomUUID()
    val versionId     : UUID = UUID.randomUUID()
    val workflowId    : UUID = UUID.randomUUID()

    /** Fresh per fixture: approval keys are (runId, nodeId), so tests must not share one. */
    val runId: UUID = UUID.randomUUID()

    /** The tool the agent IS allowed to call. */
    val grantedToolId: UUID = UUID.fromString("00000000-0000-4000-8000-0000000000a1")

    /** A tool that exists in the workspace but is NOT in this agent's grant list. */
    val ungrantedToolId: UUID = UUID.fromString("00000000-0000-4000-8000-0000000000a2")

    val stepId = "n-agent-1"

    fun config(
        maxIterations: Int = 5,
        maxToolCalls: Int = 5,
        outputSchemaJson: String = "{}",
        allowedToolIds: Set<UUID> = setOf(grantedToolId),
        taskInstruction: String = "Answer the question.",
    ) = AgentBrainConfig(
        agentId          = agentId,
        workspaceId      = workspaceId,
        environmentId    = environmentId,
        runId            = runId,
        stepId           = stepId,
        agentName        = "test-agent",
        role             = "tester",
        instructions     = "You are a test agent.",
        llmConnectionId  = connectionId,
        modelName        = "gpt-4o-mini",
        maxIterations    = maxIterations,
        maxToolCalls     = maxToolCalls,
        allowedToolIds   = allowedToolIds,
        outputSchemaJson = outputSchemaJson,
        taskInstruction  = taskInstruction,
    )

    fun runtimeContext() = RuntimeContext(
        runId             = runId,
        workspaceId       = workspaceId,
        environmentId     = environmentId,
        workflowVersionId = versionId,
        workflowInput     = emptyMap(),
        // One agent node — the single-node graph the brain is invoked under.
        graph             = WorkflowGraph(),
    )

    /**
     * The runner under test.
     *
     * `dataSource = null` and `dbPoolManager = null` are the documented no-persistence
     * shape. Everything else is the production object graph.
     */
    fun runner(
        /**
         * The agent's skills. Defaults to a loader with no data source, which
         * composes nothing — so every test written before skills existed still
         * builds the prompt it always built.
         */
        skillLoader: com.vectorbea.worker.agents.skills.SkillLoader =
            com.vectorbea.worker.agents.skills.SkillLoader(dataSource, enabled = false),
    ) = AgentBrainRunner(
        dataSource         = dataSource,
        eventStore         = events,
        connectionResolver = stubLlmResolver(workspaceId, environmentId),
        dbPoolManager      = dbPoolManager,
        approvalStore      = approvals,
        llmHttpClient      = llm,
        payloadStore       = dataSource?.let {
            com.vectorbea.worker.events.PayloadStore(it) { 7 }
        },
        reconstructionEnabled = reconstructionEnabled,
        teamLimits            = teamLimits,
        contextAssemblyEnabled = contextAssemblyEnabled,
        skillLoader           = skillLoader,
        skillRecorder         =
            com.vectorbea.worker.agents.skills.ActivationSkillRecorder(dataSource),
    )

    /**
     * The context a RESUME_RUN would build — the only job type that reconstructs.
     *
     * @param allowReconstruction false models START_RUN, RETRY_NODE and REPLAY_RUN,
     *        all of which must replay from iteration 1.
     */
    fun resumeContext(allowReconstruction: Boolean = true) = RuntimeContext(
        runId             = runId,
        workspaceId       = workspaceId,
        environmentId     = environmentId,
        workflowVersionId = versionId,
        workflowInput     = emptyMap(),
        graph             = WorkflowGraph(),
        allowLoopReconstruction = allowReconstruction,
    )

    /**
     * A REPLAY FROM ITERATION N: restore 1..N-1, run live from N.
     *
     * Deliberately does not set `allowLoopReconstruction` — a replay request is
     * its own permission, and passing both would hide whether the bound alone is
     * enough to reach the reconstruction path.
     */
    fun replayContext(fromIteration: Int) = RuntimeContext(
        runId             = runId,
        workspaceId       = workspaceId,
        environmentId     = environmentId,
        workflowVersionId = versionId,
        workflowInput     = emptyMap(),
        graph             = WorkflowGraph(),
        replayFromIteration = fromIteration,
    )

    /** Iteration rows on file for this (run, step). */
    fun iterationCount(): Int = dataSource!!.connection.use { c ->
        c.prepareStatement(
            "SELECT count(*) FROM agent_iterations WHERE run_id=? AND step_id=?"
        ).use { st ->
            st.setObject(1, runId); st.setString(2, stepId)
            st.executeQuery().use { rs -> rs.next(); rs.getInt(1) }
        }
    }

    /** Wipe the transcript, to model the rows being lost mid-flight. */
    fun deleteIterations(): Int = dataSource!!.connection.use { c ->
        c.prepareStatement("DELETE FROM agent_iterations WHERE run_id=? AND step_id=?").use { st ->
            st.setObject(1, runId); st.setString(2, stepId)
            st.executeUpdate()
        }
    }

    /**
     * Blank the V040 columns, leaving rows shaped as the previous build wrote them.
     * This is how an in-flight run written before the migration is modelled.
     */
    fun degradeIterationsToPreV040(): Int = dataSource!!.connection.use { c ->
        c.prepareStatement(
            """UPDATE agent_iterations
                  SET action_json_sanitized=NULL, observation_success=NULL,
                      observation_payload_ref=NULL, tool_result_ref=NULL,
                      tokens_delta=NULL, cost_delta_cents=NULL, tool_calls_delta=0
                WHERE run_id=? AND step_id=?"""
        ).use { st ->
            st.setObject(1, runId); st.setString(2, stepId)
            st.executeUpdate()
        }
    }

    /** Seed the FK chain agent_iterations needs: workspace → env → workflow → version → run. */
    fun seed() {
        val ds = dataSource ?: return
        ds.connection.use { c ->
            c.prepareStatement("INSERT INTO workspaces (id,name,slug) VALUES (?,?,?) ON CONFLICT DO NOTHING")
                .use { it.setObject(1, workspaceId); it.setString(2, "brain-test")
                       it.setString(3, "brain-test-$workspaceId"); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO environments (id,workspace_id,name,slug,type) VALUES (?,?,'t','t','development') ON CONFLICT DO NOTHING")
                .use { it.setObject(1, environmentId); it.setObject(2, workspaceId); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflows (id,workspace_id,environment_id,name,slug,status) VALUES (?,?,?,'t',?,'active') ON CONFLICT DO NOTHING")
                .use { it.setObject(1, workflowId); it.setObject(2, workspaceId)
                       it.setObject(3, environmentId); it.setString(4, "wf-$workflowId"); it.executeUpdate() }
            c.prepareStatement(
                "INSERT INTO workflow_versions (id,workflow_id,version,graph_json) VALUES (?,?,1,'{}') ON CONFLICT DO NOTHING")
                .use { it.setObject(1, versionId); it.setObject(2, workflowId); it.executeUpdate() }
            c.prepareStatement(
                """INSERT INTO agent_runs (id,workspace_id,environment_id,workflow_id,workflow_version_id,status)
                   VALUES (?,?,?,?,?,'running') ON CONFLICT DO NOTHING""")
                .use { it.setObject(1, runId); it.setObject(2, workspaceId); it.setObject(3, environmentId)
                       it.setObject(4, workflowId); it.setObject(5, versionId); it.executeUpdate() }
        }
    }

    /** Remove everything this fixture seeded. */
    fun cleanup() {
        val ds = dataSource ?: return
        runCatching {
            ds.connection.use { c ->
                c.prepareStatement("DELETE FROM workspaces WHERE id=?").use {
                    it.setObject(1, workspaceId); it.executeUpdate()
                }
            }
        }
    }
}

/**
 * An in-memory `run_approvals`.
 *
 * Only the two methods the brain uses are overridden; both are `open` on the real
 * store. Keyed `(runId, nodeId)` exactly as the real one is, so a test can prove the
 * resumed lookup finds the row under the SAME key.
 */
class FakeApprovalStore : ApprovalStore(noOpDataSource()) {

    private val rows = linkedMapOf<Pair<UUID, String>, ApprovalRow>()

    /** Every key a gate was ever opened under — to prove a resume did not open a second. */
    val createdKeys = mutableListOf<String>()

    override fun findApproval(runId: UUID, nodeId: String): ApprovalRow? = rows[runId to nodeId]

    override fun createPendingApproval(
        runId: UUID,
        workspaceId: UUID,
        environmentId: UUID,
        nodeId: String,
        message: String,
        approvers: List<String>,
        resolvedInputs: Map<String, Any>,
        gate: com.vectorbea.worker.runtime.checkpoint.ApprovalGateConfig,
    ): String {
        val id = UUID.randomUUID()
        rows[runId to nodeId] = ApprovalRow(
            id = id, runId = runId, nodeId = nodeId,
            status = "PENDING", message = message, resolvedBy = null,
        )
        createdKeys.add(nodeId)
        return id.toString()
    }

    /** Simulate a human decision, the way the API's decideApproval does. */
    fun decide(runId: UUID, nodeId: String, status: String, by: String = "tester") {
        val existing = rows[runId to nodeId]
            ?: error("no approval on file for ($runId, $nodeId) — nothing to decide")
        rows[runId to nodeId] = existing.copy(status = status, resolvedBy = by)
    }

    fun statusOf(runId: UUID, nodeId: String): String? = rows[runId to nodeId]?.status
    fun count(): Int = rows.size
}
