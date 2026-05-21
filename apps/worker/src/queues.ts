import { Queue } from "bullmq";
import IORedis from "ioredis";

export const redisConnection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

export interface AgentRunJobData {
  agentRunId: string;
  agentJobId: string;
  organizationId: string;
}

export interface SchedulerScanJobData {
  scanTime: string;
}

export const agentRunQueue = new Queue<AgentRunJobData>("agent-run-queue", {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});

export const schedulerScanQueue = new Queue<SchedulerScanJobData>("scheduler-scan-queue", {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: { count: 10 },
    removeOnFail: { count: 50 },
  },
});
