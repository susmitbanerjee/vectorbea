/**
 * POST /api/ingest/traces
 *
 * SDK-facing ingestion endpoint. Accepts a batched agent-run event payload from
 * the VectorBea SDK, a sidecar, or any OpenTelemetry-compatible emitter.
 */

import { NextRequest, NextResponse } from "next/server";

import { authenticateIngestToken } from "@/lib/server/ingest-tokens";
import { recordEvidenceSourceEvent, resolveAiSystem, touchIntegrationConnection, upsertDiscoveredAiSystem } from "@/lib/server/integrations";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { buildNormalizedTraceEnvelope, type RawTraceEvent } from "@/lib/server/trace-event-normalizer";
import { createWorkflowTrace } from "@/lib/server/workflow-traces";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface IngestPayload {
  trace_id?: string;
  workspace_id: string;
  capability_id?: string;
  capability_version_id?: string;
  environment?: string;
  user_id?: string;
  session_id?: string;
  source?: "sdk" | "sidecar" | "opentelemetry" | "direct_api" | "proxy";
  metadata?: Record<string, unknown>;
  events: RawTraceEvent[];
}

interface IngestBatchPayload {
  source?: "sdk" | "sidecar" | "opentelemetry" | "direct_api" | "proxy";
  sidecar_version?: string;
  service_name?: string;
  environment?: string;
  traces: IngestPayload[];
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as IngestPayload | IngestBatchPayload | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    let resolvedWorkspaceId: string;
    let tokenAuth: Awaited<ReturnType<typeof authenticateIngestToken>> | null = null;

    try {
      tokenAuth = await authenticateIngestToken(
        request.headers.get("authorization"),
        request.headers.get("x-vectorbea-ingest-token"),
        request.headers.get("x-vectorbea-token"),
      );
    } catch (authErr) {
      const err = authErr as { status?: number; message?: string };
      console.warn("[ingest/traces] Token auth failed:", err.message ?? "unknown");
      return NextResponse.json({ error: err.message ?? "Invalid ingest token" }, { status: err.status ?? 401 });
    }

    const traces = Array.isArray((body as IngestBatchPayload).traces)
      ? (body as IngestBatchPayload).traces
      : [body as IngestPayload];

    if (traces.length === 0) {
      return NextResponse.json({ error: "traces must be a non-empty array" }, { status: 400 });
    }

    const batchDefaults = Array.isArray((body as IngestBatchPayload).traces)
      ? {
        source: (body as IngestBatchPayload).source,
        sidecarVersion: (body as IngestBatchPayload).sidecar_version,
        serviceName: (body as IngestBatchPayload).service_name,
        environment: (body as IngestBatchPayload).environment,
      }
      : null;

    const traceIds: string[] = [];

    for (const traceBody of traces) {
      const { workspace_id, capability_id, capability_version_id, environment, events, user_id, session_id } = traceBody;
      if (!Array.isArray(events) || events.length === 0) {
        return NextResponse.json({ error: "events must be a non-empty array" }, { status: 400 });
      }

      if (tokenAuth) {
        resolvedWorkspaceId = tokenAuth.workspaceId;
        if (workspace_id?.trim() && workspace_id.trim() !== resolvedWorkspaceId) {
          console.warn("[ingest/traces] Workspace mismatch: token=%s payload=%s", resolvedWorkspaceId, workspace_id);
          return NextResponse.json({ error: "Workspace mismatch" }, { status: 403 });
        }
      } else {
        if (!workspace_id?.trim()) {
          return NextResponse.json({ error: "workspace_id is required" }, { status: 400 });
        }
        const { assertWorkspaceMember } = await import("@/lib/server/assert-workspace-member");
        const auth = await assertWorkspaceMember(request, workspace_id.trim());
        if (auth.error) return auth.error;
        resolvedWorkspaceId = workspace_id.trim();
      }

      const startEvent = events.find((event) => asString(event.type) === "agent_run_started");
      const errorEvents = events.filter((event) => asString(event.type) === "error");
      const metadata = traceBody.metadata ?? {};

      const normalized = buildNormalizedTraceEnvelope(events, {
        ingestSource: traceBody.source ?? batchDefaults?.source ?? "sdk",
        environment: environment ?? batchDefaults?.environment ?? null,
        userId: user_id,
        sessionId: session_id,
        errorCount: errorEvents.length,
        externalTraceId: traceBody.trace_id,
        rawEvents: events,
        sidecarVersion: batchDefaults?.sidecarVersion ?? null,
        serviceName:
          asString(metadata.service_name)
          ?? asString(metadata.serviceName)
          ?? batchDefaults?.serviceName
          ?? null,
        ...metadata,
      });

      const trace = await createWorkflowTrace({
        workspaceId: resolvedWorkspaceId,
        capabilityId: capability_id ?? null,
        capabilityVersionId: capability_version_id ?? null,
        provider: normalized.provider,
        model: normalized.model,
        userInput: normalized.userInput,
        finalResponse: normalized.finalResponse,
        finalAction: normalized.finalAction,
        outcomeStatus: (normalized.outcomeStatus as "success" | "failed" | "human_handoff" | "blocked" | "cancelled" | "timeout" | "partial_success" | null) ?? null,
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
            ?? asString(startEvent?.metadata?.agent_name)
            ?? asString(startEvent?.metadata?.agentName)
            ?? asString(startEvent?.metadata?.workflow_name)
            ?? asString(startEvent?.metadata?.workflowName),
          serviceName:
            asString(startEvent?.metadata?.service_name)
            ?? asString(startEvent?.metadata?.serviceName)
            ?? asString(metadata.service_name)
            ?? asString(metadata.serviceName)
            ?? batchDefaults?.serviceName
            ?? null,
          sidecarVersion: batchDefaults?.sidecarVersion ?? null,
          ...normalized.metadata,
        },
      });
      traceIds.push(trace.id);

      // ── Evidence pipeline: record event + resolve/discover AI system ──────
      // Fire-and-forget: do not block trace ingestion on pipeline failures
      const ingestSourceType = (traceBody.source ?? batchDefaults?.source ?? "sdk") as "sidecar" | "opentelemetry" | "sdk" | "direct_api";
      void (async () => {
        try {
          const capName =
            asString(startEvent?.metadata?.capability_name)
            ?? asString(startEvent?.metadata?.capabilityName)
            ?? asString(startEvent?.metadata?.agent_name)
            ?? asString(startEvent?.metadata?.agentName)
            ?? asString(startEvent?.metadata?.workflow_name)
            ?? asString(startEvent?.metadata?.workflowName);
          const svcName =
            asString(startEvent?.metadata?.service_name)
            ?? asString(startEvent?.metadata?.serviceName)
            ?? asString(metadata.service_name)
            ?? asString(metadata.serviceName)
            ?? batchDefaults?.serviceName
            ?? null;

          // Resolve AI system
          const resolved = capability_id
            ? { id: capability_id, name: capName ?? "unknown" }
            : await resolveAiSystem(resolvedWorkspaceId, {
                capabilityId: capability_id ?? null,
                aiSystemName: capName,
                serviceName: svcName,
              });

          let resolvedAiSystemId = resolved?.id ?? null;

          // Discover if unresolved
          if (!resolvedAiSystemId) {
            const candidateName = capName ?? svcName;
            if (candidateName) {
              const discovered = await upsertDiscoveredAiSystem({
                workspaceId: resolvedWorkspaceId,
                suggestedName: candidateName,
                sourceType: ingestSourceType,
                serviceName: svcName,
                provider: normalized.provider ?? null,
                model: normalized.model ?? null,
                environment: traceBody.environment ?? batchDefaults?.environment ?? null,
              });
              resolvedAiSystemId = discovered.linkedAiSystemId;
            }
          }

          // Determine event_type from normalized steps
          const hasMcp = normalized.steps.some((s) => s.mcpServerName);
          const hasRag = normalized.steps.some((s) => s.stepType === "rag_retrieval");
          const eventType = hasMcp ? "mcp_tool_call" : hasRag ? "rag_retrieval" : "agent_run";

          await recordEvidenceSourceEvent({
            workspaceId: resolvedWorkspaceId,
            sourceType: ingestSourceType,
            sourceId: trace.id,
            aiSystemId: resolvedAiSystemId,
            aiSystemVersionId: capability_version_id ?? null,
            eventType,
            payload: { trace_id: trace.id, source: ingestSourceType },
            normalizedPayload: {
              ai_system_id: resolvedAiSystemId,
              provider: normalized.provider,
              model: normalized.model,
              outcome_status: normalized.outcomeStatus,
              steps_count: normalized.steps.length,
              has_mcp: hasMcp,
              has_rag: hasRag,
            },
          });

          // Update integration connection health
          await touchIntegrationConnection({
            workspaceId: resolvedWorkspaceId,
            integrationType: ingestSourceType,
            success: true,
          });
        } catch (pipelineErr) {
          console.warn("[ingest/traces] Pipeline hook failed (non-blocking):", pipelineErr);
        }
      })();
    }

    return NextResponse.json(
      Array.isArray((body as IngestBatchPayload).traces)
        ? { accepted: true, acceptedCount: traceIds.length, traceIds }
        : { accepted: true, traceId: traceIds[0] },
      { status: 202 },
    );
  } catch (error) {
    console.error("[ingest/traces] Error processing trace batch:", error);
    const safe = toSafeApiError(error, "Ingest error");
    if (safe.status >= 500) {
      return NextResponse.json({ accepted: true, warning: "Trace recorded with partial data" }, { status: 202 });
    }
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
