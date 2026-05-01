import { NextRequest, NextResponse } from "next/server";

import type { IncidentSeverity, IncidentSourceType } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { createIncident, createIncidentFromTrace, listIncidents } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "incidents");
    const status = request.nextUrl.searchParams.get("status")?.trim() || undefined;
    const severity = request.nextUrl.searchParams.get("severity")?.trim() || undefined;
    const capabilityId = request.nextUrl.searchParams.get("capabilityId")?.trim() || undefined;
    return NextResponse.json(await listIncidents(workspaceId, { status, severity, capabilityId }));
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load incidents");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "incidents");
    const body = (await request.json().catch(() => ({}))) as {
      traceId?: string;
      title?: string;
      description?: string | null;
      severity?: IncidentSeverity;
      sourceType?: IncidentSourceType;
      sourceId?: string | null;
      capabilityId?: string | null;
      capabilityVersionId?: string | null;
    };
    if (body.traceId) {
      const incident = await createIncidentFromTrace({
        workspaceId,
        traceId: body.traceId,
        createdBy: auth.user.id,
        title: body.title,
        description: body.description ?? null,
      });
      return NextResponse.json(incident, { status: 201 });
    }
    if (!body.title?.trim() || !body.sourceType) {
      return NextResponse.json({ error: "title and sourceType are required" }, { status: 400 });
    }
    const incident = await createIncident({
      workspaceId,
      createdBy: auth.user.id,
      capabilityId: body.capabilityId ?? null,
      capabilityVersionId: body.capabilityVersionId ?? null,
      title: body.title.trim(),
      description: body.description ?? null,
      severity: body.severity ?? "medium",
      sourceType: body.sourceType,
      sourceId: body.sourceId ?? null,
    });
    return NextResponse.json(incident, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create incident");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
