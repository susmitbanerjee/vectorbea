import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { assertQuotaAvailable } from "@/lib/server/usage-quotas";
import { runRegressionSchedule } from "@/lib/server/regression-schedules";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "scheduled_regressions");
    const rate = consumeRateLimit(`evaluations:schedule-run:${workspaceId}:${auth.user.id}`, 10, 60_000);
    if (!rate.allowed) {
      return NextResponse.json({ error: "Rate limit exceeded for scheduled regression run." }, { status: 429 });
    }
    await assertQuotaAvailable(workspaceId, "evaluation_runs", 1);
    const { id } = await params;
    const result = await runRegressionSchedule({ workspaceId, scheduleId: id, triggeredBy: auth.user.id });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed";
    const quotaExceeded = message.toLowerCase().includes("quota exceeded");
    return NextResponse.json({ error: message }, { status: quotaExceeded ? 402 : 500 });
  }
}
