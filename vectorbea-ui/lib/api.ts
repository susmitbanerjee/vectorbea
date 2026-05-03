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
  lifecycleStatus?: "draft" | "candidate" | "active" | "deprecated" | "blocked" | null;
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
export type PlanTier = "free" | "team" | "plus" | "pro" | "enterprise";

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
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  active?: boolean;
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
export type TraceEvaluationCheckCategory =
  | "correctness"
  | "reliability"
  | "performance"
  | "structure"
  | "observability"
  | "safety"
  | "executor_context";
export type TraceEvaluationCheckStatus = "pass" | "fail" | "warning" | "not_applicable";

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
  category?: TraceEvaluationCheckCategory;
  status?: TraceEvaluationCheckStatus;
  label: TraceEvaluationLabel;
  score: number | null;
  weight?: number;
  critical?: boolean;
  available?: boolean;
  reason: string;
}

export interface TraceEvaluationView {
  score: number | null;
  label: TraceEvaluationLabel;
  recommendation?: "ready" | "needs_review" | "blocked" | "regression" | "inconclusive";
  confidence?: number | null;
  criticalFailures?: number;
  observabilityNote?: string | null;
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
export type EvaluationRecommendation = "ready_for_rollout" | "ready_with_caution" | "needs_review" | "regression_detected" | "blocked" | "inconclusive";
export type EvaluationReviewStatus = "pending_review" | "in_review" | "approved" | "rejected" | "needs_changes";
export type EvaluationReviewDecision = "approve" | "reject" | "request_changes" | "start_review";

export interface TraceSetEvaluationRunView {
  id: string;
  workspaceId: string;
  status: EvaluationRunStatus;
  promptName: string;
  candidatePromptVersionId: string;
  candidateVersionTag: string;
  sourceTraceIds: string[];
  replayTraceIds: string[];
  /** Present when run was created from an evaluation_dataset */
  datasetId?: string | null;
  datasetName?: string | null;
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
    confidence: number | null;
    criticalFailures: number;
    observabilityLevel: "full" | "partial" | "minimal" | "unknown";
    recommendation: EvaluationRecommendation;
    reasons: string[];
    unresolvedFlagCount?: number;
  };
  results: Array<{
    datasetItemId?: string | null;
    sourceTraceId: string;
    replayTraceId: string | null;
    score: number | null;
    label: TraceEvaluationLabel;
    status: TraceStatus;
    latencyDeltaMs: number | null;
    tokenDelta: number | null;
    confidence?: number | null;
    recommendation?: TraceSetEvaluationRunView["aggregate"]["recommendation"];
    criticalFailures?: number;
    observabilityNote?: string | null;
    replayMode?: "simulated" | "live" | null;
    checks?: TraceEvaluationCheckView[];
    error?: string | null;
    /** For dataset runs: the input text sent to the LLM */
    inputText?: string | null;
    variables?: Record<string, unknown> | null;
    renderedPrompt?: string | null;
    provider?: string | null;
    model?: string | null;
    evaluationMode?: "expected_output" | "reference_model" | "no_reference" | "trace_replay" | string;
    /** For dataset runs: the actual LLM output */
    actualOutput?: string | null;
    /** For dataset runs: the expected output from the dataset item */
    expectedOutput?: string | null;
    referenceOutput?: string | null;
    similarityScore?: number | null;
    similarityLabel?: "high" | "medium" | "low" | "unavailable";
    similarityReason?: string | null;
    confidenceLabel?: "high" | "medium" | "low" | "insufficient";
    confidenceReasons?: string[];
    executionSteps?: Array<{
      name: string;
      label: string;
      status: "pending" | "running" | "success" | "warning" | "error" | "skipped";
      startedAt?: string | null;
      completedAt?: string | null;
      durationMs?: number | null;
      summary: string;
      details?: Record<string, unknown>;
    }>;
    modelResults?: Array<{
      provider: string;
      model: string;
      score: number | null;
      similarityScore: number | null;
      confidence: number | null;
      latencyMs: number | null;
      status: TraceStatus;
      output: string | null;
    }>;
  }>;
  review: {
    status: EvaluationReviewStatus;
    decision: EvaluationReviewDecision | null;
    reviewerId: string | null;
    reviewerNote: string | null;
    reviewedAt: string | null;
  };
  promotion: {
    allowed: boolean;
    reasons: string[];
  };
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

// ─── Golden Traces ─────────────────────────────────────────────────────────────

export type GoldenTrace = {
  id: string;
  workspaceId: string;
  traceId: string;
  promptName: string | null;
  promptVersion: string | null;
  label: string | null;
  notes: string | null;
  createdBy: string;
  createdAt: string;
};

// ─── Provider Configs ──────────────────────────────────────────────────────────

export interface ProviderConfig {
  id: string;
  workspaceId: string;
  providerType: "openai" | "anthropic" | "google" | "enterprise_gateway";
  displayName: string;
  enabled: boolean;
  defaultModel: string | null;
  baseUrl: string | null;
  maskedKey: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string | null;
}

// ─── Evaluation Datasets ───────────────────────────────────────────────────────

export type EvaluationDatasetType = "manual" | "imported" | "runtime" | "golden" | "mixed";
export type EvaluationDatasetItemSourceType = "manual" | "runtime_trace" | "golden_trace" | "imported";

export interface EvaluationDataset {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  datasetType: EvaluationDatasetType;
  itemCount: number;
  promptName: string | null;
  /** UUID of the prompt this dataset is scoped to (null = legacy unscoped dataset) */
  promptId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** "baseline" = migrated from baseline_datasets; "evaluation" = native */
  origin: "baseline" | "evaluation";
}

export interface EvaluationDatasetItem {
  id: string;
  datasetId: string;
  workspaceId: string;
  sourceType: EvaluationDatasetItemSourceType;
  input: string;
  expectedOutput: string | null;
  /** Known-good reference output used for similarity scoring */
  referenceOutput: string | null;
  /** UUID of the prompt that generated this item's input/trace */
  sourcePromptId: string | null;
  /** UUID of the specific prompt version */
  sourcePromptVersionId: string | null;
  traceId: string | null;
  metadata: Record<string, unknown> | null;
  notes: string | null;
  isGolden: boolean;
  ord: number;
  createdAt: string;
}

// ─── Baseline Datasets ─────────────────────────────────────────────────────────

export type BaselineDatasetSourceType = "trace_set" | "golden_traces" | "manual";

export type BaselineDataset = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  sourceType: BaselineDatasetSourceType;
  traceIds: string[];
  promptName: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

// ─── Regression Schedules ──────────────────────────────────────────────────────

export type RegressionScheduleStatus = "idle" | "running" | "failed" | "disabled";

export type RegressionScheduleRunLog = {
  runId: string;
  status: "running" | "completed" | "failed";
  scheduleId: string;
  baselineDatasetId: string | null;
  baselineDatasetName: string | null;
  promptVersionId: string | null;
  evaluationRunId: string | null;
  replayCount: number;
  failedTraceIds: string[];
  errorReason: string | null;
  startedAt: string;
  completedAt: string | null;
  // Extended fields
  baselineScore: number | null;
  behavioralScore: number | null;
  combinedScore: number | null;
  failedCasesCount: number;
  hardFailuresCount: number;
  needsReviewCount: number;
  childEvaluationRunIds: string[];
  behavioralRunId: string | null;
};

export type RegressionSchedule = {
  id: string;
  workspaceId: string;
  name: string;
  baselineDatasetId: string;
  baselineDatasetName: string | null;
  candidatePromptVersionStrategy: "latest_published" | "specific_version";
  candidatePromptVersionId: string | null;
  promptName: string | null;
  cronExpression: string | null;
  enabled: boolean;
  status: RegressionScheduleStatus;
  lastRunAt: string | null;
  lastRunEvaluationRunId: string | null;
  lastRunRecommendation: string | null;
  nextRunAt: string | null;
  lastRunLog: RegressionScheduleRunLog | null;
  runHistory: RegressionScheduleRunLog[];
  createdBy: string;
  createdAt: string;
  // Behavioral dataset support
  behavioralDatasetId: string | null;
  behavioralDatasetName: string | null;
  rubricId: string | null;
  rubricName: string | null;
  providerType: string | null;
  providerModel: string | null;
};

// ─── Rollout ────────────────────────────────────────────────────────────────────

export type RolloutStatus = "draft" | "candidate" | "active" | "deprecated" | "blocked";

export type PromptVersionRollout = {
  promptVersionId: string;
  versionTag: string;
  rolloutStatus: RolloutStatus;
  rolloutPercentage: number;
  isPublished: boolean;
  evaluationVerdict?: string | null;
  lifecycleStatus?: string | null;
};

export type PromptRolloutDistribution = {
  promptId: string;
  promptName: string;
  versions: PromptVersionRollout[];
  totalCandidatePercentage: number;
  activeVersionId: string | null;
};

// ─── Metrics ────────────────────────────────────────────────────────────────────

export type TimeWindow = "1h" | "24h" | "7d";

export type PromptMetricRow = {
  promptName: string;
  requestCount: number;
  successRate: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number | null;
  cacheHitRate: number;
  evalScoreAvg: number | null;
  tokenAvg: number | null;
};

export type WorkspaceMetricsSummary = {
  window: TimeWindow;
  totalRequests: number;
  successRate: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number | null;
  cacheHitRate: number;
  evalScoreAvg: number | null;
  byPrompt: PromptMetricRow[];
  latencyTrend: Array<{ bucket: string; avgMs: number; count: number }>;
};

// ─── Alerts ─────────────────────────────────────────────────────────────────────

export type AlertMetricType = "latency_p95" | "error_rate" | "eval_score_avg" | "cache_hit_rate";
export type AlertComparison = "gt" | "lt" | "gte" | "lte";

export type AlertRule = {
  id: string;
  workspaceId: string;
  name: string;
  metricType: AlertMetricType;
  threshold: number;
  comparison: AlertComparison;
  windowHours: number;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
};

export type AlertEvent = {
  id: string;
  ruleId: string;
  ruleName?: string | null;
  workspaceId: string;
  metricValue: number;
  threshold: number;
  promptName: string | null;
  triggeredAt: string;
  resolvedAt: string | null;
};

export type AlertEvaluationResult = {
  triggered: AlertEvent[];
  checked: number;
};

// ─── Release Policy ─────────────────────────────────────────────────────────────

export type PromptReleasePolicy = {
  id: string;
  workspaceId: string;
  promptId: string;
  minScore: number | null;
  requireCriticalPass: boolean;
  maxRegressionCount: number | null;
  blockOnAnyFailure: boolean;
  requireJsonValid: boolean;
  requireNoSafetyFailures: boolean;
  maxLatencyIncreasePct: number | null;
  maxCostIncreasePct: number | null;
  createdAt: string;
  updatedAt: string;
};

export type PolicyViolation = {
  code: string;
  reason: string;
  severity: "blocking" | "warning";
};

export type PolicyCheckResult = {
  passed: boolean;
  violations: PolicyViolation[];
  checkedAt: string;
};

// ─── Failure Clusters (client-side analysis) ─────────────────────────────────────

export type FailureCluster = {
  id: string;
  name: string;
  severity: "critical" | "high" | "medium";
  count: number;
  affectedIndices: number[];
  explanation: string;
  suggestedFix: string;
};

// ─── Behavioral Evaluations ───────────────────────────────────────────────────

export type BehavioralPromptType =
  | "customer_support"
  | "rag_answer"
  | "summarization"
  | "classification"
  | "extraction"
  | "agent_workflow"
  | "general";

export type RiskLevel = "low" | "medium" | "high" | "critical";

export type RubricRuleType = "must_do" | "must_not_do" | "hard_fail";

export type RubricSeverity = "low" | "medium" | "high" | "critical";

export interface BehavioralDataset {
  id: string;
  workspaceId: string;
  promptId: string;
  name: string;
  description: string | null;
  promptType: BehavioralPromptType;
  isArchived: boolean;
  itemCount: number;
  /** Prompt name resolved client-side from the prompts list */
  promptName?: string | null;
  rubricId?: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BehavioralDatasetItem {
  id: string;
  datasetId: string;
  input: string;
  context: string | null;
  metadata: Record<string, unknown> | null;
  tags: string[];
  riskLevel: RiskLevel;
  referenceOutput: string | null;
  rubricOverride: Record<string, unknown> | null;
  sourceTraceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EvaluationRubric {
  id: string;
  workspaceId: string;
  datasetId: string;
  promptId: string;
  name: string;
  promptType: BehavioralPromptType;
  goal: string | null;
  passThreshold: number;
  judgeModel: string | null;
  judgeProvider: string | null;
  isLocked: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Eagerly loaded */
  dimensions?: RubricDimension[];
  rules?: RubricRule[];
}

export interface RubricDimension {
  id: string;
  rubricId: string;
  name: string;
  description: string | null;
  weight: number;
  scaleMin: number;
  scaleMax: number;
  passThreshold: number;
  ord: number;
  createdAt: string;
  updatedAt: string;
}

export interface RubricRule {
  id: string;
  rubricId: string;
  ruleType: RubricRuleType;
  description: string;
  severity: RubricSeverity;
  createdAt: string;
  updatedAt: string;
}

export type BehavioralEvaluationRunType =
  | "baseline"
  | "golden_trace"
  | "behavioral_rubric"
  | "provider_arena"
  | "pairwise";

export type BehavioralEvaluationRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type BehavioralJudgeStepStatus =
  | "pending"
  | "running"
  | "success"
  | "warning"
  | "error"
  | "skipped";

export interface BehavioralJudgeHardFailure {
  rule: string;
  severity: string;
  reason: string;
}

export interface BehavioralJudgeResult {
  overallScore: number;
  judgeOverallScore: number | null;
  computedScore: number;
  pass: boolean;
  confidence: number;
  confidenceLabel: "high" | "medium" | "low" | "insufficient";
  confidenceReasons: string[];
  dimensionScores: Record<string, number>;
  hardFailures: BehavioralJudgeHardFailure[];
  strengths: string[];
  weaknesses: string[];
  riskFlags: string[];
  verdictReason: string;
  needsReview: boolean;
  rawJudgeOutput?: Record<string, unknown> | null;
}

export interface BehavioralExecutionStep {
  name: string;
  label: string;
  status: BehavioralJudgeStepStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  summary: string;
  details?: Record<string, unknown> | null;
}

export interface BehavioralEvaluationCaseResult {
  evaluationExecutionId: string;
  datasetItemId: string;
  status: "completed" | "failed";
  input: string;
  context: string | null;
  output: string | null;
  provider: string;
  model: string;
  promptVersionId: string;
  latencyMs: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  error: string | null;
  expectedOutput: string | null;
  referenceOutput: string | null;
  renderedPrompt: string | null;
  judge: BehavioralJudgeResult | null;
  executionSteps: BehavioralExecutionStep[];
}

export interface BehavioralEvaluationRunView {
  id: string;
  workspaceId: string;
  runType: BehavioralEvaluationRunType;
  status: BehavioralEvaluationRunStatus;
  datasetId: string;
  datasetName: string | null;
  rubricId: string;
  rubricName: string | null;
  promptId: string;
  promptName: string | null;
  promptVersionId: string;
  promptVersionTag: string | null;
  provider: string;
  model: string;
  startedBy: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  aggregate: {
    total: number;
    completed: number;
    failed: number;
    passCount: number;
    failCount: number;
    needsReviewCount: number;
    averageScore: number | null;
    averageConfidence: number | null;
    hardFailureCount: number;
    finalScore: number | null;
    passed: boolean;
    dimensionAverages: Record<string, number>;
  };
  candidates?: Array<{
    id: string;
    provider: string;
    model: string;
    label: string;
    temperature: number | null;
    maxTokens: number | null;
    config: Record<string, unknown> | null;
  }>;
  arenaReport?: {
    id: string;
    recommendedCandidateId: string | null;
    rolloutRecommendation: "safe_to_rollout" | "rollout_with_caution" | "needs_review" | "do_not_rollout";
    decisionScore: number | null;
    riskScore: number | null;
    summary: string | null;
    providerRankings: Array<Record<string, unknown>>;
    dimensionSummary: Record<string, unknown>;
    failureClusters: Array<Record<string, unknown>>;
    costSummary: Record<string, unknown>;
    latencySummary: Record<string, unknown>;
  } | null;
  pairwise?: {
    total: number;
    byResult: Record<"a_wins" | "b_wins" | "tie" | "both_bad" | "needs_review", number>;
    matrix: Array<{
      rowCandidateId: string;
      colCandidateId: string;
      winRate: number | null;
      sampleSize: number;
    }>;
    comparisons: Array<{
      id: string;
      datasetItemId: string;
      candidateAExecutionId: string;
      candidateBExecutionId: string;
      winnerExecutionId: string | null;
      result: "a_wins" | "b_wins" | "tie" | "both_bad" | "needs_review";
      confidence: number | null;
      reasoning: string | null;
      dimensionPreferences: Record<string, "a" | "b" | "tie">;
      blindOrder: Record<string, unknown>;
      riskFlags: string[];
      needsReviewReason: string | null;
      createdAt: string;
    }>;
  } | null;
  reviewQueue?: {
    open: number;
    inReview: number;
    criticalOpen: number;
  } | null;
  results: BehavioralEvaluationCaseResult[];
}

export interface ProviderArenaCandidateInput {
  provider: string;
  model: string;
  label?: string;
  temperature?: number | null;
  maxTokens?: number | null;
  config?: Record<string, unknown>;
}

export interface HumanReviewItem {
  id: string;
  workspaceId: string;
  evaluationRunId: string;
  datasetItemId: string | null;
  evaluationExecutionId: string | null;
  pairwiseComparisonId: string | null;
  status: "open" | "in_review" | "resolved" | "dismissed";
  assignedTo: string | null;
  reason: string;
  severity: "low" | "medium" | "high" | "critical";
  reviewerDecision:
    | "acceptable"
    | "not_acceptable"
    | "provider_a_better"
    | "provider_b_better"
    | "both_acceptable"
    | "both_unacceptable"
    | "rubric_needs_update"
    | null;
  reviewerNotes: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface EvaluationComparisonReport {
  id: string;
  workspaceId: string;
  createdBy: string;
  runIds: string[];
  summary: string | null;
  scoreDelta: Record<string, unknown>;
  passRateDelta: Record<string, unknown>;
  failureDelta: Record<string, unknown>;
  dimensionDeltas: Record<string, unknown>;
  costDelta: Record<string, unknown>;
  latencyDelta: Record<string, unknown>;
  regressionCases: Array<Record<string, unknown>>;
  improvementCases: Array<Record<string, unknown>>;
  createdAt: string;
}

// ─── AI Capability / Reliability foundation types ─────────────────────────────

export type AiCapabilityType =
  | "prompt" | "skill" | "agent_workflow" | "rag_workflow" | "mcp_workflow"
  | "content_generation" | "classification" | "extraction"
  | "customer_support" | "internal_automation" | "custom";

export type BusinessDomain =
  | "customer_support" | "finance" | "claims" | "refunds" | "healthcare_triage"
  | "pharma_documentation" | "travel_booking" | "software_support"
  | "content_generation" | "internal_automation" | "sales" | "operations" | "general";

export type ReliabilityRiskLevel = "low" | "medium" | "high" | "critical";

export type DataSensitivity = "public" | "internal" | "confidential" | "restricted" | "regulated";

export type CapabilityStatus = "draft" | "active" | "blocked" | "under_review" | "archived";

export type CapabilityVersionStatus = "draft" | "candidate" | "approved" | "active" | "blocked" | "deprecated";

export type PolicyStatus =
  | "no_policy"
  | "assigned"
  | "satisfied"
  | "incomplete"
  | "violation";

export type EvidenceType =
  | "prompt_check" | "deterministic_check" | "behavioral_check"
  | "rag_grounding_check" | "mcp_tool_policy_check"
  | "workflow_regression" | "provider_comparison"
  | "human_approval" | "privacy_check" | "security_check";

export interface AiCapability {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  type: AiCapabilityType;
  businessDomain: BusinessDomain;
  riskLevel: ReliabilityRiskLevel;
  dataSensitivity: DataSensitivity;
  ownerUserId: string | null;
  status: CapabilityStatus;
  promptId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  // derived
  activeVersion?: CapabilityVersion | null;
  versionCount?: number;
  lastCheckStatus?: "passed" | "failed" | "needs_review" | "unknown" | null;
  lastCheckAt?: string | null;
  // governance derived
  policyStatus?: PolicyStatus;
  assignedPolicyPackIds?: string[];
}

export interface CapabilityVersion {
  id: string;
  workspaceId: string;
  capabilityId: string;
  versionNumber: string;
  name: string | null;
  status: CapabilityVersionStatus;
  config: Record<string, unknown>;
  promptVersionId: string | null;
  skillDefinition: Record<string, unknown> | null;
  workflowDefinition: Record<string, unknown> | null;
  providerConfig: Record<string, unknown> | null;
  toolPolicyId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  deprecatedAt: string | null;
}

export interface RequiredEvidence {
  id: string;
  workspaceId: string;
  aiSystemId: string;
  policyPackId: string | null;
  policyPackName?: string | null;
  evidenceType: EvidenceType;
  label: string;
  description: string | null;
  required: boolean;
  blocking: boolean;
  threshold: number | null;
  createdAt: string;
}

export interface PolicyAssignment {
  id: string;
  workspaceId: string;
  aiSystemId: string;
  policyPackId: string;
  policyPackName: string;
  policyPackSector: string;
  status: "active" | "disabled";
  appliedBy: string | null;
  appliedAt: string;
}

// ─── Evidence Runs ────────────────────────────────────────────────────────────

export type EvidenceRunStatus =
  | "queued" | "running" | "passed" | "failed"
  | "needs_review" | "cancelled" | "timed_out";

export type ReleaseGateStatus =
  | "safe_to_release" | "needs_review" | "blocked" | "missing_evidence";

export interface CapabilityEvidenceRun {
  id: string;
  workspaceId: string;
  aiSystemId: string;
  aiSystemVersionId: string | null;
  evidenceType: EvidenceType;
  status: EvidenceRunStatus;
  blocking: boolean;
  policyPackId: string | null;
  underlyingRunId: string | null;
  underlyingRunType: string | null;
  resultScore: number | null;
  resultSummary: string | null;
  failureReason: string | null;
  resultMetadata: Record<string, unknown>;
  startedBy: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // enriched
  aiSystemName?: string | null;
  aiSystemVersionNumber?: string | null;
  policyPackName?: string | null;
}

export interface ReleaseGateCheck {
  label: string;
  evidenceType: EvidenceType | "incident_check" | "policy_check";
  status: "pass" | "fail" | "missing" | "pending";
  blocking: boolean;
  detail: string | null;
  evidenceRunId: string | null;
  approvalRequestId: string | null;
}

export interface ReleaseGateResult {
  versionId: string;
  aiSystemId: string;
  decision: ReleaseGateStatus;
  reasons: string[];
  checks: ReleaseGateCheck[];
  evaluatedAt: string;
}

// ─── Workflow step (unchanged position) ───────────────────────────────────────

export type WorkflowStepType =
  | "llm_call" | "tool_call" | "mcp_tool_call" | "rag_retrieval"
  | "reranker" | "decision" | "human_handoff" | "final_response" | "system_event";

export interface WorkflowStepTrace {
  id: string;
  workspaceId: string;
  workflowTraceId: string;
  stepIndex: number;
  stepType: WorkflowStepType;
  stepName: string;
  provider: string | null;
  model: string | null;
  toolName: string | null;
  mcpServerName: string | null;
  inputPayload: Record<string, unknown>;
  outputPayload: Record<string, unknown>;
  toolArguments: Record<string, unknown>;
  toolResult: Record<string, unknown>;
  status: "running" | "completed" | "failed" | "skipped";
  latencyMs: number | null;
  costEstimate: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface WorkflowTrace {
  id: string;
  workspaceId: string;
  capabilityId: string | null;
  capabilityVersionId: string | null;
  promptId: string | null;
  promptVersionId: string | null;
  agentRunId: string | null;
  traceId: string | null;
  provider: string | null;
  model: string | null;
  userInput: string | null;
  finalResponse: string | null;
  finalAction: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  outcomeStatus?: "success" | "failed" | "human_handoff" | "blocked" | "cancelled" | "timeout" | "partial_success" | null;
  outcomeReason?: string | null;
  finalBusinessOutcome?: string | null;
  totalLatencyMs: number | null;
  totalCostEstimate: number | null;
  modelCost?: number | null;
  toolCost?: number | null;
  judgeCost?: number | null;
  retryCost?: number | null;
  totalTokensInput: number | null;
  totalTokensOutput: number | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  steps?: WorkflowStepTrace[];
  // derived
  capabilityName?: string | null;
}

export type DiscoverySource = "sdk" | "sidecar" | "opentelemetry" | "direct_api" | "proxy";
export type DiscoveryStatus = "detecting" | "ready_for_review" | "confirmed" | "ignored";
export type DiscoveryRecordStatus = "new" | "matched" | "confirmed" | "ignored" | "merged";

export interface WorkflowGraphNode {
  id: string;
  parentId: string | null;
  type: "start" | "end" | "agent" | "planner" | "llm_call" | "tool_call" | "mcp_tool_call" | "rag_retrieval" | "reranker" | "decision" | "human_handoff" | "final_response" | "error";
  name: string;
  status: "running" | "completed" | "failed" | "skipped";
  latencyMs: number | null;
  costEstimate: number | null;
  provider: string | null;
  model: string | null;
  toolName: string | null;
  mcpServerName: string | null;
  error: string | null;
  inputPreview: string | null;
  outputPreview: string | null;
  metadata?: Record<string, unknown>;
}

export interface WorkflowGraphEdge {
  id: string;
  from: string;
  to: string;
  reason: "parent_span" | "step_order" | "timestamp_order";
  label?: string | null;
  condition?: Record<string, unknown> | null;
}

export interface SuggestedDeterministicRule {
  id: string;
  ruleType: "tool_sequence" | "tool_required" | "max_tool_calls" | "cost_threshold" | "latency_threshold";
  summary: string;
  whySuggested: string;
  observedTraceCount: number;
  severitySuggestion: "low" | "medium" | "high" | "critical";
  config: Record<string, unknown>;
}

export interface DiscoverySession {
  id: string;
  workspaceId: string;
  status: DiscoveryStatus;
  source: DiscoverySource;
  environment: string | null;
  startedBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveredCapability {
  id: string;
  workspaceId: string;
  sessionId: string;
  suggestedName: string;
  suggestedType: AiCapabilityType;
  serviceName: string | null;
  environment: string | null;
  confidence: number;
  matchedCapabilityId: string | null;
  status: DiscoveryRecordStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveredTool {
  id: string;
  workspaceId: string;
  sessionId: string;
  toolName: string;
  mcpServerName: string | null;
  argumentSchema: Record<string, unknown>;
  resultSchema: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  seenCount: number;
  status: DiscoveryRecordStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ToolRegistryEntry {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  mcpServerName: string | null;
  argumentSchema: Record<string, unknown>;
  resultSchema: Record<string, unknown>;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  createdFromDiscoveryId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveredWorkflow {
  id: string;
  workspaceId: string;
  sessionId: string;
  name: string;
  capabilityName: string | null;
  traceId: string | null;
  workflowShapeHash: string;
  graphNodes: WorkflowGraphNode[];
  graphEdges: WorkflowGraphEdge[];
  suggestedRules: SuggestedDeterministicRule[];
  latencyMs: number | null;
  costEstimate: number | null;
  status: DiscoveryRecordStatus;
  sourceBadge: DiscoverySource;
  createdAt: string;
  updatedAt: string;
}

export interface DiscoveryModelSummary {
  provider: string | null;
  model: string | null;
  seenCount: number;
  averageLatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number | null;
}

export interface DiscoveryMcpServerSummary {
  serverName: string;
  toolsDetected: string[];
  seenCount: number;
  lastSeenAt: string | null;
}

export interface DiscoveryWorkflowOutputSummary {
  finalAction: string | null;
  outcomeStatus: string | null;
  outcomeReason: string | null;
  finalResponsePreview: string | null;
  outputCaptureDisabled: boolean;
}

export interface DiscoveryReview {
  session: DiscoverySession;
  capabilities: DiscoveredCapability[];
  tools: DiscoveredTool[];
  workflows: DiscoveredWorkflow[];
  toolRegistry: ToolRegistryEntry[];
  existingCapabilities: AiCapability[];
  models: DiscoveryModelSummary[];
  mcpServers: DiscoveryMcpServerSummary[];
  workflowOutput: DiscoveryWorkflowOutputSummary | null;
}

export type ReliabilityRuleType =
  | "tool_sequence" | "tool_required" | "tool_forbidden"
  | "argument_validation" | "schema_validation" | "regex_check"
  | "cost_threshold" | "latency_threshold" | "max_tool_calls"
  | "pii_detection" | "business_policy" | "human_handoff_required"
  | "output_contains" | "output_not_contains" | "business_outcome"
  | "tool_result_condition" | "final_action_condition";

export interface ReliabilityRule {
  id: string;
  workspaceId: string;
  capabilityId: string | null;
  capabilityVersionId: string | null;
  name: string;
  description: string | null;
  ruleType: ReliabilityRuleType;
  severity: ReliabilityRiskLevel;
  enabled: boolean;
  config: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // derived
  plainEnglish?: string;
}

export type RuleResultStatus = "passed" | "failed" | "skipped" | "error";

export interface ReliabilityRuleResult {
  id: string;
  workspaceId: string;
  ruleId: string;
  workflowTraceId: string | null;
  evaluationRunId: string | null;
  status: RuleResultStatus;
  passed: boolean;
  severity: ReliabilityRiskLevel;
  message: string;
  details: Record<string, unknown>;
  createdAt: string;
  // derived
  rule?: ReliabilityRule;
}

export interface ReliabilityCheckReport {
  runId: string;
  capabilityId: string | null;
  workflowTraceId: string | null;
  overallStatus: "passed" | "failed" | "needs_review" | "error";
  passedCount: number;
  failedCount: number;
  skippedCount: number;
  criticalFailures: ReliabilityRuleResult[];
  highFailures: ReliabilityRuleResult[];
  allResults: ReliabilityRuleResult[];
  createdAt: string;
}

export type RegressionSuiteType =
  | "deterministic_workflow"
  | "tool_trajectory"
  | "business_outcome"
  | "mixed";

export interface RegressionSuite {
  id: string;
  workspaceId: string;
  capabilityId: string;
  name: string;
  description: string | null;
  suiteType: RegressionSuiteType;
  enabled: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  caseCount?: number;
  latestRun?: WorkflowRegressionRun | null;
}

export interface RegressionCase {
  id: string;
  workspaceId: string;
  suiteId: string;
  name: string;
  description: string | null;
  inputPayload: Record<string, unknown>;
  expectedToolSequence: string[];
  forbiddenTools: string[];
  requiredTools: string[];
  expectedOutcome: string | null;
  expectedFinalAction: string | null;
  rules: Record<string, unknown>;
  tags: string[];
  riskLevel: ReliabilityRiskLevel;
  sourceTraceId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowRegressionRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface WorkflowRegressionCaseResult {
  id: string;
  workspaceId: string;
  regressionRunId: string;
  regressionCaseId: string;
  workflowTraceId: string | null;
  status: "completed" | "failed" | "skipped" | "error";
  passed: boolean;
  score: number | null;
  failureReasons: string[];
  toolSequenceResult: Record<string, unknown>;
  requiredToolsResult: Record<string, unknown>;
  forbiddenToolsResult: Record<string, unknown>;
  outcomeResult: Record<string, unknown>;
  costResult: Record<string, unknown>;
  latencyResult: Record<string, unknown>;
  createdAt: string;
  regressionCase?: RegressionCase;
  workflowTrace?: WorkflowTrace | null;
  trajectoryDiffId?: string | null;
}

export interface WorkflowRegressionRun {
  id: string;
  workspaceId: string;
  suiteId: string;
  capabilityId: string;
  capabilityVersionId: string;
  status: WorkflowRegressionRunStatus;
  triggerSource: "manual" | "candidate_promotion" | "api" | "scheduled";
  startedBy: string;
  startedAt: string | null;
  completedAt: string | null;
  summary: Record<string, unknown>;
  overallScore: number | null;
  passedCasesCount: number;
  failedCasesCount: number;
  criticalFailuresCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRegressionRunView extends WorkflowRegressionRun {
  suite: RegressionSuite | null;
  capability: AiCapability | null;
  capabilityVersion: CapabilityVersion | null;
  cases: WorkflowRegressionCaseResult[];
  skillCorrectnessScore: CapabilityReliabilityScore | null;
  safetyGate: {
    decision: "safe_to_rollout" | "needs_review" | "blocked";
    reasons: string[];
  };
}

export interface TrajectoryDiffResult {
  id: string;
  workspaceId: string;
  leftTraceId: string;
  rightTraceId: string;
  summary: Record<string, unknown>;
  toolSequenceDiff: Record<string, unknown>;
  argumentDiff: Record<string, unknown>;
  costDiff: Record<string, unknown>;
  latencyDiff: Record<string, unknown>;
  riskFlags: string[];
  createdAt: string;
}

export interface CapabilityReliabilityScore {
  id: string;
  workspaceId: string;
  capabilityId: string;
  capabilityVersionId: string;
  score: number;
  workflowSuccessRate: number | null;
  toolPathCompliance: number | null;
  outcomeSuccessRate: number | null;
  argumentValidity: number | null;
  costCompliance: number | null;
  latencyCompliance: number | null;
  safetyCompliance: number | null;
  sourceRunId: string | null;
  createdAt: string;
}

export interface ProviderPricingConfig {
  id: string;
  workspaceId: string | null;
  provider: string;
  model: string;
  inputTokenPricePerMillion: number;
  outputTokenPricePerMillion: number;
  currency: string;
  effectiveFrom: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationROISettings {
  workspaceId: string;
  averageManualResolutionMinutes: number;
  averageAgentOperatorHourlyCost: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModelRoutingRecommendation {
  id: string;
  workspaceId: string;
  capabilityId: string | null;
  recommendationType:
    | "use_cheaper_model_for_low_risk"
    | "escalate_high_risk_to_stronger_model"
    | "reduce_retries"
    | "add_tool_validation"
    | "add_deterministic_rule"
    | "change_provider"
    | "add_human_handoff_earlier";
  summary: string;
  evidence: Record<string, unknown>;
  estimatedSavings: number | null;
  confidence: number | null;
  status: "active" | "accepted" | "dismissed" | "archived";
  createdAt: string;
  capabilityName?: string | null;
}

export interface RoiProviderComparison {
  provider: string;
  model: string;
  runs: number;
  successRate: number;
  humanHandoffRate: number;
  failureRate: number;
  averageWorkflowCost: number;
  costPerSuccessfulWorkflow: number | null;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  estimatedNetSavings: number;
  recommendation: string | null;
}

export interface RoiFailureCostAttribution {
  outcomeReason: string;
  capabilityId: string | null;
  capabilityName: string | null;
  runs: number;
  totalCost: number;
  averageCostPerFailedRun: number;
  recommendedFix: string;
}

export interface CapabilityCostAnalytics {
  capabilityId: string;
  capabilityName: string | null;
  totalRuns: number;
  successRate: number;
  humanHandoffRate: number;
  averageCostPerRun: number;
  costPerSuccessfulRun: number | null;
  costPerFailedRun: number | null;
  totalFailureCost: number;
  totalRetryCost: number;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  costTrend: Array<{ date: string; totalCost: number; runs: number; successRate: number }>;
  costByProvider: Array<{ provider: string; model: string; runs: number; totalCost: number; averageCost: number; successRate: number }>;
  stepCostBreakdown: Array<{ stepName: string; stepType: string; totalCost: number; averageCost: number; runs: number }>;
  mostExpensiveTool: { toolName: string; totalCost: number; averageCost: number } | null;
  tokenUsageTrend: Array<{ date: string; inputTokens: number; outputTokens: number }>;
}

export interface RoiDashboardData {
  workspaceId: string;
  timeRange: { from: string | null; to: string | null };
  filters: {
    capabilityId?: string | null;
    capabilityType?: string | null;
    businessDomain?: string | null;
    provider?: string | null;
    model?: string | null;
    environment?: string | null;
  };
  assumptions: AutomationROISettings;
  metrics: {
    totalRuns: number;
    successfulAutomations: number;
    automationSuccessRate: number;
    humanHandoffs: number;
    humanHandoffRate: number;
    failedWorkflows: number;
    failureRate: number;
    averageCostPerRun: number;
    costPerSuccessfulWorkflow: number | null;
    costPerFailedWorkflow: number | null;
    averageLatencyMs: number | null;
    p95LatencyMs: number | null;
    manualHoursSaved: number;
    estimatedLaborSavings: number;
    netSavings: number;
  };
  trends: Array<{
    date: string;
    totalRuns: number;
    successRate: number;
    averageCostPerRun: number;
    costPerSuccessfulWorkflow: number | null;
  }>;
  topCostLeaks: RoiFailureCostAttribution[];
  topCapabilities: Array<{
    capabilityId: string | null;
    capabilityName: string | null;
    runs: number;
    totalCost: number;
    failureCost: number;
    successRate: number;
    humanHandoffRate: number;
  }>;
  providerComparison: RoiProviderComparison[];
  recommendations: ModelRoutingRecommendation[];
}

export interface RoiReport {
  id: string;
  workspaceId: string;
  createdBy: string;
  filters: Record<string, unknown>;
  summary: RoiDashboardData;
  createdAt: string;
}

export type IncidentSeverity = "low" | "medium" | "high" | "critical";
export type IncidentStatus = "open" | "investigating" | "fix_in_progress" | "verification_pending" | "resolved" | "dismissed";
export type IncidentSourceType = "alert" | "trace" | "workflow_regression" | "safety_gate" | "manual" | "notification";
export type FailureClusterType =
  | "policy_violation"
  | "wrong_tool_selected"
  | "required_tool_skipped"
  | "invalid_arguments"
  | "unsafe_action"
  | "hallucinated_response"
  | "missing_context"
  | "wrong_context"
  | "format_violation"
  | "provider_timeout"
  | "agent_loop"
  | "high_cost"
  | "high_latency"
  | "human_handoff_spike"
  | "unknown";

export interface GovernanceFailureCluster {
  id: string;
  workspaceId: string;
  capabilityId: string | null;
  name: string;
  description: string | null;
  clusterType: FailureClusterType;
  severity: IncidentSeverity;
  groupingKey: string;
  affectedRunsCount: number;
  affectedTracesCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  status: "open" | "monitoring" | "resolved" | "dismissed";
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceFailureClusterItem {
  id: string;
  workspaceId: string;
  clusterId: string;
  sourceType: "trace" | "workflow_regression_case" | "reliability_rule_result" | "evaluation_run" | "alert_event";
  sourceId: string;
  summary: string | null;
  createdAt: string;
}

export interface IncidentActivity {
  id: string;
  workspaceId: string;
  incidentId: string;
  actorUserId: string | null;
  activityType: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface IncidentVerification {
  id: string;
  workspaceId: string;
  incidentId: string;
  regressionRunId: string;
  capabilityVersionId: string | null;
  status: "passed" | "failed" | "needs_review";
  summary: string | null;
  createdAt: string;
}

export interface AiIncident {
  id: string;
  workspaceId: string;
  capabilityId: string | null;
  capabilityVersionId: string | null;
  title: string;
  description: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  sourceType: IncidentSourceType;
  sourceId: string | null;
  failureClusterId: string | null;
  ownerUserId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  capabilityName?: string | null;
  capabilityVersionName?: string | null;
}

export interface IncidentDetailView extends AiIncident {
  failureCluster: GovernanceFailureCluster | null;
  activities: IncidentActivity[];
  verifications: IncidentVerification[];
  relatedTrace: WorkflowTrace | null;
  relatedRegressionRun: WorkflowRegressionRunView | null;
}

export interface AuditEvent {
  id: string;
  workspaceId: string;
  actorUserId: string | null;
  eventType: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export type ApprovalRequestType = "rollout_approval" | "incident_resolution" | "policy_override" | "high_risk_action";
export type ApprovalRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface ApprovalRequest {
  id: string;
  workspaceId: string;
  capabilityId: string | null;
  capabilityVersionId: string | null;
  requestType: ApprovalRequestType;
  status: ApprovalRequestStatus;
  requestedBy: string;
  requiredApprovals: number;
  approvedCount: number;
  rejectedCount: number;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface ApprovalDecision {
  id: string;
  workspaceId: string;
  approvalRequestId: string;
  reviewerUserId: string;
  decision: "approved" | "rejected";
  comment: string | null;
  createdAt: string;
}

export interface PolicyPack {
  id: string;
  workspaceId: string | null;
  name: string;
  description: string | null;
  sector: "retail" | "bfsi" | "healthcare" | "pharma" | "software" | "software_support" | "travel" | "insurance" | "general";
  version: string;
  rules: Array<Record<string, unknown>>;
  requiredEvidence: Array<{
    evidenceType: EvidenceType;
    label: string;
    required: boolean;
    blocking: boolean;
  }>;
  approvalRequirements: {
    requiresApproval?: boolean;
    approvalThreshold?: string;
    approvers?: string[];
  };
  enabled: boolean;
  systemPack?: boolean;
  createdAt: string;
  appliedToCapabilityIds?: string[];
}

export interface RedactionRule {
  id: string;
  workspaceId: string;
  name: string;
  ruleType: "regex" | "field_name" | "built_in";
  pattern: string;
  replacement: string;
  enabled: boolean;
  scope: "traces" | "tool_arguments" | "tool_results" | "final_response" | "all";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PrivacySettings {
  workspaceId: string;
  enablePiiRedaction: boolean;
  storeRawInputs: boolean;
  storeRawOutputs: boolean;
  storeToolArguments: boolean;
  storeToolResults: boolean;
  retentionDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface GovernanceDashboardData {
  openIncidents: AiIncident[];
  pendingApprovals: ApprovalRequest[];
  recentBlockedRollouts: AuditEvent[];
  policyPacks: PolicyPack[];
  auditActivity: AuditEvent[];
  privacySettings: PrivacySettings | null;
  highRiskCapabilities: AiCapability[];
  criticalClusters: GovernanceFailureCluster[];
}
