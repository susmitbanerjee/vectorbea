/**
 * Vectorbee Platform Domain Types
 *
 * Central type definitions for the full AI-agent execution control plane.
 * These replace the old "endpoint-only job" model.
 */

// ─── Enums ────────────────────────────────────────────────────────────────────

export type AgentType =
  | "native_llm_agent"
  | "tool_agent"
  | "router_agent"
  | "approval_agent"
  | "imported_langgraph_node"
  | "external_instrumented_agent";

export type ToolType =
  | "http"
  | "database_read"
  | "database_write"
  | "slack"
  | "email"
  | "crm"
  | "custom_function"
  | "mcp_tool"
  | "imported_tool";

export type RiskLevel =
  | "read_only"
  | "low_risk_write"
  | "high_risk_write"
  | "irreversible";

export type WorkflowStatus = "active" | "paused" | "draft" | "archived";

export type TriggerType =
  | "manual"
  | "cron"
  | "webhook"
  | "api"
  | "event";

export type StepType =
  | "agent"
  | "llm"
  | "tool"
  | "branch"
  | "parallel"
  | "approval"
  | "sleep"
  | "webhook_wait"
  | "artifact"
  | "end";

export type RunStatus =
  | "queued"
  | "running"
  | "waiting_for_approval"
  | "paused"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out";

export type WorkflowCreationMode =
  | "native"          // Built inside Vectorbee — full replay, full control
  | "imported"        // LangGraph/Temporal graph converted to native DAG
  | "instrumented"    // External code with Vectorbee SDK — events/checkpoints pushed
  | "endpoint_only";  // Endpoint trigger only — limited observability

export type RunEventType =
  | "RUN_CREATED"
  | "RUN_QUEUED"
  | "RUN_STARTED"
  | "STEP_SCHEDULED"
  | "STEP_STARTED"
  | "STEP_COMPLETED"
  | "STEP_FAILED"
  | "AGENT_STARTED"
  | "AGENT_PLAN_CREATED"
  | "AGENT_HANDOFF"
  | "AGENT_COMPLETED"
  | "AGENT_FAILED"
  | "LLM_CALL_STARTED"
  | "LLM_CALL_COMPLETED"
  | "LLM_OUTPUT_VALIDATED"
  | "TOOL_CALL_STARTED"
  | "TOOL_CALL_COMPLETED"
  | "TOOL_CALL_FAILED"
  | "APPROVAL_REQUESTED"
  | "APPROVAL_APPROVED"
  | "APPROVAL_REJECTED"
  | "CHECKPOINT_CREATED"
  | "ARTIFACT_CREATED"
  | "RETRY_SCHEDULED"
  | "RETRY_STARTED"
  | "RETRY_EXHAUSTED"
  | "RUN_RESUMED"
  | "RUN_SUCCEEDED"
  | "RUN_FAILED";

// ─── Policy types ─────────────────────────────────────────────────────────────

export interface RetryPolicy {
  maxAttempts: number;
  backoffType: "fixed" | "exponential";
  backoffMs: number;
}

export interface TimeoutPolicy {
  stepTimeoutMs: number;
  runTimeoutMs: number;
}

export interface BudgetPolicy {
  maxTokensPerRun?: number;
  maxCostUsdPerRun?: number;
  maxRunsPerDay?: number;
}

export interface ApprovalPolicy {
  requireApproval: boolean;
  approvers?: string[];
  timeoutMs?: number;
  onTimeout?: "auto_approve" | "auto_reject" | "pause";
}

export interface MemoryPolicy {
  type: "none" | "session" | "persistent" | "vector";
  retentionDays?: number;
}

// ─── Agent ────────────────────────────────────────────────────────────────────

export interface Agent {
  id: string;
  name: string;
  slug: string;
  description: string;
  role: string;
  instructions: string;
  type: AgentType;
  modelProvider: string;
  modelName: string;
  temperature: number;
  maxIterations: number;
  allowedToolIds: string[];
  memoryPolicy: MemoryPolicy;
  retryPolicy: RetryPolicy;
  timeoutPolicy: TimeoutPolicy;
  approvalPolicy: ApprovalPolicy;
  status: "active" | "inactive" | "deprecated";
  totalRuns: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Tool ─────────────────────────────────────────────────────────────────────

export interface Tool {
  id: string;
  name: string;
  slug: string;
  type: ToolType;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  riskLevel: RiskLevel;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  idempotent: boolean;
  authConnectionRef: string | null;
  // HTTP-specific
  httpConfig?: {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    url: string;
    headers: Record<string, string>;
    bodyTemplate?: string;
  };
  status: "active" | "inactive";
  totalCalls: number;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Workflow Step ────────────────────────────────────────────────────────────

export interface LlmStepConfig {
  provider: string;
  model: string;
  prompt: string;
  outputSchema?: Record<string, unknown>;
  validationEnabled: boolean;
}

export interface ApprovalStepConfig {
  title: string;
  message: string;
  riskLevel: RiskLevel;
  approverRole?: string;
  approverUserIds?: string[];
  payloadMapping?: Record<string, string>;
  timeoutMs?: number;
  onApproveNextStepId?: string;
  onRejectNextStepId?: string;
}

export interface BranchStepConfig {
  conditionExpression: string;
  trueNextStepId?: string;
  falseNextStepId?: string;
}

export interface TimerStepConfig {
  delayMs: number;
}

export interface WorkflowStep {
  id: string;
  name: string;
  type: StepType;
  // Agent step
  agentId?: string;
  // Tool step
  toolId?: string;
  requireApproval?: boolean;
  // LLM step
  llmConfig?: LlmStepConfig;
  // Approval gate (step-level detail)
  approvalConfig?: ApprovalStepConfig;
  // Branch step
  branchConfig?: BranchStepConfig;
  // Timer / sleep step
  timerConfig?: TimerStepConfig;
  // Shared
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
  condition?: string;
  nextStepIds: string[];
  retryPolicy?: RetryPolicy;
  timeoutPolicy?: TimeoutPolicy;
  approvalPolicy?: ApprovalPolicy;
  checkpointEnabled: boolean;
  metadata?: Record<string, unknown>;
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export interface Workflow {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: WorkflowStatus;
  creationMode: WorkflowCreationMode;
  currentVersion: string;
  triggerType: TriggerType;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  steps: WorkflowStep[];
  agentIds: string[];
  toolIds: string[];
  scheduleConfig?: {
    cronExpression: string;
    timezone: string;
  };
  retryPolicy: RetryPolicy;
  timeoutPolicy?: TimeoutPolicy;
  budgetPolicy: BudgetPolicy;
  approvalPolicy: ApprovalPolicy;
  totalRuns: number;
  successRate: number;
  lastRunAt: string | null;
  lastRunStatus: RunStatus | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Run Event ────────────────────────────────────────────────────────────────

export interface RunEvent {
  id: string;
  runId: string;
  sequence: number;
  timestamp: string;
  type: RunEventType;
  status: "ok" | "error" | "pending";
  source: WorkflowCreationMode;
  stepId?: string;
  agentId?: string;
  agentName?: string;
  toolId?: string;
  toolName?: string;
  modelName?: string;
  parentEventId?: string;
  input?: unknown;
  output?: unknown;
  metadata?: unknown;
  error?: string;
  durationMs?: number;
  tokens?: number;
  cost?: number;
}

// ─── Run Checkpoint ───────────────────────────────────────────────────────────

export interface RunCheckpoint {
  id: string;
  runId: string;
  workflowId: string;
  workflowVersion: string;
  stepId: string;
  agentId?: string;
  sequence: number;
  state: Record<string, unknown>;
  input: unknown;
  outputSoFar: unknown;
  createdAt: string;
}

// ─── Artifact ─────────────────────────────────────────────────────────────────

export interface RunArtifact {
  id: string;
  runId: string;
  name: string;
  type: string;
  contentType: string;
  sizeBytes: number;
  url?: string;
  preview?: string;
  createdAt: string;
}

// ─── Approval Gate ────────────────────────────────────────────────────────────

export interface ApprovalGate {
  id: string;
  runId: string;
  stepId: string;
  stepName: string;
  workflowId: string;
  workflowName: string;
  requestedAt: string;
  expiresAt?: string;
  status: "pending" | "approved" | "rejected" | "expired";
  requestedBy: string;
  decidedBy?: string;
  decidedAt?: string;
  reason?: string;
  context?: Record<string, unknown>;
}

// ─── Agent Run ────────────────────────────────────────────────────────────────

export interface AgentRun {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: string;
  creationMode: WorkflowCreationMode;
  status: RunStatus;
  triggerType: TriggerType;
  input: unknown;
  output?: unknown;
  currentStepId?: string;
  currentAgentId?: string;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  totalTokens: number | null;
  estimatedCostUsd: number | null;
  error?: string;
  idempotencyKey?: string;
  checkpoints: RunCheckpoint[];
  artifacts: RunArtifact[];
  approvalGates: ApprovalGate[];
  replayAvailable: boolean;
  replayUnavailableReason?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Dashboard summary ────────────────────────────────────────────────────────

export interface PlatformSummary {
  totalWorkflows: number;
  activeWorkflows: number;
  runningRuns: number;
  waitingApprovals: number;
  failedRuns24h: number;
  succeededRuns24h: number;
  totalTokens24h: number;
  totalCost24h: number;
  connectedWorkers: number;
}

// ─── Repository interfaces ────────────────────────────────────────────────────

export interface WorkflowFilters {
  search?: string;
  status?: WorkflowStatus;
  creationMode?: WorkflowCreationMode;
  page?: number;
  pageSize?: number;
}

export interface RunFilters {
  search?: string;
  status?: RunStatus;
  workflowId?: string;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Workflow Version ─────────────────────────────────────────────────────────

export interface WorkflowVersion {
  id: string;
  workflowId: string;
  version: string;
  steps: WorkflowStep[];
  changelog?: string;
  createdAt: string;
}
