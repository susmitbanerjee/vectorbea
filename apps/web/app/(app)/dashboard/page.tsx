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
  CalendarClock,
  Webhook,
  type LucideIcon,
} from "lucide-react";

import { getPlatformSummary, getRuns } from "@/lib/repository";
import { apiFetch, withWorkspace } from "@/lib/api/client";
import type { AgentRun } from "@/types/platform";
import { cn } from "@/lib/utils";
import { Diamond, Console, Chip } from "@/components/ui/page-kit";

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
function clockTime(ts: string | null) {
  if (!ts) return "--:--";
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtTokens(n: number | null) {
  if (!n) return "0";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${n}`;
}
function fmtCost(n: number | null) {
  if (n == null || n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

const STATUS_TONE: Record<string, { tone: "green" | "red" | "teal" | "amber" | "gray"; pulse?: boolean; bar: string }> = {
  succeeded:            { tone: "green", bar: "#007F4E" },
  failed:               { tone: "red",   bar: "#DC2626" },
  running:              { tone: "teal",  pulse: true, bar: "#0F766E" },
  waiting_for_approval: { tone: "amber", pulse: true, bar: "#CA8A04" },
  queued:               { tone: "gray",  bar: "#C9CED4" },
  cancelled:            { tone: "gray",  bar: "#C9CED4" },
};
const STATUS_LABEL: Record<string, string> = {
  succeeded: "Succeeded", failed: "Failed", running: "Running",
  waiting_for_approval: "Awaiting", queued: "Queued", cancelled: "Cancelled",
};
const CONSOLE_STATUS: Record<string, { lvl: string; color: string }> = {
  succeeded: { lvl: "ok  ", color: "#34D399" }, failed: { lvl: "err ", color: "#F87171" },
  running: { lvl: "run ", color: "#5EEAD4" }, waiting_for_approval: { lvl: "hold", color: "#FBBF24" },
  queued: { lvl: "wait", color: "#9CA3AF" }, cancelled: { lvl: "skip", color: "#6B7280" },
};

// ─── KPI card ─────────────────────────────────────────────────────────────────

function Kpi({ label, value, sub, accent, icon: Icon, iconBg, iconFg, href }: {
  label: string; value: string | number; sub?: string; accent?: string;
  icon: LucideIcon; iconBg: string; iconFg: string; href?: Route;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#9CA3AF]">{label}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px]" style={{ background: iconBg, color: iconFg }}>
          <Icon className="h-4 w-4" strokeWidth={1.9} />
        </span>
      </div>
      <p className="mt-3 text-[30px] font-semibold leading-none tabular-nums tracking-[-0.03em]" style={{ color: accent ?? "#0B0D0F" }}>{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-[#6B7280]">{sub}</p>}
    </>
  );
  const cls = "rounded-[12px] border border-[#E0E3E6] bg-white p-4 transition-colors";
  return href ? <Link href={href} className={cn(cls, "block hover:border-[#C9CED4]")}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

// ─── Execution health centerpiece ─────────────────────────────────────────────

function ExecutionHealth({ succeeded, failed, running, recentRuns, tokens24h, cost24h }: {
  succeeded: number; failed: number; running: number; recentRuns: AgentRun[]; tokens24h: number; cost24h: number;
}) {
  const tot = succeeded + failed + running;
  const decided = succeeded + failed;
  const rate = decided > 0 ? Math.round((succeeded / decided) * 100) : null;
  const seg = (n: number) => (tot > 0 ? `${(n / tot) * 100}%` : "0%");

  const durs = [...recentRuns].reverse();
  const maxDur = Math.max(1, ...durs.map((r) => r.durationMs ?? 0));
  const withDur = recentRuns.filter((r) => r.durationMs);
  const avgLatency = withDur.length ? Math.round(withDur.reduce((s, r) => s + (r.durationMs ?? 0), 0) / withDur.length) : null;

  return (
    <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Diamond size={8} />
          <span className="vb-mono-label">Execution health</span>
          <span className="font-mono text-[11px] text-[#9CA3AF]">last 24h</span>
        </div>
        <Link href={"/runs" as Route} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#007F4E] hover:underline">
          Inspect <ArrowRight className="h-3 w-3" />
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 sm:grid-cols-[200px_minmax(0,1fr)]">
        {/* Success rate + stacked bar */}
        <div>
          <div className="flex items-end gap-2">
            <span className="text-[44px] font-semibold leading-none tabular-nums tracking-[-0.035em] text-[#0B0D0F]">{rate == null ? "—" : `${rate}%`}</span>
            <span className="mb-1.5 text-[12px] text-[#6B7280]">success</span>
          </div>
          <div className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-[#ECEEEF]">
            {succeeded > 0 && <span style={{ width: seg(succeeded), background: "#007F4E" }} />}
            {running > 0 && <span style={{ width: seg(running), background: "#0F766E" }} />}
            {failed > 0 && <span style={{ width: seg(failed), background: "#DC2626" }} />}
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-[#047857]"><span className="h-1.5 w-1.5 rounded-full bg-[#007F4E]" />{succeeded} ok</span>
            <span className="inline-flex items-center gap-1.5 text-[#B91C1C]"><span className="h-1.5 w-1.5 rounded-full bg-[#DC2626]" />{failed} failed</span>
            {running > 0 && <span className="inline-flex items-center gap-1.5 text-[#0F766E]"><span className="h-1.5 w-1.5 rounded-full bg-[#0F766E]" />{running} running</span>}
          </div>
        </div>

        {/* Duration sparkline */}
        <div className="flex flex-col justify-between">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#9CA3AF]">Recent durations</span>
          <div className="mt-2 flex items-end gap-[3px]" style={{ height: 56 }}>
            {durs.length === 0
              ? <span className="text-[12px] text-[#C9CED4]">no runs yet</span>
              : durs.slice(-32).map((r, i) => (
                <span key={i} title={`${r.workflowName ?? r.id.slice(0, 6)} · ${fmtDuration(r.durationMs)}`}
                  className="flex-1 rounded-[2px] transition-opacity hover:opacity-100"
                  style={{ height: `${Math.max(8, ((r.durationMs ?? 0) / maxDur) * 100)}%`, background: (STATUS_TONE[r.status]?.bar ?? "#C9CED4"), opacity: 0.85 }} />
              ))}
          </div>
        </div>
      </div>

      {/* Footer metrics */}
      <div className="mt-5 grid grid-cols-3 divide-x divide-[#ECEEEF] border-t border-[#ECEEEF] pt-4">
        {[
          { k: "Tokens · 24h", v: fmtTokens(tokens24h) },
          { k: "Cost · 24h", v: fmtCost(cost24h) },
          { k: "Avg latency", v: avgLatency ? fmtDuration(avgLatency) : "—" },
        ].map((m, i) => (
          <div key={i} className={cn("px-4", i === 0 && "pl-0")}>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9CA3AF]">{m.k}</p>
            <p className="mt-1 text-[20px] font-semibold tabular-nums tracking-[-0.02em] text-[#0B0D0F]">{m.v}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Dense activity row ───────────────────────────────────────────────────────

function RunRow({ run }: { run: AgentRun }) {
  const t = STATUS_TONE[run.status] ?? { tone: "gray" as const, bar: "#C9CED4" };
  const name = run.workflowName?.trim() ? run.workflowName : `Run ${run.id.slice(0, 8)}`;
  const ckpt = run.checkpoints?.length ?? 0;
  const TriggerIcon = run.triggerType === "cron" ? CalendarClock : run.triggerType === "webhook" ? Webhook : Play;
  return (
    <Link href={`/runs/${run.id}` as Route} className="group flex items-center gap-3 px-[18px] transition-colors hover:bg-[#FAFBFB]" style={{ minHeight: 58, borderTop: "1px solid #F1F2F3" }}>
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", t.pulse && "animate-pulse")} style={{ background: t.bar }} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-semibold leading-tight text-[#0B0D0F]">{name}</p>
        <div className="mt-1 flex items-center gap-2 truncate font-mono text-[11px] text-[#9CA3AF]">
          <span>{run.id.slice(0, 8)}</span>
          <span className="text-[#E0E3E6]">·</span>
          <span className="inline-flex items-center gap-1 capitalize"><TriggerIcon className="h-3 w-3" />{run.triggerType}</span>
          {(run.totalTokens ?? 0) > 0 && <><span className="text-[#E0E3E6]">·</span><span>{fmtTokens(run.totalTokens)} tok</span></>}
          {run.estimatedCostUsd ? <><span className="text-[#E0E3E6]">·</span><span>{fmtCost(run.estimatedCostUsd)}</span></> : null}
          {ckpt > 0 && <><span className="text-[#E0E3E6]">·</span><span className="inline-flex items-center gap-1 text-[#006B45]"><Diamond size={7} />{ckpt}</span></>}
        </div>
      </div>
      <Chip tone={t.tone} pulse={t.pulse}>{STATUS_LABEL[run.status] ?? run.status}</Chip>
      <span className="hidden w-14 shrink-0 text-right font-mono text-[12px] tabular-nums text-[#4B5563] sm:block">{fmtDuration(run.durationMs)}</span>
      <span className="hidden w-16 shrink-0 text-right font-mono text-[12px] text-[#9CA3AF] md:block">{timeAgo(run.startedAt)}</span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#C9CED4] opacity-0 transition-opacity group-hover:opacity-100" />
    </Link>
  );
}

// ─── Get started tile ─────────────────────────────────────────────────────────

function GetStartedTile({ icon: Icon, title, description, href, color }: {
  icon: LucideIcon; title: string; description: string; href: string; color: string;
}) {
  return (
    <Link href={href as Route} className="group flex items-start gap-3 rounded-[10px] border border-[#E0E3E6] bg-white p-3.5 transition-colors hover:border-[#C9CED4] hover:bg-[#FAFBFB]">
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
  totalWorkflows: number; activeWorkflows: number; totalAgents: number; totalTools: number;
  totalRuns: number; runningRuns: number; runningNow: number; waitingApprovals: number;
  pendingApprovals: number; failedRuns24h: number; failedLast24h: number; succeededRuns24h: number;
  succeededLast24h: number; totalTokens24h: number; totalCost24h: number;
  usageLast24h?: { tokens: number; estimatedCost: number };
  connectedWorkers: number; recentRunsTotal: number;
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

  const RECENT_RUNS_LIMIT = 10;

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
  const succeeded24 = summary?.succeededLast24h ?? summary?.succeededRuns24h ?? 0;
  const pending = summary?.pendingApprovals ?? summary?.waitingApprovals ?? 0;
  const tokens24h = summary?.totalTokens24h ?? summary?.usageLast24h?.tokens ?? 0;
  const cost24h = summary?.totalCost24h ?? summary?.usageLast24h?.estimatedCost ?? 0;

  const consoleLines = recentRuns.slice(0, 7).map((r) => {
    const m = CONSOLE_STATUS[r.status] ?? { lvl: "--  ", color: "#9CA3AF" };
    const name = (r.workflowName?.trim() || `run ${r.id.slice(0, 6)}`).slice(0, 20);
    const tail = r.status === "succeeded" ? fmtDuration(r.durationMs) : r.status === "running" ? "executing" : r.status === "waiting_for_approval" ? "awaiting approval" : r.status === "failed" ? "failed" : r.status;
    return { t: clockTime(r.startedAt), lvl: m.lvl, color: m.color, msg: `${name} · ${tail}` };
  });

  // System status pill
  const statusPill = loading ? null
    : failed24 > 0 ? { tone: "amber" as const, text: `${failed24} failed · 24h` }
    : runningNow > 0 ? { tone: "teal" as const, text: `${runningNow} running` }
    : { tone: "green" as const, text: "All systems durable" };

  return (
    <div className="page-shell space-y-4">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="vb-mono-label">Control plane</span>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="text-[26px] font-bold leading-tight tracking-[-0.03em] text-[#0B0D0F]">Overview</h1>
            {statusPill && <Chip tone={statusPill.tone} pulse={statusPill.tone !== "green"}>{statusPill.text}</Chip>}
          </div>
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
          <button type="button" onClick={() => void load()} disabled={loading} title="Refresh" className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#E0E3E6] bg-white transition-colors hover:bg-[#F3F4F5] disabled:opacity-40">
            <RefreshCw className={cn("h-[15px] w-[15px] text-[#6B7280]", loading && "animate-spin")} />
          </button>
        </div>
      </div>

      {/* Empty get-started */}
      {isEmpty && (
        <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-5">
          <div className="mb-3 flex items-center gap-2"><Diamond size={9} /><p className="text-[13.5px] font-semibold text-[#0B0D0F]">Get started with Vectorbea</p></div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <GetStartedTile icon={GitBranch} title="Create workflow" description="Build a durable AI workflow" href="/workflows/new" color="#007F4E" />
            <GetStartedTile icon={Plug}      title="Add connection"  description="Connect an LLM provider"   href="/connections"   color="#7C3AED" />
            <GetStartedTile icon={Bot}       title="Register agent"  description="Define an agent persona"   href="/agents/new"    color="#0F766E" />
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Active workflows" value={loading ? "…" : (summary?.activeWorkflows ?? 0)} sub={`${summary?.totalWorkflows ?? 0} total`} icon={GitBranch} iconBg="#E6F4EF" iconFg="#007F4E" href={"/workflows" as Route} />
        <Kpi label="Running now" value={loading ? "…" : runningNow} accent={runningNow > 0 ? "#0F766E" : undefined} sub={runningNow > 0 ? "executing" : "idle"} icon={Play} iconBg="#F0FDFA" iconFg="#0F766E" href={"/runs" as Route} />
        <Kpi label="Failed · 24h" value={loading ? "…" : failed24} accent={failed24 > 0 ? "#DC2626" : undefined} sub={`${succeeded24} succeeded`} icon={AlertTriangle} iconBg={failed24 > 0 ? "#FEF2F2" : "#F3F4F5"} iconFg={failed24 > 0 ? "#DC2626" : "#9CA3AF"} href={"/runs" as Route} />
        <Kpi label="Pending approvals" value={loading ? "…" : pending} accent={pending > 0 ? "#B45309" : undefined} sub={pending > 0 ? "awaiting decision" : "none waiting"} icon={ShieldCheck} iconBg={pending > 0 ? "#FFFBEB" : "#F3F4F5"} iconFg={pending > 0 ? "#CA8A04" : "#9CA3AF"} href={"/approvals" as Route} />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[minmax(0,1fr)_400px]">

        {/* Left column */}
        <div className="space-y-4">
          {/* Execution health */}
          {loading ? (
            <div className="h-[220px] animate-pulse rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB]" />
          ) : (
            <ExecutionHealth succeeded={succeeded24} failed={failed24} running={runningNow} recentRuns={recentRuns} tokens24h={tokens24h} cost24h={cost24h} />
          )}

          {/* Recent runs feed */}
          <div className="overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white">
            <div className="flex items-center justify-between px-[18px]" style={{ height: 50, borderBottom: "1px solid #ECEEEF" }}>
              <div className="flex items-center gap-2"><span className="text-[14px] font-bold text-[#0B0D0F]">Recent runs</span><span className="font-mono text-[11px] text-[#9CA3AF]">event-sourced</span></div>
              <Link href={"/runs" as Route} className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#007F4E] hover:underline">View all <ArrowRight className="h-3 w-3" /></Link>
            </div>

            {loading ? (
              <div>{Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-[18px]" style={{ minHeight: 58, borderTop: "1px solid #F1F2F3" }}>
                  <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#ECEEEF]" />
                  <div className="flex-1 space-y-1.5"><div className="h-3 w-1/3 animate-pulse rounded bg-[#ECEEEF]" /><div className="h-2.5 w-1/2 animate-pulse rounded bg-[#ECEEEF]" /></div>
                  <div className="h-5 w-16 animate-pulse rounded-full bg-[#ECEEEF]" />
                </div>
              ))}</div>
            ) : recentRuns.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 text-center" style={{ height: 260 }}>
                <span className="flex h-12 w-12 items-center justify-center rounded-[12px] border border-[#9CCFBB] bg-[#E6F4EF]"><GitBranch className="h-5 w-5 text-[#007F4E]" /></span>
                <div><p className="text-[15px] font-semibold text-[#0B0D0F]">No runs yet</p><p className="mt-1 text-[13px] text-[#9CA3AF]">Trigger your first workflow to see runs here.</p></div>
                <Link href={"/workflows/new" as Route} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white hover:bg-[#1c1f22]"><Plus className="h-3.5 w-3.5" /> Create workflow</Link>
              </div>
            ) : (
              <>
                <div>{recentRuns.map((run) => <RunRow key={run.id} run={run} />)}</div>
                <div className="flex items-center justify-between px-[18px] py-2.5" style={{ borderTop: "1px solid #ECEEEF" }}>
                  <span className="font-mono text-[11.5px] text-[#9CA3AF]">{runsTotal > 0 ? `${((runsPage - 1) * RECENT_RUNS_LIMIT) + 1}–${Math.min(runsPage * RECENT_RUNS_LIMIT, runsTotal)} of ${runsTotal.toLocaleString()}` : `${recentRuns.length} runs`}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" disabled={runsPage <= 1} onClick={() => { const p = runsPage - 1; setRunsPage(p); void load(p); }} className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#E0E3E6] bg-white text-[#4B5563] transition-colors hover:bg-[#F3F4F5] disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" /></button>
                    {Array.from({ length: Math.min(runsTotalPages, 5) }, (_, i) => { const half = 2; let start = Math.max(1, runsPage - half); const end = Math.min(runsTotalPages, start + 4); start = Math.max(1, end - 4); return start + i; }).filter(p => p <= runsTotalPages).map(p => (
                      <button key={p} type="button" onClick={() => { setRunsPage(p); void load(p); }} className={cn("flex h-7 w-7 items-center justify-center rounded-[6px] border text-[12px] font-medium transition-colors", p === runsPage ? "border-[#0B0D0F] bg-[#0B0D0F] text-white" : "border-[#E0E3E6] bg-white text-[#4B5563] hover:bg-[#F3F4F5]")}>{p}</button>
                    ))}
                    <button type="button" disabled={runsPage >= runsTotalPages} onClick={() => { const p = runsPage + 1; setRunsPage(p); void load(p); }} className="flex h-7 w-7 items-center justify-center rounded-[6px] border border-[#E0E3E6] bg-white text-[#4B5563] transition-colors hover:bg-[#F3F4F5] disabled:opacity-40"><ChevronRight className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          {!loading && recentRuns.length > 0 && (
            <Console title="runtime · live" badge={runningNow > 0 ? `${runningNow} active` : "idle"} lines={consoleLines} />
          )}

          {/* Usage today */}
          <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-[18px]">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2"><span className="vb-mono-label">Usage</span><p className="text-[13.5px] font-bold text-[#0B0D0F]">Today</p></div>
              <Link href={"/settings/usage" as never} className="text-[12px] font-semibold text-[#007F4E] hover:underline">Limits →</Link>
            </div>
            {betaUsage ? (
              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[12px] text-[#6B7280]">Runs</span>
                    <span className="font-mono text-[12.5px] font-bold tabular-nums" style={{ color: betaUsage.runsToday >= betaUsage.maxRunsPerDay * 0.8 ? "#DC2626" : "#0B0D0F" }}>{betaUsage.runsToday} / {betaUsage.maxRunsPerDay}</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 99, background: "#ECEEEF", overflow: "hidden" }}>
                    <div style={{ height: "100%", borderRadius: 99, width: `${Math.min(100, Math.round((betaUsage.runsToday / betaUsage.maxRunsPerDay) * 100))}%`, background: betaUsage.runsToday >= betaUsage.maxRunsPerDay * 0.8 ? "#DC2626" : "#007F4E", transition: "width 0.4s ease" }} />
                  </div>
                </div>
                <div className="flex items-center justify-between border-t border-[#ECEEEF] pt-3">
                  <span className="text-[12px] text-[#6B7280]">Execution</span>
                  <span className="rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: betaUsage.canRunRealExecution ? "#E6F4EF" : "#FFFBEB", color: betaUsage.canRunRealExecution ? "#006B45" : "#92400E" }}>{betaUsage.canRunRealExecution ? "Real enabled" : "Simulation only"}</span>
                </div>
              </div>
            ) : (
              <div className="space-y-2"><div style={{ height: 6, borderRadius: 99, background: "#ECEEEF" }} /><p className="font-mono text-[12px] text-[#9CA3AF]">Loading usage…</p></div>
            )}
          </div>

          {/* Explore */}
          <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-[18px]">
            <span className="vb-mono-label">Explore</span>
            <div className="mt-2">
              {[
                { href: "/agents", label: "Agents", icon: Bot, color: "#7C3AED" },
                { href: "/tools", label: "Tools", icon: Wrench, color: "#0F766E" },
                { href: "/schedules", label: "Schedules", icon: Clock, color: "#CA8A04" },
                { href: "/connections", label: "Connections", icon: Plug, color: "#2563EB" },
                { href: "/approvals", label: "Approval gates", icon: ShieldCheck, color: "#007F4E" },
              ].map(({ href, label, icon: Icon, color }) => (
                <Link key={href} href={href as Route} className="group flex items-center gap-2.5 rounded-[8px] px-2.5 transition-colors hover:bg-[#F3F4F5]" style={{ height: 38 }}>
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
