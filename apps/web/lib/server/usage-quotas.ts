import "server-only";

import { getPlanDefinition, normalizePlanTier, type UsageMeter } from "@/lib/server/plan-config";
import { getWorkspacePlanLimits } from "@/lib/server/workspace-limits";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";

export type LegacyUsageType =
  | "runtime_traces"
  | "replay_runs"
  | "evaluation_runs"
  | "regression_runs"
  | "alert_rules"
  | "team_seats";

export type SupportedUsageType = UsageMeter | LegacyUsageType;

export interface UsageRequirement {
  meter: UsageMeter;
  used: number;
  limit: number | null;
  remaining: number | null;
  required: number;
}

export interface UsageSnapshot {
  planTier: ReturnType<typeof normalizePlanTier>;
  month: string;
  resetAt: string;
  usage: Record<UsageMeter, number>;
  limits: Record<UsageMeter, number | null>;
}

export interface QuotaAlertCandidate {
  meter: UsageMeter;
  threshold: 80 | 90 | 100;
  used: number;
  limit: number;
  month: string;
  eventType: "QUOTA_NEARING" | "QUOTA_EXCEEDED";
}

type UsageRow = {
  workspace_id: string;
  month: string;
  traces_count: number | null;
  replay_runs_count: number | null;
  evaluation_executions_count: number | null;
  provider_executions_count: number | null;
  judge_executions_count: number | null;
  scheduled_regression_runs_count: number | null;
  provider_arena_runs_count: number | null;
  notification_emails_count: number | null;
};

const ZERO_USAGE: Record<UsageMeter, number> = {
  traces: 0,
  replay_runs: 0,
  evaluation_executions: 0,
  provider_executions: 0,
  judge_executions: 0,
  scheduled_regression_runs: 0,
  provider_arena_runs: 0,
  notification_emails: 0,
};

const METER_TO_COLUMN: Record<UsageMeter, keyof UsageRow> = {
  traces: "traces_count",
  replay_runs: "replay_runs_count",
  evaluation_executions: "evaluation_executions_count",
  provider_executions: "provider_executions_count",
  judge_executions: "judge_executions_count",
  scheduled_regression_runs: "scheduled_regression_runs_count",
  provider_arena_runs: "provider_arena_runs_count",
  notification_emails: "notification_emails_count",
};

const LEGACY_METER_ALIAS: Partial<Record<LegacyUsageType, UsageMeter>> = {
  runtime_traces: "traces",
  replay_runs: "replay_runs",
  evaluation_runs: "evaluation_executions",
  regression_runs: "scheduled_regression_runs",
};

function currentMonthBounds(now = new Date()) {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const nextMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    monthStart,
    nextMonthStart,
    monthKey: monthStart.toISOString().slice(0, 10),
  };
}

function asCount(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function emptyUsageSnapshot(planTier: ReturnType<typeof normalizePlanTier>, month: string, resetAt: string): UsageSnapshot {
  const plan = getPlanDefinition(planTier);
  return {
    planTier,
    month,
    resetAt,
    usage: { ...ZERO_USAGE },
    limits: { ...plan.usageLimits },
  };
}

function normalizeUsageType(usageType: SupportedUsageType): UsageMeter {
  if (usageType in METER_TO_COLUMN) return usageType as UsageMeter;
  const mapped = LEGACY_METER_ALIAS[usageType as LegacyUsageType];
  if (!mapped) {
    throw new Error(`Unsupported usage type '${usageType}'.`);
  }
  return mapped;
}

async function ensureMonthlyUsageRow(workspaceId: string, month: string) {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("workspace_usage_monthly")
    .upsert({ workspace_id: workspaceId, month }, { onConflict: "workspace_id,month", ignoreDuplicates: true });
  if (error) throw new Error(`Failed to initialize workspace usage row: ${error.message}`);
}

async function getMonthlyUsageRow(workspaceId: string, month: string): Promise<UsageRow | null> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("workspace_usage_monthly")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("month", month)
    .maybeSingle();
  if (error) throw new Error(`Failed to load workspace usage: ${error.message}`);
  return (data as UsageRow | null) ?? null;
}

export async function getWorkspaceUsage(workspaceId: string): Promise<UsageSnapshot> {
  const limits = await getWorkspacePlanLimits(workspaceId);
  const { monthKey, nextMonthStart } = currentMonthBounds();
  const row = await getMonthlyUsageRow(workspaceId, monthKey);
  const snapshot = emptyUsageSnapshot(normalizePlanTier(limits.planTier), monthKey, nextMonthStart.toISOString());
  if (!row) return snapshot;

  snapshot.usage = {
    traces: asCount(row.traces_count),
    replay_runs: asCount(row.replay_runs_count),
    evaluation_executions: asCount(row.evaluation_executions_count),
    provider_executions: asCount(row.provider_executions_count),
    judge_executions: asCount(row.judge_executions_count),
    scheduled_regression_runs: asCount(row.scheduled_regression_runs_count),
    provider_arena_runs: asCount(row.provider_arena_runs_count),
    notification_emails: asCount(row.notification_emails_count),
  };
  return snapshot;
}

export async function listUsageRequirements(
  workspaceId: string,
  requirements: Partial<Record<UsageMeter, number>>,
): Promise<UsageRequirement[]> {
  const snapshot = await getWorkspaceUsage(workspaceId);
  return Object.entries(requirements)
    .filter((entry): entry is [UsageMeter, number] => Boolean(entry[1] && entry[1] > 0))
    .map(([meter, required]) => {
      const used = snapshot.usage[meter] ?? 0;
      const limit = snapshot.limits[meter] ?? null;
      return {
        meter,
        used,
        limit,
        remaining: limit === null ? null : Math.max(limit - used, 0),
        required,
      };
    });
}

export async function assertUsageAvailable(
  workspaceId: string,
  requirements: Partial<Record<UsageMeter, number>>,
) {
  const checks = await listUsageRequirements(workspaceId, requirements);
  const snapshot = await getWorkspaceUsage(workspaceId);
  const blocked = checks.find((check) => check.limit !== null && check.used + check.required > check.limit);
  if (blocked) {
    throw new Error(
      JSON.stringify({
        code: "QUOTA_EXCEEDED",
        meter: blocked.meter,
        plan: snapshot.planTier,
        limit: blocked.limit,
        used: blocked.used,
        remaining: blocked.remaining,
        required: blocked.required,
        upgradeTarget: snapshot.planTier === "enterprise" ? "contact_sales" : snapshot.planTier === "pro" ? "enterprise" : "pro",
      }),
    );
  }
  return checks;
}

export async function assertQuotaAvailable(workspaceId: string, usageType: SupportedUsageType, amount = 1) {
  const meter = normalizeUsageType(usageType);
  const normalizedAmount = Math.max(1, Math.floor(amount));
  const [check] = await assertUsageAvailable(workspaceId, { [meter]: normalizedAmount });
  return check;
}

export async function recordUsageEvent(args: {
  workspaceId: string;
  eventType: string;
  quantity?: number;
  sourceType: string;
  sourceId?: string | null;
  metadata?: Record<string, unknown>;
  meterDeltas: Partial<Record<UsageMeter, number>>;
}) {
  const { monthKey } = currentMonthBounds();
  await ensureMonthlyUsageRow(args.workspaceId, monthKey);
  const supabase = createVectorBeaAdminClient();

  let applied = true;
  if (args.sourceId) {
    const { data, error } = await supabase
      .from("workspace_usage_events")
      .upsert(
        {
          workspace_id: args.workspaceId,
          month: monthKey,
          event_type: args.eventType,
          quantity: Math.max(args.quantity ?? 1, 1),
          source_type: args.sourceType,
          source_id: args.sourceId,
          metadata: args.metadata ?? {},
        },
        { onConflict: "workspace_id,month,event_type,source_type,source_id", ignoreDuplicates: true },
      )
      .select("id");
    if (error) throw new Error(`Failed to record usage event: ${error.message}`);
    applied = Boolean(data?.length);
  } else {
    const { error } = await supabase.from("workspace_usage_events").insert({
      workspace_id: args.workspaceId,
      month: monthKey,
      event_type: args.eventType,
      quantity: Math.max(args.quantity ?? 1, 1),
      source_type: args.sourceType,
      source_id: null,
      metadata: args.metadata ?? {},
    });
    if (error) throw new Error(`Failed to record usage event: ${error.message}`);
  }

  if (!applied) {
    return { applied: false, month: monthKey };
  }

  const increments = Object.entries(args.meterDeltas).filter((entry): entry is [UsageMeter, number] => Boolean(entry[1] && entry[1] > 0));
  if (increments.length === 0) {
    return { applied: true, month: monthKey };
  }

  const row = await getMonthlyUsageRow(args.workspaceId, monthKey);
  const current = row ?? ({
    workspace_id: args.workspaceId,
    month: monthKey,
  } as UsageRow);

  const patch: Record<string, number | string> = {
    workspace_id: args.workspaceId,
    month: monthKey,
  };

  for (const [meter, delta] of increments) {
    const column = METER_TO_COLUMN[meter];
    patch[column] = asCount(current[column]) + delta;
  }

  const { error } = await supabase
    .from("workspace_usage_monthly")
    .upsert(patch, { onConflict: "workspace_id,month" });
  if (error) throw new Error(`Failed to update workspace usage totals: ${error.message}`);

  return { applied: true, month: monthKey };
}

export async function listPendingQuotaAlerts(workspaceId: string): Promise<QuotaAlertCandidate[]> {
  const snapshot = await getWorkspaceUsage(workspaceId);
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("workspace_usage_alerts")
    .select("meter, threshold")
    .eq("workspace_id", workspaceId)
    .eq("month", snapshot.month);
  if (error) throw new Error(`Failed to load usage alert history: ${error.message}`);

  const sent = new Set((data ?? []).map((row) => `${row.meter}:${row.threshold}`));
  const alerts: QuotaAlertCandidate[] = [];
  const thresholds: Array<80 | 90 | 100> = [80, 90, 100];

  for (const meter of Object.keys(snapshot.usage) as UsageMeter[]) {
    const used = snapshot.usage[meter];
    const limit = snapshot.limits[meter];
    if (limit === null || limit <= 0) continue;
    const pct = (used / limit) * 100;
    for (const threshold of thresholds) {
      if (pct >= threshold && !sent.has(`${meter}:${threshold}`)) {
        alerts.push({
          meter,
          threshold,
          used,
          limit,
          month: snapshot.month,
          eventType: threshold >= 100 ? "QUOTA_EXCEEDED" : "QUOTA_NEARING",
        });
      }
    }
  }

  return alerts;
}

export async function markQuotaAlertSent(args: {
  workspaceId: string;
  meter: UsageMeter;
  threshold: 80 | 90 | 100;
  month: string;
  eventType: "QUOTA_NEARING" | "QUOTA_EXCEEDED";
  used: number;
  limit: number;
}) {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase.from("workspace_usage_alerts").upsert(
    {
      workspace_id: args.workspaceId,
      month: args.month,
      meter: args.meter,
      threshold: args.threshold,
      event_type: args.eventType,
      used: args.used,
      limit_value: args.limit,
    },
    { onConflict: "workspace_id,month,meter,threshold" },
  );
  if (error) throw new Error(`Failed to mark quota alert sent: ${error.message}`);
}

export function formatUsageMeterLabel(meter: UsageMeter) {
  switch (meter) {
    case "traces":
      return "Traces";
    case "replay_runs":
      return "Replay runs";
    case "evaluation_executions":
      return "Evaluation executions";
    case "provider_executions":
      return "Provider executions";
    case "judge_executions":
      return "Judge executions";
    case "scheduled_regression_runs":
      return "Scheduled regressions";
    case "provider_arena_runs":
      return "Provider Arena runs";
    case "notification_emails":
      return "Notification emails";
    default:
      return meter;
  }
}
