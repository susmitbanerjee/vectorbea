import { z } from "zod";

import { validateCron } from "@/lib/cron-humanizer";

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-schemas
// ─────────────────────────────────────────────────────────────────────────────

const BudgetPolicySchema = z.object({
  maxTokensPerRun: z.number().int().positive().nullable().optional(),
  maxCostUsdPerRun: z.number().positive().nullable().optional(),
  maxRunsPerDay: z.number().int().positive().nullable().optional(),
  maxRunsPerMonth: z.number().int().positive().nullable().optional(),
});

const cronField = z
  .string()
  .trim()
  .superRefine((val, ctx) => {
    const err = validateCron(val);
    if (err) ctx.addIssue({ code: z.ZodIssueCode.custom, message: err });
  });

const endpointUrlField = z
  .string()
  .trim()
  .url("endpointUrl must be a valid URL")
  .refine(
    (u) => u.startsWith("https://") || u.startsWith("http://"),
    "endpointUrl must use http or https",
  );

const httpMethodField = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);

// ─────────────────────────────────────────────────────────────────────────────
// CreateAgentJob
// ─────────────────────────────────────────────────────────────────────────────

export const CreateAgentJobSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(200, "name must be ≤ 200 characters"),
    description: z.string().trim().max(2000).optional(),
    triggerType: z.enum(["MANUAL", "CRON"]),
    cronExpression: cronField.optional(),
    timezone: z.string().trim().default("UTC"),
    endpointUrl: endpointUrlField,
    httpMethod: httpMethodField.default("POST"),
    headersJson: z.record(z.string()).nullable().optional(),
    maxDurationSeconds: z.number().int().min(1).max(86_400).default(300),
    maxRetries: z.number().int().min(0).max(10).default(3),
    retryBackoffSeconds: z.number().int().min(1).max(3_600).default(60),
    requireApprovalBeforeRun: z.boolean().default(false),
    requireApprovalBeforeExternalAction: z.boolean().default(false),
    budgetPolicy: BudgetPolicySchema.optional(),
  })
  .superRefine((data, ctx) => {
    if (data.triggerType === "CRON" && !data.cronExpression) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cronExpression"],
        message: "cronExpression is required when triggerType is CRON",
      });
    }
    if (data.triggerType === "MANUAL" && data.cronExpression) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cronExpression"],
        message: "cronExpression must be omitted when triggerType is MANUAL",
      });
    }
  });

export type CreateAgentJobInput = z.infer<typeof CreateAgentJobSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// UpdateAgentJob — all fields optional (PATCH semantics)
// ─────────────────────────────────────────────────────────────────────────────

export const UpdateAgentJobSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    status: z.enum(["ACTIVE", "PAUSED"]).optional(), // ARCHIVED via DELETE only
    cronExpression: cronField.nullable().optional(),
    timezone: z.string().trim().optional(),
    endpointUrl: endpointUrlField.optional(),
    httpMethod: httpMethodField.optional(),
    headersJson: z.record(z.string()).nullable().optional(),
    maxDurationSeconds: z.number().int().min(1).max(86_400).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    retryBackoffSeconds: z.number().int().min(1).max(3_600).optional(),
    requireApprovalBeforeRun: z.boolean().optional(),
    requireApprovalBeforeExternalAction: z.boolean().optional(),
    budgetPolicy: BudgetPolicySchema.nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // If setting a cron expression explicitly, validate it isn't just whitespace
    if (data.cronExpression === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["cronExpression"],
        message: "cronExpression must be a valid cron string or null",
      });
    }
  });

export type UpdateAgentJobInput = z.infer<typeof UpdateAgentJobSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// ListAgentJobs — query param parsing
// ─────────────────────────────────────────────────────────────────────────────

export const ListAgentJobsQuerySchema = z.object({
  status: z.enum(["ACTIVE", "PAUSED", "ARCHIVED"]).optional(),
  triggerType: z.enum(["MANUAL", "CRON"]).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListAgentJobsQuery = z.infer<typeof ListAgentJobsQuerySchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Formats Zod validation errors into a flat object mapping field paths
 * to their first error message — suitable for JSON API responses.
 */
export function formatZodErrors(issues: z.ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length > 0 ? issue.path.join(".") : "_root";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
