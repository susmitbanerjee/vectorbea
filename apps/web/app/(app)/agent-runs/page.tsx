"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { RunStatusBadge, TriggerBadge } from "@/components/scheduler/status-badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentRun {
  id: string;
  status: string;
  triggerSource: string;
  attemptNumber: number;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  estimatedCostUsd: number | null;
  totalTokens: number | null;
  createdAt: string;
  agentJob: { id: string; name: string };
}

interface Pagination {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function formatCost(usd: number | null) {
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

// ─── Filter chip ─────────────────────────────────────────────────────────────

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

// ─── Page ────────────────────────────────────────────────────────────────────

export default function AgentRunsPage() {
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: "25" });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    try {
      const res = await fetch(`/api/agent-runs?${params}`);
      if (!res.ok) throw new Error("Failed");
      const data = (await res.json()) as { runs: AgentRun[]; pagination: Pagination };
      setRuns(data.runs);
      setPagination(data.pagination);
    } catch {
      toast.error("Failed to load runs.");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { void load(1); }, [load]);

  const statusFilters = [
    { label: "All", value: "" },
    { label: "Running", value: "RUNNING" },
    { label: "Succeeded", value: "SUCCEEDED" },
    { label: "Failed", value: "FAILED" },
    { label: "Waiting", value: "WAITING_FOR_APPROVAL" },
    { label: "Queued", value: "QUEUED" },
  ];

  return (
    <div className="space-y-5 p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">Runs</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pagination
              ? `${pagination.total} execution${pagination.total !== 1 ? "s" : ""} total`
              : "All agent run executions"}
          </p>
        </div>
        <Link
          href="/agent-runs/mock"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Zap className="h-3 w-3" />
          View demo run
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by job name…"
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
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading && runs.length === 0 ? (
            <div className="divide-y divide-border">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-4 w-40 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                  <div className="ml-auto h-4 w-20 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <AlertTriangle className="h-8 w-8 text-muted-foreground/20" />
              <p className="text-sm font-medium text-muted-foreground">No runs found</p>
              <p className="text-xs text-muted-foreground/60">
                {statusFilter || search ? "Try adjusting your filters." : "Runs will appear here once jobs are triggered."}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Job", "Status", "Trigger", "Attempt", "Duration", "Tokens", "Cost", "When", ""].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 first:px-5"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {runs.map((run) => (
                    <tr key={run.id} className="group transition-colors hover:bg-muted/20">
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/agent-jobs/${run.agentJob.id}` as Route}
                          className="block text-[13px] font-medium hover:underline"
                        >
                          {run.agentJob.name}
                        </Link>
                        <p className="font-mono text-[10px] text-muted-foreground/60">
                          {run.id.slice(0, 12)}…
                        </p>
                      </td>
                      <td className="px-4 py-3.5">
                        <RunStatusBadge status={run.status as never} />
                      </td>
                      <td className="px-4 py-3.5">
                        <TriggerBadge source={run.triggerSource as never} />
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[12px] text-muted-foreground">
                        #{run.attemptNumber}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[12px] text-muted-foreground">
                        {formatDuration(run.durationMs)}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[12px] text-muted-foreground">
                        {run.totalTokens ? run.totalTokens.toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3.5 font-mono text-[12px] text-muted-foreground">
                        {formatCost(run.estimatedCostUsd)}
                      </td>
                      <td className="px-4 py-3.5 text-[12px] text-muted-foreground">
                        {timeAgo(run.startedAt ?? run.createdAt)}
                      </td>
                      <td className="px-4 py-3.5">
                        <Link
                          href={`/agent-runs/${run.id}` as Route}
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
        </CardContent>
      </Card>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between text-[12px] text-muted-foreground">
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => void load(pagination.page - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background transition-colors hover:bg-muted disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-2 text-[11px]">Page {pagination.page} of {pagination.totalPages}</span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => void load(pagination.page + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background transition-colors hover:bg-muted disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
