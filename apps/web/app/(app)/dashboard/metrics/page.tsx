"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Loader2, TrendingUp, Zap } from "lucide-react";
import { AppHeader } from "@/components/layout/app-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import type { TimeWindow, WorkspaceMetricsSummary } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";

function fmt(n: number | null | undefined, suffix = "", decimals = 1): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(decimals)}${suffix}`;
}

function fmtPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${(n * 100).toFixed(1)}%`;
}

function fmtMs(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n)} ms`;
}

export default function MetricsPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [window, setWindow] = useState<TimeWindow>("24h");
  const [environment, setEnvironment] = useState<"all" | "prod" | "staging" | "dev">("all");
  const [prompt, setPrompt] = useState("all");
  const [metrics, setMetrics] = useState<WorkspaceMetricsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (win: TimeWindow, env: "all" | "prod" | "staging" | "dev", promptName: string) => {
    if (!activeWorkspaceId) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({
        workspaceId: activeWorkspaceId,
        window: win,
      });
      if (env !== "all") params.set("environment", env);
      if (promptName !== "all") params.set("prompt", promptName);
      const res = await fetch(`/api/metrics?${params.toString()}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to load metrics");
      setMetrics(json as WorkspaceMetricsSummary);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => { void load(window, environment, prompt); }, [environment, load, prompt, window]);

  const switchWindow = (w: TimeWindow) => { setWindow(w); void load(w, environment, prompt); };

  return (
    <div className="min-h-screen">
      <AppHeader
        title="Metrics"
        subtitle="Aggregated runtime execution metrics. System events and admin events are excluded."
      />
      <div className="space-y-6 px-4 py-6 md:px-6 xl:px-8">
        {error && (
          <Card className="border-red-500/30 bg-red-500/10">
            <CardContent className="p-4 text-sm text-red-100">{error}</CardContent>
          </Card>
        )}

        <div className="flex items-center gap-2">
          {(["1h", "24h", "7d"] as TimeWindow[]).map((w) => (
            <Button key={w} size="sm" variant={window === w ? "default" : "outline"} onClick={() => switchWindow(w)}>
              {w}
            </Button>
          ))}
          <Select
            className="h-9 min-w-[170px] text-sm font-medium"
            value={environment}
            onChange={(event) => setEnvironment(event.target.value as "all" | "prod" | "staging" | "dev")}
          >
            <option value="all">All environments</option>
            <option value="prod">Prod</option>
            <option value="staging">Staging</option>
            <option value="dev">Dev</option>
          </Select>
          <Select
            className="h-9 min-w-[170px] text-sm font-medium"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          >
            <option value="all">All prompts</option>
            {(metrics?.byPrompt ?? []).map((row) => (
              <option key={row.promptName} value={row.promptName}>{row.promptName}</option>
            ))}
          </Select>
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {metrics && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
              {[
                { label: "Total Requests", value: String(metrics.totalRequests), icon: Activity },
                { label: "Success Rate", value: fmtPct(metrics.successRate), icon: TrendingUp },
                { label: "Avg Latency", value: fmtMs(metrics.avgLatencyMs), icon: Zap },
                { label: "P95 Latency", value: fmtMs(metrics.p95LatencyMs), icon: Zap },
                { label: "Cache Hit Rate", value: fmtPct(metrics.cacheHitRate), icon: Activity },
              ].map(({ label, value, icon: Icon }) => (
                <Card key={label}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 text-muted-foreground mb-1">
                      <Icon className="h-3.5 w-3.5" />
                      <span className="text-xs uppercase tracking-widest">{label}</span>
                    </div>
                    <p className="text-2xl font-semibold tabular-nums">{value}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {metrics.byPrompt.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Per-prompt performance</CardTitle>
                  <CardDescription>Runtime executions only. System and admin rows excluded.</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs uppercase tracking-widest text-muted-foreground">
                        <th className="pb-2 text-left font-medium">Prompt</th>
                        <th className="pb-2 text-right font-medium">Requests</th>
                        <th className="pb-2 text-right font-medium">Success</th>
                        <th className="pb-2 text-right font-medium">Error</th>
                        <th className="pb-2 text-right font-medium">Avg Latency</th>
                        <th className="pb-2 text-right font-medium">P95</th>
                        <th className="pb-2 text-right font-medium">Cache Hit</th>
                        <th className="pb-2 text-right font-medium">Avg Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.byPrompt.map((row) => (
                        <tr key={row.promptName} className="border-b border-border/50 last:border-0">
                          <td className="py-2.5 font-medium">{row.promptName}</td>
                          <td className="py-2.5 text-right tabular-nums">{row.requestCount}</td>
                          <td className="py-2.5 text-right tabular-nums text-green-400">{fmtPct(row.successRate)}</td>
                          <td className="py-2.5 text-right tabular-nums text-red-400">{fmtPct(row.errorRate)}</td>
                          <td className="py-2.5 text-right tabular-nums">{fmtMs(row.avgLatencyMs)}</td>
                          <td className="py-2.5 text-right tabular-nums">{fmtMs(row.p95LatencyMs)}</td>
                          <td className="py-2.5 text-right tabular-nums">{fmtPct(row.cacheHitRate)}</td>
                          <td className="py-2.5 text-right tabular-nums">
                            {row.evalScoreAvg !== null ? fmt(row.evalScoreAvg, "", 2) : <span className="text-muted-foreground">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}

            {metrics.latencyTrend.length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle>Latency trend</CardTitle>
                  <CardDescription>Average total latency (proxy + executor) per time bucket.</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1">
                    {metrics.latencyTrend.map((point) => {
                      const maxMs = Math.max(...metrics.latencyTrend.map((p) => p.avgMs));
                      const width = maxMs > 0 ? (point.avgMs / maxMs) * 100 : 0;
                      const time = new Date(point.bucket).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                      return (
                        <div key={point.bucket} className="flex items-center gap-3 text-xs">
                          <span className="w-14 shrink-0 text-muted-foreground tabular-nums">{time}</span>
                          <div className="flex-1 rounded bg-muted/40 h-4 overflow-hidden">
                            <div className="h-full bg-primary/60 rounded" style={{ width: `${width}%` }} />
                          </div>
                          <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">{fmtMs(point.avgMs)}</span>
                          <span className="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{point.count}×</span>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}

        {!loading && !metrics && !error && (
          <Card>
            <CardContent className="p-8 text-center text-sm text-muted-foreground">
              No runtime traces found in the selected time window.
            </CardContent>
          </Card>
        )}

        <p className="text-xs text-muted-foreground">
          Metrics are computed from runtime executions only. System events, promotion events, and admin actions are excluded.
        </p>
      </div>
    </div>
  );
}
