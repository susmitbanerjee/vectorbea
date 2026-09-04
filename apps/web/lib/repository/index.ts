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
  ToolType,
  Workflow,
  WorkflowFilters,
  WorkflowVersion,
} from "@/types/platform";
import type { WorkflowGraph } from "@/types/workflow-graph";
import { apiFetch, getActiveWorkspaceId, withWorkspace } from "@/lib/api/client";
export { apiFetch } from "@/lib/api/client";

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
  testUnsavedConnection,
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

// ─── Me / workspace bootstrap ─────────────────────────────────────────────────

export interface MeWorkspace {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export interface MeResponse {
  user: { id: string; supabaseUserId: string; email: string | null };
  workspaces: MeWorkspace[];
  defaultWorkspaceId: string | null;
}

/**
 * Fetch the current user's identity + workspace memberships from the Kotlin API.
 * Call this after every login to discover authorized workspaces.
 */
export async function getMe(): Promise<MeResponse> {
  return apiFetch<MeResponse>("/api/me");
}

/**
 * Create a new workspace. The authenticated user becomes the owner.
 */
export async function createWorkspace(name: string, slug?: string): Promise<MeWorkspace> {
  return apiFetch<MeWorkspace>("/api/workspaces", {
    method: "POST",
    json: { name, slug },
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

// ─── Workflow Graphs (persisted via workflow versions) ────────────────────────

/**
 * Loads the graph from the latest workflow version.
 * Calls GET /api/workflows/:id/versions and picks the first (most recent) entry.
 * Returns null if no version exists yet (brand-new workflow).
 */
export async function getWorkflowGraph(workflowId: string): Promise<WorkflowGraph | null> {
  try {
    const res = await api<{ items: WorkflowVersion[]; total: number }>(
      withWorkspace(`/api/workflows/${workflowId}/versions?page=1&pageSize=1`)
    );
    const latest = res?.items?.[0];
    if (!latest?.graph) return null;
    // graph may arrive as a parsed object or a JSON string depending on API version
    if (typeof latest.graph === "string") {
      try { return JSON.parse(latest.graph) as WorkflowGraph; } catch { return null; }
    }
    return latest.graph as WorkflowGraph;
  } catch {
    return null;
  }
}

/**
 * Pulls the trigger node's config out of the graph so it can be persisted on the
 * version's `triggerConfig`. The cron expression / timezone live on the trigger
 * node in the canvas; without this, the backend never sees them and no schedule
 * is created.
 */
function extractTriggerConfig(graph: WorkflowGraph): Record<string, unknown> {
  const triggerNode = graph.nodes?.find(
    (n) => n.type === "trigger" || n.data?.nodeType === "trigger",
  );
  const cfg = triggerNode?.data?.triggerConfig;
  return cfg && typeof cfg === "object" ? (cfg as unknown as Record<string, unknown>) : {};
}

/**
 * Saves the graph by creating a new workflow version.
 * Calls POST /api/workflows/:id/versions with the full graph.
 */
export async function saveWorkflowGraph(workflowId: string, graph: WorkflowGraph): Promise<void> {
  const triggerConfig = extractTriggerConfig(graph);
  await api<WorkflowVersion>(withWorkspace(`/api/workflows/${workflowId}/versions`), {
    method: "POST",
    body: JSON.stringify({
      graph,
      inputSchema: (triggerConfig.inputSchema as Record<string, unknown>) ?? {},
      outputSchema: {},
      triggerConfig,
      retryPolicy: {},
      timeoutPolicy: {},
      budgetPolicy: {},
      replaySupport: "full",
    }),
  });
}

// ─── Workflow Versions ────────────────────────────────────────────────────────

export async function getWorkflowVersions(workflowId: string): Promise<WorkflowVersion[]> {
  try {
    const res = await api<{ items: WorkflowVersion[]; total: number }>(
      withWorkspace(`/api/workflows/${workflowId}/versions`)
    );
    return res?.items ?? [];
  } catch {
    return [];
  }
}

export async function saveWorkflowVersion(workflowId: string, graph: WorkflowGraph): Promise<WorkflowVersion> {
  const triggerConfig = extractTriggerConfig(graph);
  return api<WorkflowVersion>(withWorkspace(`/api/workflows/${workflowId}/versions`), {
    method: "POST",
    body: JSON.stringify({
      graph,
      inputSchema: (triggerConfig.inputSchema as Record<string, unknown>) ?? {},
      outputSchema: {},
      triggerConfig,
      retryPolicy: {},
      timeoutPolicy: {},
      budgetPolicy: {},
      replaySupport: "full",
    }),
  });
}

// ─── Agents ───────────────────────────────────────────────────────────────────

export async function getAgents(): Promise<Agent[]> {
  try {
    const res = await api<{ items: Agent[] } | Agent[]>(withWorkspace("/api/agents"));
    return Array.isArray(res) ? res : (res as { items: Agent[] }).items ?? [];
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

// ─── Tool type vocabulary ─────────────────────────────────────────────────────
//
// The frontend uses descriptive ToolType values that are meaningful in the UI.
// The Kotlin backend only accepts its own allowlist:
//   "http" | "database" | "code" | "builtin" | "llm_generate" | "custom"
//
// This map translates before every POST/PATCH. The original friendly type is
// preserved in config.uiToolType so the frontend can reconstruct display labels.

const TOOL_TYPE_TO_API: Record<string, string> = {
  http:             "http",
  database_read:    "database",
  database_write:   "database",
  slack:            "http",       // Slack is an HTTP tool using a SaaS/http connection
  email:            "http",       // same pattern
  crm:              "http",       // same pattern
  mcp_tool:         "custom",
  custom_function:  "code",
  imported_tool:    "custom",
};

/** Translates a frontend ToolType to the API's type vocabulary. */
function toApiToolType(uiType: string | undefined): string | undefined {
  if (!uiType) return uiType;
  return TOOL_TYPE_TO_API[uiType] ?? uiType;
}

// ─── Tools ────────────────────────────────────────────────────────────────────

export async function getTools(): Promise<Tool[]> {
  try {
    const res = await api<{ items: Tool[] } | Tool[]>(withWorkspace("/api/tools"));
    return Array.isArray(res) ? res : (res as { items: Tool[] }).items ?? [];
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
  const uiType = payload.type;
  const apiType = toApiToolType(uiType);
  // Preserve the original UI type in config so the detail page can show the
  // right label (e.g. "Database (Read)" vs "Database (Write)", "Slack", etc.)
  const config = {
    ...((payload as Record<string, unknown>).config ?? {}),
    ...(payload.httpConfig ?? {}),
    ...(payload.dbConfig ?? {}),
    uiToolType: uiType,
  };
  return api<Tool>(withWorkspace("/api/tools"), {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      type: apiType,
      config,
      requiresApproval: payload.dbConfig?.requireApproval
        ?? (payload.riskLevel === "high" || payload.riskLevel === "critical"),
      idempotencyStrategy: payload.idempotent ? "input_hash" : "none",
    }),
  });
}

export async function testUnsavedTool(payload: {
  type: ToolType;
  connectionId: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  config: Record<string, unknown>;
}): Promise<{ valid: boolean; message: string }> {
  return api<{ valid: boolean; message: string }>(withWorkspace("/api/tools/test-unsaved"), {
    method: "POST",
    body: JSON.stringify({
      ...payload,
      type: toApiToolType(payload.type),
      config: { ...payload.config, uiToolType: payload.type },
    }),
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
    // Request a large page — parallel workflows emit 50-100+ events; the default
    // pageSize=20 truncates the list and hides STEP_COMPLETED events for most nodes.
    const page = await api<{ items: import("@/types/agent-run-ui").RunTimelineEventUi[] }>(
      withWorkspace(`/api/runs/${runId}/events?pageSize=500`),
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
 * Start a "Debug Run" — like triggerWorkflow, but instructs the worker to
 * capture per-node debug snapshots (resolved inputs/outputs/variable mapping/
 * failure reasons). Scoped to this single run only — never a workflow-level toggle.
 * Calls POST /api/workflows/:id/runs/debug.
 */
export async function startDebugRun(
  workflowId: string,
  input: unknown = {},
): Promise<{ runId: string; status: string; debugMode: boolean }> {
  return api<{ runId: string; status: string; debugMode: boolean }>(
    withWorkspace(`/api/workflows/${workflowId}/runs/debug`),
    { method: "POST", body: JSON.stringify({ input }) },
  );
}

export interface DebugNodeSummary {
  nodeId: string;
  nodeType: string;
  nodeName: string | null;
  status: "pending" | "running" | "success" | "failed" | "skipped" | "retried" | string;
  attempt: number;
  errorType: string | null;
  humanFailureReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  hasFailure: boolean;
}

export interface DebugNodeDetail {
  id: string;
  workflowRunId: string;
  nodeId: string;
  nodeType: string;
  nodeName: string | null;
  attempt: number;
  status: string;
  inputTemplate: string | null;
  resolvedInput: string | null;
  resolvedVariables: string | null;
  variableSources: string | null;
  output: string | null;
  parsedOutput: string | null;
  schemaValidation: string | null;
  errorType: string | null;
  errorMessage: string | null;
  humanFailureReason: string | null;
  suggestedFix: string | null;
  modelProvider: string | null;
  modelName: string | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  costEstimate: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  createdAt: string;
}

/** GET /api/workflow-runs/:runId/debug/nodes — summary debug status for all nodes. */
export async function getDebugNodeSummaries(runId: string): Promise<{ debugMode: boolean; nodes: DebugNodeSummary[] }> {
  return api<{ debugMode: boolean; nodes: DebugNodeSummary[] }>(
    withWorkspace(`/api/workflow-runs/${runId}/debug/nodes`),
  );
}

/** GET /api/workflow-runs/:runId/debug/nodes/:nodeId — detailed snapshot for a node. */
export async function getDebugNodeDetail(runId: string, nodeId: string): Promise<DebugNodeDetail> {
  return api<DebugNodeDetail>(
    withWorkspace(`/api/workflow-runs/${runId}/debug/nodes/${encodeURIComponent(nodeId)}`),
  );
}

/** GET /api/workflow-runs/:runId/debug/nodes/:nodeId/attempts — all attempts for a node. */
export async function getDebugNodeAttempts(runId: string, nodeId: string): Promise<{ attempts: DebugNodeDetail[] }> {
  return api<{ attempts: DebugNodeDetail[] }>(
    withWorkspace(`/api/workflow-runs/${runId}/debug/nodes/${encodeURIComponent(nodeId)}/attempts`),
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
  // Do NOT catch — let errors surface so the UI can show what went wrong
  return await api<ApprovalPage>(withWorkspace(`/api/approvals${q ? `?${q}` : ""}`));
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

export interface DashboardSummary {
  activeWorkflows:   number;
  runningNow:        number;
  failedLast24h:     number;
  succeededLast24h:  number;
  pendingApprovals:  number;
  usageLast24h:      { tokens: number; estimatedCost: number };
  recentRunsTotal:   number;
  // Side-channel metrics (from separate endpoints, used for backwards compat)
  totalWorkflows:    number;
  totalAgents:       number;
  totalTools:        number;
  connectedWorkers:  number;
  // Backwards-compat aliases
  waitingApprovals:  number;
  failedRuns24h:     number;
  succeededRuns24h:  number;
  totalTokens24h:    number;
  totalCost24h:      number;
  runningRuns:       number;
  totalRuns:         number;
}

const SUMMARY_ZERO: DashboardSummary = {
  activeWorkflows: 0, runningNow: 0, failedLast24h: 0,
  succeededLast24h: 0, pendingApprovals: 0,
  usageLast24h: { tokens: 0, estimatedCost: 0 },
  recentRunsTotal: 0, totalWorkflows: 0, totalAgents: 0,
  totalTools: 0, connectedWorkers: 0,
  waitingApprovals: 0, failedRuns24h: 0, succeededRuns24h: 0,
  totalTokens24h: 0, totalCost24h: 0, runningRuns: 0, totalRuns: 0,
};

/**
 * Fetch dashboard metrics.
 * Primary source: GET /api/dashboard/summary (single efficient query in Kotlin API).
 * Falls back to side-channel API calls if the summary endpoint is unavailable.
 */
export async function getPlatformSummary(): Promise<DashboardSummary> {
  const wsId = getActiveWorkspaceId();
  if (!wsId) return SUMMARY_ZERO;

  // Primary: new efficient dashboard summary endpoint
  const summaryResult = await apiFetch<{
    activeWorkflows: number;
    runningNow: number;
    failedLast24h: number;
    succeededLast24h: number;
    pendingApprovals: number;
    usageLast24h: { tokens: number; estimatedCost: number };
    recentRunsTotal: number;
  }>(withWorkspace("/api/dashboard/summary")).catch(() => null);

  // Side-channel: workers and total counts (not in summary endpoint).
  // Agents/tools/workers endpoints may return either a raw array or a
  // paginated `{ items, total }` envelope — handle both (same as getAgents/getTools).
  type ListEnvelope<T> = T[] | { items?: T[]; total?: number };
  const listCount = (res: PromiseSettledResult<ListEnvelope<unknown>>): number => {
    if (res.status !== "fulfilled") return 0;
    const v = res.value;
    if (Array.isArray(v)) return v.length;
    return v.total ?? v.items?.length ?? 0;
  };
  const listItems = <T,>(res: PromiseSettledResult<ListEnvelope<T>>): T[] => {
    if (res.status !== "fulfilled") return [];
    const v = res.value;
    return Array.isArray(v) ? v : (v.items ?? []);
  };

  const [workersResult, agentsResult, toolsResult, workflowsResult] =
    await Promise.allSettled([
      api<ListEnvelope<WorkerItem>>(withWorkspace("/api/workers")),
      api<ListEnvelope<Agent>>(withWorkspace("/api/agents")),
      api<ListEnvelope<Tool>>(withWorkspace("/api/tools")),
      api<PaginatedResult<Workflow>>(withWorkspace("/api/workflows?page=1&pageSize=1")),
    ]);

  const workers     = listItems(workersResult);
  const agentsCount = listCount(agentsResult);
  const toolsCount  = listCount(toolsResult);
  const workflows   = workflowsResult.status === "fulfilled" ? workflowsResult.value : null;

  if (summaryResult) {
    return {
      ...summaryResult,
      totalWorkflows:   workflows?.total ?? 0,
      totalAgents:      agentsCount,
      totalTools:       toolsCount,
      connectedWorkers: workers.filter(w => w.status === "CONNECTED").length,
      // Backwards-compat aliases
      waitingApprovals: summaryResult.pendingApprovals,
      failedRuns24h:    summaryResult.failedLast24h,
      succeededRuns24h: summaryResult.succeededLast24h,
      totalTokens24h:   summaryResult.usageLast24h?.tokens ?? 0,
      totalCost24h:     summaryResult.usageLast24h?.estimatedCost ?? 0,
      runningRuns:      summaryResult.runningNow,
      totalRuns:        summaryResult.recentRunsTotal,
    };
  }

  // Fallback: aggregate from individual endpoints (old behaviour)
  const [runsResult, approvalsResult] = await Promise.allSettled([
    api<PaginatedResult<AgentRun>>(withWorkspace("/api/runs?page=1&pageSize=1")),
    api<ApprovalPage>(withWorkspace("/api/approvals?status=PENDING&page=1&pageSize=1")),
  ]);
  const runs      = runsResult.status === "fulfilled" ? runsResult.value : null;
  const approvals = approvalsResult.status === "fulfilled" ? approvalsResult.value : null;

  return {
    ...SUMMARY_ZERO,
    totalWorkflows:   workflows?.total ?? 0,
    activeWorkflows:  0,
    totalAgents:      agentsCount,
    totalTools:       toolsCount,
    totalRuns:        runs?.total ?? 0,
    pendingApprovals: approvals?.total ?? 0,
    waitingApprovals: approvals?.total ?? 0,
    connectedWorkers: workers.filter(w => w.status === "CONNECTED").length,
  };
}
