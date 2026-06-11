import "server-only";

import { db } from "@/server/db";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface BudgetUsage {
  /** Runs counted today (QUEUED | RUNNING | WAITING_FOR_APPROVAL | SUCCEEDED) */
  runsToday: number;
  /** Same statuses, current calendar month */
  runsThisMonth: number;
  /** Sum of totalTokens for all runs today (null = no completed runs with token data) */
  tokensToday: number | null;
  /** Sum of estimatedCostUsd for all runs today */
  costTodayUsd: number | null;
  /** Sum of estimatedCostUsd for all runs this month */
  costThisMonthUsd: number | null;
}

export interface BudgetPolicy {
  maxTokensPerRun: number | null;
  maxCostUsdPerRun: number | null;
  maxRunsPerDay: number | null;
  maxRunsPerMonth: number | null;
}

/** Returned by checkCanStartRun when a limit is exceeded. */
export interface BudgetViolation {
  field: "maxRunsPerDay" | "maxRunsPerMonth";
  limit: number;
  current: number;
  message: string;
  auditAction: "budget.blocked.runs_day" | "budget.blocked.runs_month";
}

/** Returned by checkRunUsageWithinBudget when a run has exceeded per-run limits. */
export interface RunUsageViolation {
  field: "maxTokensPerRun" | "maxCostUsdPerRun";
  limit: number;
  actual: number;
  message: string;
  auditAction: "budget.exceeded.tokens" | "budget.exceeded.cost";
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Statuses that consume a "slot" in the daily/monthly run count. */
const COUNTED_STATUSES = [
  "QUEUED",
  "RUNNING",
  "WAITING_FOR_APPROVAL",
  "SUCCEEDED",
] as const;

function dayStart(from = new Date()): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0);
}

function monthStart(from = new Date()): Date {
  return new Date(from.getFullYear(), from.getMonth(), 1, 0, 0, 0, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// calculateUsageForDay
// ─────────────────────────────────────────────────────────────────────────────

export async function calculateUsageForDay(
  agentJobId: string,
  organizationId: string,
): Promise<{ runs: number; tokens: number | null; costUsd: number | null }> {
  const from = dayStart();

  const [runCount, agg] = await db.$transaction([
    db.agentRun.count({
      where: {
        agentJobId,
        organizationId,
        createdAt: { gte: from },
        status: { in: [...COUNTED_STATUSES] },
      },
    }),
    db.agentRun.aggregate({
      where: { agentJobId, organizationId, createdAt: { gte: from } },
      _sum: { totalTokens: true, estimatedCostUsd: true },
    }),
  ]);

  const tokens = agg._sum.totalTokens ?? null;
  const costUsd =
    agg._sum.estimatedCostUsd != null ? Number(agg._sum.estimatedCostUsd) : null;

  return { runs: runCount, tokens, costUsd };
}

// ─────────────────────────────────────────────────────────────────────────────
// calculateUsageForMonth
// ─────────────────────────────────────────────────────────────────────────────

export async function calculateUsageForMonth(
  agentJobId: string,
  organizationId: string,
): Promise<{ runs: number; tokens: number | null; costUsd: number | null }> {
  const from = monthStart();

  const [runCount, agg] = await db.$transaction([
    db.agentRun.count({
      where: {
        agentJobId,
        organizationId,
        createdAt: { gte: from },
        status: { in: [...COUNTED_STATUSES] },
      },
    }),
    db.agentRun.aggregate({
      where: { agentJobId, organizationId, createdAt: { gte: from } },
      _sum: { totalTokens: true, estimatedCostUsd: true },
    }),
  ]);

  const tokens = agg._sum.totalTokens ?? null;
  const costUsd =
    agg._sum.estimatedCostUsd != null ? Number(agg._sum.estimatedCostUsd) : null;

  return { runs: runCount, tokens, costUsd };
}

// ─────────────────────────────────────────────────────────────────────────────
// getBudgetUsage  (combined for API responses)
// ─────────────────────────────────────────────────────────────────────────────

export async function getBudgetUsage(
  agentJobId: string,
  organizationId: string,
): Promise<BudgetUsage> {
  const [day, month] = await Promise.all([
    calculateUsageForDay(agentJobId, organizationId),
    calculateUsageForMonth(agentJobId, organizationId),
  ]);

  return {
    runsToday: day.runs,
    runsThisMonth: month.runs,
    tokensToday: day.tokens,
    costTodayUsd: day.costUsd,
    costThisMonthUsd: month.costUsd,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// checkCanStartRun
// ─────────────────────────────────────────────────────────────────────────────
// Returns null if the run can proceed, or a BudgetViolation if it is blocked.
// Writes an audit log in both cases.

export async function checkCanStartRun(
  agentJobId: string,
  organizationId: string,
  actorUserId: string,
): Promise<BudgetViolation | null> {
  const policy = await db.budgetPolicy.findUnique({
    where: { agentJobId },
    select: { maxRunsPerDay: true, maxRunsPerMonth: true },
  });

  // No policy → always allowed
  if (!policy) {
    await writeAuditLog(organizationId, actorUserId, agentJobId, "budget.check.passed", {
      reason: "no_policy",
    });
    return null;
  }

  const now = new Date();

  // ── Day check ────────────────────────────────────────────────────────────
  if (policy.maxRunsPerDay != null) {
    const from = dayStart(now);
    const runsToday = await db.agentRun.count({
      where: {
        agentJobId,
        organizationId,
        createdAt: { gte: from },
        status: { in: [...COUNTED_STATUSES] },
      },
    });

    if (runsToday >= policy.maxRunsPerDay) {
      const violation: BudgetViolation = {
        field: "maxRunsPerDay",
        limit: policy.maxRunsPerDay,
        current: runsToday,
        message: `Run blocked: daily run limit exceeded (${runsToday}/${policy.maxRunsPerDay} runs today).`,
        auditAction: "budget.blocked.runs_day",
      };

      await writeAuditLog(organizationId, actorUserId, agentJobId, violation.auditAction, {
        runsToday,
        maxRunsPerDay: policy.maxRunsPerDay,
      });

      return violation;
    }
  }

  // ── Month check ──────────────────────────────────────────────────────────
  if (policy.maxRunsPerMonth != null) {
    const from = monthStart(now);
    const runsThisMonth = await db.agentRun.count({
      where: {
        agentJobId,
        organizationId,
        createdAt: { gte: from },
        status: { in: [...COUNTED_STATUSES] },
      },
    });

    if (runsThisMonth >= policy.maxRunsPerMonth) {
      const violation: BudgetViolation = {
        field: "maxRunsPerMonth",
        limit: policy.maxRunsPerMonth,
        current: runsThisMonth,
        message: `Run blocked: monthly run limit exceeded (${runsThisMonth}/${policy.maxRunsPerMonth} runs this month).`,
        auditAction: "budget.blocked.runs_month",
      };

      await writeAuditLog(organizationId, actorUserId, agentJobId, violation.auditAction, {
        runsThisMonth,
        maxRunsPerMonth: policy.maxRunsPerMonth,
      });

      return violation;
    }
  }

  // ── All clear ────────────────────────────────────────────────────────────
  await writeAuditLog(organizationId, actorUserId, agentJobId, "budget.check.passed", {
    checkedAt: now.toISOString(),
  });

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// checkRunUsageWithinBudget
// ─────────────────────────────────────────────────────────────────────────────
// Call after a run completes to detect per-run limit violations.
// Returns null if within budget, or the first violation found.
// Does NOT update the run status — the caller decides what to do with it.

export async function checkRunUsageWithinBudget(
  agentRunId: string,
  organizationId: string,
  actorUserId: string | null,
): Promise<RunUsageViolation | null> {
  const run = await db.agentRun.findFirst({
    where: { id: agentRunId, organizationId },
    select: {
      totalTokens: true,
      estimatedCostUsd: true,
      agentJobId: true,
    },
  });

  if (!run) return null;

  const policy = await db.budgetPolicy.findUnique({
    where: { agentJobId: run.agentJobId },
    select: { maxTokensPerRun: true, maxCostUsdPerRun: true },
  });

  if (!policy) return null;

  // ── Token check ──────────────────────────────────────────────────────────
  if (policy.maxTokensPerRun != null && run.totalTokens != null) {
    if (run.totalTokens > policy.maxTokensPerRun) {
      const violation: RunUsageViolation = {
        field: "maxTokensPerRun",
        limit: policy.maxTokensPerRun,
        actual: run.totalTokens,
        message: `Run failed: token usage (${run.totalTokens.toLocaleString()}) exceeded maxTokensPerRun (${policy.maxTokensPerRun.toLocaleString()}).`,
        auditAction: "budget.exceeded.tokens",
      };

      await writeAuditLog(organizationId, actorUserId, agentRunId, violation.auditAction, {
        totalTokens: run.totalTokens,
        maxTokensPerRun: policy.maxTokensPerRun,
      });

      return violation;
    }
  }

  // ── Cost check ───────────────────────────────────────────────────────────
  if (policy.maxCostUsdPerRun != null && run.estimatedCostUsd != null) {
    const costUsd = Number(run.estimatedCostUsd);
    const limitUsd = Number(policy.maxCostUsdPerRun);

    if (costUsd > limitUsd) {
      const violation: RunUsageViolation = {
        field: "maxCostUsdPerRun",
        limit: limitUsd,
        actual: costUsd,
        message: `Run failed: estimated cost ($${costUsd.toFixed(4)}) exceeded maxCostUsdPerRun ($${limitUsd.toFixed(4)}).`,
        auditAction: "budget.exceeded.cost",
      };

      await writeAuditLog(organizationId, actorUserId, agentRunId, violation.auditAction, {
        estimatedCostUsd: costUsd,
        maxCostUsdPerRun: limitUsd,
      });

      return violation;
    }
  }

  // ── All clear ────────────────────────────────────────────────────────────
  await writeAuditLog(organizationId, actorUserId, agentRunId, "budget.run.within_limits", {
    totalTokens: run.totalTokens,
    estimatedCostUsd: run.estimatedCostUsd != null ? Number(run.estimatedCostUsd) : null,
  });

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

async function writeAuditLog(
  organizationId: string,
  actorUserId: string | null,
  entityId: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  try {
    await db.auditLog.create({
      data: {
        organizationId,
        actorUserId,
        entityType: "BudgetPolicy",
        entityId,
        action,
        metadataJson: metadata as Parameters<typeof db.auditLog.create>[0]["data"]["metadataJson"],
      },
    });
  } catch (err) {
    // Audit log failures must never block the main flow
    console.error("[budget-policy] failed to write audit log:", err);
  }
}
