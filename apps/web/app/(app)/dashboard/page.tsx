"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  DollarSign,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  TrendingUp,
  Zap,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RunStatusBadge, TriggerBadge } from "@/components/scheduler/status-badge";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RecentRun {
  id: string;
  status: string;
  triggerSource: string;
  startedAt: string | null;
  durationMs: number | null;
  estimatedCostUsd: number | null;
  createdAt: string;
  agentJob: { id: string; name: string };
}

interface DashboardData {
  activeJobs: number;
  runsToday: number;
  failedRuns: number;
  waitingApprovals: number;
  estimatedCostToday: number;
  successRate: number | null;
  recentRuns: RecentRun[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatCost(usd: number | null) {
  if (usd === null || usd === 0) return "—";
  return `$${usd.toFixed(4)}`;
}

function timeAgo(ts: string | null) {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ─── Metric card ─────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accent?: "green" | "red" | "amber" | "blue" | "purple";
  href?: string;
}) {
  const colorMap = {
    green: "text-emerald-600 dark:text-emerald-400",
    red: "text-red-500 dark:text-red-400",
    amber: "text-amber-500 dark:text-amber-400",
    blue: "text-blue-600 dark:text-blue-400",
    purple: "text-violet-600 dark:text-violet-400",
  };
  const bgMap = {
    green: "bg-emerald-500/8",
    red: "bg-red-500/8",
    amber: "bg-amber-500/8",
    blue: "bg-blue-500/8",
    purple: "bg-violet-500/8",
  };
  const iconColor = accent ? colorMap[accent] : "text-muted-foreground";
  const iconBg = accent ? bgMap[accent] : "bg-muted/40";

  const inner = (
    <Card className="group flex flex-col gap-4 p-5 transition-shadow hover:shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
          {label}
        </span>
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg", iconBg)}>
          <Icon className={cn("h-3.5 w-3.5", iconColor)} />
        </span>
      </div>
      <div>
        <span className="text-[28px] font-semibold leading-none tracking-tight">{value}</span>
        {sub && <p className="mt-1.5 text-[11px] text-muted-foreground">{sub}</p>}
      </div>
    </Card>
  );

  return href ? (
    <Link href={href as Route} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ─── Active run row ───────────────────────────────────────────────────────────

function ActiveRunRow({ run }: { run: RecentRun }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/40 px-5 py-3 last:border-0 hover:bg-muted/20 transition-colors">
      <span className="flex h-1.5 w-1.5 shrink-0 items-center justify-center">
        <span className="live-dot h-1.5 w-1.5" />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={`/agent-runs/${run.id}` as Route}
          className="block truncate text-[13px] font-medium hover:underline"
        >
          {run.agentJob.name}
        </Link>
        <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
          {run.id.slice(0, 16)}…
        </p>
      </div>
      <TriggerBadge source={run.triggerSource as never} />
      <span className="shrink-0 text-[11px] text-muted-foreground">
        {timeAgo(run.startedAt ?? run.createdAt)}
      </span>
      <Link
        href={`/agent-runs/${run.id}` as Route}
        className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

// ─── Failed run row ───────────────────────────────────────────────────────────

function FailedRunRow({ run }: { run: RecentRun }) {
  return (
    <div className="flex items-center gap-3 border-b border-border/40 px-5 py-3 last:border-0 hover:bg-muted/20 transition-colors">
      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500" />
      <div className="min-w-0 flex-1">
        <Link
          href={`/agent-runs/${run.id}` as Route}
          className="block truncate text-[13px] font-medium hover:underline"
        >
          {run.agentJob.name}
        </Link>
        <p className="mt-0.5 text-[10px] text-muted-foreground">{timeAgo(run.startedAt ?? run.createdAt)}</p>
      </div>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
        {formatDuration(run.durationMs)}
      </span>
      <Link
        href={`/agent-runs/${run.id}` as Route}
        className="shrink-0 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        View →
      </Link>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());

  function fetchData() {
    setLoading(true);
    fetch("/api/dashboard/scheduler")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d: DashboardData) => {
        setData(d);
        setRefreshedAt(new Date());
      })
      .catch(() => setError("Failed to load dashboard data."))
      .finally(() => setLoading(false));
  }

  useEffect(() => { fetchData(); }, []);

  if (loading && !data) {
    return (
      <div className="space-y-6 p-6 lg:p-8">
        <div className="flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="h-5 w-32 animate-pulse rounded bg-muted" />
            <div className="h-3.5 w-56 animate-pulse rounded bg-muted" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="h-64 animate-pulse rounded-xl bg-muted lg:col-span-2" />
          <div className="h-64 animate-pulse rounded-xl bg-muted" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-64 items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">{error ?? "Something went wrong."}</p>
      </div>
    );
  }

  const activeRuns = data.recentRuns.filter((r) => r.status === "RUNNING" || r.status === "WAITING_FOR_APPROVAL");
  const failedRuns = data.recentRuns.filter((r) => r.status === "FAILED");
  const recentAll = data.recentRuns.slice(0, 8);

  return (
    <div className="space-y-6 p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">Agent Operations</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Monitor scheduled AI jobs, active runs, approvals, retries, and failures.{" "}
            <span className="text-muted-foreground/60">
              Refreshed {refreshedAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={"/agent-runs/mock" as never}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Zap className="h-3 w-3" />
            View demo run
          </Link>
          <Link
            href={"/agent-jobs/new" as never}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors"
          >
            <Play className="h-3 w-3" />
            Create Job
          </Link>
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
          </button>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Active Jobs"
          value={data.activeJobs}
          icon={Activity}
          accent="blue"
          href="/agent-jobs"
          sub="configured"
        />
        <MetricCard
          label="Runs Today"
          value={data.runsToday}
          icon={Play}
          sub="total executions"
        />
        <MetricCard
          label="Active Now"
          value={activeRuns.length}
          icon={Zap}
          accent={activeRuns.length > 0 ? "blue" : undefined}
          sub={activeRuns.length > 0 ? "running" : "idle"}
        />
        <MetricCard
          label="Failed Today"
          value={data.failedRuns}
          icon={AlertTriangle}
          accent={data.failedRuns > 0 ? "red" : undefined}
          sub={data.failedRuns > 0 ? "need attention" : "all clear"}
        />
        <MetricCard
          label="Pending Approval"
          value={data.waitingApprovals}
          icon={Clock}
          accent={data.waitingApprovals > 0 ? "amber" : undefined}
          href="/approvals"
          sub={data.waitingApprovals > 0 ? "awaiting review" : "none waiting"}
        />
        <MetricCard
          label="Success Rate"
          value={data.successRate !== null ? `${data.successRate}%` : "—"}
          icon={TrendingUp}
          accent={
            data.successRate !== null
              ? data.successRate >= 90 ? "green" : data.successRate >= 70 ? "amber" : "red"
              : undefined
          }
          sub="last 30 days"
        />
      </div>

      {/* Main panels */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent runs — full table */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between px-5 pb-0 pt-4">
            <CardTitle className="text-[13px] font-semibold">Recent Runs</CardTitle>
            <Link
              href={"/agent-runs" as never}
              className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              View all →
            </Link>
          </CardHeader>
          <CardContent className="p-0 pt-3">
            {recentAll.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <CheckCircle2 className="h-8 w-8 text-muted-foreground/20" />
                <p className="text-sm font-medium text-muted-foreground">No runs yet</p>
                <Link href="/agent-jobs/new" className="mt-1 text-xs text-primary hover:underline">
                  Create your first job →
                </Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-5 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Job</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Status</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Trigger</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Duration</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Cost</th>
                      <th className="px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">When</th>
                      <th className="w-8 px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {recentAll.map((run) => (
                      <tr key={run.id} className="group transition-colors hover:bg-muted/20">
                        <td className="px-5 py-3">
                          <Link
                            href={`/agent-jobs/${run.agentJob.id}` as Route}
                            className="block max-w-[200px] truncate text-[13px] font-medium hover:underline"
                          >
                            {run.agentJob.name}
                          </Link>
                        </td>
                        <td className="px-3 py-3">
                          <RunStatusBadge status={run.status as never} />
                        </td>
                        <td className="px-3 py-3">
                          <TriggerBadge source={run.triggerSource as never} />
                        </td>
                        <td className="px-3 py-3 font-mono text-[12px] text-muted-foreground">
                          {formatDuration(run.durationMs)}
                        </td>
                        <td className="px-3 py-3 font-mono text-[12px] text-muted-foreground">
                          {formatCost(run.estimatedCostUsd)}
                        </td>
                        <td className="px-3 py-3 text-[12px] text-muted-foreground">
                          {timeAgo(run.startedAt ?? run.createdAt)}
                        </td>
                        <td className="px-3 py-3">
                          <Link
                            href={`/agent-runs/${run.id}` as Route}
                            className="rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column */}
        <div className="space-y-4">
          {/* Active runs */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between px-5 pb-0 pt-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-[13px] font-semibold">Active Now</CardTitle>
                {activeRuns.length > 0 && (
                  <Badge variant="default" className="h-4 px-1.5 text-[10px]">
                    {activeRuns.length}
                  </Badge>
                )}
              </div>
              {activeRuns.length > 0 && <span className="live-dot h-1.5 w-1.5" />}
            </CardHeader>
            <CardContent className="p-0 pt-3">
              {activeRuns.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                  <CheckCircle2 className="h-6 w-6 text-muted-foreground/20" />
                  <p className="text-xs text-muted-foreground">No runs in progress</p>
                </div>
              ) : (
                activeRuns.map((r) => <ActiveRunRow key={r.id} run={r} />)
              )}
            </CardContent>
          </Card>

          {/* Recent failures */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between px-5 pb-0 pt-4">
              <div className="flex items-center gap-2">
                <CardTitle className="text-[13px] font-semibold">Recent Failures</CardTitle>
                {failedRuns.length > 0 && (
                  <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                    {failedRuns.length}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0 pt-3">
              {failedRuns.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500/30" />
                  <p className="text-xs text-muted-foreground">No recent failures</p>
                </div>
              ) : (
                failedRuns.slice(0, 5).map((r) => <FailedRunRow key={r.id} run={r} />)
              )}
            </CardContent>
          </Card>

          {/* Cost today */}
          <Card className="flex items-center gap-4 px-5 py-4">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/8">
              <DollarSign className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </span>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
                Cost Today
              </p>
              <p className="mt-0.5 font-mono text-[18px] font-semibold">
                {data.estimatedCostToday > 0
                  ? `$${data.estimatedCostToday.toFixed(4)}`
                  : "$0.00"}
              </p>
            </div>
            <Link
              href={"/settings/usage" as Route}
              className="ml-auto text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              Usage →
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
