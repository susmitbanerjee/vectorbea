import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const { organizationId, userId } = await getMockSession();
    const { id } = await params;

    const run = await db.agentRun.findFirst({
      where: { id, organizationId },
      select: { status: true, agentJobId: true },
    });

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (!["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"].includes(run.status)) {
      return NextResponse.json({ error: "Only active runs can be cancelled" }, { status: 422 });
    }

    await db.$transaction([
      db.agentRun.update({
        where: { id },
        data: { status: "CANCELLED", finishedAt: new Date() },
      }),
      db.auditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          entityType: "AgentRun",
          entityId: id,
          action: "run.cancelled",
          metadataJson: { previousStatus: run.status },
        },
      }),
    ]);

    return NextResponse.json({ id, status: "CANCELLED" });
  } catch (err) {
    console.error("[agent-runs/cancel]", err);
    return NextResponse.json({ error: "Failed to cancel run" }, { status: 500 });
  }
}
