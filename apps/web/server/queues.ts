import "server-only";

import { Queue } from "bullmq";
import IORedis from "ioredis";

interface AgentRunJobData {
  agentRunId: string;
  agentJobId: string;
  organizationId: string;
}

let _queue: Queue<AgentRunJobData> | null = null;

function getQueue(): Queue<AgentRunJobData> {
  if (_queue) return _queue;
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });
  _queue = new Queue<AgentRunJobData>("agent-run-queue", { connection });
  return _queue;
}

export async function enqueueAgentRun(data: AgentRunJobData): Promise<void> {
  try {
    const queue = getQueue();
    await queue.add("execute-run", data, {
      jobId: data.agentRunId,
      attempts: 4,
      backoff: { type: "exponential", delay: 30_000 },
    });
  } catch (err) {
    // Redis may not be available in all environments; log and continue.
    // The run record is already QUEUED in the DB and can be picked up later.
    console.error("[queues] failed to enqueue agent run:", err);
  }
}
