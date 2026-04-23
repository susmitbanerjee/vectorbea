import "server-only";

import type {
  TraceDetailView,
  TraceEvaluationCheckView,
  TraceEvaluationLabel,
  TraceEvaluationView,
  TraceLogView,
  TraceSpanView,
  TraceStatus,
  TraceSummaryView,
} from "@/lib/api";
import { normalizeTraceMetadataV1 } from "@/lib/trace-metadata";

export type AuditLogTraceRow = {
  id: string;
  workspace_id: string;
  prompt_version_id: string | null;
  prompt_name: string | null;
  version_tag: string | null;
  proxy_latency_ms: number | null;
  llm_latency_ms: number | null;
  token_count: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type ParsedAuditMetadata = {
  spans: TraceSpanView[];
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  logs: TraceLogView[];
  model: Record<string, unknown>;
  cache: Record<string, unknown>;
  guardrail: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

function toStringRecord(value: unknown): Record<string, string> {
  const source = asRecord(value);
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (raw === null || raw === undefined) continue;
    out[key] = typeof raw === "string" ? raw : JSON.stringify(raw);
  }
  return out;
}

function toScalarRecord(value: unknown): Record<string, string | number | boolean> {
  const source = asRecord(value);
  const out: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      out[key] = raw;
    }
  }
  return out;
}

function toStatus(metadata: unknown): TraceStatus {
  const normalized = normalizeTraceMetadataV1(metadata);
  const legacy = asRecord(normalized.custom);
  const explicit = asString(normalized.trace?.status ?? legacy.traceStatus ?? legacy.status).toLowerCase();
  if (explicit === "success" || explicit === "warning" || explicit === "error" || explicit === "partial") {
    return explicit;
  }
  if (legacy.error || legacy.exception || legacy.failed || legacy.timeout) return "error";
  if (asBoolean(normalized.fallback?.triggered ?? legacy.fallbackUsed, false)) return "warning";
  if (asString(normalized.cache?.status ?? legacy.cacheStatus).toLowerCase() === "miss") return "warning";
  if (asString(normalized.guardrail?.action ?? legacy.guardrailStatus).toLowerCase() === "flagged") return "warning";
  return "success";
}

function inferUseType(metadata: unknown): "runtime" | "audit" {
  const normalized = normalizeTraceMetadataV1(metadata);
  const legacy = asRecord(normalized.custom);
  const explicit = asString(normalized.tags?.use_type ?? legacy.useType).toLowerCase();
  if (explicit === "runtime" || explicit === "audit") return explicit;
  return asString(legacy.action) ? "audit" : "runtime";
}

export function isRuntimeTraceMetadata(metadata: unknown): boolean {
  const normalized = normalizeTraceMetadataV1(metadata);
  const legacy = asRecord(normalized.custom);
  const useType = asString(normalized.tags?.use_type ?? legacy.useType).toLowerCase();
  const kind = asString(normalized.trace?.kind ?? normalized.tags?.trace_kind ?? legacy.traceKind).toLowerCase();
  if (useType === "audit" || kind === "admin_audit") return false;
  if (useType === "runtime" || kind === "runtime_execution") return true;
  if (normalized.executor?.type) return true;
  if (normalized.request?.source === "trace_replay") return true;
  if (normalized.tags?.replay_of || asString(asRecord(legacy.replay).source_trace_id)) return true;
  if (Array.isArray(normalized.spans) && normalized.spans.length > 0) return true;
  if (normalized.output?.final_text || normalized.output?.raw_text) return true;
  return false;
}

export function isRuntimeTraceRow(row: AuditLogTraceRow): boolean {
  return isRuntimeTraceMetadata(row.metadata);
}

function inferCacheStatus(metadata: unknown): "hit" | "miss" | "skipped" | "stale" | "unknown" {
  const normalized = normalizeTraceMetadataV1(metadata);
  const legacy = asRecord(normalized.custom);
  const explicit = asString(normalized.cache?.status ?? legacy.cacheStatus ?? legacy.cache_status).toLowerCase();
  if (explicit === "hit" || explicit === "miss" || explicit === "skipped" || explicit === "stale") return explicit;
  if (typeof legacy.cacheHit === "boolean") return legacy.cacheHit ? "hit" : "miss";
  return "unknown";
}

function inferGuardrail(metadata: unknown): "passed" | "flagged" | "unknown" {
  const normalized = normalizeTraceMetadataV1(metadata);
  const legacy = asRecord(normalized.custom);
  const explicit = asString(normalized.guardrail?.action ?? legacy.guardrailStatus ?? legacy.guardrail).toLowerCase();
  if (explicit === "passed" || explicit === "flagged") return explicit;
  if (explicit === "allow") return "passed";
  if (explicit === "warn" || explicit === "block" || explicit === "redact") return "flagged";
  return "unknown";
}

function readCost(metadata: unknown): number | null {
  const normalized = normalizeTraceMetadataV1(metadata);
  const legacy = asRecord(normalized.custom);
  const values = [
    normalized.model?.cost?.total_cost,
    normalized.model?.cost?.output_cost,
    normalized.model?.cost?.input_cost,
    legacy.totalCostUsd,
    legacy.costUsd,
    legacy.cost,
  ];
  for (const value of values) {
    const parsed = asNumber(value, Number.NaN);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function toEvaluationLabel(value: unknown): TraceEvaluationLabel {
  const explicit = asString(value).toLowerCase();
  if (
    explicit === "better" ||
    explicit === "same" ||
    explicit === "worse" ||
    explicit === "pass" ||
    explicit === "fail" ||
    explicit === "unknown"
  ) {
    return explicit;
  }
  return "unknown";
}

function normalizeEvaluation(metadata: unknown): TraceEvaluationView | null {
  const normalized = normalizeTraceMetadataV1(metadata);
  const legacy = asRecord(normalized.custom);
  const evaluation = asRecord(normalized.evaluation ?? legacy.evaluation);
  const score = asNumber(evaluation.score ?? legacy.evalScore ?? legacy.score, Number.NaN);
  const rawChecks = Array.isArray(evaluation.checks) ? evaluation.checks : [];
  const checks: TraceEvaluationCheckView[] = rawChecks.map((entry, index) => {
    const row = asRecord(entry);
    const checkScore = asNumber(row.score, Number.NaN);
    return {
      name: asString(row.name, `Check ${index + 1}`),
      label: toEvaluationLabel(row.label ?? row.status),
      score: Number.isFinite(checkScore) ? checkScore : null,
      reason: asString(row.reason, ""),
    };
  });

  if (!Number.isFinite(score) && checks.length === 0) return null;

  return {
    score: Number.isFinite(score) ? score : null,
    label: toEvaluationLabel(evaluation.label),
    runId: asString(evaluation.run_id ?? evaluation.runId) || null,
    datasetId: asString(evaluation.dataset_id ?? evaluation.datasetId) || null,
    comparedAgainstTraceId: asString(evaluation.compared_against_trace_id ?? evaluation.comparedAgainstTraceId) || null,
    evaluationMode: asString(evaluation.evaluation_mode ?? evaluation.evaluationMode) || undefined,
    checks,
  };
}

function inferExecutorType(metadata: unknown): TraceSummaryView["executorType"] {
  const normalized = normalizeTraceMetadataV1(metadata);
  const explicit = asString(normalized.executor?.type).toLowerCase();
  if (explicit === "direct_provider" || explicit === "enterprise_gateway" || explicit === "observe_only") {
    return explicit;
  }
  return "unknown";
}

function inferExecutorObservability(metadata: unknown): TraceSummaryView["executorObservability"] {
  const normalized = normalizeTraceMetadataV1(metadata);
  const explicit = asString(normalized.executor?.response_observability).toLowerCase();
  if (explicit === "full" || explicit === "partial" || explicit === "minimal") return explicit;
  return "unknown";
}

function normalizeTraceLogs(rawLogs: unknown, createdAt: string): TraceLogView[] {
  if (!Array.isArray(rawLogs)) return [];
  return rawLogs.map((entry, index) => {
    const row = asRecord(entry);
    const levelRaw = asString(row.level, "info").toLowerCase();
    const level: TraceLogView["level"] =
      levelRaw === "debug" || levelRaw === "warn" || levelRaw === "error" ? levelRaw : "info";
    return {
      id: asString(row.id, `log-${index + 1}`),
      timestamp: asString(row.timestamp, createdAt),
      offsetMs: asNumber(row.offsetMs ?? row.offset_ms, 0),
      level,
      component: asString(row.component, "runtime"),
      message: asString(row.message, "Log event"),
      spanId: asString(row.spanId ?? row.span_id) || undefined,
    };
  });
}

function toSpanType(value: string): TraceSpanView["type"] {
  const mapped: Record<string, TraceSpanView["type"]> = {
    root: "incoming_request",
    request: "incoming_request",
    sidecar: "sidecar_proxy",
    prompt_resolve: "prompt_resolution",
    template_render: "template_render",
    retrieval: "retrieval_query",
    rerank: "rerank",
    cache: "cache",
    model_select: "model_selection",
    llm: "llm_completion",
    guardrail: "guardrail",
    parser: "response_parser",
    fallback: "fallback",
    audit: "audit_sink",
    evaluation: "evaluation_hook",
  };
  if (mapped[value]) return mapped[value];
  const known: TraceSpanView["type"][] = [
    "incoming_request",
    "sidecar_proxy",
    "prompt_resolution",
    "template_render",
    "retrieval_query",
    "vector_lookup",
    "rerank",
    "context_assembly",
    "cache",
    "model_selection",
    "llm_completion",
    "guardrail",
    "response_parser",
    "fallback",
    "audit_sink",
    "evaluation_hook",
  ];
  return known.includes(value as TraceSpanView["type"]) ? (value as TraceSpanView["type"]) : "incoming_request";
}

function normalizeMetadataSpans(rawSpans: unknown, defaultPromptVersion: string): TraceSpanView[] {
  if (!Array.isArray(rawSpans)) return [];
  return rawSpans.map((entry, index) => {
    const span = asRecord(entry);
    const status = asString(span.status, "success").toLowerCase();
    const spanStatus: TraceStatus =
      status === "warning" || status === "error" ? status : "success";
    const spanMetadata = asRecord(span.metadata);
    const normalizedSpanType = asString(span.type, "incoming_request");
    return {
      id: asString(span.id ?? span.span_id, `span-${index + 1}`),
      parentId: asString(span.parentId ?? span.parent_id ?? span.parent_span_id) || null,
      name: asString(span.name, `Span ${index + 1}`),
      type: toSpanType(normalizedSpanType),
      service: asString(span.service ?? span.component, "runtime"),
      status: spanStatus,
      startMs: asNumber(span.startMs ?? span.start_ms ?? span.start_offset_ms, 0),
      durationMs: asNumber(span.durationMs ?? span.duration_ms, 0),
      tokensIn: asNumber(span.tokensIn ?? span.tokens_in, 0) || undefined,
      tokensOut: asNumber(span.tokensOut ?? span.tokens_out, 0) || undefined,
      costUsd: asNumber(span.costUsd ?? span.cost_usd, 0) || undefined,
      model: asString(span.model ?? spanMetadata.model) || undefined,
      provider: asString(span.provider ?? spanMetadata.provider) || undefined,
      promptVersion: asString(span.promptVersion ?? spanMetadata.prompt_version, defaultPromptVersion) || undefined,
      cacheStatus: asString(span.cacheStatus ?? spanMetadata.cache_status) === "hit" || asString(span.cacheStatus ?? spanMetadata.cache_status) === "miss"
        ? (asString(span.cacheStatus ?? spanMetadata.cache_status) as "hit" | "miss")
        : undefined,
      guardrailResult: asString(span.guardrailResult ?? spanMetadata.guardrail_result) === "passed" || asString(span.guardrailResult ?? spanMetadata.guardrail_result) === "flagged"
        ? (asString(span.guardrailResult ?? spanMetadata.guardrail_result) as "passed" | "flagged")
        : undefined,
      retries: asNumber(span.retries, 0) || undefined,
      criticalPath: asBoolean(span.criticalPath, false) || undefined,
      aiSpecific: asBoolean(span.aiSpecific, false) || undefined,
      branch: asString(span.branch) === "fallback" ? "fallback" : asString(span.branch) === "primary" ? "primary" : undefined,
      tags: toScalarRecord(span.tags),
      inputPreview: asString(span.inputPreview) || undefined,
      outputPreview: asString(span.outputPreview) || undefined,
    };
  });
}

function buildSyntheticSpans(
  row: AuditLogTraceRow,
  metadata: Record<string, unknown>,
  status: TraceStatus,
  promptVersion: string,
): TraceSpanView[] {
  const proxyLatency = Math.max(asNumber(row.proxy_latency_ms, 0), 0);
  const llmLatency = Math.max(asNumber(row.llm_latency_ms, 0), 0);
  const totalLatency = Math.max(proxyLatency + llmLatency, Math.max(proxyLatency, llmLatency), 1);
  const cacheStatus = inferCacheStatus(metadata);
  const guardrail = inferGuardrail(metadata);

  const spans: TraceSpanView[] = [
    {
      id: "root",
      parentId: null,
      name: `${asString(row.prompt_name, "prompt")} execution`,
      type: "incoming_request",
      service: "vectorbea-sidecar",
      status,
      startMs: 0,
      durationMs: totalLatency,
      criticalPath: true,
      aiSpecific: true,
      promptVersion,
      inputPreview: asString(asRecord(metadata.input).text ?? metadata.userInput ?? metadata.input),
      outputPreview: asString(asRecord(metadata.output).text ?? metadata.finalOutput ?? metadata.output),
    },
    {
      id: "proxy",
      parentId: "root",
      name: "Proxy runtime",
      type: "sidecar_proxy",
      service: "vectorbea-sidecar",
      status: proxyLatency > 0 ? "success" : status,
      startMs: 0,
      durationMs: Math.max(proxyLatency, 1),
      aiSpecific: true,
    },
  ];

  if (llmLatency > 0) {
    spans.push({
      id: "llm",
      parentId: "root",
      name: "LLM completion",
      type: "llm_completion",
      service: "llm-provider",
      status,
      startMs: Math.max(proxyLatency, 0),
      durationMs: llmLatency,
      model: asString(asRecord(metadata.model).name ?? metadata.model),
      provider: asString(asRecord(metadata.model).provider ?? metadata.provider),
      tokensOut: asNumber(row.token_count, 0) || undefined,
      promptVersion,
      criticalPath: true,
      aiSpecific: true,
    });
  }

  if (cacheStatus !== "unknown") {
    spans.push({
      id: "cache",
      parentId: "root",
      name: "Cache lookup",
      type: "cache",
      service: "prompt-cache",
      status: cacheStatus === "hit" || cacheStatus === "skipped" ? "success" : "warning",
      startMs: 0,
      durationMs: 5,
      cacheStatus: cacheStatus === "hit" || cacheStatus === "miss" ? cacheStatus : undefined,
      aiSpecific: true,
    });
  }

  if (guardrail !== "unknown") {
    spans.push({
      id: "guardrail",
      parentId: "root",
      name: "Guardrail validation",
      type: "guardrail",
      service: "policy-guardrails",
      status: guardrail === "passed" ? "success" : "warning",
      startMs: Math.max(totalLatency - 10, 0),
      durationMs: 10,
      guardrailResult: guardrail,
      aiSpecific: true,
    });
  }

  spans.push({
    id: "audit",
    parentId: "root",
    name: "Audit persistence",
    type: "audit_sink",
    service: "audit-logs",
    status: "success",
    startMs: Math.max(totalLatency - 5, 0),
    durationMs: 5,
  });

  return spans;
}

export function parseAuditMetadata(metadata: unknown, createdAt: string, defaultPromptVersion: string): ParsedAuditMetadata {
  const root = normalizeTraceMetadataV1(metadata);
  const legacy = asRecord(root.custom);
  return {
    spans: normalizeMetadataSpans(root.spans, defaultPromptVersion),
    input: { ...asRecord(root.request?.input), ...asRecord(legacy.input) },
    output: { ...asRecord(root.output), ...asRecord(legacy.output) },
    logs: normalizeTraceLogs(root.logs, createdAt),
    model: { ...asRecord(root.model), ...asRecord(legacy.model) },
    cache: { ...asRecord(root.cache), ...asRecord(legacy.cache) },
    guardrail: { ...asRecord(root.guardrail), ...asRecord(legacy.guardrail) },
  };
}

export function mapAuditRowToTraceSummary(row: AuditLogTraceRow): TraceSummaryView {
  const metadata = normalizeTraceMetadataV1(row.metadata);
  const legacy = asRecord(metadata.custom);
  const status = toStatus(metadata);
  const cacheStatus = inferCacheStatus(metadata);
  const guardrail = inferGuardrail(metadata);
  const durationMs = Math.max(
    asNumber(row.proxy_latency_ms, 0) + asNumber(row.llm_latency_ms, 0),
    asNumber(row.proxy_latency_ms, 0),
    asNumber(row.llm_latency_ms, 0),
    0,
  );

  return {
    id: row.id,
    createdAt: row.created_at,
    status,
    useType: inferUseType(metadata),
    environment: asString(metadata.trace?.environment ?? legacy.environment ?? legacy.env, "prod"),
    promptName: asString(row.prompt_name, "unknown-prompt"),
    promptVersion: asString(row.version_tag, "latest"),
    model: asString(metadata.model?.model ?? asRecord(legacy.model).name ?? legacy.model) || null,
    provider: asString(metadata.model?.provider ?? asRecord(legacy.model).provider ?? legacy.provider) || null,
    executorType: inferExecutorType(metadata),
    executorName: asString(metadata.executor?.name ?? legacy.executorName) || null,
    executorObservability: inferExecutorObservability(metadata),
    replayOf: asString(metadata.tags?.replay_of ?? asRecord(legacy.replay).source_trace_id) || null,
    sidecarName: asString(legacy.sidecarName ?? legacy.sidecar ?? legacy.agentName ?? legacy.agent_id ?? metadata.tags?.sidecar) || null,
    durationMs,
    llmLatencyMs: asNumber(row.llm_latency_ms, 0),
    tokenCount: asNumber(row.token_count, 0),
    totalCostUsd: readCost(metadata),
    cacheStatus,
    fallbackUsed: asBoolean(metadata.fallback?.triggered ?? legacy.fallbackUsed, false),
    guardrail,
  };
}

export function mapAuditRowToTraceDetail(
  row: AuditLogTraceRow,
  enrichment?: {
    promptTemplateText?: string | null;
    promptParameters?: Record<string, unknown> | null;
    promptName?: string | null;
    promptVersionTag?: string | null;
    sidecarName?: string | null;
  },
): TraceDetailView {
  const metadata = normalizeTraceMetadataV1(row.metadata);
  const legacy = asRecord(metadata.custom);
  const status = toStatus(metadata);
  const env = asString(metadata.trace?.environment ?? legacy.environment ?? legacy.env, "prod");
  const promptVersion = asString(enrichment?.promptVersionTag ?? row.version_tag, "latest");
  const promptName = asString(enrichment?.promptName ?? row.prompt_name, "unknown-prompt");
  const parsed = parseAuditMetadata(metadata, row.created_at, promptVersion);
  const cacheStatus = inferCacheStatus(metadata);
  const guardrail = inferGuardrail(metadata);
  const modelName = asString(parsed.model.model ?? parsed.model.name ?? legacy.model, "unknown-model");
  const provider = asString(parsed.model.provider ?? legacy.provider, "unknown");
  const totalCost = readCost(metadata) ?? 0;
  const proxyLatency = asNumber(row.proxy_latency_ms, 0);
  const llmLatency = asNumber(row.llm_latency_ms, 0);
  const durationMs = Math.max(proxyLatency + llmLatency, proxyLatency, llmLatency, 0);
  const syntheticSpanContext: Record<string, unknown> = {
    ...legacy,
    model: metadata.model ?? legacy.model,
    provider: metadata.model?.provider ?? legacy.provider,
    input: metadata.request?.input ?? legacy.input,
    output: metadata.output ?? legacy.output,
    cacheStatus: metadata.cache?.status ?? legacy.cacheStatus,
    guardrailStatus: metadata.guardrail?.action ?? legacy.guardrailStatus,
  };
  const spans = parsed.spans.length > 0
    ? parsed.spans
    : buildSyntheticSpans(row, syntheticSpanContext, status, promptVersion);
  const rawContextDocs = parsed.input.contextDocs ?? parsed.input.context_docs;
  const contextDocs = Array.isArray(rawContextDocs)
    ? rawContextDocs.map((entry, index) => {
        const doc = asRecord(entry);
        return {
          id: asString(doc.id, `doc-${index + 1}`),
          source: asString(doc.source, "retrieval"),
          title: asString(doc.title, `Context ${index + 1}`),
          tokenCount: asNumber(doc.tokenCount ?? doc.token_count, 0),
          content: asString(doc.content),
        };
      })
    : [];

  return {
    id: row.id,
    status,
    startedAt: row.created_at,
    env,
    durationMs,
    totalCostUsd: totalCost,
    tokensIn: asNumber(parsed.model.input_tokens ?? parsed.model.tokensIn ?? legacy.tokensIn ?? legacy.tokens_in, 0),
    tokensOut: asNumber(parsed.model.output_tokens ?? parsed.model.tokensOut ?? legacy.tokensOut ?? legacy.tokens_out ?? row.token_count, 0),
    promptName,
    promptVersion,
    sidecarName: asString(enrichment?.sidecarName ?? legacy.sidecarName ?? legacy.sidecar ?? legacy.agent_id ?? metadata.tags?.sidecar, "unknown-sidecar"),
    primaryModel: modelName,
    provider,
    executorType: inferExecutorType(metadata),
    executorName: asString(metadata.executor?.name ?? legacy.executorName, "unknown-executor"),
    executorOwnership: asString(metadata.executor?.ownership ?? legacy.executorOwnership, "unknown"),
    executorObservability: inferExecutorObservability(metadata),
    replayOf: asString(metadata.tags?.replay_of ?? asRecord(legacy.replay).source_trace_id) || null,
    cacheStatus,
    fallbackUsed: asBoolean(metadata.fallback?.triggered ?? legacy.fallbackUsed, false),
    guardrail: guardrail === "unknown" ? "passed" : guardrail,
    evalScore: asNumber(metadata.evaluation?.score ?? legacy.evalScore ?? legacy.score, 0),
    evaluation: normalizeEvaluation(metadata),
    spans,
    logs: parsed.logs,
    prompt: {
      name: promptName,
      version: promptVersion,
      source: asString(legacy.promptSource, "published") as "published" | "draft" | "experiment",
      publishedBy: asString(legacy.publishedBy, "-"),
      rolloutPercent: asNumber(metadata.prompt?.rollout_percentage ?? legacy.rolloutPercent, 100),
      releaseTag: asString(metadata.prompt?.release_tag ?? legacy.releaseTag, "-"),
      evalBaseline: asNumber(legacy.evalBaseline, 0),
      params: {
        temperature: asNumber(asRecord(enrichment?.promptParameters).temperature ?? parsed.model.temperature ?? asRecord(parsed.model.params).temperature, 0),
        top_p: asNumber(asRecord(enrichment?.promptParameters).top_p ?? parsed.model.top_p ?? asRecord(parsed.model.params).top_p, 1),
        max_tokens: asNumber(asRecord(enrichment?.promptParameters).max_tokens ?? parsed.model.max_tokens ?? asRecord(parsed.model.params).max_tokens, 0),
      },
      system: asString(asRecord(parsed.input.prompt).systemPrompt),
      developer: asString(asRecord(parsed.input.prompt).developerPrompt),
      userTemplate: asString(enrichment?.promptTemplateText, ""),
      renderedPrompt: asString(parsed.input.renderedPrompt ?? legacy.renderedPrompt, ""),
      variables: toStringRecord(parsed.input.variables ?? metadata.prompt?.variables ?? legacy.variables),
    },
    inputs: {
      userInput: asString(parsed.input.text ?? parsed.input.userInput ?? legacy.userInput ?? parsed.input.query, ""),
      variables: toStringRecord(parsed.input.variables ?? metadata.prompt?.variables ?? legacy.variables),
      contextDocs,
      headers: toStringRecord(parsed.input.headers ?? legacy.headers),
      tenant: asString(parsed.input.tenant ?? legacy.tenant, "-"),
      workspace: row.workspace_id,
      environment: env,
      cacheKey: asString(parsed.cache.cache_key ?? parsed.cache.key ?? legacy.cacheKey, "-"),
      sessionId: asString(parsed.input.sessionId ?? metadata.trace?.session_id ?? legacy.sessionId, "-"),
      conversationId: asString(parsed.input.conversationId ?? metadata.trace?.conversation_id ?? legacy.conversationId, "-"),
    },
    outputs: {
      rawPrimary: asString(parsed.output.rawPrimary ?? parsed.output.raw ?? parsed.output.raw_text ?? legacy.rawOutput, ""),
      rawFallback: asString(parsed.output.rawFallback ?? legacy.fallbackOutput) || undefined,
      postProcessed: asString(parsed.output.postProcessed ?? legacy.postProcessedOutput, ""),
      finalDelivered: asString(parsed.output.final ?? parsed.output.text ?? parsed.output.final_text ?? legacy.finalOutput ?? legacy.output, ""),
      parsedJson: asRecord(parsed.output.parsedJson),
      safetyNotes: Array.isArray(parsed.guardrail.notes)
        ? parsed.guardrail.notes.filter((entry): entry is string => typeof entry === "string")
        : [],
    },
  };
}
