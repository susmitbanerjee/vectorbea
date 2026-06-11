import "server-only";

import { db } from "@/server/db";
import { enqueueAgentRun } from "@/server/queues";

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class RetryBlockedError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "NOT_FOUND"
      | "INVALID_STATUS"
      | "JOB_ARCHIVED"
      | "JOB_PAUSED"
      | "MAX_RETRIES_EXCEEDED"
      | "BUDGET_RUNS_DAY"
      | "BUDGET_RUNS_MONTH",
  ) {
    super(message);
    this.name = "RetryBlockedError";
  }
}

export const RETRYABLE_STATUSES = ["FAILED", "TIMEOUT", "CANCELLED"] as const;
export type RetryableStatus = (typeof RETRYABLE_STATUSES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// retryAgentRun
// ─────────────────────────────────────────────────────────────────────────────

export interface RetryOptions {
  /** If true, retry a PAUSED job after showing a warning (caller already confirmed). */
  forcePaused?: boolean;
}

export async function retryAgentRun(
  organizationId: string,
  userId: string,
  runId: string,
  opts: RetryOptions = {},
): Promise<{ runId: string; attemptNumber: number; warnings: string[] }> {
  const warnings: string[] = [];

  // ── 1. Load the original run + job + budget ──────────────────────────────
  const original = await db.agentRun.findFirst({
    where: { id: runId, organizationId },
    select: {
      id: true,
      status: true,
      attemptNumber: true,
      inputJson: true,
      agentJobId: true,
      originalRunId: true,      // null if this IS the original
      agentJob: {
        select: {
          id: true,
          name: true,
          status: true,
          maxRetries: true,
          budgetPolicy: {
            select: {
              maxRunsPerDay: true,
              maxRunsPerMonth: true,
            },
          },
        },
      },
    },
  });

  if (!original) {
    throw new RetryBlockedError("Run not found.", "NOT_FOUND");
  }

  // ── 2. Status check ───────────────────────────────────────────────────────
  if (!(RETRYABLE_STATUSES as readonly string[]).includes(original.status)) {
    throw new RetryBlockedError(
      `Only failed, timed-out, or cancelled runs can be retried. This run is ${original.status}.`,
      "INVALID_STATUS",
    );
  }

  const job = original.agentJob;

  // ── 3. Job status checks ─────────────────────────────────────────────────
  if (job.status === "ARCHIVED") {
    throw new RetryBlockedError(
      `Job "${job.name}" is archived. Restore the job before retrying.`,
      "JOB_ARCHIVED",
    );
  }

  if (job.status === "PAUSED") {
    if (!opts.forcePaused) {
      throw new RetryBlockedError(
        `Job "${job.name}" is paused. Pass forcePaused=true to retry anyway.`,
        "JOB_PAUSED",
      );
    }
    warnings.push(`Job "${job.name}" is paused. The retry run was created but the job must be resumed before it executes.`);
  }

  // ── 4. Max retries check ──────────────────────────────────────────────────
  // attemptNumber on the run being retried IS the attempt count so far.
  // The new run will be attemptNumber + 1.
  const nextAttempt = original.attemptNumber + 1;
  if (job.maxRetries > 0 && original.attemptNumber >= job.maxRetries) {
    // Log blocked attempt audit before throwing
    await db.auditLog.create({
      data: {
        organizationId,
        actorUserId: userId,
        entityType: "AgentRun",
        entityId: runId,
        action: "retry.blocked.max_attempts",
        metadataJson: {
          attemptNumber: original.attemptNumber,
          maxRetries: job.maxRetries,
          agentJobId: job.id,
        },
      },
    });
    throw new RetryBlockedError(
      `Maximum retry limit reached (${job.maxRetries} attempts). Update the job's maxRetries setting to allow more.`,
      "MAX_RETRIES_EXCEEDED",
    );
  }

  // ── 5. Budget policy checks ───────────────────────────────────────────────
  if (original.agentJob.budgetPolicy) {
    const policy = original.agentJob.budgetPolicy;
    const now = new Date();

    if (policy.maxRunsPerDay != null) {
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const runsToday = await db.agentRun.count({
        where: { agentJobId: job.id, createdAt: { gte: dayStart } },
      });
      if (runsToday >= policy.maxRunsPerDay) {
        await db.auditLog.create({
          data: {
            organizationId,
            actorUserId: userId,
            entityType: "AgentRun",
            entityId: runId,
            action: "retry.blocked.budget_day",
            metadataJson: { runsToday, maxRunsPerDay: policy.maxRunsPerDay, agentJobId: job.id },
          },
        });
        throw new RetryBlockedError(
          `Daily run limit reached (${runsToday}/${policy.maxRunsPerDay} runs today). Try again tomorrow or increase the budget limit.`,
          "BUDGET_RUNS_DAY",
        );
      }
    }

    if (policy.maxRunsPerMonth != null) {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const runsThisMonth = await db.agentRun.count({
        where: { agentJobId: job.id, createdAt: { gte: monthStart } },
      });
      if (runsThisMonth >= policy.maxRunsPerMonth) {
        await db.auditLog.create({
          data: {
            organizationId,
            actorUserId: userId,
            entityType: "AgentRun",
            entityId: runId,
            action: "retry.blocked.budget_month",
            metadataJson: {
              runsThisMonth,
              maxRunsPerMonth: policy.maxRunsPerMonth,
              agentJobId: job.id,
            },
          },
        });
        throw new RetryBlockedError(
          `Monthly run limit reached (${runsThisMonth}/${policy.maxRunsPerMonth} runs this month). Increase the budget limit or wait until next month.`,
          "BUDGET_RUNS_MONTH",
        );
      }
    }
  }

  // ── 6. Derive the root original run ID ───────────────────────────────────
  // Always point back to the first run in the chain, not just the immediate parent.
  const rootOriginalRunId = original.originalRunId ?? original.id;

  // ── 7. Build idempotency key (deterministic — not timestamp-based) ────────
  // Using root original + next attempt prevents duplicate retries if the
  // user double-clicks.
  const idempotencyKey = `retry:${rootOriginalRunId}:attempt:${nextAttempt}`;

  // ── 8. Create retry run + audit log (atomic) ─────────────────────────────
  const retryRun = await db.$transaction(async (tx) => {
    const run = await tx.agentRun.create({
      data: {
        organizationId,
        agentJobId: job.id,
        status: "QUEUED",
        triggerSource: "RETRY",
        attemptNumber: nextAttempt,
        idempotencyKey,
        originalRunId: rootOriginalRunId,
        inputJson: original.inputJson ?? undefined,
      },
      select: {
        id: true,
        status: true,
        triggerSource: true,
        attemptNumber: true,
        idempotencyKey: true,
        originalRunId: true,
        createdAt: true,
      },
    });

    await tx.auditLog.create({
      data: {
        organizationId,
        actorUserId: userId,
        entityType: "AgentRun",
        entityId: run.id,
        action: "retry.requested",
        metadataJson: {
          originalRunId: runId,
          rootOriginalRunId,
          attemptNumber: run.attemptNumber,
          agentJobId: job.id,
          forcedPaused: opts.forcePaused ?? false,
        },
      },
    });

    return run;
  });

  // ── 9. Enqueue (best-effort — run is already QUEUED in DB) ───────────────
  await enqueueAgentRun({
    agentRunId: retryRun.id,
    agentJobId: job.id,
    organizationId,
  });

  return {
    runId: retryRun.id,
    attemptNumber: retryRun.attemptNumber,
    warnings,
  };
}
