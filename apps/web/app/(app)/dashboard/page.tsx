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
  ShieldCheck,
  TrendingUp,
  Users,
  Zap,
} from "lucide-react";
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

function fmtDuration(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function fmtCost(usd: number | null) {
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
  label, value, sub, icon: Icon, accentColor, href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  accentColor?: string;
  href?: string;
}) {
  const inner = (
    <div
      className="flex flex-col gap-3 rounded-xl p-4 transition-colors"
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border-subtle)",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ color: "var(--text-faint)" }}
        >
          {label}
        </span>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
          style={{ background: accentColor ? `${accentColor}18` : "rgba(148,163,184,0.08)" }}
        >
          <Icon
            className="h-3.5 w-3.5"
            style={{ color: accentColor ?? "var(--text-faint)" }}
          />
        </span>
      </div>
      <div>
        <span
          className="text-[28px] font-semibold leading-none tracking-tight"
          style={{ color: "var(--text-primary)" }}
        >
          {value}
        </span>
        {sub && (
          <p className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );

  return href ? (
    <Link href={href as Route} className="block">
      {inner}
    </Link>
  ) : inner;
}

// ─── Panel wrapper ────────────────────────────────────────────────────────────

function Panel({
  title, action, children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      className="flex flex-col overflow-hidden rounded-xl"
      style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
    >
      <div
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <span
          className="text-[12px] font-semibold"
          style={{ color: "var(--text-secondary)" }}
        >
          {title}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}

// ─── Run row ─────────────────────────────────────────────────────────────────

function RunRow({ run }: { run: RecentRun }) {
  const isActive = run.status === "RUNNING" || run.status === "WAITING_FOR_APPROVAL";
  return (
    <div
      className="group flex items-center gap-3 px-4 py-2.5 transition-colors"
      style={{ borderBottom: "1px solid rgba(148,163,184,0.05)" }}
    >
      {isActive && <span className="live-dot h-1.5 w-1.5 shrink-0" />}
      {!isActive && run.status === "FAILED" && (
        <AlertTriangle className="h-3 w-3 shrink-0 text-red-400" />
      )}
      {!isActive && run.status === "SUCCEEDED" && (
        <CheckCircle2 className="h-3 w-3 shrink-0" style={{ color: "#10B981" }} />
      )}
      {!isActive && run.status !== "FAILED" && run.status !== "SUCCEEDED" && (
        <span className="h-3 w-3 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <Link
          href={`/agent-runs/${run.id}` as Route}
          className="block truncate text-[12px] font-medium transition-colors hover:underline"
          style={{ color: "var(--text-secondary)" }}
        >
          {run.agentJob.name}
        </Link>
      </div>
      <RunStatusBadge status={run.status as never} />
      <TriggerBadge source={run.triggerSource as never} />
      <span className="shrink-0 font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
        {fmtDuration(run.durationMs)}
      </span>
      <span className="shrink-0 text-[11px]" style={{ color: "var(--text-faint)" }}>
        {timeAgo(run.startedAt ?? run.createdAt)}
      </span>
      <Link
        href={`/agent-runs/${run.id}` as Route}
        className="shrink-0 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100"
        style={{ color: "var(--text-faint)" }}
      >
        <ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

// ─── Demo CTA strip ───────────────────────────────────────────────────────────

function DemoCTAStrip() {
  return (
    <div
      className="flex items-center gap-3 rounded-xl px-4 py-3"
      style={{
        background: "rgba(56,189,248,0.04)",
        border: "1px solid rgba(56,189,248,0.15)",
      }}
    >
      <Zap className="h-4 w-4 shrink-0" style={{ color: "#38BDF8" }} />
      <div className="flex-1">
        <p className="text-[12px] font-medium" style={{ color: "var(--text-secondary)" }}>
          Explore mock run data
        </p>
        <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>
          Fully-populated demo runs — Timeline, Flow, Events, I/O, and Approvals
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={"/agent-runs/mock" as never}
          className="inline-flex h-7 items-center rounded-lg px-3 text-[11px] font-medium transition-colors"
          style={{ background: "rgba(56,189,248,0.12)", color: "#38BDF8", border: "1px solid rgba(56,189,248,0.2)" }}
        >
          Success run →
        </Link>
        <Link
          href={"/agent-runs/mock-failed" as never}
          className="inline-flex h-7 items-center rounded-lg px-3 text-[11px] font-medium transition-colors"
          style={{ background: "rgba(239,68,68,0.08)", color: "#F87171", border: "1px solid rgba(239,68,68,0.15)" }}
        >
          Failed run →
        </Link>
        <Link
          href={"/agent-runs/mock-waiting-approval" as never}
          className="inline-flex h-7 items-center rounded-lg px-3 text-[11px] font-medium transition-colors"
          style={{ background: "rgba(245,158,11,0.08)", color: "#FCD34D", border: "1px solid rgba(245,158,11,0.15)" }}
        >
          Approval gate →
        </Link>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl" style={{ background: "var(--surface-2)" }} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="h-72 animate-pulse rounded-xl lg:col-span-2" style={{ background: "var(--surface-2)" }} />
          <div className="h-72 animate-pulse rounded-xl" style={{ background: "var(--surface-2)" }} />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-64 items-center justify-center p-8">
        <p className="text-[13px]" style={{ color: "var(--text-muted)" }}>
          {error ?? "Something went wrong."}
        </p>
      </div>
    );
  }

  const activeRuns = data.recentRuns.filter((r) => r.status === "RUNNING" || r.status === "WAITING_FOR_APPROVAL");
  const failedRuns = data.recentRuns.filter((r) => r.status === "FAILED");
  const recentAll = data.recentRuns.slice(0, 10);

  return (
    <div className="space-y-5 p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1
            className="text-[18px] font-semibold tracking-tight"
            style={{ color: "var(--text-primary)" }}
          >
            Agent Operations
          </h1>
          <p className="mt-0.5 text-[12px]" style={{ color: "var(--text-faint)" }}>
            Refreshed{" "}
            {refreshedAt.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={"/agent-jobs/new" as never}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-[12px] font-medium transition-colors"
            style={{ background: "#38BDF8", color: "#080B12" }}
          >
            <Play className="h-3 w-3" />
            New Job
          </Link>
          <button
            type="button"
            onClick={fetchData}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-50"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)", color: "var(--text-faint)" }}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {/* Demo CTA */}
      <DemoCTAStrip />

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Active Jobs"
          value={data.activeJobs}
          icon={Activity}
          accentColor="#38BDF8"
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
          label="Running Now"
          value={activeRuns.length}
          icon={Zap}
          accentColor={activeRuns.length > 0 ? "#38BDF8" : undefined}
          sub={activeRuns.length > 0 ? "in progress" : "idle"}
        />
        <MetricCard
          label="Failed Today"
          value={data.failedRuns}
          icon={AlertTriangle}
          accentColor={data.failedRuns > 0 ? "#EF4444" : undefined}
          sub={data.failedRuns > 0 ? "need attention" : "all clear"}
        />
        <MetricCard
          label="Pending Approvals"
          value={data.waitingApprovals}
          icon={ShieldCheck}
          accentColor={data.waitingApprovals > 0 ? "#F59E0B" : undefined}
          href="/approvals"
          sub={data.waitingApprovals > 0 ? "awaiting review" : "none waiting"}
        />
        <MetricCard
          label="Success Rate"
          value={data.successRate !== null ? `${data.successRate}%` : "—"}
          icon={TrendingUp}
          accentColor={
            data.successRate !== null
              ? data.successRate >= 90 ? "#10B981"
              : data.successRate >= 70 ? "#F59E0B"
              : "#EF4444"
              : undefined
          }
          sub="last 30 days"
        />
      </div>

      {/* Main panels */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent runs */}
        <Panel
          title="Recent Runs"
          action={
            <Link
              href={"/agent-runs" as never}
              className="text-[11px] transition-colors hover:underline"
              style={{ color: "var(--text-faint)" }}
            >
              View all →
            </Link>
          }
        >
          {recentAll.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center">
              <CheckCircle2 className="h-7 w-7" style={{ color: "rgba(148,163,184,0.2)" }} />
              <p className="text-[13px] font-medium" style={{ color: "var(--text-muted)" }}>No runs yet</p>
              <Link href="/agent-jobs/new" className="mt-1 text-[11px]" style={{ color: "#38BDF8" }}>
                Create your first job →
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-transparent">
              {recentAll.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </div>
          )}
        </Panel>

        {/* Right column */}
        <div className="space-y-4 lg:col-span-1">
          {/* Active now */}
          <Panel
            title="Active Now"
            action={
              activeRuns.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  <span className="live-dot h-1.5 w-1.5" />
                  <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                    {activeRuns.length} running
                  </span>
                </div>
              ) : undefined
            }
          >
            {activeRuns.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                <Users className="h-5 w-5" style={{ color: "rgba(148,163,184,0.15)" }} />
                <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>No runs in progress</p>
              </div>
            ) : (
              activeRuns.map((run) => (
                <div
                  key={run.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                  style={{ borderBottom: "1px solid rgba(148,163,184,0.05)" }}
                >
                  <span className="live-dot h-1.5 w-1.5 shrink-0" />
                  <Link
                    href={`/agent-runs/${run.id}` as Route}
                    className="min-w-0 flex-1 truncate text-[12px] font-medium hover:underline"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {run.agentJob.name}
                  </Link>
                  <span className="text-[11px]" style={{ color: "var(--text-faint)" }}>
                    {timeAgo(run.startedAt ?? run.createdAt)}
                  </span>
                </div>
              ))
            )}
          </Panel>

          {/* Recent failures */}
          <Panel
            title="Recent Failures"
            action={
              failedRuns.length > 0 ? (
                <span
                  className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
                  style={{ background: "rgba(239,68,68,0.12)", color: "#F87171" }}
                >
                  {failedRuns.length}
                </span>
              ) : undefined
            }
          >
            {failedRuns.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-8 text-center">
                <CheckCircle2 className="h-5 w-5" style={{ color: "rgba(16,185,129,0.3)" }} />
                <p className="text-[11px]" style={{ color: "var(--text-faint)" }}>No recent failures</p>
              </div>
            ) : (
              failedRuns.slice(0, 5).map((run) => (
                <div
                  key={run.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                  style={{ borderBottom: "1px solid rgba(148,163,184,0.05)" }}
                >
                  <AlertTriangle className="h-3 w-3 shrink-0 text-red-400" />
                  <Link
                    href={`/agent-runs/${run.id}` as Route}
                    className="min-w-0 flex-1 truncate text-[12px] font-medium hover:underline"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {run.agentJob.name}
                  </Link>
                  <span className="font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
                    {fmtDuration(run.durationMs)}
                  </span>
                  <Link
                    href={`/agent-runs/${run.id}` as Route}
                    className="text-[11px] transition-colors hover:underline"
                    style={{ color: "#38BDF8" }}
                  >
                    View →
                  </Link>
                </div>
              ))
            )}
          </Panel>

          {/* Cost today */}
          <div
            className="flex items-center gap-3 rounded-xl px-4 py-3.5"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}
          >
            <span
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
              style={{ background: "rgba(56,189,248,0.1)" }}
            >
              <DollarSign className="h-4 w-4" style={{ color: "#38BDF8" }} />
            </span>
            <div className="flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: "var(--text-faint)" }}>
                Cost Today
              </p>
              <p className="mt-0.5 font-mono text-[18px] font-semibold" style={{ color: "var(--text-primary)" }}>
                {data.estimatedCostToday > 0 ? `$${data.estimatedCostToday.toFixed(4)}` : "$0.00"}
              </p>
            </div>
            <Link
              href={"/settings/usage" as Route}
              className="text-[11px] transition-colors hover:underline"
              style={{ color: "var(--text-faint)" }}
            >
              Usage →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
