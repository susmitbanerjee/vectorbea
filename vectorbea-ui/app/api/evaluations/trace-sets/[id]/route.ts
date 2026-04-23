import { NextRequest, NextResponse } from "next/server";

import { getEvaluationRun } from "@/lib/server/evaluation-runs";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";

export const dynamic = "force-dynamic";

export async function GET(
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
    const run = await getEvaluationRun(workspaceId, id);
    if (!run) {
      return NextResponse.json({ error: "Evaluation run not found" }, { status: 404 });
    }

    return NextResponse.json(run);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load evaluation run" },
      { status: 500 },
    );
  }
}
