/**
 * Tests for lib/cron-humanizer.ts
 *
 * Run with:
 *   npx tsx --test __tests__/cron-humanizer.test.ts
 * or add to your jest/vitest config once a test runner is wired up.
 */
import { cronToHumanText, validateCron } from "../lib/cron-humanizer";

// ── Minimal test harness (compatible with jest, vitest, and node --test) ─────
// We use `describe` / `it` / `expect` which are available in jest & vitest.
// If this file is run with node --test (Node 18+), swap the imports above for
// the native `node:test` module.

describe("cronToHumanText", () => {
  // ── @aliases ──────────────────────────────────────────────────────────────
  it("handles @daily", () => {
    expect(cronToHumanText("@daily")).toBe("Runs daily at midnight");
  });

  it("handles @midnight alias", () => {
    expect(cronToHumanText("@midnight")).toBe("Runs daily at midnight");
  });

  it("handles @weekly", () => {
    expect(cronToHumanText("@weekly")).toBe("Runs once a week (Sunday at midnight)");
  });

  it("handles @monthly", () => {
    expect(cronToHumanText("@monthly")).toBe("Runs once a month (1st at midnight)");
  });

  it("handles @yearly / @annually", () => {
    expect(cronToHumanText("@yearly")).toMatch(/once a year/i);
    expect(cronToHumanText("@annually")).toMatch(/once a year/i);
  });

  it("handles @hourly", () => {
    expect(cronToHumanText("@hourly")).toBe("Runs every hour");
  });

  // ── Every N minutes ───────────────────────────────────────────────────────
  it("every 15 minutes", () => {
    expect(cronToHumanText("*/15 * * * *")).toBe("Runs every 15 minutes");
  });

  it("every 5 minutes", () => {
    expect(cronToHumanText("*/5 * * * *")).toBe("Runs every 5 minutes");
  });

  it("every 1 minute", () => {
    expect(cronToHumanText("*/1 * * * *")).toBe("Runs every minute");
  });

  // ── Every N hours ─────────────────────────────────────────────────────────
  it("every 2 hours", () => {
    expect(cronToHumanText("0 */2 * * *")).toBe("Runs every 2 hours");
  });

  it("every hour (*/1)", () => {
    expect(cronToHumanText("0 */1 * * *")).toBe("Runs every hour");
  });

  // ── Daily at specific time ────────────────────────────────────────────────
  it("daily at 9:00 AM", () => {
    expect(cronToHumanText("0 9 * * *")).toBe("Runs daily at 9:00 AM");
  });

  it("daily at 5:30 PM", () => {
    expect(cronToHumanText("30 17 * * *")).toBe("Runs daily at 5:30 PM");
  });

  it("daily at midnight (0 0)", () => {
    expect(cronToHumanText("0 0 * * *")).toBe("Runs daily at 12:00 AM");
  });

  it("daily at noon (0 12)", () => {
    expect(cronToHumanText("0 12 * * *")).toBe("Runs daily at 12:00 PM");
  });

  // ── Weekly ────────────────────────────────────────────────────────────────
  it("every Saturday at 5:00 PM", () => {
    expect(cronToHumanText("0 17 * * 6")).toBe("Runs every Saturday at 5:00 PM");
  });

  it("every Monday at 9:00 AM", () => {
    expect(cronToHumanText("0 9 * * 1")).toBe("Runs every Monday at 9:00 AM");
  });

  it("every Sunday at midnight", () => {
    expect(cronToHumanText("0 0 * * 0")).toBe("Runs every Sunday at 12:00 AM");
  });

  // ── Weekdays ──────────────────────────────────────────────────────────────
  it("weekdays at 8:00 AM", () => {
    expect(cronToHumanText("0 8 * * 1-5")).toBe("Runs weekdays at 8:00 AM");
  });

  // ── Day of month ──────────────────────────────────────────────────────────
  it("1st of each month at 2:00 AM", () => {
    expect(cronToHumanText("0 2 1 * *")).toBe("Runs on the 1st of each month at 2:00 AM");
  });

  it("15th of each month at noon", () => {
    expect(cronToHumanText("0 12 15 * *")).toBe("Runs on the 15th of each month at 12:00 PM");
  });

  // ── Specific month + day ──────────────────────────────────────────────────
  it("January 1st at midnight", () => {
    expect(cronToHumanText("0 0 1 1 *")).toBe("Runs on January 1st at 12:00 AM");
  });

  // ── Fallback for complex expressions ─────────────────────────────────────
  it("complex expression falls back safely", () => {
    const result = cronToHumanText("5-10 2,14 * * 1,3");
    expect(result).toMatch(/runs on schedule/i);
    expect(result).toContain("5-10 2,14 * * 1,3");
  });

  it("6-field cron falls back safely", () => {
    const result = cronToHumanText("0 0 12 * * ?");
    expect(result).toMatch(/runs on schedule/i);
  });

  // ── Invalid / empty input ─────────────────────────────────────────────────
  it("empty string returns 'Invalid schedule'", () => {
    expect(cronToHumanText("")).toBe("Invalid schedule");
  });

  it("non-string input returns 'Invalid schedule'", () => {
    // @ts-expect-error testing runtime safety
    expect(cronToHumanText(null)).toBe("Invalid schedule");
  });

  it("whitespace-only string falls back safely", () => {
    const result = cronToHumanText("   ");
    // Empty after trim — treated as invalid
    expect(result).toBe("Invalid schedule");
  });
});

describe("validateCron", () => {
  it("returns null for empty string (no schedule)", () => {
    expect(validateCron("")).toBeNull();
    expect(validateCron("   ")).toBeNull();
  });

  it("accepts @daily alias", () => {
    expect(validateCron("@daily")).toBeNull();
  });

  it("accepts valid 5-field expressions", () => {
    expect(validateCron("0 9 * * *")).toBeNull();
    expect(validateCron("*/15 * * * *")).toBeNull();
    expect(validateCron("0 17 * * 6")).toBeNull();
    expect(validateCron("0 0 1 1 *")).toBeNull();
  });

  it("rejects wrong field count", () => {
    expect(validateCron("0 9 * *")).toMatch(/5 fields/);
    expect(validateCron("0 9 * * * *")).toMatch(/5 fields/);
  });

  it("rejects out-of-range minute", () => {
    expect(validateCron("60 9 * * *")).toMatch(/minute/);
  });

  it("rejects out-of-range hour", () => {
    expect(validateCron("0 24 * * *")).toMatch(/hour/);
  });

  it("rejects out-of-range weekday", () => {
    expect(validateCron("0 9 * * 7")).toMatch(/weekday/);
  });

  it("rejects unrecognized field pattern", () => {
    expect(validateCron("abc 9 * * *")).toMatch(/minute/);
  });

  it("accepts valid range expressions", () => {
    expect(validateCron("0 9 * * 1-5")).toBeNull();
  });

  it("accepts valid comma-separated values", () => {
    expect(validateCron("0 9 * * 1,3,5")).toBeNull();
  });
});
