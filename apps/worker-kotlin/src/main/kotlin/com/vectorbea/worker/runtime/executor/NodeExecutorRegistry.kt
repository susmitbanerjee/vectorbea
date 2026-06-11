package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.worker.runtime.graph.NodeType
import com.vectorbea.worker.runtime.graph.WorkflowNode
import javax.sql.DataSource

/**
 * Maps [NodeType] → [NodeExecutor].
 *
 * Supported types have dedicated executors.
 * All others get [UnsupportedNodeExecutor] which emits a failure event.
 */
class NodeExecutorRegistry(
    approvalStore: ApprovalStore,
    connectionResolver: ConnectionResolver,
    dbPoolManager: ClientDbPoolManager,
    eventStore: RunEventStore,
    dataSource: DataSource,
) {

    private val executors: Map<NodeType, NodeExecutor> = mapOf(
        // Control-flow executors (no external I/O)
        NodeType.TRIGGER   to TriggerNodeExecutor(),
        NodeType.TRANSFORM to TransformNodeExecutor(),
        NodeType.BRANCH    to BranchNodeExecutor(),
        NodeType.PARALLEL  to ParallelNodeExecutor(),
        NodeType.JOIN      to JoinNodeExecutor(),
        NodeType.APPROVAL  to ApprovalNodeExecutor(approvalStore),
        NodeType.END       to EndNodeExecutor(),
        // Connector executors (real I/O)
        NodeType.LLM       to LlmNodeExecutor(connectionResolver, eventStore),
        NodeType.HTTP      to HttpNodeExecutor(connectionResolver, eventStore),
        NodeType.DB_QUERY  to DbReadNodeExecutor(connectionResolver, dbPoolManager, eventStore),
        NodeType.DB_WRITE  to DbWriteNodeExecutor(connectionResolver, dbPoolManager, approvalStore, eventStore),
        // Reference executors — look up tool/agent definition from DB at runtime
        NodeType.TOOL      to ToolNodeExecutor(dataSource, connectionResolver, dbPoolManager, eventStore),
        NodeType.AGENT     to AgentNodeExecutor(dataSource, connectionResolver, eventStore),
    )

    private val unsupported = UnsupportedNodeExecutor()

    fun executorFor(node: WorkflowNode): NodeExecutor =
        executors[node.nodeType] ?: unsupported
}
