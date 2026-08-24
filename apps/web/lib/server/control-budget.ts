import "server-only";

import { appQueryOne } from "@/lib/server/app-db";

/* ══════════════════════════════════════════════════════════════════════════════
   WORKSPACE OPERATING OBJECTIVES

   `workspace_control_budgets` is a Postgres table, created by Flyway in V035
   alongside every other workspace-scoped table. This module read it through the
   Supabase client, which points at a project that does not have it — so the
   Operational budgets panel on Usage & limits reported "operational budgets
   could not be loaded" in every environment, and saving one was impossible.

   These are observability targets, distinct from per-agent-job BudgetPolicy
   enforcement limits: Control grades against them, nothing refuses a run
   because of them.
══════════════════════════════════════════════════════════════════════════════ */

export interface WorkspaceControlBudget {
  configured: boolean;
  reliabilityTarget: number | null;
  dailySpendLimitUsd: number | null;
  approvalSlaMinutes: number | null;
  updatedAt: string | null;
}

type BudgetRow = {
  reliability_target: number | string | null;
  daily_spend_limit_usd: number | string | null;
  approval_sla_minutes: number | null;
  updated_at: Date | string;
};

const EMPTY_BUDGET: WorkspaceControlBudget = {
  configured: false,
  reliabilityTarget: null,
  dailySpendLimitUsd: null,
  approvalSlaMinutes: null,
  updatedAt: null,
};

/**
 * A deployment can run the web image before V035 has been applied. No table
 * means "not configured" for this optional setting; it must not degrade the
 * whole screen around it.
 */
function isMissingBudgetTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return code === "42P01" || /relation .*workspace_control_budgets.* does not exist/i.test(message);
}

/** NUMERIC comes back from pg as a string; it is a number to everyone else. */
function numeric(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function fromRow(row: BudgetRow | null): WorkspaceControlBudget {
  if (!row) return EMPTY_BUDGET;
  const reliabilityTarget = numeric(row.reliability_target);
  const dailySpendLimitUsd = numeric(row.daily_spend_limit_usd);
  return {
    configured:
      reliabilityTarget !== null ||
      dailySpendLimitUsd !== null ||
      row.approval_sla_minutes !== null,
    reliabilityTarget,
    dailySpendLimitUsd,
    approvalSlaMinutes: row.approval_sla_minutes,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function getWorkspaceControlBudget(
  workspaceId: string,
): Promise<WorkspaceControlBudget> {
  try {
    const row = await appQueryOne<BudgetRow>(
      `SELECT reliability_target, daily_spend_limit_usd, approval_sla_minutes, updated_at
         FROM workspace_control_budgets
        WHERE workspace_id = $1::uuid`,
      [workspaceId],
    );
    return fromRow(row);
  } catch (error) {
    if (isMissingBudgetTable(error)) return EMPTY_BUDGET;
    throw new Error(
      `Failed to load operational budget: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function saveWorkspaceControlBudget(args: {
  workspaceId: string;
  reliabilityTarget: number | null;
  dailySpendLimitUsd: number | null;
  approvalSlaMinutes: number | null;
}): Promise<WorkspaceControlBudget> {
  try {
    // Blanking a field must remove that objective, so every column is written
    // on conflict rather than merged — a partial upsert would leave yesterday's
    // spend limit in place after somebody deliberately cleared it.
    const row = await appQueryOne<BudgetRow>(
      `INSERT INTO workspace_control_budgets
         (workspace_id, reliability_target, daily_spend_limit_usd, approval_sla_minutes, updated_at)
       VALUES ($1::uuid, $2, $3, $4, now())
       ON CONFLICT (workspace_id) DO UPDATE SET
         reliability_target    = EXCLUDED.reliability_target,
         daily_spend_limit_usd = EXCLUDED.daily_spend_limit_usd,
         approval_sla_minutes  = EXCLUDED.approval_sla_minutes,
         updated_at            = now()
       RETURNING reliability_target, daily_spend_limit_usd, approval_sla_minutes, updated_at`,
      [args.workspaceId, args.reliabilityTarget, args.dailySpendLimitUsd, args.approvalSlaMinutes],
    );
    return fromRow(row);
  } catch (error) {
    throw new Error(
      `Failed to save operational budget: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
