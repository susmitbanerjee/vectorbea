import "server-only";

import type { TraceMetadataV1 } from "@/lib/trace-metadata";
import { buildTraceMetadataV1, normalizeTraceMetadataV1 } from "@/lib/trace-metadata";

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
  const envType = asString(process.env.VECTORBEA_EXECUTOR_TYPE) as ExecutorType | null;
  const gatewayUrl = asString(process.env.VECTORBEA_ENTERPRISE_GATEWAY_URL);
  const gatewayEndpoint = asString(process.env.VECTORBEA_ENTERPRISE_GATEWAY_ENDPOINT);
  const type = sourceExecutor.type === "enterprise_gateway" || envType === "enterprise_gateway" || gatewayUrl
    ? "enterprise_gateway"
    : sourceExecutor.type ?? envType ?? "direct_provider";

  return {
    type,
    name:
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

  const url = endpoint?.startsWith("http")
    ? endpoint
    : `${baseUrl.replace(/\/$/, "")}/${String(endpoint ?? "/completion").replace(/^\//, "")}`;
  const authHeader = asString(process.env.VECTORBEA_ENTERPRISE_GATEWAY_AUTH_HEADER) ?? "Authorization";
  const authToken = asString(process.env.VECTORBEA_ENTERPRISE_GATEWAY_AUTH_TOKEN);
  const started = Date.now();
  const response = await fetch(url, {
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

export async function executeResolvedPrompt(input: ResolvedExecutionRequest): Promise<ExecutionResult> {
  const started = Date.now();
  const source = normalizeTraceMetadataV1(input.sourceMetadata ?? {});
  const executor = resolveExecutor(input);
  let status: ExecutionResult["status"] = "success";
  let outputText = "";
  let rawOutputText: string | undefined;
  let downstreamLatencyMs = 0;
  let tokenCount = asNumber(source.model?.total_tokens, 0);
  let provider = asString(source.model?.provider) ?? undefined;
  let model = asString(source.model?.model) ?? undefined;
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
    } else {
      outputText = renderFallbackOutput(input);
      downstreamLatencyMs = asNumber(source.model?.latency_ms, 0);
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
        ...(input.replayOf ? { replay_of: input.replayOf, replay_mode: "same_executor" } : {}),
      },
      custom: {
        ...(source.custom ?? {}),
        ...(input.replayOf
          ? {
              replay: {
                source_trace_id: input.replayOf,
                replay_mode: "same_executor",
                source_executor_type: source.executor?.type ?? executor.type,
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
