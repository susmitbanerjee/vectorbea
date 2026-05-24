"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  GitBranch,
  Play,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Upload,
  Wrench,
} from "lucide-react";

import { getPlatformSummary, getRuns } from "@/lib/repository";
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

const STATUS_DOT: Record<string, string> = {
  succeeded:            "bg-emerald-500",
  failed:               "bg-red-500",
  running:              "bg-blue-500 animate-pulse",
  waiting_for_approval: "bg-amber-500",
  queued:               "bg-[#9CA3AF]",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const ACCENT_HEX: Record<string, string> = {
  blue:   "#2563EB",
  emerald:"#059669",
  red:    "#DC2626",
  amber:  "#D97706",
};

function MetricCard({
  label, value, sub, accent, icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  icon: React.ElementType;
}) {
  const color = accent ? (ACCENT_HEX[accent] ?? accent) : "var(--text-faint)";
  return (
    <div className="flex flex-col justify-between rounded-lg border border-[#E5E7EB] bg-white px-4 py-3.5 shadow-card"
      style={{ minHeight: 88 }}
    >
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
          {label}
        </p>
        <Icon className="h-3.5 w-3.5 text-[#9CA3AF]" />
      </div>
      <p className="text-[24px] font-semibold leading-none tracking-tight" style={{ color }}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[11px] text-[#9CA3AF]">{sub}</p>}
    </div>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const dot = STATUS_DOT[run.status] ?? "bg-slate-400";
  return (
    <Link
      href={`/runs/${run.id}` as Route}
      className="group flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/20"
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
      <span className="flex-1 truncate text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>
        {run.workflowName}
      </span>
      <span className="shrink-0 font-mono text-[11px]" style={{ color: "var(--text-faint)" }}>
        {fmtDuration(run.durationMs)}
      </span>
      <span className="shrink-0 text-[11px]" style={{ color: "var(--text-faint)" }}>
        {timeAgo(run.startedAt)}
      </span>
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
  waitingApprovals: number;
  failedRuns24h: number;
  succeededRuns24h: number;
  totalTokens24h: number;
  totalCost24h: number;
  connectedWorkers: number;
}

export default function OverviewPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [recentRuns, setRecentRuns] = useState<AgentRun[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [s, runsResult] = await Promise.all([
        getPlatformSummary(),
        getRuns({ pageSize: 8 }),
      ]);
      setSummary(s as Summary);
      setRecentRuns(runsResult.items);
    } catch {
      // silently fallback
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const isConnected = (summary?.connectedWorkers ?? 0) > 0;

  return (
    <div className="space-y-6 p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-[650] tracking-tight" style={{ color: "var(--text-primary)" }}>
            Overview
          </h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--text-secondary)" }}>
            AI agent workflow execution platform
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 transition-colors hover:bg-muted disabled:opacity-40"
          style={{ background: "var(--surface-1)" }}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} style={{ color: "var(--text-faint)" }} />
        </button>
      </div>

      {/* CTA strip */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-white px-4 py-3">
        <span className="text-[12px] font-medium text-[#374151]">Quick actions:</span>
        <Link href={"/workflows/new" as Route} className="inline-flex h-7 items-center gap-1.5 rounded bg-[#111827] px-3 text-[12px] font-medium text-white hover:bg-[#1F2937] transition-colors">
          <Plus className="h-3 w-3" />
          New Workflow
        </Link>
        <Link href={"/workflows/import" as Route} className="inline-flex h-7 items-center gap-1.5 rounded border border-border bg-white px-3 text-[12px] font-medium text-[#6B7280] hover:text-foreground hover:bg-[#F1F3F5] transition-colors">
          <Upload className="h-3 w-3" />
          Import Workflow
        </Link>
        {(summary?.waitingApprovals ?? 0) > 0 && (
          <Link href={"/approvals" as Route} className="inline-flex h-7 items-center gap-1.5 rounded border border-amber-200 bg-amber-50 px-3 text-[12px] font-medium text-amber-700 hover:bg-amber-100 transition-colors">
            <ShieldCheck className="h-3 w-3" />
            {summary!.waitingApprovals} pending approval{summary!.waitingApprovals !== 1 ? "s" : ""}
          </Link>
        )}
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Active Workflows"
          value={summary?.activeWorkflows ?? "—"}
          sub={`${summary?.totalWorkflows ?? 0} total`}
          accent="blue"
          icon={GitBranch}
        />
        <MetricCard
          label="Running Now"
          value={summary?.runningRuns ?? 0}
          accent={summary?.runningRuns ? "emerald" : undefined}
          icon={Play}
        />
        <MetricCard
          label="Failed (24h)"
          value={summary?.failedRuns24h ?? 0}
          sub={`${summary?.succeededRuns24h ?? 0} succeeded`}
          accent={summary?.failedRuns24h ? "red" : undefined}
          icon={AlertTriangle}
        />
        <MetricCard
          label="Pending Approvals"
          value={summary?.waitingApprovals ?? 0}
          accent={summary?.waitingApprovals ? "amber" : undefined}
          icon={ShieldCheck}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Recent runs */}
        <div
          className="lg:col-span-2 rounded-lg border border-border bg-white overflow-hidden"
          style={{ background: "var(--surface-1)" }}
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Recent Runs</h2>
            <Link href={"/runs" as Route} className="text-[11px] text-primary hover:underline">View all →</Link>
          </div>
          <div className="divide-y divide-border p-1">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="h-3 w-3 rounded-full bg-muted animate-pulse" />
                  <div className="h-3.5 flex-1 rounded bg-muted animate-pulse" />
                  <div className="h-3 w-16 rounded bg-muted animate-pulse" />
                </div>
              ))
            ) : recentRuns.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <p className="text-[12px]" style={{ color: "var(--text-faint)" }}>No runs yet</p>
                <Link href={"/workflows/new" as Route} className="text-[11px] text-primary hover:underline">Create your first workflow →</Link>
              </div>
            ) : (
              recentRuns.map((run) => <RunRow key={run.id} run={run} />)
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Token / cost */}
          <div
            className="rounded-lg border border-border bg-white px-4 py-4"
          >
            <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
              Usage (24h)
            </h2>
            <div className="space-y-3">
              {[
                { label: "Tokens", value: summary != null ? (summary.totalTokens24h ?? 0).toLocaleString() : "—" },
                { label: "Est. cost", value: summary != null ? `$${(summary.totalCost24h ?? 0).toFixed(4)}` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span className="text-[12px]" style={{ color: "var(--text-faint)" }}>{label}</span>
                  <span className="font-mono text-[13px] font-medium" style={{ color: "var(--text-primary)" }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Worker health */}
          <div
            className="rounded-lg border border-border bg-white px-4 py-4"
          >
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Workers</h2>
              <Link href={"/workers" as Route} className="text-[11px] text-primary hover:underline">Manage →</Link>
            </div>
            <div className="flex items-center gap-2.5">
              <span className={cn("h-2 w-2 rounded-full shrink-0", isConnected ? "bg-emerald-500" : "bg-red-400")} />
              <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                {isConnected
                  ? `${summary!.connectedWorkers} worker${summary!.connectedWorkers !== 1 ? "s" : ""} connected`
                  : "No workers connected"}
              </p>
            </div>
            {!isConnected && (
              <p className="mt-2 text-[11px]" style={{ color: "var(--text-faint)" }}>
                Start a worker process or see docs in{" "}
                <Link href={"/settings/sdk" as Route} className="text-primary hover:underline">Connections</Link>.
              </p>
            )}
          </div>

          {/* Platform quick links */}
          <div
            className="rounded-lg border border-border bg-white px-4 py-4"
          >
            <h2 className="mb-3 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>Explore</h2>
            <div className="space-y-2">
              {[
                { href: "/agents",    label: "Agent Registry",  icon: Bot },
                { href: "/tools",     label: "Tool Registry",   icon: Wrench },
                { href: "/schedules", label: "Schedules",       icon: Clock },
                { href: "/approvals", label: "Approval Queue",  icon: ShieldCheck },
              ].map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href as Route}
                  className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12px] transition-colors hover:bg-muted/30"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--text-faint)" }} />
                  {label}
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
