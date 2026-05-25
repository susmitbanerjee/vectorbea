/**
 * Vectorbea Platform Repository
 *
 * All functions call real backend API routes backed by PostgreSQL.
 * No mock data, no seed data, no in-memory stores.
 *
 * Server components: pass workspaceId via getActiveWorkspaceId().
 * Client components: same — workspaceId is resolved from URL or localStorage
 *   as a non-sensitive routing hint (never used as authorization boundary;
 *   the API enforces workspace membership).
 *
 * IMPORTANT: No secrets are stored or passed through this layer.
 */

import type {
  Agent,
  AgentRun,
  PaginatedResult,
  RunEvent,
  RunFilters,
  Tool,
  Workflow,
  WorkflowFilters,
  WorkflowVersion,
} from "@/types/platform";
import type { WorkflowGraph } from "@/types/workflow-graph";

// ─── Re-export connections module ─────────────────────────────────────────────
export {
  getConnections,
  getConnection,
  getConnectionsByType,
  getCompatibleConnectionsForTool,
  getCompatibleConnectionsForAgent,
  createConnection,
  updateConnection,
  deleteConnection,
  testConnection,
} from "./connections";

// ─── Workspace resolution ─────────────────────────────────────────────────────

function getActiveWorkspaceId(): string {
  if (typeof window === "undefined") {
    // Server-side: fall back to env (only used in server-side repository calls)
    return process.env.MOCK_ORG_ID ?? "";
  }
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("org")?.trim() ?? params.get("workspaceId")?.trim();
  if (fromQuery) return fromQuery;
  // localStorage as routing hint only — NOT used for authorization
  const fromStorage = window.localStorage.getItem("vectorbea.activeWorkspaceId")?.trim();
  if (fromStorage) return fromStorage;
  return "";
}

function withWorkspace(path: string, workspaceId?: string): string {
  const wsId = workspaceId ?? getActiveWorkspaceId();
  if (!wsId) return path;
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}workspaceId=${encodeURIComponent(wsId)}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `API error ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ─── Workflows ────────────────────────────────────────────────────────────────

export async function getWorkflows(filters: WorkflowFilters = {}): Promise<PaginatedResult<Workflow>> {
  const { search, status, page = 1, pageSize = 20 } = filters;
  const params = new URLSearchParams();
  if (search)   params.set("search", search);
  if (status)   params.set("status", status);
  params.set("page",     String(page));
  params.set("pageSize", String(pageSize));

  const query = params.toString();
  return api<PaginatedResult<Workflow>>(withWorkspace(`/api/platform/workflows${query ? `?${query}` : ""}`));
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  try {
    return await api<Workflow>(withWorkspace(`/api/platform/workflows/${id}`));
  } catch {
    return null;
  }
}

export async function createWorkflow(payload: Partial<Workflow>): Promise<Workflow> {
  return api<Workflow>(withWorkspace("/api/platform/workflows"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateWorkflow(id: string, payload: Partial<Workflow>): Promise<Workflow | null> {
  try {
    return await api<Workflow>(withWorkspace(`/api/platform/workflows/${id}`), {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
}

export async function deleteWorkflow(id: string): Promise<void> {
  await api<void>(withWorkspace(`/api/platform/workflows/${id}`), { method: "DELETE" });
}

// ─── Workflow Graphs ──────────────────────────────────────────────────────────

export async function getWorkflowGraph(workflowId: string): Promise<WorkflowGraph | null> {
  try {
    return await api<WorkflowGraph | null>(withWorkspace(`/api/platform/workflows/${workflowId}/graph`));
  } catch {
    return null;
  }
}

export async function saveWorkflowGraph(workflowId: string, graph: WorkflowGraph): Promise<void> {
  await api<void>(withWorkspace(`/api/platform/workflows/${workflowId}/graph`), {
    method: "PUT",
    body: JSON.stringify({ graph }),
  });
}

// ─── Workflow Versions ────────────────────────────────────────────────────────

export async function getWorkflowVersions(_workflowId: string): Promise<WorkflowVersion[]> {
  return []; // Future: GET /api/platform/workflows/:id/versions
}

export async function saveWorkflowVersion(_workflowId: string, _graph: WorkflowGraph): Promise<WorkflowVersion> {
  throw new Error("saveWorkflowVersion: not yet implemented in real backend");
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export async function getAgents(): Promise<Agent[]> {
  try {
    return await api<Agent[]>(withWorkspace("/api/platform/agents"));
  } catch {
    return [];
  }
}

export async function getAgent(id: string): Promise<Agent | null> {
  try {
    return await api<Agent>(withWorkspace(`/api/platform/agents/${id}`));
  } catch {
    return null;
  }
}

export async function createAgent(payload: Partial<Agent>): Promise<Agent> {
  return api<Agent>(withWorkspace("/api/platform/agents"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAgent(id: string, payload: Partial<Agent>): Promise<Agent | null> {
  try {
    return await api<Agent>(withWorkspace(`/api/platform/agents/${id}`), {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
}

export async function deleteAgent(id: string): Promise<void> {
  await api<void>(withWorkspace(`/api/platform/agents/${id}`), { method: "DELETE" });
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export async function getTools(): Promise<Tool[]> {
  try {
    return await api<Tool[]>(withWorkspace("/api/platform/tools"));
  } catch {
    return [];
  }
}

export async function getTool(id: string): Promise<Tool | null> {
  try {
    return await api<Tool>(withWorkspace(`/api/platform/tools/${id}`));
  } catch {
    return null;
  }
}

export async function createTool(payload: Partial<Tool>): Promise<Tool> {
  return api<Tool>(withWorkspace("/api/platform/tools"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTool(id: string, payload: Partial<Tool>): Promise<Tool | null> {
  try {
    return await api<Tool>(withWorkspace(`/api/platform/tools/${id}`), {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
}

export async function deleteTool(id: string): Promise<void> {
  await api<void>(withWorkspace(`/api/platform/tools/${id}`), { method: "DELETE" });
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

export async function getRuns(filters: RunFilters = {}): Promise<PaginatedResult<AgentRun>> {
  const { search, status, workflowId, page = 1, pageSize = 25 } = filters;
  const params = new URLSearchParams();
  if (search)     params.set("search", search);
  if (status)     params.set("status", status);
  if (workflowId) params.set("workflowId", workflowId);
  params.set("page",     String(page));
  params.set("pageSize", String(pageSize));

  const query = params.toString();
  try {
    return await api<PaginatedResult<AgentRun>>(withWorkspace(`/api/platform/runs${query ? `?${query}` : ""}`));
  } catch {
    return { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 };
  }
}

export async function getRun(id: string): Promise<AgentRun | null> {
  try {
    return await api<AgentRun>(withWorkspace(`/api/platform/runs/${id}`));
  } catch {
    return null;
  }
}

export async function createRun(workflowId: string, input: unknown): Promise<AgentRun> {
  const [workflow, graph] = await Promise.all([
    getWorkflow(workflowId),
    getWorkflowGraph(workflowId),
  ]);

  // Extract agent and tool IDs referenced in the graph
  const agentIds = new Set<string>();
  const toolIds = new Set<string>();
  for (const node of graph?.nodes ?? []) {
    if (node.type === "agent" && node.data.agentConfig?.agentId) {
      agentIds.add(node.data.agentConfig.agentId);
    }
    if (node.type === "tool" && node.data.toolConfig?.toolId) {
      toolIds.add(node.data.toolConfig.toolId);
    }
  }

  // Fetch actual records to get connection IDs (resolved server-side)
  const [agentRecords, toolRecords] = await Promise.all([
    agentIds.size > 0 ? getAgents() : Promise.resolve([]),
    toolIds.size > 0 ? getTools() : Promise.resolve([]),
  ]);

  const agentDefs = agentRecords
    .filter((a) => agentIds.has(a.id))
    .map((a) => ({
      agentId: a.id,
      agentName: a.name,
      llmConnectionId: a.llmConnectionId ?? null,
    }));

  const toolDefs = toolRecords
    .filter((t) => toolIds.has(t.id))
    .map((t) => ({
      toolId: t.id,
      toolName: t.name,
      connectionId: t.connectionId ?? null,
      connectionType: t.type ?? undefined,
    }));

  return api<AgentRun>(withWorkspace("/api/platform/runs"), {
    method: "POST",
    body: JSON.stringify({
      workflowId,
      workflowName: workflow?.name ?? "Unnamed Workflow",
      workflowVersion: workflow?.currentVersion ?? "v1",
      creationMode: workflow?.creationMode ?? "native",
      triggerType: "manual",
      triggerSource: "manual",
      input,
      agentDefs,
      toolDefs,
    }),
  });
}

export async function getRunEvents(runId: string): Promise<RunEvent[]> {
  try {
    return await api<RunEvent[]>(withWorkspace(`/api/platform/runs/${runId}/events`));
  } catch {
    return [];
  }
}

export async function getRunTimeline(runId: string): Promise<import("@/types/agent-run-ui").RunTimelineEventUi[]> {
  try {
    return await api<import("@/types/agent-run-ui").RunTimelineEventUi[]>(
      withWorkspace(`/api/platform/runs/${runId}/events`),
    );
  } catch {
    return [];
  }
}

// ─── Trigger workflow (new executor-backed path) ──────────────────────────────

/**
 * Trigger a workflow run using the new fine-grained executor.
 * The workflow graph is loaded and executed server-side.
 */
export async function triggerWorkflow(
  workflowId: string,
  input: unknown,
  opts: { dryRun?: boolean } = {},
): Promise<AgentRun & { runId?: string; executionResult?: unknown }> {
  return api<AgentRun & { runId?: string; executionResult?: unknown }>(
    withWorkspace(`/api/platform/workflows/${workflowId}/run`),
    {
      method: "POST",
      body: JSON.stringify({ input, dryRun: opts.dryRun ?? false, triggerType: "manual" }),
    },
  );
}

/**
 * Test a single workflow node in isolation.
 * Returns resolved inputs, raw output, extracted output, and validation results.
 */
export async function testWorkflowNode(
  workflowId: string,
  nodeId: string,
  opts: {
    testInput?: Record<string, unknown>;
    workflowInput?: Record<string, unknown>;
    stepOutputs?: Record<string, unknown>;
    dryRun?: boolean;
  } = {},
): Promise<unknown> {
  return api<unknown>(
    withWorkspace(`/api/platform/workflows/${workflowId}/nodes/${nodeId}/test`),
    {
      method: "POST",
      body: JSON.stringify(opts),
    },
  );
}

/**
 * Discover the schema of a database connection.
 */
export async function discoverConnectionSchema(connectionId: string): Promise<unknown> {
  return api<unknown>(withWorkspace(`/api/connections/${connectionId}/discover-schema`), { method: "POST" });
}

/**
 * List available models for an LLM provider connection.
 */
export async function listConnectionModels(connectionId: string): Promise<{ models: Array<{ id: string; name: string }>; provider: string }> {
  return api<{ models: Array<{ id: string; name: string }>; provider: string }>(
    withWorkspace(`/api/connections/${connectionId}/list-models`),
    { method: "POST" },
  );
}

// ─── Runs for agent/tool (analytics) ─────────────────────────────────────────

export async function getRunsForAgent(_agentId: string): Promise<AgentRun[]> {
  return []; // Future: filter by agentId in runs
}

export async function getCallsForTool(_toolId: string): Promise<unknown[]> {
  return []; // Future: filter by toolId in run events
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export async function getPendingApprovals(): Promise<unknown[]> {
  try {
    return await api<unknown[]>(withWorkspace("/api/approvals?status=PENDING"));
  } catch {
    return [];
  }
}

export async function approveRunGate(_runId: string, _approvalId: string, _reason?: string): Promise<void> {
  await api<void>(withWorkspace(`/api/approvals/${_approvalId}/approve`), {
    method: "POST",
    body: JSON.stringify({ reason: _reason }),
  });
}

export async function rejectRunGate(_runId: string, _approvalId: string, _reason?: string): Promise<void> {
  await api<void>(withWorkspace(`/api/approvals/${_approvalId}/reject`), {
    method: "POST",
    body: JSON.stringify({ reason: _reason }),
  });
}

// ─── Checkpoints / replay (stubs) ────────────────────────────────────────────

export async function listRunCheckpoints(_runId: string): Promise<unknown[]> {
  return [];
}

export async function replayWorkflowRun(_runId: string, _fromCheckpoint?: string): Promise<AgentRun> {
  throw new Error("Replay is not yet implemented.");
}

export async function retryRunFailedStep(_runId: string, _stepId: string): Promise<AgentRun> {
  throw new Error("Step retry is not yet implemented.");
}

// ─── Platform summary ─────────────────────────────────────────────────────────

const PLATFORM_SUMMARY_ZERO = {
  totalWorkflows: 0, activeWorkflows: 0,
  totalAgents: 0, totalTools: 0, totalRuns: 0,
  runningRuns: 0, waitingApprovals: 0,
  failedRuns24h: 0, succeededRuns24h: 0,
  totalTokens24h: 0, totalCost24h: 0,
  connectedWorkers: 0,
};

export async function getPlatformSummary() {
  try {
    const wsId = getActiveWorkspaceId();
    if (!wsId) return PLATFORM_SUMMARY_ZERO;
    return await api<typeof PLATFORM_SUMMARY_ZERO>(withWorkspace("/api/platform/summary"));
  } catch {
    return PLATFORM_SUMMARY_ZERO;
  }
}
