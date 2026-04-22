import "server-only";

import type { TraceDetailView, TraceLogView, TraceSpanView, TraceStatus, TraceSummaryView } from "@/lib/api";

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

function toStatus(metadata: Record<string, unknown>): TraceStatus {
  const explicit = asString(metadata.traceStatus || metadata.status).toLowerCase();
  if (explicit === "success" || explicit === "warning" || explicit === "error") {
    return explicit;
  }

  if (
    metadata.error ||
    metadata.exception ||
    metadata.failed ||
    metadata.timeout
  ) {
    return "error";
  }

  const guardrail = asString(metadata.guardrailStatus || metadata.guardrail).toLowerCase();
  if (guardrail === "flagged") return "warning";
  if (asBoolean(metadata.fallbackUsed, false)) return "warning";
  if (asString(metadata.cacheStatus).toLowerCase() === "miss") return "warning";

  return "success";
}

function inferUseType(metadata: Record<string, unknown>): "runtime" | "audit" {
  const explicit = asString(metadata.useType).toLowerCase();
  if (explicit === "runtime" || explicit === "audit") return explicit;
  const action = asString(metadata.action);
  return action ? "audit" : "runtime";
}

function inferCacheStatus(metadata: Record<string, unknown>): "hit" | "miss" | "unknown" {
  const explicit = asString(metadata.cacheStatus || metadata.cache_status).toLowerCase();
  if (explicit === "hit" || explicit === "miss") return explicit;
  if (typeof metadata.cacheHit === "boolean") return metadata.cacheHit ? "hit" : "miss";
  return "unknown";
}

function inferGuardrail(metadata: Record<string, unknown>): "passed" | "flagged" | "unknown" {
  const explicit = asString(metadata.guardrailStatus || metadata.guardrail).toLowerCase();
  if (explicit === "passed" || explicit === "flagged") return explicit;
  return "unknown";
}

function readCost(metadata: Record<string, unknown>): number | null {
  const values = [
    metadata.totalCostUsd,
    metadata.costUsd,
    metadata.cost,
  ];
  for (const value of values) {
    const parsed = asNumber(value, Number.NaN);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function normalizeTraceLogs(metadata: Record<string, unknown>, createdAt: string): TraceLogView[] {
  const raw = metadata.logs;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry, index) => {
      const row = asRecord(entry);
      const timestamp = asString(row.timestamp, createdAt);
      const levelRaw = asString(row.level, "info").toLowerCase();
      const level: TraceLogView["level"] =
        levelRaw === "debug" || levelRaw === "warn" || levelRaw === "error" ? levelRaw : "info";
      return {
        id: asString(row.id, `log-${index + 1}`),
        timestamp,
        offsetMs: asNumber(row.offsetMs ?? row.offset_ms, 0),
        level,
        component: asString(row.component, "runtime"),
        message: asString(row.message, "Log event"),
        spanId: asString(row.spanId ?? row.span_id) || undefined,
      };
    })
    .filter((row) => row.message.length > 0);
}

function normalizeContextDocs(metadata: Record<string, unknown>) {
  const raw = metadata.contextDocs ?? metadata.context_docs ?? metadata.retrievalChunks;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry, index) => {
      const doc = asRecord(entry);
      return {
        id: asString(doc.id, `doc-${index + 1}`),
        source: asString(doc.source, "retrieval"),
        title: asString(doc.title, `Context document ${index + 1}`),
        tokenCount: asNumber(doc.tokenCount ?? doc.token_count, 0),
        content: asString(doc.content),
      };
    })
    .filter((doc) => doc.content.length > 0);
}

function toTraceSpans(
  row: AuditLogTraceRow,
  metadata: Record<string, unknown>,
  status: TraceStatus,
  model: string,
  provider: string,
  cacheStatus: "hit" | "miss" | "unknown",
  guardrail: "passed" | "flagged" | "unknown",
): TraceSpanView[] {
  const proxyLatency = Math.max(asNumber(row.proxy_latency_ms, 0), 1);
  const llmLatency = Math.max(asNumber(row.llm_latency_ms, 0), 0);
  const total = Math.max(proxyLatency, llmLatency, 1);
  const spans: TraceSpanView[] = [
    {
      id: "root",
      parentId: null,
      name: `${asString(row.prompt_name, "prompt")} request`,
      type: "incoming_request",
      service: "vectorbea-sidecar",
      status,
      startMs: 0,
      durationMs: total,
      criticalPath: true,
      aiSpecific: true,
      promptVersion: asString(row.version_tag, "latest"),
      inputPreview: asString(metadata.userInput ?? metadata.input ?? metadata.question),
      outputPreview: asString(metadata.finalOutput ?? metadata.output ?? metadata.response),
    },
  ];

  if (cacheStatus !== "unknown") {
    spans.push({
      id: "cache",
      parentId: "root",
      name: "Cache lookup",
      type: "cache",
      service: "prompt-cache",
      status: cacheStatus === "hit" ? "success" : "warning",
      startMs: 0,
      durationMs: Math.min(12, total),
      cacheStatus,
      aiSpecific: true,
    });
  }

  if (llmLatency > 0) {
    spans.push({
      id: "llm",
      parentId: "root",
      name: "LLM completion",
      type: "llm_completion",
      service: provider.toLowerCase() === "unknown" ? "llm-provider" : `${provider.toLowerCase()}-gateway`,
      status,
      startMs: Math.max(total - llmLatency, 0),
      durationMs: llmLatency,
      model,
      provider,
      tokensIn: asNumber(metadata.tokensIn ?? metadata.tokens_in, 0),
      tokensOut: asNumber(metadata.tokensOut ?? metadata.tokens_out ?? row.token_count, 0),
      costUsd: readCost(metadata) ?? undefined,
      promptVersion: asString(row.version_tag, "latest"),
      criticalPath: true,
      aiSpecific: true,
    });
  }

  const retrievalLatency = asNumber(metadata.retrievalLatencyMs ?? metadata.retrieval_latency_ms, 0);
  if (retrievalLatency > 0) {
    spans.push({
      id: "retrieval",
      parentId: "root",
      name: "Retrieval query",
      type: "retrieval_query",
      service: "retrieval-engine",
      status: "success",
      startMs: Math.max(total - llmLatency - retrievalLatency, 0),
      durationMs: retrievalLatency,
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
      startMs: Math.max(total - 20, 0),
      durationMs: 20,
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
    startMs: Math.max(total - 10, 0),
    durationMs: 10,
  });

  return spans;
}

export function mapAuditRowToTraceSummary(row: AuditLogTraceRow): TraceSummaryView {
  const metadata = asRecord(row.metadata);
  const status = toStatus(metadata);
  const cacheStatus = inferCacheStatus(metadata);
  const guardrail = inferGuardrail(metadata);

  return {
    id: row.id,
    createdAt: row.created_at,
    status,
    useType: inferUseType(metadata),
    environment: asString(metadata.environment ?? metadata.env, "prod"),
    promptName: asString(row.prompt_name, "unknown-prompt"),
    promptVersion: asString(row.version_tag, "latest"),
    model: asString(metadata.model ?? metadata.modelName) || null,
    provider: asString(metadata.provider) || null,
    sidecarName: asString(metadata.sidecarName ?? metadata.sidecar ?? metadata.agentName) || null,
    durationMs: Math.max(asNumber(row.proxy_latency_ms, 0), asNumber(row.llm_latency_ms, 0), 0),
    llmLatencyMs: asNumber(row.llm_latency_ms, 0),
    tokenCount: asNumber(row.token_count, 0),
    totalCostUsd: readCost(metadata),
    cacheStatus,
    fallbackUsed: asBoolean(metadata.fallbackUsed),
    guardrail,
  };
}

export function mapAuditRowToTraceDetail(row: AuditLogTraceRow): TraceDetailView {
  const metadata = asRecord(row.metadata);
  const status = toStatus(metadata);
  const env = asString(metadata.environment ?? metadata.env, "prod");
  const promptVersion = asString(row.version_tag, "latest");
  const promptName = asString(row.prompt_name, "unknown-prompt");
  const model = asString(metadata.model ?? metadata.modelName, "unknown-model");
  const provider = asString(metadata.provider, "unknown");
  const cacheStatus = inferCacheStatus(metadata);
  const guardrail = inferGuardrail(metadata);
  const fallbackUsed = asBoolean(metadata.fallbackUsed, false);
  const totalCost = readCost(metadata) ?? 0;
  const tokensIn = asNumber(metadata.tokensIn ?? metadata.tokens_in, 0);
  const tokensOut = asNumber(metadata.tokensOut ?? metadata.tokens_out ?? row.token_count, 0);
  const spans = toTraceSpans(row, metadata, status, model, provider, cacheStatus, guardrail);
  const logs = normalizeTraceLogs(metadata, row.created_at);
  const contextDocs = normalizeContextDocs(metadata);

  return {
    id: row.id,
    status,
    startedAt: row.created_at,
    env,
    durationMs: Math.max(asNumber(row.proxy_latency_ms, 0), asNumber(row.llm_latency_ms, 0), 0),
    totalCostUsd: totalCost,
    tokensIn,
    tokensOut,
    promptName,
    promptVersion,
    sidecarName: asString(metadata.sidecarName ?? metadata.sidecar ?? metadata.agentName, "unknown-sidecar"),
    primaryModel: model,
    provider,
    cacheStatus: cacheStatus === "unknown" ? "miss" : cacheStatus,
    fallbackUsed,
    guardrail: guardrail === "unknown" ? "passed" : guardrail,
    evalScore: asNumber(metadata.evalScore ?? metadata.score, 0),
    spans,
    logs,
    prompt: {
      name: promptName,
      version: promptVersion,
      source: asString(metadata.promptSource, "published") as "published" | "draft" | "experiment",
      publishedBy: asString(metadata.publishedBy, "—"),
      rolloutPercent: asNumber(metadata.rolloutPercent, 100),
      releaseTag: asString(metadata.releaseTag, "—"),
      evalBaseline: asNumber(metadata.evalBaseline, 0),
      params: {
        temperature: asNumber(asRecord(metadata.modelParams).temperature, 0),
        top_p: asNumber(asRecord(metadata.modelParams).top_p, 1),
        max_tokens: asNumber(asRecord(metadata.modelParams).max_tokens, 0),
      },
      system: asString(metadata.systemPrompt),
      developer: asString(metadata.developerPrompt),
      userTemplate: asString(metadata.userTemplate),
      renderedPrompt: asString(metadata.renderedPrompt),
      variables: toStringRecord(metadata.variables),
    },
    inputs: {
      userInput: asString(metadata.userInput ?? metadata.input ?? metadata.question),
      variables: toStringRecord(metadata.variables),
      contextDocs,
      headers: toStringRecord(metadata.headers),
      tenant: asString(metadata.tenant, "—"),
      workspace: row.workspace_id,
      environment: env,
      cacheKey: asString(metadata.cacheKey, "—"),
      sessionId: asString(metadata.sessionId, "—"),
      conversationId: asString(metadata.conversationId, "—"),
    },
    outputs: {
      rawPrimary: asString(metadata.rawOutput ?? metadata.primaryOutput),
      rawFallback: asString(metadata.fallbackOutput) || undefined,
      postProcessed: asString(metadata.postProcessedOutput ?? metadata.postProcessed),
      finalDelivered: asString(metadata.finalOutput ?? metadata.output ?? metadata.response),
      parsedJson: asRecord(metadata.parsedJson),
      safetyNotes: Array.isArray(metadata.safetyNotes)
        ? metadata.safetyNotes.filter((row): row is string => typeof row === "string")
        : [],
    },
  };
}
