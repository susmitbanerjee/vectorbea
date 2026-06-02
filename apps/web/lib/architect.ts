/**
 * AI Workflow Architect — frontend API client.
 * Calls the Kotlin API /api/architect/* routes.
 */
import { apiFetch, withWorkspace } from "@/lib/api/client";

const BASE = "/api/architect";

export interface ArchitectSession {
  id: string;
  status: string;
  userGoal: string;
  clarificationQuestions?: string[];
  needsClarification?: boolean;
  plan?: ArchitectPlan;
  animationSteps?: AnimationStep[];
  workflowId?: string;
  failureReason?: string;
  createdAt: string;
}

export interface ArchitectPlan {
  workflowName: string;
  workflowDescription: string;
  goalSummary: string;
  confidence: number;
  trigger: {
    type: "manual" | "schedule" | "webhook" | "api_event";
    description: string;
    scheduleSuggestion?: string;
  };
  agents: Array<{
    tempId: string;
    name: string;
    type: string;
    role: string;
    instructions: string;
    modelPreference?: string;
    requiresLlmConnection: boolean;
  }>;
  tools: Array<{
    tempId: string;
    name: string;
    type: string;
    description: string;
    requiredConnection: { type: string; providerHint?: string; description: string };
    riskLevel: "low" | "medium" | "high";
    requiresApproval: boolean;
  }>;
  approvalGates: Array<{
    tempId: string;
    name: string;
    reason: string;
    approverRole: string;
    riskLevel: string;
  }>;
  steps: Array<{
    tempId: string;
    name: string;
    type: string;
    description: string;
    dependsOn: string[];
  }>;
  requiredConnections: Array<{
    tempId: string;
    name: string;
    type: string;
    providerHint?: string;
    usedBy: string[];
    requiredForSimulation: boolean;
    requiredForRealExecution: boolean;
    setupInstructions: string;
  }>;
  safetyNotes: string[];
  simulationPlan: {
    canSimulateWithoutConnections: boolean;
    sampleOutputsNeeded: string[];
  };
  questionsBeforeCreation: string[];
}

export interface AnimationStep {
  type: "start" | "add_node" | "add_edge" | "highlight_node" | "complete";
  nodeId?: string;
  edgeId?: string;
  delayMs: number;
  title: string;
}

export async function createArchitectSession(goal: string): Promise<ArchitectSession> {
  return apiFetch<ArchitectSession>(withWorkspace(`${BASE}/sessions`), {
    method: "POST",
    json: { goal },
  });
}

export async function getArchitectSession(id: string): Promise<ArchitectSession> {
  return apiFetch<ArchitectSession>(withWorkspace(`${BASE}/sessions/${id}`));
}

export async function generatePlan(
  sessionId: string,
  answers: Record<string, string> = {},
): Promise<{ plan: ArchitectPlan; animationSteps: AnimationStep[] }> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/generate-plan`), {
    method: "POST",
    json: { answers },
  });
}

export async function revisePlan(
  sessionId: string,
  instruction: string,
): Promise<{ plan: ArchitectPlan; animationSteps: AnimationStep[] }> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/revise-plan`), {
    method: "POST",
    json: { instruction },
  });
}

export async function approvePlan(sessionId: string): Promise<void> {
  await apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/approve-plan`), { method: "POST" });
}

export async function createWorkflowFromPlan(
  sessionId: string,
  connectionBindings: Record<string, string> = {},
): Promise<{ workflowId: string; workflowVersionId: string; animationSteps: AnimationStep[] }> {
  return apiFetch(withWorkspace(`${BASE}/sessions/${sessionId}/create-workflow`), {
    method: "POST",
    json: { connectionBindings, mode: "simulation_first" },
  });
}
