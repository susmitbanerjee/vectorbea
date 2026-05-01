import { NextRequest, NextResponse } from "next/server";
import { assertInternalToken } from "@/app/api/internal/jobs/_auth";
import { getWorkspaceMetrics } from "@/lib/server/metrics";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/internal/jobs/aggregate-metrics
 *
 * Pre-aggregates workspace metrics and optionally checks quota thresholds.
 * Protected by INTERNAL_JOB_TOKEN.
 *
 * Cron: hourly
 *   Vercel:   { path: "/api/internal/jobs/aggregate-metrics", schedule: "0 * * * *" }
 *   Linux:    0 * * * *  curl -s -X POST -H "x-internal-job-token: $TOKEN" $APP_URL/api/internal/jobs/aggregate-metrics
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
      const { data: workspaces } = await supabase.from("workspaces").select("id").limit(500);
      workspaceIds = (workspaces ?? []).map((w) => w.id as string);
    }

    let succeeded = 0;
    const errors: string[] = [];
    const summaries: Array<{ workspaceId: string; totalRequests: number; errorRate: number; avgLatencyMs: number }> = [];

    for (const wsId of workspaceIds) {
      try {
        // Aggregate 24h metrics for quota/alert checks
        const metrics = await getWorkspaceMetrics(wsId, "24h");
        succeeded++;
        summaries.push({
          workspaceId: wsId,
          totalRequests: metrics.totalRequests,
          errorRate: Math.round(metrics.errorRate * 1000) / 10,
          avgLatencyMs: Math.round(metrics.avgLatencyMs),
        });

        const { formatUsageMeterLabel, listPendingQuotaAlerts, markQuotaAlertSent } = await import("@/lib/server/usage-quotas");
        const pendingAlerts = await listPendingQuotaAlerts(wsId);
        for (const alert of pendingAlerts) {
          const { notifyQuotaWarning } = await import("@/lib/server/notifications");
          await notifyQuotaWarning({
            workspaceId: wsId,
            usageType: formatUsageMeterLabel(alert.meter),
            used: alert.used,
            limit: alert.limit,
          });
          await markQuotaAlertSent({
            workspaceId: wsId,
            meter: alert.meter,
            threshold: alert.threshold,
            month: alert.month,
            eventType: alert.eventType,
            used: alert.used,
            limit: alert.limit,
          });
        }
      } catch (err) {
        errors.push(`workspace ${wsId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return NextResponse.json({
      ok: true,
      jobsAttempted: workspaceIds.length,
      jobsSucceeded: succeeded,
      jobsFailed: errors.length,
      logs: errors,
      summaries: summaries.slice(0, 50), // Cap output size
    });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to aggregate metrics");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
