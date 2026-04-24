"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Bell, CheckCircle2, Loader2, Play, Plus, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useWorkspace } from "@/lib/workspace-context";

type MetricType = "latency_p95" | "error_rate" | "eval_score_avg" | "cache_hit_rate";
type Comparison = "gt" | "lt" | "gte" | "lte";

type AlertRule = {
  id: string;
  name: string;
  metricType: MetricType;
  comparison: Comparison;
  threshold: number;
  windowHours: number;
  enabled: boolean;
  createdAt: string;
};

type AlertEvent = {
  id: string;
  ruleId: string;
  ruleName?: string;
  promptName: string | null;
  metricValue: number;
  threshold: number;
  triggeredAt: string;
  resolvedAt: string | null;
};

const METRIC_LABELS: Record<MetricType, string> = {
  latency_p95: "P95 Latency (ms)",
  error_rate: "Error Rate",
  eval_score_avg: "Eval Score Avg",
  cache_hit_rate: "Cache Hit Rate",
};

const COMPARISON_SYMBOLS: Record<Comparison, string> = {
  gt: ">",
  lt: "<",
  gte: "≥",
  lte: "≤",
};

function fmtMetricValue(metricType: MetricType, value: number): string {
  if (metricType === "latency_p95") return `${Math.round(value)} ms`;
  if (metricType === "error_rate" || metricType === "cache_hit_rate") return `${value.toFixed(1)}%`;
  return value.toFixed(2);
}

export default function AlertsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluateResult, setEvaluateResult] = useState<string | null>(null);

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createMetricType, setCreateMetricType] = useState<MetricType>("latency_p95");
  const [createComparison, setCreateComparison] = useState<Comparison>("gt");
  const [createThreshold, setCreateThreshold] = useState("");
  const [createWindowHours, setCreateWindowHours] = useState("24");

  const loadRules = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoadingRules(true);
    try {
      const res = await fetch(`/api/alerts/rules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load alert rules");
      setRules(json as AlertRule[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alert rules");
    } finally {
      setLoadingRules(false);
    }
  }, [activeWorkspaceId]);

  const loadEvents = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoadingEvents(true);
    try {
      const res = await fetch(`/api/alerts/events?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load alert events");
      setEvents(json as AlertEvent[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alert events");
    } finally {
      setLoadingEvents(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadRules();
    void loadEvents();
  }, [loadRules, loadEvents]);

  const toggleRule = async (rule: AlertRule) => {
    try {
      const res = await fetch(`/api/alerts/rules/${encodeURIComponent(rule.id)}?workspaceId=${encodeURIComponent(activeWorkspaceId ?? "")}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to update rule");
      }
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update rule");
    }
  };

  const deleteRule = async (ruleId: string) => {
    if (!confirm("Delete this alert rule?")) return;
    try {
      const res = await fetch(`/api/alerts/rules/${encodeURIComponent(ruleId)}?workspaceId=${encodeURIComponent(activeWorkspaceId ?? "")}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error ?? "Failed to delete rule");
      }
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete rule");
    }
  };

  const createRule = async () => {
    if (!createName.trim() || !createThreshold) return;
    setCreating(true);
    try {
      const res = await fetch(`/api/alerts/rules?workspaceId=${encodeURIComponent(activeWorkspaceId ?? "")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          metricType: createMetricType,
          comparison: createComparison,
          threshold: Number(createThreshold),
          windowHours: Number(createWindowHours),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create rule");
      setRules((prev) => [json as AlertRule, ...prev]);
      setShowCreate(false);
      setCreateName("");
      setCreateThreshold("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create rule");
    } finally {
      setCreating(false);
    }
  };

  const runEvaluate = async () => {
    if (!activeWorkspaceId) return;
    setEvaluating(true);
    setEvaluateResult(null);
    try {
      const res = await fetch(`/api/alerts/evaluate?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Evaluation failed");
      const triggered = (json as { triggered?: number }).triggered ?? 0;
      setEvaluateResult(`Evaluation complete. ${triggered} rule${triggered !== 1 ? "s" : ""} triggered.`);
      void loadEvents();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Evaluation failed");
    } finally {
      setEvaluating(false);
    }
  };

  const loading = loadingRules || loadingEvents;

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Alerts"
        subtitle="Monitor prompt performance and trigger on threshold breaches."
      />
      <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">

        {/* Callout banner */}
        <Card className="border-yellow-500/30 bg-yellow-500/10">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-4 w-4 shrink-0 text-yellow-400 mt-0.5" />
            <p className="text-sm text-yellow-200">
              <strong>Alert evaluation endpoint.</strong> Call <code className="rounded bg-yellow-500/20 px-1 py-0.5 text-xs font-mono">POST /api/alerts/evaluate</code>
              from operations tooling or platform automation when you want to evaluate alert rules immediately.
            </p>
          </CardContent>
        </Card>

        {error && (
          <Card className="border-red-500/30 bg-red-500/10">
            <CardContent className="p-4 text-sm text-red-100">{error}</CardContent>
          </Card>
        )}

        {evaluateResult && (
          <Card className="border-green-500/30 bg-green-500/10">
            <CardContent className="flex items-center gap-2 p-4 text-sm text-green-200">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {evaluateResult}
            </CardContent>
          </Card>
        )}

        {/* Alert Rules */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <div>
              <CardTitle>Alert Rules</CardTitle>
              <CardDescription>Thresholds that trigger alerts when breached during evaluation.</CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button size="sm" variant="outline" onClick={runEvaluate} disabled={evaluating}>
                {evaluating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                <span className="ml-1.5">Run evaluation now</span>
              </Button>
              <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New rule
              </Button>
            </div>
          </CardHeader>

          {showCreate && (
            <div className="mx-6 mb-4 rounded-lg border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-sm font-medium">New alert rule</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="lg:col-span-2">
                  <label className="mb-1 block text-xs text-muted-foreground">Rule name</label>
                  <Input
                    placeholder="e.g. High P95 latency"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Metric</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={createMetricType}
                    onChange={(e) => setCreateMetricType(e.target.value as MetricType)}
                  >
                    {(Object.entries(METRIC_LABELS) as [MetricType, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Comparison</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={createComparison}
                    onChange={(e) => setCreateComparison(e.target.value as Comparison)}
                  >
                    <option value="gt">{">"} greater than</option>
                    <option value="lt">{"<"} less than</option>
                    <option value="gte">{"≥"} at least</option>
                    <option value="lte">{"≤"} at most</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Threshold</label>
                  <Input
                    type="number"
                    placeholder="e.g. 2000"
                    value={createThreshold}
                    onChange={(e) => setCreateThreshold(e.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">Window</label>
                  <select
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={createWindowHours}
                    onChange={(e) => setCreateWindowHours(e.target.value)}
                  >
                    <option value="1">1 hour</option>
                    <option value="6">6 hours</option>
                    <option value="24">24 hours</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button size="sm" onClick={createRule} disabled={creating || !createName.trim() || !createThreshold}>
                  {creating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  Create rule
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
              </div>
            </div>
          )}

          <CardContent>
            {loadingRules && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading rules…
              </div>
            )}
            {!loadingRules && rules.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No alert rules defined. Create one above.</p>
            )}
            {rules.length > 0 && (
              <div className="space-y-2">
                {rules.map((rule) => (
                  <div key={rule.id} className="flex items-center gap-3 rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                    <Bell className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{rule.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        <span className="font-mono">{METRIC_LABELS[rule.metricType]}</span>
                        {" "}{COMPARISON_SYMBOLS[rule.comparison]}{" "}
                        <span className="font-mono">{rule.threshold}</span>
                        {" · "}window: {rule.windowHours}h
                      </p>
                    </div>
                    <Badge variant={rule.enabled ? "success" : "secondary"}>
                      {rule.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <button
                      type="button"
                      title={rule.enabled ? "Disable" : "Enable"}
                      onClick={() => void toggleRule(rule)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                    >
                      {rule.enabled
                        ? <ToggleRight className="h-4 w-4 text-primary" />
                        : <ToggleLeft className="h-4 w-4" />
                      }
                    </button>
                    <button
                      type="button"
                      title="Delete rule"
                      onClick={() => void deleteRule(rule.id)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Alert History */}
        <Card>
          <CardHeader>
            <CardTitle>Alert History</CardTitle>
            <CardDescription>Events triggered when a rule threshold was breached.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingEvents && (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading events…
              </div>
            )}
            {!loadingEvents && events.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No alert events recorded yet.</p>
            )}
            {events.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-widest text-muted-foreground">
                      <th className="pb-2 text-left font-medium">Rule</th>
                      <th className="pb-2 text-left font-medium">Prompt</th>
                      <th className="pb-2 text-right font-medium">Metric Value</th>
                      <th className="pb-2 text-right font-medium">Threshold</th>
                      <th className="pb-2 text-left font-medium">Triggered At</th>
                      <th className="pb-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => {
                      const rule = rules.find((r) => r.id === event.ruleId);
                      const metricType = rule?.metricType ?? "latency_p95";
                      return (
                        <tr key={event.id} className="border-b border-border/50 last:border-0">
                          <td className="py-2.5 font-medium">{event.ruleName ?? rule?.name ?? event.ruleId}</td>
                          <td className="py-2.5 text-muted-foreground">{event.promptName ?? "—"}</td>
                          <td className="py-2.5 text-right tabular-nums text-red-400">
                            {fmtMetricValue(metricType, event.metricValue)}
                          </td>
                          <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                            {fmtMetricValue(metricType, event.threshold)}
                          </td>
                          <td className="py-2.5 text-muted-foreground text-xs">
                            {new Date(event.triggeredAt).toLocaleString()}
                          </td>
                          <td className="py-2.5">
                            {event.resolvedAt
                              ? <Badge variant="success">Resolved</Badge>
                              : <Badge variant="destructive">Active</Badge>
                            }
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
