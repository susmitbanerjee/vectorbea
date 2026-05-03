import { NextRequest, NextResponse } from "next/server";

import type { AiCapabilityType, BusinessDomain, CapabilityStatus, DataSensitivity, ReliabilityRiskLevel } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getCapability, updateCapability } from "@/lib/server/ai-capabilities";
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
    const system = await getCapability(workspaceId, id);
    if (!system) return NextResponse.json({ error: "AI system not found" }, { status: 404 });
    return NextResponse.json(system);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load AI system");
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
    const { id } = await params;

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string | null;
      type?: AiCapabilityType;
      businessDomain?: BusinessDomain;
      riskLevel?: ReliabilityRiskLevel;
      dataSensitivity?: DataSensitivity;
      ownerUserId?: string | null;
      status?: CapabilityStatus;
    };

    const system = await updateCapability(workspaceId, id, {
      name: body.name,
      description: body.description,
      type: body.type,
      businessDomain: body.businessDomain,
      riskLevel: body.riskLevel,
      dataSensitivity: body.dataSensitivity,
      ownerUserId: body.ownerUserId,
      status: body.status,
    });

    await writeAuditEvent({
      workspaceId,
      actorUserId: auth.user.id,
      eventType: "capability_updated",
      entityType: "ai_system",
      entityId: system.id,
      entityName: system.name,
      metadata: { changes: Object.keys(body) },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });

    return NextResponse.json(system);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update AI system");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
