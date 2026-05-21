import "server-only";

import type { PlanTier } from "@/lib/api";
import { getPlanDefinition, normalizePlanTier } from "@/lib/server/plan-config";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

type WorkspaceLimitRecord = {
  organizations?: {
    id: string;
    plan_tier?: PlanTier | null;
    max_seats?: number | null;
    max_prompts?: number | null;
    monthly_audit_limit?: number | null;
  } | {
    id: string;
    plan_tier?: PlanTier | null;
    max_seats?: number | null;
    max_prompts?: number | null;
    monthly_audit_limit?: number | null;
  }[] | null;
};

export type WorkspacePlanLimits = {
  organizationId: string;
  planTier: PlanTier;
  maxSeats: number;
  maxPrompts: number;
  monthlyAuditLimit: number;
};

export async function getWorkspacePlanLimits(
  workspaceId: string,
): Promise<WorkspacePlanLimits> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("workspaces")
    .select(
      "organizations!inner(id, plan_tier, max_seats, max_prompts, monthly_audit_limit)",
    )
    .eq("id", workspaceId)
    .single<WorkspaceLimitRecord>();

  if (error || !data?.organizations) {
    throw new Error(error?.message ?? "Failed to load workspace plan limits");
  }

  const organization = Array.isArray(data.organizations)
    ? data.organizations[0]
    : data.organizations;

  if (!organization) {
    throw new Error("Workspace organization could not be resolved");
  }

  const normalizedPlan = normalizePlanTier(organization.plan_tier);
  const plan = getPlanDefinition(normalizedPlan);

  return {
    organizationId: organization.id,
    planTier: normalizedPlan,
    maxSeats: Math.max(organization.max_seats ?? plan.limits.users ?? 1, 1),
    maxPrompts: Math.max(organization.max_prompts ?? plan.limits.prompts ?? 3, 1),
    monthlyAuditLimit: Math.max(organization.monthly_audit_limit ?? 100, 1),
  };
}

export async function getWorkspacePromptCount(workspaceId: string) {
  const supabase = createVectorBeaAdminClient();

  const { count, error } = await supabase
    .from("prompts")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  if (error) {
    throw new Error(`Failed to count prompts: ${error.message}`);
  }

  return count ?? 0;
}

export async function getWorkspaceMonthlyAuditCount(workspaceId: string) {
  const supabase = createVectorBeaAdminClient();

  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );

  const { count, error } = await supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .gte("created_at", monthStart.toISOString())
    .lt("created_at", nextMonthStart.toISOString());

  if (error) {
    throw new Error(`Failed to count monthly audits: ${error.message}`);
  }

  return count ?? 0;
}
