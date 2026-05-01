import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getCapability, updateCapability } from "@/lib/server/ai-capabilities";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { writeAuditEvent } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const cap = await getCapability(workspaceId, id);
    if (!cap) return NextResponse.json({ error: "Capability not found" }, { status: 404 });
    return NextResponse.json(cap);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load capability");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "ai_capabilities");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const cap = await updateCapability(workspaceId, id, {
      name: body.name as string | undefined,
      description: body.description as string | null | undefined,
      riskLevel: body.riskLevel as "low" | "medium" | "high" | "critical" | undefined,
      status: body.status as "active" | "archived" | undefined,
    });
    await writeAuditEvent({
      workspaceId,
      actorUserId: auth.user.id,
      eventType: "capability_updated",
      entityType: "capability",
      entityId: cap.id,
      entityName: cap.name,
      metadata: {
        risk_level: body.riskLevel ?? null,
        status: body.status ?? null,
      },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
    return NextResponse.json(cap);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update capability");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
