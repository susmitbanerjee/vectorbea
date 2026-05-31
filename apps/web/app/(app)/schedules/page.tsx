"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ExternalLink, Pause, Play, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";

const API_BASE = process.env.NEXT_PUBLIC_VECTORBEA_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Schedule {
  id: string;
  jobName: string;
  cron: string;
  humanReadable: string;
  timezone: string;
  nextRun: string | null;
  lastRun: string | null;
  status: "ACTIVE" | "PAUSED";
  jobId: string;
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

export default function SchedulesPage() {
  const { activeWorkspaceId } = useWorkspace();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "PAUSED">("ALL");

  async function load() {
    setLoading(true);
    try {
      if (!activeWorkspaceId) { setSchedules([]); return; }
      const token = typeof window !== "undefined" ? localStorage.getItem("vectorbea-access-token") : null;
      const res = await fetch(
        `${API_BASE}/api/schedules?workspaceId=${encodeURIComponent(activeWorkspaceId)}`,
        {
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "X-Workspace-Id": activeWorkspaceId,
          },
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      setSchedules(Array.isArray(data) ? (data as Schedule[]) : []);
    } catch {
      // API may not be wired yet — show empty state silently
      setSchedules([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [activeWorkspaceId]);

  const filtered = schedules.filter((s) => filter === "ALL" || s.status === filter);
  const activeCount = schedules.filter((s) => s.status === "ACTIVE").length;
  const pausedCount = schedules.filter((s) => s.status === "PAUSED").length;

  return (
    <div className="page-shell">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="page-title">Schedules</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {loading ? "Loading…" : `${schedules.length} schedule${schedules.length !== 1 ? "s" : ""} configured`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border/60 transition-colors hover:bg-muted disabled:opacity-40"
            style={{ background: "var(--surface-1)" }}
          >
            <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", loading && "animate-spin")} />
          </button>
          <Link
            href={"/agent-jobs/new" as never}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#0F172A] px-4 text-[13.5px] font-semibold text-white shadow-sm transition-all hover:bg-[#1E293B]"
          >
            <CalendarClock className="h-4 w-4" />
            New Schedule
          </Link>
        </div>
      </div>

      {/* Summary strip — only when there are schedules */}
      {schedules.length > 0 && (
        <div className="flex items-center gap-4 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-[12px] text-muted-foreground">
          <span><span className="font-semibold text-foreground">{schedules.length}</span> schedules</span>
          <span className="text-border">·</span>
          <span><span className="font-semibold text-emerald-600">{activeCount}</span> active</span>
          <span className="text-border">·</span>
          <span><span className="font-semibold text-amber-600">{pausedCount}</span> paused</span>
        </div>
      )}

      {/* Filter chips — only when there are schedules */}
      {schedules.length > 0 && (
        <div className="flex items-center gap-1.5">
          {(["ALL", "ACTIVE", "PAUSED"] as const).map((f) => (
            <FilterChip
              key={f}
              label={f === "ALL" ? "All" : f === "ACTIVE" ? "Active" : "Paused"}
              active={filter === f}
              onClick={() => setFilter(f)}
            />
          ))}
        </div>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="divide-y divide-border/60">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-5 py-4">
                  <div className="h-4 w-48 animate-pulse rounded bg-muted" />
                  <div className="h-4 w-24 animate-pulse rounded bg-muted ml-auto" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <CalendarClock className="h-10 w-10 text-muted-foreground/20" />
              <p className="text-sm font-medium text-muted-foreground">
                {schedules.length === 0 ? "No schedules configured" : "No schedules match this filter"}
              </p>
              {schedules.length === 0 && (
                <p className="text-xs text-muted-foreground/60 max-w-xs">
                  Schedules trigger agent jobs on a recurring cron or interval. Create a job first, then attach a schedule to it.
                </p>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {["Job Name", "Cron", "Schedule", "Timezone", "Next Run", "Last Run", "Status", ""].map((h) => (
                      <th
                        key={h}
                        className="px-5 py-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filtered.map((s) => (
                    <tr key={s.id} className="group transition-colors hover:bg-muted/20">
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/agent-jobs/${s.jobId}` as never}
                          className="block text-[13px] font-medium hover:underline"
                        >
                          {s.jobName}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="font-mono text-[11px] text-muted-foreground">{s.cron}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-[12px] text-muted-foreground">{s.humanReadable}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-[12px] text-muted-foreground">{s.timezone}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className={cn(
                          "text-[12px]",
                          s.status === "ACTIVE" ? "text-foreground" : "text-muted-foreground/50",
                        )}>
                          {s.nextRun ?? "—"}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <span className="text-[12px] text-muted-foreground">{s.lastRun ?? "Never"}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        {s.status === "ACTIVE" ? (
                          <Badge className="gap-1 border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px]">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Active
                          </Badge>
                        ) : (
                          <Badge className="gap-1 border-amber-200 bg-amber-50 text-amber-700 text-[10px]">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                            Paused
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            title={s.status === "ACTIVE" ? "Pause" : "Resume"}
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            {s.status === "ACTIVE" ? (
                              <Pause className="h-3 w-3" />
                            ) : (
                              <Play className="h-3 w-3" />
                            )}
                          </button>
                          <Link
                            href={`/agent-jobs/${s.jobId}` as never}
                            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </Link>
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
    </div>
  );
}
