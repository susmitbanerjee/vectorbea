export const TRACE_METADATA_SCHEMA_VERSION = "1.0" as const;

export type TraceStatusV1 = "success" | "warning" | "error" | "partial";
export type CacheStatusV1 = "hit" | "miss" | "skipped" | "stale";
export type GuardrailActionV1 = "allow" | "redact" | "block" | "warn";
export type TraceUseType = "runtime" | "audit";
export type ExecutorTypeV1 = "direct_provider" | "enterprise_gateway" | "observe_only";
export type ExecutorOwnershipV1 = "vectorbea" | "customer";
export type ExecutorRequestModeV1 = "direct" | "forwarded" | "wrapped";
export type ExecutorObservabilityV1 = "full" | "partial" | "minimal";

export type SpanTypeV1 =
  | "root"
  | "request"
  | "sidecar"
  | "prompt_resolve"
  | "template_render"
  | "retrieval"
  | "rerank"
  | "cache"
  | "model_select"
  | "llm"
  | "guardrail"
  | "parser"
  | "fallback"
  | "audit"
  | "evaluation";

export interface TraceMetadataV1 {
  schema_version: typeof TRACE_METADATA_SCHEMA_VERSION;
  trace?: {
    status?: TraceStatusV1;
    started_at?: string;
    ended_at?: string;
    duration_ms?: number;
    environment?: string;
    workspace_id?: string;
    request_id?: string;
    conversation_id?: string;
    session_id?: string;
    user_id?: string;
    kind?: "runtime_execution" | "admin_audit" | string;
  };
  executor?: {
    type?: ExecutorTypeV1;
    name?: string;
    ownership?: ExecutorOwnershipV1;
    request_mode?: ExecutorRequestModeV1;
    endpoint?: string | null;
    response_observability?: ExecutorObservabilityV1;
  };
  request?: {
    source?: string;
    method?: string;
    path?: string;
    client?: Record<string, unknown>;
    input?: {
      text?: string;
      variables?: Record<string, unknown>;
    };
  };
  prompt?: {
    prompt_id?: string;
    prompt_version_id?: string;
    name?: string;
    version_tag?: string;
    published?: boolean;
    rollout_percentage?: number;
    release_tag?: string;
    template_hash?: string;
    resolved?: {
      system?: string;
      developer?: string;
      user?: string;
    };
    variables?: Record<string, unknown>;
  };
  model?: {
    provider?: string;
    model?: string;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    latency_ms?: number;
    cost?: {
      currency?: string;
      input_cost?: number;
      output_cost?: number;
      total_cost?: number;
    };
  };
  retrieval?: {
    enabled?: boolean;
    query?: string;
    reranked?: boolean;
    rerank_model?: string;
    latency_ms?: number;
    sources?: Array<{
      source_id?: string;
      source_type?: string;
      title?: string;
      score?: number;
      token_count?: number;
      snippet?: string;
    }>;
  };
  cache?: {
    enabled?: boolean;
    status?: CacheStatusV1;
    cache_key?: string;
    latency_ms?: number;
  };
  guardrail?: {
    triggered?: boolean;
    action?: GuardrailActionV1;
    checks?: Array<{
      name?: string;
      status?: string;
      reason?: string;
      score?: number;
    }>;
  };
  fallback?: {
    triggered?: boolean;
    reason?: string | null;
    from_model?: string | null;
    to_model?: string | null;
    attempt?: number;
  };
  output?: {
    raw_text?: string;
    final_text?: string;
    structured?: unknown;
    finish_reason?: string;
  };
  evaluation?: {
    score?: number;
    label?: string;
    run_id?: string;
    dataset_id?: string;
    compared_against_trace_id?: string;
    evaluation_mode?: "replay_compare" | "single_trace" | "batch_replay" | string;
    checks?: Array<{
      name?: string;
      score?: number;
      label?: string;
      reason?: string;
    }>;
  };
  logs?: Array<{
    timestamp?: string;
    level?: string;
    component?: string;
    message?: string;
    span_id?: string;
  }>;
  spans?: Array<{
    span_id: string;
    parent_span_id?: string | null;
    name: string;
    type: SpanTypeV1;
    component?: string;
    status?: TraceStatusV1;
    start_offset_ms: number;
    duration_ms: number;
    metadata?: Record<string, unknown>;
  }>;
  tags?: Record<string, string>;
  custom?: Record<string, unknown>;
}

const SECTION_KEYS = new Set([
  "schema_version",
  "trace",
  "executor",
  "request",
  "prompt",
  "model",
  "retrieval",
  "cache",
  "guardrail",
  "fallback",
  "output",
  "evaluation",
  "logs",
  "spans",
  "tags",
  "custom",
]);

type BuildMetadataInput = {
  metadata?: Record<string, unknown> | null;
  useType?: TraceUseType;
  workspaceId?: string | null;
  promptVersionId?: string | null;
  promptName?: string | null;
  versionTag?: string | null;
  proxyLatencyMs?: number | null;
  llmLatencyMs?: number | null;
  tokenCount?: number | null;
  createdAt?: string;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toStringRecord(input: unknown): Record<string, string> {
  const source = asRecord(input);
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    const normalized = asString(value);
    if (normalized) output[key] = normalized;
  }
  return output;
}

export function normalizeTraceMetadataV1(input: unknown): TraceMetadataV1 {
  const root = asRecord(input);
  const schemaVersion = asString(root.schema_version) ?? TRACE_METADATA_SCHEMA_VERSION;

  const custom = {
    ...asRecord(root.custom),
  };

  for (const [key, value] of Object.entries(root)) {
    if (!SECTION_KEYS.has(key)) {
      custom[key] = value;
    }
  }

  const normalized: TraceMetadataV1 = {
    schema_version:
      schemaVersion === TRACE_METADATA_SCHEMA_VERSION
        ? TRACE_METADATA_SCHEMA_VERSION
        : TRACE_METADATA_SCHEMA_VERSION,
  };

  const trace = asRecord(root.trace);
  if (Object.keys(trace).length > 0) normalized.trace = trace as TraceMetadataV1["trace"];
  const executor = asRecord(root.executor);
  if (Object.keys(executor).length > 0) normalized.executor = executor as TraceMetadataV1["executor"];
  const request = asRecord(root.request);
  if (Object.keys(request).length > 0) normalized.request = request as TraceMetadataV1["request"];
  const prompt = asRecord(root.prompt);
  if (Object.keys(prompt).length > 0) normalized.prompt = prompt as TraceMetadataV1["prompt"];
  const model = asRecord(root.model);
  if (Object.keys(model).length > 0) normalized.model = model as TraceMetadataV1["model"];
  const retrieval = asRecord(root.retrieval);
  if (Object.keys(retrieval).length > 0) normalized.retrieval = retrieval as TraceMetadataV1["retrieval"];
  const cache = asRecord(root.cache);
  if (Object.keys(cache).length > 0) normalized.cache = cache as TraceMetadataV1["cache"];
  const guardrail = asRecord(root.guardrail);
  if (Object.keys(guardrail).length > 0) normalized.guardrail = guardrail as TraceMetadataV1["guardrail"];
  const fallback = asRecord(root.fallback);
  if (Object.keys(fallback).length > 0) normalized.fallback = fallback as TraceMetadataV1["fallback"];
  const output = asRecord(root.output);
  if (Object.keys(output).length > 0) normalized.output = output as TraceMetadataV1["output"];
  const evaluation = asRecord(root.evaluation);
  if (Object.keys(evaluation).length > 0) normalized.evaluation = evaluation as TraceMetadataV1["evaluation"];

  if (Array.isArray(root.logs)) normalized.logs = root.logs as TraceMetadataV1["logs"];
  if (Array.isArray(root.spans)) normalized.spans = root.spans as TraceMetadataV1["spans"];

  const tags = toStringRecord(root.tags);
  if (Object.keys(tags).length > 0) normalized.tags = tags;
  if (Object.keys(custom).length > 0) normalized.custom = custom;

  return normalized;
}

export function buildTraceMetadataV1(input: BuildMetadataInput): TraceMetadataV1 {
  const root = normalizeTraceMetadataV1(input.metadata);
  const legacy = asRecord(input.metadata);
  const now = input.createdAt ?? new Date().toISOString();

  const proxyLatencyMs = Math.max(asNumber(input.proxyLatencyMs) ?? 0, 0);
  const llmLatencyMs = Math.max(asNumber(input.llmLatencyMs) ?? 0, 0);
  const tokenCount = Math.max(asNumber(input.tokenCount) ?? 0, 0);
  const durationMs = Math.max(
    asNumber(root.trace?.duration_ms) ?? 0,
    proxyLatencyMs + llmLatencyMs,
    proxyLatencyMs,
    llmLatencyMs,
  );

  const promptName = asString(input.promptName) ?? asString(root.prompt?.name) ?? asString(legacy.prompt_name) ?? asString(legacy.promptName);
  const versionTag = asString(input.versionTag) ?? asString(root.prompt?.version_tag) ?? asString(legacy.version_tag) ?? asString(legacy.versionTag);
  const promptVersionId = asString(input.promptVersionId) ?? asString(root.prompt?.prompt_version_id) ?? asString(legacy.promptVersionId) ?? asString(legacy.prompt_version_id);

  const cacheStatus =
    asString(root.cache?.status) ??
    asString(legacy.cacheStatus) ??
    (typeof legacy.cacheHit === "boolean" ? (legacy.cacheHit ? "hit" : "miss") : undefined);

  const modelRecord = asRecord(legacy.model);
  const provider = asString(root.model?.provider) ?? asString(modelRecord.provider) ?? asString(legacy.provider);
  const model = asString(root.model?.model) ?? asString(modelRecord.name ?? modelRecord.model) ?? asString(legacy.model);
  const executorRecord = asRecord(root.executor);
  const executorType =
    asString(executorRecord.type) ??
    asString(legacy.executorType) ??
    (provider ? "direct_provider" : undefined);

  const envelope: TraceMetadataV1 = {
    schema_version: TRACE_METADATA_SCHEMA_VERSION,
    trace: {
      ...(root.trace ?? {}),
      started_at: root.trace?.started_at ?? asString(legacy.started_at) ?? now,
      ended_at: root.trace?.ended_at ?? asString(legacy.ended_at),
      duration_ms: durationMs > 0 ? durationMs : undefined,
      environment:
        root.trace?.environment ??
        asString(legacy.environment) ??
        asString(legacy.env),
      workspace_id:
        root.trace?.workspace_id ??
        asString(input.workspaceId) ??
        asString(legacy.workspace_id) ??
        asString(legacy.workspaceId),
      request_id: root.trace?.request_id ?? asString(legacy.request_id) ?? asString(legacy.requestId),
      conversation_id:
        root.trace?.conversation_id ??
        asString(legacy.conversation_id) ??
        asString(legacy.conversationId),
      session_id: root.trace?.session_id ?? asString(legacy.session_id) ?? asString(legacy.sessionId),
      user_id: root.trace?.user_id ?? asString(legacy.user_id) ?? asString(legacy.userId),
      status:
        root.trace?.status ??
        ((asString(legacy.traceStatus) || asString(legacy.status)) as TraceStatusV1 | undefined),
      kind:
        root.trace?.kind ??
        (input.useType === "runtime" ? "runtime_execution" : input.useType === "audit" ? "admin_audit" : undefined),
    },
    executor: {
      ...(root.executor ?? {}),
      type: executorType as ExecutorTypeV1 | undefined,
      name:
        root.executor?.name ??
        asString(legacy.executorName) ??
        provider ??
        model,
      ownership:
        root.executor?.ownership ??
        ((executorType === "enterprise_gateway" ? "customer" : "vectorbea") as ExecutorOwnershipV1 | undefined),
      request_mode:
        root.executor?.request_mode ??
        ((executorType === "enterprise_gateway" ? "forwarded" : executorType ? "direct" : undefined) as ExecutorRequestModeV1 | undefined),
      endpoint:
        root.executor?.endpoint ??
        asString(legacy.executorEndpoint) ??
        null,
      response_observability:
        root.executor?.response_observability ??
        ((executorType === "enterprise_gateway" ? "partial" : executorType ? "full" : undefined) as ExecutorObservabilityV1 | undefined),
    },
    request: root.request
      ? {
          ...root.request,
        }
      : undefined,
    prompt: {
      ...(root.prompt ?? {}),
      prompt_version_id: promptVersionId,
      name: promptName,
      version_tag: versionTag,
      variables: root.prompt?.variables ?? asRecord(legacy.variables),
      release_tag:
        root.prompt?.release_tag ??
        asString(legacy.release_tag) ??
        asString(legacy.releaseTag),
      rollout_percentage:
        root.prompt?.rollout_percentage ??
        asNumber(legacy.rollout_percentage) ??
        asNumber(legacy.rolloutPercent),
    },
    model: {
      ...(root.model ?? {}),
      provider,
      model,
      latency_ms: root.model?.latency_ms ?? (llmLatencyMs > 0 ? llmLatencyMs : undefined),
      output_tokens:
        root.model?.output_tokens ??
        asNumber(legacy.tokens_out) ??
        tokenCount,
      total_tokens:
        root.model?.total_tokens ??
        asNumber(legacy.total_tokens) ??
        tokenCount,
    },
    retrieval: root.retrieval ? { ...root.retrieval } : undefined,
    cache: {
      ...(root.cache ?? {}),
      status: (cacheStatus as CacheStatusV1 | undefined) ?? root.cache?.status,
      cache_key:
        root.cache?.cache_key ??
        asString(legacy.cache_key) ??
        asString(legacy.cacheKey),
    },
    guardrail: root.guardrail ? { ...root.guardrail } : undefined,
    fallback: root.fallback
      ? { ...root.fallback }
      : (typeof legacy.fallbackUsed === "boolean"
          ? { triggered: legacy.fallbackUsed }
          : undefined),
    output: {
      ...(root.output ?? {}),
      raw_text: root.output?.raw_text ?? asString(legacy.rawOutput),
      final_text:
        root.output?.final_text ??
        asString(legacy.finalOutput) ??
        asString(legacy.output),
    },
    evaluation: root.evaluation ? { ...root.evaluation } : undefined,
    logs: Array.isArray(root.logs) ? root.logs : [],
    spans: Array.isArray(root.spans) ? root.spans : [],
    tags: {
      ...(root.tags ?? {}),
      ...(input.useType ? { use_type: input.useType } : {}),
      ...(input.useType === "runtime" ? { trace_kind: "runtime_execution" } : {}),
    },
    custom: {
      ...(root.custom ?? {}),
    },
  };

  if (!envelope.trace?.status) {
    envelope.trace = {
      ...envelope.trace,
      status:
        envelope.fallback?.triggered || envelope.guardrail?.triggered
          ? "warning"
          : "success",
    };
  }

  return envelope;
}
