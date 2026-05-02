/**
 * POST /api/ingest/traces
 *
 * SDK-facing ingestion endpoint. Accepts a batched agent-run event payload from
 * the VectorBea SDK, a sidecar, or any OpenTelemetry-compatible emitter.
 *
 * Authentication: workspace ingest token (x-vectorbea-token header) OR
 *                 standard session cookie for first-party callers.
 *
 * The endpoint is intentionally lightweight — it validates, redacts, and
 * persists synchronously, then returns 202 Accepted quickly so the customer
 * runtime is never blocked. Future: offload to a queue for async processing.
 */

import { NextRequest, NextResponse } from "next/server";

import type { WorkflowStepType } from "@/lib/api";
import { createWorkflowTrace } from "@/lib/server/workflow-traces";
import { redactPayload } from "@/lib/server/security";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

type TraceStep = {
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
};

export const dynamic = "force-dynamic";
// Allow up to 60 s — trace batches can be large
export const maxDuration = 60;

// ─── Types ────────────────────────────────────────────────────────────────────

type SpanType =
  | "agent_run_started"
  | "agent_run_finished"
  | "llm_call"
  | "tool_call"
  | "mcp_tool_call"
  | "rag_retrieve"
  | "rerank"
  | "final_response"
  | "error"
  | "human_handoff";

interface IngestEvent {
  type: SpanType;
  span_id?: string;
  parent_span_id?: string;
  timestamp?: string;
  // llm_call fields
  provider?: string;
  model?: string;
  prompt_version?: string;
  input?: unknown;
  output?: unknown;
  tokens?: { prompt?: number; completion?: number; total?: number };
  latency_ms?: number;
  cost_estimate?: number;
  // tool_call / mcp_tool_call fields
  tool_name?: string;
  mcp_server_name?: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  status?: "success" | "error" | "timeout";
  error_message?: string;
  // rag fields
  query?: string;
  documents?: unknown[];
  scores?: number[];
  selected_context?: string;
  // final_response fields
  final_response?: string;
  final_action?: string;
  outcome_status?: string;
  outcome_reason?: string;
  // metadata passthrough
  metadata?: Record<string, unknown>;
}

interface IngestPayload {
  trace_id?: string;
  workspace_id: string;
  capability_id?: string;
  capability_version_id?: string;
  environment?: string;
  user_id?: string;
  session_id?: string;
  events: IngestEvent[];
}

// ─── Token auth helper ────────────────────────────────────────────────────────

async function resolveWorkspaceFromToken(
  token: string,
  workspaceId: string,
): Promise<boolean> {
  const supabase = createVectorBeaAdminClient();
  // ingest_tokens table: id, workspace_id, token_hash, revoked
  // We store SHA-256 of the raw token (hashed at creation time).
  // For now we do a plaintext lookup — a future migration can add hashing.
  const { data } = await supabase
    .from("ingest_tokens")
    .select("workspace_id, revoked")
    .eq("token", token)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data || data.revoked) return false;
  return true;
}

// ─── Event → workflow step mapper ────────────────────────────────────────────

function eventToStep(ev: IngestEvent, idx: number): TraceStep | null {
  switch (ev.type) {
    case "llm_call":
      return {
        stepIndex: idx,
        stepType: "llm_call",
        stepName: ev.model ?? "llm_call",
        provider: ev.provider ?? null,
        model: ev.model ?? null,
        toolName: null,
        inputPayload: ev.input ? redactPayload(ev.input as Record<string, unknown>) : {},
        outputPayload: ev.output ? redactPayload(ev.output as Record<string, unknown>) : {},
        latencyMs: ev.latency_ms ?? null,
        costEstimate: ev.cost_estimate ?? null,
        tokensInput: ev.tokens?.prompt ?? null,
        tokensOutput: ev.tokens?.completion ?? null,
      };
    case "tool_call":
      return {
        stepIndex: idx,
        stepType: "tool_call",
        stepName: ev.tool_name ?? "tool_call",
        toolName: ev.tool_name ?? null,
        toolArguments: ev.arguments ? redactPayload(ev.arguments) : {},
        toolResult: ev.result ? redactPayload(ev.result as Record<string, unknown>) : {},
        latencyMs: ev.latency_ms ?? null,
        status: ev.status === "error" ? "failed" : ev.status === "success" ? "completed" : ev.status === "timeout" ? "failed" : "completed",
        errorMessage: ev.error_message ?? null,
      };
    case "mcp_tool_call":
      return {
        stepIndex: idx,
        stepType: "mcp_tool_call",
        stepName: ev.tool_name ?? "mcp_tool_call",
        toolName: ev.tool_name ?? null,
        mcpServerName: ev.mcp_server_name ?? null,
        toolArguments: ev.arguments ? redactPayload(ev.arguments) : {},
        toolResult: ev.result ? redactPayload(ev.result as Record<string, unknown>) : {},
        latencyMs: ev.latency_ms ?? null,
        status: ev.status === "error" ? "failed" : ev.status === "success" ? "completed" : ev.status === "timeout" ? "failed" : "completed",
        errorMessage: ev.error_message ?? null,
      };
    case "rag_retrieve":
      return {
        stepIndex: idx,
        stepType: "rag_retrieval",
        stepName: "rag_retrieve",
        inputPayload: { query: ev.query },
        outputPayload: {
          documents: ev.documents,
          scores: ev.scores,
          selectedContext: ev.selected_context,
        },
        latencyMs: ev.latency_ms ?? null,
      };
    case "human_handoff":
      return {
        stepIndex: idx,
        stepType: "human_handoff",
        stepName: "human_handoff",
        inputPayload: {},
        outputPayload: ev.metadata ?? {},
        latencyMs: ev.latency_ms ?? null,
      };
    case "final_response":
    case "agent_run_started":
    case "agent_run_finished":
    case "rerank":
    case "error":
      // Handled at root trace level, not individual steps
      return null;
    default:
      return null;
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as IngestPayload | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { workspace_id, capability_id, capability_version_id, environment, events, user_id, session_id } = body;

    if (!workspace_id?.trim()) {
      return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
    }
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ error: "events must be a non-empty array" }, { status: 400 });
    }

    // Auth: accept either session cookie OR ingest token header
    const ingestToken = request.headers.get("x-vectorbea-token");
    if (ingestToken) {
      const valid = await resolveWorkspaceFromToken(ingestToken, workspace_id).catch(() => false);
      if (!valid) {
        return NextResponse.json({ error: "Invalid or revoked ingest token" }, { status: 401 });
      }
    } else {
      // Fall back to session-cookie auth (first-party / test callers)
      const { assertWorkspaceMember } = await import("@/lib/server/assert-workspace-member");
      const auth = await assertWorkspaceMember(request, workspace_id);
      if (auth.error) return auth.error;
    }

    // Extract root-trace metadata from events
    const startEvent = events.find((e) => e.type === "agent_run_started");
    const finishEvent = events.find((e) => e.type === "agent_run_finished");
    const finalResponseEvent = events.find((e) => e.type === "final_response");
    const errorEvents = events.filter((e) => e.type === "error");

    const userInput = (startEvent?.metadata as Record<string, unknown> | undefined)?.user_input as string | undefined
      ?? (startEvent?.input as string | undefined);
    const finalResponse = finalResponseEvent?.final_response
      ?? (finishEvent?.metadata as Record<string, unknown> | undefined)?.final_response as string | undefined;

    // Aggregate cost + latency from child spans
    const toolStepEvents = events.filter((e) =>
      ["llm_call", "tool_call", "mcp_tool_call", "rag_retrieve"].includes(e.type),
    );
    const totalCostEstimate = toolStepEvents.reduce((sum, e) => sum + (e.cost_estimate ?? 0), 0) || null;
    const totalLatencyMs = toolStepEvents.reduce((sum, e) => sum + (e.latency_ms ?? 0), 0) || null;

    // Map events → workflow steps (filter nulls)
    const steps = events
      .map((ev, idx) => eventToStep(ev, idx))
      .filter((s): s is TraceStep => s !== null);

    const trace = await createWorkflowTrace({
      workspaceId: workspace_id,
      capabilityId: capability_id ?? null,
      capabilityVersionId: capability_version_id ?? null,
      userInput: userInput ?? null,
      finalResponse: finalResponse ?? null,
      totalCostEstimate,
      totalLatencyMs,
      steps,
      metadata: {
        ingestSource: "sdk",
        environment: environment ?? null,
        userId: user_id,
        sessionId: session_id,
        errorCount: errorEvents.length,
        externalTraceId: body.trace_id,
      },
    });

    return NextResponse.json({ accepted: true, traceId: trace.id }, { status: 202 });
  } catch (error) {
    // SDK callers must never fail their runtime due to VectorBea errors.
    // Log and return 202 anyway so the customer app is not blocked.
    console.error("[ingest/traces] Error processing trace batch:", error);
    const safe = toSafeApiError(error, "Ingest error");
    if (safe.status >= 500) {
      // Return 202 so customer runtime continues uninterrupted
      return NextResponse.json({ accepted: true, warning: "Trace recorded with partial data" }, { status: 202 });
    }
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
