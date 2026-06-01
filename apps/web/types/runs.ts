/**
 * Vectorbea Run Execution Timeline — Type System
 * These types power both Business View and Engineering View.
 */

export type RunStatus =
  | "queued" | "running" | "waiting" | "waiting_for_approval"
  | "completed" | "failed" | "cancelled" | "timed_out" | "partially_completed"
  | "recovering" | "continued_as_new";

export type StepStatus =
  | "queued" | "running" | "waiting" | "waiting_for_approval"
  | "waiting_for_signal" | "retrying" | "self_correcting"
  | "completed" | "failed" | "skipped" | "cancelled" | "timed_out"
  | "budget_exceeded" | "rate_limited";

export type StepType =
  | "trigger" | "llm_agent" | "tool_agent" | "http_call" | "db_query"
  | "approval" | "parallel_branch" | "condition" | "timer"
  | "email" | "webhook" | "system";

export type ViewMode = "business" | "engineering" | "logs";

export interface WorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  workflowVersion: string;
  status: RunStatus;
  triggerType: "manual" | "schedule" | "webhook" | "api" | "system";
  environment: "development" | "staging" | "production";
  startedAt: string;
  endedAt?: string;
  durationMs: number;
  currentBlockingReason?: string;
  totalCostUsd: number;
  budgetUsd: number;
  totalTokens: number;
  retryCount: number;
  recoveredFailureCount: number;
  workerQueue: string;
  createdBy: string;
  steps: RunStep[];
  logs: RunLog[];
  events: RunEvent[];
  approvals: ApprovalEvent[];
  toolCalls: ToolCall[];
  recoverySummary: RecoverySummary;
}

export interface RunStep {
  id: string;
  name: string;
  businessName: string;
  description: string;
  businessDescription: string;
  type: StepType;
  status: StepStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  offsetMs: number;
  attemptCount: number;
  maxAttempts?: number;
  workerId?: string;
  queueName?: string;
  model?: string;
  promptVersion?: string;
  tokens?: number;
  costUsd?: number;
  input?: unknown;
  output?: unknown;
  error?: StepError;
  retryPolicy?: RetryPolicy;
  childStepIds?: string[];
  toolCallIds?: string[];
  approvalId?: string;
  isReplaySafe?: boolean;
  sideEffectsCommitted?: boolean;
  isParallel?: boolean;
  parallelGroupId?: string;
}

export interface StepError {
  code: string;
  message: string;
  stackTrace?: string;
  retryable: boolean;
  rootCause?: string;
  impact?: string;
}

export interface RetryPolicy {
  strategy: "none" | "fixed" | "exponential_backoff";
  maxAttempts: number;
  currentAttempt: number;
  nextRetryAt?: string;
  backoffSeconds?: number;
}

export interface RunLog {
  id: string;
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  stepId?: string;
  attempt?: number;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface RunEvent {
  id: string;
  timestamp: string;
  type: string;
  stepId?: string;
  correlationId: string;
  payload: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  stepId: string;
  toolName: string;
  toolType: "llm" | "http" | "database" | "email" | "webhook" | "internal";
  status: "started" | "completed" | "failed" | "retried";
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  attempt: number;
  requestSummary: string;
  responseSummary?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  error?: string;
  costUsd?: number;
}

export interface ApprovalEvent {
  id: string;
  stepId: string;
  status: "requested" | "approved" | "rejected" | "expired";
  requestedAt: string;
  decidedAt?: string;
  requestedBy: string;
  assignedTo: string;
  decidedBy?: string;
  comment?: string;
  payloadSnapshot?: unknown;
  expiresAt?: string;
}

export interface RecoverySummary {
  recoveredFailures: number;
  retryAttempts: number;
  rateLimitEvents: number;
  workerHeartbeatMisses: number;
  selfCorrectionAttempts: number;
  unresolvedBlockers: string[];
  replaySafeResumeAvailable: boolean;
}
