import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getTrajectoryDiff } from "@/lib/server/workflow-regressions";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const diff = await getTrajectoryDiff(workspaceId, id);
    if (!diff) return NextResponse.json({ error: "Trajectory diff not found" }, { status: 404 });
    return NextResponse.json(diff);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load trajectory diff");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
