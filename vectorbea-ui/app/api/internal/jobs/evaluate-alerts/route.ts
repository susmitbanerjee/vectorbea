import { NextRequest, NextResponse } from "next/server";
import { assertInternalToken } from "@/app/api/internal/jobs/_auth";
import { evaluateAlerts } from "@/lib/server/alerts";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/internal/jobs/evaluate-alerts
 *
 * Evaluates alert rules for ALL workspaces (or a specific one if workspaceId is provided).
 * Protected by INTERNAL_JOB_TOKEN.
 *
 * Cron: every 5 minutes
 *   Vercel:   { path: "/api/internal/jobs/evaluate-alerts", schedule: "* /5 * * * *" }
 *   Linux:    curl every 5 min: curl -s -X POST -H "x-internal-job-token: $TOKEN" $APP_URL/api/internal/jobs/evaluate-alerts
 */
export async function POST(request: NextRequest) {
  const auth = assertInternalToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json().catch(() => ({})) as { workspaceId?: string };
    const supabase = createVectorBeaAdminClient();

    // Determine target workspace(s)
    let workspaceIds: string[];
    if (body.workspaceId) {
      workspaceIds = [body.workspaceId];
    } else {
      const { data: workspaces } = await supabase
        .from("workspaces")
        .select("id")
        .limit(500);
      workspaceIds = (workspaces ?? []).map((w) => w.id as string);
    }

    let totalChecked = 0;
    let totalTriggered = 0;
    const errors: string[] = [];

    for (const wsId of workspaceIds) {
      try {
        const result = await evaluateAlerts(wsId);
        totalChecked += result.checked;
        totalTriggered += result.triggered.length;
      } catch (err) {
        errors.push(`workspace ${wsId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      ok: true,
      workspacesProcessed: workspaceIds.length,
      jobsAttempted: totalChecked,
      jobsSucceeded: totalChecked - errors.length,
      jobsFailed: errors.length,
      alertsTriggered: totalTriggered,
      logs: errors,
    });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to evaluate alerts");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
