/**
 * Agent Jobs — unit tests for validation schemas and service-layer error types.
 *
 * These tests are intentionally pure (no DB, no Next.js runtime).
 * Service integration tests require a live Postgres instance and belong in
 * a separate e2e / integration test suite.
 */

import { describe, expect, it } from "vitest";

import {
  CreateAgentJobSchema,
  ListAgentJobsQuerySchema,
  UpdateAgentJobSchema,
  formatZodErrors,
} from "@/server/validation/agent-jobs";
import { NotFoundError, ValidationError } from "@/server/services/agent-jobs";

// ─────────────────────────────────────────────────────────────────────────────
// CreateAgentJobSchema
// ─────────────────────────────────────────────────────────────────────────────

describe("CreateAgentJobSchema", () => {
  const base = {
    name: "Daily triage",
    triggerType: "CRON",
    cronExpression: "0 9 * * *",
    timezone: "UTC",
    endpointUrl: "https://example.com/agent",
    httpMethod: "POST",
    maxDurationSeconds: 600,
    maxRetries: 3,
    retryBackoffSeconds: 60,
    requireApprovalBeforeRun: false,
    requireApprovalBeforeExternalAction: false,
  };

  it("accepts a valid CRON job", () => {
    const result = CreateAgentJobSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts a valid MANUAL job without cronExpression", () => {
    const result = CreateAgentJobSchema.safeParse({
      ...base,
      triggerType: "MANUAL",
      cronExpression: undefined,
    });
    expect(result.success).toBe(true);
  });

  it("rejects CRON job missing cronExpression", () => {
    const result = CreateAgentJobSchema.safeParse({ ...base, cronExpression: undefined });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = formatZodErrors(result.error.issues);
      expect(errs["cronExpression"]).toMatch(/required/i);
    }
  });

  it("rejects MANUAL job that provides cronExpression", () => {
    const result = CreateAgentJobSchema.safeParse({
      ...base,
      triggerType: "MANUAL",
      cronExpression: "0 9 * * *",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = formatZodErrors(result.error.issues);
      expect(errs["cronExpression"]).toMatch(/omitted/i);
    }
  });

  it("rejects an invalid cron expression", () => {
    const result = CreateAgentJobSchema.safeParse({
      ...base,
      cronExpression: "99 99 * * *",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = formatZodErrors(result.error.issues);
      expect(errs["cronExpression"]).toBeDefined();
    }
  });

  it("rejects a non-URL endpointUrl", () => {
    const result = CreateAgentJobSchema.safeParse({
      ...base,
      endpointUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = formatZodErrors(result.error.issues);
      expect(errs["endpointUrl"]).toBeDefined();
    }
  });

  it("rejects empty name", () => {
    const result = CreateAgentJobSchema.safeParse({ ...base, name: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = formatZodErrors(result.error.issues);
      expect(errs["name"]).toBeDefined();
    }
  });

  it("accepts a budget policy", () => {
    const result = CreateAgentJobSchema.safeParse({
      ...base,
      budgetPolicy: {
        maxTokensPerRun: 100_000,
        maxCostUsdPerRun: 5,
        maxRunsPerDay: 10,
        maxRunsPerMonth: 300,
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.budgetPolicy?.maxTokensPerRun).toBe(100_000);
    }
  });

  it("applies defaults for optional fields", () => {
    const minimal = {
      name: "Minimal job",
      triggerType: "MANUAL",
      endpointUrl: "https://example.com/agent",
    };
    const result = CreateAgentJobSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.httpMethod).toBe("POST");
      expect(result.data.maxDurationSeconds).toBe(300);
      expect(result.data.maxRetries).toBe(3);
      expect(result.data.timezone).toBe("UTC");
    }
  });

  it("rejects maxRetries above 10", () => {
    const result = CreateAgentJobSchema.safeParse({ ...base, maxRetries: 11 });
    expect(result.success).toBe(false);
  });

  it("rejects maxDurationSeconds above 86400", () => {
    const result = CreateAgentJobSchema.safeParse({ ...base, maxDurationSeconds: 86_401 });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid HTTP method", () => {
    const result = CreateAgentJobSchema.safeParse({ ...base, httpMethod: "CONNECT" });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// UpdateAgentJobSchema
// ─────────────────────────────────────────────────────────────────────────────

describe("UpdateAgentJobSchema", () => {
  it("accepts an empty object (all fields optional)", () => {
    const result = UpdateAgentJobSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts a partial update", () => {
    const result = UpdateAgentJobSchema.safeParse({ name: "Renamed job", maxRetries: 2 });
    expect(result.success).toBe(true);
  });

  it("rejects status ARCHIVED (archive is via DELETE only)", () => {
    const result = UpdateAgentJobSchema.safeParse({ status: "ARCHIVED" });
    expect(result.success).toBe(false);
  });

  it("accepts status PAUSED", () => {
    const result = UpdateAgentJobSchema.safeParse({ status: "PAUSED" });
    expect(result.success).toBe(true);
  });

  it("accepts null budgetPolicy (removes budget limits)", () => {
    const result = UpdateAgentJobSchema.safeParse({ budgetPolicy: null });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid cron in update", () => {
    const result = UpdateAgentJobSchema.safeParse({ cronExpression: "99 99 * * *" });
    expect(result.success).toBe(false);
  });

  it("rejects empty-string cronExpression", () => {
    const result = UpdateAgentJobSchema.safeParse({ cronExpression: "" });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ListAgentJobsQuerySchema
// ─────────────────────────────────────────────────────────────────────────────

describe("ListAgentJobsQuerySchema", () => {
  it("applies defaults when no params given", () => {
    const result = ListAgentJobsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(1);
      expect(result.data.pageSize).toBe(20);
    }
  });

  it("coerces string page to number", () => {
    const result = ListAgentJobsQuerySchema.safeParse({ page: "3", pageSize: "50" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.page).toBe(3);
      expect(result.data.pageSize).toBe(50);
    }
  });

  it("rejects page < 1", () => {
    const result = ListAgentJobsQuerySchema.safeParse({ page: "0" });
    expect(result.success).toBe(false);
  });

  it("rejects pageSize > 100", () => {
    const result = ListAgentJobsQuerySchema.safeParse({ pageSize: "101" });
    expect(result.success).toBe(false);
  });

  it("accepts valid status filter", () => {
    const result = ListAgentJobsQuerySchema.safeParse({ status: "ACTIVE" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = ListAgentJobsQuerySchema.safeParse({ status: "DELETED" });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// formatZodErrors
// ─────────────────────────────────────────────────────────────────────────────

describe("formatZodErrors", () => {
  it("maps issue paths to first message", () => {
    const result = CreateAgentJobSchema.safeParse({ triggerType: "CRON" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errs = formatZodErrors(result.error.issues);
      expect(typeof errs).toBe("object");
      expect(Object.keys(errs).length).toBeGreaterThan(0);
    }
  });

  it("uses _root for issues with no path", () => {
    const errs = formatZodErrors([{ code: "custom", path: [], message: "top-level error" } as never]);
    expect(errs["_root"]).toBe("top-level error");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Service error types
// ─────────────────────────────────────────────────────────────────────────────

describe("Service error classes", () => {
  it("NotFoundError has correct name", () => {
    const e = new NotFoundError("Job 123 not found.");
    expect(e.name).toBe("NotFoundError");
    expect(e.message).toBe("Job 123 not found.");
    expect(e).toBeInstanceOf(Error);
  });

  it("ValidationError has correct name", () => {
    const e = new ValidationError("Archived jobs cannot be updated.");
    expect(e.name).toBe("ValidationError");
    expect(e).toBeInstanceOf(Error);
  });
});
