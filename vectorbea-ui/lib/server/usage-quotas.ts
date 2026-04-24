import "server-only";

import type { PlanTier } from "@/lib/api";
import { isRuntimeTraceRow, type AuditLogTraceRow } from "@/lib/server/traces";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { normalizeTraceMetadataV1 } from "@/lib/trace-metadata";
import { getWorkspacePlanLimits } from "@/lib/server/workspace-limits";

export type UsageType = "runtime_traces" | "replay_runs" | "evaluation_runs";

type UsagePlanLimits = Record<PlanTier, Record<UsageType, number | null>>;

const USAGE_LIMITS: UsagePlanLimits = {
  free: {
    runtime_traces: 5_000,
    replay_runs: 250,
    evaluation_runs: 20,
  },
  team: {
    runtime_traces: 100_000,
    replay_runs: 10_000,
    evaluation_runs: 1_000,
  },
  pro: {
    runtime_traces: 250_000,
    replay_runs: 25_000,
    evaluation_runs: 2_500,
  },
  enterprise: {
    runtime_traces: null,
    replay_runs: null,
    evaluation_runs: null,
  },
};

function currentUtcMonthBounds() {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { monthStart, nextMonthStart };
}

function isReplayRow(row: AuditLogTraceRow) {
  const metadata = normalizeTraceMetadataV1(row.metadata ?? {});
  return Boolean(metadata.tags?.replay_of || metadata.custom?.replay);
}

function isEvaluationRow(row: AuditLogTraceRow) {
  const metadata = normalizeTraceMetadataV1(row.metadata ?? {});
  const custom = metadata.custom ?? {};
  return Boolean(custom.evaluation_run || custom.action === "evaluation_run");
}

async function listMonthlyRows(workspaceId: string) {
  const { monthStart, nextMonthStart } = currentUtcMonthBounds();
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, workspace_id, prompt_version_id, prompt_name, version_tag, proxy_latency_ms, llm_latency_ms, token_count, metadata, created_at")
    .eq("workspace_id", workspaceId)
    .gte("created_at", monthStart.toISOString())
    .lt("created_at", nextMonthStart.toISOString())
    .limit(20_000);
  if (error) throw new Error(`Failed to load monthly usage: ${error.message}`);
  return (data ?? []) as AuditLogTraceRow[];
}

export async function getWorkspaceUsage(workspaceId: string) {
  const limits = await getWorkspacePlanLimits(workspaceId);
  const monthlyRows = await listMonthlyRows(workspaceId);

  const runtimeRows = monthlyRows.filter(isRuntimeTraceRow);
  const replayRows = runtimeRows.filter(isReplayRow);
  const evaluationRows = monthlyRows.filter(isEvaluationRow);

  const monthlyAuditLimit = Math.max(limits.monthlyAuditLimit, 1);
  const planLimits = USAGE_LIMITS[limits.planTier];
  const effectiveRuntimeLimit = planLimits.runtime_traces === null
    ? null
    : Math.min(planLimits.runtime_traces, monthlyAuditLimit);

  return {
    planTier: limits.planTier,
    usage: {
      runtime_traces: runtimeRows.length,
      replay_runs: replayRows.length,
      evaluation_runs: evaluationRows.length,
    },
    limits: {
      runtime_traces: effectiveRuntimeLimit,
      replay_runs: planLimits.replay_runs,
      evaluation_runs: planLimits.evaluation_runs,
    },
  };
}

export async function assertQuotaAvailable(workspaceId: string, usageType: UsageType, amount = 1) {
  const normalizedAmount = Math.max(1, Math.floor(amount));
  const snapshot = await getWorkspaceUsage(workspaceId);
  const used = snapshot.usage[usageType] ?? 0;
  const limit = snapshot.limits[usageType];

  if (limit !== null && used + normalizedAmount > limit) {
    throw new Error(`Quota exceeded for ${usageType}. Used ${used}/${limit} this month.`);
  }
  return {
    used,
    limit,
    remaining: limit === null ? null : Math.max(limit - used, 0),
  };
}

