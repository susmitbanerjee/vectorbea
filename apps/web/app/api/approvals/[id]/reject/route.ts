import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// ─── POST /api/approvals/:id/reject ─────────────────────────────────────────
// Rejects a pending approval request and cancels the agent run.
//
// Request body: { reason?: string }
//
// Behavior:
//   1. Guard: approval must be PENDING and belong to this org
//   2. Mark ApprovalRequest REJECTED (with decidedAt + decidedByUserId)
//   3. Mark AgentRun CANCELLED with rejection reason
//   4. Write AuditLog

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { organizationId, userId } = await getMockSession();
    const { id } = await params;

    let reason: string | undefined;
    try {
      const body = (await request.json()) as { reason?: string };
      reason = typeof body.reason === "string" ? body.reason.trim() || undefined : undefined;
    } catch {
      // body is optional
    }

    // ── 1. Load approval (must be PENDING + org-scoped) ─────────────────────
    const approval = await db.approvalRequest.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        status: true,
        agentRunId: true,
      },
    });

    if (!approval) {
      return NextResponse.json({ error: "Approval request not found" }, { status: 404 });
    }

    if (approval.status !== "PENDING") {
      return NextResponse.json(
        {
          error: "Approval already decided",
          detail: `This request was already ${approval.status.toLowerCase()}.`,
          currentStatus: approval.status,
        },
        { status: 409 },
      );
    }

    const now = new Date();
    const errorMessage = reason
      ? `Rejected: ${reason}`
      : "Run cancelled — approval request was rejected.";

    // ── 2–4. Reject + cancel run + audit log (atomic) ────────────────────────
    await db.$transaction([
      db.approvalRequest.update({
        where: { id },
        data: {
          status: "REJECTED",
          decidedAt: now,
          decidedByUserId: userId,
          decisionReason: reason ?? null,
        },
      }),
      db.agentRun.update({
        where: { id: approval.agentRunId },
        data: {
          status: "CANCELLED",
          finishedAt: now,
          errorMessage,
        },
      }),
      db.auditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          entityType: "ApprovalRequest",
          entityId: id,
          action: "approval.rejected",
          metadataJson: {
            agentRunId: approval.agentRunId,
            reason: reason ?? null,
          },
        },
      }),
    ]);

    return NextResponse.json({
      id,
      status: "REJECTED",
      agentRunId: approval.agentRunId,
    });
  } catch (err) {
    console.error("[approvals/[id]/reject]", err);
    return NextResponse.json({ error: "Failed to reject request" }, { status: 500 });
  }
}
