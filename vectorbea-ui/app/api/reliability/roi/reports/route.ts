import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createRoiReport, listRoiReports } from "@/lib/server/roi-analytics";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const reports = await listRoiReports(workspaceId);
    return NextResponse.json(reports);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load ROI reports");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const report = await createRoiReport({
      workspaceId,
      createdBy: auth.user.id,
      filters: body,
    });
    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create ROI report");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
