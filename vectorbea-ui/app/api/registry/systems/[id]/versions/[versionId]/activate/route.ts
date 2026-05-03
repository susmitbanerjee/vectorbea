import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { activateVersionWithGateCheck } from "@/lib/server/evidence-runs";
import { writeAuditEvent } from "@/lib/server/audit-events";
import { toSafeApiError } from "@/lib/server/safe-api-errors";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const workspaceId = request.nextUrl.searchParams.get("workspaceId")?.trim();
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    const auth = await assertWorkspaceMember(request, workspaceId);
    if (auth.error) return auth.error;
    const { versionId } = await params;

    const result = await activateVersionWithGateCheck({
      workspaceId,
      versionId,
      actorUserId: auth.user.id,
    });

    if (!result.ok) {
      await writeAuditEvent({
        workspaceId,
        actorUserId: auth.user.id,
        eventType: "release_blocked",
        entityType: "capability_version",
        entityId: versionId,
        metadata: { decision: result.decision, reasons: result.reasons },
        ipAddress: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent"),
      });
      return NextResponse.json(
        { error: "Release gate check failed", decision: result.decision, reasons: result.reasons },
        { status: 422 },
      );
    }

    return NextResponse.json(result.version);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to activate version");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
