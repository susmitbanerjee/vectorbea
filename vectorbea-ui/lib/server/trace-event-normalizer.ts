import "server-only";

import type { WorkflowStepType } from "@/lib/api";
import { redactPayload } from "@/lib/server/security";

type IngestSpanType =
  | "agent_run_started"
  | "agent_run_finished"
  | "agent_run_completed"
  | "agent_run_failed"
  | "llm_call"
  | "tool_call"
  | "mcp_tool_call"
  | "rag_retrieve"
  | "rag_retrieval"
  | "rerank"
  | "decision"
  | "final_response"
  | "error"
  | "human_handoff";

export interface RawTraceEvent {
  type?: string;
  span_id?: string;
  parent_span_id?: string;
  timestamp?: string;
  provider?: string;
  model?: string;
  model_name?: string;
  prompt_version?: string;
  prompt_name?: string;
  input?: unknown;
  output?: unknown;
  response?: unknown;
  result?: unknown;
  final_response?: string;
  final_action?: string;
  outcome_status?: string;
  outcome_reason?: string;
  tool_name?: string;
  tool?: string;
  name?: string;
  function_name?: string;
  mcp_server_name?: string;
  mcp_server?: string;
  server?: string;
  arguments?: Record<string, unknown>;
  args?: Record<string, unknown>;
  status?: string;
  error_message?: string;
  error?: string | Record<string, unknown>;
  query?: string;
  documents?: unknown[];
  scores?: number[];
  selected_context?: string;
  latency_ms?: number;
  cost_estimate?: number;
  tokens?: { prompt?: number; completion?: number; total?: number };
  tokens_input?: number;
  tokens_output?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NormalizedTraceStep {
  stepIndex: number;
  stepType: WorkflowStepType;
  stepName: string;
  provider?: string | null;
  model?: string | null;
  toolName?: string | null;
  mcpServerName?: string | null;
  inputPayload?: Record<string, unknown>;
  outputPayload?: Record<string, unknown>;
  toolArguments?: Record<string, unknown>;
  toolResult?: Record<string, unknown>;
  status?: "running" | "completed" | "failed" | "skipped";
  latencyMs?: number | null;
  costEstimate?: number | null;
  tokensInput?: number | null;
  tokensOutput?: number | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown>;
}

export interface NormalizedTraceEnvelope {
  userInput: string | null;
  finalResponse: string | null;
  finalAction: string | null;
  outcomeStatus: string | null;
  outcomeReason: string | null;
  provider: string | null;
  model: string | null;
  totalLatencyMs: number | null;
  totalCostEstimate: number | null;
  totalTokensInput: number | null;
  totalTokensOutput: number | null;
  steps: NormalizedTraceStep[];
  metadata: Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeRedact(value: unknown): Record<string, unknown> {
  return redactPayload(asObject(value) ?? { value });
}

function getMeta(event: RawTraceEvent) {
  return asObject(event.metadata) ?? {};
}

function normalizeProvider(event: RawTraceEvent) {
  const meta = getMeta(event);
  return (
    asString(event.provider) ??
    asString(meta.provider) ??
    asString(meta.gen_ai_system) ??
    asString(meta["gen_ai.system"]) ??
    asString(meta.ai_provider) ??
    asString(meta.openai_provider) ??
    null
  );
}

function normalizeModel(event: RawTraceEvent) {
  const meta = getMeta(event);
  return (
    asString(event.model) ??
    asString(event.model_name) ??
    asString(meta.model) ??
    asString(meta.model_name) ??
    asString(meta["gen_ai.request.model"]) ??
    asString(meta.gen_ai_request_model) ??
    asString(meta["llm.model_name"]) ??
    asString(meta.llm_model_name) ??
    asString(meta["ai.model"]) ??
    asString(meta.ai_model) ??
    asString(meta["openai.model"]) ??
    asString(meta.openai_model) ??
    null
  );
}

function normalizeToolName(event: RawTraceEvent) {
  return (
    asString(event.tool_name) ??
    asString(event.tool) ??
    asString(event.function_name) ??
    asString(event.name) ??
    asString(getMeta(event).tool_name) ??
    asString(getMeta(event).tool) ??
    null
  );
}

function normalizeMcpServer(event: RawTraceEvent) {
  return (
    asString(event.mcp_server_name) ??
    asString(event.mcp_server) ??
    asString(event.server) ??
    asString(getMeta(event).mcp_server_name) ??
    asString(getMeta(event).mcp_server) ??
    asString(getMeta(event).server) ??
    null
  );
}

function normalizeInput(event: RawTraceEvent) {
  return event.input ?? getMeta(event).input ?? getMeta(event).request ?? null;
}

function normalizeOutput(event: RawTraceEvent) {
  return event.output ?? event.response ?? event.result ?? getMeta(event).output ?? getMeta(event).response ?? null;
}

function normalizeToolArgs(event: RawTraceEvent) {
  return event.arguments ?? event.args ?? asObject(event.input) ?? asObject(getMeta(event).arguments) ?? asObject(getMeta(event).args) ?? asObject(getMeta(event).input) ?? null;
}

function normalizeToolResult(event: RawTraceEvent) {
  return asObject(event.result) ?? asObject(event.output) ?? asObject(event.response) ?? asObject(getMeta(event).result) ?? asObject(getMeta(event).output) ?? null;
}

function normalizeStatus(rawStatus: string | null | undefined) {
  switch ((rawStatus ?? "").toLowerCase()) {
    case "running":
      return "running" as const;
    case "failed":
    case "error":
    case "timeout":
      return "failed" as const;
    case "skipped":
      return "skipped" as const;
    default:
      return "completed" as const;
  }
}

function normalizeTokens(event: RawTraceEvent) {
  const meta = getMeta(event);
  const tokens = asObject(event.tokens) ?? {};
  const input = Number(
    event.tokens_input ??
    tokens.prompt ??
    meta.prompt_tokens ??
    meta["gen_ai.usage.input_tokens"] ??
    meta.gen_ai_usage_input_tokens ??
    meta.input_tokens ??
    0,
  );
  const output = Number(
    event.tokens_output ??
    tokens.completion ??
    meta.completion_tokens ??
    meta["gen_ai.usage.output_tokens"] ??
    meta.gen_ai_usage_output_tokens ??
    meta.output_tokens ??
    0,
  );
  return {
    input: Number.isFinite(input) && input > 0 ? input : null,
    output: Number.isFinite(output) && output > 0 ? output : null,
  };
}

function buildFinalResponseStep(event: RawTraceEvent, stepIndex: number): NormalizedTraceStep {
  const meta = getMeta(event);
  const finalResponse =
    asString(event.final_response) ??
    asString(event.response) ??
    asString(event.output) ??
    asString(event.result) ??
    asString(meta.final_response) ??
    asString(meta.response) ??
    null;

  return {
    stepIndex,
    stepType: "final_response",
    stepName: asString(event.final_action) ?? "final_response",
    provider: normalizeProvider(event),
    model: normalizeModel(event),
    status: normalizeStatus(asString(event.status)),
    latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
    costEstimate: typeof event.cost_estimate === "number" ? event.cost_estimate : null,
    tokensInput: normalizeTokens(event).input,
    tokensOutput: normalizeTokens(event).output,
    outputPayload: finalResponse ? safeRedact({ finalResponse }) : {},
    errorMessage: asString(event.error_message) ?? null,
    metadata: {
      spanId: asString(event.span_id),
      parentSpanId: asString(event.parent_span_id),
      finalAction: asString(event.final_action),
      outcomeStatus: asString(event.outcome_status),
      outcomeReason: asString(event.outcome_reason),
      finalBusinessOutcome: asString(meta.final_business_outcome),
      finalResponse,
      sourceType: event.type ?? "final_response",
    },
  };
}

export function normalizeTraceEvent(event: RawTraceEvent, stepIndex: number): NormalizedTraceStep | null {
  const type = (asString(event.type) ?? "") as IngestSpanType;
  const meta = getMeta(event);
  const provider = normalizeProvider(event);
  const model = normalizeModel(event);
  const tokens = normalizeTokens(event);
  const baseMetadata = {
    spanId: asString(event.span_id),
    parentSpanId: asString(event.parent_span_id),
    promptVersion: asString(event.prompt_version) ?? asString(meta.prompt_version),
    promptName: asString(event.prompt_name) ?? asString(meta.prompt_name),
    rawInputDisabled: meta.raw_input_disabled === true,
    rawOutputDisabled: meta.raw_output_disabled === true,
    sourceType: type,
  } satisfies Record<string, unknown>;

  switch (type) {
    case "llm_call":
      return {
        stepIndex,
        stepType: "llm_call",
        stepName: model ?? provider ?? "llm_call",
        provider,
        model,
        inputPayload: normalizeInput(event) != null ? safeRedact(normalizeInput(event)) : {},
        outputPayload: normalizeOutput(event) != null ? safeRedact(normalizeOutput(event)) : {},
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        costEstimate: typeof event.cost_estimate === "number" ? event.cost_estimate : null,
        tokensInput: tokens.input,
        tokensOutput: tokens.output,
        errorMessage: asString(event.error_message) ?? asString(event.error) ?? null,
        metadata: {
          ...baseMetadata,
          temperature: meta.temperature,
          maxTokens: meta.max_tokens ?? meta.maxTokens,
          inputPayload: normalizeInput(event) != null ? safeRedact(normalizeInput(event)) : {},
          outputPayload: normalizeOutput(event) != null ? safeRedact(normalizeOutput(event)) : {},
        },
      };
    case "tool_call":
    case "mcp_tool_call":
      return {
        stepIndex,
        stepType: type,
        stepName: normalizeToolName(event) ?? type,
        toolName: normalizeToolName(event),
        mcpServerName: normalizeMcpServer(event),
        toolArguments: normalizeToolArgs(event) ? safeRedact(normalizeToolArgs(event)) : {},
        toolResult: normalizeToolResult(event) ? safeRedact(normalizeToolResult(event)) : {},
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        costEstimate: typeof event.cost_estimate === "number" ? event.cost_estimate : null,
        errorMessage: asString(event.error_message) ?? asString(event.error) ?? null,
        metadata: {
          ...baseMetadata,
          toolArguments: normalizeToolArgs(event) ? safeRedact(normalizeToolArgs(event)) : {},
          toolResult: normalizeToolResult(event) ? safeRedact(normalizeToolResult(event)) : {},
        },
      };
    case "rag_retrieve":
    case "rag_retrieval":
      return {
        stepIndex,
        stepType: "rag_retrieval",
        stepName: "rag_retrieval",
        inputPayload: safeRedact({ query: event.query ?? meta.query ?? null }),
        outputPayload: safeRedact({
          documents: asArray(event.documents ?? meta.documents),
          scores: asArray(event.scores ?? meta.scores),
          selectedContext: event.selected_context ?? meta.selected_context ?? null,
        }),
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        errorMessage: asString(event.error_message) ?? null,
        metadata: {
          ...baseMetadata,
          query: event.query ?? meta.query ?? null,
          retrievedDocumentCount: asArray(event.documents ?? meta.documents).length,
          selectedContext: event.selected_context ?? meta.selected_context ?? null,
          rerankerScore: meta.reranker_score ?? null,
        },
      };
    case "rerank":
      return {
        stepIndex,
        stepType: "reranker",
        stepName: "rerank",
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        errorMessage: asString(event.error_message) ?? null,
        metadata: {
          ...baseMetadata,
          rerankerScore: meta.reranker_score ?? null,
        },
      };
    case "decision":
      return {
        stepIndex,
        stepType: "decision",
        stepName: asString(event.name) ?? "decision",
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        metadata: {
          ...baseMetadata,
          decisionResult: meta.decision_result ?? meta.result ?? null,
          condition: meta.condition ?? null,
        },
      };
    case "human_handoff":
      return {
        stepIndex,
        stepType: "human_handoff",
        stepName: "human_handoff",
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        outputPayload: safeRedact(meta),
        metadata: {
          ...baseMetadata,
          queue: asString(meta.queue),
          reason: asString(meta.reason) ?? asString(event.outcome_reason),
          assignedUser: asString(meta.assigned_user),
        },
      };
    case "error":
      return {
        stepIndex,
        stepType: "system_event",
        stepName: "error",
        status: "failed",
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        errorMessage: asString(event.error_message) ?? asString(event.error) ?? "Error",
        metadata: {
          ...baseMetadata,
          failedStep: asString(meta.failed_step),
          retryCount: meta.retry_count ?? null,
        },
      };
    case "final_response":
    case "agent_run_finished":
    case "agent_run_completed":
    case "agent_run_failed":
      return buildFinalResponseStep(event, stepIndex);
    case "agent_run_started":
    default:
      return null;
  }
}

export function buildNormalizedTraceEnvelope(events: RawTraceEvent[], extraMetadata?: Record<string, unknown>) {
  const normalizedSteps = events
    .map((event, index) => normalizeTraceEvent(event, index))
    .filter((step): step is NormalizedTraceStep => step !== null);

  const startEvent = events.find((event) => (asString(event.type) ?? "") === "agent_run_started");
  const finalEvent = [...events].reverse().find((event) => {
    const type = asString(event.type) ?? "";
    return type === "final_response" || type === "agent_run_finished" || type === "agent_run_completed" || type === "agent_run_failed";
  });
  const firstLlm = normalizedSteps.find((step) => step.stepType === "llm_call");
  const totalLatency = normalizedSteps.reduce((sum, step) => sum + (step.latencyMs ?? 0), 0);
  const totalCost = normalizedSteps.reduce((sum, step) => sum + (step.costEstimate ?? 0), 0);
  const totalTokensInput = normalizedSteps.reduce((sum, step) => sum + (step.tokensInput ?? 0), 0);
  const totalTokensOutput = normalizedSteps.reduce((sum, step) => sum + (step.tokensOutput ?? 0), 0);
  const finalMetadata = getMeta(finalEvent ?? {});

  const finalResponse =
    asString(finalEvent?.final_response) ??
    asString(finalEvent?.response) ??
    asString(finalEvent?.output) ??
    asString(finalEvent?.result) ??
    asString(finalMetadata.final_response) ??
    null;

  return {
    userInput:
      asString(getMeta(startEvent ?? {}).user_input) ??
      asString(getMeta(startEvent ?? {}).input) ??
      asString(startEvent?.input) ??
      null,
    finalResponse,
    finalAction: asString(finalEvent?.final_action) ?? asString(finalMetadata.final_action) ?? null,
    outcomeStatus: asString(finalEvent?.outcome_status) ?? asString(finalMetadata.outcome_status) ?? null,
    outcomeReason: asString(finalEvent?.outcome_reason) ?? asString(finalMetadata.outcome_reason) ?? null,
    provider: normalizeProvider(finalEvent ?? {}) ?? firstLlm?.provider ?? null,
    model: normalizeModel(finalEvent ?? {}) ?? firstLlm?.model ?? null,
    totalLatencyMs: totalLatency > 0 ? totalLatency : null,
    totalCostEstimate: totalCost > 0 ? Number(totalCost.toFixed(6)) : null,
    totalTokensInput: totalTokensInput > 0 ? totalTokensInput : null,
    totalTokensOutput: totalTokensOutput > 0 ? totalTokensOutput : null,
    steps: normalizedSteps,
    metadata: {
      normalizedAt: new Date().toISOString(),
      ...extraMetadata,
    },
  } satisfies NormalizedTraceEnvelope;
}
