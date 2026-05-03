import { NextRequest, NextResponse } from "next/server";

import type { AiCapabilityType, BusinessDomain, DataSensitivity, ReliabilityRiskLevel } from "@/lib/api";
import { assertWorkspaceMember, requireWorkspaceRole } from "@/lib/server/assert-workspace-member";
import { createCapability, listCapabilitiesIncludingPrompts } from "@/lib/server/ai-capabilities";
import { writeAuditEvent } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { getWorkspacePlanLimits } from "@/lib/server/workspace-limits";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const roleError = requireWorkspaceRole(auth.user.role, "editor", "Viewers cannot register AI systems.");
    if (roleError) return roleError;
    const systems = await listCapabilitiesIncludingPrompts(workspaceId);
    return NextResponse.json(systems);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load AI systems");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string | null;
      type?: AiCapabilityType;
      businessDomain?: BusinessDomain;
      riskLevel?: ReliabilityRiskLevel;
      dataSensitivity?: DataSensitivity;
      ownerUserId?: string | null;
      initialVersionName?: string | null;
    };

    if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (!body.type) return NextResponse.json({ error: "type is required" }, { status: 400 });

    const [limits, currentSystems] = await Promise.all([
      getWorkspacePlanLimits(workspaceId),
      listCapabilitiesIncludingPrompts(workspaceId),
    ]);
    const aiSystemLimit =
      limits.planTier === "free" ? 1 :
      limits.planTier === "plus" ? 5 :
      null;
    if (aiSystemLimit != null && currentSystems.length >= aiSystemLimit) {
      return NextResponse.json(
        {
          error:
            limits.planTier === "free"
              ? "Free workspaces can register one AI system. Upgrade to Plus or Pro to add more."
              : "Plus workspaces have reached the AI system limit. Upgrade to Pro for production governance.",
        },
        { status: 403 },
      );
    }

    const system = await createCapability({
      workspaceId,
      name: body.name.trim(),
      description: body.description ?? null,
      type: body.type,
      businessDomain: body.businessDomain ?? "general",
      riskLevel: body.riskLevel ?? "medium",
      dataSensitivity: body.dataSensitivity ?? "internal",
      ownerUserId: body.ownerUserId ?? null,
      createdBy: auth.user.id,
    });

    await writeAuditEvent({
      workspaceId,
      actorUserId: auth.user.id,
      eventType: "capability_created",
      entityType: "ai_system",
      entityId: system.id,
      entityName: system.name,
      metadata: {
        type: system.type,
        business_domain: system.businessDomain,
        risk_level: system.riskLevel,
        data_sensitivity: system.dataSensitivity,
      },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });

    return NextResponse.json(system, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create AI system");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
