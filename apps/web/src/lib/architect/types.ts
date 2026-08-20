/**
 * AI Workflow Architect — the shapes `/api/architect/*` actually returns.
 *
 * Hand-written rather than derived from `@vectorbea/shared`: the architect
 * routes predate the contracts package and serialise straight from
 * `WorkflowArchitectRoutes.kt`'s `*ToMap` helpers, so a Zod contract here would
 * be a second source of truth to keep in step rather than a check on one.
 * Everything below is read off those helpers, field for field.
 *
 * The LLM is the author of most of these values, which is why almost every
 * field that is not an id is optional: a plan that is missing `safetyNotes` is
 * a plan with no safety notes, not a broken response, and a UI that refuses to
 * render it turns a partial answer into a total failure.
 */

/** One adaptive clarification question. Zero for a clear goal, up to five. */
export interface ClarifyQuestion {
  question: string;
  /** How the answer changes the design. Shown under the question. */
  why?: string | null;
  /** Tappable example answers. */
  suggestions?: string[];
}

/**
 * The API sends either rich objects or bare strings depending on which model
 * produced them, so normalise once at the edge instead of branching in the view.
 */
export function normalizeClarifyQuestions(raw: unknown): ClarifyQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ClarifyQuestion[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      if (item.trim()) out.push({ question: item.trim() });
      continue;
    }
    if (item && typeof item === "object" && typeof (item as ClarifyQuestion).question === "string") {
      const q = item as ClarifyQuestion;
      out.push({
        question: q.question,
        why: q.why ?? undefined,
        suggestions: Array.isArray(q.suggestions) ? q.suggestions.filter((s) => typeof s === "string") : undefined,
      });
    }
  }
  return out;
}

export interface PlanField {
  key: string;
  label: string;
  type: string;
  secret: boolean;
  required: boolean;
}

export interface PlanConnection {
  tempConnectionId: string;
  name: string;
  type: string;
  providerHint?: string | null;
  description?: string;
  requiredForSimulation: boolean;
  requiredForRealExecution: boolean;
  usedByTempToolIds?: string[];
  setupInstructions?: string;
  fieldsNeeded?: PlanField[];
}

export interface PlanTool {
  tempToolId: string;
  name: string;
  type: string;
  connectionTempId?: string | null;
  description?: string;
  riskLevel?: "low" | "medium" | "high";
  requiresApproval?: boolean;
}

export interface PlanAgent {
  tempAgentId: string;
  name: string;
  type: string;
  role?: string;
  systemPrompt?: string;
  allowedTempToolIds?: string[];
}

export interface PlanStep {
  tempStepId: string;
  name: string;
  /** The engine's node type — `tool`, `llm`, `approval`, `branch`, `trigger`… */
  nodeType: string;
  toolTempId?: string | null;
  agentTempId?: string | null;
  /** Why the Architect put this step here. The thing that earns trust. */
  rationale?: string;
  config?: Record<string, unknown>;
}

export interface PlanEdge {
  from: string;
  to: string;
  type?: string;
  label?: string;
}

export interface ArchitectPlan {
  workflowName: string;
  workflowDescription?: string;
  goalSummary?: string;
  /** 0–1. Rendered as a percentage, never as a bare number. */
  confidence?: number;
  trigger?: { type: string; description?: string; scheduleSuggestion?: string };
  requiredConnections?: PlanConnection[];
  tools?: PlanTool[];
  agents?: PlanAgent[];
  workflowSteps?: PlanStep[];
  edges?: PlanEdge[];
  safetyNotes?: string[];
  simulationPlan?: { canSimulateWithoutConnections?: boolean; sampleOutputsNeeded?: string[] };
}

export type ConnectionRequirementStatus =
  | "missing" | "selected_existing" | "created" | "test_pending"
  | "test_failed" | "test_passed" | "simulation_placeholder";

export interface ConnectionRequirement {
  id: string;
  tempConnectionId: string;
  name: string;
  type: string;
  providerHint?: string | null;
  description?: string | null;
  requiredForSimulation: boolean;
  requiredForRealExecution: boolean;
  status: ConnectionRequirementStatus;
  boundConnectionId?: string | null;
  testStatus?: string | null;
  testError?: string | null;
  setupInstructions?: string | null;
  fieldsNeeded?: PlanField[];
}

export interface GeneratedTool {
  id: string;
  tempToolId: string;
  toolId?: string | null;
  name: string;
  type: string;
  status: "planned" | "created" | "blocked_missing_connection" | "failed";
  riskLevel?: string;
  requiresApproval?: boolean;
  boundConnectionId?: string | null;
}

export interface GeneratedAgent {
  id: string;
  tempAgentId: string;
  agentId?: string | null;
  name: string;
  type: string;
  role?: string | null;
  status: "planned" | "created" | "blocked_missing_tools" | "failed";
  systemPromptPreview?: string;
  allowedTempToolIds?: string[];
  boundToolIds?: string[];
}

/** One entry in the build reveal. `delayMs` is a hint, never a guarantee. */
export interface AnimationStep {
  sequence?: number;
  type: string;
  title: string;
  description?: string | null;
  status?: string;
  targetType?: string | null;
  targetId?: string | null;
  nodeId?: string;
  delayMs?: number;
  durationMs?: number;
}

export interface ReadinessIssue {
  severity: "info" | "warning" | "error";
  code: string;
  message: string;
  targetType?: string;
  targetId?: string;
}

export interface ArchitectSession {
  id: string;
  status: string;
  currentStage: string;
  userGoal?: string;
  clarificationQuestions?: Array<ClarifyQuestion | string>;
  needsClarification?: boolean;
  plan?: ArchitectPlan | null;
  animationSteps?: AnimationStep[] | null;
  connectionRequirements?: ConnectionRequirement[];
  generatedTools?: GeneratedTool[];
  generatedAgents?: GeneratedAgent[];
  workflowId?: string | null;
  readinessStatus?: string | null;
  failureReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Build allowance. `limit` is per `periodDays` per WORKSPACE, not per user —
 * shown before the prompt box so nobody writes three paragraphs against a quota
 * they had already spent.
 */
export interface ArchitectUsage {
  used: number;
  limit: number;
  remaining: number;
  periodDays: number;
  locked: boolean;
  lastBuildAt?: string | null;
  resetAt?: string | null;
}

export interface WorkspaceConnectionOption {
  id: string;
  name: string;
  type: string;
  provider?: string;
  status: string;
  testStatus?: string | null;
  testedAt?: string | null;
  /** The API ranks rather than filters — see `WorkflowArchitectRoutes.listConnections`. */
  typeMatches?: boolean;
}

export interface CreatedWorkflowResult {
  workflowId: string;
  workflowVersionId: string;
  workflowName: string;
  animationSteps?: AnimationStep[];
  readinessStatus?: string;
  readinessIssues?: ReadinessIssue[];
  toolsCreated?: number;
  agentsCreated?: number;
}
