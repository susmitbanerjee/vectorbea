import { NextRequest, NextResponse } from "next/server";

import { apiFetch } from "@/lib/api";
import {
  getWorkspaceMonthlyAuditCount,
  getWorkspacePlanLimits,
} from "@/lib/server/workspace-limits";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) {
      return NextResponse.json(
        { error: "workspaceId is required." },
        { status: 400 },
      );
    }

    const planLimits = await getWorkspacePlanLimits(workspaceId);
    const auditCount = await getWorkspaceMonthlyAuditCount(workspaceId);
    const auditLimit = Math.max(planLimits.monthlyAuditLimit ?? 100, 100);

    if (planLimits.planTier === "free" && auditCount >= auditLimit) {
      return NextResponse.json(
        {
          error: `Free plan monthly audit limit reached (${auditLimit} events). Please upgrade to the Team plan.`,
        },
        { status: 429 },
      );
    }

    const payload = await request.json();
    const response = await apiFetch("/api/audit/batch", {
      method: "POST",
      body: JSON.stringify(payload),
      workspaceId,
    });
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to insert audit logs" },
      { status: 500 },
    );
  }
}
