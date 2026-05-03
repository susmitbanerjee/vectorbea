import { NextRequest, NextResponse } from "next/server";

import { assertWorkspaceMember } from "@/lib/server/assert-workspace-member";
import { computeReleaseGate } from "@/lib/server/evidence-runs";
import { toSafeApiError } from "@/lib/server/safe-api-errors";
import { writeAuditEvent } from "@/lib/server/audit-events";

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
    const gate = await computeReleaseGate(workspaceId, versionId);

    // Write audit event for gate evaluation
    await writeAuditEvent({
      workspaceId,
      actorUserId: auth.user.id,
      eventType: "release_gate_evaluated",
      entityType: "capability_version",
      entityId: versionId,
      metadata: {
        decision: gate.decision,
        reasons: gate.reasons,
        checks_count: gate.checks.length,
      },
      ipAddress: request.headers.get("x-forwarded-for"),
      userAgent: request.headers.get("user-agent"),
    });

    if (gate.decision === "blocked") {
      await writeAuditEvent({
        workspaceId,
        actorUserId: auth.user.id,
        eventType: "release_blocked",
        entityType: "capability_version",
        entityId: versionId,
        metadata: { reasons: gate.reasons },
      });
    }

    return NextResponse.json(gate);
  } catch (error) {
    const safe = toSafeApiError(error, "Failed to compute release gate");
    return NextResponse.json({ error: safe.message, code: safe.code }, { status: safe.status });
  }
}
