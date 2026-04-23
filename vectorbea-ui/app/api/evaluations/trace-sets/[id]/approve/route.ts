import { NextRequest, NextResponse } from "next/server";

import { approveEvaluationRun } from "@/lib/server/evaluation-runs";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const { id } = await params;
    const run = await approveEvaluationRun({
      workspaceId,
      evaluationRunId: id,
      approvedBy: auth.user.id,
    });

    return NextResponse.json(run);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to approve evaluation run" },
      { status: 500 },
    );
  }
}
