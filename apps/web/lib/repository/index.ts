/**
 * Vectorbea Platform Repository
 *
 * All functions call the Kotlin API (NEXT_PUBLIC_VECTORBEA_API_URL).
 * No mock data, no seed data, no in-memory stores.
 * No DB, Redis, secrets, or runtime/executor imports.
 *
 * Server components: pass workspaceId via getActiveWorkspaceId().
 * Client components: same — workspaceId is resolved from URL or localStorage
 *   as a non-sensitive routing hint (never used as authorization boundary;
 *   the Kotlin API enforces workspace membership).
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
import { apiFetch, getActiveWorkspaceId, withWorkspace } from "@/lib/api/client";

// Re-export SSE streaming helper so call sites import from a single place
export { streamRunEvents } from "@/lib/api/client";
export type { RunStreamEvent, RunStreamCallback } from "@/lib/api/client";

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

// ─── Internal fetch alias (delegates to typed API client) ─────────────────────

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { method = "GET", body, headers, ...rest } = init ?? {};
  const parsedBody = typeof body === "string" ? (JSON.parse(body) as unknown) : undefined;
  return apiFetch<T>(path, {
    method,
    ...(parsedBody !== undefined ? { json: parsedBody } : {}),
    headers: headers as Record<string, string> | undefined,
    ...rest,
  });
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
  try {
    return await api<PaginatedResult<Workflow>>(withWorkspace(`/api/workflows${query ? `?${query}` : ""}`));
  } catch {
    return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
  }
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  try {
    return await api<Workflow>(withWorkspace(`/api/workflows/${id}`));
  } catch {
    return null;
  }
}

export async function createWorkflow(payload: Partial<Workflow>): Promise<Workflow> {
  return api<Workflow>(withWorkspace("/api/workflows"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateWorkflow(id: string, payload: Partial<Workflow>): Promise<Workflow | null> {
  try {
    return await api<Workflow>(withWorkspace(`/api/workflows/${id}`), {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
}

export async function deleteWorkflow(id: string): Promise<void> {
  await api<void>(withWorkspace(`/api/workflows/${id}`), { method: "DELETE" });
}

// ─── Workflow Graphs ──────────────────────────────────────────────────────────

export async function getWorkflowGraph(workflowId: string): Promise<WorkflowGraph | null> {
  try {
    const wf = await api<Workflow & { graph?: WorkflowGraph }>(withWorkspace(`/api/workflows/${workflowId}`));
    return wf?.graph ?? null;
  } catch {
    return null;
  }
}

export async function saveWorkflowGraph(workflowId: string, graph: WorkflowGraph): Promise<void> {
  await api<void>(withWorkspace(`/api/workflows/${workflowId}`), {
    method: "PATCH",
    body: JSON.stringify({ graph }),
  });
}

// ─── Workflow Versions ────────────────────────────────────────────────────────

export async function getWorkflowVersions(_workflowId: string): Promise<WorkflowVersion[]> {
  return []; // Future: GET /api/workflows/:id/versions
}

export async function saveWorkflowVersion(_workflowId: string, _graph: WorkflowGraph): Promise<WorkflowVersion> {
  throw new Error("saveWorkflowVersion: not yet implemented in Kotlin API");
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export async function getAgents(): Promise<Agent[]> {
  try {
    return await api<Agent[]>(withWorkspace("/api/agents"));
  } catch {
    return [];
  }
}

export async function getAgent(id: string): Promise<Agent | null> {
  try {
    return await api<Agent>(withWorkspace(`/api/agents/${id}`));
  } catch {
    return null;
  }
}

export async function createAgent(payload: Partial<Agent>): Promise<Agent> {
  return api<Agent>(withWorkspace("/api/agents"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateAgent(id: string, payload: Partial<Agent>): Promise<Agent | null> {
  try {
    return await api<Agent>(withWorkspace(`/api/agents/${id}`), {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
}

export async function deleteAgent(id: string): Promise<void> {
  await api<void>(withWorkspace(`/api/agents/${id}`), { method: "DELETE" });
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export async function getTools(): Promise<Tool[]> {
  try {
    return await api<Tool[]>(withWorkspace("/api/tools"));
  } catch {
    return [];
  }
}

export async function getTool(id: string): Promise<Tool | null> {
  try {
    return await api<Tool>(withWorkspace(`/api/tools/${id}`));
  } catch {
    return null;
  }
}

export async function createTool(payload: Partial<Tool>): Promise<Tool> {
  return api<Tool>(withWorkspace("/api/tools"), {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTool(id: string, payload: Partial<Tool>): Promise<Tool | null> {
  try {
    return await api<Tool>(withWorkspace(`/api/tools/${id}`), {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  } catch {
    return null;
  }
}

export async function deleteTool(id: string): Promise<void> {
  await api<void>(withWorkspace(`/api/tools/${id}`), { method: "DELETE" });
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
    return await api<PaginatedResult<AgentRun>>(withWorkspace(`/api/runs${query ? `?${query}` : ""}`));
  } catch {
    return { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 };
  }
}

export async function getRun(id: string): Promise<AgentRun | null> {
  try {
    return await api<AgentRun>(withWorkspace(`/api/runs/${id}`));
  } catch {
    return null;
  }
}

export async function getRunEvents(runId: string): Promise<RunEvent[]> {
  try {
    const page = await api<{ items: RunEvent[] }>(withWorkspace(`/api/runs/${runId}/events`));
    return page.items ?? [];
  } catch {
    return [];
  }
}

export async function getRunTimeline(runId: string): Promise<import("@/types/agent-run-ui").RunTimelineEventUi[]> {
  try {
    const page = await api<{ items: import("@/types/agent-run-ui").RunTimelineEventUi[] }>(
      withWorkspace(`/api/runs/${runId}/events`),
    );
    return page.items ?? [];
  } catch {
    return [];
  }
}

export async function cancelRun(runId: string): Promise<void> {
  await api<void>(withWorkspace(`/api/runs/${runId}/cancel`), { method: "POST" });
}

// ─── Trigger workflow ─────────────────────────────────────────────────────────

/**
 * Trigger a workflow run via the Kotlin API.
 * Calls POST /api/workflows/:id/run.
 */
export async function triggerWorkflow(
  workflowId: string,
  input: unknown,
  opts: { dryRun?: boolean; idempotencyKey?: string; triggerType?: string } = {},
): Promise<{ runId: string; status: string }> {
  return api<{ runId: string; status: string }>(
    withWorkspace(`/api/workflows/${workflowId}/run`),
    {
      method: "POST",
      body: JSON.stringify({
        input,
        triggerType: opts.triggerType ?? "manual",
        ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
      }),
    },
  );
}

/**
 * runWorkflow — alias for triggerWorkflow.
 */
export async function runWorkflow(
  workflowId: string,
  input: Record<string, unknown> = {},
  opts: { idempotencyKey?: string; triggerType?: string } = {},
): Promise<{ runId: string; status: string }> {
  return triggerWorkflow(workflowId, input, opts);
}

/**
 * createRun — triggers a workflow run via the Kotlin API.
 * Kept for backward compatibility; delegates to triggerWorkflow.
 */
export async function createRun(workflowId: string, input: unknown): Promise<AgentRun> {
  const result = await triggerWorkflow(workflowId, input);
  // Return a minimal AgentRun-compatible object with the new run ID
  return { id: result.runId, status: result.status, workflowId } as AgentRun;
}

/**
 * Test a single workflow node in isolation.
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
    withWorkspace(`/api/workflows/${workflowId}/nodes/${nodeId}/test`),
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
  return []; // Future: filter by agentId in /api/runs
}

export async function getCallsForTool(_toolId: string): Promise<unknown[]> {
  return []; // Future: filter by toolId in /api/runs/events
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export interface ApprovalItem {
  id: string;
  runId: string;
  nodeId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  message?: string;
  resolvedBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovalPage {
  items: ApprovalItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export async function getPendingApprovals(): Promise<ApprovalItem[]> {
  try {
    const page = await api<ApprovalPage>(withWorkspace("/api/approvals?status=PENDING"));
    return page.items ?? [];
  } catch {
    return [];
  }
}

export async function getApprovals(params: {
  status?: string;
  page?: number;
  pageSize?: number;
} = {}): Promise<ApprovalPage> {
  const qs = new URLSearchParams();
  if (params.status)   qs.set("status", params.status);
  if (params.page)     qs.set("page", String(params.page));
  if (params.pageSize) qs.set("pageSize", String(params.pageSize));
  const q = qs.toString();
  try {
    return await api<ApprovalPage>(withWorkspace(`/api/approvals${q ? `?${q}` : ""}`));
  } catch {
    return { items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 };
  }
}

export async function approveRunGate(_runId: string, approvalId: string, reason?: string): Promise<void> {
  await api<void>(withWorkspace(`/api/approvals/${approvalId}/approve`), {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

export async function rejectRunGate(_runId: string, approvalId: string, reason?: string): Promise<void> {
  await api<void>(withWorkspace(`/api/approvals/${approvalId}/reject`), {
    method: "POST",
    body: JSON.stringify({ reason }),
  });
}

// ─── Workers ──────────────────────────────────────────────────────────────────

export interface WorkerItem {
  id: string;
  status: "CONNECTED" | "IDLE" | "DISCONNECTED";
  queue?: string;
  activeTasks?: number;
  maxCapacity?: number;
  heartbeat?: string;
  version?: string;
  host?: string;
  region?: string;
  uptimeHrs?: number;
}

export async function getWorkers(): Promise<WorkerItem[]> {
  try {
    return await api<WorkerItem[]>(withWorkspace("/api/workers"));
  } catch {
    return [];
  }
}

// ─── Checkpoints / replay / retry ────────────────────────────────────────────

export async function listRunCheckpoints(_runId: string): Promise<unknown[]> {
  return [];
}

export async function replayWorkflowRun(runId: string, fromCheckpoint?: string): Promise<AgentRun> {
  return api<AgentRun>(withWorkspace(`/api/runs/${runId}/replay`), {
    method: "POST",
    body: JSON.stringify(fromCheckpoint ? { fromCheckpoint } : {}),
  });
}

export async function retryRunFailedStep(runId: string, stepId: string): Promise<AgentRun> {
  return api<AgentRun>(withWorkspace(`/api/runs/${runId}/retry`), {
    method: "POST",
    body: JSON.stringify(stepId ? { stepId } : {}),
  });
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
  const wsId = getActiveWorkspaceId();
  if (!wsId) return PLATFORM_SUMMARY_ZERO;

  // Aggregate from multiple Kotlin API calls in parallel
  const [workflowsResult, agentsResult, toolsResult, runsResult, approvalsResult, workersResult] =
    await Promise.allSettled([
      api<PaginatedResult<Workflow>>(withWorkspace("/api/workflows?page=1&pageSize=1")),
      api<Agent[]>(withWorkspace("/api/agents")),
      api<Tool[]>(withWorkspace("/api/tools")),
      api<PaginatedResult<AgentRun>>(withWorkspace("/api/runs?page=1&pageSize=1")),
      api<ApprovalPage>(withWorkspace("/api/approvals?status=PENDING&page=1&pageSize=1")),
      api<WorkerItem[]>(withWorkspace("/api/workers")),
    ]);

  const workflows = workflowsResult.status === "fulfilled" ? workflowsResult.value : null;
  const agents    = agentsResult.status === "fulfilled" ? agentsResult.value : [];
  const tools     = toolsResult.status === "fulfilled" ? toolsResult.value : [];
  const runs      = runsResult.status === "fulfilled" ? runsResult.value : null;
  const approvals = approvalsResult.status === "fulfilled" ? approvalsResult.value : null;
  const workers   = workersResult.status === "fulfilled" ? workersResult.value : [];

  return {
    totalWorkflows:   workflows?.total ?? 0,
    activeWorkflows:  0, // Kotlin API doesn't expose active count separately
    totalAgents:      Array.isArray(agents) ? agents.length : 0,
    totalTools:       Array.isArray(tools) ? tools.length : 0,
    totalRuns:        runs?.total ?? 0,
    runningRuns:      0, // Future: add status=running filter
    waitingApprovals: approvals?.total ?? 0,
    failedRuns24h:    0, // Future: add since query param
    succeededRuns24h: 0,
    totalTokens24h:   0,
    totalCost24h:     0,
    connectedWorkers: Array.isArray(workers) ? workers.filter(w => w.status === "CONNECTED").length : 0,
  };
}
