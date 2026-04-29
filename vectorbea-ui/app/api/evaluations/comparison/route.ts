import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { computeEvaluationRunComparison } from "@/lib/server/provider-arena-governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "evaluation_comparison");

    const body = (await request.json().catch(() => ({}))) as { runIds?: string[] };
    const runIds = (body.runIds ?? []).map((id) => id.trim()).filter(Boolean);
    if (runIds.length < 2 || runIds.length > 5) {
      return NextResponse.json({ error: "Select between 2 and 5 runs for comparison" }, { status: 400 });
    }
    const report = await computeEvaluationRunComparison({
      workspaceId,
      runIds,
      createdBy: auth.user.id,
    });
    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to build comparison report");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

