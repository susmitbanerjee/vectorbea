import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { writeAuditEvent } from "@/lib/server/audit-events";
import { computeReleaseGate } from "@/lib/server/evidence-runs";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/evidence/gate?workspaceId=...&versionId=...
 * Computes the release gate for a version, also returning the version object.
 * Used by the release gate detail page that only knows the versionId.
 */
export async function GET(request: NextRequest) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;

    const versionId = request.nextUrl.searchParams.get("versionId")?.trim();
    if (!versionId) return NextResponse.json({ error: "versionId is required" }, { status: 400 });

    // Load version for display info
    const supabase = createVectorBeaAdminClient();
    const { data: verData } = await supabase
      .from("capability_versions")
      .select("id, workspace_id, capability_id, version_number, name, status, created_at, updated_at, activated_at, deprecated_at, created_by")
      .eq("workspace_id", workspaceId)
      .eq("id", versionId)
      .maybeSingle();

    const gate = await computeReleaseGate(workspaceId, versionId);
    await writeAuditEvent({
      workspaceId,
      actorUserId: auth.user.id,
      eventType: "release_gate_evaluated",
      entityType: "capability_version",
      entityId: versionId,
      metadata: {
        decision: gate.decision,
        ai_system_id: gate.aiSystemId,
        reasons: gate.reasons,
      },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    }).catch((error) => {
      console.error("[release-gate] audit write failed:", error);
    });

    return NextResponse.json({ ...gate, version: verData ?? null });
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to compute release gate");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
