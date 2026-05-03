import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { applyPolicyPackToCapability, listPolicyPacks, writeAuditEvent } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json([]);
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const supabase = createVectorBeaAdminClient();
    const { data, error } = await supabase
      .from("capability_policy_pack_assignments")
      .select("id, policy_pack_id, status, applied_by, created_at")
      .eq("workspace_id", workspaceId)
      .eq("capability_id", id)
      .order("created_at", { ascending: false });
    if (error) {
      if (error.message.includes("does not exist")) return NextResponse.json([]);
      throw new Error(error.message);
    }
    // Enrich with pack names
    const packIds = (data ?? []).map((r) => String(r.policy_pack_id));
    if (packIds.length === 0) return NextResponse.json([]);
    const { data: packs } = await supabase
      .from("policy_packs")
      .select("id, name, sector")
      .in("id", packIds);
    const packMap = new Map((packs ?? []).map((p) => [String(p.id), p]));
    const enriched = (data ?? []).map((row) => {
      const pack = packMap.get(String(row.policy_pack_id));
      return {
        id: row.id,
        workspaceId,
        aiSystemId: id,
        policyPackId: row.policy_pack_id,
        policyPackName: pack?.name ?? null,
        policyPackSector: pack?.sector ?? null,
        status: row.status ?? "active",
        appliedBy: row.applied_by,
        appliedAt: row.created_at,
      };
    });
    return NextResponse.json(enriched);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load policy assignments");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { policyPackId?: string };
    if (!body.policyPackId) return NextResponse.json({ error: "policyPackId is required" }, { status: 400 });
    const pack = await applyPolicyPackToCapability({
      workspaceId,
      capabilityId: id,
      policyPackId: body.policyPackId,
      actorUserId: auth.user.id,
    });
    return NextResponse.json(pack, { status: 201 });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to apply policy pack");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { id } = await params;
    const policyPackId = request.nextUrl.searchParams.get("policyPackId")?.trim();
    if (!policyPackId) return NextResponse.json({ error: "policyPackId is required" }, { status: 400 });
    const supabase = createVectorBeaAdminClient();
    const { error } = await supabase
      .from("capability_policy_pack_assignments")
      .update({ status: "disabled" })
      .eq("workspace_id", workspaceId)
      .eq("capability_id", id)
      .eq("policy_pack_id", policyPackId);
    if (error) throw new Error(error.message);
    await writeAuditEvent({
      workspaceId,
      actorUserId: auth.user.id,
      eventType: "policy_pack_removed",
      entityType: "policy_pack",
      entityId: policyPackId,
      metadata: { capability_id: id },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to remove policy pack");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
