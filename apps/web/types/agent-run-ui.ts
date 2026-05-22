/**
 * agent-run-ui.ts
 *
 * UI-level types for the Agent Run Detail page.
 * These mirror the shape needed by the timeline, tabs, and inspector.
 * When the real API is ready, map AgentRun → AgentRunUiModel in a mapper function.
 */

// ─── Status types ─────────────────────────────────────────────────────────────

export type RunStatus =
  | "QUEUED"
  | "RUNNING"
  | "WAITING_FOR_APPROVAL"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED"
  | "TIMEOUT";

export type TimelineEventStatus =
  | "PENDING"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "WAITING"
  | "CANCELLED"
  | "SKIPPED";

export type TimelineEventSource =
  | "SYSTEM"
  | "SCHEDULER"
  | "WORKER"
  | "ORCHESTRATOR"
  | "AGENT"
  | "TOOL"
  | "LLM"
  | "HUMAN"
  | "API";

// ─── Event types ──────────────────────────────────────────────────────────────

export type TimelineEventType =
  // Run lifecycle
  | "RUN_CREATED"
  | "RUN_QUEUED"
  | "RUN_STARTED"
  | "RUN_PAUSED"
  | "RUN_RESUMED"
  | "RUN_SUCCEEDED"
  | "RUN_FAILED"
  | "RUN_CANCELLED"
  | "RUN_TIMED_OUT"
  // Budget / policy gates
  | "BUDGET_CHECK_PASSED"
  | "BUDGET_CHECK_FAILED"
  | "POLICY_CHECK_PASSED"
  | "POLICY_CHECK_FAILED"
  // Agent lifecycle
  | "AGENT_SELECTED"
  | "AGENT_STARTED"
  | "AGENT_PLAN_CREATED"
  | "AGENT_HANDOFF"
  | "AGENT_COMPLETED"
  | "AGENT_FAILED"
  // Steps
  | "STEP_STARTED"
  | "STEP_COMPLETED"
  | "STEP_FAILED"
  // LLM
  | "LLM_CALL_STARTED"
  | "LLM_CALL_COMPLETED"
  | "LLM_CALL_FAILED"
  | "LLM_OUTPUT_VALIDATED"
  // Tools
  | "TOOL_CALL_STARTED"
  | "TOOL_CALL_COMPLETED"
  | "TOOL_CALL_FAILED"
  // HTTP
  | "HTTP_CALL_STARTED"
  | "HTTP_CALL_COMPLETED"
  | "HTTP_CALL_FAILED"
  // Approvals
  | "APPROVAL_REQUESTED"
  | "APPROVAL_APPROVED"
  | "APPROVAL_REJECTED"
  | "APPROVAL_EXPIRED"
  // Retry
  | "RETRY_SCHEDULED"
  | "RETRY_STARTED"
  | "RETRY_EXHAUSTED"
  // Artifacts
  | "ARTIFACT_CREATED";

// ─── Core event model ────────────────────────────────────────────────────────

export interface RunTimelineEventUi {
  id: string;
  sequence: number;
  type: TimelineEventType;
  status: TimelineEventStatus;
  source: TimelineEventSource;
  title: string;
  summary?: string;
  timestamp: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  agentName?: string;
  stepName?: string;
  toolName?: string;
  modelName?: string;
  actorName?: string;
  inputJson?: unknown;
  outputJson?: unknown;
  metadataJson?: unknown;
  errorMessage?: string;
  tokensUsed?: number;
  estimatedCostUsd?: number;
  artifactName?: string;
  handoffTo?: string;       // AGENT_HANDOFF: name of receiving agent
  approval?: {
    id: string;
    title: string;
    message: string;
    status: "PENDING" | "APPROVED" | "REJECTED";
    decidedBy?: string;
    decidedAt?: string;
    decisionReason?: string;
  };
}

// ─── Agent execution summary ──────────────────────────────────────────────────

export interface AgentExecutionSummary {
  id: string;
  name: string;
  role: string;
  status: TimelineEventStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  stepsCount: number;
  tokensUsed?: number;
  estimatedCostUsd?: number;
  toolsUsed?: string[];
  outputSummary?: string;
}

// ─── Step model ───────────────────────────────────────────────────────────────

export interface RunStepUiModel {
  id: string;
  index: number;
  agentName: string;
  type: string;
  name: string;
  status: TimelineEventStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  tokensUsed?: number;
  estimatedCostUsd?: number;
  inputJson?: unknown;
  outputJson?: unknown;
  errorMessage?: string;
}

// ─── Approval model ───────────────────────────────────────────────────────────

export interface ApprovalUiModel {
  id: string;
  title: string;
  message: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";
  relatedAgent: string;
  relatedStep: string;
  requestedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
  payloadPreview?: unknown;
}

// ─── Artifact model ───────────────────────────────────────────────────────────

export interface ArtifactUiModel {
  id: string;
  name: string;
  type: "json" | "markdown" | "text" | "csv";
  createdByAgent: string;
  createdAt: string;
  sizeLabel: string;
  preview: unknown;
}

// ─── Audit log model ──────────────────────────────────────────────────────────

export interface AuditLogUiModel {
  id: string;
  time: string;
  action: string;
  actor: string;
  entity: string;
  details: string;
  metadataJson?: unknown;
}

// ─── Root model ───────────────────────────────────────────────────────────────

export interface AgentRunUiModel {
  run: {
    id: string;
    jobId: string;
    jobName: string;
    title: string;
    status: RunStatus;
    triggerSource: "MANUAL" | "SCHEDULE" | "RETRY";
    attemptNumber: number;
    environment: "Development" | "Staging" | "Production";
    idempotencyKey: string;
    startedAt: string;
    finishedAt?: string;
    durationMs?: number;
    totalTokens?: number;
    estimatedCostUsd?: number;
    currentAgent?: string;
    currentStep?: string;
    errorMessage?: string;
  };
  agents: AgentExecutionSummary[];
  timelineEvents: RunTimelineEventUi[];
  steps: RunStepUiModel[];
  approvals: ApprovalUiModel[];
  artifacts: ArtifactUiModel[];
  auditLogs: AuditLogUiModel[];
  output?: unknown;
  partialOutput?: unknown;
  raw?: unknown;
}
