export const TRACE_METADATA_SCHEMA_VERSION = "1.0" as const;

export type TraceStatus =
  | "success"
  | "warning"
  | "error"
  | "partial";

export type CacheStatus =
  | "hit"
  | "miss"
  | "skipped"
  | "stale";

export interface TraceMetadataV1 {
  [key: string]: unknown;
  schema_version: typeof TRACE_METADATA_SCHEMA_VERSION;
  trace?: {
    status?: TraceStatus;
    duration_ms?: number;
  };
  prompt?: {
    prompt_version_id?: string;
    name?: string;
    version_tag?: string;
    variables?: Record<string, unknown>;
  };
  model?: {
    provider?: string;
    model?: string;
    latency_ms?: number;
    total_tokens?: number;
  };
  cache?: {
    status?: CacheStatus;
    cache_key?: string;
  };
  output?: {
    raw_text?: string;
    final_text?: string;
    structured?: unknown;
  };
  spans?: Array<Record<string, unknown>>;
  logs?: Array<Record<string, unknown>>;
  tags?: Record<string, string>;
  custom?: Record<string, unknown>;
}

type BuildInput = {
  metadata?: Record<string, unknown>;
  promptVersionId: string;
  promptName: string;
  versionTag: string;
  proxyLatencyMs: number;
  llmLatencyMs: number;
  tokenCount: number;
  useType?: "runtime" | "audit";
};

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export function buildTraceMetadataV1(input: BuildInput): TraceMetadataV1 {
  const existing = asObject(input.metadata);
  const trace = asObject(existing.trace);
  const prompt = asObject(existing.prompt);
  const model = asObject(existing.model);
  const cache = asObject(existing.cache);
  const output = asObject(existing.output);
  const tags = asObject(existing.tags);
  const custom = asObject(existing.custom);

  for (const [key, value] of Object.entries(existing)) {
    if (
      key !== "schema_version" &&
      key !== "trace" &&
      key !== "prompt" &&
      key !== "model" &&
      key !== "cache" &&
      key !== "output" &&
      key !== "spans" &&
      key !== "logs" &&
      key !== "tags" &&
      key !== "custom"
    ) {
      custom[key] = value;
    }
  }

  const durationMs = Math.max(0, input.proxyLatencyMs + input.llmLatencyMs);

  return {
    schema_version: TRACE_METADATA_SCHEMA_VERSION,
    trace: {
      ...trace,
      duration_ms: Number(trace.duration_ms ?? durationMs),
      status: (trace.status as TraceStatus | undefined) ?? (custom.fallbackUsed ? "warning" : "success"),
    },
    prompt: {
      ...prompt,
      prompt_version_id: (prompt.prompt_version_id as string | undefined) ?? input.promptVersionId,
      name: (prompt.name as string | undefined) ?? input.promptName,
      version_tag: (prompt.version_tag as string | undefined) ?? input.versionTag,
      variables: asObject(prompt.variables ?? custom.variables),
    },
    model: {
      ...model,
      latency_ms: Number(model.latency_ms ?? input.llmLatencyMs),
      total_tokens: Number(model.total_tokens ?? input.tokenCount),
    },
    cache: {
      ...cache,
      status:
        (cache.status as CacheStatus | undefined) ??
        (typeof custom.cacheHit === "boolean" ? (custom.cacheHit ? "hit" : "miss") : undefined),
    },
    output: {
      ...output,
      final_text: (output.final_text as string | undefined) ?? (custom.finalOutput as string | undefined),
      raw_text: (output.raw_text as string | undefined) ?? (custom.rawOutput as string | undefined),
      structured: output.structured ?? custom.structured,
    },
    spans: Array.isArray(existing.spans) ? (existing.spans as Array<Record<string, unknown>>) : [],
    logs: Array.isArray(existing.logs) ? (existing.logs as Array<Record<string, unknown>>) : [],
    tags: {
      ...Object.entries(tags).reduce<Record<string, string>>((acc, [key, value]) => {
        if (typeof value === "string" && value.trim()) acc[key] = value.trim();
        return acc;
      }, {}),
      use_type: input.useType ?? "runtime",
    },
    custom,
  };
}
