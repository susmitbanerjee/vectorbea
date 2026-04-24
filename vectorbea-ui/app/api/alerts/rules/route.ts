import { NextRequest, NextResponse } from "next/server";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { listAlertRules, createAlertRule } from "@/lib/server/alerts";
import type { AlertMetricType, AlertComparison } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "alerts");
    return NextResponse.json(await listAlertRules(workspaceId));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "alerts");
    const body = await request.json().catch(() => ({})) as {
      name?: string;
      metricType?: string;
      threshold?: number;
      comparison?: string;
      windowHours?: number;
    };
    if (!body.name || !body.metricType || body.threshold === undefined) {
      return NextResponse.json({ error: "name, metricType, threshold are required" }, { status: 400 });
    }
    const rule = await createAlertRule({
      workspaceId,
      name: body.name,
      metricType: body.metricType as AlertMetricType,
      threshold: body.threshold,
      comparison: (body.comparison ?? "gt") as AlertComparison,
      windowHours: body.windowHours ?? 1,
      createdBy: auth.user.id,
    });
    return NextResponse.json(rule, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
