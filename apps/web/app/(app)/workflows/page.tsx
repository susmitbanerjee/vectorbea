"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  GitBranch,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Upload,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PaginatedResult, Workflow, WorkflowStatus } from "@/types/platform";
import { getWorkflows } from "@/lib/repository";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: WorkflowStatus) {
  const map: Record<WorkflowStatus, { label: string; cls: string }> = {
    active:   { label: "Active",   cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
    paused:   { label: "Paused",   cls: "bg-amber-500/10  text-amber-400  border-amber-500/20" },
    draft:    { label: "Draft",    cls: "bg-slate-500/10  text-slate-400  border-slate-500/20" },
    archived: { label: "Archived", cls: "bg-rose-500/10   text-rose-400   border-rose-500/20" },
  };
  const { label, cls } = map[status] ?? map.draft;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider", cls)}>
      {label}
    </span>
  );
}

function modeBadge(mode: Workflow["creationMode"]) {
  const map: Record<Workflow["creationMode"], { label: string; cls: string }> = {
    native:          { label: "Native",       cls: "bg-sky-500/10 text-sky-400 border-sky-500/20" },
    imported:        { label: "Imported",     cls: "bg-violet-500/10 text-violet-400 border-violet-500/20" },
    instrumented:    { label: "Instrumented", cls: "bg-teal-500/10 text-teal-400 border-teal-500/20" },
    endpoint_only:   { label: "Endpoint",     cls: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
  };
  const { label, cls } = map[mode] ?? map.endpoint_only;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", cls)}>
      {label}
    </span>
  );
}

function runStatusDot(status: Workflow["lastRunStatus"]) {
  if (!status) return <span className="text-[12px] text-muted-foreground/40">—</span>;
  const colors: Record<string, string> = {
    succeeded: "bg-emerald-400",
    failed: "bg-red-400",
    running: "bg-sky-400 animate-pulse",
    waiting_for_approval: "bg-amber-400",
    queued: "bg-slate-400",
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", colors[status] ?? "bg-slate-400")} />
      <span className="text-[12px] capitalize text-muted-foreground">{status.replace(/_/g, " ")}</span>
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

export default function WorkflowsPage() {
  const [result, setResult] = useState<PaginatedResult<Workflow> | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<WorkflowStatus | "">("");

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const data = await getWorkflows({
        search: search || undefined,
        status: statusFilter || undefined,
        page,
        pageSize: 20,
      });
      setResult(data);
    } catch {
      toast.error("Failed to load workflows.");
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter]);

  useEffect(() => { void load(1); }, [load]);

  const workflows = result?.items ?? [];
  const pagination = result;

  const statusFilters: { label: string; value: WorkflowStatus | "" }[] = [
    { label: "All",      value: "" },
    { label: "Active",   value: "active" },
    { label: "Draft",    value: "draft" },
    { label: "Paused",   value: "paused" },
    { label: "Archived", value: "archived" },
  ];

  return (
    <div className="space-y-5 p-6 lg:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">Workflows</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pagination
              ? `${pagination.total} workflow${pagination.total !== 1 ? "s" : ""}`
              : "AI agent execution workflows"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={"/workflows/import" as never}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 text-[13px] font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
          >
            <Upload className="h-3.5 w-3.5" />
            Import
          </Link>
          <Link
            href={"/workflows/new" as never}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
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
            placeholder="Search workflows…"
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
        {loading && workflows.length === 0 ? (
          <div className="divide-y divide-border/60">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                <div className="h-4 w-16 animate-pulse rounded bg-muted ml-auto" />
              </div>
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <EmptyWorkflows hasFilters={!!search || !!statusFilter} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/60 bg-muted/20">
                  {["Workflow", "Mode", "Status", "Trigger", "Agents", "Tools", "Last Run", "Success", ""].map((h) => (
                    <th
                      key={h}
                      className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {workflows.map((wf) => (
                  <tr key={wf.id} className="group transition-colors hover:bg-muted/20">
                    {/* Name */}
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/workflows/${wf.id}` as never}
                        className="block text-[13px] font-medium hover:underline"
                      >
                        {wf.name}
                      </Link>
                      <p className="mt-0.5 max-w-[260px] truncate text-[11px] text-muted-foreground">
                        {wf.description}
                      </p>
                    </td>

                    {/* Mode */}
                    <td className="px-4 py-3.5">{modeBadge(wf.creationMode)}</td>

                    {/* Status */}
                    <td className="px-4 py-3.5">{statusBadge(wf.status)}</td>

                    {/* Trigger */}
                    <td className="px-4 py-3.5">
                      <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground capitalize">
                        {wf.triggerType === "cron" ? (
                          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <Play className="h-3.5 w-3.5 shrink-0" />
                        )}
                        {wf.scheduleConfig?.cronExpression ?? wf.triggerType}
                      </span>
                    </td>

                    {/* Agents */}
                    <td className="px-4 py-3.5">
                      <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                        <Bot className="h-3.5 w-3.5 shrink-0" />
                        {wf.agentIds.length}
                      </span>
                    </td>

                    {/* Tools */}
                    <td className="px-4 py-3.5">
                      <span className="flex items-center gap-1 text-[12px] text-muted-foreground">
                        <Wrench className="h-3.5 w-3.5 shrink-0" />
                        {wf.toolIds.length}
                      </span>
                    </td>

                    {/* Last run */}
                    <td className="px-4 py-3.5">{runStatusDot(wf.lastRunStatus)}</td>

                    {/* Success rate */}
                    <td className="px-4 py-3.5">
                      {wf.totalRuns > 0 ? (
                        <span className={cn("text-[12px] font-mono", wf.successRate >= 0.9 ? "text-emerald-400" : wf.successRate >= 0.7 ? "text-amber-400" : "text-red-400")}>
                          {Math.round(wf.successRate * 100)}%
                        </span>
                      ) : (
                        <span className="text-[12px] text-muted-foreground/40">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link
                          href={`/workflows/${wf.id}/builder` as never}
                          className="flex h-6 items-center gap-1 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          Builder
                        </Link>
                        <Link
                          href={`/workflows/${wf.id}` as never}
                          className="flex h-6 items-center gap-1 rounded px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                        >
                          Detail
                        </Link>
                      </div>
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

function EmptyWorkflows({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border/60 bg-muted/20">
        <GitBranch className="h-5 w-5 text-muted-foreground/40" />
      </div>
      <div>
        <p className="text-sm font-medium text-muted-foreground">
          {hasFilters ? "No workflows match your filters" : "No workflows yet"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          {hasFilters
            ? "Try adjusting your search or filters."
            : "Build a native workflow, import from LangGraph or Temporal, or instrument existing code."}
        </p>
      </div>
      {!hasFilters && (
        <div className="flex items-center gap-2 mt-2">
          <Link
            href={"/workflows/new" as never}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-3.5 w-3.5" />
            Build workflow
          </Link>
          <Link
            href={"/workflows/import" as never}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-3.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            <Upload className="h-3.5 w-3.5" />
            Import workflow
          </Link>
        </div>
      )}
    </div>
  );
}
