import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getWorkflowTrace } from "@/lib/server/workflow-traces";
import { runReliabilityChecks } from "@/lib/server/reliability-rules";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "deterministic_rules");

    const body = (await request.json().catch(() => ({}))) as {
      workflowTraceId?: string;
      capabilityId?: string | null;
      ruleIds?: string[];
    };
    if (!body.workflowTraceId?.trim()) {
      return NextResponse.json({ error: "workflowTraceId is required" }, { status: 400 });
    }

    const trace = await getWorkflowTrace(workspaceId, body.workflowTraceId.trim());
    if (!trace) return NextResponse.json({ error: "Workflow trace not found" }, { status: 404 });

    const report = await runReliabilityChecks({
      workspaceId,
      capabilityId: body.capabilityId ?? trace.capabilityId ?? null,
      workflowTrace: trace,
      ruleIds: body.ruleIds,
    });
    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to run reliability checks");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
