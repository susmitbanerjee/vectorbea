package com.vectorbea.worker.runtime

import kotlinx.coroutines.runBlocking

import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.runtime.checkpoint.ApprovalGateConfig
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.checkpoint.CheckpointStore
import com.vectorbea.worker.runtime.graph.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.UUID

/**
 * Tests for [WorkflowRuntime.resume] and cancellation support.
 *
 * All tests use in-memory stubs — no real DB or Redis required.
 */
class WorkflowRuntimeResumeTest {

    // ── Stubs ─────────────────────────────────────────────────────────────────

    private val capturedEvents = mutableListOf<RunEvent>()

    private val stubEventStore = object : RunEventStore(noopDataSource(), noopPubSub()) {
        override fun appendEvent(event: RunEvent): Int {
            capturedEvents.add(event)
            return capturedEvents.size
        }
    }

    private val stubCheckpointStore = object : CheckpointStore(noopDataSource()) {
        override fun save(
            runId: UUID, workspaceId: UUID, environmentId: UUID,
            nodeId: String, snapshot: RuntimeSnapshot,
        ): UUID = UUID.randomUUID()
    }

    private val stubApprovalStore = object : ApprovalStore(noopDataSource()) {
        override fun createPendingApproval(
            runId: UUID, workspaceId: UUID, environmentId: UUID,
            nodeId: String, message: String, approvers: List<String>,
            resolvedInputs: Map<String, Any>,
            gate: ApprovalGateConfig,
        ): String = UUID.randomUUID().toString()
    }

    private val stubStepOutputStore = object : StepOutputStore(noopDataSource()) {
        override fun save(
            runId: UUID, workspaceId: UUID, environmentId: UUID,
            nodeId: String, nodeType: String,
            rawOutput: Map<String, Any>?, extractedOutput: Map<String, Any>?,
            validatedOutput: Map<String, Any>?, validationErrors: List<String>,
        ) { /* no-op */ }

        // Returns empty map — sufficient for resume tests that just check node execution
        override fun loadRaw(runId: UUID, nodeId: String): Map<String, Any>? = null
    }

    private suspend fun runtime() = WorkflowRuntime(
        dataSource      = noopDataSource(),
        eventStore      = stubEventStore,
        checkpointStore = stubCheckpointStore,
        approvalStore   = stubApprovalStore,
        stepOutputStore = stubStepOutputStore,
        workerId        = "test-worker",
    )

    // ── Helpers ───────────────────────────────────────────────────────────────

    private suspend fun node(id: String, type: NodeType, config: Map<String, Any> = emptyMap()) =
        WorkflowNode(id = id, type = type.value, config = config)

    private suspend fun edge(id: String, from: String, to: String) =
        WorkflowEdge(id = id, source = from, target = to, type = EdgeType.DEFAULT.value)

    private suspend fun runIds() = Triple(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID())

    private suspend fun resume(
        graph: WorkflowGraph,
        snapshot: RuntimeSnapshot,
        pendingNodeIds: Set<String> = emptySet(),
        cancellationCheck: () -> Boolean = { false },
    ): WorkflowRuntime.ExecutionResult {
        capturedEvents.clear()
        val (runId, wsId, envId) = runIds()
        return runtime().resume(
            runId             = runId,
            workspaceId       = wsId,
            environmentId     = envId,
            workflowVersionId = UUID.randomUUID(),
            graph             = graph,
            inputJson         = "{}",
            snapshot          = snapshot,
            pendingNodeIds    = pendingNodeIds,
            cancellationCheck = cancellationCheck,
        )
    }

    private suspend fun execute(
        graph: WorkflowGraph,
        cancellationCheck: () -> Boolean = { false },
    ): WorkflowRuntime.ExecutionResult {
        capturedEvents.clear()
        val (runId, wsId, envId) = runIds()
        return runtime().execute(
            runId             = runId,
            workspaceId       = wsId,
            environmentId     = envId,
            workflowVersionId = UUID.randomUUID(),
            graph             = graph,
            inputJson         = "{}",
            cancellationCheck = cancellationCheck,
        )
    }

    // ── Resume with all-completed snapshot skips to END ───────────────────────

    @Test
    fun `resume with completed trigger and transform executes only END`(): Unit = runBlocking {
        val trigger   = node("t1", NodeType.TRIGGER)
        val transform = node("n1", NodeType.TRANSFORM)
        val end       = node("e1", NodeType.END)
        val graph = WorkflowGraph(
            nodes = listOf(trigger, transform, end),
            edges = listOf(edge("e1", "t1", "n1"), edge("e2", "n1", "e1")),
        )

        // Snapshot: trigger and transform already completed
        val (runId, wsId, envId) = runIds()
        val snapshot = RuntimeSnapshot(
            runId             = runId,
            workspaceId       = wsId,
            environmentId     = envId,
            workflowVersionId = UUID.randomUUID(),
            sequence          = 2,
            nodeStatus        = mapOf("t1" to "COMPLETED", "n1" to "COMPLETED"),
            stepOutputKeys    = mapOf("t1" to emptyList(), "n1" to emptyList()),
            selectedEdges     = setOf("e1", "e2"),
            completedNodeIds  = setOf("t1", "n1"),
            pendingNodeIds    = setOf("e1"),
        )

        // Provide real runId/wsId/envId in the resume call
        capturedEvents.clear()
        val result = runtime().resume(
            runId             = runId,
            workspaceId       = wsId,
            environmentId     = envId,
            workflowVersionId = UUID.randomUUID(),
            graph             = graph,
            inputJson         = "{}",
            snapshot          = snapshot,
        )

        assertInstanceOf(WorkflowRuntime.ExecutionResult.Succeeded::class.java, result)

        // Only END should have been started (trigger and transform are already done)
        val startedSteps = capturedEvents
            .filter { it.type == RunEventStore.EventType.STEP_STARTED }
            .map { it.stepId }
        assertFalse("t1" in startedSteps, "TRIGGER should not re-run")
        assertFalse("n1" in startedSteps, "TRANSFORM should not re-run")
        assertTrue("e1" in startedSteps, "END should execute on resume")
    }

    // ── Resume with pending override re-runs the specified node ──────────────

    @Test
    fun `resume with pendingNodeIds forces node to re-run`(): Unit = runBlocking {
        val trigger   = node("t1", NodeType.TRIGGER)
        val transform = node("n1", NodeType.TRANSFORM)
        val end       = node("e1", NodeType.END)
        val graph = WorkflowGraph(
            nodes = listOf(trigger, transform, end),
            edges = listOf(edge("e1", "t1", "n1"), edge("e2", "n1", "e1")),
        )

        val (runId, wsId, envId) = runIds()
        val snapshot = RuntimeSnapshot(
            runId             = runId,
            workspaceId       = wsId,
            environmentId     = envId,
            workflowVersionId = UUID.randomUUID(),
            sequence          = 1,
            nodeStatus        = mapOf("t1" to "COMPLETED", "n1" to "FAILED"),
            stepOutputKeys    = mapOf("t1" to emptyList()),
            selectedEdges     = setOf("e1"),
            completedNodeIds  = setOf("t1"),
            pendingNodeIds    = setOf("n1", "e1"),
        )

        capturedEvents.clear()
        val result = runtime().resume(
            runId             = runId,
            workspaceId       = wsId,
            environmentId     = envId,
            workflowVersionId = UUID.randomUUID(),
            graph             = graph,
            inputJson         = "{}",
            snapshot          = snapshot,
            pendingNodeIds    = setOf("n1"),  // force n1 back to PENDING for retry
        )

        // n1 should re-run (as TRANSFORM it should succeed)
        assertInstanceOf(WorkflowRuntime.ExecutionResult.Succeeded::class.java, result)

        val startedSteps = capturedEvents
            .filter { it.type == RunEventStore.EventType.STEP_STARTED }
            .map { it.stepId }
        assertTrue("n1" in startedSteps, "n1 should have re-run after pendingNodeIds override")
    }

    // ── Cancellation check halts the run ─────────────────────────────────────

    @Test
    fun `cancellation check causes run to return Cancelled`(): Unit = runBlocking {
        val trigger   = node("t1", NodeType.TRIGGER)
        val transform = node("n1", NodeType.TRANSFORM)
        val end       = node("e1", NodeType.END)
        val graph = WorkflowGraph(
            nodes = listOf(trigger, transform, end),
            edges = listOf(edge("e1", "t1", "n1"), edge("e2", "n1", "e1")),
        )

        // cancellationCheck always returns true → should cancel immediately
        val result = execute(graph, cancellationCheck = { true })

        assertInstanceOf(WorkflowRuntime.ExecutionResult.Cancelled::class.java, result)
    }

    // ── Cancellation check false → normal execution ───────────────────────────

    @Test
    fun `cancellation check returning false does not cancel run`(): Unit = runBlocking {
        val trigger = node("t1", NodeType.TRIGGER)
        val end     = node("e1", NodeType.END)
        val graph = WorkflowGraph(
            nodes = listOf(trigger, end),
            edges = listOf(edge("e1", "t1", "e1")),
        )

        val result = execute(graph, cancellationCheck = { false })

        assertInstanceOf(WorkflowRuntime.ExecutionResult.Succeeded::class.java, result)
    }
}

// ── no-op infrastructure stubs ────────────────────────────────────────────────

private fun noopDataSource(): javax.sql.DataSource =
    object : javax.sql.DataSource, java.io.PrintWriter(java.io.StringWriter()) {
        override fun getConnection() = throw UnsupportedOperationException("stub")
        override fun getConnection(u: String?, p: String?) = throw UnsupportedOperationException("stub")
        override fun getLogWriter() = java.io.PrintWriter(java.io.StringWriter())
        override fun setLogWriter(pw: java.io.PrintWriter?) {}
        override fun setLoginTimeout(s: Int) {}
        override fun getLoginTimeout() = 0
        override fun getParentLogger() = java.util.logging.Logger.getAnonymousLogger()
        override fun <T : Any?> unwrap(iface: Class<T>?) = throw UnsupportedOperationException()
        override fun isWrapperFor(iface: Class<*>?) = false
    }

private fun noopPubSub(): io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String> {
    @Suppress("UNCHECKED_CAST")
    return java.lang.reflect.Proxy.newProxyInstance(
        Thread.currentThread().contextClassLoader,
        arrayOf(io.lettuce.core.pubsub.StatefulRedisPubSubConnection::class.java),
    ) { _, _, _ -> null } as io.lettuce.core.pubsub.StatefulRedisPubSubConnection<String, String>
}
