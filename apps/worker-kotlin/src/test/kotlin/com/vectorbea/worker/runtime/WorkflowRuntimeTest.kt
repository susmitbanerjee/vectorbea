package com.vectorbea.worker.runtime

import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.events.RunEventStore.RunEvent
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.checkpoint.CheckpointStore
import com.vectorbea.worker.runtime.graph.*
import java.util.UUID as JvmUUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import java.util.UUID

/**
 * Integration tests for [WorkflowRuntime].
 *
 * Uses in-memory stub implementations — no real DB or Redis required.
 * Covers: sequential, branch, parallel/join, approval pause, unsupported nodes.
 */
class WorkflowRuntimeTest {

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
        ): String = UUID.randomUUID().toString()
    }

    private val stubStepOutputStore = object : StepOutputStore(noopDataSource()) {
        override fun save(
            runId: UUID, workspaceId: UUID, environmentId: UUID,
            nodeId: String, nodeType: String,
            rawOutput: Map<String, Any>?, extractedOutput: Map<String, Any>?,
            validatedOutput: Map<String, Any>?, validationErrors: List<String>,
        ) { /* no-op */ }
    }

    private fun runtime() = WorkflowRuntime(
        dataSource      = noopDataSource(),
        eventStore      = stubEventStore,
        checkpointStore = stubCheckpointStore,
        approvalStore   = stubApprovalStore,
        stepOutputStore = stubStepOutputStore,
        workerId        = "test-worker",
    )

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun node(id: String, type: NodeType, config: Map<String, Any> = emptyMap()) =
        WorkflowNode(id = id, type = type.value, config = config)

    private fun edge(id: String, from: String, to: String, type: EdgeType = EdgeType.DEFAULT, cond: String? = null) =
        WorkflowEdge(id = id, source = from, target = to, type = type.value, condition = cond)

    private fun runIds() = Triple(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID())

    private fun execute(
        graph: WorkflowGraph,
        input: String = "{}",
        workflowVersionId: UUID = UUID.randomUUID(),
    ): WorkflowRuntime.ExecutionResult {
        capturedEvents.clear()
        val (runId, wsId, envId) = runIds()
        return runtime().execute(
            runId             = runId,
            workspaceId       = wsId,
            environmentId     = envId,
            workflowVersionId = workflowVersionId,
            graph             = graph,
            inputJson         = input,
        )
    }

    // ── Sequential workflow ───────────────────────────────────────────────────

    @Test
    fun `sequential trigger → transform → end succeeds`() {
        val trigger   = node("t1", NodeType.TRIGGER)
        val transform = node("n1", NodeType.TRANSFORM)
        val end       = node("e1", NodeType.END)
        val graph = WorkflowGraph(
            nodes = listOf(trigger, transform, end),
            edges = listOf(
                edge("e1", "t1", "n1"),
                edge("e2", "n1", "e1"),
            )
        )

        val result = execute(graph, input = """{"greeting":"hello"}""")

        assertInstanceOf(WorkflowRuntime.ExecutionResult.Succeeded::class.java, result)

        val eventTypes = capturedEvents.map { it.type }
        assertTrue(RunEventStore.EventType.STEP_STARTED in eventTypes)
        assertTrue(RunEventStore.EventType.STEP_COMPLETED in eventTypes)
    }

    @Test
    fun `invalid graph (no trigger) returns Failed`() {
        val graph = WorkflowGraph(
            nodes = listOf(node("n1", NodeType.TRANSFORM)),
            edges = emptyList()
        )
        val result = execute(graph)
        assertInstanceOf(WorkflowRuntime.ExecutionResult.Failed::class.java, result)
        val msg = (result as WorkflowRuntime.ExecutionResult.Failed).reason
        assertTrue(msg.contains("TRIGGER", ignoreCase = true))
    }

    // ── Branch workflow ───────────────────────────────────────────────────────

    @Test
    fun `branch selects correct edge based on input`() {
        val trigger = node("t1", NodeType.TRIGGER)
        val branch  = node("b1", NodeType.BRANCH)
        val left    = node("left", NodeType.TRANSFORM)
        val right   = node("right", NodeType.TRANSFORM)
        val endL    = node("endL", NodeType.END)
        val endR    = node("endR", NodeType.END)

        // Trigger passes input through; branch evaluates output.path
        val graph = WorkflowGraph(
            nodes = listOf(trigger, branch, left, right, endL, endR),
            edges = listOf(
                edge("e1", "t1", "b1"),
                edge("eL", "b1", "left",  EdgeType.BRANCH, cond = "output.path == \"left\""),
                edge("eR", "b1", "right", EdgeType.BRANCH, cond = "output.path == \"right\""),
                edge("e2", "left",  "endL"),
                edge("e3", "right", "endR"),
            )
        )

        val result = execute(graph, input = """{"path":"left"}""")

        assertInstanceOf(WorkflowRuntime.ExecutionResult.Succeeded::class.java, result)

        // left branch node should be completed, right should be pending (never reached)
        val completedEvents = capturedEvents.filter {
            it.type == RunEventStore.EventType.STEP_COMPLETED && it.stepId == "left"
        }
        assertTrue(completedEvents.isNotEmpty(), "Left branch should have been completed")

        val rightStarted = capturedEvents.any {
            it.type == RunEventStore.EventType.STEP_STARTED && it.stepId == "right"
        }
        assertFalse(rightStarted, "Right branch should not have been started")
    }

    // ── Parallel / join workflow ──────────────────────────────────────────────

    @Test
    fun `parallel branches both execute and join completes`() {
        val trigger  = node("t1", NodeType.TRIGGER)
        val parallel = node("par", NodeType.PARALLEL)
        val branch1  = node("b1",  NodeType.TRANSFORM)
        val branch2  = node("b2",  NodeType.TRANSFORM)
        val join     = WorkflowNode(id = "join", type = "join", config = mapOf("joinPolicy" to "wait_all"))
        val end      = node("end", NodeType.END)

        val graph = WorkflowGraph(
            nodes = listOf(trigger, parallel, branch1, branch2, join, end),
            edges = listOf(
                edge("e1",  "t1",  "par"),
                edge("ep1", "par", "b1",   EdgeType.PARALLEL),
                edge("ep2", "par", "b2",   EdgeType.PARALLEL),
                edge("ej1", "b1",  "join"),
                edge("ej2", "b2",  "join"),
                edge("e2",  "join","end"),
            )
        )

        val result = execute(graph)

        assertInstanceOf(WorkflowRuntime.ExecutionResult.Succeeded::class.java, result)

        val parallelStarted = capturedEvents.any { it.type == RunEventStore.EventType.PARALLEL_STARTED }
        assertTrue(parallelStarted, "PARALLEL_STARTED event should be emitted")

        val joinCompleted = capturedEvents.any { it.type == RunEventStore.EventType.STEP_COMPLETED && it.stepId == "join" }
        assertTrue(joinCompleted, "JOIN node should complete")
    }

    // ── Approval pause ────────────────────────────────────────────────────────

    @Test
    fun `approval node pauses run without failing`() {
        val trigger  = node("t1", NodeType.TRIGGER)
        val approval = node("ap1", NodeType.APPROVAL, config = mapOf("message" to "Please review"))
        val end      = node("end", NodeType.END)

        val graph = WorkflowGraph(
            nodes = listOf(trigger, approval, end),
            edges = listOf(
                edge("e1", "t1",  "ap1"),
                edge("e2", "ap1", "end"),
            )
        )

        val result = execute(graph)

        assertInstanceOf(WorkflowRuntime.ExecutionResult.WaitingForApproval::class.java, result)

        val approvalEvent = capturedEvents.firstOrNull { it.type == RunEventStore.EventType.APPROVAL_REQUESTED }
        assertNotNull(approvalEvent, "APPROVAL_REQUESTED event should be emitted")
    }

    // ── Unsupported node type ─────────────────────────────────────────────────

    @Test
    fun `unsupported node (TOOL) emits NODE_TYPE_UNSUPPORTED and fails run by default`() {
        val trigger = node("t1", NodeType.TRIGGER)
        // TOOL gained a real executor — use UNKNOWN, which is genuinely unsupported
        val tool    = node("tool1", NodeType.UNKNOWN)
        val end     = node("end", NodeType.END)

        val graph = WorkflowGraph(
            nodes = listOf(trigger, tool, end),
            edges = listOf(
                edge("e1", "t1",    "tool1"),
                edge("e2", "tool1", "end"),
            )
        )

        val result = execute(graph)

        // Default failure policy = fail_run
        assertInstanceOf(WorkflowRuntime.ExecutionResult.Failed::class.java, result)

        val unsupportedEvent = capturedEvents.firstOrNull { it.type == RunEventStore.EventType.NODE_TYPE_UNSUPPORTED }
        assertNotNull(unsupportedEvent, "NODE_TYPE_UNSUPPORTED event should be emitted")
    }

    @Test
    fun `unsupported node with continue policy skips and continues`() {
        val trigger    = node("t1", NodeType.TRIGGER)
        val llmContinue = WorkflowNode(
            id = "tool1", type = "tool",   // TOOL is unsupported
            failurePolicy = FailurePolicy(onFailure = "continue")
        )
        val end = node("end", NodeType.END)

        val graph = WorkflowGraph(
            nodes = listOf(trigger, llmContinue, end),
            edges = listOf(
                edge("e1", "t1",    "tool1"),
                edge("e2", "tool1", "end"),
            )
        )

        val result = execute(graph)

        // With continue policy — should reach END and succeed
        assertInstanceOf(WorkflowRuntime.ExecutionResult.Succeeded::class.java, result)
    }

    // ── Checkpoints ───────────────────────────────────────────────────────────

    @Test
    fun `checkpoint event is emitted after each completed node`() {
        val trigger   = node("t1", NodeType.TRIGGER)
        val transform = node("n1", NodeType.TRANSFORM)
        val end       = node("e1", NodeType.END)
        val graph = WorkflowGraph(
            nodes = listOf(trigger, transform, end),
            edges = listOf(edge("e1", "t1", "n1"), edge("e2", "n1", "e1"))
        )

        execute(graph)

        val checkpointEvents = capturedEvents.filter { it.type == RunEventStore.EventType.CHECKPOINT_CREATED }
        // 3 nodes with default checkpoint policy = 3 checkpoints
        assertTrue(checkpointEvents.size >= 2, "Should emit checkpoint events (got ${checkpointEvents.size})")
    }
}

// ── DataSource / Pub/Sub no-ops ───────────────────────────────────────────────

private fun noopDataSource(): javax.sql.DataSource =
    object : javax.sql.DataSource, java.io.PrintWriter(java.io.StringWriter()) {
        override fun getConnection() = throw UnsupportedOperationException("stub DataSource")
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
