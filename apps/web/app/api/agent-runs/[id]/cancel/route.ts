import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// ─── POST /api/agent-runs/:id/cancel ────────────────────────────────────────
//
// Cancels an active run. Also expires any pending approval requests so the
// approvals inbox stays clean.
//
// Allowed current statuses: QUEUED | RUNNING | WAITING_FOR_APPROVAL

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const { organizationId, userId } = await getMockSession();
    const { id } = await params;

    const run = await db.agentRun.findFirst({
      where: { id, organizationId },
      select: {
        status: true,
        agentJobId: true,
        approvalRequests: {
          where: { status: "PENDING" },
          select: { id: true },
        },
      },
    });

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const cancellableStatuses = ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"];
    if (!cancellableStatuses.includes(run.status)) {
      return NextResponse.json(
        {
          error: "Run cannot be cancelled",
          detail: `Only ${cancellableStatuses.join(", ")} runs can be cancelled. This run is ${run.status}.`,
        },
        { status: 422 },
      );
    }

    const now = new Date();
    const pendingApprovalIds = run.approvalRequests.map((a) => a.id);

    await db.$transaction([
      // Cancel the run
      db.agentRun.update({
        where: { id },
        data: {
          status: "CANCELLED",
          finishedAt: now,
          errorMessage: "Cancelled by user.",
        },
      }),

      // Expire any pending approval requests so they vanish from the inbox
      ...(pendingApprovalIds.length > 0
        ? [
            db.approvalRequest.updateMany({
              where: { id: { in: pendingApprovalIds } },
              data: {
                status: "EXPIRED",
                decidedAt: now,
                decidedByUserId: userId,
                decisionReason: "Run was cancelled by user.",
              },
            }),
          ]
        : []),

      // Audit log
      db.auditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          entityType: "AgentRun",
          entityId: id,
          action: "run.cancelled",
          metadataJson: {
            previousStatus: run.status,
            expiredApprovalIds: pendingApprovalIds,
          },
        },
      }),
    ]);

    return NextResponse.json({
      id,
      status: "CANCELLED",
      expiredApprovals: pendingApprovalIds.length,
    });
  } catch (err) {
    console.error("[agent-runs/cancel]", err);
    return NextResponse.json({ error: "Failed to cancel run" }, { status: 500 });
  }
}
