/**
 * Vectorbee Workflow Graph Types
 *
 * The graph-based data model for the Workflow Builder.
 * Replaces the linear WorkflowStep[] with nodes + edges.
 */

import type { RetryPolicy, TimeoutPolicy, RiskLevel } from "./platform";

// ─── Node types ───────────────────────────────────────────────────────────────

export type WFNodeType =
  | "trigger"
  | "agent"
  | "llm"
  | "tool"
  | "approval"
  | "branch"
  | "parallel"
  | "join"
  | "timer"
  | "artifact"
  | "checkpoint"
  | "end";

// ─── Edge types ───────────────────────────────────────────────────────────────

export type WFEdgeType =
  | "default"
  | "success"
  | "failure"
  | "conditional_true"
  | "conditional_false"
  | "parallel"
  | "approval_approved"
  | "approval_rejected"
  | "join";

// ─── Node configs per type ────────────────────────────────────────────────────

export interface TriggerConfig {
  triggerType: "manual" | "cron" | "webhook" | "api" | "event";
  cronExpression?: string;
  timezone?: string;
  webhookPath?: string;
  description?: string;
}

export interface AgentNodeConfig {
  agentId?: string;
  agentName?: string;
  role?: string;
  modelName?: string;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
  retryPolicy?: RetryPolicy;
  timeoutPolicy?: TimeoutPolicy;
  checkpointEnabled?: boolean;
}

export interface LlmNodeConfig {
  provider: string;
  model: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  outputSchema?: Record<string, unknown>;
  validationEnabled?: boolean;
  checkpointEnabled?: boolean;
}

export interface ToolNodeConfig {
  toolId?: string;
  toolName?: string;
  toolType?: string;
  riskLevel?: RiskLevel;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
  requireApproval?: boolean;
  idempotencyKey?: string;
  retryPolicy?: RetryPolicy;
}

export interface ApprovalNodeConfig {
  title: string;
  message: string;
  riskLevel: RiskLevel;
  approverRole?: string;
  approverUserIds?: string[];
  timeoutMs?: number;
  onTimeoutAction?: "auto_approve" | "auto_reject" | "pause";
}

export interface BranchNodeConfig {
  conditionExpression: string;
  trueLabel?: string;
  falseLabel?: string;
  description?: string;
}

export interface ParallelNodeConfig {
  branchNames?: string[];
  executionMode: "all" | "first_success" | "quorum";
  quorumCount?: number;
  maxConcurrency?: number;
}

export interface JoinNodeConfig {
  joinPolicy: "wait_all" | "wait_any" | "quorum";
  quorumCount?: number;
  timeoutMs?: number;
  onTimeout?: "fail" | "continue_available";
  incomingBranchCount?: number;
}

export interface TimerNodeConfig {
  delayMs: number;
  resumePolicy?: "immediate" | "next_business_day";
  description?: string;
}

export interface ArtifactNodeConfig {
  artifactName: string;
  artifactType: "json" | "text" | "markdown" | "binary";
  sourceExpression?: string;
  storeExternal?: boolean;
}

export interface CheckpointNodeConfig {
  checkpointName: string;
  stateKeys?: string[];
  replayEnabled?: boolean;
  description?: string;
}

export interface EndNodeConfig {
  outputMapping?: Record<string, string>;
  terminalStatus?: "succeeded" | "failed" | "cancelled";
  description?: string;
}

// ─── Node data (generic container) ───────────────────────────────────────────

export interface WFNodeData extends Record<string, unknown> {
  label: string;
  description?: string;
  nodeType: WFNodeType;
  // Per-type config (only the relevant one will be set)
  triggerConfig?: TriggerConfig;
  agentConfig?: AgentNodeConfig;
  llmConfig?: LlmNodeConfig;
  toolConfig?: ToolNodeConfig;
  approvalConfig?: ApprovalNodeConfig;
  branchConfig?: BranchNodeConfig;
  parallelConfig?: ParallelNodeConfig;
  joinConfig?: JoinNodeConfig;
  timerConfig?: TimerNodeConfig;
  artifactConfig?: ArtifactNodeConfig;
  checkpointConfig?: CheckpointNodeConfig;
  endConfig?: EndNodeConfig;
  // Runtime preview status
  previewStatus?: "idle" | "running" | "succeeded" | "failed" | "waiting" | "skipped";
}

// ─── Edge data ────────────────────────────────────────────────────────────────

export interface WFEdgeData extends Record<string, unknown> {
  edgeType: WFEdgeType;
  label?: string;
  condition?: string;
  animated?: boolean;
}

// ─── Saved graph (persisted to workflow) ─────────────────────────────────────

export interface SavedWorkflowNode {
  id: string;
  type: WFNodeType;
  position: { x: number; y: number };
  data: WFNodeData;
}

export interface SavedWorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  data?: WFEdgeData;
}

export interface WorkflowGraph {
  nodes: SavedWorkflowNode[];
  edges: SavedWorkflowEdge[];
  version?: string;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export type ValidationSeverity = "error" | "warning" | "info";

export interface ValidationIssue {
  nodeId?: string;
  edgeId?: string;
  severity: ValidationSeverity;
  code: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  replaySupport: "full" | "partial" | "none";
}

// ─── Template ─────────────────────────────────────────────────────────────────

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  complexity: "simple" | "intermediate" | "advanced";
  tags: string[];
  graph: WorkflowGraph;
}
