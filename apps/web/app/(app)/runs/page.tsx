"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  GitBranch,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/ui/StatusBadge";
import { SearchInput } from "@/components/ui/search-input";
import { RunsHealthBar } from "@/components/runs/RunsHealthBar";
import { cn } from "@/lib/utils";
import type { AgentRun, PaginatedResult, RunStatus } from "@/types/platform";
import { getRuns } from "@/lib/repository";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null) {
  if (!ms) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtCost(usd: number | null) {
  if (usd == null) return null;
  if (usd === 0) return "$0";
  if (usd < 0.001) return `<$0.001`;
  return `$${usd.toFixed(4)}`;
}

function timeAgo(ts: string | null): { rel: string; abs: string } {
  if (!ts) return { rel: "—", abs: "—" };
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const rel =
    diff < 60_000 ? `${Math.floor(diff / 1000)}s ago` :
    diff < 3_600_000 ? `${Math.floor(diff / 60_000)}m ago` :
    diff < 86_400_000 ? `${Math.floor(diff / 3_600_000)}h ago` :
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const abs = d.toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return { rel, abs };
}

// Map platform RunStatus → UI StatusBadge expects uppercase
const STATUS_MAP: Record<string, string> = {
  succeeded:            "SUCCEEDED",
  failed:               "FAILED",
  running:              "RUNNING",
  waiting_for_approval: "WAITING_FOR_APPROVAL",
  queued:               "QUEUED",
  cancelled:            "CANCELLED",
  timed_out:            "TIMEOUT",
  paused:               "RUNNING", // closest visual
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  const short = id.slice(0, 8) + "…";

  async function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await navigator.clipboard.writeText(id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={e => void copy(e)}
      title="Copy run ID"
      className="group/copy inline-flex items-center gap-1 font-mono text-[10px] text-[#9CA3AF] transition-colors hover:text-[#6B7280]"
    >
      <span>{short}</span>
      <span className="opacity-0 transition-opacity group-hover/copy:opacity-100">
        {copied
          ? <Check className="h-2.5 w-2.5 text-emerald-500" />
          : <Copy className="h-2.5 w-2.5" />
        }
      </span>
    </button>
  );
}

function DurationBar({ ms, maxMs }: { ms: number | null; maxMs: number }) {
  const label = fmtDuration(ms);
  if (!ms || maxMs === 0) {
    return <span className="font-mono text-[12px] text-[#9CA3AF]">—</span>;
  }
  const pct = Math.max(4, Math.round((ms / maxMs) * 100));
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 font-mono text-[12px] text-[#374151] tabular-nums">{label}</span>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[#E5E7EB]">
        <div
          className="h-full rounded-full bg-blue-200 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

type SortKey = "started" | "duration" | "cost" | "tokens";
type SortDir = "asc" | "desc";

function SortableHeader({
  label, sortKey, currentKey, dir, onSort,
}: {
  label: string; sortKey: SortKey; currentKey: SortKey; dir: SortDir; onSort: (k: SortKey) => void;
}) {
  const active = currentKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn(
        "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
        active ? "text-[#111827]" : "text-[#9CA3AF] hover:text-[#6B7280]",
      )}
    >
      {label}
      <span className="flex flex-col gap-0">
        <ChevronUp   className={cn("h-2.5 w-2.5 -mb-0.5", active && dir === "asc"  ? "text-[#111827]" : "text-[#D1D5DB]")} />
        <ChevronDown className={cn("h-2.5 w-2.5",           active && dir === "desc" ? "text-[#111827]" : "text-[#D1D5DB]")} />
      </span>
    </button>
  );
}

// Time-range filter
type TimeRange = "1h" | "24h" | "7d" | "30d" | "all";
const TIME_RANGES: { label: string; value: TimeRange }[] = [
  { label: "1h",  value: "1h"  },
  { label: "24h", value: "24h" },
  { label: "7d",  value: "7d"  },
  { label: "30d", value: "30d" },
  { label: "All", value: "all" },
];

function timeRangeMs(range: TimeRange): number | null {
  const map: Record<TimeRange, number | null> = {
    "1h":  3_600_000,
    "24h": 86_400_000,
    "7d":  7 * 86_400_000,
    "30d": 30 * 86_400_000,
    "all": null,
  };
  return map[range];
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RunsPage() {
  const [result, setResult]           = useState<PaginatedResult<AgentRun> | null>(null);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState("");
  const [statusFilter, setStatusFilter] = useState<RunStatus | "">("");
  const [timeRange, setTimeRange]     = useState<TimeRange>("all");
  const [sortKey, setSortKey]         = useState<SortKey>("started");
  const [sortDir, setSortDir]         = useState<SortDir>("desc");
  const [page, setPage]               = useState(1);

  // Debounce search
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const PAGE_SIZE = 15;

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const data = await getRuns({
        search:   search || undefined,
        status:   statusFilter || undefined,
        page:     p,
        pageSize: PAGE_SIZE,
      });
      setResult(data);
    } catch {
      toast.error("Failed to load runs.");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, timeRange]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setPage(1);
      void load(1);
    }, 280);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search, load]);

  useEffect(() => {
    setPage(1);
    void load(1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, timeRange]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  }

  // Client-side time filter + sort
  const displayRuns = useMemo(() => {
    let runs = result?.items ?? [];

    // Time range
    const cutoffMs = timeRangeMs(timeRange);
    if (cutoffMs !== null) {
      const cutoff = Date.now() - cutoffMs;
      runs = runs.filter(r => r.startedAt ? new Date(r.startedAt).getTime() >= cutoff : true);
    }

    // Sort
    return [...runs].sort((a, b) => {
      let delta = 0;
      if (sortKey === "started") {
        delta = new Date(a.startedAt ?? 0).getTime() - new Date(b.startedAt ?? 0).getTime();
      } else if (sortKey === "duration") {
        delta = (a.durationMs ?? 0) - (b.durationMs ?? 0);
      } else if (sortKey === "cost") {
        delta = (a.estimatedCostUsd ?? 0) - (b.estimatedCostUsd ?? 0);
      } else if (sortKey === "tokens") {
        delta = (a.totalTokens ?? 0) - (b.totalTokens ?? 0);
      }
      return sortDir === "asc" ? delta : -delta;
    });
  }, [result, timeRange, sortKey, sortDir]);

  const maxDurationMs = useMemo(
    () => Math.max(0, ...displayRuns.map(r => r.durationMs ?? 0)),
    [displayRuns],
  );

  const pagination = result;
  const statusFilters: { label: string; value: RunStatus | "" }[] = [
    { label: "All",      value: "" },
    { label: "Running",  value: "running" },
    { label: "Succeeded",value: "succeeded" },
    { label: "Failed",   value: "failed" },
    { label: "Waiting",  value: "waiting_for_approval" },
    { label: "Queued",   value: "queued" },
  ];

  const liveCount = displayRuns.filter(r => r.status === "running").length;

  return (
    <div className="page-shell space-y-5">

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            <h1 className="page-title">Runs</h1>
            {liveCount > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#BFDBFE] bg-[#EFF6FF] px-2.5 py-1 text-[11px] font-semibold text-[#1D4ED8]">
                <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
                {liveCount} live
              </span>
            )}
          </div>
          <p className="text-[13px] text-[#6B7280]">
            Workflow execution history · step-level traces · approvals · cost
          </p>
        </div>
        <Link
          href={"/workflows/new" as Route}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-[13.5px] font-semibold text-white shadow-sm transition-all hover:bg-[#1E293B]"
        >
          <Plus className="h-3.5 w-3.5" />
          New Workflow
        </Link>
      </div>

      {/* ── Health bar ──────────────────────────────────────────────────── */}
      <RunsHealthBar />

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">

        {/* Search */}
        <SearchInput
          containerClassName="w-[280px] shrink-0"
          placeholder="Search workflow name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Status — segmented pill group */}
        <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          {statusFilters.map((f) => {
            const active = statusFilter === f.value;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setStatusFilter(f.value)}
                className={cn(
                  "inline-flex h-8 items-center rounded-[9px] px-3.5 text-[13px] font-medium transition-all",
                  active
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-500 hover:text-slate-800",
                )}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Time range — segmented pill group */}
        <div className="flex items-center rounded-xl border border-slate-200 bg-white p-1 shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
          {TIME_RANGES.map((t) => {
            const active = timeRange === t.value;
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTimeRange(t.value)}
                className={cn(
                  "inline-flex h-8 items-center rounded-[9px] px-3.5 text-[13px] font-medium transition-all",
                  active
                    ? "bg-slate-900 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-700",
                )}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Refresh */}
        <button
          type="button"
          onClick={() => void load(page)}
          disabled={loading}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 shadow-[0_1px_3px_rgba(15,23,42,0.06)] transition-colors hover:border-slate-300 hover:text-slate-600 disabled:opacity-50"
        >
          {loading
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <RefreshCw className="h-4 w-4" />
          }
        </button>
      </div>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        {loading && displayRuns.length === 0 ? (
          // Skeleton
          <div className="divide-y divide-[#F3F4F6]">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-3.5 w-44 animate-pulse rounded bg-[#F3F4F6]" />
                <div className="h-5 w-20 animate-pulse rounded-md bg-[#F3F4F6]" />
                <div className="ml-auto h-3.5 w-16 animate-pulse rounded bg-[#F3F4F6]" />
                <div className="h-3.5 w-14 animate-pulse rounded bg-[#F3F4F6]" />
              </div>
            ))}
          </div>
        ) : displayRuns.length === 0 ? (
          // Empty state
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-[#E5E7EB] bg-[#F9FAFB]">
              <Play className="h-5 w-5 text-[#9CA3AF]" />
            </div>
            <div className="space-y-1">
              <p className="text-[14px] font-semibold text-[#111827]">No runs found</p>
              <p className="text-[12px] text-[#6B7280]">
                {statusFilter || search || timeRange !== "all"
                  ? "Try adjusting your filters or time range."
                  : "Runs will appear here once a workflow is triggered."}
              </p>
            </div>
            {!statusFilter && !search && timeRange === "all" && (
              <Link
                href={"/workflows/new" as Route}
                className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#111827] px-4 text-[12px] font-medium text-white hover:bg-[#1f2937] transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Create your first workflow
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {/* table-fixed + explicit col widths keeps every column predictable */}
            <table className="w-full table-fixed min-w-[800px]">
              <colgroup>
                <col className="w-[28%]" />   {/* Workflow */}
                <col className="w-[13%]" />   {/* Status   */}
                <col className="w-[11%]" />   {/* Trigger  */}
                <col className="w-[14%]" />   {/* Duration */}
                <col className="w-[10%]" />   {/* Tokens   */}
                <col className="w-[9%]"  />   {/* Cost     */}
                <col className="w-[11%]" />   {/* Started  */}
                <col className="w-[4%]"  />   {/* Arrow    */}
              </colgroup>

              {/* Column headers */}
              <thead>
                <tr className="border-b border-[#F3F4F6] bg-[#FAFAFA]">
                  <th className="px-6 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                    Workflow
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                    Status
                  </th>
                  <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
                    Trigger
                  </th>
                  <th className="px-4 py-3.5 text-left">
                    <SortableHeader label="Duration" sortKey="duration" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3.5 text-left">
                    <SortableHeader label="Tokens" sortKey="tokens" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3.5 text-left">
                    <SortableHeader label="Cost" sortKey="cost" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3.5 text-left">
                    <SortableHeader label="Started" sortKey="started" currentKey={sortKey} dir={sortDir} onSort={handleSort} />
                  </th>
                  <th className="px-4 py-3.5" />
                </tr>
              </thead>

              {/* Rows */}
              <tbody className="divide-y divide-[#F3F4F6]">
                {displayRuns.map((run) => {
                  const { rel, abs } = timeAgo(run.startedAt);
                  const uiStatus = STATUS_MAP[run.status] as Parameters<typeof StatusBadge>[0]["status"] | undefined;
                  const cost = fmtCost(run.estimatedCostUsd);
                  const isRunning = run.status === "running";
                  const isFailed  = run.status === "failed";

                  return (
                    <tr
                      key={run.id}
                      className={cn(
                        "group relative transition-colors hover:bg-[#FAFAFA]",
                        isFailed && "bg-red-50/40 hover:bg-red-50/60",
                      )}
                    >
                      {/* Workflow name + copy-ID */}
                      <td className="px-6 py-4">
                        <Link
                          href={`/runs/${run.id}` as Route}
                          className="block truncate text-[13.5px] font-semibold text-[#111827] hover:underline"
                        >
                          {run.workflowName?.trim() || `Run ${run.id.slice(0, 8)}`}
                        </Link>
                        <CopyId id={run.id} />
                      </td>

                      {/* Status */}
                      <td className="px-4 py-4">
                        {uiStatus ? (
                          <StatusBadge status={uiStatus} dot />
                        ) : (
                          <span className="text-[12px] text-[#9CA3AF]">{run.status}</span>
                        )}
                      </td>

                      {/* Trigger + Mode */}
                      <td className="px-4 py-4">
                        <div className="space-y-0.5">
                          <span className="block text-[13px] capitalize text-[#374151]">
                            {run.triggerType === "manual" ? "Manual" : run.triggerType}
                          </span>
                          <span className="flex items-center gap-1 text-[11px] text-[#9CA3AF]">
                            <GitBranch className="h-2.5 w-2.5 shrink-0" />
                            {run.creationMode === "native" ? "Native" : run.creationMode}
                          </span>
                        </div>
                      </td>

                      {/* Duration + mini bar */}
                      <td className="px-4 py-4">
                        {isRunning ? (
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[#1D4ED8]">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            In progress
                          </span>
                        ) : (
                          <DurationBar ms={run.durationMs} maxMs={maxDurationMs} />
                        )}
                      </td>

                      {/* Tokens */}
                      <td className="px-4 py-4">
                        {run.totalTokens ? (
                          <span className="flex items-center gap-1 font-mono text-[12px] text-[#374151]">
                            <Zap className="h-2.5 w-2.5 text-[#9CA3AF]" />
                            {run.totalTokens.toLocaleString()}
                          </span>
                        ) : (
                          <span className="text-[12px] text-[#9CA3AF]">—</span>
                        )}
                      </td>

                      {/* Cost */}
                      <td className="px-4 py-4 font-mono text-[12px] text-[#374151]">
                        {cost ?? <span className="text-[#9CA3AF]">—</span>}
                      </td>

                      {/* Started */}
                      <td className="px-4 py-4">
                        <span
                          title={abs}
                          className="flex items-center gap-1.5 text-[12px] text-[#6B7280] cursor-default"
                        >
                          <Clock className="h-3 w-3 shrink-0 text-[#D1D5DB]" />
                          {rel}
                        </span>
                      </td>

                      {/* Chevron */}
                      <td className="px-4 py-4">
                        <Link
                          href={`/runs/${run.id}` as Route}
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-[#9CA3AF] opacity-0 transition-all group-hover:opacity-100 hover:bg-[#F3F4F6] hover:text-[#374151]"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Pagination — always shown when there are multiple pages ────── */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-[#6B7280]">
            Showing {(pagination.page - 1) * PAGE_SIZE + 1}–
            {Math.min(pagination.page * PAGE_SIZE, pagination.total)} of{" "}
            {pagination.total.toLocaleString()} runs
            {timeRange !== "all" && (
              <span className="ml-1 text-[#9CA3AF]">· filtered by time range</span>
            )}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => { const p = pagination.page - 1; setPage(p); void load(p); }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-3 text-[12px] text-[#374151] font-medium">
              Page {pagination.page} of {pagination.totalPages}
            </span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => { const p = pagination.page + 1; setPage(p); void load(p); }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white text-[#374151] hover:bg-[#F9FAFB] disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
