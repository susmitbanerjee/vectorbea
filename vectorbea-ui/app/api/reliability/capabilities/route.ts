import { NextRequest, NextResponse } from "next/server";

import type { AiCapabilityType, BusinessDomain, ReliabilityRiskLevel } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { createCapability, listCapabilitiesIncludingPrompts } from "@/lib/server/ai-capabilities";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "ai_capabilities");
    const caps = await listCapabilitiesIncludingPrompts(workspaceId);
    return NextResponse.json(caps);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load capabilities");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "ai_capabilities");

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string | null;
      type?: AiCapabilityType;
      businessDomain?: BusinessDomain;
      riskLevel?: ReliabilityRiskLevel;
      ownerUserId?: string | null;
      promptId?: string | null;
    };
    if (!body.name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
    if (!body.type) return NextResponse.json({ error: "type is required" }, { status: 400 });

    const cap = await createCapability({
      workspaceId,
      name: body.name.trim(),
      description: body.description ?? null,
      type: body.type,
      businessDomain: body.businessDomain ?? "general",
      riskLevel: body.riskLevel ?? "medium",
      ownerUserId: body.ownerUserId ?? null,
      promptId: body.promptId ?? null,
      createdBy: auth.user.id,
    });
    return NextResponse.json(cap, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create capability");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
