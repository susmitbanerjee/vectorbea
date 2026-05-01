import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { listWorkflowRegressionRuns } from "@/lib/server/workflow-regressions";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const suiteId = request.nextUrl.searchParams.get("suiteId")?.trim() || undefined;
    const runs = await listWorkflowRegressionRuns(workspaceId, suiteId);
    return NextResponse.json(runs);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load regression runs");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
