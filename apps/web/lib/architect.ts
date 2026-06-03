/**
 * AI Workflow Architect — frontend API client.
 * Calls the Kotlin API /api/architect/* routes.
 */
import { apiFetch, withWorkspace } from "@/lib/api/client";

const BASE = "/api/architect";

export interface ArchitectSession {
  id: string;
  status: string;
  currentStage: string;
  userGoal: string;
  clarificationQuestions?: string[];
  needsClarification?: boolean;
  plan?: ArchitectPlan;
  animationSteps?: AnimationStep[];
  connectionRequirements?: ConnectionRequirement[];
  workflowId?: string;
  readinessStatus?: string;
  failureReason?: string;
  createdAt: string;
}

export interface ArchitectPlan {
  workflowName: string;
  workflowDescription: string;
  goalSummary: string;
  confidence: number;
  trigger: { type: string; description: string; scheduleSuggestion?: string };
  requiredConnections: PlanConnection[];
  tools: PlanTool[];
  agents: PlanAgent[];
  workflowSteps: PlanStep[];
  edges: PlanEdge[];
  safetyNotes: string[];
  simulationPlan: { canSimulateWithoutConnections: boolean; sampleOutputsNeeded: string[] };
}

export interface PlanConnection {
  tempConnectionId: string;
  name: string;
  type: string;
  providerHint?: string;
  description: string;
  requiredForSimulation: boolean;
  requiredForRealExecution: boolean;
  usedByTempToolIds: string[];
  setupInstructions: string;
  fieldsNeeded: Array<{ key: string; label: string; type: string; secret: boolean; required: boolean }>;
}

export interface PlanTool {
  tempToolId: string;
  name: string;
  type: string;
  connectionTempId?: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
  requiresApproval: boolean;
}

export interface PlanAgent {
  tempAgentId: string;
  name: string;
  type: string;
  role: string;
  systemPrompt: string;
  allowedTempToolIds: string[];
}

export interface PlanStep {
  tempStepId: string;
  name: string;
  nodeType: string;
  toolTempId?: string;
  agentTempId?: string;
}

export interface PlanEdge {
  from: string;
  to: string;
  type: string;
  label?: string;
}

export interface ConnectionRequirement {
  id: string;
  tempConnectionId: string;
  name: string;
  type: string;
  providerHint?: string;
  description?: string;
  requiredForSimulation: boolean;
  requiredForRealExecution: boolean;
  status: "missing" | "selected_existing" | "created" | "test_pending" | "test_failed" | "test_passed" | "simulation_placeholder";
  boundConnectionId?: string;
  testStatus?: string;
  testError?: string;
  setupInstructions?: string;
  fieldsNeeded: Array<{ key: string; label: string; type: string; secret: boolean; required: boolean }>;
}

export interface GeneratedTool {
  id: string;
  tempToolId: string;
  toolId?: string;
  name: string;
  type: string;
  status: "planned" | "created" | "blocked_missing_connection" | "failed";
  riskLevel: string;
  requiresApproval: boolean;
  boundConnectionId?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

export interface GeneratedAgent {
  id: string;
  tempAgentId: string;
  agentId?: string;
  name: string;
  type: string;
  role?: string;
  status: "planned" | "created" | "blocked_missing_tools" | "failed";
  systemPromptPreview?: string;
  allowedTempToolIds: string[];
  boundToolIds: string[];
}

export interface AnimationStep {
  sequence?: number;
  type: "thinking" | "connection_bound" | "tool_created" | "agent_created" | "add_node" | "add_edge" | "highlight_node" | "validate_workflow" | "complete" | "start";
  nodeId?: string;
  edgeId?: string;
  toolId?: string;
  agentId?: string;
  connectionId?: string;
  delayMs?: number;
  durationMs?: number;
  title: string;
  description?: string;
}

export interface ReadinessIssue {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  targetType?: string;
  targetId?: string;
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function createArchitectSession(goal: string): Promise<ArchitectSession> {
  return apiFetch<ArchitectSession>(withWorkspace(`${BASE}/sessions`), {
    method: "POST", json: { goal },
  });
}

export async function getArchitectSession(id: string): Promise<ArchitectSession> {
  return apiFetch<ArchitectSession>(withWorkspace(`${BASE}/sessions/${id}`));
}

export async function generatePlan(
  sessionId: string,
  answers: Record<string, string> = {},
): Promise<{ plan: ArchitectPlan; connectionRequirements: ConnectionRequirement[]; generatedTools: GeneratedTool[]; generatedAgents: GeneratedAgent[]; animationSteps: AnimationStep[] }> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/generate-plan`), {
    method: "POST", json: { answers },
  });
}

export async function revisePlan(
  sessionId: string,
  instruction: string,
): Promise<{ plan: ArchitectPlan; connectionRequirements: ConnectionRequirement[]; animationSteps: AnimationStep[] }> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/revise-plan`), {
    method: "POST", json: { instruction },
  });
}

export async function approvePlan(sessionId: string): Promise<{
  connectionRequirements: ConnectionRequirement[];
  needsConnections: boolean;
}> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/approve-plan`), { method: "POST" });
}

export async function getConnectionRequirements(sessionId: string): Promise<{
  connectionRequirements: ConnectionRequirement[];
  allReady: boolean;
}> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/connection-requirements`));
}

export async function bindExistingConnection(
  sessionId: string, requirementId: string, connectionId: string,
): Promise<{ id: string; status: string }> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/connection-requirements/${requirementId}/bind-existing`), {
    method: "POST", json: { connectionId },
  });
}

export async function useSimulationPlaceholder(
  sessionId: string, requirementId: string,
): Promise<{ id: string; status: string }> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/connection-requirements/${requirementId}/use-simulation`), {
    method: "POST",
  });
}

export async function generateTools(sessionId: string): Promise<{
  tools: GeneratedTool[]; created: number; blocked: number;
}> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/generate-tools`), { method: "POST" });
}

export async function generateAgents(sessionId: string): Promise<{
  agents: GeneratedAgent[]; created: number;
}> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/generate-agents`), { method: "POST" });
}

export async function createWorkflowFromPlan(
  sessionId: string,
  connectionBindings: Record<string, string> = {},
): Promise<{
  workflowId: string;
  workflowVersionId: string;
  workflowName: string;
  animationSteps: AnimationStep[];
  readinessStatus: string;
  readinessIssues: ReadinessIssue[];
  toolsCreated: number;
  agentsCreated: number;
}> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/create-workflow`), {
    method: "POST", json: { connectionBindings },
  });
}

export async function getBuildSteps(sessionId: string): Promise<{ buildSteps: AnimationStep[] }> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/build-steps`));
}

export async function testConnection(
  sessionId: string, requirementId: string,
): Promise<{ id: string; status: string; testStatus: string; ok: boolean; latencyMs: number; message: string }> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/connection-requirements/${requirementId}/test`), {
    method: "POST",
  });
}

export async function listWorkspaceConnections(type?: string): Promise<{
  connections: Array<{ id: string; name: string; type: string; provider: string; status: string; testStatus?: string }>;
  total: number;
}> {
  const url = type
    ? withWorkspace(`${BASE}/connections?type=${encodeURIComponent(type)}`)
    : withWorkspace(`${BASE}/connections`);
  return apiFetch(url);
}

export async function getReadiness(sessionId: string): Promise<{
  readinessStatus: string;
  readinessIssues: ReadinessIssue[];
  simulationReady: boolean;
  realExecutionReady: boolean;
}> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/readiness`));
}
