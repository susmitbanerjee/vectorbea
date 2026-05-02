import type { DiscoveredWorkflow, WorkflowGraphEdge, WorkflowGraphNode, WorkflowStepTrace, WorkflowTrace } from "@/lib/api";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function shortPreview(value: unknown) {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 240);
  try {
    return JSON.stringify(value, null, 2).slice(0, 240);
  } catch {
    return String(value).slice(0, 240);
  }
}

function inferCapabilityName(trace: WorkflowTrace) {
  const meta = asRecord(trace.metadata);
  const candidates = [
    asString(meta.capabilityName),
    asString(meta.capability_name),
    asString(meta.agentName),
    asString(meta.agent_name),
    asString(meta.workflowName),
    asString(meta.workflow_name),
    asString(meta.serviceName),
    asString(meta.service_name),
  ].filter(Boolean) as string[];
  return candidates[0] ?? trace.capabilityName ?? "Agent run";
}

export function buildExecutionGraph(trace: WorkflowTrace) {
  const meta = asRecord(trace.metadata);
  const rawEvents = asArray<Record<string, unknown>>(meta.rawEvents);
  const nodes: WorkflowGraphNode[] = [];
  const edges: WorkflowGraphEdge[] = [];
  const spanToNode = new Map<string, string>();

  const rootId = `trace:${trace.id}`;
  nodes.push({
    id: rootId,
    parentId: null,
    type: "agent",
    name: inferCapabilityName(trace),
    status: trace.status === "failed" ? "failed" : "completed",
    latencyMs: trace.totalLatencyMs,
    costEstimate: trace.totalCostEstimate,
    provider: trace.provider,
    model: trace.model,
    toolName: null,
    mcpServerName: null,
    error: trace.errorMessage,
    inputPreview: shortPreview(trace.userInput),
    outputPreview: shortPreview(trace.finalResponse),
    metadata: {
      viewMode: "execution",
      stepLabel: "Agent run",
      environment: meta.environment ?? null,
      sourceBadge: meta.ingestSource ?? "direct_api",
      finalAction: trace.finalAction,
      finalBusinessOutcome: trace.finalBusinessOutcome,
      outcomeStatus: trace.outcomeStatus,
      outcomeReason: trace.outcomeReason,
      totalTokensInput: trace.totalTokensInput,
      totalTokensOutput: trace.totalTokensOutput,
      modelCost: trace.modelCost,
      toolCost: trace.toolCost,
      judgeCost: trace.judgeCost,
      retryCost: trace.retryCost,
      traceId: trace.traceId,
      rawInputDisabled: trace.userInput == null,
      rawOutputDisabled: trace.finalResponse == null,
    },
  });

  const orderedSteps = [...(trace.steps ?? [])].sort((a, b) => a.stepIndex - b.stepIndex);
  let previousNodeId = rootId;

  orderedSteps.forEach((step) => {
    const event = rawEvents.find((entry) => {
      const eventType = asString(entry.type);
      const toolName = asString(entry.tool_name);
      const model = asString(entry.model);
      const stepSpan = asString(entry.span_id);
      if (stepSpan && stepSpan === step.id) return true;
      if (step.stepType === "tool_call" || step.stepType === "mcp_tool_call") {
        return (eventType === "tool_call" || eventType === "mcp_tool_call") && toolName === step.toolName;
      }
      if (step.stepType === "llm_call") {
        return eventType === "llm_call" && model === step.model;
      }
      return eventType === step.stepType;
    });

    const spanId = asString(event?.span_id) ?? step.id;
    const parentSpanId = asString(event?.parent_span_id);
    const nodeId = spanId ?? `step:${trace.id}:${step.stepIndex}`;
    spanToNode.set(spanId, nodeId);

    const parentNodeId = parentSpanId && spanToNode.has(parentSpanId)
      ? spanToNode.get(parentSpanId)!
      : previousNodeId;

    nodes.push({
      id: nodeId,
      parentId: parentSpanId,
      type: step.stepType as WorkflowGraphNode["type"],
      name: step.toolName ?? step.stepName,
      status: step.status,
      latencyMs: step.latencyMs,
      costEstimate: step.costEstimate,
      provider: step.provider,
      model: step.model,
      toolName: step.toolName,
      mcpServerName: step.mcpServerName,
      error: step.errorMessage,
      inputPreview: shortPreview(Object.keys(step.toolArguments).length ? step.toolArguments : step.inputPayload),
      outputPreview: shortPreview(Object.keys(step.toolResult).length ? step.toolResult : step.outputPayload),
      metadata: {
        viewMode: "execution",
        stepLabel: step.stepName,
        stepIndex: step.stepIndex,
        spanId,
        parentSpanId,
        tokensInput: step.tokensInput,
        tokensOutput: step.tokensOutput,
        inputPayload: step.inputPayload,
        outputPayload: step.outputPayload,
        toolArguments: step.toolArguments,
        toolResult: step.toolResult,
        sourceBadge: meta.ingestSource ?? "direct_api",
      },
    });

    edges.push({
      id: `${parentNodeId}->${nodeId}`,
      from: parentNodeId,
      to: nodeId,
      reason: parentSpanId && spanToNode.has(parentSpanId) ? "parent_span" : "step_order",
      label: parentSpanId && spanToNode.has(parentSpanId) ? "Parent-child" : "Next step",
    });
    previousNodeId = nodeId;
  });

  if (trace.finalAction || trace.finalResponse) {
    const finalNodeId = `final:${trace.id}`;
    const finalType = trace.outcomeStatus === "human_handoff" ? "human_handoff" : "final_response";
    nodes.push({
      id: finalNodeId,
      parentId: previousNodeId,
      type: finalType,
      name: trace.finalAction ?? (finalType === "human_handoff" ? "handoff_to_human" : "final_response"),
      status: trace.status === "failed" ? "failed" : "completed",
      latencyMs: null,
      costEstimate: null,
      provider: null,
      model: null,
      toolName: null,
      mcpServerName: null,
      error: trace.errorMessage,
      inputPreview: null,
      outputPreview: shortPreview(trace.finalResponse),
      metadata: {
        viewMode: "execution",
        finalAction: trace.finalAction,
        finalBusinessOutcome: trace.finalBusinessOutcome,
        outcomeStatus: trace.outcomeStatus,
        outcomeReason: trace.outcomeReason,
        finalResponse: trace.finalResponse,
      },
    });
    edges.push({
      id: `${previousNodeId}->${finalNodeId}`,
      from: previousNodeId,
      to: finalNodeId,
      reason: "step_order",
      label: trace.outcomeStatus === "human_handoff" ? "Needs review" : "Completed",
    });
  }

  return { nodes, edges };
}

export function buildWorkflowMap(workflow: DiscoveredWorkflow) {
  const nodes = workflow.graphNodes.map((node, index) => ({
    ...node,
    metadata: {
      ...(node.metadata ?? {}),
      viewMode: "map",
      observedTraceCount: workflow.traceId ? 1 : 0,
      workflowShapeHash: workflow.workflowShapeHash,
      mapNodeIndex: index,
      sourceBadge: workflow.sourceBadge,
    },
  }));

  const edges = workflow.graphEdges.map((edge) => ({
    ...edge,
    label: edge.reason === "parent_span" ? "Dependency" : "Observed path",
  }));

  return { nodes, edges };
}

export function compareExecutionToWorkflowMap(trace: WorkflowTrace, workflow: DiscoveredWorkflow | null) {
  if (!workflow || !trace.steps?.length) return [];

  const expectedTools = workflow.graphNodes
    .map((node) => node.toolName ?? null)
    .filter(Boolean) as string[];
  const actualTools = trace.steps
    .map((step) => step.toolName ?? null)
    .filter(Boolean) as string[];

  const warnings: string[] = [];
  for (const expectedTool of expectedTools) {
    if (!actualTools.includes(expectedTool)) {
      warnings.push(`This trace skipped expected node ${expectedTool}.`);
      break;
    }
  }

  const expectedPairs = expectedTools.slice(0, -1).map((tool, index) => [tool, expectedTools[index + 1]] as const);
  for (const [before, after] of expectedPairs) {
    const beforeIndex = actualTools.indexOf(before);
    const afterIndex = actualTools.indexOf(after);
    if (beforeIndex !== -1 && afterIndex !== -1 && beforeIndex > afterIndex) {
      warnings.push(`This trace called ${before} after ${after}, which deviates from the workflow map.`);
      break;
    }
  }

  if (warnings.length === 0 && actualTools.length > expectedTools.length) {
    warnings.push("This trace followed an unconfirmed path with extra execution steps.");
  }

  return warnings;
}

export function buildWorkflowMapFromTrace(trace: WorkflowTrace) {
  return buildExecutionGraph(trace);
}
