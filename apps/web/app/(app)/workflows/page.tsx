"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
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
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { IconBadge, WorkflowIcon } from "@/components/icons/vectorbea-icons";
import type { PaginatedResult, Workflow, WorkflowStatus } from "@/types/platform";
import { getWorkflows, deleteWorkflow } from "@/lib/repository";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: WorkflowStatus) {
  const map: Record<WorkflowStatus, { label: string; cls: string }> = {
    active:   { label: "Active",   cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
    paused:   { label: "Paused",   cls: "bg-amber-50   text-amber-700   border-amber-200" },
    draft:    { label: "Draft",    cls: "bg-[#F9FAFB]  text-[#6B7280]   border-[#E5E7EB]" },
    archived: { label: "Archived", cls: "bg-rose-50    text-rose-700    border-rose-200" },
  };
  const { label, cls } = map[status] ?? map.draft;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 uppercase tracking-wider", cls)}
      style={{ fontSize: 11, fontWeight: 650 }}>
      {label}
    </span>
  );
}

function modeBadge(mode: Workflow["creationMode"]) {
  const map: Record<Workflow["creationMode"], { label: string; cls: string }> = {
    native:          { label: "Native",       cls: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]" },
    imported:        { label: "Imported",     cls: "bg-violet-50 text-violet-700 border-violet-200" },
    instrumented:    { label: "Instrumented", cls: "bg-teal-50 text-teal-700 border-teal-200" },
    endpoint_only:   { label: "Endpoint",     cls: "bg-[#F9FAFB] text-[#6B7280] border-[#E5E7EB]" },
  };
  const { label, cls } = map[mode] ?? map.endpoint_only;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5", cls)}
      style={{ fontSize: 11, fontWeight: 600 }}>
      {label}
    </span>
  );
}

function runStatusDot(status: Workflow["lastRunStatus"]) {
  if (!status) return <span style={{ fontSize: 13, color: "#9CA3AF" }}>—</span>;
  const colors: Record<string, string> = {
    succeeded: "bg-emerald-500",
    failed: "bg-red-500",
    running: "bg-blue-500 animate-pulse",
    waiting_for_approval: "bg-amber-500",
    queued: "bg-[#9CA3AF]",
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", colors[status] ?? "bg-slate-400")} />
      <span style={{ fontSize: 13, color: "#6B7280" }} className="capitalize">{status.replace(/_/g, " ")}</span>
    </span>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center rounded-xl border px-3 text-[12.5px] font-medium transition-colors",
        active
          ? "border-blue-200 bg-blue-50 text-blue-700 font-semibold"
          : "border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700",
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

  const statusFilters: { label: string; value: WorkflowStatus | "" }[] = [
    { label: "All",      value: "" },
    { label: "Active",   value: "active" },
    { label: "Draft",    value: "draft" },
    { label: "Paused",   value: "paused" },
    { label: "Archived", value: "archived" },
  ];

  return (
    <div className="page-shell">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4" style={{ marginBottom: 18 }}>
        <div>
          <h1 className="page-title">Workflows</h1>
          <p className="page-subtitle">
            {pagination
              ? `${pagination.total} workflow${pagination.total !== 1 ? "s" : ""}`
              : "AI agent execution workflows"}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <Link
            href={"/workflows/import" as never}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-[13.5px] font-semibold text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-slate-50 hover:border-slate-300"
          >
            <Upload className="h-3.5 w-3.5" />
            Import
          </Link>
          <Link
            href={"/workflows/new" as never}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-[13.5px] font-semibold text-white shadow-sm transition-all hover:bg-[#1E293B]"
          >
            <Plus className="h-3.5 w-3.5" />
            New Workflow
          </Link>
        </div>
      </div>

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative" style={{ width: 340 }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            placeholder="Search workflows…"
            className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-[13.5px] text-slate-800 shadow-[0_1px_2px_rgba(15,23,42,0.04)] placeholder:text-slate-400 outline-none transition-all hover:border-slate-300 focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
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
          className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-400 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-slate-300 hover:text-slate-600 disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-[10px] border border-[#E5E7EB] bg-white">
        {loading && workflows.length === 0 ? (
          <div className="divide-y divide-[#F3F4F6]">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-5 py-4">
                <div className="h-4 w-48 animate-pulse rounded bg-[#F3F4F6]" />
                <div className="h-4 w-16 animate-pulse rounded bg-[#F3F4F6] ml-auto" />
              </div>
            ))}
          </div>
        ) : workflows.length === 0 ? (
          <EmptyWorkflows hasFilters={!!search || !!statusFilter} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#F3F4F6] bg-[#FAFAFA]">
                  {["Workflow", "Mode", "Status", "Trigger", "Agents", "Tools", "Last Run", "Success", ""].map((h) => (
                    <th
                      key={h}
                      className="table-header-cell px-5 py-3 text-left"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {workflows.map((wf) => (
                  <tr key={wf.id} className="group transition-colors hover:bg-[#F9FAFB]">
                    {/* Name */}
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <IconBadge
                          icon={WorkflowIcon}
                          tone={wf.status === "active" ? "workflow" : wf.status === "paused" ? "warning" : "muted"}
                          size="sm"
                          className="shrink-0"
                        />
                        <div className="min-w-0">
                          <Link
                            href={`/workflows/${wf.id}` as never}
                            className="block font-medium hover:underline"
                            style={{ fontSize: 14, color: "#111827" }}
                          >
                            {wf.name}
                          </Link>
                          {/* Step / agent / tool counts from graph */}
                          <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                            {(wf.stepCount ?? 0) > 0 && (
                              <span style={{ fontSize: 11, color: "#6B7280" }}>
                                {wf.stepCount} step{wf.stepCount !== 1 ? "s" : ""}
                              </span>
                            )}
                            {(wf.agentCount ?? 0) > 0 && (
                              <>
                                <span style={{ fontSize: 11, color: "#D1D5DB" }}>·</span>
                                <span style={{ fontSize: 11, color: "#7C3AED", fontWeight: 600 }}>
                                  {wf.agentCount} agent{wf.agentCount !== 1 ? "s" : ""}
                                </span>
                              </>
                            )}
                            {(wf.toolCount ?? 0) > 0 && (
                              <>
                                <span style={{ fontSize: 11, color: "#D1D5DB" }}>·</span>
                                <span style={{ fontSize: 11, color: "#0891B2", fontWeight: 600 }}>
                                  {wf.toolCount} tool{wf.toolCount !== 1 ? "s" : ""}
                                </span>
                              </>
                            )}
                            {!(wf.stepCount ?? 0) && !(wf.agentCount ?? 0) && !(wf.toolCount ?? 0) && wf.description && (
                              <span className="truncate max-w-[240px]" style={{ fontSize: 11, color: "#9CA3AF" }}>
                                {wf.description}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Mode */}
                    <td className="px-4 py-3">{modeBadge(wf.creationMode)}</td>

                    {/* Status */}
                    <td className="px-4 py-3">{statusBadge(wf.status)}</td>

                    {/* Trigger */}
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-1.5 capitalize" style={{ fontSize: 13, color: "#6B7280" }}>
                        {wf.triggerType === "cron" ? (
                          <CalendarClock className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                          <Play className="h-3.5 w-3.5 shrink-0" />
                        )}
                        {wf.scheduleConfig?.cronExpression ?? wf.triggerType}
                      </span>
                    </td>

                    {/* Agents */}
                    <td className="px-4 py-3">
                      <span
                        className="flex items-center gap-1 font-semibold"
                        style={{ fontSize: 13, color: (wf.agentCount ?? 0) > 0 ? "#7C3AED" : "#9CA3AF" }}
                      >
                        <Bot className="h-3.5 w-3.5 shrink-0" />
                        {wf.agentCount ?? 0}
                      </span>
                    </td>

                    {/* Tools */}
                    <td className="px-4 py-3">
                      <span
                        className="flex items-center gap-1 font-semibold"
                        style={{ fontSize: 13, color: (wf.toolCount ?? 0) > 0 ? "#0891B2" : "#9CA3AF" }}
                      >
                        <Wrench className="h-3.5 w-3.5 shrink-0" />
                        {wf.toolCount ?? 0}
                      </span>
                    </td>

                    {/* Last run */}
                    <td className="px-4 py-3">{runStatusDot(wf.lastRunStatus)}</td>

                    {/* Success rate */}
                    <td className="px-4 py-3">
                      {(wf.totalRuns ?? 0) > 0 ? (
                        <span className={cn("font-mono", (wf.successRate ?? 0) >= 0.9 ? "text-emerald-700" : (wf.successRate ?? 0) >= 0.7 ? "text-amber-700" : "text-red-700")}
                          style={{ fontSize: 13 }}>
                          {Math.round((wf.successRate ?? 0) * 100)}%
                        </span>
                      ) : (
                        <span style={{ fontSize: 13, color: "#9CA3AF" }}>—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Link
                          href={`/workflows/${wf.id}/builder` as never}
                          className="flex h-[26px] items-center gap-1 rounded px-2 text-[#6B7280] hover:bg-[#F1F3F5] hover:text-[#111827] transition-colors"
                          style={{ fontSize: 12 }}
                        >
                          Builder
                        </Link>
                        <Link
                          href={`/workflows/${wf.id}` as never}
                          className="flex h-[26px] items-center gap-1 rounded px-2 text-[#6B7280] hover:bg-[#F1F3F5] hover:text-[#111827] transition-colors"
                          style={{ fontSize: 12 }}
                        >
                          Detail
                        </Link>
                        {confirmId === wf.id ? (
                          <div className="flex items-center gap-1">
                            <button type="button" onClick={() => handleDelete(wf.id)} disabled={deletingId === wf.id}
                              className="flex h-[26px] items-center gap-1 rounded px-2 text-[11px] font-semibold text-red-600 bg-red-50 hover:bg-red-100 transition-colors disabled:opacity-50">
                              {deletingId === wf.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Confirm"}
                            </button>
                            <button type="button" onClick={() => setConfirmId(null)}
                              className="flex h-[26px] items-center rounded px-2 text-[11px] text-slate-500 hover:bg-slate-100 transition-colors">
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button type="button" onClick={() => setConfirmId(wf.id)}
                            className="flex h-[26px] w-[26px] items-center justify-center rounded text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
                            title="Delete workflow">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {pagination && pagination.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between" style={{ fontSize: 13, color: "#6B7280" }}>
          <span>
            {(pagination.page - 1) * pagination.pageSize + 1}–
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => void load(pagination.page - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white transition-colors hover:bg-[#F1F3F5] disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-2" style={{ fontSize: 12 }}>Page {pagination.page} of {pagination.totalPages}</span>
            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => void load(pagination.page + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-[#E5E7EB] bg-white transition-colors hover:bg-[#F1F3F5] disabled:opacity-40"
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
    <div className="flex flex-col items-center justify-center gap-3 text-center" style={{ height: 280 }}>
      <IconBadge icon={WorkflowIcon} tone="workflow" size="lg" />
      <div>
        <p style={{ fontSize: 15, fontWeight: 650, color: "#374151" }}>
          {hasFilters ? "No workflows match your filters" : "No workflows yet"}
        </p>
        <p className="mt-1 max-w-[300px]" style={{ fontSize: 13, color: "#9CA3AF" }}>
          {hasFilters
            ? "Try adjusting your search or filters."
            : "Build a native workflow, import from LangGraph or Temporal, or instrument existing code."}
        </p>
      </div>
      {!hasFilters && (
        <div className="flex items-center gap-2 mt-1">
          <Link
            href={"/workflows/new" as never}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-white hover:bg-[#1E293B]"
            style={{ fontSize: 13, fontWeight: 650 }}
          >
            <Plus className="h-3.5 w-3.5" />
            Build workflow
          </Link>
          <Link
            href={"/workflows/import" as never}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-slate-600 hover:bg-slate-50"
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            <Upload className="h-3.5 w-3.5" />
            Import workflow
          </Link>
        </div>
      )}
    </div>
  );
}
