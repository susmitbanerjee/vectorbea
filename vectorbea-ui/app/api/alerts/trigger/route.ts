import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { listAlertRules } from "@/lib/server/alerts";
import { notifyAlertTriggered } from "@/lib/server/notifications";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

/**
 * POST /api/alerts/trigger?workspaceId=...
 * Body: { ruleId: string; promptName?: string }
 *
 * Manually fires the notification for a specific alert rule without waiting
 * for metric evaluation. Used for testing and manual override.
 */
export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const body = await request.json().catch(() => ({})) as { ruleId?: string; promptName?: string };
    if (!body.ruleId) return NextResponse.json({ error: "ruleId required" }, { status: 400 });

    const rules = await listAlertRules(workspaceId);
    const rule = rules.find((r) => r.id === body.ruleId);
    if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

    await notifyAlertTriggered({
      workspaceId,
      ruleName: rule.name,
      metricType: rule.metricType,
      metricValue: rule.threshold, // Use threshold as the value so the alert reads naturally
      threshold: rule.threshold,
      comparison: rule.comparison,
    });

    return NextResponse.json({ ok: true, ruleName: rule.name });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to trigger alert");
    return NextResponse.json({ error: safe.message }, { status: safe.status });
  }
}
