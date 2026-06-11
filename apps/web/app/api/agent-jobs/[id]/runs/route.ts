import { type NextRequest } from "next/server";

import { created, handleServiceError, badRequest } from "@/server/api-response";
import { getMockSession } from "@/server/auth/mock-session";
import { db } from "@/server/db";
import { enqueueAgentRun } from "@/server/queues";
import { NotFoundError } from "@/server/services/agent-jobs";
import { checkCanStartRun } from "@/server/services/budget-policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

// ─── POST /api/agent-jobs/:id/runs ───────────────────────────────────────────
// Enqueues a manual run.
// Runs the budget pre-check before creating the run record.

export async function POST(_request: NextRequest, { params }: RouteContext) {
  try {
    const session = await getMockSession();
    const { id: jobId } = await params;

    const job = await db.agentJob.findFirst({
      where: { id: jobId, organizationId: session.organizationId },
      select: { id: true, status: true, name: true },
    });

    if (!job) throw new NotFoundError(`Agent job ${jobId} not found.`);
    if (job.status === "ARCHIVED") return badRequest("Archived jobs cannot be run.");
    if (job.status === "PAUSED") return badRequest("Paused jobs cannot be run. Resume the job first.");

    // ── Budget pre-check ────────────────────────────────────────────────────
    const violation = await checkCanStartRun(jobId, session.organizationId, session.userId);
    if (violation) {
      return badRequest(violation.message, { code: violation.field });
    }

    const now = new Date();
    const idempotencyKey = `manual:${session.userId}:${now.toISOString()}`;

    const agentRun = await db.$transaction(async (tx) => {
      const run = await tx.agentRun.create({
        data: {
          organizationId: session.organizationId,
          agentJobId: jobId,
          status: "QUEUED",
          triggerSource: "MANUAL",
          idempotencyKey,
        },
        select: {
          id: true,
          status: true,
          triggerSource: true,
          attemptNumber: true,
          idempotencyKey: true,
          createdAt: true,
        },
      });

      await tx.auditLog.create({
        data: {
          organizationId: session.organizationId,
          actorUserId: session.userId,
          entityType: "AgentRun",
          entityId: run.id,
          action: "run.queued",
          metadataJson: { triggerSource: "MANUAL", jobId, jobName: job.name },
        },
      });

      return run;
    });

    await enqueueAgentRun({
      agentRunId: agentRun.id,
      agentJobId: jobId,
      organizationId: session.organizationId,
    });

    return created({ run: agentRun });
  } catch (error) {
    return handleServiceError(error, "Failed to trigger agent run.");
  }
}
