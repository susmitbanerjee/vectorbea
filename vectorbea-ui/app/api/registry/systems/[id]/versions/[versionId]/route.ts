import { NextRequest, NextResponse } from "next/server";

import type { CapabilityVersionStatus } from "@/lib/api";
import { assertWorkspaceMember, requireWorkspaceRole } from "@/lib/server/assert-workspace-member";
import { updateVersionStatus } from "@/lib/server/ai-capabilities";
import { writeAuditEvent } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { versionId } = await params;
    const body = (await request.json().catch(() => ({}))) as { status?: CapabilityVersionStatus };
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 });
    const requiredRole = body.status === "approved" || body.status === "active" || body.status === "deprecated" ? "admin" : "editor";
    const roleError = requireWorkspaceRole(
      auth.user.role,
      requiredRole,
      body.status === "approved" || body.status === "active"
        ? "Only workspace admins can approve or activate versions."
        : "Viewers cannot update versions.",
    );
    if (roleError) return roleError;

    const version = await updateVersionStatus(workspaceId, versionId, body.status);

    await writeAuditEvent({
      workspaceId,
      actorUserId: auth.user.id,
      eventType:
        body.status === "candidate" ? "capability_version_promoted" :
        body.status === "approved"  ? "capability_version_approved" :
        body.status === "active"    ? "capability_version_activated" :
        body.status === "deprecated" ? "capability_version_deprecated" :
        "capability_version_updated",
      entityType: "capability_version",
      entityId: version.id,
      entityName: version.versionNumber,
      metadata: { capability_id: version.capabilityId, status: version.status },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });

    return NextResponse.json(version);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update version");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
