import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { applyPolicyPackToCapability } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "policy_packs");
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { capabilityId?: string };
    if (!body.capabilityId) return NextResponse.json({ error: "capabilityId is required" }, { status: 400 });
    return NextResponse.json(await applyPolicyPackToCapability({
      workspaceId,
      capabilityId: body.capabilityId,
      policyPackId: id,
      actorUserId: auth.user.id,
    }), { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to apply policy pack");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
