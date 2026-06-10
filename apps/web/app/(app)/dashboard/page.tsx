"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  Activity, AlertTriangle, ArrowRight, Bot, Clock, Coins, GitBranch,
  Play, Plug, Plus, RefreshCw, ShieldCheck, Sparkles, Timer, Wrench,
  type LucideIcon,
} from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, ResponsiveContainer, Tooltip } from "recharts";

import { getPlatformSummary, getRuns } from "@/lib/repository";
import { apiFetch, withWorkspace } from "@/lib/api/client";
import type { AgentRun } from "@/types/platform";
import { cn } from "@/lib/utils";
import { Diamond, Chip } from "@/components/ui/page-kit";
import { ArchitectLogo } from "@/components/architect/ArchitectLogo";

// ─── Format helpers ───────────────────────────────────────────────────────────
function fmtDuration(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
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

// ─── KPI card ─────────────────────────────────────────────────────────────────
function Kpi({ label, value, sub, accent, icon: Icon, iconBg, iconFg, href }: {
  label: string; value: string | number; sub?: string; accent?: string;
  icon: LucideIcon; iconBg: string; iconFg: string; href?: Route;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#9CA3AF]">{label}</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-[8px]" style={{ background: iconBg, color: iconFg }}><Icon className="h-4 w-4" strokeWidth={1.9} /></span>
      </div>
      <p className="mt-3 text-[30px] font-semibold leading-none tabular-nums tracking-[-0.03em]" style={{ color: accent ?? "#0B0D0F" }}>{value}</p>
      {sub && <p className="mt-1.5 text-[12px] text-[#6B7280]">{sub}</p>}
    </>
  );
  const cls = "rounded-[12px] border border-[#E0E3E6] bg-white p-4 transition-colors";
  return href ? <Link href={href} className={cn(cls, "block hover:border-[#C9CED4]")}>{inner}</Link> : <div className={cls}>{inner}</div>;
}

// ─── Metric tile ──────────────────────────────────────────────────────────────
function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: LucideIcon }) {
  return (
    <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-4">
      <div className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 text-[#9CA3AF]" /><span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[#9CA3AF]">{label}</span></div>
      <p className="mt-2.5 text-[24px] font-semibold leading-none tabular-nums tracking-[-0.025em] text-[#0B0D0F]">{value}</p>
    </div>
  );
}

// ─── Panel shell ──────────────────────────────────────────────────────────────
function ChartPanel({ label, title, action, children, className }: { label: string; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-[12px] border border-[#E0E3E6] bg-white p-5", className)}>
      <div className="mb-4 flex items-start justify-between">
        <div className="flex items-center gap-2"><Diamond size={8} /><span className="vb-mono-label">{label}</span><span className="text-[14px] font-bold text-[#0B0D0F]">{title}</span></div>
        {action}
      </div>
      {children}
    </div>
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

const LAT_BUCKETS = [
  { label: "<1s", max: 1000 },
  { label: "1–5s", max: 5000 },
  { label: "5–30s", max: 30_000 },
  { label: "30s–2m", max: 120_000 },
  { label: ">2m", max: Infinity },
];

const ACTIVITY_SERIES = [
  { key: "succeeded", label: "Succeeded", color: "#007F4E" },
  { key: "active",    label: "In flight", color: "#0F766E" },
  { key: "failed",    label: "Failed",    color: "#DC2626" },
  { key: "cancelled", label: "Cancelled", color: "#C9CED4" },
] as const;

export default function OverviewPage() {
  const [summary, setSummary]   = useState<Summary | null>(null);
  const [runSample, setRunSample] = useState<AgentRun[]>([]);
  const [loading, setLoading]   = useState(true);
  const [betaUsage, setBetaUsage] = useState<{
    runsToday: number; maxRunsPerDay: number; simulationRunsToday: number; realRunsToday: number;
    canRunRealExecution: boolean; executionMode: string;
  } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [s, runs] = await Promise.all([getPlatformSummary(), getRuns({ pageSize: 50, page: 1 })]);
      setSummary(s as Summary);
      setRunSample(runs.items ?? []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  useEffect(() => {
    void load();
    apiFetch<typeof betaUsage & Record<string, unknown>>(withWorkspace("/api/beta/status"))
      .then(r => setBetaUsage(r as typeof betaUsage)).catch(() => {});
  }, []);

  const isEmpty = !loading && (summary?.totalWorkflows ?? 0) === 0 && (summary?.totalAgents ?? 0) === 0;
  const runningNow = summary?.runningNow ?? summary?.runningRuns ?? 0;
  const failed24 = summary?.failedLast24h ?? summary?.failedRuns24h ?? 0;
  const succeeded24 = summary?.succeededLast24h ?? summary?.succeededRuns24h ?? 0;
  const pending = summary?.pendingApprovals ?? summary?.waitingApprovals ?? 0;
  const tokens24h = summary?.totalTokens24h ?? summary?.usageLast24h?.tokens ?? 0;
  const cost24h = summary?.totalCost24h ?? summary?.usageLast24h?.estimatedCost ?? 0;
  const totalRuns24h = succeeded24 + failed24 + runningNow;
  const rate = (succeeded24 + failed24) > 0 ? Math.round((succeeded24 / (succeeded24 + failed24)) * 100) : null;

  // Run outcomes donut (24h, real)
  const outcomeData = [
    { name: "Succeeded", value: succeeded24, color: "#007F4E" },
    { name: "Running", value: runningNow, color: "#0F766E" },
    { name: "Failed", value: failed24, color: "#DC2626" },
  ].filter(d => d.value > 0);

  // Hourly activity — last 24h, bucketed from the run sample (real)
  const { activityBuckets, activityTotal } = useMemo(() => {
    const buckets = Array.from({ length: 24 }, (_, i) => {
      const ago = 23 - i;
      return { label: ago === 0 ? "now" : `-${ago}h`, succeeded: 0, failed: 0, cancelled: 0, active: 0 };
    });
    const now = Date.now();
    let total = 0;
    for (const r of runSample) {
      const t = Date.parse(r.startedAt ?? r.createdAt);
      if (Number.isNaN(t)) continue;
      const ageH = (now - t) / 3_600_000;
      if (ageH < 0 || ageH >= 24) continue;
      const b = buckets[23 - Math.floor(ageH)];
      if (r.status === "succeeded") b.succeeded++;
      else if (r.status === "failed" || r.status === "timed_out") b.failed++;
      else if (r.status === "cancelled") b.cancelled++;
      else b.active++;
      total++;
    }
    return { activityBuckets: buckets, activityTotal: total };
  }, [runSample]);

  // Latency profile (from run sample, real)
  const { histData, avgLatency, p95Latency, sampleN } = useMemo(() => {
    const durs = runSample.map(r => r.durationMs).filter((d): d is number => typeof d === "number" && d > 0).sort((a, b) => a - b);
    const counts = LAT_BUCKETS.map(b => ({ label: b.label, count: 0 }));
    for (const d of durs) { const i = LAT_BUCKETS.findIndex(b => d < b.max); counts[i === -1 ? counts.length - 1 : i].count++; }
    const avg = durs.length ? Math.round(durs.reduce((s, d) => s + d, 0) / durs.length) : null;
    const p95 = durs.length ? durs[Math.min(durs.length - 1, Math.floor(durs.length * 0.95))] : null;
    return { histData: counts, avgLatency: avg, p95Latency: p95, sampleN: durs.length };
  }, [runSample]);

  // Resource composition (real counts)
  const resources = [
    { label: "Workflows", value: summary?.totalWorkflows ?? 0, color: "#007F4E", href: "/workflows" as Route, icon: GitBranch },
    { label: "Agents", value: summary?.totalAgents ?? 0, color: "#7C3AED", href: "/agents" as Route, icon: Bot },
    { label: "Tools", value: summary?.totalTools ?? 0, color: "#0F766E", href: "/tools" as Route, icon: Wrench },
  ];
  const resMax = Math.max(1, ...resources.map(r => r.value));

  const statusPill = loading ? null
    : failed24 > 0 ? { tone: "amber" as const, text: `${failed24} failed · 24h` }
    : runningNow > 0 ? { tone: "teal" as const, text: `${runningNow} running` }
    : { tone: "green" as const, text: "All systems durable" };

  const workflowUtil = (summary?.totalWorkflows ?? 0) > 0 ? Math.round(((summary?.activeWorkflows ?? 0) / (summary?.totalWorkflows ?? 1)) * 100) : null;

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

      {/* Empty get-started — architect first */}
      {isEmpty && (
        <div className="animate-slide-up overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white">
          <div
            className="flex flex-col items-start justify-between gap-4 border-b border-[#ECEEEF] px-5 py-5 sm:flex-row sm:items-center"
            style={{
              background: "#FAFBFB",
              backgroundImage: "radial-gradient(#D2D6DB 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          >
            <div className="flex items-center gap-3.5">
              <ArchitectLogo size={40} />
              <div>
                <p className="text-[15px] font-bold tracking-[-0.01em] text-[#0B0D0F]">Describe it. Vectorbea builds it.</p>
                <p className="mt-0.5 text-[12.5px] text-[#6B7280]">The AI Architect turns a plain-English goal into agents, tools and a runnable workflow.</p>
              </div>
            </div>
            <Link href={"/workflows/new/architect" as Route} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-[9px] bg-[#007F4E] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#006B45]">
              <Sparkles className="h-3.5 w-3.5" /> Open AI Architect
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
            <Link href={"/workflows/new" as Route} className="group flex items-start gap-3 rounded-[10px] border border-[#E0E3E6] bg-white p-3.5 transition-colors hover:border-[#C9CED4] hover:bg-[#FAFBFB]"><span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[9px]" style={{ background: "#007F4E14", border: "1px solid #007F4E33", color: "#007F4E" }}><GitBranch className="h-4 w-4" /></span><div><p className="text-[13.5px] font-semibold text-[#0B0D0F]">Create workflow</p><p className="mt-0.5 text-[12px] text-[#6B7280]">Build a durable AI workflow</p></div></Link>
            <Link href={"/connections" as Route} className="group flex items-start gap-3 rounded-[10px] border border-[#E0E3E6] bg-white p-3.5 transition-colors hover:border-[#C9CED4] hover:bg-[#FAFBFB]"><span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[9px]" style={{ background: "#7C3AED14", border: "1px solid #7C3AED33", color: "#7C3AED" }}><Plug className="h-4 w-4" /></span><div><p className="text-[13.5px] font-semibold text-[#0B0D0F]">Add connection</p><p className="mt-0.5 text-[12px] text-[#6B7280]">Connect an LLM provider</p></div></Link>
            <Link href={"/agents/new" as Route} className="group flex items-start gap-3 rounded-[10px] border border-[#E0E3E6] bg-white p-3.5 transition-colors hover:border-[#C9CED4] hover:bg-[#FAFBFB]"><span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-[9px]" style={{ background: "#0F766E14", border: "1px solid #0F766E33", color: "#0F766E" }}><Bot className="h-4 w-4" /></span><div><p className="text-[13.5px] font-semibold text-[#0B0D0F]">Register agent</p><p className="mt-0.5 text-[12px] text-[#6B7280]">Define an agent persona</p></div></Link>
          </div>
        </div>
      )}

      {/* KPI cards */}
      <div className="animate-slide-up grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Active workflows" value={loading ? "…" : (summary?.activeWorkflows ?? 0)} sub={`${summary?.totalWorkflows ?? 0} total`} icon={GitBranch} iconBg="#E6F4EF" iconFg="#007F4E" href={"/workflows" as Route} />
        <Kpi label="Running now" value={loading ? "…" : runningNow} accent={runningNow > 0 ? "#0F766E" : undefined} sub={runningNow > 0 ? "executing" : "idle"} icon={Play} iconBg="#F0FDFA" iconFg="#0F766E" href={"/runs" as Route} />
        <Kpi label="Failed · 24h" value={loading ? "…" : failed24} accent={failed24 > 0 ? "#DC2626" : undefined} sub={`${succeeded24} succeeded`} icon={AlertTriangle} iconBg={failed24 > 0 ? "#FEF2F2" : "#F3F4F5"} iconFg={failed24 > 0 ? "#DC2626" : "#9CA3AF"} href={"/runs" as Route} />
        <Kpi label="Pending approvals" value={loading ? "…" : pending} accent={pending > 0 ? "#B45309" : undefined} sub={pending > 0 ? "awaiting decision" : "none waiting"} icon={ShieldCheck} iconBg={pending > 0 ? "#FFFBEB" : "#F3F4F5"} iconFg={pending > 0 ? "#CA8A04" : "#9CA3AF"} href={"/approvals" as Route} />
      </div>

      {/* Reliability row: outcomes donut + hourly activity */}
      <div className="animate-slide-up stagger-1 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        {/* Run outcomes donut */}
        <ChartPanel label="Reliability" title="Run outcomes" action={<span className="font-mono text-[11px] text-[#9CA3AF]">24h</span>}>
          {loading ? (
            <div className="h-[200px] animate-pulse rounded-[10px] bg-[#FAFBFB]" />
          ) : totalRuns24h === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center"><Activity className="h-6 w-6 text-[#C9CED4]" /><p className="text-[13px] text-[#9CA3AF]">No runs in the last 24h</p></div>
          ) : (
            <>
              <div className="relative" style={{ height: 184 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={outcomeData} dataKey="value" nameKey="name" innerRadius={60} outerRadius={86} paddingAngle={outcomeData.length > 1 ? 2 : 0} startAngle={90} endAngle={-270} stroke="none">
                      {outcomeData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip cursor={false} contentStyle={{ borderRadius: 8, border: "1px solid #E0E3E6", fontSize: 12, fontFamily: "var(--font-mono)" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-[30px] font-semibold tabular-nums tracking-[-0.03em] text-[#0B0D0F]">{rate == null ? "—" : `${rate}%`}</span>
                  <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[#9CA3AF]">success</span>
                </div>
              </div>
              <div className="mt-4 space-y-2 border-t border-[#ECEEEF] pt-3">
                {[{ l: "Succeeded", v: succeeded24, c: "#007F4E" }, { l: "Running", v: runningNow, c: "#0F766E" }, { l: "Failed", v: failed24, c: "#DC2626" }].map((r) => (
                  <div key={r.l} className="flex items-center justify-between text-[12.5px]">
                    <span className="flex items-center gap-2 text-[#4B5563]"><span className="h-2 w-2 rounded-full" style={{ background: r.c }} />{r.l}</span>
                    <span className="font-mono tabular-nums text-[#0B0D0F]">{r.v}<span className="ml-1 text-[#9CA3AF]">{totalRuns24h ? `${Math.round((r.v / totalRuns24h) * 100)}%` : "0%"}</span></span>
                  </div>
                ))}
              </div>
            </>
          )}
        </ChartPanel>

        {/* Hourly activity — stacked outcomes */}
        <ChartPanel label="Throughput" title="Activity" action={<span className="font-mono text-[11px] text-[#9CA3AF]">last {runSample.length} runs · 24h</span>}>
          {loading ? (
            <div className="h-[200px] animate-pulse rounded-[10px] bg-[#FAFBFB]" />
          ) : activityTotal === 0 ? (
            <div className="flex h-[200px] flex-col items-center justify-center gap-2 text-center"><Clock className="h-6 w-6 text-[#C9CED4]" /><p className="text-[13px] text-[#9CA3AF]">No run activity in the last 24h</p></div>
          ) : (
            <>
              <div style={{ height: 184 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={activityBuckets} margin={{ top: 8, right: 4, left: 4, bottom: 0 }} barCategoryGap="22%">
                    <XAxis dataKey="label" tickLine={false} axisLine={false} interval={5} tick={{ fontSize: 10.5, fill: "#9CA3AF", fontFamily: "var(--font-mono)" }} />
                    <Tooltip cursor={{ fill: "#F3F4F5" }} contentStyle={{ borderRadius: 8, border: "1px solid #E0E3E6", fontSize: 12, fontFamily: "var(--font-mono)" }} />
                    {ACTIVITY_SERIES.map(s => (
                      <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={s.color} radius={s.key === "cancelled" ? [3, 3, 0, 0] : undefined} maxBarSize={22} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-[#ECEEEF] pt-3">
                {ACTIVITY_SERIES.map(s => {
                  const total = activityBuckets.reduce((sum, b) => sum + b[s.key], 0);
                  if (total === 0) return null;
                  return (
                    <span key={s.key} className="flex items-center gap-1.5 text-[12px] text-[#4B5563]">
                      <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} />
                      {s.label} <span className="font-mono tabular-nums text-[#0B0D0F]">{total}</span>
                    </span>
                  );
                })}
              </div>
            </>
          )}
        </ChartPanel>
      </div>

      {/* Performance + resources + rail */}
      <div className="animate-slide-up stagger-2 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)]">
        <div className="space-y-4">
          {/* Latency histogram */}
          <ChartPanel label="Performance" title="Execution latency" action={<span className="font-mono text-[11px] text-[#9CA3AF]">{sampleN} runs</span>}>
            {loading ? (
              <div className="h-[180px] animate-pulse rounded-[10px] bg-[#FAFBFB]" />
            ) : sampleN === 0 ? (
              <div className="flex h-[180px] flex-col items-center justify-center gap-2 text-center"><Timer className="h-6 w-6 text-[#C9CED4]" /><p className="text-[13px] text-[#9CA3AF]">No completed runs to profile</p></div>
            ) : (
              <>
                <div style={{ height: 164 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histData} margin={{ top: 8, right: 4, left: 4, bottom: 0 }}>
                      <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#9CA3AF", fontFamily: "var(--font-mono)" }} />
                      <Tooltip cursor={{ fill: "#F3F4F5" }} contentStyle={{ borderRadius: 8, border: "1px solid #E0E3E6", fontSize: 12, fontFamily: "var(--font-mono)" }} />
                      <Bar dataKey="count" radius={[5, 5, 0, 0]} maxBarSize={64}>
                        {histData.map((_, i) => <Cell key={i} fill="#007F4E" fillOpacity={0.45 + (i / histData.length) * 0.55} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex items-center gap-6 border-t border-[#ECEEEF] pt-3">
                  <div><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9CA3AF]">Avg</p><p className="mt-0.5 text-[18px] font-semibold tabular-nums text-[#0B0D0F]">{avgLatency ? fmtDuration(avgLatency) : "—"}</p></div>
                  <div><p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#9CA3AF]">p95</p><p className="mt-0.5 text-[18px] font-semibold tabular-nums text-[#0B0D0F]">{p95Latency ? fmtDuration(p95Latency) : "—"}</p></div>
                </div>
              </>
            )}
          </ChartPanel>

          {/* Spend metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Tokens · 24h" value={loading ? "…" : fmtTokens(tokens24h)} icon={Coins} />
            <Metric label="Cost · 24h" value={loading ? "…" : fmtCost(cost24h)} icon={Coins} />
            <Metric label="Total runs" value={loading ? "…" : (summary?.totalRuns ?? summary?.recentRunsTotal ?? 0).toLocaleString()} icon={Activity} />
            <Metric label="Workflow active" value={loading ? "…" : (workflowUtil == null ? "—" : `${workflowUtil}%`)} icon={GitBranch} />
          </div>

          {/* Resource composition */}
          <div className="rounded-[12px] border border-[#E0E3E6] bg-white p-5">
            <div className="mb-4 flex items-center gap-2"><span className="vb-mono-label">Registry</span><span className="text-[14px] font-bold text-[#0B0D0F]">Platform resources</span></div>
            <div className="space-y-3.5">
              {resources.map((r) => {
                const Icon = r.icon;
                return (
                  <Link key={r.label} href={r.href} className="group block">
                    <div className="mb-1 flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[#374151]"><Icon className="h-3.5 w-3.5" style={{ color: r.color }} />{r.label}</span>
                      <span className="font-mono text-[13px] font-semibold tabular-nums text-[#0B0D0F]">{r.value}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-[#ECEEEF]">
                      <div className="h-full rounded-full transition-all group-hover:opacity-90" style={{ width: `${Math.max(4, (r.value / resMax) * 100)}%`, background: r.color }} />
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right rail */}
        <div className="flex flex-col gap-4">
          {/* AI Architect — the front door */}
          <div className="overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white">
            <div
              className="flex items-center gap-3 border-b border-[#ECEEEF] px-[18px] py-4"
              style={{
                background: "#FAFBFB",
                backgroundImage: "radial-gradient(#D2D6DB 1px, transparent 1px)",
                backgroundSize: "18px 18px",
              }}
            >
              <ArchitectLogo size={34} />
              <div>
                <span className="vb-mono-label">AI Architect</span>
                <p className="text-[13.5px] font-bold leading-tight text-[#0B0D0F]">Describe it. We build it.</p>
              </div>
            </div>
            <div className="p-[18px]">
              <p className="text-[12.5px] leading-[1.6] text-[#6B7280]">
                A plain-English goal becomes agents, tools, connections and a runnable workflow on the canvas — simulation-first.
              </p>
              <Link
                href={"/workflows/new/architect" as Route}
                className="mt-3.5 flex h-9 w-full items-center justify-center gap-2 rounded-[9px] bg-[#007F4E] text-[13px] font-semibold text-white transition-colors hover:bg-[#006B45]"
              >
                <Sparkles className="h-3.5 w-3.5" /> Architect a workflow
              </Link>
            </div>
          </div>

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
