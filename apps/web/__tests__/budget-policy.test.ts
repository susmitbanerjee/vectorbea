/**
 * Budget policy — unit tests for limit arithmetic and violation message formatting.
 *
 * All tests are pure (no DB, no Next.js runtime).
 * We test the exported types and the pure logic that mirrors service calculations.
 */

import { describe, expect, it } from "vitest";

import type {
  BudgetPolicy,
  BudgetViolation,
  RunUsageViolation,
} from "@/server/services/budget-policy";

// ─────────────────────────────────────────────────────────────────────────────
// Limit check arithmetic (mirrors checkCanStartRun logic)
// ─────────────────────────────────────────────────────────────────────────────

function checkRunsPerDay(
  runsToday: number,
  policy: Pick<BudgetPolicy, "maxRunsPerDay">,
): BudgetViolation | null {
  if (policy.maxRunsPerDay == null) return null;
  if (runsToday >= policy.maxRunsPerDay) {
    return {
      field: "maxRunsPerDay",
      limit: policy.maxRunsPerDay,
      current: runsToday,
      message: `Run blocked: daily run limit exceeded (${runsToday}/${policy.maxRunsPerDay} runs today).`,
      auditAction: "budget.blocked.runs_day",
    };
  }
  return null;
}

function checkRunsPerMonth(
  runsThisMonth: number,
  policy: Pick<BudgetPolicy, "maxRunsPerMonth">,
): BudgetViolation | null {
  if (policy.maxRunsPerMonth == null) return null;
  if (runsThisMonth >= policy.maxRunsPerMonth) {
    return {
      field: "maxRunsPerMonth",
      limit: policy.maxRunsPerMonth,
      current: runsThisMonth,
      message: `Run blocked: monthly run limit exceeded (${runsThisMonth}/${policy.maxRunsPerMonth} runs this month).`,
      auditAction: "budget.blocked.runs_month",
    };
  }
  return null;
}

function checkTokensPerRun(
  totalTokens: number | null,
  policy: Pick<BudgetPolicy, "maxTokensPerRun">,
): RunUsageViolation | null {
  if (policy.maxTokensPerRun == null || totalTokens == null) return null;
  if (totalTokens > policy.maxTokensPerRun) {
    return {
      field: "maxTokensPerRun",
      limit: policy.maxTokensPerRun,
      actual: totalTokens,
      message: `Run failed: token usage (${totalTokens.toLocaleString()}) exceeded maxTokensPerRun (${policy.maxTokensPerRun.toLocaleString()}).`,
      auditAction: "budget.exceeded.tokens",
    };
  }
  return null;
}

function checkCostPerRun(
  costUsd: number | null,
  policy: Pick<BudgetPolicy, "maxCostUsdPerRun">,
): RunUsageViolation | null {
  if (policy.maxCostUsdPerRun == null || costUsd == null) return null;
  if (costUsd > policy.maxCostUsdPerRun) {
    return {
      field: "maxCostUsdPerRun",
      limit: policy.maxCostUsdPerRun,
      actual: costUsd,
      message: `Run failed: estimated cost ($${costUsd.toFixed(4)}) exceeded maxCostUsdPerRun ($${policy.maxCostUsdPerRun.toFixed(4)}).`,
      auditAction: "budget.exceeded.cost",
    };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily run limit
// ─────────────────────────────────────────────────────────────────────────────

describe("checkRunsPerDay", () => {
  it("blocks when runsToday equals limit", () => {
    const v = checkRunsPerDay(5, { maxRunsPerDay: 5 });
    expect(v).not.toBeNull();
    expect(v?.field).toBe("maxRunsPerDay");
    expect(v?.auditAction).toBe("budget.blocked.runs_day");
  });

  it("blocks when runsToday exceeds limit", () => {
    const v = checkRunsPerDay(7, { maxRunsPerDay: 5 });
    expect(v).not.toBeNull();
    expect(v?.current).toBe(7);
    expect(v?.limit).toBe(5);
  });

  it("allows when runsToday is below limit", () => {
    expect(checkRunsPerDay(4, { maxRunsPerDay: 5 })).toBeNull();
  });

  it("always allows when maxRunsPerDay is null", () => {
    expect(checkRunsPerDay(999, { maxRunsPerDay: null })).toBeNull();
  });

  it("message includes current and limit", () => {
    const v = checkRunsPerDay(3, { maxRunsPerDay: 3 });
    expect(v?.message).toContain("3/3");
    expect(v?.message).toContain("daily run limit exceeded");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Monthly run limit
// ─────────────────────────────────────────────────────────────────────────────

describe("checkRunsPerMonth", () => {
  it("blocks when runsThisMonth equals limit", () => {
    const v = checkRunsPerMonth(30, { maxRunsPerMonth: 30 });
    expect(v).not.toBeNull();
    expect(v?.field).toBe("maxRunsPerMonth");
    expect(v?.auditAction).toBe("budget.blocked.runs_month");
  });

  it("allows when runsThisMonth is below limit", () => {
    expect(checkRunsPerMonth(29, { maxRunsPerMonth: 30 })).toBeNull();
  });

  it("always allows when maxRunsPerMonth is null", () => {
    expect(checkRunsPerMonth(999, { maxRunsPerMonth: null })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-run token limit
// ─────────────────────────────────────────────────────────────────────────────

describe("checkTokensPerRun", () => {
  it("fails when tokens exceed limit", () => {
    const v = checkTokensPerRun(250_000, { maxTokensPerRun: 200_000 });
    expect(v).not.toBeNull();
    expect(v?.field).toBe("maxTokensPerRun");
    expect(v?.auditAction).toBe("budget.exceeded.tokens");
    expect(v?.actual).toBe(250_000);
    expect(v?.limit).toBe(200_000);
  });

  it("passes when tokens equal limit (boundary — not exceeded)", () => {
    expect(checkTokensPerRun(200_000, { maxTokensPerRun: 200_000 })).toBeNull();
  });

  it("passes when tokens are below limit", () => {
    expect(checkTokensPerRun(100_000, { maxTokensPerRun: 200_000 })).toBeNull();
  });

  it("passes when totalTokens is null (usage not reported)", () => {
    expect(checkTokensPerRun(null, { maxTokensPerRun: 200_000 })).toBeNull();
  });

  it("passes when maxTokensPerRun is null (no limit)", () => {
    expect(checkTokensPerRun(999_999, { maxTokensPerRun: null })).toBeNull();
  });

  it("message contains formatted token counts", () => {
    const v = checkTokensPerRun(250000, { maxTokensPerRun: 200000 });
    expect(v?.message).toContain("maxTokensPerRun");
    expect(v?.message).toContain("Run failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Per-run cost limit
// ─────────────────────────────────────────────────────────────────────────────

describe("checkCostPerRun", () => {
  it("fails when cost exceeds limit", () => {
    const v = checkCostPerRun(2.5, { maxCostUsdPerRun: 2.0 });
    expect(v).not.toBeNull();
    expect(v?.field).toBe("maxCostUsdPerRun");
    expect(v?.auditAction).toBe("budget.exceeded.cost");
    expect(v?.actual).toBe(2.5);
    expect(v?.limit).toBe(2.0);
  });

  it("passes when cost equals limit (boundary — not exceeded)", () => {
    expect(checkCostPerRun(2.0, { maxCostUsdPerRun: 2.0 })).toBeNull();
  });

  it("passes when cost is below limit", () => {
    expect(checkCostPerRun(1.5, { maxCostUsdPerRun: 2.0 })).toBeNull();
  });

  it("passes when estimatedCostUsd is null (usage not reported)", () => {
    expect(checkCostPerRun(null, { maxCostUsdPerRun: 2.0 })).toBeNull();
  });

  it("passes when maxCostUsdPerRun is null (no limit)", () => {
    expect(checkCostPerRun(9999, { maxCostUsdPerRun: null })).toBeNull();
  });

  it("message contains dollar amounts and field name", () => {
    const v = checkCostPerRun(3.1234, { maxCostUsdPerRun: 2.0 });
    expect(v?.message).toContain("$");
    expect(v?.message).toContain("maxCostUsdPerRun");
    expect(v?.message).toContain("Run failed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Missing usage is treated as null (not zero)
// ─────────────────────────────────────────────────────────────────────────────

describe("null usage handling", () => {
  it("never triggers token violation when usage is null", () => {
    // A strict maxTokensPerRun should not fire if usage was not reported
    expect(checkTokensPerRun(null, { maxTokensPerRun: 1 })).toBeNull();
  });

  it("never triggers cost violation when usage is null", () => {
    expect(checkCostPerRun(null, { maxCostUsdPerRun: 0.01 })).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BudgetPolicy type completeness
// ─────────────────────────────────────────────────────────────────────────────

describe("BudgetPolicy type", () => {
  it("accepts all-null policy (no limits)", () => {
    const policy: BudgetPolicy = {
      maxTokensPerRun: null,
      maxCostUsdPerRun: null,
      maxRunsPerDay: null,
      maxRunsPerMonth: null,
    };
    expect(policy.maxRunsPerDay).toBeNull();
    expect(policy.maxTokensPerRun).toBeNull();
  });

  it("accepts a fully-set policy", () => {
    const policy: BudgetPolicy = {
      maxTokensPerRun: 200_000,
      maxCostUsdPerRun: 2.0,
      maxRunsPerDay: 5,
      maxRunsPerMonth: 30,
    };
    expect(policy.maxRunsPerDay).toBe(5);
    expect(policy.maxCostUsdPerRun).toBe(2.0);
  });
});
