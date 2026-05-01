import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { consumeRateLimit } from "@/lib/server/rate-limit";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { assertUsageAvailable, recordUsageEvent } from "@/lib/server/usage-quotas";
import { runRegressionSchedule, updateScheduleStatus } from "@/lib/server/regression-schedules";

export const dynamic = "force-dynamic";
// Allow up to 5 minutes — regression runs invoke LLM evaluations per dataset item
export const maxDuration = 300;

const TIMEOUT_MS = 4.5 * 60 * 1000; // 4.5 minutes

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
    await assertUsageAvailable(workspaceId, {
      scheduled_regression_runs: 1,
    });
    const { id } = await params;

    // Timeout wrapper — if run takes >4.5 minutes, mark as timed_out
    let timedOut = false;
    const timeoutHandle = setTimeout(async () => {
      timedOut = true;
      try {
        await updateScheduleStatus(workspaceId, id, "failed");
      } catch { /* best-effort */ }
    }, TIMEOUT_MS);

    try {
      const result = await runRegressionSchedule({ workspaceId, scheduleId: id, triggeredBy: auth.user.id });
      clearTimeout(timeoutHandle);
      if (timedOut) {
        return NextResponse.json({ error: "Regression run timed out after 4.5 minutes. Status has been reset." }, { status: 504 });
      }
      await recordUsageEvent({
        workspaceId,
        eventType: "SCHEDULED_REGRESSION_RUN",
        sourceType: "regression_schedule_run",
        sourceId: result.runLog.runId,
        metadata: {
          scheduleId: id,
          evaluationRunId: result.evaluationRunId,
          behavioralRunId: result.runLog.behavioralRunId,
          childEvaluationRunIds: result.runLog.childEvaluationRunIds,
        },
        meterDeltas: {
          scheduled_regression_runs: 1,
        },
      });
      return NextResponse.json(result);
    } catch (error) {
      clearTimeout(timeoutHandle);
      throw error;
    }
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to run regression schedule");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
