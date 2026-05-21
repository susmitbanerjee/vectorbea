import { schedulerScanQueue } from "./queues";
import { createExecutorWorker } from "./executor";
import { createSchedulerWorker } from "./scheduler";

async function main() {
  console.log("[worker] Vectorbea Agent Scheduler starting...");

  // Register the scheduler scan as a repeatable job — runs every minute
  await schedulerScanQueue.upsertJobScheduler(
    "scheduler-scan",
    { every: 60_000 },
    { name: "scheduler-scan", data: { scanTime: new Date().toISOString() } },
  );

  const schedulerWorker = createSchedulerWorker();
  const executorWorker = createExecutorWorker();

  console.log("[worker] scheduler and executor workers started");

  async function shutdown(signal: string) {
    console.log(`[worker] received ${signal}, shutting down gracefully...`);
    await schedulerWorker.close();
    await executorWorker.close();
    console.log("[worker] shutdown complete");
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] fatal error during startup:", err);
  process.exit(1);
});
