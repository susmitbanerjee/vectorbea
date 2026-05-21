"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { Activity, AlertTriangle, CheckCircle2, Clock, DollarSign, Play, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RunStatusBadge, TriggerBadge } from "@/components/scheduler/status-badge";

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

function formatTime(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Stat Card ───────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  icon: Icon,
  accent,
  href,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  accent?: "green" | "red" | "amber" | "blue";
  href?: string;
}) {
  const colorMap = {
    green: "text-emerald-600",
    red: "text-red-500",
    amber: "text-amber-500",
    blue: "text-blue-600",
  };
  const iconColor = accent ? colorMap[accent] : "text-muted-foreground";

  const inner = (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Icon className={`h-4 w-4 ${iconColor}`} />
      </div>
      <span className="text-2xl font-semibold tracking-tight">{value}</span>
    </Card>
  );

  return href ? (
    <Link href={href as Route} className="block hover:opacity-90 transition-opacity">
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/dashboard/scheduler")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.statusText)))
      .then((d: DashboardData) => setData(d))
      .catch(() => setError("Failed to load dashboard data."))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-8">
        <div className="mb-6 space-y-2">
          <div className="h-6 w-40 animate-pulse rounded bg-muted" />
          <div className="h-4 w-64 animate-pulse rounded bg-muted" />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-[14px] bg-muted" />
          ))}
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

  return (
    <div className="space-y-6 p-8">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Today&apos;s activity across all scheduled agent jobs.
        </p>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Active Jobs" value={data.activeJobs} icon={Activity} accent="blue" href="/agent-jobs" />
        <StatCard label="Runs Today" value={data.runsToday} icon={Play} />
        <StatCard
          label="Failed Today"
          value={data.failedRuns}
          icon={AlertTriangle}
          accent={data.failedRuns > 0 ? "red" : undefined}
        />
        <StatCard
          label="Awaiting Approval"
          value={data.waitingApprovals}
          icon={Clock}
          accent={data.waitingApprovals > 0 ? "amber" : undefined}
          href="/approvals"
        />
        <StatCard
          label="Cost Today"
          value={data.estimatedCostToday > 0 ? `$${data.estimatedCostToday.toFixed(4)}` : "$0.00"}
          icon={DollarSign}
        />
        <StatCard
          label="Success Rate"
          value={data.successRate !== null ? `${data.successRate}%` : "—"}
          icon={TrendingUp}
          accent={
            data.successRate !== null
              ? data.successRate >= 90
                ? "green"
                : "amber"
              : undefined
          }
        />
      </div>

      {/* Recent runs table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-4">
          <CardTitle>Recent Runs</CardTitle>
          <Link href="/agent-jobs" className="text-xs text-muted-foreground hover:text-foreground">
            View all jobs →
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {data.recentRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <CheckCircle2 className="h-8 w-8 text-muted-foreground/30" />
              <p className="text-sm font-medium text-muted-foreground">No runs yet</p>
              <p className="text-xs text-muted-foreground/70">
                Runs will appear here once jobs are triggered.
              </p>
              <Link href="/agent-jobs/new" className="mt-2 text-xs text-primary hover:underline">
                Create your first job →
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Job", "Status", "Trigger", "Started", "Duration", "Cost", ""].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left text-xs font-medium text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.recentRuns.map((run) => (
                    <tr key={run.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <Link
                          href={`/agent-jobs/${run.agentJob.id}`}
                          className="font-medium hover:underline"
                        >
                          {run.agentJob.name}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <RunStatusBadge status={run.status as never} />
                      </td>
                      <td className="px-5 py-3">
                        <TriggerBadge source={run.triggerSource as never} />
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {formatTime(run.startedAt ?? run.createdAt)}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {formatDuration(run.durationMs)}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {formatCost(run.estimatedCostUsd)}
                      </td>
                      <td className="px-5 py-3">
                        <Link
                          href={`/agent-runs/${run.id}`}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          View →
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
    </div>
  );
}
