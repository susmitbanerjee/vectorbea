import { NextRequest, NextResponse } from "next/server";

import {
  getWorkspaceMonthlyAuditCount,
  getWorkspacePlanLimits,
  getWorkspacePromptCount,
} from "@/lib/server/workspace-limits";

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

    const [limits, promptsUsed, auditsUsed] = await Promise.all([
      getWorkspacePlanLimits(workspaceId),
      getWorkspacePromptCount(workspaceId),
      getWorkspaceMonthlyAuditCount(workspaceId),
    ]);

    return NextResponse.json({
      planTier: limits.planTier,
      promptsUsed,
      promptLimit: limits.maxPrompts,
      auditsUsed,
      auditLimit: limits.monthlyAuditLimit,
      seatsUsed: null,
      seatLimit: limits.maxSeats,
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
