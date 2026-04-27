import { NextRequest, NextResponse } from "next/server";
import { assertInternalToken } from "@/app/api/internal/jobs/_auth";
import { runDueRegressionSchedules } from "@/lib/server/regression-schedules";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/internal/jobs/run-due-regressions
 *
 * Runs all regression schedules that are due.
 * Protected by INTERNAL_JOB_TOKEN header.
 *
 * Cron examples:
 *   Vercel:   crons: [{ path: "/api/internal/jobs/run-due-regressions", schedule: "0 * * * *" }]
 *   GitHub:   curl -X POST -H "x-internal-job-token: $TOKEN" $APP_URL/api/internal/jobs/run-due-regressions
 *   Linux:    0 * * * *  curl -s -X POST -H "x-internal-job-token: $TOKEN" $APP_URL/api/internal/jobs/run-due-regressions
 */
export async function POST(request: NextRequest) {
  const auth = assertInternalToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const result = await runDueRegressionSchedules("internal-job");
    const succeeded = result.results.filter((r) => !r.error).length;
    const failed = result.results.filter((r) => !!r.error).length;
    return NextResponse.json({
      ok: true,
      jobsAttempted: result.checked,
      jobsSucceeded: succeeded,
      jobsFailed: failed,
      logs: result.results,
    });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to run due regressions");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
