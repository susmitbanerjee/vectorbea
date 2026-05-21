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

export type ExecutorType = "direct_provider" | "enterprise_gateway" | "observe_only";

export interface TraceMetadataV1 {
  [key: string]: unknown;
  schema_version: typeof TRACE_METADATA_SCHEMA_VERSION;
  trace?: {
    status?: TraceStatus;
    environment?: string;
    duration_ms?: number;
  };
  executor?: {
    type?: ExecutorType;
    name?: string;
    ownership?: "vectorbea" | "customer";
    request_mode?: "direct" | "forwarded" | "wrapped";
    endpoint?: string | null;
    response_observability?: "full" | "partial" | "minimal";
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
  request?: {
    input?: {
      text?: string;
      variables?: Record<string, unknown>;
    };
  };
  retrieval?: {
    enabled?: boolean;
    query?: string;
    latency_ms?: number;
    sources?: Array<Record<string, unknown>>;
  };
  cache?: {
    enabled?: boolean;
    status?: CacheStatus;
    cache_key?: string;
    latency_ms?: number;
  };
  guardrail?: {
    triggered?: boolean;
    action?: "allow" | "redact" | "block" | "warn";
    checks?: Array<Record<string, unknown>>;
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

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

type TraceCost = NonNullable<NonNullable<TraceMetadataV1["model"]>["cost"]>;

function normalizeCost(value: unknown): TraceCost {
  const cost = asObject(value);
  const inputCost = cost.input_cost ?? cost.inputCost;
  const outputCost = cost.output_cost ?? cost.outputCost;
  const totalCost = cost.total_cost ?? cost.totalCost;
  return {
    currency: typeof cost.currency === "string" ? cost.currency : "USD",
    ...(typeof inputCost === "number" ? { input_cost: inputCost } : {}),
    ...(typeof outputCost === "number" ? { output_cost: outputCost } : {}),
    ...(typeof totalCost === "number" ? { total_cost: totalCost } : {}),
  };
}

function syntheticSpans(input: {
  proxyLatencyMs: number;
  llmLatencyMs: number;
  durationMs: number;
  status: TraceStatus;
}): Array<Record<string, unknown>> {
  const spans: Array<Record<string, unknown>> = [
    {
      span_id: "root",
      parent_span_id: null,
      name: "Runtime execution",
      type: "root",
      component: "vectorbea-sdk",
      status: input.status,
      start_offset_ms: 0,
      duration_ms: input.durationMs,
    },
  ];
  if (input.proxyLatencyMs > 0) {
    spans.push({
      span_id: "prompt-resolve",
      parent_span_id: "root",
      name: "Prompt resolution",
      type: "prompt_resolve",
      component: "vectorbea",
      status: input.status,
      start_offset_ms: 0,
      duration_ms: input.proxyLatencyMs,
    });
  }
  if (input.llmLatencyMs > 0) {
    spans.push({
      span_id: "llm-call",
      parent_span_id: "root",
      name: "LLM completion",
      type: "llm",
      component: "llm",
      status: input.status,
      start_offset_ms: Math.max(0, input.proxyLatencyMs),
      duration_ms: input.llmLatencyMs,
    });
  }
  return spans;
}

export function buildTraceMetadataV1(input: BuildInput): TraceMetadataV1 {
  const existing = asObject(input.metadata);
  const trace = asObject(existing.trace);
  const executor = asObject(existing.executor);
  const request = asObject(existing.request);
  const prompt = asObject(existing.prompt);
  const model = asObject(existing.model);
  const retrieval = asObject(existing.retrieval ?? existing.rag);
  const cache = asObject(existing.cache);
  const guardrail = asObject(existing.guardrail);
  const output = asObject(existing.output);
  const tags = asObject(existing.tags);
  const custom = asObject(existing.custom);

  for (const [key, value] of Object.entries(existing)) {
    if (
      key !== "schema_version" &&
      key !== "trace" &&
      key !== "executor" &&
      key !== "request" &&
      key !== "prompt" &&
      key !== "model" &&
      key !== "retrieval" &&
      key !== "rag" &&
      key !== "cache" &&
      key !== "guardrail" &&
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
  const status = (trace.status as TraceStatus | undefined) ?? (custom.fallbackUsed ? "warning" : "success");
  const inputText = asObject(existing.input).text ?? asObject(request.input).text;
  const variables = asObject(prompt.variables ?? custom.variables);
  const modelName = model.model ?? model.name ?? custom.model;
  const inputTokens = model.input_tokens ?? model.tokensIn ?? custom.tokensIn;
  const outputTokens = model.output_tokens ?? model.tokensOut ?? custom.tokensOut;
  const totalTokens = model.total_tokens ?? custom.totalTokens ?? input.tokenCount;
  const guardrailAction =
    guardrail.action === "passed" ? "allow" :
    guardrail.action === "flagged" ? "warn" :
    (guardrail.action as "allow" | "redact" | "block" | "warn" | undefined);

  return {
    schema_version: TRACE_METADATA_SCHEMA_VERSION,
    trace: {
      ...trace,
      duration_ms: Number(trace.duration_ms ?? durationMs),
      status,
    },
    executor: {
      ...executor,
      type: (executor.type as ExecutorType | undefined) ?? "direct_provider",
      name: (executor.name as string | undefined) ?? (model.provider as string | undefined) ?? "direct-provider",
      ownership: (executor.ownership as "vectorbea" | "customer" | undefined) ?? "vectorbea",
      request_mode: (executor.request_mode as "direct" | "forwarded" | "wrapped" | undefined) ?? "direct",
      endpoint: (executor.endpoint as string | null | undefined) ?? null,
      response_observability:
        (executor.response_observability as "full" | "partial" | "minimal" | undefined) ??
        (executor.observability as "full" | "partial" | "minimal" | undefined) ??
        "full",
    },
    request: {
      ...request,
      input: {
        ...asObject(request.input),
        ...(typeof inputText === "string" ? { text: inputText } : {}),
        ...(Object.keys(variables).length ? { variables } : {}),
      },
    },
    prompt: {
      ...prompt,
      prompt_version_id: (prompt.prompt_version_id as string | undefined) ?? input.promptVersionId,
      name: (prompt.name as string | undefined) ?? input.promptName,
      version_tag: (prompt.version_tag as string | undefined) ?? input.versionTag,
      variables,
    },
    model: {
      ...model,
      ...(typeof model.provider === "string" ? { provider: model.provider } : {}),
      ...(typeof modelName === "string" ? { model: modelName } : {}),
      input_tokens: asNumber(inputTokens),
      output_tokens: asNumber(outputTokens),
      total_tokens: asNumber(totalTokens, input.tokenCount),
      latency_ms: asNumber(model.latency_ms, input.llmLatencyMs),
      cost: normalizeCost(model.cost ?? custom.cost),
    },
    retrieval: {
      ...retrieval,
      enabled: Boolean(retrieval.enabled ?? retrieval.query ?? retrieval.sources ?? retrieval.chunks),
      ...(typeof retrieval.retrieval_ms === "number" && retrieval.latency_ms === undefined
        ? { latency_ms: retrieval.retrieval_ms }
        : {}),
      ...(Array.isArray(retrieval.chunks) && !Array.isArray(retrieval.sources)
        ? { sources: retrieval.chunks as Array<Record<string, unknown>> }
        : {}),
    },
    cache: {
      ...cache,
      enabled: cache.enabled !== undefined ? Boolean(cache.enabled) : cache.status !== undefined,
      status:
        (cache.status as CacheStatus | undefined) ??
        (typeof custom.cacheHit === "boolean" ? (custom.cacheHit ? "hit" : "miss") : undefined),
    },
    guardrail: {
      ...guardrail,
      triggered: Boolean((guardrail.triggered ?? (guardrailAction === "warn")) || guardrailAction === "block"),
      action: guardrailAction,
    },
    output: {
      ...output,
      final_text: (output.final_text as string | undefined) ?? (custom.finalOutput as string | undefined),
      raw_text: (output.raw_text as string | undefined) ?? (custom.rawOutput as string | undefined),
      structured: output.structured ?? custom.structured,
    },
    spans: Array.isArray(existing.spans) && existing.spans.length > 0
      ? (existing.spans as Array<Record<string, unknown>>)
      : syntheticSpans({ proxyLatencyMs: input.proxyLatencyMs, llmLatencyMs: input.llmLatencyMs, durationMs, status }),
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
