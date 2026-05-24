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

function MetricCard({
  label, value, sub, color, icon: Icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
  icon: React.ElementType;
}) {
  return (
    <div
      className="flex flex-col justify-between rounded-[10px] border border-[#E5E7EB] bg-white px-4 py-3"
      style={{ minHeight: 92 }}
    >
      <div className="flex items-center justify-between">
        <p className="card-label">{label}</p>
        <Icon className="h-3.5 w-3.5" style={{ color: color ?? "#9CA3AF" }} />
      </div>
      <div>
        <p
          className="leading-none tracking-tight"
          style={{ fontSize: 26, fontWeight: 700, color: color ?? "#111827", marginTop: 10 }}
        >
          {value}
        </p>
        {sub && (
          <p className="mt-1" style={{ fontSize: 12, color: "#9CA3AF" }}>
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const dot = STATUS_DOT[run.status] ?? "bg-slate-400";
  return (
    <Link
      href={`/runs/${run.id}` as Route}
      className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-[#F9FAFB]"
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dot)} />
      <span className="flex-1 truncate" style={{ fontSize: 14, fontWeight: 500, color: "#111827" }}>
        {run.workflowName}
      </span>
      <span className="shrink-0 font-mono" style={{ fontSize: 12, color: "#6B7280" }}>
        {fmtDuration(run.durationMs)}
      </span>
      <span className="shrink-0" style={{ fontSize: 12, color: "#9CA3AF" }}>
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
    <div className="p-7 lg:p-8 max-w-[1320px]" style={{ paddingTop: 24 }}>
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">AI agent workflow execution platform</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="mt-1 flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] transition-colors hover:bg-[#F1F3F5] disabled:opacity-40 bg-white"
        >
          <RefreshCw className={cn("h-3.5 w-3.5 text-[#6B7280]", loading && "animate-spin")} />
        </button>
      </div>

      {/* ── Quick actions strip ──────────────────────────────────────────── */}
      <div
        className="flex flex-wrap items-center gap-2 rounded-[10px] border border-[#E5E7EB] bg-white px-4 py-2.5"
        style={{ marginBottom: 16 }}
      >
        <span style={{ fontSize: 13, fontWeight: 550, color: "#374151" }}>Quick actions:</span>
        <Link
          href={"/workflows/new" as Route}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#111827] px-3 text-white transition-colors hover:bg-[#1F2937]"
          style={{ fontSize: 13.5, fontWeight: 650 }}
        >
          <Plus className="h-3.5 w-3.5" />
          New Workflow
        </Link>
        <Link
          href={"/workflows/import" as Route}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 transition-colors hover:bg-[#F1F3F5]"
          style={{ fontSize: 13.5, fontWeight: 550, color: "#374151" }}
        >
          <Upload className="h-3.5 w-3.5" />
          Import
        </Link>
        {(summary?.waitingApprovals ?? 0) > 0 && (
          <Link
            href={"/approvals" as Route}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 text-amber-700 transition-colors hover:bg-amber-100"
            style={{ fontSize: 13.5, fontWeight: 600 }}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            {summary!.waitingApprovals} pending approval{summary!.waitingApprovals !== 1 ? "s" : ""}
          </Link>
        )}
      </div>

      {/* ── Metric cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4" style={{ marginBottom: 18 }}>
        <MetricCard
          label="Active Workflows"
          value={summary?.activeWorkflows ?? "—"}
          sub={`${summary?.totalWorkflows ?? 0} total`}
          color="#2563EB"
          icon={GitBranch}
        />
        <MetricCard
          label="Running Now"
          value={summary?.runningRuns ?? 0}
          color={summary?.runningRuns ? "#059669" : undefined}
          icon={Play}
        />
        <MetricCard
          label="Failed (24h)"
          value={summary?.failedRuns24h ?? 0}
          sub={`${summary?.succeededRuns24h ?? 0} succeeded`}
          color={summary?.failedRuns24h ? "#DC2626" : undefined}
          icon={AlertTriangle}
        />
        <MetricCard
          label="Pending Approvals"
          value={summary?.waitingApprovals ?? 0}
          color={summary?.waitingApprovals ? "#D97706" : undefined}
          icon={ShieldCheck}
        />
      </div>

      {/* ── Content grid ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Recent runs — 2/3 width */}
        <div className="lg:col-span-2 overflow-hidden rounded-[10px] border border-[#E5E7EB] bg-white">
          <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-2.5">
            <h2 style={{ fontSize: 15, fontWeight: 650, color: "#111827" }}>Recent Runs</h2>
            <Link href={"/runs" as Route} style={{ fontSize: 12, color: "#2563EB" }} className="hover:underline">
              View all →
            </Link>
          </div>
          <div className="p-1.5">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <div className="h-2 w-2 rounded-full bg-[#E5E7EB] animate-pulse" />
                  <div className="h-3.5 flex-1 rounded bg-[#E5E7EB] animate-pulse" />
                  <div className="h-3 w-14 rounded bg-[#E5E7EB] animate-pulse" />
                </div>
              ))
            ) : recentRuns.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 text-center" style={{ height: 220 }}>
                <GitBranch className="h-8 w-8" style={{ color: "#D1D5DB" }} />
                <p style={{ fontSize: 15, fontWeight: 650, color: "#374151" }}>No runs yet</p>
                <p style={{ fontSize: 13, color: "#9CA3AF" }}>Trigger your first workflow to see runs here</p>
                <Link
                  href={"/workflows/new" as Route}
                  className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#111827] px-3 text-white hover:bg-[#1F2937]"
                  style={{ fontSize: 13, fontWeight: 600 }}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Create workflow
                </Link>
              </div>
            ) : (
              recentRuns.map((run) => <RunRow key={run.id} run={run} />)
            )}
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-4">
          {/* Token / cost */}
          <div className="rounded-[10px] border border-[#E5E7EB] bg-white px-4 py-3.5">
            <h2 className="mb-3" style={{ fontSize: 15, fontWeight: 650, color: "#111827" }}>
              Usage (24h)
            </h2>
            <div className="space-y-2.5">
              {[
                { label: "Tokens", value: summary != null ? (summary.totalTokens24h ?? 0).toLocaleString() : "—" },
                { label: "Est. cost", value: summary != null ? `$${(summary.totalCost24h ?? 0).toFixed(4)}` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span style={{ fontSize: 13, color: "#6B7280" }}>{label}</span>
                  <span className="font-mono" style={{ fontSize: 14, fontWeight: 600, color: "#111827" }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Worker health */}
          <div className="rounded-[10px] border border-[#E5E7EB] bg-white px-4 py-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <h2 style={{ fontSize: 15, fontWeight: 650, color: "#111827" }}>Workers</h2>
              <Link href={"/workers" as Route} style={{ fontSize: 12, color: "#2563EB" }} className="hover:underline">
                Manage →
              </Link>
            </div>
            <div className="flex items-center gap-2.5">
              <span className={cn("h-2 w-2 rounded-full shrink-0", isConnected ? "bg-emerald-500" : "bg-red-400")} />
              <p style={{ fontSize: 13.5, color: "#374151" }}>
                {isConnected
                  ? `${summary!.connectedWorkers} worker${summary!.connectedWorkers !== 1 ? "s" : ""} connected`
                  : "No workers connected"}
              </p>
            </div>
            {!isConnected && (
              <p className="mt-2" style={{ fontSize: 12, color: "#9CA3AF" }}>
                Start a worker process or see docs in{" "}
                <Link href={"/settings/sdk" as Route} style={{ color: "#2563EB" }} className="hover:underline">
                  Connections
                </Link>.
              </p>
            )}
          </div>

          {/* Explore */}
          <div className="rounded-[10px] border border-[#E5E7EB] bg-white px-4 py-3.5">
            <h2 className="mb-2" style={{ fontSize: 15, fontWeight: 650, color: "#111827" }}>Explore</h2>
            <div className="space-y-0.5">
              {[
                { href: "/agents",    label: "Agent Registry",  icon: Bot },
                { href: "/tools",     label: "Tool Registry",   icon: Wrench },
                { href: "/schedules", label: "Schedules",       icon: Clock },
                { href: "/approvals", label: "Approval Queue",  icon: CheckCircle2 },
                { href: "/workers",   label: "Workers",         icon: Server },
              ].map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href as Route}
                  className="flex items-center gap-2.5 rounded-lg px-2 transition-colors hover:bg-[#F6F7F9]"
                  style={{ height: 36, color: "#374151" }}
                >
                  <Icon className="h-[15px] w-[15px] shrink-0" style={{ color: "#6B7280" }} />
                  <span style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
