"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, ExternalLink, Pause, Play, RefreshCw, ArrowRight, Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import { useWorkspace } from "@/lib/workspace-context";
import { Chip, FilterTabs, EmptyHint } from "@/components/ui/page-kit";

const API_BASE = process.env.NEXT_PUBLIC_VECTORBEA_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

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
        { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "X-Workspace-Id": activeWorkspaceId } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: unknown = await res.json();
      setSchedules(Array.isArray(data) ? (data as Schedule[]) : []);
    } catch {
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
    <div className="page-shell space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="vb-mono-label">Orchestration</span>
          <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.03em] text-[#0B0D0F]">Schedules</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[12.5px] text-[#6B7280]">
            {loading ? "loading…" : (
              <>
                <span className="font-semibold text-[#0B0D0F]">{schedules.length}</span> triggers
                <span className="text-[#D7DBE0]">·</span>
                <span className="font-semibold text-[#007F4E]">{activeCount}</span> active
                <span className="text-[#D7DBE0]">·</span>
                <span className="font-semibold text-[#CA8A04]">{pausedCount}</span> paused
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => void load()} disabled={loading} title="Refresh"
            className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-[#E0E3E6] bg-white transition-colors hover:bg-[#F3F4F5] disabled:opacity-40">
            <RefreshCw className={cn("h-3.5 w-3.5 text-[#6B7280]", loading && "animate-spin")} />
          </button>
          <Link href={"/agent-jobs/new" as never} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[#0B0D0F] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#1c1f22]">
            <CalendarClock className="h-4 w-4" /> New schedule
          </Link>
        </div>
      </div>

      {/* Filter */}
      {schedules.length > 0 && (
        <FilterTabs
          options={[
            { value: "ALL", label: "All", count: schedules.length },
            { value: "ACTIVE", label: "Active", count: activeCount },
            { value: "PAUSED", label: "Paused", count: pausedCount },
          ]}
          value={filter}
          onChange={(v) => setFilter(v as "ALL" | "ACTIVE" | "PAUSED")}
        />
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[140px] animate-pulse rounded-[12px] border border-[#E0E3E6] bg-[#FAFBFB]" />)}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyHint
          icon={CalendarClock}
          title={schedules.length === 0 ? "No schedules yet" : "No schedules match this filter"}
          desc={schedules.length === 0 ? "Schedules fire workflows on a recurring cron. Create a job, then attach a schedule to it." : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((s) => {
            const active = s.status === "ACTIVE";
            return (
              <div key={s.id} className="group flex flex-col overflow-hidden rounded-[12px] border border-[#E0E3E6] bg-white transition-all hover:border-[#C9CED4] hover:shadow-[0_6px_20px_rgba(11,13,15,0.05)]">
                {/* Header */}
                <div className="flex items-start gap-3 p-4">
                  <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border", active ? "border-[#9CCFBB] bg-[#E6F4EF] text-[#007F4E]" : "border-[#E0E3E6] bg-[#F3F4F5] text-[#9CA3AF]")}>
                    <CalendarClock className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/agent-jobs/${s.jobId}` as never} className="block truncate text-[14.5px] font-semibold tracking-[-0.01em] text-[#0B0D0F] hover:text-[#007F4E]">
                      {s.jobName}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-[6px] border border-[#E0E3E6] bg-[#F3F4F5] px-1.5 py-0.5 font-mono text-[11px] text-[#4B5563]">{s.cron}</span>
                      <span className="truncate font-mono text-[11px] text-[#9CA3AF]">{s.timezone}</span>
                    </div>
                  </div>
                  {active ? <Chip tone="green">Active</Chip> : <Chip tone="amber">Paused</Chip>}
                </div>

                {/* Human-readable */}
                <p className="-mt-1 px-4 pb-3 text-[12.5px] text-[#4B5563]">{s.humanReadable}</p>

                {/* Footer — next/last fire */}
                <div className="mt-auto flex items-center justify-between border-t border-[#ECEEEF] bg-[#FAFBFB] px-4 py-2.5">
                  <span className="flex items-center gap-3 font-mono text-[11.5px]">
                    <span className={cn("inline-flex items-center gap-1", active ? "text-[#006B45]" : "text-[#9CA3AF]")}>
                      <ArrowRight className="h-3 w-3" /> next {s.nextRun ?? "—"}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[#9CA3AF]"><Clock className="h-3 w-3" /> {s.lastRun ?? "never"}</span>
                  </span>
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button type="button" title={active ? "Pause" : "Resume"} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#6B7280] hover:bg-[#ECEEEF] hover:text-[#0B0D0F]">
                      {active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                    </button>
                    <Link href={`/agent-jobs/${s.jobId}` as never} className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[#6B7280] hover:bg-[#ECEEEF] hover:text-[#0B0D0F]">
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
