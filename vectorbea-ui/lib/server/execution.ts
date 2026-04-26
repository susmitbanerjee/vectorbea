import "server-only";

import type { TraceMetadataV1 } from "@/lib/trace-metadata";
import { buildTraceMetadataV1, normalizeTraceMetadataV1 } from "@/lib/trace-metadata";
import { assertSafeGatewayUrl } from "@/lib/server/security";

export type ExecutorType = "direct_provider" | "enterprise_gateway" | "observe_only";

export type ResolvedExecutionRequest = {
  workspaceId: string;
  promptVersionId: string | null;
  promptName: string;
  versionTag: string;
  templateText: string;
  variables: Record<string, unknown>;
  inputText: string;
  renderedPrompt: string;
  sourceMetadata?: TraceMetadataV1 | Record<string, unknown> | null;
  replayOf?: string | null;
  triggeredBy?: string | null;
  executorOverride?: {
    type?: ExecutorType;
    provider?: string | null;
    model?: string | null;
  };
  providerConfig?: {
    providerType: string;
    apiKey: string;
    baseUrl: string | null;
    model: string | null;
    configId: string;
  } | null;
};

export type ExecutionResult = {
  status: "success" | "warning" | "error" | "partial";
  outputText: string;
  rawOutputText?: string;
  llmLatencyMs: number;
  proxyLatencyMs: number;
  tokenCount: number;
  provider?: string;
  model?: string;
  executor: NonNullable<TraceMetadataV1["executor"]>;
  metadata: TraceMetadataV1;
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function readOutputText(value: unknown): string | null {
  const root = asRecord(value);
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const firstChoice = asRecord(choices[0]);
  return (
    asString(root.output) ??
    asString(root.text) ??
    asString(root.content) ??
    asString(root.completion) ??
    asString(root.response) ??
    asString(asRecord(root.message).content) ??
    asString(firstChoice.text) ??
    asString(asRecord(firstChoice.message).content)
  );
}

function renderFallbackOutput(input: ResolvedExecutionRequest): string {
  const source = normalizeTraceMetadataV1(input.sourceMetadata ?? {});
  return (
    asString(source.output?.final_text) ??
    asString(source.output?.raw_text) ??
    asString(asRecord(source.custom).finalOutput) ??
    asString(asRecord(source.custom).rawOutput) ??
    "Replay captured prompt resolution, but no executor output was available."
  );
}

function resolveExecutor(input: ResolvedExecutionRequest): NonNullable<TraceMetadataV1["executor"]> {
  const source = normalizeTraceMetadataV1(input.sourceMetadata ?? {});
  const sourceExecutor = source.executor ?? {};
  const overrideProvider = asString(input.executorOverride?.provider);
  const overrideType = input.executorOverride?.type ?? (overrideProvider === "enterprise_gateway" ? "enterprise_gateway" : undefined);
  const envType = asString(process.env.VECTORBEA_EXECUTOR_TYPE) as ExecutorType | null;
  const gatewayUrl = asString(process.env.VECTORBEA_ENTERPRISE_GATEWAY_URL);
  const gatewayEndpoint = asString(process.env.VECTORBEA_ENTERPRISE_GATEWAY_ENDPOINT);
  const type = overrideType ??
    (sourceExecutor.type === "enterprise_gateway" || envType === "enterprise_gateway" || gatewayUrl
    ? "enterprise_gateway"
    : sourceExecutor.type ?? envType ?? "direct_provider");

  return {
    type,
    name:
      (overrideProvider && overrideProvider !== "enterprise_gateway" ? overrideProvider : null) ??
      sourceExecutor.name ??
      asString(process.env.VECTORBEA_EXECUTOR_NAME) ??
      (type === "enterprise_gateway" ? "enterprise-ai-gateway" : "direct-provider"),
    ownership: sourceExecutor.ownership ?? (type === "enterprise_gateway" ? "customer" : "vectorbea"),
    request_mode: sourceExecutor.request_mode ?? (type === "enterprise_gateway" ? "forwarded" : "direct"),
    endpoint:
      sourceExecutor.endpoint ??
      gatewayEndpoint ??
      (type === "enterprise_gateway" ? "/completion" : null),
    response_observability:
      sourceExecutor.response_observability ??
      (type === "enterprise_gateway" ? "partial" : "full"),
  };
}

async function executeGateway(
  input: ResolvedExecutionRequest,
  executor: NonNullable<TraceMetadataV1["executor"]>,
) {
  const baseUrl = asString(process.env.VECTORBEA_ENTERPRISE_GATEWAY_URL);
  const endpoint = executor.endpoint ?? "/completion";
  if (!baseUrl) {
    throw new Error("Enterprise gateway replay requires VECTORBEA_ENTERPRISE_GATEWAY_URL.");
  }

  const allowPrivate = asString(process.env.VECTORBEA_ALLOW_PRIVATE_GATEWAY_URLS) === "true";
  const resolvedUrl = endpoint?.startsWith("http")
    ? endpoint
    : `${baseUrl.replace(/\/$/, "")}/${String(endpoint ?? "/completion").replace(/^\//, "")}`;
  const safeUrl = assertSafeGatewayUrl(resolvedUrl, allowPrivate).toString();
  const authHeader = asString(process.env.VECTORBEA_ENTERPRISE_GATEWAY_AUTH_HEADER) ?? "Authorization";
  const authToken = asString(process.env.VECTORBEA_ENTERPRISE_GATEWAY_AUTH_TOKEN);
  const timeoutMs = Number(process.env.VECTORBEA_ENTERPRISE_GATEWAY_TIMEOUT_MS ?? "20000");
  const started = Date.now();
  const controller = new AbortController();
  const timeoutId = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? setTimeout(() => controller.abort("Gateway timeout"), timeoutMs)
    : null;
  const response = await fetch(safeUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(authToken ? { [authHeader]: authToken } : {}),
    },
    body: JSON.stringify({
      prompt: {
        name: input.promptName,
        version: input.versionTag,
        rendered: input.renderedPrompt,
        template: input.templateText,
        variables: input.variables,
      },
      input: {
        text: input.inputText,
      },
      trace: {
        workspace_id: input.workspaceId,
        replay_of: input.replayOf,
      },
    }),
    cache: "no-store",
    signal: controller.signal,
  }).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
  const latencyMs = Date.now() - started;
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");
  const bodyRecord = asRecord(body);
  const outputText = readOutputText(body) ?? (typeof body === "string" ? body : "");
  const usage = asRecord(bodyRecord.usage);

  if (!response.ok) {
    throw new Error(`Enterprise gateway returned ${response.status}.`);
  }

  return {
    outputText,
    rawOutputText: typeof body === "string" ? body : undefined,
    latencyMs,
    tokenCount: asNumber(usage.total_tokens ?? bodyRecord.total_tokens, 0),
    provider: asString(bodyRecord.provider) ?? undefined,
    model: asString(bodyRecord.model) ?? undefined,
  };
}

function assertSafeProviderBaseUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid provider base URL.");
  }
  const hostname = parsed.hostname.toLowerCase();
  const allowPrivate = process.env.VECTORBEA_ALLOW_PRIVATE_PROVIDER_URLS === "true";
  if (!allowPrivate) {
    const blocked = [
      /^localhost$/i,
      /^127\./,
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[01])\./,
      /^192\.168\./,
      /^::1$/,
      /^0\.0\.0\.0$/,
    ];
    if (blocked.some((re) => re.test(hostname))) {
      throw new Error("Custom provider base URL must not point to private/internal network.");
    }
  }
  if (parsed.protocol !== "https:") {
    throw new Error("Custom provider base URL must use HTTPS.");
  }
}

async function executeOpenAI(args: {
  apiKey: string;
  baseUrl: string | null;
  model: string;
  systemPrompt: string;
  userInput: string;
  timeoutMs: number;
}): Promise<{ outputText: string; latencyMs: number; tokenCount: number; provider: string; model: string }> {
  const base = (args.baseUrl ?? "https://api.openai.com").replace(/\/$/, "");
  const url = `${base}/v1/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("OpenAI timeout"), args.timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify({
        model: args.model,
        messages: [
          ...(args.systemPrompt ? [{ role: "system", content: args.systemPrompt }] : []),
          { role: "user", content: args.userInput },
        ],
        // o1 / o3 / o4 reasoning models require max_completion_tokens; all others use max_tokens
        ...(/^o\d/i.test(args.model ?? "") ? { max_completion_tokens: 2048 } : { max_tokens: 2048 }),
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`OpenAI returned ${response.status}: ${errBody.slice(0, 200)}`);
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
      model?: string;
    };
    const outputText = body.choices?.[0]?.message?.content ?? "";
    const tokenCount = body.usage?.total_tokens ?? 0;
    return { outputText, latencyMs, tokenCount, provider: "openai", model: body.model ?? args.model };
  } finally {
    clearTimeout(timer);
  }
}

async function executeAnthropic(args: {
  apiKey: string;
  baseUrl: string | null;
  model: string;
  systemPrompt: string;
  userInput: string;
  timeoutMs: number;
}): Promise<{ outputText: string; latencyMs: number; tokenCount: number; provider: string; model: string }> {
  const base = (args.baseUrl ?? "https://api.anthropic.com").replace(/\/$/, "");
  const url = `${base}/v1/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("Anthropic timeout"), args.timeoutMs);
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": args.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: 2048,
        ...(args.systemPrompt ? { system: args.systemPrompt } : {}),
        messages: [{ role: "user", content: args.userInput }],
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(`Anthropic returned ${response.status}: ${errBody.slice(0, 200)}`);
    }
    const body = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    const outputText = body.content?.find((c) => c.type === "text")?.text ?? "";
    const tokenCount = (body.usage?.input_tokens ?? 0) + (body.usage?.output_tokens ?? 0);
    return { outputText, latencyMs, tokenCount, provider: "anthropic", model: body.model ?? args.model };
  } finally {
    clearTimeout(timer);
  }
}

async function executeGemini(args: {
  apiKey: string;
  baseUrl: string | null;
  model: string;
  systemPrompt: string;
  userInput: string;
  timeoutMs: number;
}): Promise<{ outputText: string; latencyMs: number; tokenCount: number; provider: string; model: string }> {
  const modelName = args.model || "gemini-1.5-flash";
  const base = (args.baseUrl ?? "https://generativelanguage.googleapis.com").replace(/\/$/, "");
  const url = `${base}/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${args.apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("Gemini timeout"), args.timeoutMs);
  const started = Date.now();
  try {
    const parts: Array<{ text: string }> = [];
    if (args.systemPrompt) parts.push({ text: `System: ${args.systemPrompt}\n\n` });
    parts.push({ text: args.userInput });
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
      }),
      signal: controller.signal,
      cache: "no-store",
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      throw new Error(
        `Gemini returned ${response.status}: ${errBody.replace(/key=[^&\s"]+/gi, "key=REDACTED").slice(0, 200)}`,
      );
    }
    const body = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { totalTokenCount?: number };
    };
    const outputText = body.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const tokenCount = body.usageMetadata?.totalTokenCount ?? 0;
    return { outputText, latencyMs, tokenCount, provider: "google", model: modelName };
  } finally {
    clearTimeout(timer);
  }
}

export async function executeResolvedPrompt(input: ResolvedExecutionRequest): Promise<ExecutionResult> {
  const started = Date.now();
  const source = normalizeTraceMetadataV1(input.sourceMetadata ?? {});
  let executor = resolveExecutor(input);
  let status: ExecutionResult["status"] = "success";
  let outputText = "";
  let rawOutputText: string | undefined;
  let downstreamLatencyMs = 0;
  let tokenCount = asNumber(source.model?.total_tokens, 0);
  let provider =
    input.providerConfig?.providerType ??
    asString(input.executorOverride?.provider) ??
    asString(source.model?.provider) ??
    undefined;
  let model =
    asString(input.executorOverride?.model) ??
    input.providerConfig?.model ??
    asString(source.model?.model) ??
    undefined;
  let errorMessage: string | undefined;

  try {
    if (executor.type === "enterprise_gateway") {
      const gateway = await executeGateway(input, executor);
      outputText = gateway.outputText;
      rawOutputText = gateway.rawOutputText;
      downstreamLatencyMs = gateway.latencyMs;
      tokenCount = gateway.tokenCount || tokenCount;
      provider = gateway.provider ?? provider;
      model = gateway.model ?? model;
    } else if (input.providerConfig) {
      const cfg = input.providerConfig;
      if (cfg.baseUrl) assertSafeProviderBaseUrl(cfg.baseUrl);
      const liveModel = asString(input.executorOverride?.model) ?? cfg.model ?? "gpt-4o-mini";
      const timeoutMs = 30_000;
      const systemPrompt = input.renderedPrompt || input.templateText;
      const userInput = input.inputText;
      let liveResult: { outputText: string; latencyMs: number; tokenCount: number; provider: string; model: string };
      if (cfg.providerType === "openai") {
        liveResult = await executeOpenAI({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: liveModel, systemPrompt, userInput, timeoutMs });
      } else if (cfg.providerType === "anthropic") {
        liveResult = await executeAnthropic({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: liveModel, systemPrompt, userInput, timeoutMs });
      } else if (cfg.providerType === "google" || cfg.providerType === "gemini") {
        liveResult = await executeGemini({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl, model: liveModel, systemPrompt, userInput, timeoutMs });
      } else if (cfg.providerType === "qwen") {
        liveResult = await executeOpenAI({ apiKey: cfg.apiKey, baseUrl: cfg.baseUrl ?? "https://dashscope-intl.aliyuncs.com/compatible-mode", model: liveModel, systemPrompt, userInput, timeoutMs });
        liveResult = { ...liveResult, provider: "qwen" };
      } else {
        throw new Error(`Live execution for provider type '${cfg.providerType}' is not yet implemented.`);
      }
      outputText = liveResult.outputText;
      downstreamLatencyMs = liveResult.latencyMs;
      tokenCount = liveResult.tokenCount;
      provider = liveResult.provider;
      model = liveResult.model;
      executor = {
        ...executor,
        type: "direct_provider" as ExecutorType,
        name: cfg.providerType,
        ownership: "customer",
        request_mode: "direct",
        response_observability: "full",
      };
    } else {
      outputText = renderFallbackOutput(input);
      downstreamLatencyMs = asNumber(source.model?.latency_ms, 0);
      provider = asString(input.executorOverride?.provider) ?? provider;
      model = asString(input.executorOverride?.model) ?? model;
      if (!outputText) status = "partial";
    }
  } catch (error) {
    status = "error";
    errorMessage = error instanceof Error ? error.message : "Executor failed.";
    outputText = errorMessage;
  }

  const proxyLatencyMs = Date.now() - started;
  const now = new Date().toISOString();
  const metadata = buildTraceMetadataV1({
    metadata: {
      ...source,
      trace: {
        ...(source.trace ?? {}),
        status,
        started_at: now,
        duration_ms: proxyLatencyMs + downstreamLatencyMs,
        request_id: `exec_${crypto.randomUUID()}`,
      },
      executor,
      request: {
        ...(source.request ?? {}),
        source: input.replayOf ? "trace_replay" : source.request?.source,
        input: {
          ...(asRecord(source.request?.input)),
          text: input.inputText,
          variables: input.variables,
        },
      },
      prompt: {
        ...(source.prompt ?? {}),
        prompt_version_id: input.promptVersionId ?? undefined,
        name: input.promptName,
        version_tag: input.versionTag,
        variables: input.variables,
        resolved: {
          ...(asRecord(source.prompt?.resolved)),
          user: input.renderedPrompt || undefined,
        },
      },
      model: {
        ...(source.model ?? {}),
        provider,
        model,
        latency_ms: downstreamLatencyMs,
        total_tokens: tokenCount,
      },
      cache: input.replayOf
        ? {
            ...(source.cache ?? {}),
            enabled: source.cache?.enabled ?? false,
            status: "skipped",
            latency_ms: 0,
          }
        : {
            ...(source.cache ?? {}),
          },
      output: {
        ...(source.output ?? {}),
        raw_text: rawOutputText,
        final_text: outputText,
      },
      spans: [
        {
          span_id: "root",
          name: input.replayOf ? "trace replay" : "execution",
          type: "root",
          component: "vectorbea-runtime",
          status,
          start_offset_ms: 0,
          duration_ms: proxyLatencyMs + downstreamLatencyMs,
        },
        {
          span_id: "prompt-resolve",
          parent_span_id: "root",
          name: "prompt resolution",
          type: "prompt_resolve",
          component: "vectorbea-control-plane",
          status: "success",
          start_offset_ms: 0,
          duration_ms: Math.max(proxyLatencyMs, 1),
        },
        {
          span_id: "executor",
          parent_span_id: "root",
          name: executor.type === "enterprise_gateway" ? "enterprise gateway call" : "executor dispatch",
          type: executor.type === "enterprise_gateway" ? "llm" : "model_select",
          component: executor.name ?? "executor",
          status,
          start_offset_ms: Math.max(proxyLatencyMs, 0),
          duration_ms: Math.max(downstreamLatencyMs, 1),
          metadata: {
            executor_type: executor.type,
            observability: executor.response_observability,
            ...(errorMessage ? { error: errorMessage } : {}),
          },
        },
      ],
      logs: [
        ...(Array.isArray(source.logs) ? source.logs : []),
        {
          timestamp: now,
          level: status === "error" ? "error" : "info",
          component: "executor",
          message: errorMessage ?? `Execution completed through ${executor.type}`,
          span_id: "executor",
        },
      ],
      tags: {
        ...(source.tags ?? {}),
        ...(input.replayOf
          ? {
              replay_of: input.replayOf,
              replay_mode: (input.providerConfig || executor.type === "enterprise_gateway") ? "live" : "simulated",
              replay_provider: provider ?? executor.name ?? "unknown",
              original_provider: asString(source.model?.provider) ?? source.executor?.name ?? "unknown",
              ...(input.providerConfig ? { provider_config_id: input.providerConfig.configId } : {}),
            }
          : {}),
      },
      custom: {
        ...(source.custom ?? {}),
        ...(input.replayOf
          ? {
              replay: {
                source_trace_id: input.replayOf,
                replay_mode: (input.providerConfig || executor.type === "enterprise_gateway") ? "live" : "simulated",
                source_executor_type: source.executor?.type ?? executor.type,
                original_provider: asString(source.model?.provider) ?? source.executor?.name ?? null,
                replay_provider: provider ?? executor.name ?? null,
                original_model: asString(source.model?.model),
                replay_model: model ?? null,
                triggered_by: input.triggeredBy,
              },
            }
          : {}),
      },
    },
    useType: "runtime",
    workspaceId: input.workspaceId,
    promptVersionId: input.promptVersionId,
    promptName: input.promptName,
    versionTag: input.versionTag,
    proxyLatencyMs,
    llmLatencyMs: downstreamLatencyMs,
    tokenCount,
  });

  return {
    status,
    outputText,
    rawOutputText,
    llmLatencyMs: downstreamLatencyMs,
    proxyLatencyMs,
    tokenCount,
    provider,
    model,
    executor,
    metadata,
  };
}
