import "server-only";

import { randomUUID } from "crypto";
import type { AlertComparison, AlertEvent, AlertEvaluationResult, AlertMetricType, AlertRule } from "@/lib/api";
import { createVectorBeaAdminClient } from "@/lib/supabase-admin";
import { getWorkspaceMetrics } from "@/lib/server/metrics";
import { notifyAlertTriggered } from "@/lib/server/notifications";

type AlertRuleRow = {
  id: string;
  workspace_id: string;
  name: string;
  metric_type: string;
  threshold: number;
  comparison: string;
  window_hours: number;
  enabled: boolean;
  created_by: string;
  created_at: string;
};

type AlertEventRow = {
  id: string;
  rule_id: string;
  workspace_id: string;
  metric_value: number;
  threshold: number;
  prompt_name: string | null;
  triggered_at: string;
  resolved_at: string | null;
};

function toRuleView(row: AlertRuleRow): AlertRule {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    metricType: row.metric_type as AlertMetricType,
    threshold: row.threshold,
    comparison: row.comparison as AlertComparison,
    windowHours: row.window_hours,
    enabled: row.enabled,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function toEventView(row: AlertEventRow): AlertEvent {
  return {
    id: row.id,
    ruleId: row.rule_id,
    workspaceId: row.workspace_id,
    metricValue: row.metric_value,
    threshold: row.threshold,
    promptName: row.prompt_name,
    triggeredAt: row.triggered_at,
    resolvedAt: row.resolved_at,
  };
}

function compare(value: number, threshold: number, op: AlertComparison): boolean {
  if (op === "gt") return value > threshold;
  if (op === "lt") return value < threshold;
  if (op === "gte") return value >= threshold;
  return value <= threshold;
}

export async function listAlertRules(workspaceId: string): Promise<AlertRule[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("alert_rules")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toRuleView);
}

export async function createAlertRule(args: {
  workspaceId: string;
  name: string;
  metricType: AlertMetricType;
  threshold: number;
  comparison: AlertComparison;
  windowHours: number;
  createdBy: string;
}): Promise<AlertRule> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("alert_rules")
    .insert({
      id: randomUUID(),
      workspace_id: args.workspaceId,
      name: args.name.trim(),
      metric_type: args.metricType,
      threshold: args.threshold,
      comparison: args.comparison,
      window_hours: args.windowHours,
      enabled: true,
      created_by: args.createdBy,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toRuleView(data as AlertRuleRow);
}

export async function updateAlertRule(args: {
  workspaceId: string;
  id: string;
  enabled?: boolean;
  threshold?: number;
}): Promise<AlertRule> {
  const supabase = createVectorBeaAdminClient();
  const updates: Record<string, unknown> = {};
  if (typeof args.enabled === "boolean") updates.enabled = args.enabled;
  if (typeof args.threshold === "number") updates.threshold = args.threshold;
  const { data, error } = await supabase
    .from("alert_rules")
    .update(updates)
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return toRuleView(data as AlertRuleRow);
}

export async function deleteAlertRule(workspaceId: string, id: string): Promise<void> {
  const supabase = createVectorBeaAdminClient();
  const { error } = await supabase
    .from("alert_rules")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}

export async function listAlertEvents(workspaceId: string, limit = 100): Promise<AlertEvent[]> {
  const supabase = createVectorBeaAdminClient();
  const { data, error } = await supabase
    .from("alert_events")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("triggered_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []).map(toEventView);
}

/**
 * Evaluate all enabled alert rules for a workspace.
 * For each rule, compute the relevant metric and check against the threshold.
 * If the threshold is breached, persist an alert event.
 *
 * INVOCATION:
 * This function must be called externally (e.g., from a POST /api/alerts/evaluate route
 * triggered by CI or an external cron). There is no built-in scheduler.
 * See docs/internal/alerting.md for invocation guidance.
 */
export async function evaluateAlerts(workspaceId: string, ruleIds?: string[]): Promise<AlertEvaluationResult> {
  const rules = await listAlertRules(workspaceId);
  const enabledRules = rules.filter((r) => r.enabled && (!ruleIds?.length || ruleIds.includes(r.id)));
  if (enabledRules.length === 0) return { triggered: [], checked: 0 };

  const supabase = createVectorBeaAdminClient();
  const triggered: AlertEvent[] = [];

  // Group rules by window to avoid redundant metric fetches
  const windowGroups = new Map<string, AlertRule[]>();
  for (const rule of enabledRules) {
    const windowKey = rule.windowHours <= 1 ? "1h" : rule.windowHours <= 24 ? "24h" : "7d";
    if (!windowGroups.has(windowKey)) windowGroups.set(windowKey, []);
    windowGroups.get(windowKey)!.push(rule);
  }

  for (const [windowKey, windowRules] of windowGroups) {
    const metrics = await getWorkspaceMetrics(workspaceId, windowKey as "1h" | "24h" | "7d");

    for (const rule of windowRules) {
      let metricValue: number | null = null;
      switch (rule.metricType) {
        case "latency_p95": metricValue = metrics.p95LatencyMs; break;
        case "error_rate": metricValue = metrics.errorRate * 100; break;
        case "eval_score_avg": metricValue = metrics.evalScoreAvg; break;
        case "cache_hit_rate": metricValue = metrics.cacheHitRate * 100; break;
      }

      if (metricValue === null) continue; // Not enough data

      if (compare(metricValue, rule.threshold, rule.comparison)) {
        const { data: eventData, error: eventError } = await supabase
          .from("alert_events")
          .insert({
            id: randomUUID(),
            rule_id: rule.id,
            workspace_id: workspaceId,
            metric_value: metricValue,
            threshold: rule.threshold,
            prompt_name: null,
            triggered_at: new Date().toISOString(),
            resolved_at: null,
          })
          .select("*")
          .single();
        if (!eventError && eventData) {
          const ev = toEventView(eventData as AlertEventRow);
          triggered.push(ev);
          // Await so the notification completes before the serverless function exits
          await notifyAlertTriggered({
            workspaceId,
            ruleName: rule.name,
            metricType: rule.metricType,
            metricValue: metricValue,
            threshold: rule.threshold,
            comparison: rule.comparison,
            alertEventId: ev.id,
          });
        }
      }
    }
  }

  return { triggered, checked: enabledRules.length };
}
