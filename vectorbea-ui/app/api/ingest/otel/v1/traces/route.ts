/**
 * POST /api/ingest/otel/v1/traces
 *
 * OTLP HTTP/JSON ingestion endpoint.
 * Accepts the standard OTLP JSON format (application/json) emitted by any
 * OpenTelemetry SDK configured with:
 *   OTEL_EXPORTER_OTLP_ENDPOINT=https://<host>/api/ingest/otel
 *   OTEL_EXPORTER_OTLP_PROTOCOL=http/json
 *   OTEL_EXPORTER_OTLP_HEADERS=x-vectorbea-ingest-token=<token>
 *
 * NOTE: Protobuf (application/x-protobuf) is NOT supported — use http/json.
 *
 * OTLP JSON body shape:
 *   {
 *     "resourceSpans": [{
 *       "resource": { "attributes": [{ "key": "...", "value": { "stringValue": "..." } }] },
 *       "scopeSpans": [{ "spans": [{ ... }] }]
 *     }]
 *   }
 *
 * Resource attributes used for routing:
 *   vectorbea.workspace_id  — required (or from ingest token)
 *   vectorbea.capability_id — optional AI system ID
 *   service.name            — used as AI system name fallback
 *   deployment.environment  — environment tag
 */

import { NextRequest, NextResponse } from "next/server";

import { authenticateIngestToken } from "@/lib/server/ingest-tokens";
import {
  recordEvidenceSourceEvent,
  resolveAiSystem,
  touchIntegrationConnection,
  upsertDiscoveredAiSystem,
} from "@/lib/server/integrations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { buildNormalizedTraceEnvelope, otlpJsonToRawTraceEvents } from "@/lib/server/trace-event-normalizer";
import { createWorkflowTrace } from "@/lib/server/workflow-traces";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(request: NextRequest) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    let tokenAuth: Awaited<ReturnType<typeof authenticateIngestToken>> | null = null;
    try {
      tokenAuth = await authenticateIngestToken(
        request.headers.get("authorization"),
        request.headers.get("x-vectorbea-ingest-token"),
        request.headers.get("x-vectorbea-token"),
      );
    } catch (authErr) {
      const err = authErr as { status?: number; message?: string };
      return NextResponse.json(
        { error: err.message ?? "Invalid ingest token" },
        { status: err.status ?? 401 },
      );
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-protobuf")) {
      return NextResponse.json(
        {
          error:
            "Protobuf encoding is not supported. Set OTEL_EXPORTER_OTLP_PROTOCOL=http/json in your SDK configuration.",
        },
        { status: 415 },
      );
    }

    const rawBody = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!rawBody) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // ── Convert OTLP → RawTraceEvents ─────────────────────────────────────────
    const {
      events: allEvents,
      workspaceId: otelWorkspaceId,
      capabilityName: otelCapabilityName,
      serviceName: otelServiceName,
      environment: otelEnvironment,
    } = otlpJsonToRawTraceEvents(rawBody);

    if (allEvents.length === 0) {
      // Empty export is valid in OTel (e.g., periodic flush with no spans)
      return NextResponse.json({ accepted: true, acceptedCount: 0, traceIds: [] }, { status: 202 });
    }

    // ── Resolve workspace ─────────────────────────────────────────────────────
    const resolvedWorkspaceId = tokenAuth!.workspaceId;

    // Optionally validate workspace_id from resource attributes
    if (otelWorkspaceId && otelWorkspaceId !== resolvedWorkspaceId) {
      console.warn(
        "[ingest/otel] Workspace mismatch: token=%s resource=%s",
        resolvedWorkspaceId,
        otelWorkspaceId,
      );
      return NextResponse.json({ error: "Workspace mismatch" }, { status: 403 });
    }

    // ── Group spans by traceId ────────────────────────────────────────────────
    // Each OTel trace (unique traceId) becomes one workflow trace.
    const traceGroups = new Map<string, typeof allEvents>();
    for (const event of allEvents) {
      const traceId = asString(event.metadata?.["otel.trace_id"]) ?? "__no_trace__";
      if (!traceGroups.has(traceId)) traceGroups.set(traceId, []);
      traceGroups.get(traceId)!.push(event);
    }

    const traceIds: string[] = [];

    for (const [, events] of traceGroups) {
      const startEvent = events.find((e) => asString(e.type) === "agent_run_started");
      const errorEvents = events.filter((e) => asString(e.type) === "error");

      const capabilityId = null; // OTel resource attributes don't carry capability_id
      const environment = otelEnvironment;
      const serviceName = otelServiceName;
      const capabilityName = otelCapabilityName ?? serviceName;

      const normalized = buildNormalizedTraceEnvelope(events, {
        ingestSource: "opentelemetry",
        environment,
        errorCount: errorEvents.length,
        rawEvents: events,
        serviceName,
      });

      const trace = await createWorkflowTrace({
        workspaceId: resolvedWorkspaceId,
        capabilityId,
        capabilityVersionId: null,
        provider: normalized.provider,
        model: normalized.model,
        userInput: normalized.userInput,
        finalResponse: normalized.finalResponse,
        finalAction: normalized.finalAction,
        outcomeStatus:
          (normalized.outcomeStatus as
            | "success"
            | "failed"
            | "human_handoff"
            | "blocked"
            | "cancelled"
            | "timeout"
            | "partial_success"
            | null) ?? null,
        outcomeReason: normalized.outcomeReason,
        totalLatencyMs: normalized.totalLatencyMs,
        totalCostEstimate: normalized.totalCostEstimate,
        totalTokensInput: normalized.totalTokensInput,
        totalTokensOutput: normalized.totalTokensOutput,
        steps: normalized.steps.map((step) => ({
          stepIndex: step.stepIndex,
          stepType: step.stepType,
          stepName: step.stepName,
          provider: step.provider,
          model: step.model,
          toolName: step.toolName,
          mcpServerName: step.mcpServerName,
          inputPayload: step.inputPayload,
          outputPayload: step.outputPayload,
          toolArguments: step.toolArguments,
          toolResult: step.toolResult,
          status: step.status,
          latencyMs: step.latencyMs,
          costEstimate: step.costEstimate,
          tokensInput: step.tokensInput,
          tokensOutput: step.tokensOutput,
          errorMessage: step.errorMessage,
        })),
        metadata: {
          capabilityName:
            asString(startEvent?.metadata?.capability_name)
            ?? asString(startEvent?.metadata?.capabilityName)
            ?? capabilityName,
          serviceName,
          ingestSource: "opentelemetry",
          ...normalized.metadata,
        },
      });
      traceIds.push(trace.id);

      // ── Evidence pipeline (fire-and-forget) ───────────────────────────────
      void (async () => {
        try {
          const resolved = capabilityId
            ? { id: capabilityId, name: capabilityName ?? "unknown" }
            : await resolveAiSystem(resolvedWorkspaceId, {
                capabilityId,
                aiSystemName: capabilityName,
                serviceName,
              });

          let resolvedAiSystemId = resolved?.id ?? null;

          if (!resolvedAiSystemId) {
            const candidateName = capabilityName ?? serviceName;
            if (candidateName) {
              const discovered = await upsertDiscoveredAiSystem({
                workspaceId: resolvedWorkspaceId,
                suggestedName: candidateName,
                sourceType: "opentelemetry",
                serviceName,
                provider: normalized.provider ?? null,
                model: normalized.model ?? null,
                environment,
              });
              resolvedAiSystemId = discovered.linkedAiSystemId;
            }
          }

          const hasMcp = normalized.steps.some((s) => s.mcpServerName);
          const hasRag = normalized.steps.some((s) => s.stepType === "rag_retrieval");
          const hasClassification = normalized.steps.some((s) => s.stepType === "classification");
          const hasExtraction = normalized.steps.some((s) => s.stepType === "extraction");
          const eventType = hasMcp
            ? ("mcp_tool_call" as const)
            : hasRag
              ? ("rag_retrieval" as const)
              : hasClassification
                ? ("classification_result" as const)
                : hasExtraction
                  ? ("extraction_result" as const)
                  : ("agent_run" as const);

          await recordEvidenceSourceEvent({
            workspaceId: resolvedWorkspaceId,
            sourceType: "opentelemetry",
            sourceId: trace.id,
            aiSystemId: resolvedAiSystemId,
            aiSystemVersionId: null,
            eventType,
            payload: { trace_id: trace.id, source: "opentelemetry" },
            normalizedPayload: {
              ai_system_id: resolvedAiSystemId,
              provider: normalized.provider,
              model: normalized.model,
              outcome_status: normalized.outcomeStatus,
              steps_count: normalized.steps.length,
              has_mcp: hasMcp,
              has_rag: hasRag,
              has_classification: hasClassification,
              has_extraction: hasExtraction,
            },
          });

          await touchIntegrationConnection({
            workspaceId: resolvedWorkspaceId,
            integrationType: "opentelemetry",
            success: true,
          });
        } catch (pipelineErr) {
          console.warn("[ingest/otel] Pipeline hook failed (non-blocking):", pipelineErr);
        }
      })();
    }

    return NextResponse.json(
      { accepted: true, acceptedCount: traceIds.length, traceIds },
      { status: 202 },
    );
  } catch (error) {
    console.error("[ingest/otel] Error:", error);
    const safe = toSafeApiError(error, "OTel ingest error");
    if (safe.status >= 500) {
      return NextResponse.json(
        { accepted: true, warning: "Trace recorded with partial data" },
        { status: 202 },
      );
    }
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
