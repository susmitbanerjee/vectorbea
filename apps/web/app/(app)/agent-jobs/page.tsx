"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { JobStatusBadge } from "@/components/scheduler/status-badge";
import { Badge } from "@/components/ui/badge";
import { cronToHumanText } from "@/lib/cron-humanizer";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentJob {
  id: string;
  name: string;
  description: string | null;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED";
  triggerType: "MANUAL" | "CRON";
  cronExpression: string | null;
  timezone: string;
  budgetPolicy: { maxRunsPerDay: number | null } | null;
}

interface Pagination {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ─── Filter chip ─────────────────────────────────────────────────────────────

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
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

export default function AgentJobsPage() {
  const router = useRouter();
  const [jobs, setJobs] = useState<AgentJob[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [triggerFilter, setTriggerFilter] = useState("");
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const load = useCallback(
    async (page = 1) => {
      setLoading(true);
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (search) params.set("search", search);
      if (statusFilter) params.set("status", statusFilter);
      if (triggerFilter) params.set("triggerType", triggerFilter);

      try {
        const res = await fetch(`/api/agent-jobs?${params}`);
        if (!res.ok) throw new Error("Failed");
        const data = (await res.json()) as { jobs: AgentJob[]; pagination: Pagination };
        setJobs(data.jobs);
        setPagination(data.pagination);
      } catch {
        toast.error("Failed to load jobs.");
      } finally {
        setLoading(false);
      }
    },
    [search, statusFilter, triggerFilter],
  );

  useEffect(() => { void load(1); }, [load]);

  async function handleTogglePause(job: AgentJob) {
    const newStatus = job.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setActingOn(job.id);
    setOpenMenu(null);
    try {
      const res = await fetch(`/api/agent-jobs/${job.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error();
      toast.success(`Job ${newStatus === "PAUSED" ? "paused" : "resumed"}.`);
      void load();
    } catch {
      toast.error("Failed to update job status.");
    } finally {
      setActingOn(null);
    }
  }

  async function handleManualRun(job: AgentJob) {
    setActingOn(job.id);
    setOpenMenu(null);
    try {
      const res = await fetch(`/api/agent-jobs/${job.id}/runs`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Failed");
      }
      toast.success("Run queued successfully.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to trigger run.");
    } finally {
      setActingOn(null);
    }
  }

  const statusFilters = [
    { label: "All", value: "" },
    { label: "Active", value: "ACTIVE" },
    { label: "Paused", value: "PAUSED" },
    { label: "Archived", value: "ARCHIVED" },
  ];

  return (
    <div className="space-y-5 p-6 lg:p-8" onClick={() => setOpenMenu(null)}>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[18px] font-semibold tracking-tight">Agent Jobs</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pagination
              ? `${pagination.total} job${pagination.total !== 1 ? "s" : ""} configured`
              : "Scheduled AI agent automations"}
          </p>
        </div>
        <Link
          href="/agent-jobs/new"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[13px] font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          New Job
        </Link>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative min-w-[220px] flex-1 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search jobs…"
            className="h-8 pl-8 text-[13px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Status chips */}
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

        {/* Trigger filter */}
        <select
          value={triggerFilter}
          onChange={(e) => setTriggerFilter(e.target.value)}
          className="h-7 rounded-full border border-border bg-background px-3 text-[11px] font-medium text-muted-foreground focus:outline-none"
        >
          <option value="">All triggers</option>
          <option value="CRON">Scheduled</option>
          <option value="MANUAL">Manual</option>
        </select>

        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </button>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading && jobs.length === 0 ? (
            <div className="space-y-0 divide-y divide-border">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-16 animate-pulse rounded bg-muted" />
                  <div className="ml-auto h-4 w-32 animate-pulse rounded bg-muted" />
                </div>
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <EmptyJobs hasFilters={!!search || !!statusFilter || !!triggerFilter} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Job
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Trigger
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Schedule
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                      Budget
                    </th>
                    <th className="w-12 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className={cn(
                        "group transition-colors hover:bg-muted/20",
                        actingOn === job.id && "opacity-50 pointer-events-none",
                      )}
                    >
                      {/* Name */}
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/agent-jobs/${job.id}`}
                          className="block text-[13px] font-medium hover:underline"
                        >
                          {job.name}
                        </Link>
                        {job.description && (
                          <p className="mt-0.5 max-w-[280px] truncate text-[11px] text-muted-foreground">
                            {job.description}
                          </p>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3.5">
                        <JobStatusBadge status={job.status} />
                      </td>

                      {/* Trigger */}
                      <td className="px-4 py-3.5">
                        <Badge
                          variant={job.triggerType === "CRON" ? "default" : "outline"}
                          className="gap-1 text-[10px]"
                        >
                          {job.triggerType === "CRON" ? (
                            <Calendar className="h-2.5 w-2.5" />
                          ) : (
                            <Play className="h-2.5 w-2.5" />
                          )}
                          {job.triggerType === "CRON" ? "Scheduled" : "Manual"}
                        </Badge>
                      </td>

                      {/* Schedule */}
                      <td className="px-4 py-3.5">
                        {job.cronExpression ? (
                          <div>
                            <span className="text-[12px] text-muted-foreground">
                              {cronToHumanText(job.cronExpression, job.timezone)}
                            </span>
                            <p className="font-mono text-[10px] text-muted-foreground/60">
                              {job.cronExpression}
                            </p>
                          </div>
                        ) : (
                          <span className="text-[12px] text-muted-foreground/50">—</span>
                        )}
                      </td>

                      {/* Budget */}
                      <td className="px-4 py-3.5">
                        {job.budgetPolicy?.maxRunsPerDay ? (
                          <span className="text-[12px] text-muted-foreground">
                            {job.budgetPolicy.maxRunsPerDay}/day
                          </span>
                        ) : (
                          <span className="text-[12px] text-muted-foreground/50">Unlimited</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3.5" onClick={(e) => e.stopPropagation()}>
                        <div className="relative flex justify-end">
                          <button
                            type="button"
                            onClick={() => setOpenMenu(openMenu === job.id ? null : job.id)}
                            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-muted hover:text-foreground"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                          {openMenu === job.id && (
                            <div className="absolute right-0 top-8 z-10 w-36 rounded-lg border border-border bg-background py-1 shadow-lg">
                              <button
                                type="button"
                                className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-muted"
                                onClick={() => router.push(`/agent-jobs/${job.id}`)}
                              >
                                View details
                              </button>
                              {job.status !== "ARCHIVED" && (
                                <>
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-muted"
                                    onClick={() => void handleManualRun(job)}
                                    disabled={job.status === "PAUSED"}
                                  >
                                    <Play className="h-3 w-3" /> Run now
                                  </button>
                                  <div className="my-1 border-t border-border/60" />
                                  <button
                                    type="button"
                                    className="flex w-full items-center gap-2 px-3 py-1.5 text-[12px] hover:bg-muted"
                                    onClick={() => void handleTogglePause(job)}
                                  >
                                    {job.status === "ACTIVE" ? "Pause" : "Resume"}
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
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
            <span className="px-2 text-[11px]">
              Page {pagination.page} of {pagination.totalPages}
            </span>
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

function EmptyJobs({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <BriefcaseBusiness className="h-10 w-10 text-muted-foreground/20" />
      <p className="text-sm font-medium text-muted-foreground">
        {hasFilters ? "No jobs match your filters" : "No agent jobs yet"}
      </p>
      <p className="text-xs text-muted-foreground/60">
        {hasFilters
          ? "Try adjusting your search or filters."
          : "Create your first scheduled AI agent job to get started."}
      </p>
      {!hasFilters && (
        <Link
          href="/agent-jobs/new"
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Create job
        </Link>
      )}
    </div>
  );
}
