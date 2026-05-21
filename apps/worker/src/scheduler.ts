import { Worker } from "bullmq";
import { parseExpression } from "cron-parser";
import { db } from "./db";
import { agentRunQueue, redisConnection, type SchedulerScanJobData } from "./queues";

function getScheduledTimeWindow(cronExpression: string, timezone: string): string {
  try {
    const interval = parseExpression(cronExpression, {
      tz: timezone,
      currentDate: new Date(),
    });
    const prev = interval.prev().toDate();
    // Round down to the nearest minute
    prev.setSeconds(0, 0);
    return prev.toISOString();
  } catch {
    return new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
  }
}

export function createSchedulerWorker() {
  const worker = new Worker<SchedulerScanJobData>(
    "scheduler-scan-queue",
    async () => {
      const now = new Date();
      console.log(`[scheduler] scan at ${now.toISOString()}`);

      const activeJobs = await db.agentJob.findMany({
        where: { status: "ACTIVE", triggerType: "CRON", cronExpression: { not: null } },
        select: {
          id: true,
          organizationId: true,
          cronExpression: true,
          timezone: true,
          budgetPolicy: {
            select: { maxRunsPerDay: true, maxRunsPerMonth: true },
          },
        },
      });

      let enqueued = 0;
      for (const job of activeJobs) {
        if (!job.cronExpression) continue;

        try {
          const isDue = checkIfDue(job.cronExpression, job.timezone, now);
          if (!isDue) continue;

          const timeWindow = getScheduledTimeWindow(job.cronExpression, job.timezone);
          const idempotencyKey = `schedule:${timeWindow}`;

          // Check daily/monthly budget limits
          if (job.budgetPolicy) {
            const { maxRunsPerDay, maxRunsPerMonth } = job.budgetPolicy;
            if (maxRunsPerDay != null) {
              const dayStart = new Date(now);
              dayStart.setHours(0, 0, 0, 0);
              const runsToday = await db.agentRun.count({
                where: {
                  agentJobId: job.id,
                  createdAt: { gte: dayStart },
                  status: { in: ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "SUCCEEDED"] },
                },
              });
              if (runsToday >= maxRunsPerDay) {
                console.log(`[scheduler] job ${job.id} hit maxRunsPerDay limit (${maxRunsPerDay})`);
                continue;
              }
            }
            if (maxRunsPerMonth != null) {
              const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
              const runsThisMonth = await db.agentRun.count({
                where: {
                  agentJobId: job.id,
                  createdAt: { gte: monthStart },
                  status: { in: ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "SUCCEEDED"] },
                },
              });
              if (runsThisMonth >= maxRunsPerMonth) {
                console.log(`[scheduler] job ${job.id} hit maxRunsPerMonth limit (${maxRunsPerMonth})`);
                continue;
              }
            }
          }

          // Create AgentRun record — the unique constraint on (agentJobId, idempotencyKey)
          // prevents duplicates if the scheduler fires twice in the same window.
          let agentRun: { id: string };
          try {
            agentRun = await db.agentRun.create({
              data: {
                organizationId: job.organizationId,
                agentJobId: job.id,
                status: "QUEUED",
                triggerSource: "SCHEDULE",
                idempotencyKey,
              },
              select: { id: true },
            });
          } catch (err: unknown) {
            // Unique constraint violation — already enqueued for this window
            if (isUniqueConstraintError(err)) continue;
            throw err;
          }

          await agentRunQueue.add(
            "execute-run",
            { agentRunId: agentRun.id, agentJobId: job.id, organizationId: job.organizationId },
            { jobId: agentRun.id },
          );

          await db.auditLog.create({
            data: {
              organizationId: job.organizationId,
              entityType: "AgentRun",
              entityId: agentRun.id,
              action: "run.queued",
              metadataJson: { triggerSource: "SCHEDULE", idempotencyKey },
            },
          });

          enqueued++;
        } catch (err) {
          console.error(`[scheduler] failed to process job ${job.id}:`, err);
        }
      }

      if (enqueued > 0) {
        console.log(`[scheduler] enqueued ${enqueued} run(s)`);
      }
    },
    { connection: redisConnection, concurrency: 1 },
  );

  worker.on("failed", (job, err) => {
    console.error(`[scheduler] scan job failed:`, err);
  });

  return worker;
}

function checkIfDue(cronExpression: string, timezone: string, now: Date): boolean {
  try {
    const interval = parseExpression(cronExpression, {
      tz: timezone,
      currentDate: now,
    });
    const prev = interval.prev().toDate();
    // Due if the most recent scheduled time was within the last 90 seconds
    // (gives a buffer if the scheduler fires slightly late)
    const diffMs = now.getTime() - prev.getTime();
    return diffMs >= 0 && diffMs < 90_000;
  } catch {
    return false;
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}
