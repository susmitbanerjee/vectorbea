import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getWorkspaceUsage } from "@/lib/server/usage-quotas";
import { getWorkspacePlanLimits, getWorkspaceMonthlyAuditCount, getWorkspaceMemberCount } from "@/lib/server/workspace-limits";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const [snapshot, plan, auditEvents, members] = await Promise.all([
      getWorkspaceUsage(workspaceId), getWorkspacePlanLimits(workspaceId), getWorkspaceMonthlyAuditCount(workspaceId), getWorkspaceMemberCount(workspaceId),
    ]);
    return NextResponse.json({ ...snapshot, seats: { used: members, limit: plan.maxSeats }, auditEvents: { used: auditEvents, limit: plan.monthlyAuditLimit } });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load usage and limits");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
