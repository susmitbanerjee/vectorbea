"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  Bot,
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
  ArrowRight,
  type LucideIcon,
} from "lucide-react";

import { getPlatformSummary, getRuns } from "@/lib/repository";
import { apiFetch, withWorkspace } from "@/lib/api/client";
import type { AgentRun } from "@/types/platform";
import { cn } from "@/lib/utils";
import { Diamond } from "@/components/ui/page-kit";

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
  succeeded:            { dot: "bg-emerald-500",               label: "Succeeded",        labelColor: "#047857" },
  failed:               { dot: "bg-red-500",                   label: "Failed",           labelColor: "#DC2626" },
  running:              { dot: "bg-teal-500 animate-pulse",    label: "Running",          labelColor: "#0F766E" },
  waiting_for_approval: { dot: "bg-amber-500 animate-pulse",   label: "Awaiting approval",labelColor: "#B45309" },
  queued:               { dot: "bg-[#9CA3AF]",                 label: "Queued",           labelColor: "#6B7280" },
  cancelled:            { dot: "bg-[#C9CED4]",                 label: "Cancelled",        labelColor: "#9CA3AF" },
};

// ─── Stat card ──────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, accent, icon: Icon, iconBg, iconFg,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  icon: LucideIcon;
  iconBg: string;
  iconFg: string;
}) {
  return (
    <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#9CA3AF]">{label}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px]" style={{ background: iconBg, color: iconFg }}>
          <Icon className="h-4 w-4" strokeWidth={1.9} />
        </span>
      </div>
      <p className="mt-3 text-[28px] font-semibold leading-none tabular-nums tracking-[-0.025em]" style={{ color: accent ?? "#0B0D0F" }}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[12px] text-[#6B7280]">{sub}</p>}
    </div>
  );
}

// ─── Run row ──────────────────────────────────────────────────────────────────

function RunRow({ run }: { run: AgentRun }) {
  const cfg = STATUS_CONFIG[run.status] ?? { dot: "bg-[#9CA3AF]", label: run.status, labelColor: "#6B7280" };
  const displayName = run.workflowName?.trim() ? run.workflowName : `Run ${run.id.slice(0, 8)}`;
  return (
    <Link
      href={`/runs/${run.id}` as Route}
      className="group grid items-center gap-3 px-[18px] transition-colors hover:bg-[#FAFBFB]"
      style={{ gridTemplateColumns: "10px minmax(0,1fr) 72px 72px 16px", borderTop: "1px solid #F1F2F3", minHeight: 52 }}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", cfg.dot)} />
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-semibold leading-[1.25] text-[#0B0D0F]">{displayName}</p>
        <p className="mt-px text-[11.5px] font-medium" style={{ color: cfg.labelColor }}>{cfg.label}</p>
      </div>
      <span className="text-right font-mono text-[12px] tabular-nums text-[#4B5563]">{fmtDuration(run.durationMs)}</span>
      <span className="text-right font-mono text-[12px] text-[#9CA3AF]">{timeAgo(run.startedAt)}</span>
      <ArrowRight className="h-3.5 w-3.5 text-[#C9CED4] opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

// ─── Get started tile ─────────────────────────────────────────────────────────

function GetStartedTile({
  icon: Icon, title, description, href, color,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  href: string;
  color: string;
}) {
  return (
    <Link
      href={href as Route}
      className="group flex items-start gap-3 rounded-[10px] border border-[#E0E3E6] bg-white p-3.5 transition-colors hover:border-[#C9CED4] hover:bg-[#FAFBFB]"
    >
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]" style={{ background: `${color}14`, border: `1px solid ${color}33`, color }}>
        <Icon className="h-4 w-4" strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold leading-5 text-[#0B0D0F]">{title}</p>
        <p className="mt-0.5 text-[12px] leading-4 text-[#6B7280]">{description}</p>
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

  const isEmpty = !loading && (summary?.totalWorkflows ?? 0) === 0 && (summary?.totalAgents ?? 0) === 0;
  const runningNow = summary?.runningNow ?? summary?.runningRuns ?? 0;
  const failed24 = summary?.failedLast24h ?? summary?.failedRuns24h ?? 0;
  const pending = summary?.pendingApprovals ?? summary?.waitingApprovals ?? 0;

  return (
    <div className="page-shell space-y-4">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="vb-mono-label">Control plane</span>
          <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.025em] text-[#0B0D0F]">Overview</h1>
          <p className="mt-1 text-[13.5px] text-[#6B7280]">Live state of your durable agent workflows.</p>
        </div>
        <div className="flex items-center gap-2">
          {pending > 0 && (
            <Link href={"/approvals" as Route} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#9CCFBB] bg-[#E6F4EF] px-3 text-[13px] font-semibold text-[#006B45] transition-colors hover:bg-[#d8ebe2]">
              <ShieldCheck className="h-4 w-4" /> {pending} approval{pending !== 1 ? "s" : ""}
            </Link>
          )}
          <Link href={"/workflows/new" as Route} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1c1f22]">
            <Plus className="h-3.5 w-3.5" /> New workflow
          </Link>
          <button type="button" onClick={() => void load()} disabled={loading} title="Refresh"
            className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#E0E3E6] bg-white transition-colors hover:bg-[#F3F4F5] disabled:opacity-40">
            <RefreshCw className={cn("h-[15px] w-[15px] text-[#6B7280]", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* ── Empty get-started ───────────────────────────────────────────── */}
      {isEmpty && (
        <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-5">
          <div className="mb-3 flex items-center gap-2">
            <Diamond size={9} />
            <p className="text-[13.5px] font-semibold text-[#0B0D0F]">Get started with Vectorbea</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <GetStartedTile icon={GitBranch} title="Create workflow" description="Build a durable AI workflow" href="/workflows/new" color="#007F4E" />
            <GetStartedTile icon={Plug}      title="Add connection"  description="Connect an LLM provider"   href="/connections"   color="#7C3AED" />
            <GetStartedTile icon={Bot}       title="Register agent"  description="Define an agent persona"   href="/agents/new"    color="#0F766E" />
          </div>
        </div>
      )}

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard label="Active workflows" value={loading ? "…" : (summary?.activeWorkflows ?? 0)} sub={`${summary?.totalWorkflows ?? 0} total`} icon={GitBranch} iconBg="#E6F4EF" iconFg="#007F4E" />
        <StatCard label="Running now" value={loading ? "…" : runningNow} accent={runningNow > 0 ? "#0F766E" : undefined} sub={runningNow > 0 ? "executing" : "idle"} icon={Play} iconBg="#F0FDFA" iconFg="#0F766E" />
        <StatCard label="Failed · 24h" value={loading ? "…" : failed24} accent={failed24 > 0 ? "#DC2626" : undefined} sub={`${summary?.succeededLast24h ?? summary?.succeededRuns24h ?? 0} succeeded`} icon={AlertTriangle} iconBg={failed24 > 0 ? "#FEF2F2" : "#F3F4F5"} iconFg={failed24 > 0 ? "#DC2626" : "#9CA3AF"} />
        <StatCard label="Pending approvals" value={loading ? "…" : pending} accent={pending > 0 ? "#B45309" : undefined} sub={pending > 0 ? "awaiting decision" : "none waiting"} icon={ShieldCheck} iconBg={pending > 0 ? "#FFFBEB" : "#F3F4F5"} iconFg={pending > 0 ? "#CA8A04" : "#9CA3AF"} />
      </div>

      {/* ── Main grid ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">

        {/* Recent runs */}
        <div className="overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white">
          <div className="flex items-center justify-between px-[18px]" style={{ height: 50, borderBottom: "1px solid #ECEEEF" }}>
            <div className="flex items-center gap-2">
              <span className="vb-mono-label">Activity</span>
              <span className="text-[14px] font-bold text-[#0B0D0F]">Recent runs</span>
            </div>
            <Link href={"/runs" as Route} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#007F4E] hover:underline">
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          {loading ? (
            <div>
              {Array.from({ length: RECENT_RUNS_LIMIT }).map((_, i) => (
                <div key={i} className="grid items-center gap-3 px-[18px]" style={{ gridTemplateColumns: "10px minmax(0,1fr) 72px 72px 16px", borderTop: "1px solid #F1F2F3", minHeight: 52 }}>
                  <div className="h-2 w-2 animate-pulse rounded-full bg-[#ECEEEF]" />
                  <div className="space-y-1.5">
                    <div className="h-3 w-2/3 animate-pulse rounded-md bg-[#ECEEEF]" />
                    <div className="h-2.5 w-1/4 animate-pulse rounded-md bg-[#ECEEEF]" />
                  </div>
                  <div className="h-3 w-full animate-pulse rounded-md bg-[#ECEEEF]" />
                  <div className="h-3 w-full animate-pulse rounded-md bg-[#ECEEEF]" />
                  <div />
                </div>
              ))}
            </div>
          ) : recentRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 text-center" style={{ height: 280 }}>
              <span className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-[#9CCFBB] bg-[#E6F4EF]">
                <GitBranch className="h-5 w-5 text-[#007F4E]" />
              </span>
              <div>
                <p className="text-[15px] font-semibold text-[#0B0D0F]">No runs yet</p>
                <p className="mt-1 text-[13px] text-[#9CA3AF]">Trigger your first workflow to see runs here.</p>
              </div>
              <Link href={"/workflows/new" as Route} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white hover:bg-[#1c1f22]">
                <Plus className="h-3.5 w-3.5" /> Create workflow
              </Link>
            </div>
          ) : (
            <>
              <div>{recentRuns.slice(0, RECENT_RUNS_LIMIT).map((run) => <RunRow key={run.id} run={run} />)}</div>
              <div className="flex items-center justify-between px-[18px] py-2.5" style={{ borderTop: "1px solid #ECEEEF" }}>
                <span className="font-mono text-[11.5px] text-[#9CA3AF]">
                  {runsTotal > 0
                    ? `${((runsPage - 1) * RECENT_RUNS_LIMIT) + 1}–${Math.min(runsPage * RECENT_RUNS_LIMIT, runsTotal)} of ${runsTotal.toLocaleString()}`
                    : `${recentRuns.length} run${recentRuns.length !== 1 ? "s" : ""}`}
                </span>
                <div className="flex items-center gap-1">
                  <button type="button" disabled={runsPage <= 1} onClick={() => { const p = runsPage - 1; setRunsPage(p); void load(p); }}
                    className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#E0E3E6] bg-white text-[#4B5563] transition-colors hover:bg-[#F3F4F5] disabled:opacity-40">
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  {Array.from({ length: Math.min(runsTotalPages, 5) }, (_, i) => {
                    const half = 2;
                    let start = Math.max(1, runsPage - half);
                    const end = Math.min(runsTotalPages, start + 4);
                    start = Math.max(1, end - 4);
                    return start + i;
                  }).filter(p => p <= runsTotalPages).map(p => (
                    <button key={p} type="button" onClick={() => { setRunsPage(p); void load(p); }}
                      className={cn("flex h-7 w-7 items-center justify-center rounded-[6px] border text-[12px] font-medium transition-colors",
                        p === runsPage ? "border-[#0B0D0F] bg-[#0B0D0F] text-white" : "border-[#E0E3E6] bg-white text-[#4B5563] hover:bg-[#F3F4F5]")}>
                      {p}
                    </button>
                  ))}
                  <button type="button" disabled={runsPage >= runsTotalPages} onClick={() => { const p = runsPage + 1; setRunsPage(p); void load(p); }}
                    className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#E0E3E6] bg-white text-[#4B5563] transition-colors hover:bg-[#F3F4F5] disabled:opacity-40">
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          {/* Usage today */}
          <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-[18px]">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="vb-mono-label">Usage</span>
                <p className="text-[13.5px] font-bold text-[#0B0D0F]">Today</p>
              </div>
              <Link href={"/settings/usage" as never} className="text-[12px] font-semibold text-[#007F4E] hover:underline">View limits →</Link>
            </div>
            {betaUsage ? (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[12px] text-[#6B7280]">Runs</span>
                    <span className="font-mono text-[12.5px] font-bold tabular-nums" style={{ color: betaUsage.runsToday >= betaUsage.maxRunsPerDay * 0.8 ? "#DC2626" : "#0B0D0F" }}>
                      {betaUsage.runsToday} / {betaUsage.maxRunsPerDay}
                    </span>
                  </div>
                  <div style={{ height: 6, borderRadius: 99, background: "#ECEEEF", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 99,
                      width: `${Math.min(100, Math.round((betaUsage.runsToday / betaUsage.maxRunsPerDay) * 100))}%`,
                      background: betaUsage.runsToday >= betaUsage.maxRunsPerDay * 0.8 ? "#DC2626" : "#007F4E",
                      transition: "width 0.4s ease",
                    }} />
                  </div>
                  {(betaUsage.simulationRunsToday > 0 || betaUsage.realRunsToday > 0) && (
                    <p className="mt-1.5 font-mono text-[11px] text-[#9CA3AF]">
                      {betaUsage.simulationRunsToday > 0 && `${betaUsage.simulationRunsToday} simulation`}
                      {betaUsage.simulationRunsToday > 0 && betaUsage.realRunsToday > 0 && " · "}
                      {betaUsage.realRunsToday > 0 && `${betaUsage.realRunsToday} real`}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between border-t border-[#ECEEEF] pt-3">
                  <span className="text-[12px] text-[#6B7280]">Execution</span>
                  <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{
                    background: betaUsage.canRunRealExecution ? "#E6F4EF" : "#FFFBEB",
                    color: betaUsage.canRunRealExecution ? "#006B45" : "#92400E",
                  }}>
                    {betaUsage.canRunRealExecution ? "Real enabled" : "Simulation only"}
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div style={{ height: 6, borderRadius: 99, background: "#ECEEEF" }} />
                <p className="font-mono text-[12px] text-[#9CA3AF]">Loading usage…</p>
              </div>
            )}
          </div>

          {/* Explore */}
          <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-[18px]">
            <span className="vb-mono-label">Explore</span>
            <div className="mt-2">
              {[
                { href: "/agents",    label: "Agents",         icon: Bot,         color: "#7C3AED" },
                { href: "/tools",     label: "Tools",          icon: Wrench,      color: "#0F766E" },
                { href: "/schedules", label: "Schedules",      icon: Clock,       color: "#CA8A04" },
                { href: "/approvals", label: "Approval gates", icon: ShieldCheck, color: "#007F4E" },
              ].map(({ href, label, icon: Icon, color }) => (
                <Link key={href} href={href as Route}
                  className="group flex items-center gap-2.5 rounded-[8px] px-2.5 transition-colors hover:bg-[#F3F4F5]" style={{ height: 38 }}>
                  <Icon className="h-[15px] w-[15px] shrink-0" style={{ color }} />
                  <span className="flex-1 text-[13.5px] font-medium text-[#374151]">{label}</span>
                  <ArrowRight className="h-3.5 w-3.5 text-[#C9CED4] opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
