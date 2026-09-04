import "server-only";

import type { PlanTier } from "@/lib/api";
import { getPlanDefinition, normalizePlanTier } from "@/lib/server/plan-config";
import { getWorkspaceSeatCount } from "@/lib/server/workspace-usage";

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

/**
 * Seats in use, counted where members ACTUALLY LIVE.
 *
 * `workspace_members` exists in two stores and they do not agree:
 *
 *   - Neon / `public` — written by every sign-up path (`neon-auth.createUser`,
 *     `oauth-upsert`) and read by the authorisation gate
 *     (`assertWorkspaceMember`) and the Members screen. This is the authority.
 *   - Supabase / `vectorbea` — read in nine places, written in exactly one
 *     (`invitations.ts`). For a workspace whose members all signed up normally
 *     it is EMPTY.
 *
 * This function read the Supabase copy, so "Workspace seats" reported 0 of N on
 * a workspace with real members — a number that looks like a working meter and
 * is simply wrong. Reading the same store the Members screen reads makes the
 * two agree, which is the minimum bar for a seat count that governs a plan
 * limit. The wider split is not resolved here — see docs/audit for the
 * remaining eight readers.
 *
 * It also no longer goes through `neon()`. That driver speaks HTTP to Neon's
 * endpoint only, so this count threw against the local and containerised
 * Postgres every developer runs — the seat meter was dead outside production
 * for a reason that had nothing to do with seats.
 */
export async function getWorkspaceMemberCount(workspaceId: string) {
  return getWorkspaceSeatCount(workspaceId);
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
