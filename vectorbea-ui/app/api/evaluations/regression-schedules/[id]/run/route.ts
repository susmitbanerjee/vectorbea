import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { assertQuotaAvailable } from "@/lib/server/usage-quotas";
import { runRegressionSchedule } from "@/lib/server/regression-schedules";

export const dynamic = "force-dynamic";
// Allow up to 5 minutes — regression runs invoke LLM evaluations per dataset item
export const maxDuration = 300;

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
    const safe = toSafeApiError(error, "Failed to run regression schedule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
