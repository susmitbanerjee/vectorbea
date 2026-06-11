import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember, requireWorkspaceRole } from "@/lib/server/assert-workspace-member";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { createCustomPolicyPack, listPolicyPacks } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import type { EvidenceType, PolicyPack } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const packs = await listPolicyPacks(workspaceId);
    return NextResponse.json(packs);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load policy packs");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const roleError = requireWorkspaceRole(auth.user.role, "admin", "Only workspace admins can create custom policies.");
    if (roleError) return roleError;
    await assertFeatureAccess(workspaceId, "policy_packs");

    const body = (await request.json().catch(() => ({}))) as {
      name?: string;
      description?: string | null;
      sector?: PolicyPack["sector"];
      requiredEvidence?: Array<{
        evidenceType?: EvidenceType;
        label?: string;
        required?: boolean;
        blocking?: boolean;
      }>;
      requiresApproval?: boolean;
    };

    const requiredEvidence = (body.requiredEvidence ?? [])
      .filter((item) => Boolean(item.evidenceType && item.label))
      .map((item) => ({
        evidenceType: item.evidenceType as EvidenceType,
        label: item.label as string,
        required: item.required ?? true,
        blocking: item.blocking ?? true,
      }));

    const pack = await createCustomPolicyPack({
      workspaceId,
      actorUserId: auth.user.id,
      name: body.name ?? "",
      description: body.description ?? null,
      sector: body.sector ?? "general",
      requiredEvidence,
      approvalRequirements: body.requiresApproval
        ? { requiresApproval: true, approvalThreshold: "release_gate_needs_review" }
        : { requiresApproval: false },
    });

    return NextResponse.json(pack, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to create custom policy");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
