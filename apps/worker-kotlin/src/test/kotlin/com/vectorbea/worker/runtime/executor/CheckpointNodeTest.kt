package com.vectorbea.worker.runtime.executor

import com.vectorbea.graph.NodeType
import com.vectorbea.graph.WorkflowGraph
import com.vectorbea.graph.WorkflowNode
import com.vectorbea.worker.runtime.graph.RuntimeContext
import kotlinx.coroutines.runBlocking
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/**
 * The canvas saves `checkpoint` and `merge` steps under those names. Both used to
 * resolve to UNKNOWN, and a run reaching either failed with "Unsupported node type".
 */
class CheckpointNodeTest {

    @Test
    fun `the canvas's step names resolve to node types the worker runs`() {
        assertEquals(NodeType.CHECKPOINT, NodeType.fromString("checkpoint"))
        assertEquals(NodeType.CHECKPOINT, NodeType.fromString("savepoint"))
        assertEquals(NodeType.JOIN, NodeType.fromString("merge"))
        assertEquals(NodeType.JOIN, NodeType.fromString("join"))
    }

    @Test
    fun `a checkpoint completes and passes its inputs through`() = runBlocking {
        val ctx = RuntimeContext(
            runId = UUID.randomUUID(), workspaceId = UUID.randomUUID(), environmentId = UUID.randomUUID(),
            workflowVersionId = UUID.randomUUID(), workflowInput = emptyMap(), graph = WorkflowGraph(),
        )
        val result = CheckpointNodeExecutor().execute(
            WorkflowNode(id = "n-new-checkpoint-3", type = "checkpoint"), mapOf("changes" to listOf("a")), ctx,
        )
        assertIs<NodeResult.Completed>(result)
        assertEquals(mapOf("changes" to listOf("a")), result.output)
    }
}
