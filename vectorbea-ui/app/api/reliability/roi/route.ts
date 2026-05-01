import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getRoiDashboardData, listRoiReports, upsertAutomationRoiSettings } from "@/lib/server/roi-analytics";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

function getFilters(request: NextRequest) {
  return {
    from: request.nextUrl.searchParams.get("from")?.trim() || null,
    to: request.nextUrl.searchParams.get("to")?.trim() || null,
    capabilityId: request.nextUrl.searchParams.get("capabilityId")?.trim() || null,
    capabilityType: request.nextUrl.searchParams.get("capabilityType")?.trim() || null,
    businessDomain: request.nextUrl.searchParams.get("businessDomain")?.trim() || null,
    provider: request.nextUrl.searchParams.get("provider")?.trim() || null,
    model: request.nextUrl.searchParams.get("model")?.trim() || null,
    environment: request.nextUrl.searchParams.get("environment")?.trim() || null,
  };
}

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const [dashboard, reports] = await Promise.all([
      getRoiDashboardData(workspaceId, getFilters(request)),
      listRoiReports(workspaceId).catch(() => []),
    ]);
    return NextResponse.json({ ...dashboard, reports });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load ROI dashboard");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const body = (await request.json().catch(() => ({}))) as {
      averageManualResolutionMinutes?: number;
      averageAgentOperatorHourlyCost?: number;
      currency?: string;
    };
    const settings = await upsertAutomationRoiSettings({
      workspaceId,
      averageManualResolutionMinutes: Math.max(Number(body.averageManualResolutionMinutes ?? 15), 1),
      averageAgentOperatorHourlyCost: Math.max(Number(body.averageAgentOperatorHourlyCost ?? 20), 1),
      currency: body.currency?.trim() || "USD",
    });
    return NextResponse.json(settings);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update ROI assumptions");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
