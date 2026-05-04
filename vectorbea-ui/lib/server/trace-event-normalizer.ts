import "server-only";

import type { WorkflowStepType } from "@/lib/api";
import { redactPayload } from "@/lib/server/security";

// ─── Supported ingest event types ─────────────────────────────────────────────
// Includes aliases — all are normalized to WorkflowStepType internally.

type IngestSpanType =
  | "agent_run_started"
  | "agent_run_finished"
  | "agent_run_completed"
  | "agent_run_failed"
  // LLM calls
  | "llm_call" | "llm"
  // Tool / MCP calls
  | "tool_call" | "tool" | "mcp_tool_call" | "mcp"
  // Retrieval
  | "retrieval" | "rag_retrieve" | "rag_retrieval"
  // Skill execution
  | "skill_execution" | "skill"
  // Classification
  | "classification"
  // Extraction
  | "extraction"
  // Other
  | "rerank"
  | "decision"
  | "final_response"
  | "error"
  | "human_handoff"
  | "custom_event"
  // OTel span type inferred from vectorbea.step_type attribute
  | "otel_span";

// ─── Raw event type ───────────────────────────────────────────────────────────

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
  chunks?: unknown[];
  scores?: number[];
  selected_context?: string;
  retrieved_count?: number;
  latency_ms?: number;
  cost_estimate?: number;
  tokens?: { prompt?: number; completion?: number; total?: number };
  tokens_input?: number;
  tokens_output?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── Normalized types ─────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function getMeta(event: RawTraceEvent): Record<string, unknown> {
  return asObject(event.metadata) ?? {};
}

// ─── Field extractors with full alias chains ──────────────────────────────────

/**
 * Resolve the effective step type from an event.
 * Checks vectorbea.step_type (with dot and underscore variants) in metadata
 * before falling back to the event.type field.
 */
function resolveStepType(event: RawTraceEvent): string {
  const meta = getMeta(event);
  // Support both "vectorbea.step_type" and "vectorbea.step.type"
  const vbStepType =
    asString(meta["vectorbea.step_type"]) ??
    asString(meta["vectorbea.step.type"]) ??
    asString(meta["vectorbea_step_type"]);
  if (vbStepType) return vbStepType;
  return asString(event.type) ?? "custom_event";
}

function normalizeProvider(event: RawTraceEvent): string | null {
  const meta = getMeta(event);
  return (
    asString(event.provider) ??
    asString(meta.provider) ??
    asString(meta["gen_ai.system"]) ??
    asString(meta.gen_ai_system) ??
    asString(meta["llm.vendor"]) ??
    asString(meta.llm_vendor) ??
    asString(meta.ai_provider) ??
    asString(meta.openai_provider) ??
    null
  );
}

function normalizeModel(event: RawTraceEvent): string | null {
  const meta = getMeta(event);
  return (
    asString(event.model) ??
    asString(event.model_name) ??
    asString(meta.model) ??
    asString(meta.model_name) ??
    asString(meta["gen_ai.request.model"]) ??
    asString(meta.gen_ai_request_model) ??
    asString(meta["gen_ai.response.model"]) ??
    asString(meta.gen_ai_response_model) ??
    asString(meta["llm.model"]) ??
    asString(meta["llm.model_name"]) ??
    asString(meta.llm_model_name) ??
    asString(meta["ai.model"]) ??
    asString(meta.ai_model) ??
    asString(meta["openai.model"]) ??
    asString(meta.openai_model) ??
    null
  );
}

function normalizeToolName(event: RawTraceEvent): string | null {
  const meta = getMeta(event);
  return (
    asString(event.tool_name) ??
    asString(event.tool) ??
    asString(event.function_name) ??
    // OTel attribute style
    asString(meta["tool.name"]) ??
    asString(meta["vectorbea.tool.name"]) ??
    asString(meta["mcp.tool_name"]) ??
    asString(meta["mcp.tool.name"]) ??
    asString(meta.mcp_tool_name) ??
    asString(meta.tool_name) ??
    asString(meta.tool) ??
    asString(meta.function_name) ??
    // fall through to event.name only for non-run events
    asString(event.name) ??
    null
  );
}

function normalizeMcpServer(event: RawTraceEvent): string | null {
  const meta = getMeta(event);
  return (
    asString(event.mcp_server_name) ??
    asString(event.mcp_server) ??
    asString(event.server) ??
    // OTel attribute style
    asString(meta["mcp.server_name"]) ??
    asString(meta["mcp.server.name"]) ??
    asString(meta["vectorbea.mcp.server.name"]) ??
    asString(meta["vectorbea.mcp.server_name"]) ??
    asString(meta.mcp_server_name) ??
    asString(meta.mcp_server) ??
    asString(meta.server) ??
    null
  );
}

function normalizeInput(event: RawTraceEvent): unknown {
  const meta = getMeta(event);
  return event.input ?? meta.input ?? meta.request ?? null;
}

function normalizeOutput(event: RawTraceEvent): unknown {
  const meta = getMeta(event);
  return event.output ?? event.response ?? event.result ?? meta.output ?? meta.response ?? null;
}

function normalizeToolArgs(event: RawTraceEvent): Record<string, unknown> | null {
  const meta = getMeta(event);
  return (
    asObject(event.arguments) ??
    asObject(event.args) ??
    asObject(meta["tool.arguments"]) ??
    asObject(meta["mcp.tool_arguments"]) ??
    asObject(meta["vectorbea.tool.arguments"]) ??
    asObject(meta.arguments) ??
    asObject(meta.args) ??
    asObject(event.input) ??
    asObject(meta.input) ??
    null
  );
}

function normalizeToolResult(event: RawTraceEvent): Record<string, unknown> | null {
  const meta = getMeta(event);
  return (
    asObject(event.result) ??
    asObject(event.output) ??
    asObject(event.response) ??
    asObject(meta["tool.result"]) ??
    asObject(meta["tool.result_summary"]) ??
    asObject(meta["mcp.tool_result"]) ??
    asObject(meta.result) ??
    asObject(meta.output) ??
    null
  );
}

function normalizeStatus(rawStatus: string | null | undefined): "running" | "completed" | "failed" | "skipped" {
  switch ((rawStatus ?? "").toLowerCase()) {
    case "running": return "running";
    case "failed": case "error": case "timeout": return "failed";
    case "skipped": return "skipped";
    default: return "completed";
  }
}

function normalizeTokens(event: RawTraceEvent): { input: number | null; output: number | null } {
  const meta = getMeta(event);
  const tokens = asObject(event.tokens) ?? {};

  const input = Number(
    event.tokens_input ??
    tokens.prompt ??
    meta.prompt_tokens ??
    meta["gen_ai.usage.input_tokens"] ??
    meta["gen_ai.usage.prompt_tokens"] ??
    meta.gen_ai_usage_input_tokens ??
    meta["llm.usage.prompt_tokens"] ??
    meta["usage.prompt_tokens"] ??
    meta.input_tokens ??
    meta.tokens_input ??
    0,
  );
  const output = Number(
    event.tokens_output ??
    tokens.completion ??
    meta.completion_tokens ??
    meta["gen_ai.usage.output_tokens"] ??
    meta["gen_ai.usage.completion_tokens"] ??
    meta.gen_ai_usage_output_tokens ??
    meta["llm.usage.completion_tokens"] ??
    meta["usage.completion_tokens"] ??
    meta.output_tokens ??
    meta.tokens_output ??
    0,
  );
  return {
    input: Number.isFinite(input) && input > 0 ? input : null,
    output: Number.isFinite(output) && output > 0 ? output : null,
  };
}

/** Extract classification-specific output fields from event or OTel attributes. */
function normalizeClassificationOutput(event: RawTraceEvent): Record<string, unknown> {
  const meta = getMeta(event);
  const outputRaw = asObject(normalizeOutput(event)) ?? {};

  return {
    label:
      asString(outputRaw.label) ??
      asString(meta["classification.label"]) ??
      asString(meta.classification_label) ??
      asString(meta.label) ??
      null,
    confidence:
      typeof outputRaw.confidence === "number" ? outputRaw.confidence :
      typeof meta["classification.confidence"] === "number" ? meta["classification.confidence"] :
      typeof meta.classification_confidence === "number" ? meta.classification_confidence :
      typeof meta.confidence === "number" ? meta.confidence :
      null,
    threshold:
      typeof outputRaw.threshold === "number" ? outputRaw.threshold :
      typeof meta["classification.threshold"] === "number" ? meta["classification.threshold"] :
      typeof meta.classification_threshold === "number" ? meta.classification_threshold :
      null,
    system:
      asString(outputRaw.system) ??
      asString(meta["classification.system"]) ??
      asString(meta.classification_system) ??
      null,
    allowedLabels:
      Array.isArray(outputRaw.allowed_labels) ? outputRaw.allowed_labels :
      Array.isArray(meta["classification.allowed_labels"]) ? meta["classification.allowed_labels"] :
      null,
    // Carry through the full output
    ...outputRaw,
  };
}

/** Extract extraction-specific output fields from event or OTel attributes. */
function normalizeExtractionOutput(event: RawTraceEvent): Record<string, unknown> {
  const meta = getMeta(event);
  const outputRaw = asObject(normalizeOutput(event)) ?? {};

  const missingFields =
    Array.isArray(outputRaw.missing_fields) ? outputRaw.missing_fields :
    (() => {
      const raw = meta["extraction.missing_fields"];
      if (typeof raw === "string") {
        try { return JSON.parse(raw); } catch { return raw ? [raw] : []; }
      }
      return Array.isArray(raw) ? raw : [];
    })();

  return {
    schema:
      asString(outputRaw.schema) ??
      asString(meta["extraction.schema"]) ??
      asString(meta.extraction_schema) ??
      null,
    fieldCount:
      typeof outputRaw.field_count === "number" ? outputRaw.field_count :
      typeof meta["extraction.field_count"] === "number" ? meta["extraction.field_count"] :
      (Array.isArray(outputRaw.extracted_fields) ? outputRaw.extracted_fields.length : null),
    schemaValid:
      typeof outputRaw.schema_valid === "boolean" ? outputRaw.schema_valid :
      meta["extraction.schema_valid"] === true ? true :
      meta["extraction.schema_valid"] === false ? false :
      null,
    missingFields,
    extractedFields: Array.isArray(outputRaw.extracted_fields) ? outputRaw.extracted_fields : null,
    requiredFields: Array.isArray(outputRaw.required_fields) ? outputRaw.required_fields : null,
    // Carry through the full output
    ...outputRaw,
  };
}

// ─── buildFinalResponseStep ────────────────────────────────────────────────────

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
      finalAction: asString(event.final_action) ?? asString(meta.final_action),
      outcomeStatus:
        asString(event.outcome_status) ??
        asString(meta.outcome_status) ??
        asString(meta["vectorbea.outcome_status"]) ??
        null,
      outcomeReason: asString(event.outcome_reason) ?? asString(meta.outcome_reason),
      finalBusinessOutcome: asString(meta.final_business_outcome),
      finalResponse,
      sourceType: event.type ?? "final_response",
    },
  };
}

// ─── normalizeTraceEvent ───────────────────────────────────────────────────────

export function normalizeTraceEvent(event: RawTraceEvent, stepIndex: number): NormalizedTraceStep | null {
  const effectiveType = resolveStepType(event) as IngestSpanType;
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
    sourceType: event.type ?? effectiveType,
  } satisfies Record<string, unknown>;

  switch (effectiveType) {
    // ── LLM call ──────────────────────────────────────────────────────────────
    case "llm_call":
    case "llm":
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
        },
      };

    // ── Tool call ─────────────────────────────────────────────────────────────
    case "tool_call":
    case "tool":
      return {
        stepIndex,
        stepType: "tool_call",
        stepName: normalizeToolName(event) ?? "tool_call",
        toolName: normalizeToolName(event),
        toolArguments: normalizeToolArgs(event) ? safeRedact(normalizeToolArgs(event)) : {},
        toolResult: normalizeToolResult(event) ? safeRedact(normalizeToolResult(event)) : {},
        outputPayload: asObject(normalizeOutput(event))
          ? safeRedact(normalizeOutput(event))
          : (asString(meta["tool.result_summary"]) ? { summary: meta["tool.result_summary"] } : {}),
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        costEstimate: typeof event.cost_estimate === "number" ? event.cost_estimate : null,
        errorMessage: asString(event.error_message) ?? asString(event.error) ?? null,
        metadata: { ...baseMetadata },
      };

    // ── MCP tool call ─────────────────────────────────────────────────────────
    case "mcp_tool_call":
    case "mcp":
      return {
        stepIndex,
        stepType: "mcp_tool_call",
        stepName: normalizeToolName(event) ?? "mcp_tool_call",
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
          mcpServer: normalizeMcpServer(event),
        },
      };

    // ── Retrieval / RAG ───────────────────────────────────────────────────────
    case "retrieval":
    case "rag_retrieve":
    case "rag_retrieval": {
      const docs = asArray(event.documents ?? event.chunks ?? meta.documents ?? meta.chunks);
      const retrievedCount =
        typeof event.retrieved_count === "number" ? event.retrieved_count :
        typeof meta.retrieved_count === "number" ? meta.retrieved_count :
        typeof meta["rag.retrieved_count"] === "number" ? meta["rag.retrieved_count"] :
        docs.length;
      return {
        stepIndex,
        stepType: "rag_retrieval",
        stepName: asString(meta["rag.vector_store"]) ?? asString(meta.vector_store) ?? "retrieval",
        inputPayload: safeRedact({ query: event.query ?? meta.query ?? null }),
        outputPayload: safeRedact({
          retrievedCount,
          documents: docs,
          scores: asArray(event.scores ?? meta.scores),
          selectedContext: event.selected_context ?? meta.selected_context ?? null,
          sourceIds: Array.isArray(meta.source_ids) ? meta.source_ids : null,
        }),
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        errorMessage: asString(event.error_message) ?? null,
        metadata: {
          ...baseMetadata,
          query: event.query ?? meta.query ?? null,
          retrievedCount,
          selectedContext: event.selected_context ?? meta.selected_context ?? null,
          vectorStore: asString(meta["rag.vector_store"]) ?? asString(meta.vector_store),
          embeddingModel: asString(meta["rag.query_embedding_model"]) ?? asString(meta.embedding_model),
        },
      };
    }

    // ── Skill execution ───────────────────────────────────────────────────────
    case "skill_execution":
    case "skill":
      return {
        stepIndex,
        stepType: "skill_execution",
        stepName: normalizeToolName(event) ?? asString(meta.skill_name) ?? "skill_execution",
        toolName: normalizeToolName(event) ?? asString(meta.skill_name),
        inputPayload: normalizeInput(event) != null ? safeRedact(normalizeInput(event)) : {},
        outputPayload: normalizeOutput(event) != null ? safeRedact(normalizeOutput(event)) : {},
        toolArguments: normalizeToolArgs(event) ? safeRedact(normalizeToolArgs(event)) : {},
        toolResult: normalizeToolResult(event) ? safeRedact(normalizeToolResult(event)) : {},
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        errorMessage: asString(event.error_message) ?? asString(event.error) ?? null,
        metadata: { ...baseMetadata },
      };

    // ── Classification ────────────────────────────────────────────────────────
    case "classification": {
      const classOutput = normalizeClassificationOutput(event);
      return {
        stepIndex,
        stepType: "classification",
        stepName:
          asString(classOutput.system) ??
          asString(meta["classification.system"]) ??
          asString(event.name) ??
          "classification",
        outputPayload: safeRedact(classOutput),
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        errorMessage: asString(event.error_message) ?? asString(event.error) ?? null,
        metadata: {
          ...baseMetadata,
          classificationLabel: classOutput.label,
          classificationConfidence: classOutput.confidence,
          classificationThreshold: classOutput.threshold,
          classificationSystem: classOutput.system,
        },
      };
    }

    // ── Extraction ────────────────────────────────────────────────────────────
    case "extraction": {
      const extOutput = normalizeExtractionOutput(event);
      return {
        stepIndex,
        stepType: "extraction",
        stepName: asString(extOutput.schema) ?? asString(event.name) ?? "extraction",
        outputPayload: safeRedact(extOutput),
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        errorMessage: asString(event.error_message) ?? asString(event.error) ?? null,
        metadata: {
          ...baseMetadata,
          extractionSchema: extOutput.schema,
          schemaValid: extOutput.schemaValid,
          missingFields: extOutput.missingFields,
          fieldCount: extOutput.fieldCount,
        },
      };
    }

    // ── Rerank ────────────────────────────────────────────────────────────────
    case "rerank":
      return {
        stepIndex,
        stepType: "reranker",
        stepName: "rerank",
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        errorMessage: asString(event.error_message) ?? null,
        metadata: { ...baseMetadata, rerankerScore: meta.reranker_score ?? null },
      };

    // ── Decision ──────────────────────────────────────────────────────────────
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

    // ── Human handoff ─────────────────────────────────────────────────────────
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

    // ── Error ─────────────────────────────────────────────────────────────────
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

    // ── Final response / run completed ────────────────────────────────────────
    case "final_response":
    case "agent_run_finished":
    case "agent_run_completed":
    case "agent_run_failed":
      return buildFinalResponseStep(event, stepIndex);

    // ── Custom / unknown / agent_run_started ──────────────────────────────────
    case "custom_event":
      return {
        stepIndex,
        stepType: "system_event",
        stepName: asString(event.name) ?? "custom_event",
        status: normalizeStatus(asString(event.status)),
        latencyMs: typeof event.latency_ms === "number" ? event.latency_ms : null,
        outputPayload: normalizeOutput(event) != null ? safeRedact(normalizeOutput(event)) : {},
        metadata: { ...baseMetadata, ...meta },
      };

    case "agent_run_started":
    default:
      return null;
  }
}

// ─── buildNormalizedTraceEnvelope ─────────────────────────────────────────────

export function buildNormalizedTraceEnvelope(
  events: RawTraceEvent[],
  extraMetadata?: Record<string, unknown>,
): NormalizedTraceEnvelope {
  const normalizedSteps = events
    .map((event, index) => normalizeTraceEvent(event, index))
    .filter((step): step is NormalizedTraceStep => step !== null);

  const startEvent = events.find((e) => (asString(e.type) ?? "") === "agent_run_started");
  const finalEvent = [...events].reverse().find((e) => {
    const t = asString(e.type) ?? "";
    return t === "final_response" || t === "agent_run_finished" || t === "agent_run_completed" || t === "agent_run_failed";
  });
  const firstLlm = normalizedSteps.find((s) => s.stepType === "llm_call");

  const totalLatency = normalizedSteps.reduce((sum, s) => sum + (s.latencyMs ?? 0), 0);
  const totalCost = normalizedSteps.reduce((sum, s) => sum + (s.costEstimate ?? 0), 0);
  const totalTokensInput = normalizedSteps.reduce((sum, s) => sum + (s.tokensInput ?? 0), 0);
  const totalTokensOutput = normalizedSteps.reduce((sum, s) => sum + (s.tokensOutput ?? 0), 0);

  const finalMeta = getMeta(finalEvent ?? {});
  const startMeta = getMeta(startEvent ?? {});

  const finalResponse =
    asString(finalEvent?.final_response) ??
    asString(finalEvent?.response) ??
    asString(finalEvent?.output) ??
    asString(finalEvent?.result) ??
    asString(finalMeta.final_response) ??
    null;

  // Resolve outcome status — check vectorbea.outcome_status attribute too
  const outcomeStatus =
    asString(finalEvent?.outcome_status) ??
    asString(finalMeta.outcome_status) ??
    asString(finalMeta["vectorbea.outcome_status"]) ??
    null;

  return {
    userInput:
      asString(startMeta.user_input) ??
      asString(startMeta.input) ??
      asString(startMeta["vectorbea.user_input"]) ??
      asString(startEvent?.input) ??
      null,
    finalResponse,
    finalAction: asString(finalEvent?.final_action) ?? asString(finalMeta.final_action) ?? null,
    outcomeStatus,
    outcomeReason: asString(finalEvent?.outcome_reason) ?? asString(finalMeta.outcome_reason) ?? null,
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

// ─── OTel span → RawTraceEvent converter ─────────────────────────────────────
// Accepts a flat attribute dict (from OTLP JSON or OTel collector JSON export)
// and converts it to a RawTraceEvent for use with the normalizer above.

interface OtelAttribute {
  key: string;
  value: { stringValue?: string; intValue?: number | string; doubleValue?: number; boolValue?: boolean; arrayValue?: unknown };
}

interface OtelSpan {
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string | number;
  endTimeUnixNano?: string | number;
  status?: { code?: number; message?: string };
  attributes?: OtelAttribute[];
}

function readOtelAttr(attrs: OtelAttribute[], key: string): string | number | boolean | null {
  const attr = attrs.find((a) => a.key === key);
  if (!attr) return null;
  const v = attr.value;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.intValue !== undefined) return Number(v.intValue);
  if (v.boolValue !== undefined) return v.boolValue;
  return null;
}

function otelStatusToOutcome(statusCode: number | undefined): string | null {
  if (statusCode === 2) return "failed";
  if (statusCode === 1) return "success";
  return null;
}

export function otelSpanToRawTraceEvent(
  span: OtelSpan,
  resourceAttrs: OtelAttribute[],
): RawTraceEvent {
  const spanAttrs = span.attributes ?? [];
  const allAttrs = [...resourceAttrs, ...spanAttrs];

  function attr(key: string) { return readOtelAttr(allAttrs, key); }

  const startNs = Number(span.startTimeUnixNano ?? 0);
  const endNs = Number(span.endTimeUnixNano ?? 0);
  const latencyMs = startNs > 0 && endNs > 0 ? Math.round((endNs - startNs) / 1_000_000) : undefined;

  // Collect all attributes into metadata for alias resolution
  const metadata: Record<string, unknown> = {};
  for (const a of allAttrs) {
    const v = readOtelAttr(allAttrs, a.key);
    if (v !== null) metadata[a.key] = v;
  }

  // Determine event type: check vectorbea.step_type, then span name
  const vbStepType =
    (attr("vectorbea.step_type") as string | null) ??
    (attr("vectorbea.step.type") as string | null);

  const spanName = span.name ?? "otel_span";

  // Map span status to outcome
  const statusCode = span.status?.code;
  const outcomeStatus =
    (attr("vectorbea.outcome_status") as string | null) ??
    otelStatusToOutcome(statusCode);

  return {
    type: vbStepType ?? spanName,
    span_id: span.spanId,
    parent_span_id: span.parentSpanId ?? undefined,
    timestamp: startNs > 0 ? new Date(startNs / 1_000_000).toISOString() : new Date().toISOString(),
    latency_ms: latencyMs,
    status: span.status?.message ?? (statusCode === 2 ? "error" : "completed"),
    outcome_status: outcomeStatus ?? undefined,
    metadata,
  };
}

/**
 * Convert an OTLP JSON trace payload into an array of RawTraceEvents.
 * Accepts the standard OTLP HTTP JSON format:
 * { resourceSpans: [{ resource: { attributes }, scopeSpans: [{ spans }] }] }
 */
export function otlpJsonToRawTraceEvents(body: Record<string, unknown>): {
  workspaceId: string | null;
  capabilityName: string | null;
  serviceName: string | null;
  environment: string | null;
  events: RawTraceEvent[];
} {
  const resourceSpans = Array.isArray(body.resourceSpans) ? body.resourceSpans : [];
  const allEvents: RawTraceEvent[] = [];

  let workspaceId: string | null = null;
  let capabilityName: string | null = null;
  let serviceName: string | null = null;
  let environment: string | null = null;

  for (const rs of resourceSpans) {
    const rsObj = asObject(rs) ?? {};
    const resource = asObject(rsObj.resource) ?? {};
    const resourceAttrs: OtelAttribute[] = Array.isArray(resource.attributes) ? resource.attributes : [];

    // Extract workspace-level metadata from resource attributes
    const readRes = (key: string) => readOtelAttr(resourceAttrs, key);
    workspaceId = workspaceId ?? (readRes("vectorbea.workspace_id") as string | null);
    capabilityName =
      capabilityName ??
      (readRes("vectorbea.capability_name") as string | null) ??
      (readRes("vectorbea.ai_system.name") as string | null) ??
      (readRes("vectorbea.capability.name") as string | null);
    serviceName = serviceName ?? (readRes("service.name") as string | null);
    environment =
      environment ??
      (readRes("vectorbea.environment") as string | null) ??
      (readRes("deployment.environment") as string | null);

    const scopeSpans = Array.isArray(rsObj.scopeSpans) ? rsObj.scopeSpans : [];
    for (const ss of scopeSpans) {
      const ssObj = asObject(ss) ?? {};
      const spans: OtelSpan[] = Array.isArray(ssObj.spans) ? ssObj.spans : [];
      for (const span of spans) {
        allEvents.push(otelSpanToRawTraceEvent(span, resourceAttrs));
      }
    }
  }

  return { workspaceId, capabilityName, serviceName, environment, events: allEvents };
}
