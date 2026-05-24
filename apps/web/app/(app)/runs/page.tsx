"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  GitBranch,
  Loader2,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AgentRun, PaginatedResult, RunStatus } from "@/types/platform";
import { getRuns } from "@/lib/repository";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDuration(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

function fmtCost(usd: number | null) {
  if (!usd) return "—";
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

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  succeeded:            { dot: "bg-emerald-500",               label: "Succeeded" },
  failed:               { dot: "bg-red-500",                   label: "Failed" },
  running:              { dot: "bg-blue-500 animate-pulse",    label: "Running" },
  waiting_for_approval: { dot: "bg-amber-500",                 label: "Waiting" },
  queued:               { dot: "bg-[#9CA3AF]",                 label: "Queued" },
  cancelled:            { dot: "bg-[#D1D5DB]",                 label: "Cancelled" },
  timed_out:            { dot: "bg-orange-500",                label: "Timed out" },
  paused:               { dot: "bg-amber-400",                 label: "Paused" },
};

function RunStatusCell({ status }: { status: AgentRun["status"] }) {
  const s = STATUS_STYLES[status] ?? { dot: "bg-slate-400", label: status };
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", s.dot)} />
      <span className="text-[12px] text-muted-foreground">{s.label}</span>
    </span>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-7 rounded-full border px-3 text-[11px] font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RunsPage() {
  const [result, setResult] = useState<PaginatedResult<AgentRun> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RunStatus | "">("");

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const data = await getRuns({
        search: search || undefined,
        status: statusFilter || undefined,
        page,
        pageSize: 25,
      });
      setResult(data);
    } catch {
      toast.error("Failed to load runs.");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { void load(1); }, [load]);

  const runs = result?.items ?? [];
  const pagination = result;

  const statusFilters: { label: string; value: RunStatus | "" }[] = [
    { label: "All",      value: "" },
    { label: "Running",  value: "running" },
    { label: "Succeeded",value: "succeeded" },
    { label: "Failed",   value: "failed" },
    { label: "Waiting",  value: "waiting_for_approval" },
    { label: "Queued",   value: "queued" },
  ];

  return (
    <div className="space-y-5 p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[20px] font-[650] tracking-tight">Runs</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pagination ? `${pagination.total} execution${pagination.total !== 1 ? "s" : ""} total` : "All workflow run executions"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={"/workflows/new" as Route}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-sm hover:bg-primary/90 transition-all"
          >
            <Plus className="h-3.5 w-3.5" />
            New Workflow
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by workflow name…"
            className="h-8 pl-8 text-[13px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          {statusFilters.map((f) => (
            <FilterChip
              key={f.value}
              label={f.label}
              active={statusFilter === f.value}
              onClick={() => setStatusFilter(f.value)}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
        </button>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-xl border border-border/60">
        {loading && runs.length === 0 ? (
          <div className="divide-y divide-border/60">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                <div className="ml-auto h-4 w-20 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <AlertTriangle className="h-8 w-8 text-muted-foreground/20" />
            <p className="text-sm font-medium text-muted-foreground">No runs found</p>
            <p className="text-xs text-muted-foreground/60">
              {statusFilter || search ? "Try adjusting your filters." : "Runs will appear here once workflows are triggered."}
            </p>
            {!statusFilter && !search && (
              <Link
                href={"/workflows/new" as Route}
                className="mt-1 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Create workflow
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/20">
                  {["Workflow", "Status", "Trigger", "Mode", "Duration", "Tokens", "Cost", "Started", ""].map((h) => (
                    <th key={h} className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {runs.map((run) => (
                  <tr key={run.id} className="group transition-colors hover:bg-muted/20">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/runs/${run.id}` as Route}
                        className="block text-[13px] font-medium hover:underline"
                      >
                        {run.workflowName}
                      </Link>
                      <p className="font-mono text-[10px] text-muted-foreground/50">{run.id.slice(0, 14)}…</p>
                    </td>
                    <td className="px-4 py-3.5"><RunStatusCell status={run.status} /></td>
                    <td className="px-4 py-3.5 capitalize text-[12px] text-muted-foreground">{run.triggerType}</td>
                    <td className="px-4 py-3.5">
                      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <GitBranch className="h-3 w-3 shrink-0" />
                        {run.creationMode === "native" ? "Native" : run.creationMode}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[12px] text-muted-foreground">{fmtDuration(run.durationMs)}</td>
                    <td className="px-4 py-3.5 font-mono text-[12px] text-muted-foreground">
                      {run.totalTokens ? run.totalTokens.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3.5 font-mono text-[12px] text-muted-foreground">{fmtCost(run.estimatedCostUsd)}</td>
                    <td className="px-4 py-3.5 text-[12px] text-muted-foreground">{timeAgo(run.startedAt)}</td>
                    <td className="px-4 py-3.5">
                      <Link
                        href={`/runs/${run.id}` as Route}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-muted hover:text-foreground"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-[12px] text-muted-foreground">
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={pagination.page <= 1} onClick={() => void load(pagination.page - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background hover:bg-muted disabled:opacity-40 transition-colors">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 text-[11px]">Page {pagination.page} of {pagination.totalPages}</span>
            <button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => void load(pagination.page + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background hover:bg-muted disabled:opacity-40 transition-colors">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
