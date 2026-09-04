import { describe, expect, it } from "vitest";

import { deriveCostTrend, deriveHealth } from "~/lib/control/derive";
import type { ControlBudgetSettings, TimeRange } from "~/lib/control/model";

const now = Date.UTC(2026, 7, 20, 12);
const range: TimeRange = {
  id: "24h",
  label: "24 hours",
  durationMs: 24 * 60 * 60 * 1_000,
  bucketMs: 60 * 60 * 1_000,
  tickFormat: "time",
};
const runs = [
  {
    id: "run-ok",
    status: "completed",
    createdAt: new Date(now - 60_000).toISOString(),
    startedAt: new Date(now - 55_000).toISOString(),
    completedAt: new Date(now - 50_000).toISOString(),
    estimatedCostUsd: 3,
    totalTokens: 500,
  },
  {
    id: "run-failed",
    status: "failed",
    createdAt: new Date(now - 120_000).toISOString(),
    startedAt: new Date(now - 115_000).toISOString(),
    completedAt: new Date(now - 110_000).toISOString(),
    estimatedCostUsd: 2,
    totalTokens: 200,
  },
] as never;

describe("Control operational budgets", () => {
  it("does not fabricate failure or spend budgets when none are configured", () => {
    const health = deriveHealth(runs, runs, undefined, [], now);
    expect(health.failureBudget.target).toBeNull();
    expect(health.failureBudget.allowed).toBeNull();
    expect(health.failureBudget.burnRatio).toBeNull();
    expect(health.spend.budgetUsd).toBeNull();
    expect(health.approvals.available).toBe(false);
  });

  it("uses the saved workspace objectives in health and cost metrics", () => {
    const budget: ControlBudgetSettings = {
      configured: true,
      reliabilityTarget: 0.99,
      dailySpendLimitUsd: 24,
      approvalSlaMinutes: 120,
      updatedAt: new Date(now).toISOString(),
    };
    const health = deriveHealth(runs, runs, undefined, [], now, budget);
    const cost = deriveCostTrend(runs, range, now, budget);

    expect(health.failureBudget.target).toBe(0.99);
    expect(health.failureBudget.allowed).toBeCloseTo(0.02);
    expect(health.failureBudget.burnRatio).toBeCloseTo(50);
    expect(health.spend.budgetUsd).toBe(24);
    expect(health.approvals.oldestSlaMs).toBe(120 * 60_000);
    expect(cost.budgetPerBucketUsd).toBe(1);
  });

  it("uses the authoritative workspace queue telemetry", () => {
    const metrics = { workspace: { queued: 18, inFlight: 0 } } as never;
    const health = deriveHealth([], [], metrics, [], now);
    expect(health.inFlight.queued).toBe(18);
  });

  it("derives approval aging from pending approvals", () => {
    const budget: ControlBudgetSettings = {
      configured: true,
      reliabilityTarget: null,
      dailySpendLimitUsd: null,
      approvalSlaMinutes: 120,
      updatedAt: new Date(now).toISOString(),
    };
    const approvals = [{
      id: "approval-1",
      status: "PENDING",
      requestedAt: new Date(now - 60 * 60_000).toISOString(),
    }] as never;
    const health = deriveHealth([], [], undefined, [], now, budget, approvals);

    expect(health.approvals.available).toBe(true);
    expect(health.approvals.count).toBe(1);
    expect(health.approvals.oldestWaitedMs).toBe(60 * 60_000);
    expect(health.approvals.pressured).toBe(true);
    expect(health.approvals.breached).toBe(0);
  });
});
