export interface AuditLogView {
  timestamp: string;
  workspaceId: string;
  promptName: string;
  versionTag: string;
  proxyLatencyMs: number;
  llmLatencyMs: number;
  tokenCount: number;
  useType: "runtime" | "audit";
  metadata: Record<string, unknown>;
}

export interface PromptListItem {
  id: string;
  name: string;
  description: string | null;
  latestVersion: string;
  isPublished: boolean;
  updatedAt: string | null;
}

export interface PromptDetail {
  promptId: string;
  promptVersionId: string;
  workspaceId: string;
  name: string;
  description: string | null;
  versionTag: string;
  templateText: string;
  parameters: Record<string, unknown>;
  isPublished: boolean;
  createdAt: string | null;
}

export interface DashboardSummary {
  totalApiCallsLast24h: number;
  auditsThisMonth: number;
  averageLatencyMs: number;
  activeAgents: number;
}

export interface DailyRequestPoint {
  day: string;
  requests: number;
}

export type WorkspaceRole = "admin" | "editor" | "viewer";
export type PlanTier = "free" | "team" | "pro" | "enterprise";

export interface OrganizationWorkspaceView {
  id: string;
  name: string;
  role?: WorkspaceRole | null;
  organizationId?: string | null;
  organizationName?: string | null;
}

export interface OrganizationView {
  id: string;
  name: string;
  createdAt: string | null;
  role?: WorkspaceRole | null;
  workspaceRole?: WorkspaceRole | null;
  workspaces?: OrganizationWorkspaceView[];
  planTier?: PlanTier | null;
  maxSeats?: number | null;
  maxPrompts?: number | null;
  monthlyAuditLimit?: number | null;
  currentUsers?: number | null;
  billingPortalUrl?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
}

export interface ApiKeyView {
  id: string;
  workspaceId: string;
  name: string;
  maskedKey: string;
  createdAt: string;
}

export interface CreateApiKeyResponse {
  id: string;
  workspaceId: string;
  name: string;
  apiKey: string;
  createdAt: string;
}

export interface WorkspaceMember {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "editor" | "viewer";
  joinedAt: string;
}

export interface DeploymentAgentView {
  id: string;
  workspaceId: string;
  name: string;
  status: string;
  lastHeartbeat: string | null;
  createdAt: string | null;
}

export interface AgentMetricPoint {
  id: string;
  agentId: string;
  latencyMs: number;
  cpuUsagePercent: number;
  memoryUsageMb: number;
  activeReplicas: number;
  createdAt: string;
}

export interface RegisterAgentResponse {
  agent: DeploymentAgentView;
  token: string;
}

export type AuditLog = {
  id: string;
  prompt_name: string;
  version_tag: string;
  proxy_latency_ms: number;
  llm_latency_ms: number;
  token_count: number;
  metadata: Record<string, unknown> | null;
  created_at: string;
  workspace_id: string;
};

export type TraceStatus = "success" | "warning" | "error" | "partial";
export type TraceUseType = "runtime" | "audit";
export type TraceCacheStatus = "hit" | "miss" | "skipped" | "stale" | "unknown";
export type TraceGuardrailStatus = "passed" | "flagged" | "unknown";
export type TraceExecutorType = "direct_provider" | "enterprise_gateway" | "observe_only" | "unknown";
export type TraceExecutorObservability = "full" | "partial" | "minimal" | "unknown";
export type TraceEvaluationLabel = "better" | "same" | "worse" | "pass" | "fail" | "unknown";

export interface TraceSummaryView {
  id: string;
  createdAt: string;
  status: TraceStatus;
  useType: TraceUseType;
  environment: string;
  promptName: string;
  promptVersion: string;
  model: string | null;
  provider: string | null;
  executorType: TraceExecutorType;
  executorName: string | null;
  executorObservability: TraceExecutorObservability;
  replayOf: string | null;
  sidecarName: string | null;
  durationMs: number;
  llmLatencyMs: number;
  tokenCount: number;
  totalCostUsd: number | null;
  cacheStatus: TraceCacheStatus;
  fallbackUsed: boolean;
  guardrail: TraceGuardrailStatus;
}

export interface TraceListResponse {
  items: TraceSummaryView[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface TraceLogView {
  id: string;
  timestamp: string;
  offsetMs: number;
  level: "debug" | "info" | "warn" | "error";
  component: string;
  message: string;
  spanId?: string;
}

export interface TraceSpanView {
  id: string;
  parentId: string | null;
  name: string;
  type:
    | "incoming_request"
    | "sidecar_proxy"
    | "prompt_resolution"
    | "template_render"
    | "retrieval_query"
    | "vector_lookup"
    | "rerank"
    | "context_assembly"
    | "cache"
    | "model_selection"
    | "llm_completion"
    | "guardrail"
    | "response_parser"
    | "fallback"
    | "audit_sink"
    | "evaluation_hook";
  service: string;
  status: TraceStatus;
  startMs: number;
  durationMs: number;
  tokensIn?: number;
  tokensOut?: number;
  costUsd?: number;
  model?: string;
  provider?: string;
  promptVersion?: string;
  cacheStatus?: "hit" | "miss";
  guardrailResult?: "passed" | "flagged";
  retries?: number;
  criticalPath?: boolean;
  aiSpecific?: boolean;
  branch?: "primary" | "fallback";
  tags?: Record<string, string | number | boolean>;
  inputPreview?: string;
  outputPreview?: string;
}

export interface TraceDetailView {
  id: string;
  status: TraceStatus;
  startedAt: string;
  env: string;
  durationMs: number;
  totalCostUsd: number;
  tokensIn: number;
  tokensOut: number;
  promptName: string;
  promptVersion: string;
  sidecarName: string;
  primaryModel: string;
  provider: string;
  executorType: TraceExecutorType;
  executorName: string;
  executorOwnership: string;
  executorObservability: TraceExecutorObservability;
  replayOf: string | null;
  cacheStatus: TraceCacheStatus;
  fallbackUsed: boolean;
  guardrail: "passed" | "flagged";
  evalScore: number;
  evaluation: TraceEvaluationView | null;
  spans: TraceSpanView[];
  logs: TraceLogView[];
  prompt: {
    name: string;
    version: string;
    source: "published" | "draft" | "experiment";
    publishedBy: string;
    rolloutPercent: number;
    releaseTag: string;
    evalBaseline: number;
    params: { temperature: number; top_p: number; max_tokens: number };
    system: string;
    developer: string;
    userTemplate: string;
    renderedPrompt: string;
    variables: Record<string, string>;
  };
  inputs: {
    userInput: string;
    variables: Record<string, string>;
    contextDocs: Array<{ id: string; source: string; title: string; tokenCount: number; content: string }>;
    headers: Record<string, string>;
    tenant: string;
    workspace: string;
    environment: string;
    cacheKey: string;
    sessionId: string;
    conversationId: string;
  };
  outputs: {
    rawPrimary: string;
    rawFallback?: string;
    postProcessed: string;
    finalDelivered: string;
    parsedJson?: Record<string, unknown>;
    safetyNotes: string[];
  };
}

export interface TraceReplayResponse {
  traceId: string;
  replayedFrom: string;
  createdAt: string;
}

export interface TraceEvaluationCheckView {
  name: string;
  label: TraceEvaluationLabel;
  score: number | null;
  reason: string;
}

export interface TraceEvaluationView {
  score: number | null;
  label: TraceEvaluationLabel;
  runId?: string | null;
  datasetId?: string | null;
  comparedAgainstTraceId?: string | null;
  evaluationMode?: "replay_compare" | "single_trace" | "batch_replay" | string;
  checks: TraceEvaluationCheckView[];
}

export interface TraceCompareFieldView {
  key: string;
  label: string;
  left: string | number | boolean | null;
  right: string | number | boolean | null;
  changed: boolean;
  delta?: number | null;
  note?: string;
}

export interface TraceCompareResponse {
  left: TraceDetailView;
  right: TraceDetailView;
  summary: {
    outputChanged: boolean;
    promptVersionChanged: boolean;
    executorChanged: boolean;
    observabilityChanged: boolean;
    statusChanged: boolean;
    latencyDeltaMs: number;
    tokenDelta: number | null;
    costDeltaUsd: number | null;
    replayLineage: string | null;
    evaluation: TraceEvaluationView | null;
  };
  fields: TraceCompareFieldView[];
  callouts: string[];
}

export type EvaluationRunStatus = "queued" | "running" | "completed" | "failed" | "approved";
export type EvaluationRecommendation = "ready_for_rollout" | "needs_review" | "regression_detected";

export interface TraceSetEvaluationRunView {
  id: string;
  workspaceId: string;
  status: EvaluationRunStatus;
  promptName: string;
  candidatePromptVersionId: string;
  candidateVersionTag: string;
  sourceTraceIds: string[];
  replayTraceIds: string[];
  createdAt: string;
  aggregate: {
    total: number;
    succeeded: number;
    failed: number;
    outputChanged: number;
    latencyImproved: number;
    latencyRegressed: number;
    unavailableObservability: number;
    averageLatencyDeltaMs: number | null;
    averageTokenDelta: number | null;
    score: number | null;
    recommendation: EvaluationRecommendation;
  };
  results: Array<{
    sourceTraceId: string;
    replayTraceId: string | null;
    score: number | null;
    label: TraceEvaluationLabel;
    status: TraceStatus;
    latencyDeltaMs: number | null;
    tokenDelta: number | null;
    error?: string | null;
  }>;
  approvedAt?: string | null;
  approvedBy?: string | null;
}

type ApiFetchOptions = RequestInit & {
  workspaceId?: string | null;
};

function resolveAuthToken(): string {
  const token =
    typeof window === "undefined"
      ? process.env.VECTORBEA_API_KEY
      : null;
  return token ? `Bearer ${token}` : "";
}

function resolveApiUrl() {
  if (typeof window === "undefined") {
    return process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  }

  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
}

export function withWorkspaceId(path: string, workspaceId?: string | null) {
  if (!workspaceId) return path;

  const [pathname, hash = ""] = path.split("#", 2);
  const separator = pathname.includes("?") ? "&" : "?";
  return pathname.includes("workspaceId=")
    ? path
    : `${pathname}${separator}workspaceId=${encodeURIComponent(workspaceId)}${hash ? `#${hash}` : ""}`;
}

export async function apiFetch<T>(path: string, init?: ApiFetchOptions): Promise<T> {
  const { workspaceId, ...requestInit } = init ?? {};

  // Server-side calls to our own API routes must carry the internal secret so
  // the IP whitelist middleware lets them through (the request originates from
  // AWS infra, not the user's whitelisted IP).
  const internalSecret = typeof window === "undefined"
    ? (process.env.INTERNAL_API_SECRET ?? "")
    : "";

  const response = await fetch(`${resolveApiUrl()}${withWorkspaceId(path, workspaceId)}`, {
    ...requestInit,
    headers: {
      Authorization: resolveAuthToken(),
      "Content-Type": "application/json",
      ...(internalSecret ? { "x-internal-secret": internalSecret } : {}),
      ...(requestInit.headers ?? {}),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`API request failed (${response.status}): ${message}`);
  }

  if (response.status === 204 || response.headers.get("content-length") === "0") {
    return undefined as T;
  }

  return (await response.json()) as T;
}
