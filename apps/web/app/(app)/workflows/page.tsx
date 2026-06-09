"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bot,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Wrench,
  PenLine,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { IconBadge, WorkflowIcon } from "@/components/icons/vectorbea-icons";
import type { PaginatedResult, Workflow, WorkflowStatus } from "@/types/platform";
import { getWorkflows, deleteWorkflow } from "@/lib/repository";
import { Chip, FilterTabs, EmptyHint } from "@/components/ui/page-kit";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusChip(status: WorkflowStatus) {
  const map: Record<WorkflowStatus, "green" | "amber" | "gray" | "red"> = {
    active: "green", paused: "amber", draft: "gray", archived: "red",
  };
  const label = status.charAt(0).toUpperCase() + status.slice(1);
  return <Chip tone={map[status] ?? "gray"} dot={status !== "draft"}>{label}</Chip>;
}

function modeBadge(mode: Workflow["creationMode"]) {
  const map: Record<Workflow["creationMode"], { label: string; cls: string }> = {
    native:        { label: "Native",       cls: "bg-teal-50 text-teal-700 border-teal-200" },
    imported:      { label: "Imported",     cls: "bg-violet-50 text-violet-700 border-violet-200" },
    instrumented:  { label: "Instrumented", cls: "bg-cyan-50 text-cyan-700 border-cyan-200" },
    endpoint_only: { label: "Endpoint",     cls: "bg-[#F3F4F5] text-[#6B7280] border-[#E0E3E6]" },
  };
  const { label, cls } = map[mode] ?? map.endpoint_only;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10.5px] font-medium", cls)}>
      {label}
    </span>
  );
}

const RUN_DOT: Record<string, string> = {
  succeeded: "bg-emerald-500",
  failed: "bg-red-500",
  running: "bg-teal-500 animate-pulse",
  waiting_for_approval: "bg-amber-500",
  queued: "bg-[#9CA3AF]",
};
function runStatus(status: Workflow["lastRunStatus"]) {
  if (!status) return <span className="font-mono text-[11.5px] text-[#9CA3AF]">never run</span>;
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", RUN_DOT[status] ?? "bg-slate-400")} />
      <span className="font-mono text-[11.5px] capitalize text-[#6B7280]">{status.replace(/_/g, " ")}</span>
    </span>
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

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId]   = useState<string | null>(null);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      await deleteWorkflow(id);
      toast.success("Workflow deleted");
      setResult(prev => prev ? { ...prev, items: prev.items.filter(w => w.id !== id) } : prev);
    } catch {
      toast.error("Failed to delete workflow");
    } finally {
      setDeletingId(null);
      setConfirmId(null);
    }
  }

  const workflows = result?.items ?? [];
  const pagination = result;

  return (
    <div className="page-shell space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="vb-mono-label">Build</span>
          <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.025em] text-[#0B0D0F]">Workflows</h1>
          <p className="mt-1 text-[13.5px] text-[#6B7280]">
            {pagination ? `${pagination.total} durable workflow${pagination.total !== 1 ? "s" : ""}` : "Durable AI agent workflows"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={"/workflows/import" as never} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-4 text-[13px] font-semibold text-[#4B5563] transition-colors hover:bg-[#F3F4F5]">
            <Upload className="h-3.5 w-3.5" /> Import
          </Link>
          <Link href={"/workflows/new" as never} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1c1f22]">
            <Plus className="h-3.5 w-3.5" /> New workflow
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-[300px] max-w-full">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" />
          <input
            placeholder="Search workflows…"
            className="h-9 w-full rounded-[8px] border border-[#E0E3E6] bg-white pl-9 pr-3 text-[13.5px] text-[#0B0D0F] placeholder:text-[#9CA3AF] outline-none transition-all hover:border-[#C9CED4] focus:border-[#9CCFBB] focus:ring-2 focus:ring-[#E6F4EF]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <FilterTabs
          options={[
            { value: "", label: "All" },
            { value: "active", label: "Active" },
            { value: "draft", label: "Draft" },
            { value: "paused", label: "Paused" },
            { value: "archived", label: "Archived" },
          ]}
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as WorkflowStatus | "")}
        />
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#E0E3E6] bg-white text-[#6B7280] transition-colors hover:bg-[#F3F4F5] disabled:opacity-40"
          title="Refresh"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Grid */}
      {loading && workflows.length === 0 ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[168px] animate-pulse rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB]" />
          ))}
        </div>
      ) : workflows.length === 0 ? (
        <EmptyHint
          icon={GitBranch}
          title={(search || statusFilter) ? "No workflows match your filters" : "No workflows yet"}
          desc={(search || statusFilter)
            ? "Try adjusting your search or filters."
            : "Build a native workflow, import from LangGraph or Temporal, or instrument existing code."}
          action={!(search || statusFilter) ? (
            <div className="flex items-center gap-2">
              <Link href={"/workflows/new" as never} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white hover:bg-[#1c1f22]">
                <Plus className="h-3.5 w-3.5" /> Build workflow
              </Link>
              <Link href={"/workflows/import" as never} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[#E0E3E6] bg-white px-4 text-[13px] font-semibold text-[#4B5563] hover:bg-[#F3F4F5]">
                <Upload className="h-3.5 w-3.5" /> Import
              </Link>
            </div>
          ) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workflows.map((wf) => (
            <div key={wf.id} className="group flex flex-col rounded-[12px] border border-[#E0E3E6] bg-white transition-colors hover:border-[#C9CED4]">
              {/* Header */}
              <div className="flex items-start gap-2.5 p-4">
                <IconBadge
                  icon={WorkflowIcon}
                  tone={wf.status === "active" ? "workflow" : wf.status === "paused" ? "warning" : "muted"}
                  size="sm"
                  className="shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <Link href={`/workflows/${wf.id}` as never} className="block truncate text-[14px] font-semibold text-[#0B0D0F] hover:text-[#007F4E]">
                    {wf.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-[#6B7280]">
                    {(wf.stepCount ?? 0) > 0 && <span>{wf.stepCount} step{wf.stepCount !== 1 ? "s" : ""}</span>}
                    {(wf.agentCount ?? 0) > 0 && <span className="inline-flex items-center gap-1 text-[#6D28D9]"><Bot className="h-3 w-3" />{wf.agentCount}</span>}
                    {(wf.toolCount ?? 0) > 0 && <span className="inline-flex items-center gap-1 text-[#0F766E]"><Wrench className="h-3 w-3" />{wf.toolCount}</span>}
                    {!(wf.stepCount ?? 0) && !(wf.agentCount ?? 0) && !(wf.toolCount ?? 0) && (
                      <span className="truncate text-[#9CA3AF]">{wf.description || "empty workflow"}</span>
                    )}
                  </div>
                </div>
                {statusChip(wf.status)}
              </div>

              {/* Meta */}
              <div className="flex items-center gap-2 border-t border-[#ECEEEF] px-4 py-2.5">
                {modeBadge(wf.creationMode)}
                <span className="inline-flex items-center gap-1.5 font-mono text-[11.5px] capitalize text-[#6B7280]">
                  {wf.triggerType === "cron" ? <CalendarClock className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {wf.scheduleConfig?.cronExpression ?? wf.triggerType}
                </span>
                {(wf.totalRuns ?? 0) > 0 && (
                  <span className={cn("ml-auto font-mono text-[12px] font-semibold",
                    (wf.successRate ?? 0) >= 0.9 ? "text-[#007F4E]" : (wf.successRate ?? 0) >= 0.7 ? "text-[#CA8A04]" : "text-[#DC2626]")}>
                    {Math.round((wf.successRate ?? 0) * 100)}%
                  </span>
                )}
              </div>

              {/* Footer */}
              <div className="mt-auto flex items-center justify-between border-t border-[#ECEEEF] bg-[#FAFBFB] px-4 py-2.5">
                {runStatus(wf.lastRunStatus)}
                <div className="flex items-center gap-1">
                  {confirmId === wf.id ? (
                    <>
                      <button type="button" onClick={() => handleDelete(wf.id)} disabled={deletingId === wf.id}
                        className="flex h-7 items-center gap-1 rounded-[6px] bg-[#FEF2F2] px-2 text-[11px] font-semibold text-[#DC2626] hover:bg-[#FEE2E2] disabled:opacity-50">
                        {deletingId === wf.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                      </button>
                      <button type="button" onClick={() => setConfirmId(null)} className="flex h-7 items-center rounded-[6px] px-2 text-[11px] text-[#6B7280] hover:bg-[#F3F4F5]">Cancel</button>
                    </>
                  ) : (
                    <>
                      <Link href={`/workflows/${wf.id}/builder` as never}
                        className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F5] hover:text-[#0B0D0F]">
                        <PenLine className="h-3 w-3" /> Builder
                      </Link>
                      <Link href={`/workflows/${wf.id}` as never}
                        className="inline-flex h-7 items-center gap-1 rounded-[6px] px-2 text-[12px] font-medium text-[#4B5563] opacity-0 transition-opacity hover:bg-[#F3F4F5] hover:text-[#0B0D0F] group-hover:opacity-100">
                        Detail <ArrowRight className="h-3 w-3" />
                      </Link>
                      <button type="button" onClick={() => setConfirmId(wf.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#9CA3AF] opacity-0 transition-all hover:bg-[#FEF2F2] hover:text-[#DC2626] group-hover:opacity-100" title="Delete workflow">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between font-mono text-[12px] text-[#6B7280]">
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <button type="button" disabled={pagination.page <= 1} onClick={() => void load(pagination.page - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[#E0E3E6] bg-white transition-colors hover:bg-[#F3F4F5] disabled:opacity-40">
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-2">Page {pagination.page} / {pagination.totalPages}</span>
            <button type="button" disabled={pagination.page >= pagination.totalPages} onClick={() => void load(pagination.page + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-[7px] border border-[#E0E3E6] bg-white transition-colors hover:bg-[#F3F4F5] disabled:opacity-40">
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
