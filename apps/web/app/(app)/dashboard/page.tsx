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
  Plug,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
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

// ─── Metric card ──────────────────────────────────────────────────────────────

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
      className="flex flex-col justify-between rounded-[10px] bg-white"
      style={{ border: "1px solid #E5E7EB", padding: "14px 16px", minHeight: 92 }}
    >
      <div className="flex items-center justify-between">
        <p className="card-label">{label}</p>
        <Icon className="h-[14px] w-[14px]" style={{ color: color ?? "#9CA3AF" }} />
      </div>
      <div>
        <p style={{
          fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em",
          color: color ?? "#111827", lineHeight: 1, marginTop: 10,
        }}>
          {value}
        </p>
        {sub && <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 4 }}>{sub}</p>}
      </div>
    </div>
  );
}

// ─── Run row ──────────────────────────────────────────────────────────────────

function RunRow({ run }: { run: AgentRun }) {
  const dot = STATUS_DOT[run.status] ?? "bg-slate-400";
  return (
    <Link
      href={`/runs/${run.id}` as Route}
      className="group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-[#FAFAFA]"
      style={{ borderBottom: "1px solid #F1F5F9", minHeight: 48 }}
    >
      <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", dot)} />
      <span className="flex-1 truncate" style={{ fontSize: 14, fontWeight: 500, color: "#111827" }}>
        {run.workflowName}
      </span>
      <span className="shrink-0 font-mono" style={{ fontSize: 12, color: "#6B7280" }}>
        {fmtDuration(run.durationMs)}
      </span>
      <span className="w-16 shrink-0 text-right" style={{ fontSize: 12, color: "#9CA3AF" }}>
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
      className="group flex items-start gap-3 rounded-[8px] bg-white p-3 transition-all hover:border-[#D1D5DB] hover:bg-[#F9FAFB]"
      style={{ border: "1px solid #E5E7EB", minHeight: 74 }}
    >
      <div
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md"
        style={{ background: "#F3F4F6", border: "1px solid #E5E7EB" }}
      >
        <Icon className="h-3.5 w-3.5" style={{ color: color ?? "#374151" }} />
      </div>
      <div className="min-w-0">
        <p style={{ fontSize: 13.5, fontWeight: 650, color: "#111827", lineHeight: "20px" }}>{title}</p>
        <p style={{ fontSize: 12, color: "#6B7280", marginTop: 2, lineHeight: "16px" }}>{description}</p>
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
    } catch { /* silently fallback */ }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  const isConnected = (summary?.connectedWorkers ?? 0) > 0;
  const isEmpty = !loading && (summary?.totalWorkflows ?? 0) === 0 && (summary?.totalAgents ?? 0) === 0;

  return (
    <div className="page-shell">

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4" style={{ marginBottom: 20 }}>
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-subtitle">AI agent workflow execution platform</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-white transition-colors hover:bg-[#F3F4F6] disabled:opacity-40"
          style={{ border: "1px solid #E5E7EB" }}
        >
          <RefreshCw className={cn("h-3.5 w-3.5 text-[#6B7280]", loading && "animate-spin")} />
        </button>
      </div>

      {/* ── Get started / quick action panel ────────────────────────────── */}
      {isEmpty ? (
        <div className="rounded-[10px] bg-white" style={{ border: "1px solid #E5E7EB", padding: "16px", marginBottom: 18 }}>
          <p style={{ fontSize: 13, fontWeight: 650, color: "#111827", marginBottom: 12 }}>
            Get started with Vectorbee
          </p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <GetStartedTile icon={GitBranch}  title="Create workflow" description="Build a native AI workflow" href="/workflows/new" color="#2563EB" />
            <GetStartedTile icon={Plug}       title="Add connection" description="Connect an LLM provider" href="/connections" color="#7C3AED" />
            <GetStartedTile icon={Bot}        title="Register agent" description="Define an agent persona" href="/agents/new" color="#059669" />
            <GetStartedTile icon={Server}     title="Start worker" description="Run a worker process" href="/workers" color="#D97706" />
          </div>
        </div>
      ) : (
        <div
          className="mb-[18px] flex flex-wrap items-center gap-2 rounded-[8px] bg-white px-4"
          style={{ border: "1px solid #E5E7EB", height: 48 }}
        >
          <span style={{ fontSize: 13, fontWeight: 550, color: "#374151" }}>Quick actions</span>
          <span style={{ color: "#D1D5DB", fontSize: 14 }}>·</span>
          <Link
            href={"/workflows/new" as Route}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] bg-[#111827] px-3 text-white transition-colors hover:bg-[#1F2937]"
            style={{ fontSize: 13, fontWeight: 650 }}
          >
            <Plus className="h-3 w-3" />
            New Workflow
          </Link>
          <Link
            href={"/connections" as Route}
            className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-[#E5E7EB] bg-white px-3 text-[#374151] transition-colors hover:bg-[#F3F4F6]"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            <Plug className="h-3 w-3" />
            New Connection
          </Link>
          {(summary?.waitingApprovals ?? 0) > 0 && (
            <Link
              href={"/approvals" as Route}
              className="inline-flex h-[30px] items-center gap-1.5 rounded-[7px] border border-amber-200 bg-amber-50 px-3 text-amber-700 transition-colors hover:bg-amber-100"
              style={{ fontSize: 13, fontWeight: 600 }}
            >
              <ShieldCheck className="h-3 w-3" />
              {summary!.waitingApprovals} approval{summary!.waitingApprovals !== 1 ? "s" : ""}
            </Link>
          )}
        </div>
      )}

      {/* ── Metric cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-[14px] sm:grid-cols-4" style={{ marginBottom: 18 }}>
        <MetricCard label="Active Workflows" value={summary?.activeWorkflows ?? "—"} sub={`${summary?.totalWorkflows ?? 0} total`} color="#2563EB" icon={GitBranch} />
        <MetricCard label="Running Now"       value={summary?.runningRuns ?? 0}      color={summary?.runningRuns ? "#059669" : undefined}  icon={Play} />
        <MetricCard label="Failed (24h)"      value={summary?.failedRuns24h ?? 0}    sub={`${summary?.succeededRuns24h ?? 0} succeeded`} color={summary?.failedRuns24h ? "#DC2626" : undefined} icon={AlertTriangle} />
        <MetricCard label="Pending Approvals" value={summary?.waitingApprovals ?? 0} color={summary?.waitingApprovals ? "#D97706" : undefined} icon={ShieldCheck} />
      </div>

      {/* ── Main content grid ────────────────────────────────────────────── */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 340px" }}>

        {/* Recent runs */}
        <div className="overflow-hidden rounded-[10px] bg-white" style={{ border: "1px solid #E5E7EB" }}>
          <div className="flex items-center justify-between px-4" style={{ height: 44, borderBottom: "1px solid #E5E7EB" }}>
            <span style={{ fontSize: 14, fontWeight: 650, color: "#111827" }}>Recent Runs</span>
            <Link href={"/runs" as Route} style={{ fontSize: 12, color: "#2563EB" }} className="hover:underline">View all →</Link>
          </div>
          {loading ? (
            <div>
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: "1px solid #F1F5F9" }}>
                  <div className="h-2 w-2 rounded-full bg-[#E5E7EB] animate-pulse shrink-0" />
                  <div className="h-3.5 flex-1 rounded-md bg-[#E5E7EB] animate-pulse" />
                  <div className="h-3 w-12 rounded-md bg-[#E5E7EB] animate-pulse" />
                </div>
              ))}
            </div>
          ) : recentRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2.5 text-center" style={{ height: 280 }}>
              <div className="flex h-10 w-10 items-center justify-center rounded-[10px]" style={{ background: "#F9FAFB", border: "1px solid #E5E7EB" }}>
                <GitBranch className="h-5 w-5" style={{ color: "#D1D5DB" }} />
              </div>
              <div>
                <p style={{ fontSize: 15, fontWeight: 650, color: "#374151" }}>No runs yet</p>
                <p style={{ fontSize: 13, color: "#9CA3AF", marginTop: 3 }}>Trigger your first workflow to see runs here</p>
              </div>
              <Link
                href={"/workflows/new" as Route}
                className="mt-1 inline-flex h-[34px] items-center gap-1.5 rounded-[7px] bg-[#111827] px-4 text-white hover:bg-[#1F2937]"
                style={{ fontSize: 13, fontWeight: 650 }}
              >
                <Plus className="h-3.5 w-3.5" />
                Create workflow
              </Link>
            </div>
          ) : (
            <div>{recentRuns.map((run) => <RunRow key={run.id} run={run} />)}</div>
          )}
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-3">

          {/* Usage 24h */}
          <div className="rounded-[10px] bg-white" style={{ border: "1px solid #E5E7EB", padding: "14px 16px" }}>
            <p style={{ fontSize: 14, fontWeight: 650, color: "#111827", marginBottom: 10 }}>Usage (24h)</p>
            <div className="space-y-2">
              {[
                { label: "Tokens",    value: summary != null ? (summary.totalTokens24h ?? 0).toLocaleString() : "—" },
                { label: "Est. cost", value: summary != null ? `$${(summary.totalCost24h ?? 0).toFixed(4)}` : "—" },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between">
                  <span style={{ fontSize: 13, color: "#6B7280" }}>{label}</span>
                  <span className="font-mono" style={{ fontSize: 13.5, fontWeight: 600, color: "#111827" }}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Worker health */}
          <div className="rounded-[10px] bg-white" style={{ border: "1px solid #E5E7EB", padding: "14px 16px" }}>
            <div className="flex items-center justify-between" style={{ marginBottom: 10 }}>
              <p style={{ fontSize: 14, fontWeight: 650, color: "#111827" }}>Workers</p>
              <Link href={"/workers" as Route} style={{ fontSize: 12, color: "#2563EB" }} className="hover:underline">Manage →</Link>
            </div>
            <div className="flex items-center gap-2.5">
              <span className={cn("h-2 w-2 rounded-full shrink-0", isConnected ? "bg-emerald-500" : "bg-red-400")} />
              <span style={{ fontSize: 13.5, color: "#374151" }}>
                {isConnected
                  ? `${summary!.connectedWorkers} worker${summary!.connectedWorkers !== 1 ? "s" : ""} connected`
                  : "No workers connected"}
              </span>
            </div>
            {!isConnected && (
              <p style={{ fontSize: 12, color: "#9CA3AF", marginTop: 8 }}>
                Start a worker or see{" "}
                <Link href={"/settings/sdk" as Route} style={{ color: "#2563EB" }} className="hover:underline">setup docs</Link>.
              </p>
            )}
          </div>

          {/* Explore */}
          <div className="rounded-[10px] bg-white" style={{ border: "1px solid #E5E7EB", padding: "14px 16px" }}>
            <p style={{ fontSize: 14, fontWeight: 650, color: "#111827", marginBottom: 6 }}>Explore</p>
            <div>
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
                  className="flex items-center gap-2.5 rounded-[6px] px-2 transition-colors hover:bg-[#F6F7F9]"
                  style={{ height: 36, color: "#374151" }}
                >
                  <Icon className="h-[14px] w-[14px] shrink-0" style={{ color: "#6B7280" }} />
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
