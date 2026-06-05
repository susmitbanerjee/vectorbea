"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GitBranch,
  Play,
  Plug,
  Plus,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";

import { IconBadge, type IconTone } from "@/components/icons/vectorbea-icons";
import { getPlatformSummary, getRuns } from "@/lib/repository";
import { apiFetch, withWorkspace } from "@/lib/api/client";
import type { AgentRun } from "@/types/platform";
import { cn } from "@/lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function timeAgo(ts: string | null) {
  if (!ts) return "—";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const STATUS_CONFIG: Record<string, { dot: string; label: string; labelColor: string }> = {
  succeeded:            { dot: "bg-emerald-500",                 label: "Succeeded",       labelColor: "#059669" },
  failed:               { dot: "bg-red-500",                     label: "Failed",           labelColor: "#DC2626" },
  running:              { dot: "bg-blue-500 animate-pulse",       label: "Running",          labelColor: "#2563EB" },
  waiting_for_approval: { dot: "bg-amber-500 animate-pulse",     label: "Awaiting approval",labelColor: "#D97706" },
  queued:               { dot: "bg-slate-400",                   label: "Queued",           labelColor: "#64748B" },
  cancelled:            { dot: "bg-slate-300",                   label: "Cancelled",        labelColor: "#94A3B8" },
};

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, color, icon: Icon, tone,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon: import("lucide-react").LucideIcon;
  tone?: IconTone;
}) {
  return (
    <div
      className="flex flex-col justify-between rounded-2xl bg-white"
      style={{
        border: "1px solid #E2E8F0",
        padding: "18px",
        minHeight: 96,
        boxShadow: "0 4px 14px rgba(15,23,42,0.03)",
      }}
    >
      <div className="flex items-center justify-between">
        <p className="card-label">{label}</p>
        <IconBadge icon={Icon} tone={tone ?? "default"} size="xs" />
      </div>
      <div>
        <p style={{
          fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em",
          color: color ?? "#0F172A", lineHeight: 1, marginTop: 10,
        }}>
          {value}
        </p>
        {sub && <p style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>{sub}</p>}
      </div>
    </div>
  );
}

// ─── Run row ──────────────────────────────────────────────────────────────────

function RunRow({ run }: { run: AgentRun }) {
  const cfg = STATUS_CONFIG[run.status] ?? { dot: "bg-slate-400", label: run.status, labelColor: "#64748B" };
  const displayName = run.workflowName?.trim()
    ? run.workflowName
    : `Run ${run.id.slice(0, 8)}`;

  return (
    <Link
      href={`/runs/${run.id}` as Route}
      className="group grid items-center gap-3 px-[18px] transition-colors hover:bg-[#F8FAFC]"
      style={{
        gridTemplateColumns: "8px minmax(0,1fr) 72px 72px",
        borderBottom: "1px solid #F1F5F9",
        minHeight: 52,
      }}
    >
      {/* Status dot */}
      <span className={cn("h-2 w-2 shrink-0 rounded-full", cfg.dot)} />

      {/* Name + status label */}
      <div className="min-w-0">
        <p className="truncate" style={{ fontSize: 13.5, fontWeight: 600, color: "#0F172A", lineHeight: 1.25 }}>
          {displayName}
        </p>
        <p style={{ fontSize: 11.5, marginTop: 1, color: cfg.labelColor, fontWeight: 500 }}>
          {cfg.label}
        </p>
      </div>

      {/* Duration */}
      <span className="text-right font-mono tabular-nums" style={{ fontSize: 12, color: "#475569" }}>
        {fmtDuration(run.durationMs)}
      </span>

      {/* Time ago */}
      <span className="text-right" style={{ fontSize: 12, color: "#94A3B8" }}>
        {timeAgo(run.startedAt)}
      </span>
    </Link>
  );
}

// ─── Get started tile ─────────────────────────────────────────────────────────

function GetStartedTile({
  icon: Icon, title, description, href, color,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  href: string;
  color?: string;
}) {
  return (
    <Link
      href={href as Route}
      className="group flex items-start gap-3 rounded-2xl bg-white p-3.5 transition-all hover:border-slate-300 hover:bg-slate-50"
      style={{ border: "1px solid #E2E8F0", boxShadow: "0 4px 14px rgba(15,23,42,0.03)" }}
    >
      <div
        className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
        style={{ background: color ? `${color}12` : "#F8FAFC", border: `1px solid ${color ? `${color}25` : "#E2E8F0"}` }}
      >
        <Icon className="h-4 w-4" style={{ color: color ?? "#475569" }} />
      </div>
      <div className="min-w-0">
        <p style={{ fontSize: 13.5, fontWeight: 650, color: "#0F172A", lineHeight: "20px" }}>{title}</p>
        <p style={{ fontSize: 12, color: "#64748B", marginTop: 2, lineHeight: "16px" }}>{description}</p>
      </div>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

interface Summary {
  totalWorkflows: number;
  activeWorkflows: number;
  totalAgents: number;
  totalTools: number;
  totalRuns: number;
  runningRuns: number;
  runningNow: number;
  waitingApprovals: number;
  pendingApprovals: number;
  failedRuns24h: number;
  failedLast24h: number;
  succeededRuns24h: number;
  succeededLast24h: number;
  totalTokens24h: number;
  totalCost24h: number;
  usageLast24h?: { tokens: number; estimatedCost: number };
  connectedWorkers: number;
  recentRunsTotal: number;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export default function OverviewPage() {
  const [summary, setSummary]     = useState<Summary | null>(null);
  const [recentRuns, setRecentRuns] = useState<AgentRun[]>([]);
  const [runsTotal, setRunsTotal]   = useState(0);
  const [runsTotalPages, setRunsTotalPages] = useState(1);
  const [runsPage, setRunsPage]     = useState(1);
  const [loading, setLoading]       = useState(true);
  const [betaUsage, setBetaUsage]   = useState<{
    runsToday: number; maxRunsPerDay: number;
    simulationRunsToday: number; realRunsToday: number;
    canRunRealExecution: boolean; executionMode: string;
  } | null>(null);

  const RECENT_RUNS_LIMIT = 15;

  async function load(p = 1) {
    setLoading(true);
    try {
      const [s, runsResult] = await Promise.all([
        getPlatformSummary(),
        getRuns({ pageSize: RECENT_RUNS_LIMIT, page: p }),
      ]);
      setSummary(s as Summary);
      setRecentRuns(runsResult.items.slice(0, RECENT_RUNS_LIMIT));
      setRunsTotal(runsResult.total);
      setRunsTotalPages(runsResult.totalPages ?? Math.ceil(runsResult.total / RECENT_RUNS_LIMIT));
      setRunsTotal(runsResult.total);
    } catch { /* silently fallback */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    void load(1);
    apiFetch<typeof betaUsage & Record<string, unknown>>(withWorkspace("/api/beta/status"))
      .then(r => setBetaUsage(r as typeof betaUsage))
      .catch(() => {});
  }, []);

  const isConnected = (summary?.connectedWorkers ?? 0) > 0;
  const isEmpty = !loading && (summary?.totalWorkflows ?? 0) === 0 && (summary?.totalAgents ?? 0) === 0;

  return (
    <div className="page-shell">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">AI agent workflow execution platform</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-white transition-colors hover:bg-slate-50 disabled:opacity-40"
          style={{ border: "1px solid #E2E8F0", boxShadow: "0 1px 3px rgba(15,23,42,0.06)" }}
          title="Refresh"
        >
          <RefreshCw className={cn("h-[15px] w-[15px] text-slate-500", loading && "animate-spin")} />
        </button>
      </div>

      {/* ── Get started / quick action panel ────────────────────────────── */}
      {isEmpty ? (
        <div
          className="rounded-2xl bg-white"
          style={{ border: "1px solid #E2E8F0", padding: "16px 18px", marginBottom: 16, boxShadow: "0 4px 14px rgba(15,23,42,0.03)" }}
        >
          <p style={{ fontSize: 13, fontWeight: 650, color: "#0F172A", marginBottom: 12 }}>
            Get started with Vectorbea
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <GetStartedTile icon={GitBranch}  title="Create workflow" description="Build a native AI workflow" href="/workflows/new" color="#2563EB" />
            <GetStartedTile icon={Plug}       title="Add connection"  description="Connect an LLM provider"  href="/connections"   color="#7C3AED" />
            <GetStartedTile icon={Bot}        title="Register agent"  description="Define an agent persona"  href="/agents/new"    color="#059669" />
          </div>
        </div>
      ) : (
        <div
          className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl bg-white px-4"
          style={{ border: "1px solid #E2E8F0", minHeight: 52, boxShadow: "0 4px 14px rgba(15,23,42,0.03)" }}
        >
          <span style={{ fontSize: 13, fontWeight: 600, color: "#334155" }}>Quick actions</span>
          <span style={{ color: "#CBD5E1", fontSize: 14 }}>·</span>
          <Link
            href={"/workflows/new" as Route}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] bg-[#0F172A] px-3 text-white transition-colors hover:bg-[#1E293B]"
            style={{ fontSize: 13, fontWeight: 650 }}
          >
            <Plus className="h-3.5 w-3.5" />
            New Workflow
          </Link>
          <Link
            href={"/connections" as Route}
            className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border border-[#CBD5E1] bg-white px-3 text-[#334155] transition-colors hover:bg-slate-50"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            <Plug className="h-3.5 w-3.5 text-slate-400" />
            New Connection
          </Link>
          {(summary?.waitingApprovals ?? 0) > 0 && (
            <Link
              href={"/approvals" as Route}
              className="inline-flex h-[34px] items-center gap-1.5 rounded-[10px] border border-amber-200 bg-amber-50 px-3 text-amber-700 transition-colors hover:bg-amber-100"
              style={{ fontSize: 13, fontWeight: 600 }}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {summary!.waitingApprovals} approval{summary!.waitingApprovals !== 1 ? "s" : ""}
            </Link>
          )}
        </div>
      )}

      {/* ── Metric cards ─────────────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <MetricCard
          label="Active Workflows"
          value={loading ? "…" : (summary?.activeWorkflows ?? 0)}
          sub={`${summary?.totalWorkflows ?? 0} total`}
          color="#2563EB" icon={GitBranch} tone="workflow"
        />
        <MetricCard
          label="Running Now"
          value={loading ? "…" : (summary?.runningNow ?? summary?.runningRuns ?? 0)}
          color={(summary?.runningNow ?? summary?.runningRuns ?? 0) > 0 ? "#059669" : undefined}
          icon={Play} tone={(summary?.runningNow ?? 0) > 0 ? "success" : "muted"}
        />
        <MetricCard
          label="Failed (24h)"
          value={loading ? "…" : (summary?.failedLast24h ?? summary?.failedRuns24h ?? 0)}
          sub={`${summary?.succeededLast24h ?? summary?.succeededRuns24h ?? 0} succeeded`}
          color={(summary?.failedLast24h ?? 0) > 0 ? "#DC2626" : undefined}
          icon={AlertTriangle} tone={(summary?.failedLast24h ?? 0) > 0 ? "danger" : "muted"}
        />
        <MetricCard
          label="Pending Approvals"
          value={loading ? "…" : (summary?.pendingApprovals ?? summary?.waitingApprovals ?? 0)}
          color={(summary?.pendingApprovals ?? 0) > 0 ? "#D97706" : undefined}
          icon={ShieldCheck} tone={(summary?.pendingApprovals ?? 0) > 0 ? "approval" : "muted"}
        />
      </div>

      {/* ── Main content grid ────────────────────────────────────────────── */}
      {/* xl: two-col (runs + rail at 380px); 2xl: rail widens to 420px */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px]">

        {/* ── Recent runs ─────────────────────────────────────────────────── */}
        <div
          className="overflow-hidden rounded-2xl bg-white"
          style={{ border: "1px solid #E2E8F0", boxShadow: "0 4px 14px rgba(15,23,42,0.03)" }}
        >
          {/* Card header */}
          <div
            className="flex items-center justify-between px-[18px]"
            style={{ height: 52, borderBottom: "1px solid #E2E8F0" }}
          >
            <span style={{ fontSize: 14, fontWeight: 700, color: "#0F172A" }}>Recent Runs</span>
            <Link
              href={"/runs" as Route}
              style={{ fontSize: 12, color: "#2563EB", fontWeight: 600 }}
              className="hover:underline"
            >
              View all →
            </Link>
          </div>

          {/* Skeleton */}
          {loading ? (
            <div>
              {Array.from({ length: RECENT_RUNS_LIMIT }).map((_, i) => (
                <div
                  key={i}
                  className="grid items-center gap-3 px-[18px]"
                  style={{
                    gridTemplateColumns: "8px minmax(0,1fr) 72px 72px",
                    borderBottom: "1px solid #F1F5F9",
                    minHeight: 52,
                  }}
                >
                  <div className="h-2 w-2 rounded-full bg-slate-100 animate-pulse shrink-0" />
                  <div className="space-y-1.5">
                    <div className="h-3 w-2/3 rounded-md bg-slate-100 animate-pulse" />
                    <div className="h-2.5 w-1/4 rounded-md bg-slate-100 animate-pulse" />
                  </div>
                  <div className="h-3 w-full rounded-md bg-slate-100 animate-pulse" />
                  <div className="h-3 w-full rounded-md bg-slate-100 animate-pulse" />
                </div>
              ))}
            </div>
          ) : recentRuns.length === 0 ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center gap-3 text-center" style={{ height: 280 }}>
              <div
                className="flex h-12 w-12 items-center justify-center rounded-2xl"
                style={{ background: "#F8FAFC", border: "1px solid #E2E8F0" }}
              >
                <GitBranch className="h-5 w-5" style={{ color: "#CBD5E1" }} />
              </div>
              <div>
                <p style={{ fontSize: 15, fontWeight: 650, color: "#334155" }}>No runs yet</p>
                <p style={{ fontSize: 13, color: "#94A3B8", marginTop: 3 }}>
                  Trigger your first workflow to see runs here
                </p>
              </div>
              <Link
                href={"/workflows/new" as Route}
                className="inline-flex h-9 items-center gap-1.5 rounded-[10px] bg-[#0F172A] px-4 text-white transition-colors hover:bg-[#1E293B]"
                style={{ fontSize: 13, fontWeight: 650 }}
              >
                <Plus className="h-3.5 w-3.5" />
                Create workflow
              </Link>
            </div>
          ) : (
            <>
              <div>
                {recentRuns.slice(0, RECENT_RUNS_LIMIT).map((run) => <RunRow key={run.id} run={run} />)}
              </div>
              {/* Pagination footer */}
              <div
                className="flex items-center justify-between px-[18px]"
                style={{ borderTop: "1px solid #F1F5F9", paddingTop: 10, paddingBottom: 10 }}
              >
                <span style={{ fontSize: 12, color: "#94A3B8" }}>
                  {runsTotal > 0
                    ? `${((runsPage - 1) * RECENT_RUNS_LIMIT) + 1}–${Math.min(runsPage * RECENT_RUNS_LIMIT, runsTotal)} of ${runsTotal.toLocaleString()} runs`
                    : `${recentRuns.length} run${recentRuns.length !== 1 ? "s" : ""}`}
                </span>

                <div className="flex items-center gap-1">
                  {/* Prev */}
                  <button
                    type="button"
                    disabled={runsPage <= 1}
                    onClick={() => { const p = runsPage - 1; setRunsPage(p); void load(p); }}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-40 transition-colors"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>

                  {/* Page numbers */}
                  {Array.from({ length: Math.min(runsTotalPages, 5) }, (_, i) => {
                    // Show up to 5 page buttons, centered on current page
                    const half = 2;
                    let start = Math.max(1, runsPage - half);
                    const end = Math.min(runsTotalPages, start + 4);
                    start = Math.max(1, end - 4);
                    return start + i;
                  }).filter(p => p <= runsTotalPages).map(p => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { setRunsPage(p); void load(p); }}
                      className={cn(
                        "flex h-7 w-7 items-center justify-center rounded-md border text-[12px] font-medium transition-colors",
                        p === runsPage
                          ? "border-[#111827] bg-[#111827] text-white"
                          : "border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB]",
                      )}
                    >
                      {p}
                    </button>
                  ))}

                  {/* Next */}
                  <button
                    type="button"
                    disabled={runsPage >= runsTotalPages}
                    onClick={() => { const p = runsPage + 1; setRunsPage(p); void load(p); }}
                    className="flex h-7 w-7 items-center justify-center rounded-md border border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-40 transition-colors"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Right column ────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Usage 24h */}
          {/* Beta usage widget */}
          <div
            className="rounded-2xl bg-white"
            style={{ border: "1px solid #E2E8F0", padding: "16px 18px", boxShadow: "0 4px 14px rgba(15,23,42,0.03)" }}
          >
            <div className="flex items-center justify-between mb-3">
              <p style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A" }}>Usage today</p>
              <Link href={"/settings/usage" as never}
                style={{ fontSize: 12, color: "#2563EB", fontWeight: 600 }}
                className="hover:underline">
                View limits →
              </Link>
            </div>
            {betaUsage ? (
              <div className="space-y-3">
                {/* Run progress bar */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ fontSize: 12, color: "#64748B" }}>Runs</span>
                    <span className="font-mono tabular-nums" style={{ fontSize: 12.5, fontWeight: 700, color: betaUsage.runsToday >= betaUsage.maxRunsPerDay * 0.8 ? "#DC2626" : "#0F172A" }}>
                      {betaUsage.runsToday} / {betaUsage.maxRunsPerDay}
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 99, background: "#F1F5F9", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 99,
                      width: `${Math.min(100, Math.round((betaUsage.runsToday / betaUsage.maxRunsPerDay) * 100))}%`,
                      background: betaUsage.runsToday >= betaUsage.maxRunsPerDay * 0.8 ? "#EF4444" : "#3B82F6",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  {betaUsage.simulationRunsToday > 0 || betaUsage.realRunsToday > 0 ? (
                    <p style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>
                      {betaUsage.simulationRunsToday > 0 && `${betaUsage.simulationRunsToday} simulation`}
                      {betaUsage.simulationRunsToday > 0 && betaUsage.realRunsToday > 0 && " · "}
                      {betaUsage.realRunsToday > 0 && `${betaUsage.realRunsToday} real`}
                    </p>
                  ) : null}
                </div>
                {/* Execution mode */}
                <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                  <span style={{ fontSize: 12, color: "#64748B" }}>Execution</span>
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99,
                    background: betaUsage.canRunRealExecution ? "#F0FDF4" : "#FEF9C3",
                    color: betaUsage.canRunRealExecution ? "#16A34A" : "#92400E",
                  }}>
                    {betaUsage.canRunRealExecution ? "Real enabled" : "Simulation only"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div style={{ height: 5, borderRadius: 99, background: "#F1F5F9" }} />
                <p style={{ fontSize: 12, color: "#94A3B8" }}>Loading usage…</p>
              </div>
            )}
          </div>

          {/* Worker health section removed — workers are internal infrastructure */}

          {/* Explore */}
          <div
            className="rounded-2xl bg-white"
            style={{ border: "1px solid #E2E8F0", padding: "16px 18px", boxShadow: "0 4px 14px rgba(15,23,42,0.03)" }}
          >
            <p style={{ fontSize: 13.5, fontWeight: 700, color: "#0F172A", marginBottom: 8 }}>Explore</p>
            <div>
              {[
                { href: "/agents",    label: "Agent Registry",  icon: Bot,          color: "#7C3AED" },
                { href: "/tools",     label: "Tool Registry",   icon: Wrench,       color: "#0891B2" },
                { href: "/schedules", label: "Schedules",       icon: Clock,        color: "#D97706" },
                { href: "/approvals", label: "Approval Queue",  icon: ShieldCheck,  color: "#D97706" },
              ].map(({ href, label, icon: Icon, color }) => (
                <Link
                  key={href}
                  href={href as Route}
                  className="flex items-center gap-2.5 rounded-xl px-2.5 transition-colors hover:bg-slate-50"
                  style={{ height: 38, color: "#334155" }}
                >
                  <Icon className="h-[14px] w-[14px] shrink-0" style={{ color }} />
                  <span style={{ fontSize: 13.5, fontWeight: 550 }}>{label}</span>
                </Link>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
