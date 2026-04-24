import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createTraceSetEvaluationRun, listEvaluationRuns } from "@/lib/server/evaluation-runs";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { assertQuotaAvailable } from "@/lib/server/usage-quotas";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json([]);
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "evaluations");

    return NextResponse.json(await listEvaluationRuns(workspaceId));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load evaluation runs" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "evaluations");
    const rate = consumeRateLimit(`evaluations:trace-sets:${workspaceId}:${auth.user.id}`, 20, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded for evaluation creation." }, { status: 429 });
    }
    await assertQuotaAvailable(workspaceId, "evaluation_runs", 1);

    const body = (await request.json().catch(() => ({}))) as {
      sourceTraceIds?: string[];
      candidatePromptVersionId?: string;
    };

    if (!Array.isArray(body.sourceTraceIds) || body.sourceTraceIds.length === 0 || !body.candidatePromptVersionId?.trim()) {
      return NextResponse.json(
        { error: "sourceTraceIds and candidatePromptVersionId are required" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      await createTraceSetEvaluationRun({
        workspaceId,
        sourceTraceIds: body.sourceTraceIds,
        candidatePromptVersionId: body.candidatePromptVersionId.trim(),
        triggeredBy: auth.user.id,
      }),
      { status: 201 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create evaluation run";
    const quotaExceeded = message.toLowerCase().includes("quota exceeded");
    return NextResponse.json(
      { error: quotaExceeded ? message : message },
      { status: quotaExceeded ? 402 : 500 },
    );
  }
}
