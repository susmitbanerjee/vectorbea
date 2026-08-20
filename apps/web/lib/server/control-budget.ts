import "server-only";

import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

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
  updated_at: string;
};

const EMPTY_BUDGET: WorkspaceControlBudget = {
  configured: false,
  reliabilityTarget: null,
  dailySpendLimitUsd: null,
  approvalSlaMinutes: null,
  updatedAt: null,
};

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
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
    updatedAt: row.updated_at,
  };
}

export async function getWorkspaceControlBudget(
  workspaceId: string,
): Promise<WorkspaceControlBudget> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("workspace_control_budgets")
    .select("reliability_target,daily_spend_limit_usd,approval_sla_minutes,updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load operational budget: ${error.message}`);
  return fromRow(data as BudgetRow | null);
}

export async function saveWorkspaceControlBudget(args: {
  workspaceId: string;
  reliabilityTarget: number | null;
  dailySpendLimitUsd: number | null;
  approvalSlaMinutes: number | null;
}): Promise<WorkspaceControlBudget> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("workspace_control_budgets")
    .upsert({
      workspace_id: args.workspaceId,
      reliability_target: args.reliabilityTarget,
      daily_spend_limit_usd: args.dailySpendLimitUsd,
      approval_sla_minutes: args.approvalSlaMinutes,
      updated_at: new Date().toISOString(),
    }, { onConflict: "workspace_id" })
    .select("reliability_target,daily_spend_limit_usd,approval_sla_minutes,updated_at")
    .single();
  if (error) throw new Error(`Failed to save operational budget: ${error.message}`);
  return fromRow(data as BudgetRow);
}

