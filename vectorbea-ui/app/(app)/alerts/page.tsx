"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  Loader2,
  Play,
  Plus,
  Send,
  Trash2,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { toast } from "sonner";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuPanel,
  DropdownMenuPanelRadioItem,
  DropdownMenuRadioGroup,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  promptName?: string | null;
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

type Prompt = { id: string; name: string };

const METRIC_LABELS: Record<MetricType, string> = {
  latency_p95: "P95 Latency (ms)",
  error_rate: "Error Rate (%)",
  eval_score_avg: "Eval Score Avg",
  cache_hit_rate: "Cache Hit Rate (%)",
};

const WINDOW_LABELS: Record<string, string> = {
  "1": "1 hour",
  "6": "6 hours",
  "24": "24 hours",
  "168": "7 days",
};

const COMPARISON_LABELS: Record<Comparison, string> = {
  gt: "> greater than",
  lt: "< less than",
  gte: "≥ at least",
  lte: "≤ at most",
};

const COMPARISON_SYMBOLS: Record<Comparison, string> = {
  gt: ">", lt: "<", gte: "≥", lte: "≤",
};

function fmtMetricValue(metricType: MetricType, value: number): string {
  if (metricType === "latency_p95") return `${Math.round(value)} ms`;
  if (metricType === "error_rate" || metricType === "cache_hit_rate") return `${value.toFixed(1)}%`;
  return value.toFixed(2);
}

function SelectDropdown({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium uppercase tracking-widest text-muted-foreground">{label}</label>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent/40"
          >
            <span className="truncate">{current?.label ?? value}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuPanel className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <DropdownMenuRadioGroup value={value} onValueChange={onChange}>
            {options.map((o) => (
              <DropdownMenuPanelRadioItem key={o.value} value={o.value}>
                {o.label}
              </DropdownMenuPanelRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuPanel>
      </DropdownMenu>
    </div>
  );
}

export default function AlertsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loadingRules, setLoadingRules] = useState(false);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [evaluating, setEvaluating] = useState(false);
  const [evaluateRuleId, setEvaluateRuleId] = useState<string>(""); // "" = all rules
  const [evaluateResult, setEvaluateResult] = useState<{
    checked: number; triggeredCount: number; triggeredNames: string[];
  } | null>(null);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createMetricType, setCreateMetricType] = useState<MetricType>("latency_p95");
  const [createComparison, setCreateComparison] = useState<Comparison>("gt");
  const [createThreshold, setCreateThreshold] = useState("");
  const [createWindowHours, setCreateWindowHours] = useState("24");
  const [createPromptId, setCreatePromptId] = useState<string>("");

  // Trigger dialog
  const [triggerRule, setTriggerRule] = useState<AlertRule | null>(null);
  const [triggerPromptId, setTriggerPromptId] = useState<string>("");
  const [triggering, setTriggering] = useState(false);
  const [triggerResult, setTriggerResult] = useState<{ ok: boolean; recipients?: string[]; errors?: string[] } | null>(null);

  const loadRules = useCallback(async () => {
    if (!activeWorkspaceId) return;
    setLoadingRules(true);
    try {
      const res = await fetch(`/api/alerts/rules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load alert rules");
      setRules(json as AlertRule[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load alert rules");
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
      toast.error(e instanceof Error ? e.message : "Failed to load alert events");
    } finally {
      setLoadingEvents(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadRules();
    void loadEvents();
    if (activeWorkspaceId) {
      fetch(`/api/prompts?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d: unknown) => { if (Array.isArray(d)) setPrompts(d as Prompt[]); })
        .catch(() => {});
    }
  }, [loadRules, loadEvents, activeWorkspaceId]);

  const toggleRule = async (rule: AlertRule) => {
    try {
      const res = await fetch(`/api/alerts/rules/${encodeURIComponent(rule.id)}?workspaceId=${encodeURIComponent(activeWorkspaceId ?? "")}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? "Failed to update rule"); }
      setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to update rule");
    }
  };

  const deleteRule = async (ruleId: string) => {
    if (!confirm("Delete this alert rule?")) return;
    try {
      const res = await fetch(`/api/alerts/rules/${encodeURIComponent(ruleId)}?workspaceId=${encodeURIComponent(activeWorkspaceId ?? "")}`, { method: "DELETE" });
      if (!res.ok) { const j = await res.json(); throw new Error(j.error ?? "Failed to delete rule"); }
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
      toast.success("Alert rule deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete rule");
    }
  };

  const createRule = async () => {
    if (!createName.trim() || !createThreshold) return;
    setCreating(true);
    try {
      const selectedPrompt = prompts.find((p) => p.id === createPromptId);
      const res = await fetch(`/api/alerts/rules?workspaceId=${encodeURIComponent(activeWorkspaceId ?? "")}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: createName.trim(),
          metricType: createMetricType,
          comparison: createComparison,
          threshold: Number(createThreshold),
          windowHours: Number(createWindowHours),
          promptName: selectedPrompt?.name ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to create rule");
      setRules((prev) => [json as AlertRule, ...prev]);
      setShowCreate(false);
      setCreateName(""); setCreateThreshold(""); setCreatePromptId("");
      toast.success("Alert rule created.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create rule");
    } finally {
      setCreating(false);
    }
  };

  const runEvaluate = async () => {
    if (!activeWorkspaceId) return;
    setEvaluating(true); setEvaluateResult(null);
    try {
      const body = evaluateRuleId ? { ruleIds: [evaluateRuleId] } : {};
      const res = await fetch(`/api/alerts/evaluate?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Evaluation failed");
      const result = json as { triggered?: AlertEvent[]; checked?: number };
      const triggeredEvents: AlertEvent[] = Array.isArray(result.triggered) ? result.triggered : [];
      setEvaluateResult({
        checked: result.checked ?? 0,
        triggeredCount: triggeredEvents.length,
        triggeredNames: triggeredEvents.map((e) => rules.find((r) => r.id === e.ruleId)?.name ?? e.ruleId),
      });
      void loadEvents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Evaluation failed");
    } finally {
      setEvaluating(false);
    }
  };

  const triggerAlert = async () => {
    if (!triggerRule || !activeWorkspaceId || triggering) return;
    setTriggering(true); setTriggerResult(null);
    try {
      const res = await fetch(`/api/alerts/trigger?workspaceId=${encodeURIComponent(activeWorkspaceId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ruleId: triggerRule.id }),
      });
      const json = await res.json() as { ok?: boolean; recipients?: string[]; errors?: string[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Trigger failed");
      setTriggerResult({ ok: json.ok ?? false, recipients: json.recipients, errors: json.errors });
    } catch (e) {
      setTriggerResult({ ok: false, errors: [e instanceof Error ? e.message : "Unknown error"] });
    } finally {
      setTriggering(false);
    }
  };

  const promptOptions = [
    { value: "", label: "All prompts (workspace-wide)" },
    ...prompts.map((p) => ({ value: p.id, label: p.name })),
  ];

  return (
    <div className="min-h-screen">
      <AppHeader title="Alerts" subtitle="Monitor prompt performance and trigger on threshold breaches." />
      <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">

        {evaluateResult && (
          <Card className="border-emerald-500/30 bg-emerald-500/8">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm text-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  Evaluation complete — {evaluateResult.checked} rule{evaluateResult.checked !== 1 ? "s" : ""} checked,{" "}
                  <strong>{evaluateResult.triggeredCount} triggered</strong>.
                </span>
              </div>
              {evaluateResult.triggeredNames.length > 0 && (
                <ul className="ml-6 space-y-0.5 text-xs text-emerald-300">
                  {evaluateResult.triggeredNames.map((name, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />{name}
                    </li>
                  ))}
                </ul>
              )}
              {evaluateResult.triggeredCount === 0 && (
                <p className="ml-6 text-xs text-emerald-400/70">All rules within threshold — no alerts triggered.</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Alert Rules */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-4 pb-4">
            <div>
              <CardTitle>Alert Rules</CardTitle>
              <CardDescription>Thresholds that trigger notifications when breached.</CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
              {/* Rule selector for targeted evaluation */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-8 min-w-[140px] items-center justify-between gap-2 rounded-lg border border-border bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent/40 transition-colors"
                  >
                    <span className="truncate">
                      {evaluateRuleId
                        ? (rules.find((r) => r.id === evaluateRuleId)?.name ?? "Selected rule")
                        : "All rules"}
                    </span>
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuPanel className="min-w-[200px]">
                  <DropdownMenuRadioGroup value={evaluateRuleId} onValueChange={setEvaluateRuleId}>
                    <DropdownMenuPanelRadioItem value="">All rules</DropdownMenuPanelRadioItem>
                    {rules.map((r) => (
                      <DropdownMenuPanelRadioItem key={r.id} value={r.id}>
                        {r.name}
                      </DropdownMenuPanelRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuPanel>
              </DropdownMenu>
              <Button size="sm" variant="outline" onClick={runEvaluate} disabled={evaluating}>
                {evaluating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                <span className="ml-1.5">Run evaluation</span>
              </Button>
              <Button size="sm" onClick={() => setShowCreate((v) => !v)}>
                <Plus className="h-3.5 w-3.5 mr-1.5" />
                New rule
              </Button>
            </div>
          </CardHeader>

          {showCreate && (
            <div className="mx-6 mb-4 rounded-xl border border-border bg-muted/20 p-4 space-y-4">
              <p className="text-sm font-semibold">New alert rule</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {/* Rule name — full width */}
                <div className="sm:col-span-2 lg:col-span-3 space-y-1">
                  <label className="block text-xs font-medium uppercase tracking-widest text-muted-foreground">Rule name</label>
                  <Input
                    placeholder="e.g. High P95 latency"
                    value={createName}
                    onChange={(e) => setCreateName(e.target.value)}
                  />
                </div>

                <SelectDropdown
                  label="Metric"
                  value={createMetricType}
                  options={(Object.entries(METRIC_LABELS) as [MetricType, string][]).map(([k, v]) => ({ value: k, label: v }))}
                  onChange={(v) => setCreateMetricType(v as MetricType)}
                />

                <SelectDropdown
                  label="Comparison"
                  value={createComparison}
                  options={(Object.entries(COMPARISON_LABELS) as [Comparison, string][]).map(([k, v]) => ({ value: k, label: v }))}
                  onChange={(v) => setCreateComparison(v as Comparison)}
                />

                <div className="space-y-1">
                  <label className="block text-xs font-medium uppercase tracking-widest text-muted-foreground">Threshold</label>
                  <Input
                    type="number"
                    placeholder="e.g. 2000"
                    value={createThreshold}
                    onChange={(e) => setCreateThreshold(e.target.value)}
                  />
                </div>

                <SelectDropdown
                  label="Window"
                  value={createWindowHours}
                  options={Object.entries(WINDOW_LABELS).map(([k, v]) => ({ value: k, label: v }))}
                  onChange={setCreateWindowHours}
                />

                <div className="sm:col-span-2 lg:col-span-2">
                  <SelectDropdown
                    label="Prompt (optional)"
                    value={createPromptId}
                    options={promptOptions}
                    onChange={setCreatePromptId}
                  />
                </div>
              </div>

              {/* Threshold hint */}
              <p className="text-xs text-muted-foreground">
                {createMetricType === "latency_p95" && "Enter milliseconds — e.g. 2000 for 2 s."}
                {(createMetricType === "error_rate" || createMetricType === "cache_hit_rate") && "Enter a percentage — e.g. 5 for 5%."}
                {createMetricType === "eval_score_avg" && "Enter a score between 0 and 1 — e.g. 0.7."}
              </p>

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
                        {METRIC_LABELS[rule.metricType]}{" "}
                        <span className="font-mono">{COMPARISON_SYMBOLS[rule.comparison]} {rule.threshold}</span>
                        {" · "}{WINDOW_LABELS[String(rule.windowHours)] ?? `${rule.windowHours}h`}
                        {rule.promptName && <span> · <span className="text-foreground/70">{rule.promptName}</span></span>}
                      </p>
                    </div>
                    <Badge variant={rule.enabled ? "success" : "secondary"}>
                      {rule.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    {/* Manual trigger */}
                    <button
                      type="button"
                      title="Send test notification for this rule"
                      onClick={() => { setTriggerRule(rule); setTriggerPromptId(""); }}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                    >
                      <Send className="h-4 w-4" />
                    </button>
                    {/* Enable / disable toggle */}
                    <button
                      type="button"
                      title={rule.enabled ? "Disable" : "Enable"}
                      onClick={() => void toggleRule(rule)}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                    >
                      {rule.enabled
                        ? <ToggleRight className="h-4 w-4 text-primary" />
                        : <ToggleLeft className="h-4 w-4" />}
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
                      <th className="pb-2 text-right font-medium">Value</th>
                      <th className="pb-2 text-right font-medium">Threshold</th>
                      <th className="pb-2 text-left font-medium">Triggered</th>
                      <th className="pb-2 text-left font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((event) => {
                      const rule = rules.find((r) => r.id === event.ruleId);
                      const metricType = rule?.metricType ?? "latency_p95";
                      const promptDisplay = event.promptName ?? rule?.promptName ?? null;
                      return (
                        <tr key={event.id} className="border-b border-border/50 last:border-0">
                          <td className="py-2.5 font-medium">{event.ruleName ?? rule?.name ?? event.ruleId}</td>
                          <td className="py-2.5 text-muted-foreground">{promptDisplay ?? <span className="italic text-muted-foreground/50">all prompts</span>}</td>
                          <td className="py-2.5 text-right tabular-nums text-red-400">{fmtMetricValue(metricType, event.metricValue)}</td>
                          <td className="py-2.5 text-right tabular-nums text-muted-foreground">{fmtMetricValue(metricType, event.threshold)}</td>
                          <td className="py-2.5 text-muted-foreground text-xs">{new Date(event.triggeredAt).toLocaleString()}</td>
                          <td className="py-2.5">
                            {event.resolvedAt
                              ? <Badge variant="success">Resolved</Badge>
                              : <Badge variant="destructive">Active</Badge>}
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

      {/* Trigger alert dialog */}
      <Dialog open={!!triggerRule} onOpenChange={(open) => { if (!open) { setTriggerRule(null); setTriggerPromptId(""); setTriggerResult(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="h-4 w-4 text-primary" />
              Send test alert notification
            </DialogTitle>
            <DialogDescription>
              This immediately sends an email notification for{" "}
              <strong className="text-foreground">{triggerRule?.name}</strong> without waiting for metric evaluation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {prompts.length > 0 && (
              <SelectDropdown
                label="Prompt (optional)"
                value={triggerPromptId}
                options={promptOptions}
                onChange={setTriggerPromptId}
              />
            )}

            {triggerRule && (
              <div className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5 text-xs space-y-1 text-muted-foreground">
                <div className="flex justify-between">
                  <span>Metric</span>
                  <span className="text-foreground">{METRIC_LABELS[triggerRule.metricType]}</span>
                </div>
                <div className="flex justify-between">
                  <span>Condition</span>
                  <span className="font-mono text-foreground">{COMPARISON_SYMBOLS[triggerRule.comparison]} {triggerRule.threshold}</span>
                </div>
                <div className="flex justify-between">
                  <span>Window</span>
                  <span className="text-foreground">{WINDOW_LABELS[String(triggerRule.windowHours)] ?? `${triggerRule.windowHours}h`}</span>
                </div>
              </div>
            )}

            {/* Result feedback */}
            {triggerResult && (
              <div className={`rounded-lg border px-3 py-2.5 text-xs space-y-1 ${triggerResult.ok ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-300" : "border-red-500/30 bg-red-500/8 text-red-300"}`}>
                {triggerResult.ok ? (
                  <>
                    <p className="font-medium flex items-center gap-1.5"><CheckCircle2 className="h-3.5 w-3.5" /> Email sent successfully</p>
                    {triggerResult.recipients && (
                      <p className="text-emerald-400/70">Recipients: {triggerResult.recipients.join(", ")}</p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-medium flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> Failed to send</p>
                    {triggerResult.errors?.map((e, i) => <p key={i} className="font-mono text-[10px] break-all">{e}</p>)}
                    <p className="text-red-400/60 mt-1">Check Vercel logs for full details. Most common cause: FROM_EMAIL env var not set or domain not verified in Resend.</p>
                  </>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => { setTriggerRule(null); setTriggerPromptId(""); setTriggerResult(null); }}>
                {triggerResult ? "Close" : "Cancel"}
              </Button>
              {!triggerResult && (
                <Button onClick={triggerAlert} disabled={triggering}>
                  {triggering && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  <Send className="h-3.5 w-3.5 mr-1.5" />
                  Send notification
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
