/**
 * @vectorbea/shared — Shared types for the Vectorbea Agent Scheduler
 *
 * These types are consumed by apps/web, apps/worker, and packages/sdk-js.
 * NOT YET FULLY IMPLEMENTED — see docs/mvp-scope.md.
 */

export type JobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "awaiting_approval";

export type RetryPolicy = {
  maxAttempts: number;
  backoffSeconds: number;
  backoffMultiplier: number;
};

export type BudgetConfig = {
  maxCostUsd: number;
  maxTokens?: number;
  alertThresholdPercent?: number;
};

export type JobDefinition = {
  id: string;
  name: string;
  workspaceId: string;
  cronExpression: string | null;
  timezone: string;
  enabled: boolean;
  agentEndpoint: string;
  agentPayload: Record<string, unknown>;
  retryPolicy: RetryPolicy;
  budget: BudgetConfig | null;
  requiresApproval: boolean;
  createdAt: string;
  updatedAt: string;
};

export type JobRun = {
  id: string;
  jobId: string;
  status: JobStatus;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
  costUsd: number | null;
  tokensUsed: number | null;
  triggeredBy: "schedule" | "manual" | "api";
  createdAt: string;
};

export type ApprovalRequest = {
  id: string;
  jobId: string;
  runId: string;
  requestedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  decision: "approved" | "rejected" | null;
  reason: string | null;
};

/**
 * API contracts — Zod schemas plus inferred types for every endpoint the web
 * app consumes. Re-exported so `@vectorbea/shared` is the single import, and
 * also available as `@vectorbea/shared/contracts`.
 */
export * as contracts from "./contracts";
