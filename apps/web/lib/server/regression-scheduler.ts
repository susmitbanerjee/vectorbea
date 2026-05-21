import "server-only";

import { runDueRegressionSchedules } from "@/lib/server/regression-schedules";

declare global {
  var __vectorbeaRegressionScheduler: { started: boolean; timer?: ReturnType<typeof setInterval> } | undefined;
}

const DEFAULT_INTERVAL_MS = 60_000;

export function startRegressionScheduler() {
  if (process.env.VECTORBEA_REGRESSION_SCHEDULER === "disabled") return;
  if (globalThis.__vectorbeaRegressionScheduler?.started) return;

  const intervalMs = Number(process.env.VECTORBEA_REGRESSION_SCHEDULER_INTERVAL_MS ?? DEFAULT_INTERVAL_MS);
  const safeInterval = Number.isFinite(intervalMs) && intervalMs >= 15_000 ? intervalMs : DEFAULT_INTERVAL_MS;

  globalThis.__vectorbeaRegressionScheduler = { started: true };

  const tick = async () => {
    try {
      await runDueRegressionSchedules("built-in-scheduler");
    } catch (error) {
      console.warn("[regression-scheduler] due schedule check failed", error instanceof Error ? error.message : "unknown error");
    }
  };

  void tick();
  globalThis.__vectorbeaRegressionScheduler.timer = setInterval(tick, safeInterval);
}
