package com.vectorbea.worker.runtime.executor

import com.vectorbea.worker.connector.ConnectionResolver
import com.vectorbea.worker.connector.pool.ClientDbPoolManager
import com.vectorbea.worker.events.RunEventStore
import com.vectorbea.worker.runtime.checkpoint.ApprovalStore
import com.vectorbea.graph.NodeType
import com.vectorbea.graph.WorkflowNode
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
    /**
     * Needed by the spec-driven HTTP path to read a connection's secret as named
     * fields rather than as one opaque value. Null leaves that path able to call
     * unauthenticated endpoints only.
     */
    secretService: com.vectorbea.worker.connector.SecretService? = null,
    /**
     * Exactly-once guard for outbound side effects. Null in tests; production
     * always supplies it, because an at-least-once queue plus an unguarded POST
     * is a duplicate email waiting to happen.
     */
    sideEffects: com.vectorbea.worker.durable.SideEffectGuard? = null,
    /**
     * Per-connection circuit breaker, shared across every executor that makes
     * outbound calls so a provider that is down is discovered once rather than
     * once per node type.
     */
    circuit: com.vectorbea.worker.net.ConnectionCircuit? = null,
    /** Records every provider call completely enough to replay it. */
    recorder: com.vectorbea.worker.replay.ModelCallRecorder? = null,
    /** Non-null during a replay: calls are served from the recording. */
    replay: com.vectorbea.worker.replay.ReplayContext? = null,
    /** Supplies a node's output contract, so a declared schema enables Layer 0. */
    contracts: com.vectorbea.worker.contract.ContractValidator? = null,
    /** Shared provider token bucket. §12.4. Null disables it. */
    capacity: com.vectorbea.worker.net.ProviderCapacityBucket? = null,
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
        /* `pricing` is what makes a customer's negotiated rate reach the cost
           figure. Built from the DataSource this registry already holds; without
           it every call through a customer gateway would be priced at our list
           rate, which over-reports their spend — and over-reporting is the
           number an enterprise reconciles against their provider invoice first. */
        NodeType.LLM       to LlmNodeExecutor(connectionResolver, eventStore,
                                  circuit = circuit, recorder = recorder, replay = replay,
                                  contracts = contracts, capacity = capacity,
                                  pricing = com.vectorbea.worker.pricing.ModelPricing(dataSource)),
        NodeType.HTTP      to HttpNodeExecutor(connectionResolver, eventStore, sideEffects = sideEffects),
        NodeType.DB_QUERY  to DbReadNodeExecutor(connectionResolver, dbPoolManager, eventStore),
        NodeType.DB_WRITE  to DbWriteNodeExecutor(connectionResolver, dbPoolManager, approvalStore, eventStore),
        // Reference executors — look up tool/agent definition from DB at runtime
        NodeType.TOOL      to ToolNodeExecutor(dataSource, connectionResolver, dbPoolManager,
                                  eventStore, circuit = circuit,
                                  secretService = secretService, sideEffects = sideEffects),
        /* The agent path matters MORE than the plain LLM node here: an agent
           loop is where one run becomes twenty provider calls, which is the
           multiplier §12.4 exists for. */
        NodeType.AGENT     to AgentNodeExecutor(dataSource, connectionResolver, eventStore,
                                  dbPoolManager, capacity = capacity),
        /* A TYPE ADDITION and nothing more. `agent` nodes keep their executor
           unchanged, and the two are siblings over the same primitives rather
           than one type with a branch inside it. */
        NodeType.AGENT_TEAM to AgentTeamNodeExecutor(dataSource, connectionResolver, eventStore,
                                  dbPoolManager, capacity = capacity),
    )

    private val unsupported = UnsupportedNodeExecutor()

    fun executorFor(node: WorkflowNode): NodeExecutor =
        executors[node.nodeType] ?: unsupported
}
