import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { canUseFeature } from "@/lib/server/feature-gates";
import {
  getWorkspaceMonthlyAuditCount,
  getWorkspacePlanLimits,
  getWorkspacePromptCount,
} from "@/lib/server/workspace-limits";
import { getWorkspaceUsage } from "@/lib/server/usage-quotas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required" },
        { status: 400 },
      );
    }

    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const [limits, promptsUsed, auditsUsed, usageSnapshot, evalFeature, rolloutFeature, alertsFeature] = await Promise.all([
      getWorkspacePlanLimits(workspaceId),
      getWorkspacePromptCount(workspaceId),
      getWorkspaceMonthlyAuditCount(workspaceId),
      getWorkspaceUsage(workspaceId),
      canUseFeature(workspaceId, "evaluations"),
      canUseFeature(workspaceId, "rollout"),
      canUseFeature(workspaceId, "alerts"),
    ]);

    return NextResponse.json({
      planTier: limits.planTier,
      promptsUsed,
      promptLimit: limits.maxPrompts,
      auditsUsed,
      auditLimit: limits.monthlyAuditLimit,
      seatsUsed: null,
      seatLimit: limits.maxSeats,
      usage: usageSnapshot.usage,
      usageLimits: usageSnapshot.limits,
      features: {
        evaluations: evalFeature.allowed,
        rollout: rolloutFeature.allowed,
        alerts: alertsFeature.allowed,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load billing usage",
      },
      { status: 500 },
    );
  }
}
