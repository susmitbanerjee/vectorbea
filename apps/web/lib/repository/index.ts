/**
 * Vectorbee Platform Repository
 *
 * Typed data access layer. Currently backed by in-memory seed data.
 * Replace each function body with a real API/DB call when the backend is ready.
 *
 * All UI pages must use these functions — never import seed data directly.
 */

import type {
  Agent,
  AgentRun,
  ApprovalGate,
  PaginatedResult,
  RunEvent,
  RunFilters,
  Tool,
  Workflow,
  WorkflowFilters,
  WorkflowStep,
  WorkflowVersion,
} from "@/types/platform";
import type { WorkflowGraph } from "@/types/workflow-graph";

import { runWorkflowFromStep, simulateWorkflow } from "@/lib/workflow-runtime/simulator";

import {
  ALL_SEED_EVENTS,
  ALL_SEED_RUNS,
  SEED_AGENTS,
  SEED_TOOLS,
  SEED_WORKFLOW,
} from "@/lib/seed/platform-seed";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function paginate<T>(items: T[], page: number, pageSize: number): PaginatedResult<T> {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    total,
    page: safePage,
    pageSize,
    totalPages,
  };
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ─── Workflow graphs ──────────────────────────────────────────────────────────

const _workflowGraphs: Map<string, WorkflowGraph> = new Map();

export async function saveWorkflowGraph(workflowId: string, graph: WorkflowGraph): Promise<void> {
  await sleep(0);
  _workflowGraphs.set(workflowId, graph);
}

export async function getWorkflowGraph(workflowId: string): Promise<WorkflowGraph | null> {
  await sleep(0);
  return _workflowGraphs.get(workflowId) ?? null;
}

// ─── Workflows ────────────────────────────────────────────────────────────────

const _workflows: Workflow[] = [SEED_WORKFLOW];

export async function getWorkflows(filters: WorkflowFilters = {}): Promise<PaginatedResult<Workflow>> {
  await sleep(0);
  const { search, status, page = 1, pageSize = 20 } = filters;
  let items = [..._workflows];
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(
      (w) => w.name.toLowerCase().includes(q) || w.description.toLowerCase().includes(q),
    );
  }
  if (status) items = items.filter((w) => w.status === status);
  return paginate(items, page, pageSize);
}

export async function getWorkflow(id: string): Promise<Workflow | null> {
  await sleep(0);
  return _workflows.find((w) => w.id === id) ?? null;
}

export async function createWorkflow(payload: Partial<Workflow>): Promise<Workflow> {
  await sleep(0);
  const now = new Date().toISOString();
  const wf: Workflow = {
    id: `wf-${Date.now()}`,
    name: payload.name ?? "Untitled Workflow",
    slug: (payload.name ?? "untitled").toLowerCase().replace(/\s+/g, "-"),
    description: payload.description ?? "",
    status: "draft",
    creationMode: payload.creationMode ?? "native",
    currentVersion: "v1",
    triggerType: payload.triggerType ?? "manual",
    inputSchema: payload.inputSchema ?? {},
    outputSchema: payload.outputSchema ?? {},
    steps: payload.steps ?? [],
    agentIds: payload.agentIds ?? [],
    toolIds: payload.toolIds ?? [],
    retryPolicy: payload.retryPolicy ?? { maxAttempts: 2, backoffType: "exponential", backoffMs: 2000 },
    budgetPolicy: payload.budgetPolicy ?? {},
    approvalPolicy: payload.approvalPolicy ?? { requireApproval: false },
    totalRuns: 0,
    successRate: 0,
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: now,
    updatedAt: now,
  };
  _workflows.push(wf);
  return wf;
}

export async function updateWorkflow(id: string, payload: Partial<Workflow>): Promise<Workflow | null> {
  await sleep(0);
  const idx = _workflows.findIndex((w) => w.id === id);
  if (idx === -1) return null;
  _workflows[idx] = { ..._workflows[idx]!, ...payload, updatedAt: new Date().toISOString() };
  return _workflows[idx]!;
}

// ─── Agents ───────────────────────────────────────────────────────────────────

const _agents: Agent[] = [...SEED_AGENTS];

export async function getAgents(): Promise<Agent[]> {
  await sleep(0);
  return [..._agents];
}

export async function getAgent(id: string): Promise<Agent | null> {
  await sleep(0);
  return _agents.find((a) => a.id === id) ?? null;
}

export async function updateAgent(id: string, payload: Partial<Agent>): Promise<Agent | null> {
  await sleep(0);
  const idx = _agents.findIndex((a) => a.id === id);
  if (idx === -1) return null;
  _agents[idx] = { ..._agents[idx]!, ...payload, updatedAt: new Date().toISOString() };
  return _agents[idx]!;
}

export async function createAgent(payload: Partial<Agent>): Promise<Agent> {
  await sleep(0);
  const now = new Date().toISOString();
  const agent: Agent = {
    id: `agent-${Date.now()}`,
    name: payload.name ?? "New Agent",
    slug: (payload.name ?? "new-agent").toLowerCase().replace(/\s+/g, "-"),
    description: payload.description ?? "",
    role: payload.role ?? "",
    instructions: payload.instructions ?? "",
    type: payload.type ?? "native_llm_agent",
    modelProvider: payload.modelProvider ?? "openai",
    modelName: payload.modelName ?? "gpt-4.1-mini",
    temperature: payload.temperature ?? 0.1,
    maxIterations: payload.maxIterations ?? 10,
    allowedToolIds: payload.allowedToolIds ?? [],
    memoryPolicy: payload.memoryPolicy ?? { type: "session" },
    retryPolicy: payload.retryPolicy ?? { maxAttempts: 2, backoffType: "exponential", backoffMs: 2000 },
    timeoutPolicy: payload.timeoutPolicy ?? { stepTimeoutMs: 60000, runTimeoutMs: 600000 },
    approvalPolicy: payload.approvalPolicy ?? { requireApproval: false },
    status: "active",
    totalRuns: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  _agents.push(agent);
  return agent;
}

// ─── Tools ────────────────────────────────────────────────────────────────────

const _tools: Tool[] = [...SEED_TOOLS];

export async function getTools(): Promise<Tool[]> {
  await sleep(0);
  return [..._tools];
}

export async function getTool(id: string): Promise<Tool | null> {
  await sleep(0);
  return _tools.find((t) => t.id === id) ?? null;
}

export async function updateTool(id: string, payload: Partial<Tool>): Promise<Tool | null> {
  await sleep(0);
  const idx = _tools.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  _tools[idx] = { ..._tools[idx]!, ...payload, updatedAt: new Date().toISOString() };
  return _tools[idx]!;
}

export async function createTool(payload: Partial<Tool>): Promise<Tool> {
  await sleep(0);
  const now = new Date().toISOString();
  const tool: Tool = {
    id: `tool-${Date.now()}`,
    name: payload.name ?? "New Tool",
    slug: (payload.name ?? "new-tool").toLowerCase().replace(/\s+/g, "-"),
    type: payload.type ?? "http",
    description: payload.description ?? "",
    inputSchema: payload.inputSchema ?? {},
    outputSchema: payload.outputSchema ?? {},
    riskLevel: payload.riskLevel ?? "read_only",
    timeoutMs: payload.timeoutMs ?? 10000,
    retryPolicy: payload.retryPolicy ?? { maxAttempts: 3, backoffType: "exponential", backoffMs: 1000 },
    idempotent: payload.idempotent ?? true,
    authConnectionRef: payload.authConnectionRef ?? null,
    httpConfig: payload.httpConfig,
    status: "active",
    totalCalls: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  _tools.push(tool);
  return tool;
}

// ─── Runs ─────────────────────────────────────────────────────────────────────

const _runs: AgentRun[] = [...ALL_SEED_RUNS];

export async function getRuns(filters: RunFilters = {}): Promise<PaginatedResult<AgentRun>> {
  await sleep(0);
  const { search, status, workflowId, page = 1, pageSize = 25 } = filters;
  let items = [..._runs];
  if (search) {
    const q = search.toLowerCase();
    items = items.filter((r) => r.workflowName.toLowerCase().includes(q));
  }
  if (status) items = items.filter((r) => r.status === status);
  if (workflowId) items = items.filter((r) => r.workflowId === workflowId);
  // Most recent first
  items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return paginate(items, page, pageSize);
}

export async function getRun(id: string): Promise<AgentRun | null> {
  await sleep(0);
  return _runs.find((r) => r.id === id) ?? null;
}

export async function createRun(workflowId: string, input: unknown): Promise<AgentRun> {
  await sleep(0);
  const workflow = _workflows.find((w) => w.id === workflowId);
  const now = new Date().toISOString();
  const run: AgentRun = {
    id: `run-${Date.now()}`,
    workflowId,
    workflowName: workflow?.name ?? "Unknown Workflow",
    workflowVersion: workflow?.currentVersion ?? "v1",
    creationMode: workflow?.creationMode ?? "native",
    status: "queued",
    triggerType: "manual",
    input,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    totalTokens: null,
    estimatedCostUsd: null,
    checkpoints: [],
    artifacts: [],
    approvalGates: [],
    replayAvailable: false,
    createdAt: now,
    updatedAt: now,
  };
  _runs.push(run);
  return run;
}

// ─── Run Events ───────────────────────────────────────────────────────────────

// Mutable event store — starts with seed data, extended by triggerWorkflow
const _events: Record<string, RunEvent[]> = { ...ALL_SEED_EVENTS };

export async function getRunEvents(runId: string): Promise<RunEvent[]> {
  await sleep(0);
  return _events[runId] ?? [];
}

// Returns runs where this agent participated (has at least one event with agentId)
export async function getRunsForAgent(agentId: string): Promise<AgentRun[]> {
  await sleep(0);
  const runIds = new Set<string>();
  for (const [runId, events] of Object.entries(ALL_SEED_EVENTS)) {
    if (events.some((e) => e.agentId === agentId)) runIds.add(runId);
  }
  return _runs.filter((r) => runIds.has(r.id));
}

// Returns events (across all runs) where this tool was called
export async function getCallsForTool(toolId: string): Promise<RunEvent[]> {
  await sleep(0);
  const results: RunEvent[] = [];
  for (const events of Object.values(ALL_SEED_EVENTS)) {
    for (const e of events) {
      if (e.toolId === toolId) results.push(e);
    }
  }
  return results.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}

// ─── Approvals ────────────────────────────────────────────────────────────────

export async function getPendingApprovals(): Promise<ApprovalGate[]> {
  await sleep(0);
  return _runs.flatMap((r) => r.approvalGates.filter((a) => a.status === "pending"));
}

/** Approve a pending gate and resume workflow execution from the next step. */
export async function approveRunGate(runId: string, approvalId: string): Promise<boolean> {
  await sleep(0);
  const runIdx = _runs.findIndex((r) => r.id === runId);
  if (runIdx === -1) return false;
  const run = _runs[runIdx]!;
  const gate = run.approvalGates.find((a) => a.id === approvalId);
  if (!gate || gate.status !== "pending") return false;

  // Mark gate approved
  gate.status = "approved";
  gate.decidedAt = new Date().toISOString();
  gate.decidedBy = "user";

  // Find which step index we paused at
  const workflow = _workflows.find((w) => w.id === run.workflowId);
  if (!workflow) return false;

  const steps = workflow.steps.filter((s) => s.type !== "end");
  const pausedIdx = steps.findIndex((s) => s.id === run.currentStepId);
  const resumeFromIdx = pausedIdx >= 0 ? pausedIdx + 1 : 0;

  // Add APPROVAL_APPROVED event
  const existingEvents = _events[runId] ?? [];
  existingEvents.push({
    id: `evt-sim-${Date.now()}-${Math.random()}`,
    runId,
    sequence: existingEvents.length,
    timestamp: new Date().toISOString(),
    type: "APPROVAL_APPROVED",
    status: "ok",
    source: "native",
    workflowId: workflow.id,
    workflowVersion: workflow.currentVersion,
    title: "Approval approved",
    stepId: gate.stepId,
    metadata: { gateId: approvalId },
  });

  // Resume simulation from the step after the approval
  const { updatedRun, events } = runWorkflowFromStep(
    workflow,
    { ...run, approvalGates: run.approvalGates, status: "running" },
    _agents,
    _tools,
    existingEvents,
    resumeFromIdx,
    { isResume: true },
  );

  _runs[runIdx] = updatedRun;
  _events[runId] = events;
  return true;
}

/** Reject a pending gate — fails the run. */
export async function rejectRunGate(runId: string, approvalId: string): Promise<boolean> {
  await sleep(0);
  const runIdx = _runs.findIndex((r) => r.id === runId);
  if (runIdx === -1) return false;
  const run = _runs[runIdx]!;
  const gate = run.approvalGates.find((a) => a.id === approvalId);
  if (!gate || gate.status !== "pending") return false;

  const workflow = _workflows.find((w) => w.id === run.workflowId);
  const now = new Date().toISOString();

  gate.status = "rejected";
  gate.decidedAt = now;
  gate.decidedBy = "user";

  // Append APPROVAL_REJECTED + RUN_FAILED events
  const existingEvents = _events[runId] ?? [];
  existingEvents.push(
    {
      id: `evt-sim-${Date.now()}-${Math.random()}`,
      runId,
      sequence: existingEvents.length,
      timestamp: now,
      type: "APPROVAL_REJECTED",
      status: "error",
      source: "native",
      workflowId: workflow?.id,
      workflowVersion: workflow?.currentVersion,
      title: "Approval rejected",
      stepId: gate.stepId,
      metadata: { gateId: approvalId },
    },
    {
      id: `evt-sim-${Date.now()}-${Math.random()}-2`,
      runId,
      sequence: existingEvents.length + 1,
      timestamp: now,
      type: "RUN_FAILED",
      status: "error",
      source: "native",
      workflowId: workflow?.id,
      workflowVersion: workflow?.currentVersion,
      title: "Run failed",
      error: "Approval rejected by user",
    },
  );

  _runs[runIdx] = {
    ...run,
    status: "failed",
    completedAt: now,
    error: "Approval rejected by user",
    updatedAt: now,
  };
  _events[runId] = existingEvents;
  return true;
}

// Legacy aliases
export async function approveRun(runId: string, approvalId: string): Promise<boolean> {
  return approveRunGate(runId, approvalId);
}
export async function rejectApproval(runId: string, approvalId: string): Promise<boolean> {
  return rejectRunGate(runId, approvalId);
}

/** Retry from the failed step (re-run from that step). */
export async function retryRunFailedStep(runId: string): Promise<boolean> {
  await sleep(0);
  const runIdx = _runs.findIndex((r) => r.id === runId);
  if (runIdx === -1) return false;
  const run = _runs[runIdx]!;
  if (run.status !== "failed") return false;

  const workflow = _workflows.find((w) => w.id === run.workflowId);
  if (!workflow) return false;

  const steps = workflow.steps.filter((s) => s.type !== "end");
  const failedIdx = steps.findIndex((s) => s.id === run.currentStepId);
  const retryFromIdx = failedIdx >= 0 ? failedIdx : 0;

  const existingEvents = _events[runId] ?? [];
  const { updatedRun, events } = runWorkflowFromStep(
    workflow,
    { ...run, status: "running" },
    _agents,
    _tools,
    existingEvents,
    retryFromIdx,
    { isResume: true },
  );

  _runs[runIdx] = updatedRun;
  _events[runId] = events;
  return true;
}

/** List checkpoints for a run. */
export async function listRunCheckpoints(runId: string): Promise<import("@/types/platform").RunCheckpoint[]> {
  await sleep(0);
  const run = _runs.find((r) => r.id === runId);
  return run?.checkpoints ?? [];
}

// ─── Replay / Checkpoint ──────────────────────────────────────────────────────

/** Replay a run from start or from a specific checkpoint. Returns the new run. */
export async function replayWorkflowRun(
  runId: string,
  checkpointId?: string,
): Promise<AgentRun | null> {
  await sleep(0);
  const sourceRun = _runs.find((r) => r.id === runId);
  if (!sourceRun) return null;
  if (!sourceRun.replayAvailable) return null;

  const workflow = _workflows.find((w) => w.id === sourceRun.workflowId);
  if (!workflow) return null;

  // Find the start step index
  let startStepIndex = 0;
  if (checkpointId) {
    const ckpt = sourceRun.checkpoints.find((c) => c.id === checkpointId);
    if (ckpt) {
      const steps = workflow.steps.filter((s) => s.type !== "end");
      const ckptIdx = steps.findIndex((s) => s.id === ckpt.stepId);
      startStepIndex = ckptIdx >= 0 ? ckptIdx + 1 : 0;
    }
  }

  // Create a fresh run record
  const newRun = await createRun(sourceRun.workflowId, sourceRun.input);

  // Run from the starting index
  const { updatedRun, events } = runWorkflowFromStep(
    workflow,
    newRun,
    _agents,
    _tools,
    [],
    startStepIndex,
    { isReplay: startStepIndex > 0 },
  );

  const idx = _runs.findIndex((r) => r.id === newRun.id);
  if (idx !== -1) _runs[idx] = updatedRun;
  _events[newRun.id] = events;

  return updatedRun;
}

// Legacy alias
export async function replayRun(runId: string, checkpointId?: string): Promise<{ jobId: string } | null> {
  const newRun = await replayWorkflowRun(runId, checkpointId);
  if (!newRun) return null;
  return { jobId: newRun.id };
}

// ─── Workflow Versions ────────────────────────────────────────────────────────

const _versions: WorkflowVersion[] = [];

export async function saveWorkflowVersion(
  workflowId: string,
  steps: WorkflowStep[],
  changelog?: string,
): Promise<WorkflowVersion> {
  await sleep(0);
  const count = _versions.filter((v) => v.workflowId === workflowId).length;
  const versionLabel = `v${count + 1}`;
  const ver: WorkflowVersion = {
    id: `ver-${workflowId}-${count + 1}`,
    workflowId,
    version: versionLabel,
    // deep copy so mutations don't affect the snapshot
    steps: JSON.parse(JSON.stringify(steps)) as WorkflowStep[],
    changelog,
    createdAt: new Date().toISOString(),
  };
  _versions.push(ver);

  // Also advance workflow's currentVersion pointer
  const wf = _workflows.find((w) => w.id === workflowId);
  if (wf) {
    wf.currentVersion = versionLabel;
    wf.updatedAt = ver.createdAt;
  }

  return ver;
}

export async function getWorkflowVersions(
  workflowId: string,
): Promise<WorkflowVersion[]> {
  await sleep(0);
  return _versions.filter((v) => v.workflowId === workflowId);
}

// ─── Trigger (run) a workflow ─────────────────────────────────────────────────

export async function triggerWorkflow(
  workflowId: string,
  input: unknown = {},
): Promise<AgentRun> {
  await sleep(0);

  const workflow = _workflows.find((w) => w.id === workflowId);
  if (!workflow) throw new Error(`Workflow not found: ${workflowId}`);

  // Create the base run record
  const run = await createRun(workflowId, input);

  // Run the simulator — generates realistic events from the workflow steps
  const { updatedRun, events } = simulateWorkflow(
    workflow,
    run,
    _agents,
    _tools,
  );

  // Persist updated run
  const idx = _runs.findIndex((r) => r.id === run.id);
  if (idx !== -1) _runs[idx] = updatedRun;

  // Persist events
  _events[run.id] = events;

  // Update workflow stats
  const wfIdx = _workflows.findIndex((w) => w.id === workflowId);
  if (wfIdx !== -1) {
    const wf = _workflows[wfIdx]!;
    const allRunsForWf = _runs.filter((r) => r.workflowId === workflowId);
    const succeeded = allRunsForWf.filter((r) => r.status === "succeeded").length;
    _workflows[wfIdx] = {
      ...wf,
      totalRuns: wf.totalRuns + 1,
      lastRunAt: updatedRun.startedAt ?? new Date().toISOString(),
      lastRunStatus: updatedRun.status,
      successRate: allRunsForWf.length > 0 ? succeeded / allRunsForWf.length : 0,
      updatedAt: new Date().toISOString(),
    };
  }

  return updatedRun;
}

// ─── Platform summary ─────────────────────────────────────────────────────────

export async function getPlatformSummary() {
  await sleep(0);
  const runs24h = _runs.filter(
    (r) => r.createdAt && Date.now() - new Date(r.createdAt).getTime() < 86400000,
  );
  return {
    totalWorkflows: _workflows.length,
    activeWorkflows: _workflows.filter((w) => w.status === "active").length,
    runningRuns: _runs.filter((r) => r.status === "running").length,
    waitingApprovals: _runs.flatMap((r) => r.approvalGates).filter((a) => a.status === "pending").length,
    failedRuns24h: runs24h.filter((r) => r.status === "failed").length,
    succeededRuns24h: runs24h.filter((r) => r.status === "succeeded").length,
    totalTokens24h: runs24h.reduce((s, r) => s + (r.totalTokens ?? 0), 0),
    totalCost24h: runs24h.reduce((s, r) => s + (r.estimatedCostUsd ?? 0), 0),
    connectedWorkers: 0,
  };
}
