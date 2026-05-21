"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Search, RefreshCw, BriefcaseBusiness } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { JobStatusBadge, RunStatusBadge } from "@/components/scheduler/status-badge";
import { Badge } from "@/components/ui/badge";
import { cronToHumanText } from "@/lib/cron-humanizer";

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

  useEffect(() => {
    void load(1);
  }, [load]);

  async function handleTogglePause(job: AgentJob) {
    const newStatus = job.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
    setActingOn(job.id);
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

  return (
    <div className="space-y-6 p-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Agent Jobs</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {pagination ? `${pagination.total} job${pagination.total !== 1 ? "s" : ""}` : "Scheduled AI agent jobs"}
          </p>
        </div>
        <Link
          href="/agent-jobs/new"
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          New Job
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search jobs…"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 rounded-lg border border-border/60 bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PAUSED">Paused</option>
          <option value="ARCHIVED">Archived</option>
        </select>
        <select
          value={triggerFilter}
          onChange={(e) => setTriggerFilter(e.target.value)}
          className="h-9 rounded-lg border border-border/60 bg-background px-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
        >
          <option value="">All triggers</option>
          <option value="CRON">Scheduled (CRON)</option>
          <option value="MANUAL">Manual</option>
        </select>
        <Button variant="ghost" size="icon" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <EmptyJobs hasFilters={!!search || !!statusFilter || !!triggerFilter} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    {["Name", "Status", "Trigger", "Schedule", "Actions"].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left text-xs font-medium text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {jobs.map((job) => (
                    <tr
                      key={job.id}
                      className="transition-colors hover:bg-muted/30"
                      style={{ opacity: actingOn === job.id ? 0.5 : 1 }}
                    >
                      <td className="px-5 py-3">
                        <Link
                          href={`/agent-jobs/${job.id}`}
                          className="font-medium hover:underline"
                        >
                          {job.name}
                        </Link>
                        {job.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                            {job.description}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <JobStatusBadge status={job.status} />
                      </td>
                      <td className="px-5 py-3">
                        <Badge variant={job.triggerType === "CRON" ? "default" : "outline"}>
                          {job.triggerType === "CRON" ? "Scheduled" : "Manual"}
                        </Badge>
                      </td>
                      <td className="px-5 py-3 max-w-[200px]">
                        {job.cronExpression ? (
                          <span className="text-xs text-muted-foreground">
                            {cronToHumanText(job.cronExpression, job.timezone)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push(`/agent-jobs/${job.id}`)}
                          >
                            View
                          </Button>
                          {job.status !== "ARCHIVED" && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleTogglePause(job)}
                                disabled={actingOn === job.id}
                              >
                                {job.status === "ACTIVE" ? "Pause" : "Resume"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => void handleManualRun(job)}
                                disabled={actingOn === job.id || job.status === "PAUSED"}
                              >
                                Run now
                              </Button>
                            </>
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
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1}
              onClick={() => void load(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => void load(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyJobs({ hasFilters }: { hasFilters: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
      <BriefcaseBusiness className="h-10 w-10 text-muted-foreground/30" />
      <p className="text-sm font-medium text-muted-foreground">
        {hasFilters ? "No jobs match your filters" : "No agent jobs yet"}
      </p>
      <p className="text-xs text-muted-foreground/70">
        {hasFilters
          ? "Try adjusting your search or filters."
          : "Create your first scheduled AI agent job to get started."}
      </p>
      {!hasFilters && (
        <Link
          href="/agent-jobs/new"
          className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          Create job
        </Link>
      )}
    </div>
  );
}
