import { type NextRequest, NextResponse } from "next/server";

import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";
import { enqueueAgentRun } from "@/server/queues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: RouteContext) {
  try {
    const { organizationId, userId } = await getMockSession();
    const { id } = await params;

    const original = await db.agentRun.findFirst({
      where: { id, organizationId },
      select: { agentJobId: true, status: true, attemptNumber: true },
    });

    if (!original) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (!["FAILED", "TIMEOUT", "CANCELLED"].includes(original.status)) {
      return NextResponse.json({ error: "Only failed, timed-out, or cancelled runs can be retried" }, { status: 422 });
    }

    const retryRun = await db.$transaction(async (tx) => {
      const run = await tx.agentRun.create({
        data: {
          organizationId,
          agentJobId: original.agentJobId,
          status: "QUEUED",
          triggerSource: "RETRY",
          idempotencyKey: `retry:${id}:${Date.now()}`,
          attemptNumber: original.attemptNumber + 1,
        },
        select: { id: true, status: true, triggerSource: true, attemptNumber: true, createdAt: true },
      });

      await tx.auditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          entityType: "AgentRun",
          entityId: run.id,
          action: "run.retried",
          metadataJson: { originalRunId: id, attemptNumber: run.attemptNumber },
        },
      });

      return run;
    });

    await enqueueAgentRun({ agentRunId: retryRun.id, agentJobId: original.agentJobId, organizationId });

    return NextResponse.json({ run: retryRun }, { status: 201 });
  } catch (err) {
    console.error("[agent-runs/retry]", err);
    return NextResponse.json({ error: "Failed to retry run" }, { status: 500 });
  }
}
