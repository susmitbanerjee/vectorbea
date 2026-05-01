import { NextRequest, NextResponse } from "next/server";

import type { IncidentStatus } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { getIncidentDetail, updateIncidentStatus } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "incidents");
    const { id } = await params;
    const incident = await getIncidentDetail(workspaceId, id);
    if (!incident) return NextResponse.json({ error: "Incident not found" }, { status: 404 });
    return NextResponse.json(incident);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load incident");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "incidents");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      status?: IncidentStatus;
      description?: string | null;
      ownerUserId?: string | null;
    };
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 });
    return NextResponse.json(await updateIncidentStatus({
      workspaceId,
      incidentId: id,
      actorUserId: auth.user.id,
      status: body.status,
      description: body.description,
      ownerUserId: body.ownerUserId,
    }));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update incident");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
