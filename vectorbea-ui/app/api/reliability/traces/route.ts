import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createWorkflowTrace, listWorkflowTraces } from "@/lib/server/workflow-traces";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const capabilityId = request.nextUrl.searchParams.get("capabilityId")?.trim() || undefined;
    const limit = Number(request.nextUrl.searchParams.get("limit") ?? "50");
    const traces = await listWorkflowTraces(workspaceId, { capabilityId, limit: Math.min(limit, 200) });
    return NextResponse.json(traces);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load traces");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const trace = await createWorkflowTrace({
      workspaceId,
      capabilityId:         (body.capabilityId as string | null) ?? null,
      capabilityVersionId:  (body.capabilityVersionId as string | null) ?? null,
      promptId:             (body.promptId as string | null) ?? null,
      promptVersionId:      (body.promptVersionId as string | null) ?? null,
      agentRunId:           (body.agentRunId as string | null) ?? null,
      traceId:              (body.traceId as string | null) ?? null,
      provider:             (body.provider as string | null) ?? null,
      model:                (body.model as string | null) ?? null,
      userInput:            (body.userInput as string | null) ?? null,
      finalResponse:        (body.finalResponse as string | null) ?? null,
      finalAction:          (body.finalAction as string | null) ?? null,
      status:               (body.status as "running" | "completed" | "failed" | "cancelled") ?? "completed",
      totalLatencyMs:       (body.totalLatencyMs as number | null) ?? null,
      totalCostEstimate:    (body.totalCostEstimate as number | null) ?? null,
      totalTokensInput:     (body.totalTokensInput as number | null) ?? null,
      totalTokensOutput:    (body.totalTokensOutput as number | null) ?? null,
      errorMessage:         (body.errorMessage as string | null) ?? null,
      metadata:             (body.metadata as Record<string, unknown>) ?? {},
      steps:                Array.isArray(body.steps) ? (body.steps as Parameters<typeof createWorkflowTrace>[0]["steps"]) : undefined,
    });
    return NextResponse.json(trace, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create trace");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
