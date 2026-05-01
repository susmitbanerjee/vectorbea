import { after, NextRequest, NextResponse } from "next/server";

import type { CapabilityVersionStatus } from "@/lib/api";
import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { getVersion, updateVersionStatus } from "@/lib/server/ai-capabilities";
import { assertFeatureAccess } from "@/lib/server/feature-gates";
import { writeAuditEvent } from "@/lib/server/governance";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { autoTriggerRegressionSuitesForCandidate } from "@/lib/server/workflow-regressions";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { versionId } = await params;
    const version = await getVersion(workspaceId, versionId);
    if (!version) return NextResponse.json({ error: "Version not found" }, { status: 404 });
    return NextResponse.json(version);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to load version");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    await assertFeatureAccess(workspaceId, "ai_capabilities");
    const { versionId } = await params;
    const body = (await request.json().catch(() => ({}))) as { status?: CapabilityVersionStatus };
    if (!body.status) return NextResponse.json({ error: "status is required" }, { status: 400 });
    const version = await updateVersionStatus(workspaceId, versionId, body.status);
    await writeAuditEvent({
      workspaceId,
      actorUserId: auth.user.id,
      eventType:
        body.status === "candidate" ? "capability_version_promoted" :
        body.status === "active" ? "capability_version_activated" :
        body.status === "deprecated" ? "capability_version_deprecated" :
        "capability_version_updated",
      entityType: "capability_version",
      entityId: version.id,
      entityName: version.versionNumber,
      metadata: { capability_id: version.capabilityId, status: version.status },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });
    if (body.status === "candidate") {
      after(async () => {
        try {
          await autoTriggerRegressionSuitesForCandidate({
            workspaceId,
            capabilityId: version.capabilityId,
            capabilityVersionId: version.id,
            startedBy: auth.user.id,
          });
        } catch (error) {
          console.warn("[workflow-regression] candidate promotion trigger failed:", error instanceof Error ? error.message : String(error));
        }
      });
    }
    return NextResponse.json(version);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to update version");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
