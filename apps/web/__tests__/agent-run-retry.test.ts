/**
 * Retry & cancellation — unit tests for eligibility logic and error codes.
 *
 * All tests are pure (no DB, no Next.js runtime).
 * We test the rules and types exported from the service module directly.
 * Service integration tests (that actually create DB rows) belong in a
 * separate e2e suite.
 */

import { describe, expect, it } from "vitest";

import {
  RetryBlockedError,
  RETRYABLE_STATUSES,
} from "@/server/services/agent-run-retry";

// ─────────────────────────────────────────────────────────────────────────────
// RETRYABLE_STATUSES constant
// ─────────────────────────────────────────────────────────────────────────────

describe("RETRYABLE_STATUSES", () => {
  it("includes FAILED, TIMEOUT, CANCELLED", () => {
    expect(RETRYABLE_STATUSES).toContain("FAILED");
    expect(RETRYABLE_STATUSES).toContain("TIMEOUT");
    expect(RETRYABLE_STATUSES).toContain("CANCELLED");
  });

  it("does NOT include active statuses", () => {
    const active = ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "SUCCEEDED"];
    for (const s of active) {
      expect(RETRYABLE_STATUSES).not.toContain(s);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RetryBlockedError
// ─────────────────────────────────────────────────────────────────────────────

describe("RetryBlockedError", () => {
  it("carries the correct name and code", () => {
    const err = new RetryBlockedError("Job is archived.", "JOB_ARCHIVED");
    expect(err.name).toBe("RetryBlockedError");
    expect(err.message).toBe("Job is archived.");
    expect(err.code).toBe("JOB_ARCHIVED");
    expect(err).toBeInstanceOf(Error);
  });

  it("is distinguishable from generic errors", () => {
    const err = new RetryBlockedError("Max retries exceeded.", "MAX_RETRIES_EXCEEDED");
    expect(err instanceof RetryBlockedError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it("supports all defined error codes", () => {
    const codes = [
      "NOT_FOUND",
      "INVALID_STATUS",
      "JOB_ARCHIVED",
      "JOB_PAUSED",
      "MAX_RETRIES_EXCEEDED",
      "BUDGET_RUNS_DAY",
      "BUDGET_RUNS_MONTH",
    ] as const;

    for (const code of codes) {
      const err = new RetryBlockedError(`Error: ${code}`, code);
      expect(err.code).toBe(code);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retry eligibility rules (pure logic — no DB calls)
// ─────────────────────────────────────────────────────────────────────────────

describe("retry eligibility — status rules", () => {
  function isRetryable(status: string): boolean {
    return (RETRYABLE_STATUSES as readonly string[]).includes(status);
  }

  it.each(["FAILED", "TIMEOUT", "CANCELLED"])("%s → retryable", (status) => {
    expect(isRetryable(status)).toBe(true);
  });

  it.each(["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "SUCCEEDED"])(
    "%s → not retryable",
    (status) => {
      expect(isRetryable(status)).toBe(false);
    },
  );
});

describe("retry eligibility — max retries rules", () => {
  /**
   * Mirrors the check in retryAgentRun:
   *   if (maxRetries > 0 && attemptNumber >= maxRetries) → BLOCKED
   */
  function isBlockedByMaxRetries(attemptNumber: number, maxRetries: number): boolean {
    return maxRetries > 0 && attemptNumber >= maxRetries;
  }

  it("blocks when attemptNumber equals maxRetries", () => {
    expect(isBlockedByMaxRetries(3, 3)).toBe(true);
  });

  it("blocks when attemptNumber exceeds maxRetries", () => {
    expect(isBlockedByMaxRetries(5, 3)).toBe(true);
  });

  it("allows when attemptNumber is below maxRetries", () => {
    expect(isBlockedByMaxRetries(2, 3)).toBe(false);
  });

  it("never blocks when maxRetries is 0 (unlimited)", () => {
    expect(isBlockedByMaxRetries(100, 0)).toBe(false);
  });

  it("never blocks when maxRetries is negative (unlimited)", () => {
    expect(isBlockedByMaxRetries(100, -1)).toBe(false);
  });
});

describe("retry eligibility — budget rules", () => {
  function isBlockedByDayBudget(runsToday: number, maxRunsPerDay: number | null): boolean {
    if (maxRunsPerDay == null) return false;
    return runsToday >= maxRunsPerDay;
  }

  function isBlockedByMonthBudget(
    runsThisMonth: number,
    maxRunsPerMonth: number | null,
  ): boolean {
    if (maxRunsPerMonth == null) return false;
    return runsThisMonth >= maxRunsPerMonth;
  }

  it("blocks when runsToday equals maxRunsPerDay", () => {
    expect(isBlockedByDayBudget(5, 5)).toBe(true);
  });

  it("blocks when runsToday exceeds maxRunsPerDay", () => {
    expect(isBlockedByDayBudget(6, 5)).toBe(true);
  });

  it("allows when runsToday is below maxRunsPerDay", () => {
    expect(isBlockedByDayBudget(4, 5)).toBe(false);
  });

  it("always allows when maxRunsPerDay is null", () => {
    expect(isBlockedByDayBudget(999, null)).toBe(false);
  });

  it("blocks when runsThisMonth equals maxRunsPerMonth", () => {
    expect(isBlockedByMonthBudget(30, 30)).toBe(true);
  });

  it("allows when runsThisMonth is below maxRunsPerMonth", () => {
    expect(isBlockedByMonthBudget(29, 30)).toBe(false);
  });

  it("always allows when maxRunsPerMonth is null", () => {
    expect(isBlockedByMonthBudget(999, null)).toBe(false);
  });
});

describe("retry idempotency key derivation", () => {
  /**
   * Mirrors the key derivation in retryAgentRun:
   *   `retry:${rootOriginalRunId}:attempt:${nextAttempt}`
   */
  function buildIdempotencyKey(rootOriginalRunId: string, nextAttempt: number): string {
    return `retry:${rootOriginalRunId}:attempt:${nextAttempt}`;
  }

  it("is deterministic for the same inputs", () => {
    const key1 = buildIdempotencyKey("run_abc123", 2);
    const key2 = buildIdempotencyKey("run_abc123", 2);
    expect(key1).toBe(key2);
  });

  it("differs for different attempt numbers", () => {
    const key1 = buildIdempotencyKey("run_abc123", 2);
    const key2 = buildIdempotencyKey("run_abc123", 3);
    expect(key1).not.toBe(key2);
  });

  it("differs for different original run IDs", () => {
    const key1 = buildIdempotencyKey("run_abc123", 2);
    const key2 = buildIdempotencyKey("run_xyz999", 2);
    expect(key1).not.toBe(key2);
  });

  it("contains the root original run ID", () => {
    const key = buildIdempotencyKey("run_abc123", 2);
    expect(key).toContain("run_abc123");
  });
});
