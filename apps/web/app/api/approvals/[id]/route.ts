import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { organizationId, userId } = await getMockSession();
    const { id } = await params;

    let body: { action: "approve" | "reject"; reason?: string };
    try {
      body = await request.json() as typeof body;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (!["approve", "reject"].includes(body.action)) {
      return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 422 });
    }

    const approval = await db.approvalRequest.findFirst({
      where: { id, organizationId, status: "PENDING" },
      select: { id: true, agentRunId: true },
    });

    if (!approval) return NextResponse.json({ error: "Approval request not found or already decided" }, { status: 404 });

    const newStatus = body.action === "approve" ? "APPROVED" : "REJECTED";
    const now = new Date();

    await db.$transaction([
      db.approvalRequest.update({
        where: { id },
        data: {
          status: newStatus,
          decidedAt: now,
          decidedByUserId: userId,
          decisionReason: body.reason ?? null,
        },
      }),
      // If rejected, mark the run as CANCELLED
      ...(newStatus === "REJECTED"
        ? [
            db.agentRun.update({
              where: { id: approval.agentRunId },
              data: { status: "CANCELLED", finishedAt: now },
            }),
          ]
        : []),
      db.auditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          entityType: "ApprovalRequest",
          entityId: id,
          action: `approval.${body.action}d`,
          metadataJson: { agentRunId: approval.agentRunId, reason: body.reason },
        },
      }),
    ]);

    return NextResponse.json({ id, status: newStatus });
  } catch (err) {
    console.error("[approvals/[id]]", err);
    return NextResponse.json({ error: "Failed to process approval" }, { status: 500 });
  }
}
