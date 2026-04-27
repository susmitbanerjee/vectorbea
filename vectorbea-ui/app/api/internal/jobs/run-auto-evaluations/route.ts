import { NextRequest, NextResponse } from "next/server";
import { assertInternalToken } from "@/app/api/internal/jobs/_auth";
import { runPendingAutoEvaluations } from "@/lib/server/auto-evaluations";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/internal/jobs/run-auto-evaluations
 *
 * Runs automatic evaluations for candidate/active versions that don't have
 * a recent evaluation run. Protected by INTERNAL_JOB_TOKEN.
 *
 * Body (optional): { workspaceId: string }
 *
 * Cron: every 30 minutes
 *   Vercel:   { path: "/api/internal/jobs/run-auto-evaluations", schedule: "*/30 * * * *" }
 *   Linux:    */30 * * * *  curl -s -X POST -H "x-internal-job-token: $TOKEN" $APP_URL/api/internal/jobs/run-auto-evaluations
 */
export async function POST(request: NextRequest) {
  const auth = assertInternalToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({})) as { workspaceId?: string };
    const supabase = createVectorBeaAdminClient();

    let workspaceIds: string[];
    if (body.workspaceId) {
      workspaceIds = [body.workspaceId];
    } else {
      const { data: workspaces } = await supabase.from("workspaces").select("id").limit(200);
      workspaceIds = (workspaces ?? []).map((w) => w.id as string);
    }

    let totalAttempted = 0;
    let totalStarted = 0;
    let totalSkipped = 0;
    const allErrors: string[] = [];

    for (const wsId of workspaceIds) {
      const result = await runPendingAutoEvaluations(wsId);
      totalAttempted += result.attempted;
      totalStarted += result.started;
      totalSkipped += result.skipped;
      allErrors.push(...result.errors.map((e) => `[${wsId}] ${e}`));
    }

    return NextResponse.json({
      ok: true,
      workspacesProcessed: workspaceIds.length,
      jobsAttempted: totalAttempted,
      jobsSucceeded: totalStarted,
      jobsFailed: allErrors.length,
      jobsSkipped: totalSkipped,
      logs: allErrors,
    });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to run auto evaluations");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
