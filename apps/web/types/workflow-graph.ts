/**
 * Vectorbee Workflow Graph Types
 *
 * The graph-based data model for the Workflow Builder.
 * Supports the full fine-grained execution model including HTTP, DB, LLM,
 * transform, MCP, approval, branch/parallel/join, and webhook-wait nodes.
 */

import type { RetryPolicy, TimeoutPolicy, RiskLevel } from "./platform";

// ─── Node types ───────────────────────────────────────────────────────────────

export type WFNodeType =
  | "trigger"
  | "agent"
  | "llm"
  | "tool"
  | "http_tool"
  | "graphql_tool"
  | "db_read"
  | "db_write"
  | "mcp_tool"
  | "grpc_tool"
  | "transform"
  | "webhook_wait"
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
  | "parallel_branch"
  | "approval_approved"
  | "approved"
  | "approval_rejected"
  | "rejected"
  | "join"
  | "timeout";

// ─── Output extraction config ─────────────────────────────────────────────────

export type OutputExtractionMode =
  | "full_response"
  | "body"
  | "json_path"
  | "headers"
  | "status_code"
  | "custom_mapping";

export interface OutputExtractionConfig {
  mode: OutputExtractionMode;
  /** JSONPath expression when mode = 'json_path', e.g. "$.data.id" */
  jsonPath?: string;
  /** Header name when mode = 'headers' */
  headerName?: string;
  /** Key → JSONPath mapping when mode = 'custom_mapping' */
  fieldMappings?: Record<string, string>;
  /** Output key to store extracted value under (default: "result") */
  outputKey?: string;
}

// ─── Node configs per type ────────────────────────────────────────────────────

export interface TriggerConfig {
  triggerType: "manual" | "cron" | "webhook" | "api" | "event";
  cronExpression?: string;
  timezone?: string;
  webhookPath?: string;
  /** JSON Schema for the workflow input */
  inputSchema?: Record<string, unknown>;
  description?: string;
}

export interface AgentNodeConfig {
  agentId?: string;
  agentName?: string;
  role?: string;
  modelName?: string;
  /** Per-invocation task instruction (supports template expressions) */
  taskInstruction?: string;
  /** Tool IDs to override the agent's default allowed tools */
  toolOverrideIds?: string[];
  /** Max agent iterations for this invocation (overrides agent default) */
  maxIterations?: number;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
  outputExtraction?: OutputExtractionConfig;
  retryPolicy?: RetryPolicy;
  timeoutPolicy?: TimeoutPolicy;
  checkpointEnabled?: boolean;
}

export interface LlmNodeConfig {
  /** Connection ID for the LLM provider */
  connectionId?: string;
  provider: string;
  model: string;
  /** System prompt (supports template expressions) */
  systemPrompt?: string;
  /** User prompt template (supports {{ workflow.input.X }}, {{ steps.N.output.Y }}) */
  userPromptTemplate?: string;
  /**
   * @deprecated Use systemPrompt + userPromptTemplate instead.
   * Legacy single-field prompt for backward compatibility.
   */
  prompt?: string;
  temperature?: number;
  maxTokens?: number;
  /** JSON Schema for structured output — enables repair-invalid-JSON mode */
  outputSchema?: Record<string, unknown>;
  /** Whether to validate response against outputSchema */
  validationEnabled?: boolean;
  /** Repair malformed JSON responses automatically */
  repairJson?: boolean;
  checkpointEnabled?: boolean;
  outputExtraction?: OutputExtractionConfig;
}

export interface HttpToolNodeConfig {
  /** Connection ID for auth/base-URL (optional — can use full URL) */
  connectionId?: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** URL template (supports {{ expressions }}) */
  urlTemplate: string;
  /** Header map — values support {{ expressions }} */
  headers?: Record<string, string>;
  /** Query param map — values support {{ expressions }} */
  queryParams?: Record<string, string>;
  /** Body template (JSON string with {{ expressions }}) */
  bodyTemplate?: string;
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Maximum response body size in bytes */
  maxResponseBytes?: number;
  /** Expected response content type */
  responseContentType?: "json" | "text" | "binary";
  /** Allowed hosts pattern (SSRF protection allowlist) */
  allowedHosts?: string[];
  outputExtraction?: OutputExtractionConfig;
  outputSchema?: Record<string, unknown>;
  retryPolicy?: RetryPolicy;
}

export interface GraphqlToolNodeConfig {
  /** Connection ID for the GraphQL endpoint */
  connectionId?: string;
  /** GraphQL endpoint URL template */
  endpointTemplate?: string;
  /** GraphQL query/mutation (supports template expressions for variables) */
  query: string;
  /** Variable map — values support {{ expressions }} */
  variables?: Record<string, string>;
  operationName?: string;
  timeoutMs?: number;
  outputExtraction?: OutputExtractionConfig;
  outputSchema?: Record<string, unknown>;
}

export interface DbReadNodeConfig {
  /** Connection ID for the database */
  connectionId?: string;
  /** SQL query with $1, $2 ... placeholders (NEVER string-concatenate) */
  sqlTemplate: string;
  /** Parameter map — values support {{ expressions }} */
  parameters?: Record<string, string>;
  /** Schema to qualify the query (e.g. "public") */
  schema?: string;
  /** Max rows to return */
  maxRows?: number;
  outputExtraction?: OutputExtractionConfig;
  outputSchema?: Record<string, unknown>;
}

export interface DbWriteNodeConfig {
  /** Connection ID for the database */
  connectionId?: string;
  /** SQL statement with $1, $2 ... placeholders */
  sqlTemplate: string;
  /** Parameter map — values support {{ expressions }} */
  parameters?: Record<string, string>;
  schema?: string;
  /** Risk level — write nodes require explicit acknowledgement */
  riskLevel: RiskLevel;
  /** Require approval before execution */
  requireApproval?: boolean;
  outputExtraction?: OutputExtractionConfig;
}

export interface McpToolNodeConfig {
  /** Connection ID for the MCP server */
  connectionId?: string;
  /** MCP tool name */
  toolName: string;
  /** Argument map — values support {{ expressions }} */
  arguments?: Record<string, string>;
  timeoutMs?: number;
  outputExtraction?: OutputExtractionConfig;
  outputSchema?: Record<string, unknown>;
}

export interface GrpcToolNodeConfig {
  /** Connection ID for the gRPC endpoint */
  connectionId?: string;
  service: string;
  method: string;
  /** Request payload template (JSON string with {{ expressions }}) */
  requestTemplate?: string;
  timeoutMs?: number;
  outputExtraction?: OutputExtractionConfig;
}

export interface TransformNodeConfig {
  /**
   * Transform engine: "template" (Mustache-style), "jsonata", "jq"
   * Default: "template"
   */
  engine?: "template" | "jsonata" | "jq";
  /**
   * The transform expression.
   * - template: string with {{ expressions }}
   * - jsonata: JSONata expression
   * - jq: jq filter (server-side only)
   */
  expression: string;
  /** Output key to store result under */
  outputKey?: string;
  outputSchema?: Record<string, unknown>;
}

export interface WebhookWaitNodeConfig {
  /** Path suffix for the inbound webhook (auto-assigned if omitted) */
  webhookPath?: string;
  /** Expected HTTP method */
  method?: "GET" | "POST" | "PUT";
  /** Timeout in milliseconds */
  timeoutMs?: number;
  /** Secret token for HMAC verification (stored as secretRef) */
  secretRef?: string;
  outputExtraction?: OutputExtractionConfig;
}

export interface ToolNodeConfig {
  toolId?: string;
  toolName?: string;
  toolType?: string;
  riskLevel?: RiskLevel;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
  outputExtraction?: OutputExtractionConfig;
  requireApproval?: boolean;
  idempotencyKey?: string;
  retryPolicy?: RetryPolicy;
}

export interface ApprovalNodeConfig {
  title: string;
  /** Message template (supports {{ expressions }}) */
  message: string;
  riskLevel: RiskLevel;
  approverRole?: string;
  approverUserIds?: string[];
  timeoutMs?: number;
  onTimeoutAction?: "auto_approve" | "auto_reject" | "pause";
  /** Map of context keys to include in the approval payload */
  payloadMapping?: Record<string, string>;
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
  /** Expression to resolve artifact content from run context */
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

  // ── Shared execution policies ────────────────────────────────────────────────
  /** Template expressions mapping step inputs from run context */
  inputMappingJson?: Record<string, string>;
  /** Template expressions mapping step output keys into run context */
  outputMappingJson?: Record<string, string>;
  /** Output extraction configuration */
  outputExtractionJson?: OutputExtractionConfig;
  /** JSON Schema to validate step inputs before execution */
  inputSchemaJson?: Record<string, unknown>;
  /** JSON Schema to validate step outputs after execution */
  outputSchemaJson?: Record<string, unknown>;
  /** Retry policy for this node */
  retryPolicyJson?: RetryPolicy;
  /** Timeout policy for this node */
  timeoutPolicyJson?: TimeoutPolicy;
  /** Approval gate config (any node can require approval before execution) */
  approvalPolicyJson?: {
    requireApproval: boolean;
    approvers?: string[];
    timeoutMs?: number;
    onTimeout?: "auto_approve" | "auto_reject" | "pause";
  };
  /** Whether to checkpoint after successful execution */
  checkpointPolicyJson?: {
    enabled: boolean;
    stateKeys?: string[];
  };

  // ── Per-type configs ─────────────────────────────────────────────────────────
  triggerConfig?: TriggerConfig;
  agentConfig?: AgentNodeConfig;
  llmConfig?: LlmNodeConfig;
  toolConfig?: ToolNodeConfig;
  httpToolConfig?: HttpToolNodeConfig;
  graphqlToolConfig?: GraphqlToolNodeConfig;
  dbReadConfig?: DbReadNodeConfig;
  dbWriteConfig?: DbWriteNodeConfig;
  mcpToolConfig?: McpToolNodeConfig;
  grpcToolConfig?: GrpcToolNodeConfig;
  transformConfig?: TransformNodeConfig;
  webhookWaitConfig?: WebhookWaitNodeConfig;
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

// ─── Run context (populated during execution) ─────────────────────────────────

export interface StepOutputEntry {
  /** Raw output from the step (sanitized — no secrets) */
  raw: unknown;
  /** Extracted output after applying outputExtraction config */
  extracted: unknown;
  /** Validated output after applying outputSchema (if configured) */
  validated?: unknown;
  /** Step execution metadata */
  durationMs?: number;
  tokensUsed?: number;
  estimatedCostUsd?: number;
  status: "succeeded" | "failed" | "skipped";
  errorMessage?: string;
}

export interface WorkflowRunContext {
  /** run.id, run.workspaceId, etc. */
  run: {
    id: string;
    workspaceId: string;
    workflowId: string;
    startedAt: string;
    triggerType: string;
    attemptNumber: number;
  };
  /** Workflow-level input (passed at trigger time) */
  workflow: {
    input: Record<string, unknown>;
  };
  /** Step outputs keyed by node ID and node label */
  steps: Record<string, StepOutputEntry>;
}
