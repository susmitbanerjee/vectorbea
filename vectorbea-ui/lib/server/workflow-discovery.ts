import "server-only";

import { createHash } from "node:crypto";

import type {
  AiCapability,
  AiCapabilityType,
  CapabilityVersion,
  DiscoveredCapability,
  DiscoveredTool,
  DiscoveredWorkflow,
  DiscoveryReview,
  DiscoverySession,
  DiscoverySource,
  SuggestedDeterministicRule,
  ToolRegistryEntry,
  WorkflowGraphEdge,
  WorkflowGraphNode,
  WorkflowStepTrace,
  WorkflowTrace,
} from "@/lib/api";
import { createCapability, createVersion, listCapabilities } from "@/lib/server/ai-capabilities";
import { writeAuditEvent } from "@/lib/server/audit-events";
import { createRegressionCase, createRegressionSuite } from "@/lib/server/workflow-regressions";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

type DiscoverySessionRow = {
  id: string;
  workspace_id: string;
  status: DiscoverySession["status"];
  source: DiscoverySource;
  environment: string | null;
  started_by: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type DiscoveredCapabilityRow = {
  id: string;
  workspace_id: string;
  session_id: string;
  suggested_name: string;
  suggested_type: AiCapabilityType;
  service_name: string | null;
  environment: string | null;
  confidence: number;
  matched_capability_id: string | null;
  status: DiscoveredCapability["status"];
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type DiscoveredToolRow = {
  id: string;
  workspace_id: string;
  session_id: string;
  tool_name: string;
  mcp_server_name: string | null;
  argument_schema: Record<string, unknown> | null;
  result_schema: Record<string, unknown> | null;
  first_seen_at: string;
  last_seen_at: string;
  seen_count: number;
  status: DiscoveredTool["status"];
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type DiscoveredWorkflowRow = {
  id: string;
  workspace_id: string;
  session_id: string;
  name: string;
  capability_name: string | null;
  trace_id: string | null;
  workflow_shape_hash: string;
  steps: unknown[] | null;
  edges: unknown[] | null;
  suggested_rules: unknown[] | null;
  latency_ms: number | null;
  cost_estimate: number | null;
  status: DiscoveredWorkflow["status"];
  source_badge: DiscoverySource;
  created_at: string;
  updated_at: string;
};

type ToolRegistryRow = {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  mcp_server_name: string | null;
  argument_schema: Record<string, unknown> | null;
  result_schema: Record<string, unknown> | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  created_from_discovery_id: string | null;
  created_at: string;
  updated_at: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function titleCase(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function shortPreview(value: unknown) {
  if (value == null) return null;
  if (typeof value === "string") return value.slice(0, 220);
  try {
    return JSON.stringify(value).slice(0, 220);
  } catch {
    return String(value).slice(0, 220);
  }
}

function inferSchemaFromValue(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length > 0 ? inferSchemaFromValue(value[0]) : { type: "unknown" },
    };
  }
  if (value === null) return { type: "null" };
  if (typeof value === "object") {
    return {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, inferSchemaFromValue(child)]),
      ),
    };
  }
  if (typeof value === "number") return { type: Number.isInteger(value) ? "integer" : "number" };
  if (typeof value === "boolean") return { type: "boolean" };
  return { type: typeof value };
}

function mergeSchemas(base: Record<string, unknown>, incoming: Record<string, unknown>): Record<string, unknown> {
  const baseType = asString(base.type);
  const incomingType = asString(incoming.type);
  if (!baseType) return incoming;
  if (!incomingType || baseType !== incomingType) {
    return { anyOf: [base, incoming] };
  }
  if (baseType === "object") {
    const baseProps = asRecord(base.properties);
    const incomingProps = asRecord(incoming.properties);
    const keys = Array.from(new Set([...Object.keys(baseProps), ...Object.keys(incomingProps)]));
    return {
      type: "object",
      properties: Object.fromEntries(keys.map((key) => {
        if (!baseProps[key]) return [key, incomingProps[key]];
        if (!incomingProps[key]) return [key, baseProps[key]];
        return [key, mergeSchemas(asRecord(baseProps[key]), asRecord(incomingProps[key]))];
      })),
    };
  }
  if (baseType === "array") {
    return {
      type: "array",
      items: mergeSchemas(asRecord(base.items), asRecord(incoming.items)),
    };
  }
  return base;
}

function inferCapabilityType(steps: WorkflowStepTrace[]): AiCapabilityType {
  if (steps.some((step) => step.stepType === "mcp_tool_call")) return "mcp_workflow";
  if (steps.some((step) => step.stepType === "rag_retrieval")) return "rag_workflow";
  return "agent_workflow";
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
    asString(trace.finalAction),
  ].filter(Boolean) as string[];
  if (candidates.length > 0) return titleCase(candidates[0]);
  const firstTool = trace.steps?.find((step) => step.toolName)?.toolName;
  return firstTool ? `${titleCase(firstTool)} Agent` : "Discovered Agent Workflow";
}

function buildWorkflowShapeHash(steps: WorkflowStepTrace[]) {
  const shape = steps.map((step) => {
    if (step.stepType === "tool_call" || step.stepType === "mcp_tool_call") {
      return `${step.stepType}:${step.toolName ?? step.stepName}`;
    }
    return `${step.stepType}:${step.model ?? step.stepName}`;
  }).join(">");
  return createHash("sha1").update(shape).digest("hex");
}

function buildGraph(trace: WorkflowTrace) {
  const meta = asRecord(trace.metadata);
  const rawEvents = asArray<Record<string, unknown>>(meta.rawEvents);
  const nodes: WorkflowGraphNode[] = [];
  const edges: WorkflowGraphEdge[] = [];

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
      source: meta.ingestSource ?? "direct_api",
      finalAction: trace.finalAction,
      outcomeStatus: trace.outcomeStatus,
      outcomeReason: trace.outcomeReason,
    },
  });

  const spanToNode = new Map<string, string>();
  const orderedSteps = [...(trace.steps ?? [])].sort((a, b) => a.stepIndex - b.stepIndex);
  let previousNodeId = rootId;

  orderedSteps.forEach((step) => {
    const event = rawEvents.find((entry) => {
      const entryType = asString(entry.type);
      const toolName = asString(entry.tool_name);
      const model = asString(entry.model);
      if (step.stepType === "tool_call" || step.stepType === "mcp_tool_call") {
        return (entryType === "tool_call" || entryType === "mcp_tool_call") && toolName === step.toolName;
      }
      if (step.stepType === "llm_call") {
        return entryType === "llm_call" && model === step.model;
      }
      return false;
    });
    const spanId = asString(event?.span_id);
    const parentSpanId = asString(event?.parent_span_id);
    const nodeId = spanId ?? `step:${trace.id}:${step.stepIndex}`;
    if (spanId) spanToNode.set(spanId, nodeId);

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
        tokensInput: step.tokensInput,
        tokensOutput: step.tokensOutput,
      },
    });

    const parentNodeId = parentSpanId && spanToNode.has(parentSpanId)
      ? spanToNode.get(parentSpanId)!
      : previousNodeId;
    edges.push({
      id: `${parentNodeId}->${nodeId}`,
      from: parentNodeId,
      to: nodeId,
      reason: parentSpanId && spanToNode.has(parentSpanId) ? "parent_span" : "step_order",
    });
    previousNodeId = nodeId;
  });

  if (trace.finalAction || trace.finalResponse) {
    const finalNodeId = `final:${trace.id}`;
    nodes.push({
      id: finalNodeId,
      parentId: previousNodeId,
      type: trace.outcomeStatus === "human_handoff" ? "human_handoff" : "final_response",
      name: trace.finalAction ?? "final_response",
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
        finalAction: trace.finalAction,
        finalBusinessOutcome: trace.finalBusinessOutcome,
      },
    });
    edges.push({
      id: `${previousNodeId}->${finalNodeId}`,
      from: previousNodeId,
      to: finalNodeId,
      reason: "step_order",
    });
  }

  return { nodes, edges };
}

function buildSuggestedRules(trace: WorkflowTrace, steps: WorkflowStepTrace[]): SuggestedDeterministicRule[] {
  const suggestions: SuggestedDeterministicRule[] = [];
  const toolNames = steps.map((step) => step.toolName).filter(Boolean) as string[];
  if (toolNames.includes("checkRefundEligibility") && toolNames.includes("createRefund")) {
    suggestions.push({
      id: `rule:${trace.id}:refund-sequence`,
      ruleType: "tool_sequence",
      summary: "createRefund requires checkRefundEligibility first",
      whySuggested: "Observed a refund workflow with eligibility check before refund creation.",
      observedTraceCount: 1,
      severitySuggestion: "high",
      config: {
        requiredBefore: "checkRefundEligibility",
        targetTool: "createRefund",
      },
    });
  }

  const repeatedCalls = toolNames.reduce<Record<string, number>>((acc, tool) => {
    acc[tool] = (acc[tool] ?? 0) + 1;
    return acc;
  }, {});
  for (const [tool, count] of Object.entries(repeatedCalls)) {
    if (count > 2) {
      suggestions.push({
        id: `rule:${trace.id}:${tool}:max-calls`,
        ruleType: "max_tool_calls",
        summary: `${tool} should not be called more than ${count} times`,
        whySuggested: "The same tool was called repeatedly in this workflow shape.",
        observedTraceCount: 1,
        severitySuggestion: "medium",
        config: {
          toolName: tool,
          maxCalls: count,
        },
      });
    }
  }

  if ((trace.totalCostEstimate ?? 0) > 0.05) {
    suggestions.push({
      id: `rule:${trace.id}:cost-threshold`,
      ruleType: "cost_threshold",
      summary: `Workflow cost threshold around $${(trace.totalCostEstimate ?? 0).toFixed(3)}`,
      whySuggested: "Observed a relatively expensive workflow run that may need a budget guardrail.",
      observedTraceCount: 1,
      severitySuggestion: "medium",
      config: {
        maxCostUsd: Number(((trace.totalCostEstimate ?? 0) * 1.1).toFixed(4)),
      },
    });
  }

  if ((trace.totalLatencyMs ?? 0) > 5_000) {
    suggestions.push({
      id: `rule:${trace.id}:latency-threshold`,
      ruleType: "latency_threshold",
      summary: `Workflow latency threshold around ${trace.totalLatencyMs} ms`,
      whySuggested: "Observed a slower workflow run that may need a latency gate.",
      observedTraceCount: 1,
      severitySuggestion: "medium",
      config: {
        maxLatencyMs: Math.ceil((trace.totalLatencyMs ?? 0) * 1.1),
      },
    });
  }

  return suggestions;
}

function mapSession(row: DiscoverySessionRow): DiscoverySession {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    status: row.status,
    source: row.source,
    environment: row.environment,
    startedBy: row.started_by,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapCapability(row: DiscoveredCapabilityRow): DiscoveredCapability {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    suggestedName: row.suggested_name,
    suggestedType: row.suggested_type,
    serviceName: row.service_name,
    environment: row.environment,
    confidence: Number(row.confidence ?? 0),
    matchedCapabilityId: row.matched_capability_id,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapTool(row: DiscoveredToolRow): DiscoveredTool {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    toolName: row.tool_name,
    mcpServerName: row.mcp_server_name,
    argumentSchema: row.argument_schema ?? {},
    resultSchema: row.result_schema ?? {},
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    seenCount: row.seen_count,
    status: row.status,
    metadata: row.metadata ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWorkflow(row: DiscoveredWorkflowRow): DiscoveredWorkflow {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    sessionId: row.session_id,
    name: row.name,
    capabilityName: row.capability_name,
    traceId: row.trace_id,
    workflowShapeHash: row.workflow_shape_hash,
    graphNodes: asArray<WorkflowGraphNode>(row.steps),
    graphEdges: asArray<WorkflowGraphEdge>(row.edges),
    suggestedRules: asArray<SuggestedDeterministicRule>(row.suggested_rules),
    latencyMs: row.latency_ms,
    costEstimate: row.cost_estimate,
    status: row.status,
    sourceBadge: row.source_badge,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapRegistry(row: ToolRegistryRow): ToolRegistryEntry {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    mcpServerName: row.mcp_server_name,
    argumentSchema: row.argument_schema ?? {},
    resultSchema: row.result_schema ?? {},
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    createdFromDiscoveryId: row.created_from_discovery_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getOrCreateSession(args: {
  workspaceId: string;
  source: DiscoverySource;
  environment: string | null;
}) {
  const supabase = createVectorBeaAdminClient();
  const existing = await supabase
    .from("discovery_sessions")
    .select("*")
    .eq("workspace_id", args.workspaceId)
    .eq("source", args.source)
    .eq("environment", args.environment)
    .in("status", ["detecting", "ready_for_review"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data) return existing.data as DiscoverySessionRow;

  const created = await supabase
    .from("discovery_sessions")
    .insert({
      workspace_id: args.workspaceId,
      source: args.source,
      environment: args.environment,
      status: "detecting",
    })
    .select("*")
    .single();
  if (created.error) throw new Error(created.error.message);
  return created.data as DiscoverySessionRow;
}

export async function recordWorkflowDiscoveryFromTrace(trace: WorkflowTrace) {
  const supabase = createVectorBeaAdminClient();
  const source = (asString(trace.metadata.ingestSource) as DiscoverySource | null) ?? "direct_api";
  const environment = asString(trace.metadata.environment);
  const session = await getOrCreateSession({
    workspaceId: trace.workspaceId,
    source,
    environment,
  });

  const steps = trace.steps ?? [];
  const capabilityName = inferCapabilityName(trace);
  const suggestedType = inferCapabilityType(steps);
  const graph = buildGraph(trace);
  const suggestedRules = buildSuggestedRules(trace, steps);
  const workflowShapeHash = buildWorkflowShapeHash(steps);

  const existingCapabilities = await listCapabilities(trace.workspaceId);
  const matchedCapability = existingCapabilities.find((item) =>
    item.name.trim().toLowerCase() === capabilityName.trim().toLowerCase(),
  );

  const capabilityRes = await supabase
    .from("discovered_capabilities")
    .select("*")
    .eq("workspace_id", trace.workspaceId)
    .eq("session_id", session.id)
    .eq("suggested_name", capabilityName)
    .eq("environment", environment)
    .limit(1)
    .maybeSingle();
  if (capabilityRes.error) throw new Error(capabilityRes.error.message);

  if (capabilityRes.data) {
    await supabase
      .from("discovered_capabilities")
      .update({
        confidence: Math.min(Number(capabilityRes.data.confidence ?? 0.5) + 0.05, 0.99),
        matched_capability_id: matchedCapability?.id ?? null,
        status: matchedCapability ? "matched" : capabilityRes.data.status,
      })
      .eq("id", capabilityRes.data.id);
  } else {
    await supabase
      .from("discovered_capabilities")
      .insert({
        workspace_id: trace.workspaceId,
        session_id: session.id,
        suggested_name: capabilityName,
        suggested_type: suggestedType,
        service_name: asString(trace.metadata.serviceName) ?? asString(trace.metadata.service_name),
        environment,
        confidence: matchedCapability ? 0.94 : 0.74,
        matched_capability_id: matchedCapability?.id ?? null,
        status: matchedCapability ? "matched" : "new",
        metadata: {
          finalAction: trace.finalAction,
          outcomeStatus: trace.outcomeStatus,
          sourceTraceId: trace.id,
        },
      });
  }

  for (const step of steps) {
    if (!step.toolName) continue;
    const existingTool = await supabase
      .from("discovered_tools")
      .select("*")
      .eq("workspace_id", trace.workspaceId)
      .eq("session_id", session.id)
      .eq("tool_name", step.toolName)
      .is("mcp_server_name", step.mcpServerName ?? null)
      .limit(1)
      .maybeSingle();
    if (existingTool.error) throw new Error(existingTool.error.message);

    const argSchema = inferSchemaFromValue(step.toolArguments);
    const resultSchema = inferSchemaFromValue(step.toolResult);

    if (existingTool.data) {
      await supabase
        .from("discovered_tools")
        .update({
          argument_schema: mergeSchemas(asRecord(existingTool.data.argument_schema), argSchema),
          result_schema: mergeSchemas(asRecord(existingTool.data.result_schema), resultSchema),
          last_seen_at: trace.createdAt,
          seen_count: Number(existingTool.data.seen_count ?? 0) + 1,
        })
        .eq("id", existingTool.data.id);
    } else {
      await supabase
        .from("discovered_tools")
        .insert({
          workspace_id: trace.workspaceId,
          session_id: session.id,
          tool_name: step.toolName,
          mcp_server_name: step.mcpServerName,
          argument_schema: argSchema,
          result_schema: resultSchema,
          first_seen_at: trace.createdAt,
          last_seen_at: trace.createdAt,
          seen_count: 1,
          status: "new",
          metadata: {
            sourceTraceId: trace.id,
          },
        });
    }
  }

  const existingWorkflow = await supabase
    .from("discovered_workflows")
    .select("*")
    .eq("workspace_id", trace.workspaceId)
    .eq("workflow_shape_hash", workflowShapeHash)
    .limit(1)
    .maybeSingle();
  if (existingWorkflow.error) throw new Error(existingWorkflow.error.message);

  let workflowId: string;
  if (existingWorkflow.data) {
    workflowId = existingWorkflow.data.id;
    await supabase
      .from("discovered_workflows")
      .update({
        session_id: session.id,
        trace_id: trace.id,
        name: capabilityName,
        capability_name: capabilityName,
        steps: graph.nodes,
        edges: graph.edges,
        suggested_rules: suggestedRules,
        latency_ms: trace.totalLatencyMs,
        cost_estimate: trace.totalCostEstimate,
        source_badge: source,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existingWorkflow.data.id);

    await supabase
      .from("discovered_workflow_steps")
      .delete()
      .eq("discovered_workflow_id", existingWorkflow.data.id);
  } else {
    const createdWorkflow = await supabase
      .from("discovered_workflows")
      .insert({
        workspace_id: trace.workspaceId,
        session_id: session.id,
        name: capabilityName,
        capability_name: capabilityName,
        trace_id: trace.id,
        workflow_shape_hash: workflowShapeHash,
        steps: graph.nodes,
        edges: graph.edges,
        suggested_rules: suggestedRules,
        latency_ms: trace.totalLatencyMs,
        cost_estimate: trace.totalCostEstimate,
        status: "new",
        source_badge: source,
      })
      .select("*")
      .single();
    if (createdWorkflow.error) throw new Error(createdWorkflow.error.message);
    workflowId = createdWorkflow.data.id;
  }

  const stepRows = graph.nodes
    .filter((node) => node.type !== "agent")
    .map((node, index) => ({
      workspace_id: trace.workspaceId,
      discovered_workflow_id: workflowId,
      workflow_trace_step_id: steps.find((step) => step.stepIndex === index)?.id ?? null,
      node_id: node.id,
      parent_node_id: node.parentId,
      step_index: index,
      node_type: node.type,
      name: node.name,
      status: node.status,
      provider: node.provider,
      model: node.model,
      tool_name: node.toolName,
      mcp_server_name: node.mcpServerName,
      latency_ms: node.latencyMs,
      cost_estimate: node.costEstimate,
      input_preview: node.inputPreview,
      output_preview: node.outputPreview,
      error: node.error,
      metadata: node.metadata ?? {},
    }));
  if (stepRows.length > 0) {
    const insertedSteps = await supabase.from("discovered_workflow_steps").insert(stepRows);
    if (insertedSteps.error) throw new Error(insertedSteps.error.message);
  }

  await supabase
    .from("discovery_sessions")
    .update({
      status: "ready_for_review",
      metadata: {
        latestTraceId: trace.id,
        latestCapabilityName: capabilityName,
      },
    })
    .eq("id", session.id);

  return session.id;
}

export async function listDiscoverySessions(workspaceId: string) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("discovery_sessions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapSession(row as DiscoverySessionRow));
}

export async function getDiscoveryReview(workspaceId: string, sessionId: string): Promise<DiscoveryReview | null> {
  const supabase = createVectorBeaAdminClient();
  const [sessionRes, capabilitiesRes, toolsRes, workflowsRes, registryRes] = await Promise.all([
    supabase.from("discovery_sessions").select("*").eq("workspace_id", workspaceId).eq("id", sessionId).maybeSingle(),
    supabase.from("discovered_capabilities").select("*").eq("workspace_id", workspaceId).eq("session_id", sessionId).order("created_at", { ascending: true }),
    supabase.from("discovered_tools").select("*").eq("workspace_id", workspaceId).eq("session_id", sessionId).order("seen_count", { ascending: false }),
    supabase.from("discovered_workflows").select("*").eq("workspace_id", workspaceId).eq("session_id", sessionId).order("created_at", { ascending: false }),
    supabase.from("tool_registry").select("*").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
  ]);
  if (sessionRes.error) throw new Error(sessionRes.error.message);
  if (!sessionRes.data) return null;
  if (capabilitiesRes.error) throw new Error(capabilitiesRes.error.message);
  if (toolsRes.error) throw new Error(toolsRes.error.message);
  if (workflowsRes.error) throw new Error(workflowsRes.error.message);
  if (registryRes.error) throw new Error(registryRes.error.message);

  const existingCapabilities = await listCapabilities(workspaceId);

  return {
    session: mapSession(sessionRes.data as DiscoverySessionRow),
    capabilities: (capabilitiesRes.data ?? []).map((row) => mapCapability(row as DiscoveredCapabilityRow)),
    tools: (toolsRes.data ?? []).map((row) => mapTool(row as DiscoveredToolRow)),
    workflows: (workflowsRes.data ?? []).map((row) => mapWorkflow(row as DiscoveredWorkflowRow)),
    toolRegistry: (registryRes.data ?? []).map((row) => mapRegistry(row as ToolRegistryRow)),
    existingCapabilities,
  };
}

export async function getDiscoveredWorkflow(workspaceId: string, workflowId: string) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("discovered_workflows")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", workflowId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapWorkflow(data as DiscoveredWorkflowRow) : null;
}

export async function getDiscoveredWorkflowByTrace(workspaceId: string, traceId: string) {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("discovered_workflows")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("trace_id", traceId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? mapWorkflow(data as DiscoveredWorkflowRow) : null;
}

export async function confirmDiscoveredCapability(args: {
  workspaceId: string;
  sessionId: string;
  discoveredCapabilityId: string;
  userId: string;
  mergeIntoCapabilityId?: string | null;
}) {
  const supabase = createVectorBeaAdminClient();
  const review = await getDiscoveryReview(args.workspaceId, args.sessionId);
  if (!review) throw new Error("Discovery session not found.");
  const discovered = review.capabilities.find((item) => item.id === args.discoveredCapabilityId);
  if (!discovered) throw new Error("Discovered capability not found.");

  let capability: AiCapability | null = null;
  if (args.mergeIntoCapabilityId) {
    capability = review.existingCapabilities.find((item) => item.id === args.mergeIntoCapabilityId) ?? null;
  }

  if (!capability) {
    capability = await createCapability({
      workspaceId: args.workspaceId,
      name: discovered.suggestedName,
      description: `Confirmed from workflow discovery in ${discovered.environment ?? "an unknown environment"}.`,
      type: discovered.suggestedType,
      businessDomain: "general",
      riskLevel: "medium",
      ownerUserId: args.userId,
      promptId: null,
      createdBy: args.userId,
    });
  }

  const primaryWorkflow = review.workflows[0];
  const activeVersion = capability.activeVersion;
  const version = await createVersion({
    workspaceId: args.workspaceId,
    capabilityId: capability.id,
    name: `${discovered.suggestedName} discovered`,
    status: "draft",
    baseVersionId: activeVersion?.id ?? null,
    workflowDefinition: primaryWorkflow ? {
      sourceWorkflowId: primaryWorkflow.id,
      shapeHash: primaryWorkflow.workflowShapeHash,
      graphNodes: primaryWorkflow.graphNodes,
      graphEdges: primaryWorkflow.graphEdges,
      suggestedRules: primaryWorkflow.suggestedRules,
    } : null,
    createdBy: args.userId,
  });

  await supabase
    .from("discovered_capabilities")
    .update({
      status: capability.id === args.mergeIntoCapabilityId ? "merged" : "confirmed",
      matched_capability_id: capability.id,
    })
    .eq("id", discovered.id);

  await supabase
    .from("discovery_sessions")
    .update({ status: "confirmed" })
    .eq("id", args.sessionId);

  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.userId,
    eventType: "capability_created",
    entityType: "discovered_capability",
    entityId: capability.id,
    entityName: capability.name,
    metadata: {
      discoverySessionId: args.sessionId,
      discoveredCapabilityId: discovered.id,
      createdVersionId: version.id,
    },
  });

  return { capability, version };
}

export async function confirmDiscoveredTools(args: {
  workspaceId: string;
  sessionId: string;
  toolIds: string[];
  userId: string;
  renameMap?: Record<string, string>;
  mergeMap?: Record<string, string>;
}) {
  const supabase = createVectorBeaAdminClient();
  const review = await getDiscoveryReview(args.workspaceId, args.sessionId);
  if (!review) throw new Error("Discovery session not found.");

  const created: ToolRegistryEntry[] = [];
  for (const toolId of args.toolIds) {
    const discovered = review.tools.find((item) => item.id === toolId);
    if (!discovered) continue;

    if (args.mergeMap?.[toolId]) {
      await supabase
        .from("discovered_tools")
        .update({ status: "merged" })
        .eq("id", toolId);
      continue;
    }

    const name = args.renameMap?.[toolId]?.trim() || discovered.toolName;
    const existing = review.toolRegistry.find((entry) =>
      entry.name.trim().toLowerCase() === name.trim().toLowerCase() &&
      (entry.mcpServerName ?? null) === (discovered.mcpServerName ?? null),
    );
    if (existing) {
      await supabase
        .from("discovered_tools")
        .update({ status: "merged" })
        .eq("id", toolId);
      continue;
    }

    const inserted = await supabase
      .from("tool_registry")
      .insert({
        workspace_id: args.workspaceId,
        name,
        description: `Discovered automatically from workflow traces.`,
        mcp_server_name: discovered.mcpServerName,
        argument_schema: discovered.argumentSchema,
        result_schema: discovered.resultSchema,
        first_seen_at: discovered.firstSeenAt,
        last_seen_at: discovered.lastSeenAt,
        created_from_discovery_id: discovered.id,
      })
      .select("*")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);

    await supabase
      .from("discovered_tools")
      .update({ status: "confirmed" })
      .eq("id", discovered.id);

    created.push(mapRegistry(inserted.data as ToolRegistryRow));

    await writeAuditEvent({
      workspaceId: args.workspaceId,
      actorUserId: args.userId,
      eventType: "policy_pack_updated",
      entityType: "tool_registry",
      entityId: inserted.data.id,
      entityName: name,
      metadata: {
        discoverySessionId: args.sessionId,
        discoveredToolId: discovered.id,
        tokenSafe: true,
      },
    });
  }

  return created;
}

export async function ignoreDiscoverySession(args: {
  workspaceId: string;
  sessionId: string;
}) {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("discovery_sessions")
    .update({ status: "ignored" })
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.sessionId);
  if (error) throw new Error(error.message);
}

export async function createRegressionSuiteFromTrace(args: {
  workspaceId: string;
  traceId: string;
  userId: string;
  capabilityId?: string | null;
}) {
  const supabase = createVectorBeaAdminClient();
  const trace = await import("@/lib/server/workflow-traces").then((mod) => mod.getWorkflowTrace(args.workspaceId, args.traceId));
  if (!trace) throw new Error("Workflow trace not found.");

  const capabilityId = args.capabilityId ?? trace.capabilityId;
  if (!capabilityId) throw new Error("Trace is not linked to a capability yet.");

  const suite = await createRegressionSuite({
    workspaceId: args.workspaceId,
    capabilityId,
    name: `${inferCapabilityName(trace)} regression suite`,
    description: `Created from workflow trace ${trace.id}.`,
    suiteType: "deterministic_workflow",
    enabled: true,
    createdBy: args.userId,
  });

  const toolSequence = (trace.steps ?? [])
    .filter((step) => step.toolName)
    .map((step) => step.toolName as string);

  await createRegressionCase({
    workspaceId: args.workspaceId,
    suiteId: suite.id,
    name: `Trace ${trace.id.slice(0, 8)} baseline`,
    description: "Generated automatically from a discovered workflow trace.",
    inputPayload: {
      userInput: trace.userInput,
      finalAction: trace.finalAction,
    },
    expectedToolSequence: toolSequence,
    forbiddenTools: [],
    requiredTools: toolSequence,
    expectedOutcome: trace.finalBusinessOutcome ?? trace.outcomeStatus ?? trace.finalAction ?? null,
    expectedFinalAction: trace.finalAction ?? null,
    rules: {
      sourceTraceId: trace.id,
    },
    tags: ["auto_discovery", "trace_generated"],
    riskLevel: "medium",
    sourceTraceId: trace.id,
    createdBy: args.userId,
  });

  await writeAuditEvent({
    workspaceId: args.workspaceId,
    actorUserId: args.userId,
    eventType: "regression_suite_created",
    entityType: "workflow_trace",
    entityId: trace.id,
    entityName: suite.name,
    metadata: {
      createdFromTraceId: trace.id,
      suiteId: suite.id,
    },
  });

  const discoveredWorkflow = await getDiscoveredWorkflowByTrace(args.workspaceId, trace.id);
  if (discoveredWorkflow) {
    await supabase
      .from("discovered_workflows")
      .update({ status: "confirmed" })
      .eq("id", discoveredWorkflow.id);
  }

  return suite;
}
